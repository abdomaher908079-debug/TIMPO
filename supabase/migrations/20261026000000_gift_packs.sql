-- Gifts from the owner page: extra hours and episodes that work on every plan, Free included
-- (any_plan). Bought packs keep their rule: only while on Pro or Studio (p_use_packs = paid).
alter table public.hour_packs add column any_plan boolean not null default false;

drop function public.take_from_packs(uuid, numeric, int, uuid);
create function public.take_from_packs(p_workspace uuid, p_seconds numeric, p_episodes int, p_token uuid, p_paid boolean)
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
      where workspace_id = p_workspace and refunded_at is null and expires_at > now() and (p_paid or any_plan)) < s
     or (select coalesce(sum(episodes_left), 0) from public.hour_packs
      where workspace_id = p_workspace and refunded_at is null and expires_at > now() and (p_paid or any_plan)) < e then
    return false;
  end if;
  for pk in
    select id, seconds_left, episodes_left from public.hour_packs
    where workspace_id = p_workspace and refunded_at is null and expires_at > now() and (p_paid or any_plan)
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


create or replace function public.reserve_pick(
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
  select coalesce(sum(seconds_left), 0), coalesce(sum(episodes_left), 0) into pack_seconds, pack_episodes
  from public.hour_packs where workspace_id = p_workspace and refunded_at is null and expires_at > now()
    and (p_use_packs or any_plan);

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
      if not public.take_from_packs(p_workspace, need_seconds, 0, tok, p_use_packs) then
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
    if not public.take_from_packs(p_workspace, need_seconds, need_episodes, tok, p_use_packs) then
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


revoke execute on function public.take_from_packs(uuid, numeric, int, uuid, boolean) from public, anon, authenticated;
revoke execute on function public.reserve_pick(uuid, uuid, text, numeric, timestamptz, numeric, int, numeric, int, numeric, boolean) from public, anon, authenticated;


-- The owner page also shows each account's gifts left and extra Studio seats.
drop function public.owner_accounts(text, text);
create function public.owner_accounts(p_query text, p_filter text)
returns table (
  id uuid, email text, joined timestamptz, last_seen timestamptz, via text, blocked boolean, plan text,
  billing text, plan_until timestamptz, paying boolean, gifted boolean, episodes bigint, episodes_30d bigint,
  team_of text, wants text, gift_seconds numeric, gift_episodes bigint, gift_until timestamptz, extra_seats int
)
language sql
stable
security definer
set search_path = public
as $$
  select u.id, u.email, u.created_at, u.last_sign_in_at, coalesce(u.raw_app_meta_data ->> 'provider', 'email'),
    coalesce(u.banned_until > now(), false),
    case when p.subscription_status in ('active', 'trialing', 'past_due') then p.plan else 'free' end,
    p.billing, p.current_period_end,
    p.paddle_subscription_id is not null and p.subscription_status in ('active', 'trialing', 'past_due'),
    p.paddle_subscription_id is null and p.plan <> 'free' and p.subscription_status = 'active',
    (select count(*) from episodes e where e.user_id = u.id),
    (select count(*) from episodes e where e.user_id = u.id and e.created_at > now() - interval '30 days'),
    (select t.owner_email from team_members t where t.user_id = u.id and t.status = 'active' limit 1),
    (select w.plan from pro_waitlist w where w.user_id = u.id),
    (select coalesce(sum(h.seconds_left), 0) from hour_packs h where h.workspace_id = u.id and h.any_plan and h.refunded_at is null and h.expires_at > now()),
    (select coalesce(sum(h.episodes_left), 0) from hour_packs h where h.workspace_id = u.id and h.any_plan and h.refunded_at is null and h.expires_at > now()),
    (select max(h.expires_at) from hour_packs h where h.workspace_id = u.id and h.any_plan and h.refunded_at is null and h.expires_at > now()),
    coalesce(p.extra_seats, 0)
  from auth.users u
  left join profiles p on p.id = u.id
  where (coalesce(p_query, '') = '' or u.email ilike '%' || p_query || '%')
    and case coalesce(p_filter, 'all')
      when 'free' then coalesce(p.subscription_status, '') not in ('active', 'trialing', 'past_due') or p.plan = 'free'
      when 'pro' then p.plan = 'pro' and p.subscription_status in ('active', 'trialing', 'past_due')
      when 'studio' then p.plan = 'studio' and p.subscription_status in ('active', 'trialing', 'past_due')
      when 'gifted' then (p.paddle_subscription_id is null and p.plan <> 'free' and p.subscription_status = 'active')
        or exists (select 1 from hour_packs h where h.workspace_id = u.id and h.any_plan and h.refunded_at is null and h.expires_at > now())
      when 'paying' then p.paddle_subscription_id is not null and p.subscription_status in ('active', 'trialing', 'past_due')
      when 'blocked' then u.banned_until > now()
      else true
    end
  order by u.created_at desc
  limit 100;
$$;
revoke execute on function public.owner_accounts(text, text) from public, anon, authenticated;
