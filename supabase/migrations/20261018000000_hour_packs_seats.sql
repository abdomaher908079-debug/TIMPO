-- Hour packs (one-time: +10 hours and +20 episodes for 90 days) and extra Studio seats.

-- Bought by a Pro or Studio owner; used only once the month's own hours or episodes run out, and only
-- while the workspace is on Pro or Studio. Written by paddle-webhook (transaction.completed); a refund
-- empties the pack.
create table public.hour_packs (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references auth.users (id) on delete cascade,
  transaction_id text not null unique,
  seconds numeric not null check (seconds >= 0),
  episodes int not null check (episodes >= 0),
  seconds_left numeric not null check (seconds_left >= 0),
  episodes_left int not null check (episodes_left >= 0),
  expires_at timestamptz not null,
  refunded_at timestamptz,
  created_at timestamptz not null default now()
);
create index hour_packs_workspace on public.hour_packs (workspace_id, expires_at);
alter table public.hour_packs enable row level security;
create policy "Read workspace hour packs" on public.hour_packs for select
  using (workspace_id = auth.uid() or workspace_id = public.my_workspace_id());

-- What each pick took from packs, so a pick the AI couldn't make gives it back. Server-only.
create table public.pack_uses (
  id bigint generated always as identity primary key,
  token uuid not null,
  pack_id bigint not null references public.hour_packs (id) on delete cascade,
  seconds numeric not null default 0,
  episodes int not null default 0,
  created_at timestamptz not null default now()
);
create index pack_uses_token on public.pack_uses (token);
alter table public.pack_uses enable row level security;

-- Takes time and episodes from the workspace's packs (soonest to expire first), all or nothing.
-- Call with the workspace's usage lock held.
create function public.take_from_packs(p_workspace uuid, p_seconds numeric, p_episodes int, p_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  pk record;
  s numeric := greatest(p_seconds, 0);
  e int := greatest(p_episodes, 0);
  take_s numeric;
  take_e int;
begin
  if s = 0 and e = 0 then
    return true;
  end if;
  if (select coalesce(sum(seconds_left), 0) from public.hour_packs
      where workspace_id = p_workspace and refunded_at is null and expires_at > now()) < s
     or (select coalesce(sum(episodes_left), 0) from public.hour_packs
      where workspace_id = p_workspace and refunded_at is null and expires_at > now()) < e then
    return false;
  end if;
  for pk in
    select id, seconds_left, episodes_left from public.hour_packs
    where workspace_id = p_workspace and refunded_at is null and expires_at > now()
    order by expires_at, id
    for update
  loop
    exit when s = 0 and e = 0;
    take_s := least(s, pk.seconds_left);
    take_e := least(e, pk.episodes_left);
    if take_s > 0 or take_e > 0 then
      update public.hour_packs set seconds_left = seconds_left - take_s, episodes_left = episodes_left - take_e where id = pk.id;
      insert into public.pack_uses (token, pack_id, seconds, episodes) values (p_token, pk.id, take_s, take_e);
      s := s - take_s;
      e := e - take_e;
    end if;
  end loop;
  return true;
end;
$$;

-- reserve_pick (see 20261017000000_usage_guard.sql), now drawing on hour packs once the period's own
-- hours or episodes are used up (p_use_packs: paid plans only). Returns a token for release_pick.
drop function public.reserve_pick(uuid, uuid, text, numeric, timestamptz, numeric, int, numeric, int, numeric);
create function public.reserve_pick(
  p_workspace uuid,
  p_user uuid,
  p_fingerprint text,
  p_seconds numeric,
  p_period timestamptz,
  p_max_seconds numeric,
  p_max_episodes int,
  p_max_episode_seconds numeric,
  p_max_picks int,
  p_grace numeric,
  p_use_packs boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ep public.episodes%rowtype;
  used_seconds numeric;
  used_episodes int;
  extra numeric;
  over numeric;
  need_seconds numeric;
  need_episodes int;
  pack_seconds numeric := 0;
  pack_episodes int := 0;
  tok uuid := gen_random_uuid();
  new_id bigint;
begin
  if p_seconds is null or p_seconds < 0 then
    raise exception 'invalid seconds';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('usage:' || p_workspace::text, 0));

  if p_max_episode_seconds is not null and p_seconds > p_max_episode_seconds + p_grace then
    return jsonb_build_object('ok', false, 'reason', 'too-long');
  end if;

  select coalesce(sum(e.seconds), 0), count(*) into used_seconds, used_episodes
  from public.episodes e
  where e.workspace_id = p_workspace and e.period_start = p_period;
  if p_use_packs then
    select coalesce(sum(seconds_left), 0), coalesce(sum(episodes_left), 0) into pack_seconds, pack_episodes
    from public.hour_packs where workspace_id = p_workspace and refunded_at is null and expires_at > now();
  end if;

  select * into ep from public.episodes e
  where e.workspace_id = p_workspace and e.fingerprint = p_fingerprint and e.period_start = p_period;

  if found then
    if ep.picks >= p_max_picks then
      return jsonb_build_object('ok', false, 'reason', 'no-repicks-left');
    end if;
    extra := greatest(0, p_seconds - ep.seconds);
    over := used_seconds + extra - p_max_seconds;
    if extra > p_grace and over > p_grace then
      need_seconds := least(extra, over);
      if not p_use_packs or not public.take_from_packs(p_workspace, need_seconds, 0, tok) then
        return jsonb_build_object('ok', false, 'reason', 'no-hours-left',
          'left', greatest(0, p_max_seconds - used_seconds) + pack_seconds);
      end if;
    end if;
    update public.episodes set picks = picks + 1, seconds = greatest(seconds, p_seconds) where id = ep.id;
    return jsonb_build_object('ok', true, 'id', ep.id, 'new', false, 'old_seconds', ep.seconds, 'token', tok);
  end if;

  need_episodes := case when p_max_episodes is not null and used_episodes >= p_max_episodes then 1 else 0 end;
  over := used_seconds + p_seconds - p_max_seconds;
  need_seconds := case when over > p_grace then least(p_seconds, over) else 0 end;
  if need_episodes > 0 or need_seconds > 0 then
    if not p_use_packs or not public.take_from_packs(p_workspace, need_seconds, need_episodes, tok) then
      if need_episodes > 0 and pack_episodes < need_episodes then
        return jsonb_build_object('ok', false, 'reason', 'no-episodes-left');
      end if;
      return jsonb_build_object('ok', false, 'reason', 'no-hours-left',
        'left', greatest(0, p_max_seconds - used_seconds) + pack_seconds);
    end if;
  end if;
  insert into public.episodes (user_id, workspace_id, fingerprint, seconds, period_start, picks)
  values (p_user, p_workspace, p_fingerprint, p_seconds, p_period, 1)
  returning id into new_id;
  return jsonb_build_object('ok', true, 'id', new_id, 'new', true, 'old_seconds', 0, 'token', tok);
end;
$$;

-- release_pick, now also giving back what the pick took from hour packs.
drop function public.release_pick(uuid, bigint, boolean, numeric);
create function public.release_pick(p_workspace uuid, p_id bigint, p_new boolean, p_old_seconds numeric, p_token uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('usage:' || p_workspace::text, 0));
  if p_new then
    delete from public.episodes where id = p_id and workspace_id = p_workspace and picks <= 1;
    update public.episodes set picks = picks - 1 where id = p_id and workspace_id = p_workspace and picks > 1;
  else
    update public.episodes set picks = greatest(0, picks - 1), seconds = least(seconds, greatest(p_old_seconds, 0))
    where id = p_id and workspace_id = p_workspace;
  end if;
  if p_token is not null then
    update public.hour_packs h set seconds_left = h.seconds_left + u.seconds, episodes_left = h.episodes_left + u.episodes
    from (select pack_id, sum(seconds) seconds, sum(episodes) episodes from public.pack_uses where token = p_token group by pack_id) u
    where h.id = u.pack_id and h.refunded_at is null;
    delete from public.pack_uses where token = p_token;
  end if;
end;
$$;

revoke execute on function public.take_from_packs(uuid, numeric, int, uuid) from public, anon, authenticated;
revoke execute on function public.reserve_pick(uuid, uuid, text, numeric, timestamptz, numeric, int, numeric, int, numeric, boolean) from public, anon, authenticated;
revoke execute on function public.release_pick(uuid, bigint, boolean, numeric, uuid) from public, anon, authenticated;

-- Extra Studio seats beyond the 3 people included (an extra item on the subscription, $8 a month each).
alter table public.profiles add column extra_seats int not null default 0 check (extra_seats between 0 and 7);

-- Invites: as before, with room for the extra seats.
create or replace function public.check_team_invite() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  owner public.profiles;
begin
  select * into owner from public.profiles where id = new.owner_id;
  if owner is null or public.effective_plan(owner) <> 'studio' then
    raise exception 'Teams are part of the Studio plan.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.team_members where owner_id = new.owner_id) >= 2 + owner.extra_seats then
    raise exception 'Your team is full. Add a seat to invite more people.' using errcode = 'P0001';
  end if;
  new.owner_email := (select lower(email) from auth.users where id = new.owner_id);
  if new.email = new.owner_email then
    raise exception 'You''re already in your own team.' using errcode = 'P0001';
  end if;
  -- Invites start unaccepted; joining goes through join_team().
  new.user_id := null;
  new.status := 'invited';
  return new;
end;
$$;
