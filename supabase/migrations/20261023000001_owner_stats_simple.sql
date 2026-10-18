-- The owners' dashboard as plain sections of "name: number", covering everything Isla records.
-- Episodes and cloud jobs are kept 3 months and AI requests 90 days (see storage_cleanup), so their
-- totals are for that window.
create or replace function public.owner_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  today timestamptz := date_trunc('day', now());
  week timestamptz := now() - interval '7 days';
  month timestamptz := now() - interval '30 days';
  users int;
  pro int;
  studio int;
begin
  if not exists (
    select 1 from auth.users
    where id = auth.uid()
      and lower(email) in ('abdomaher908079@gmail.com', 'islaclipsofficial@gmail.com')
      and email_confirmed_at is not null
  ) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  select count(*) into users from auth.users;
  select count(*) filter (where plan = 'pro'), count(*) filter (where plan = 'studio') into pro, studio from profiles;

  return jsonb_build_array(
    jsonb_build_object('title', 'People', 'rows', jsonb_build_array(
      jsonb_build_array('Accounts in total', users),
      jsonb_build_array('New today', (select count(*) from auth.users where created_at >= today)),
      jsonb_build_array('New in the last 7 days', (select count(*) from auth.users where created_at >= week)),
      jsonb_build_array('New in the last 30 days', (select count(*) from auth.users where created_at >= month)),
      jsonb_build_array('Signed up with Google', (select count(*) from auth.users where raw_app_meta_data ->> 'provider' = 'google')),
      jsonb_build_array('Signed up with email', (select count(*) from auth.users where coalesce(raw_app_meta_data ->> 'provider', 'email') = 'email')),
      jsonb_build_array('Email not confirmed yet', (select count(*) from auth.users where email_confirmed_at is null)),
      jsonb_build_array('Opened Isla today', (select count(*) from auth.users where last_sign_in_at >= today)),
      jsonb_build_array('Opened Isla in the last 7 days', (select count(*) from auth.users where last_sign_in_at >= week)),
      jsonb_build_array('Made at least one episode (3 months)', (select count(distinct user_id) from episodes)),
      jsonb_build_array('Never made an episode', users - (select count(distinct user_id) from episodes))
    )),
    jsonb_build_object('title', 'Episodes', 'rows', jsonb_build_array(
      jsonb_build_array('Today', (select count(*) from episodes where created_at >= today)),
      jsonb_build_array('Last 7 days', (select count(*) from episodes where created_at >= week)),
      jsonb_build_array('Last 30 days', (select count(*) from episodes where created_at >= month)),
      jsonb_build_array('Last 3 months', (select count(*) from episodes)),
      jsonb_build_array('Hours of episodes, last 30 days', (select round(coalesce(sum(seconds), 0) / 3600.0, 1) from episodes where created_at >= month)),
      jsonb_build_array('Average episode length, minutes', (select round(coalesce(avg(seconds), 0) / 60.0) from episodes where created_at >= month)),
      jsonb_build_array('Times people asked for new picks, last 30 days', (select coalesce(sum(picks - 1), 0) from episodes where created_at >= month))
    )),
    jsonb_build_object('title', 'Phones (listening in the cloud)', 'rows', jsonb_build_array(
      jsonb_build_array('Started today', (select count(*) from listen_jobs where created_at >= today)),
      jsonb_build_array('Started in the last 7 days', (select count(*) from listen_jobs where created_at >= week)),
      jsonb_build_array('Finished, last 7 days', (select count(*) from listen_jobs where created_at >= week and status = 'done' and error is null)),
      jsonb_build_array('Failed, last 7 days', (select count(*) from listen_jobs where created_at >= week and (status = 'error' or error is not null))),
      jsonb_build_array('Working right now', (select count(*) from listen_jobs where status in ('uploading', 'listening', 'finishing') and waiting_until is null)),
      jsonb_build_array('Waiting in line right now', (select count(*) from listen_jobs where waiting_until is not null and status in ('listening', 'finishing'))),
      jsonb_build_array('Hours listened, last 7 days', (select round(coalesce(sum(seconds), 0) / 3600.0, 1) from listen_jobs where created_at >= week and status = 'done'))
    )),
    jsonb_build_object('title', 'AI (Google''s free daily limit)', 'rows', jsonb_build_array(
      jsonb_build_array('AI requests today', (select count(*) from ai_calls where created_at >= today)),
      jsonb_build_array('Listening requests today', (select count(*) from ai_calls where created_at >= today and kind = 'listen')),
      jsonb_build_array('Moment-picking requests today', (select count(*) from ai_calls where created_at >= today and kind = 'pick')),
      jsonb_build_array('AI requests, last 7 days', (select count(*) from ai_calls where created_at >= week)),
      jsonb_build_array('Paid AI requests, last 30 days', (select count(*) from ai_calls where created_at >= month and paid))
    )),
    jsonb_build_object('title', 'Saved work', 'rows', jsonb_build_array(
      jsonb_build_array('Episodes saved right now', (select count(*) from projects)),
      jsonb_build_array('Clips saved right now', (select coalesce(sum(jsonb_array_length(clips)), 0) from projects where jsonb_typeof(clips) = 'array')),
      jsonb_build_array('Brand kits', (select count(*) from brand_kits))
    )),
    jsonb_build_object('title', 'Plans', 'rows', jsonb_build_array(
      jsonb_build_array('On Free', users - pro - studio),
      jsonb_build_array('On Pro', pro),
      jsonb_build_array('On Studio', studio),
      jsonb_build_array('Paying right now', (select count(*) from profiles where subscription_status in ('active', 'trialing', 'past_due') and paddle_subscription_id is not null)),
      jsonb_build_array('Paid plan given for free', (select count(*) from profiles where subscription_status = 'active' and paddle_subscription_id is null and plan <> 'free')),
      jsonb_build_array('Team members invited', (select count(*) from team_members)),
      jsonb_build_array('Extra seats', (select coalesce(sum(extra_seats), 0) from profiles)),
      jsonb_build_array('Hour packs bought', (select count(*) from hour_packs where refunded_at is null)),
      jsonb_build_array('Want Pro (Notify me)', (select count(*) from pro_waitlist where plan = 'pro')),
      jsonb_build_array('Want Studio (Notify me)', (select count(*) from pro_waitlist where plan = 'studio'))
    )),
    jsonb_build_object('title', 'Storage', 'rows', jsonb_build_array(
      jsonb_build_array('Database used, MB (free limit 500)', (select round(pg_database_size(current_database()) / 1048576.0)))
    )),
    jsonb_build_object('title', 'Notify me emails', 'list', coalesce((
      select jsonb_agg(email || ' (' || plan || ')' order by created_at desc) from pro_waitlist
    ), '[]'::jsonb)),
    jsonb_build_object('title', 'Newest accounts', 'list', coalesce((
      select jsonb_agg(email order by created_at desc) from (select email, created_at from auth.users order by created_at desc limit 30) u
    ), '[]'::jsonb))
  );
end;
$$;
