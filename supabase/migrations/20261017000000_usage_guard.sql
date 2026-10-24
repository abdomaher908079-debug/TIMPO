-- Plan limits that hold under any load: each check-and-count happens in one step, locked per workspace,
-- so requests sent at the same moment can't all pass the check before any of them is counted.
-- Called only by the Edge Functions (service role); the limits themselves come from
-- supabase/functions/_shared/plans.ts, passed in by the caller.

-- How many times the AI picked this episode's moments in the period (the first pick and re-picks).
alter table public.episodes add column picks int not null default 1 check (picks >= 0);

-- Takes one AI pick for an episode, if the plan allows it:
-- - the same episode again (same file, no longer than before): a re-pick, up to p_max_picks in all;
--   a longer transcript than before also needs the extra time to fit;
-- - a new episode: must fit the episode length, the episodes left and the time left.
-- Returns { ok: true, id, new, old_seconds } (hand these to release_pick if the AI then fails), or
-- { ok: false, reason, left } with reason too-long | no-episodes-left | no-hours-left | no-repicks-left.
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
  p_grace numeric
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

  select * into ep from public.episodes e
  where e.workspace_id = p_workspace and e.fingerprint = p_fingerprint and e.period_start = p_period;

  if found then
    if ep.picks >= p_max_picks then
      return jsonb_build_object('ok', false, 'reason', 'no-repicks-left');
    end if;
    extra := greatest(0, p_seconds - ep.seconds);
    if extra > p_grace and used_seconds + extra > p_max_seconds + p_grace then
      return jsonb_build_object('ok', false, 'reason', 'no-hours-left', 'left', greatest(0, p_max_seconds - used_seconds));
    end if;
    update public.episodes set picks = picks + 1, seconds = greatest(seconds, p_seconds) where id = ep.id;
    return jsonb_build_object('ok', true, 'id', ep.id, 'new', false, 'old_seconds', ep.seconds);
  end if;

  if p_max_episodes is not null and used_episodes >= p_max_episodes then
    return jsonb_build_object('ok', false, 'reason', 'no-episodes-left');
  end if;
  if used_seconds + p_seconds > p_max_seconds + p_grace then
    return jsonb_build_object('ok', false, 'reason', 'no-hours-left', 'left', greatest(0, p_max_seconds - used_seconds));
  end if;
  insert into public.episodes (user_id, workspace_id, fingerprint, seconds, period_start, picks)
  values (p_user, p_workspace, p_fingerprint, p_seconds, p_period, 1)
  returning id into new_id;
  return jsonb_build_object('ok', true, 'id', new_id, 'new', true, 'old_seconds', 0);
end;
$$;

-- Gives back a pick the AI couldn't make (busy, error), so failures never use up the plan.
create function public.release_pick(p_workspace uuid, p_id bigint, p_new boolean, p_old_seconds numeric)
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
end;
$$;

-- Cloud listening is counted per piece of audio actually heard: reserved just before each piece is
-- sent to the AI, and given back if the AI fails. Listening the same episode again counts again (it
-- costs again); it isn't another episode for plans that count episodes (p_max_jobs).
-- Returns false when the piece doesn't fit what's left.
create function public.reserve_cloud(
  p_workspace uuid,
  p_user uuid,
  p_fingerprint text,
  p_period timestamptz,
  p_seconds numeric,
  p_max_seconds numeric,
  p_max_jobs int,
  p_grace numeric
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  used_seconds numeric;
  jobs int;
  known boolean;
begin
  if p_seconds is null or p_seconds < 0 then
    raise exception 'invalid seconds';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('usage:' || p_workspace::text, 0));
  select coalesce(sum(c.seconds), 0), count(*), coalesce(bool_or(c.fingerprint = p_fingerprint), false)
  into used_seconds, jobs, known
  from public.cloud_jobs c
  where c.workspace_id = p_workspace and c.period_start = p_period;
  if not known and p_max_jobs is not null and jobs >= p_max_jobs then
    return false;
  end if;
  if used_seconds + p_seconds > p_max_seconds + p_grace then
    return false;
  end if;
  insert into public.cloud_jobs (user_id, workspace_id, fingerprint, seconds, period_start)
  values (p_user, p_workspace, p_fingerprint, p_seconds, p_period)
  on conflict (workspace_id, fingerprint, period_start) do update set seconds = public.cloud_jobs.seconds + excluded.seconds;
  return true;
end;
$$;

create function public.release_cloud(p_workspace uuid, p_fingerprint text, p_period timestamptz, p_seconds numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('usage:' || p_workspace::text, 0));
  update public.cloud_jobs set seconds = greatest(0, seconds - p_seconds)
  where workspace_id = p_workspace and fingerprint = p_fingerprint and period_start = p_period;
end;
$$;

revoke execute on function public.reserve_pick(uuid, uuid, text, numeric, timestamptz, numeric, int, numeric, int, numeric) from public, anon, authenticated;
revoke execute on function public.release_pick(uuid, bigint, boolean, numeric) from public, anon, authenticated;
revoke execute on function public.reserve_cloud(uuid, uuid, text, timestamptz, numeric, numeric, int, numeric) from public, anon, authenticated;
revoke execute on function public.release_cloud(uuid, text, timestamptz, numeric) from public, anon, authenticated;

-- What every AI request really cost: model and tokens. Server-only (no policies), for working out
-- the true cost of each plan.
create table public.ai_calls (
  id bigint generated always as identity primary key,
  workspace_id uuid references auth.users (id) on delete set null,
  user_id uuid references auth.users (id) on delete set null,
  -- pick: choosing the moments; listen: transcribing a piece of audio (cloud listening).
  kind text not null check (kind in ('pick', 'listen')),
  model text not null,
  paid boolean not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  seconds numeric,
  created_at timestamptz not null default now()
);
create index ai_calls_created on public.ai_calls (created_at);
alter table public.ai_calls enable row level security;
