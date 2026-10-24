-- Plans paid upfront or given from the owner page stop at their end date. They used to keep working until
-- the clean-up job reset them (up to 3½ hours later: it waits for plan-reminders' "your plan has ended"
-- email, which needs the plan still on the profile). The clean-up keeps its timing; access doesn't.
-- Paddle subscriptions are unchanged: Paddle's own status says when they end.
create or replace function public.effective_plan(p public.profiles) returns text
language sql stable set search_path = '' as $$
  select case
    when p.plan in ('pro', 'studio') and p.subscription_status in ('active', 'trialing', 'past_due')
      and (p.paddle_subscription_id is not null or p.current_period_end is null or p.current_period_end > now())
      then p.plan
    else 'free'
  end;
$$;

-- A paid order that couldn't be applied, so it needs a refund by hand: 'studio-ended' when more people
-- were paid for but the Studio plan had ended before the payment arrived.
alter table public.crypto_orders add column problem text;
