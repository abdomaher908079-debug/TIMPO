-- Plan changes and what happens when a plan ends.

-- A downgrade (Studio → Pro, or yearly → monthly) waits for the end of the paid period. Set by the
-- change-plan function, applied by apply-plan-changes just before renewal, cleared when applied or undone.
alter table public.profiles
  add column pending_plan text check (pending_plan in ('pro', 'studio')),
  add column pending_billing text check (pending_billing in ('monthly', 'yearly'));

-- Saved work is kept 1 day on Free and 30 days on paid plans after its last change, and never less than 30
-- days after a paid plan ends (canceled, failed payment, or a team's Studio ending), so nobody loses their
-- work the moment a payment fails.
create function public.project_expires(uid uuid, touched timestamptz) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select greatest(
    touched + public.project_keep(uid),
    coalesce((
      select max(p.current_period_end) + interval '30 days'
      from public.profiles p
      where p.plan in ('pro', 'studio')
        and coalesce(p.subscription_status, '') not in ('active', 'trialing', 'past_due')
        and (p.id = uid or p.id in (select m.owner_id from public.team_members m where m.user_id = uid and m.status = 'active'))
    ), '-infinity'::timestamptz)
  );
$$;
revoke execute on function public.project_expires(uuid, timestamptz) from public, anon, authenticated;

create or replace function public.my_projects()
returns table (id uuid, fingerprint text, file_name text, file_size bigint, info jsonb, clip_count int, listening boolean,
               created_at timestamptz, touched_at timestamptz, expires_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.id, p.fingerprint, p.file_name, p.file_size, p.info, jsonb_array_length(p.clips), p.listening,
         p.created_at, p.touched_at, public.project_expires(p.user_id, p.touched_at)
  from public.projects p
  where p.user_id = auth.uid() and public.project_expires(p.user_id, p.touched_at) > now()
  order by p.touched_at desc;
$$;

create or replace function public.my_project(p_fingerprint text)
returns table (id uuid, fingerprint text, file_name text, file_size bigint, info jsonb, segments jsonb, clips jsonb, listening boolean,
               created_at timestamptz, touched_at timestamptz, expires_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.id, p.fingerprint, p.file_name, p.file_size, p.info, p.segments, p.clips, p.listening,
         p.created_at, p.touched_at, public.project_expires(p.user_id, p.touched_at)
  from public.projects p
  where p.user_id = auth.uid() and p.fingerprint = p_fingerprint and public.project_expires(p.user_id, p.touched_at) > now();
$$;

select cron.unschedule('hookcut-cleanup');
select cron.schedule('hookcut-cleanup', '17 * * * *', $$
  delete from public.projects p where public.project_expires(p.user_id, p.touched_at) < now();
  delete from public.listen_jobs where created_at < now() - interval '8 days';
$$);

-- Every 15 minutes: apply downgrades whose period is about to end (apply-plan-changes). The function's
-- address and its secret live in Vault (secrets `project_url` and `plan_changes_secret`), not in this file.
create extension if not exists pg_net;
select cron.schedule('hookcut-plan-changes', '*/15 * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/apply-plan-changes',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'plan_changes_secret')
    ),
    body := '{}'::jsonb
  );
$$);
