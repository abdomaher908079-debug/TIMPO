-- Payment fixes.
-- paid_from: from when a running plan's time is paid for (to its end). A plan we gave can be extended by
-- paying; only the paid part is credited when switching plans.
alter table public.profiles add column paid_from timestamptz;
update public.profiles set paid_from = current_period_start where paid_with is not null;

-- done_at: when a paid order was really applied. applied_at is set first, as a claim; a claim older than
-- a few minutes without done_at means applying died half-way, and the order can be claimed again.
alter table public.crypto_orders add column done_at timestamptz;
update public.crypto_orders set done_at = applied_at where applied_at is not null;

-- Plans ending on their own also forget when their paid part started.
select cron.unschedule('hookcut-gift-expiry');
select cron.schedule('hookcut-gift-expiry', '*/30 * * * *', $$
  update public.profiles
  set plan = 'free', billing = null, subscription_status = null, current_period_start = null,
      current_period_end = null, cancel_at = null, extra_seats = 0, pending_plan = null, pending_billing = null,
      paid_with = null, paid_from = null, updated_at = now()
  where paddle_subscription_id is null and plan <> 'free' and current_period_end < now() - interval '3 hours';
$$);

-- Only orders where no money ever arrived are cleaned up; anything paid (even partly) is kept for support.
select cron.unschedule('hookcut-crypto-orders-cleanup');
select cron.schedule('hookcut-crypto-orders-cleanup', '23 3 * * *', $$
  delete from public.crypto_orders
  where applied_at is null and coalesce(actually_paid, 0) = 0
    and status in ('waiting', 'failed', 'expired') and created_at < now() - interval '30 days';
$$);
