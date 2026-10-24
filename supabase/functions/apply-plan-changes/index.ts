// Supabase Edge Function, run every 15 minutes by pg_cron (see 20261019000000_plan_changes.sql): applies
// scheduled downgrades (pending_plan) in the last 45 minutes before the subscription renews.
// - Same billing (Studio → Pro monthly): the items change now without billing, so the renewal charges
//   the new plan. If the renewal already happened, the change is prorated instead.
// - Yearly → monthly: billed in full now (a new monthly period starts). Changing billing without
//   billing would start a free period, so never that. If the year renewed first, it waits for the next end.
// Secrets: PLAN_CHANGES_SECRET (also in Vault as plan_changes_secret), PADDLE_*.
// Deploy: supabase functions deploy apply-plan-changes --no-verify-jwt
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { itemsFor, paddle, planForPrice, type PaddleItem } from '../_shared/paddle.ts';
import type { Billing } from '../_shared/plans.ts';

const WINDOW_MS = 45 * 60_000;

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

Deno.serve(async (req) => {
  const secret = Deno.env.get('PLAN_CHANGES_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) return new Response('Not allowed', { status: 401 });

  const { data: due, error } = await admin
    .from('profiles')
    .select('id, paddle_subscription_id, extra_seats, pending_plan, pending_billing')
    .not('pending_plan', 'is', null)
    .not('paddle_subscription_id', 'is', null)
    .is('cancel_at', null)
    .in('subscription_status', ['active', 'trialing', 'past_due'])
    .lt('current_period_end', new Date(Date.now() + WINDOW_MS).toISOString());
  if (error) {
    console.error(error);
    return new Response('Database error', { status: 500 });
  }

  let applied = 0;
  for (const p of due ?? []) {
    try {
      const subRes = await paddle(`/subscriptions/${p.paddle_subscription_id}`);
      if (!subRes.ok) throw new Error(`subscription ${subRes.status} ${await subRes.text()}`);
      const sub = ((await subRes.json()) as { data: { items: PaddleItem[]; next_billed_at: string | null } }).data;
      const now = sub.items.map((i) => planForPrice(i.price.id)).find((x) => x);
      if (!now) throw new Error('no plan item');
      const to = { plan: p.pending_plan as 'pro' | 'studio', billing: p.pending_billing as Billing };
      const sameBilling = now.billing === to.billing;
      const renewed = !sub.next_billed_at || new Date(sub.next_billed_at).getTime() - Date.now() > WINDOW_MS;
      // Yearly → monthly after the year already renewed: the new year is paid for, so the switch waits for
      // its end (the webhook moves current_period_end, and this runs again then).
      if (!sameBilling && renewed) continue;
      const mode = sameBilling ? (renewed ? 'prorated_immediately' : 'do_not_bill') : 'full_immediately';
      const res = await paddle(`/subscriptions/${p.paddle_subscription_id}`, {
        method: 'PATCH',
        body: JSON.stringify({ items: itemsFor(to, p.extra_seats ?? 0), proration_billing_mode: mode, on_payment_failure: 'prevent_change' }),
      });
      if (!res.ok) throw new Error(`change ${res.status} ${await res.text()}`);
      // The webhook brings the new plan; the change is done.
      await admin.from('profiles').update({ pending_plan: null, pending_billing: null }).eq('id', p.id);
      applied++;
    } catch (err) {
      // Tried again in 15 minutes while the window lasts.
      console.error('Plan change not applied', p.id, err);
    }
  }
  return new Response(JSON.stringify({ due: due?.length ?? 0, applied }), { headers: { 'Content-Type': 'application/json' } });
});
