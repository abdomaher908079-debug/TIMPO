-- Reminder emails for plans given from the owner page (no Paddle subscription): 7, 3 and 1 day before the
-- end, then "your plan has ended" when it ends without being renewed. Sent by the plan-reminders function.

-- Which emails went out, so none is sent twice. Keyed by the plan's end date: a renewal (new end date)
-- starts a fresh set of reminders. Only the server reads or writes it.
create table public.plan_emails (
  user_id uuid not null references auth.users (id) on delete cascade,
  period_end timestamptz not null,
  kind text not null check (kind in ('7d', '3d', '1d', 'ended')),
  sent_at timestamptz not null default now(),
  primary key (user_id, period_end, kind)
);
alter table public.plan_emails enable row level security;

-- The function now ends plans itself (after the "ended" email); this stays as a safety net.
select cron.unschedule('hookcut-gift-expiry');
select cron.schedule('hookcut-gift-expiry', '*/30 * * * *', $$
  update public.profiles
  set plan = 'free', billing = null, subscription_status = null, current_period_start = null,
      current_period_end = null, cancel_at = null, extra_seats = 0, pending_plan = null, pending_billing = null,
      updated_at = now()
  where paddle_subscription_id is null and plan <> 'free' and current_period_end < now() - interval '3 hours';
$$);

select cron.schedule('hookcut-plan-reminders', '7 * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/plan-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'plan_changes_secret')
    ),
    body := '{}'::jsonb
  );
$$);
