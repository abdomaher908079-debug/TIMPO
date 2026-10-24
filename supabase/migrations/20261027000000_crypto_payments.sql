-- Payments through NOWPayments (crypto, or card through its on-ramp): prepaid plans of 1 month or 1 year
-- that don't renew on their own, and hour packs. Orders are created by the create-invoice function and
-- paid ones applied by nowpayments-webhook. Paid plans end like given ones (reminders, then Free).

-- How a running plan was paid for: 'nowpayments', or null (given from the owner page, or Paddle).
alter table public.profiles add column paid_with text check (paid_with in ('nowpayments'));

create table public.crypto_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('plan', 'pack')),
  plan text check (plan in ('pro', 'studio')),
  billing text check (billing in ('monthly', 'yearly')),
  price_usd numeric not null check (price_usd > 0),
  invoice_id text,
  payment_id text,
  status text not null default 'waiting',
  country text,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  applied_at timestamptz
);
create index crypto_orders_user on public.crypto_orders (user_id, created_at desc);
alter table public.crypto_orders enable row level security;
create policy "Read own orders" on public.crypto_orders for select using (user_id = auth.uid());

-- Plans ending on their own: also clear how they were paid.
select cron.unschedule('hookcut-gift-expiry');
select cron.schedule('hookcut-gift-expiry', '*/30 * * * *', $$
  update public.profiles
  set plan = 'free', billing = null, subscription_status = null, current_period_start = null,
      current_period_end = null, cancel_at = null, extra_seats = 0, pending_plan = null, pending_billing = null,
      paid_with = null, updated_at = now()
  where paddle_subscription_id is null and plan <> 'free' and current_period_end < now() - interval '3 hours';
$$);

-- Clean up orders nobody paid after 30 days.
select cron.schedule('hookcut-crypto-orders-cleanup', '23 3 * * *', $$
  delete from public.crypto_orders where applied_at is null and created_at < now() - interval '30 days';
$$);

-- Owner numbers: plans paid through NOWPayments count as paying, not given.
-- The owners' numbers also need a session that passed two-step verification (aal2).
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
  ) or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
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
      jsonb_build_array('Paying right now', (select count(*) from profiles where subscription_status in ('active', 'trialing', 'past_due') and (paddle_subscription_id is not null or paid_with is not null))),
      jsonb_build_array('Paid plan given for free', (select count(*) from profiles where subscription_status = 'active' and paddle_subscription_id is null and paid_with is null and plan <> 'free')),
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


-- Owner accounts: the same split.
create or replace function public.owner_accounts(p_query text, p_filter text)
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
    (p.paddle_subscription_id is not null or p.paid_with is not null) and p.subscription_status in ('active', 'trialing', 'past_due'),
    p.paddle_subscription_id is null and p.paid_with is null and p.plan <> 'free' and p.subscription_status = 'active',
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
      when 'gifted' then (p.paddle_subscription_id is null and p.paid_with is null and p.plan <> 'free' and p.subscription_status = 'active')
        or exists (select 1 from hour_packs h where h.workspace_id = u.id and h.any_plan and h.refunded_at is null and h.expires_at > now())
      when 'paying' then (p.paddle_subscription_id is not null or p.paid_with is not null) and p.subscription_status in ('active', 'trialing', 'past_due')
      when 'blocked' then u.banned_until > now()
      else true
    end
  order by u.created_at desc
  limit 100;
$$;
revoke execute on function public.owner_accounts(text, text) from public, anon, authenticated;
