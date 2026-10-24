-- The owners' account controls (owner page → Accounts, the owner-admin function).

-- Every change an owner makes to an account, for the record. Only the server writes or reads it.
create table public.owner_actions (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  owner_email text not null,
  target_email text,
  action text not null,
  details jsonb
);
alter table public.owner_actions enable row level security;

-- A paid plan given by an owner (no Paddle subscription) ends on its end date: back to Free.
select cron.schedule('hookcut-gift-expiry', '*/30 * * * *', $$
  update public.profiles
  set plan = 'free', billing = null, subscription_status = null, current_period_start = null,
      current_period_end = null, cancel_at = null, extra_seats = 0, pending_plan = null, pending_billing = null,
      updated_at = now()
  where paddle_subscription_id is null and plan <> 'free' and current_period_end < now();
$$);

-- The owner page's account list: matching emails, filtered, newest first. Only the server calls it.
create function public.owner_accounts(p_query text, p_filter text)
returns table (
  id uuid, email text, joined timestamptz, last_seen timestamptz, via text, blocked boolean, plan text,
  billing text, plan_until timestamptz, paying boolean, gifted boolean, episodes bigint, episodes_30d bigint,
  team_of text, wants text
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
    (select w.plan from pro_waitlist w where w.user_id = u.id)
  from auth.users u
  left join profiles p on p.id = u.id
  where (coalesce(p_query, '') = '' or u.email ilike '%' || p_query || '%')
    and case coalesce(p_filter, 'all')
      when 'free' then coalesce(p.subscription_status, '') not in ('active', 'trialing', 'past_due') or p.plan = 'free'
      when 'pro' then p.plan = 'pro' and p.subscription_status in ('active', 'trialing', 'past_due')
      when 'studio' then p.plan = 'studio' and p.subscription_status in ('active', 'trialing', 'past_due')
      when 'gifted' then p.paddle_subscription_id is null and p.plan <> 'free' and p.subscription_status = 'active'
      when 'paying' then p.paddle_subscription_id is not null and p.subscription_status in ('active', 'trialing', 'past_due')
      when 'blocked' then u.banned_until > now()
      else true
    end
  order by u.created_at desc
  limit 100;
$$;
revoke execute on function public.owner_accounts(text, text) from public, anon, authenticated;
