// Supabase Edge Function: switching plans for subscribers (Paddle's own billing page can't).
//   { action: 'change', plan, billing, preview? }
//     Upgrades (Pro → Studio) and monthly → yearly happen now, prorated: Paddle charges the difference for
//     the rest of the period. Downgrades (Studio → Pro) and yearly → monthly wait for the end of the paid
//     period (pending_plan; applied by apply-plan-changes). With preview: what it would cost, nothing changed:
//     { timing: 'now', action, amount, currency } or { timing: 'later', date }.
//   { action: 'keep' }  undoes a scheduled downgrade or cancellation.
// Secrets: PADDLE_API_KEY, PADDLE_ENV, PADDLE_PRICE_*
// Deploy: supabase functions deploy change-plan
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { changeTiming, itemsFor, paddle } from '../_shared/paddle.ts';
import { effectivePlan, type Billing, type ProfileRow } from '../_shared/plans.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

type Profile = ProfileRow & {
  paddle_subscription_id: string | null;
  extra_seats: number;
  pending_plan: 'pro' | 'studio' | null;
  pending_billing: Billing | null;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const token = req.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
    const { data: auth } = await admin.auth.getUser(token);
    if (!auth.user) return json({ error: 'Please sign in again.' }, 401);
    const userId = auth.user.id;

    const { data: profile } = await admin
      .from('profiles')
      .select('plan, billing, subscription_status, current_period_start, current_period_end, cancel_at, paddle_subscription_id, extra_seats, pending_plan, pending_billing')
      .eq('id', userId)
      .maybeSingle<Profile>();
    const current = profile ? effectivePlan(profile) : 'free';
    if (!profile || current === 'free' || !profile.paddle_subscription_id || !profile.billing) {
      return json({ error: 'You don’t have a plan to change. Choose one on the Pricing page.' }, 403);
    }
    const subPath = `/subscriptions/${profile.paddle_subscription_id}`;
    const body = (await req.json().catch(() => ({}))) as { action?: unknown; plan?: unknown; billing?: unknown; preview?: unknown };

    if (body.action === 'keep') {
      if (profile.cancel_at) {
        const res = await paddle(subPath, { method: 'PATCH', body: JSON.stringify({ scheduled_change: null }) });
        if (!res.ok) {
          console.error('Paddle keep plan', res.status, await res.text());
          return json({ error: 'We couldn’t keep your plan. Please try again.' }, 502);
        }
        const sub = ((await res.json()) as { data: { updated_at: string } }).data;
        await admin.from('profiles').update({ cancel_at: null, updated_at: sub.updated_at }).eq('id', userId);
      }
      await admin.from('profiles').update({ pending_plan: null, pending_billing: null }).eq('id', userId);
      return json({ ok: true });
    }

    if (body.action !== 'change') return json({ error: 'Unknown request.' }, 400);
    const plan = body.plan;
    const billing = body.billing;
    if ((plan !== 'pro' && plan !== 'studio') || (billing !== 'monthly' && billing !== 'yearly')) {
      return json({ error: 'Choose Pro or Studio, monthly or yearly.' }, 400);
    }
    if (profile.cancel_at) return json({ error: 'Your plan is set to end. Choose Keep my plan first, then change it.' }, 409);

    const from = { plan: current, billing: profile.billing };
    const timing = changeTiming(from, { plan, billing });
    if (timing === 'same') {
      // Choosing the plan you're on cancels a scheduled change.
      if (profile.pending_plan) await admin.from('profiles').update({ pending_plan: null, pending_billing: null }).eq('id', userId);
      return json({ timing: 'same' });
    }

    if (timing === 'later') {
      if (body.preview === true) return json({ timing, date: profile.current_period_end });
      await admin.from('profiles').update({ pending_plan: plan, pending_billing: billing }).eq('id', userId);
      return json({ timing, date: profile.current_period_end });
    }

    // Now: Paddle charges the difference for the rest of the period (or starts a new year, with credit
    // for what's left of the month).
    const change = {
      items: itemsFor({ plan, billing }, profile.extra_seats ?? 0),
      proration_billing_mode: 'prorated_immediately',
      on_payment_failure: 'prevent_change',
    };
    if (body.preview === true) {
      const res = await paddle(`${subPath}/preview`, { method: 'PATCH', body: JSON.stringify(change) });
      if (!res.ok) {
        console.error('Paddle plan preview', res.status, await res.text());
        return json({ error: 'Billing is unavailable right now. Please try again.' }, 502);
      }
      const data = (await res.json()) as { data: { currency_code: string; update_summary?: { result?: { action?: string; amount?: string } } | null } };
      const result = data.data.update_summary?.result;
      return json({
        timing,
        action: result?.action === 'charge' || result?.action === 'credit' ? result.action : 'none',
        amount: Number(result?.amount ?? 0) / 100,
        currency: data.data.currency_code,
      });
    }
    const res = await paddle(subPath, { method: 'PATCH', body: JSON.stringify(change) });
    if (!res.ok) {
      const detail = await res.text();
      console.error('Paddle plan change', res.status, detail);
      const declined = /payment|declin/i.test(detail);
      return json(
        { error: declined ? 'Your card was declined. Update it, then try again.' : 'We couldn’t change your plan. Please try again.' },
        declined ? 402 : 502,
      );
    }
    const sub = (
      (await res.json()) as { data: { updated_at: string; current_billing_period?: { starts_at: string; ends_at: string } | null } }
    ).data;
    // Shown straight away; the webhook confirms the same.
    await admin
      .from('profiles')
      .update({
        plan,
        billing,
        extra_seats: plan === 'studio' ? (profile.extra_seats ?? 0) : 0,
        pending_plan: null,
        pending_billing: null,
        current_period_start: sub.current_billing_period?.starts_at ?? profile.current_period_start,
        current_period_end: sub.current_billing_period?.ends_at ?? profile.current_period_end,
        updated_at: sub.updated_at,
      })
      .eq('id', userId);
    return json({ timing });
  } catch (err) {
    console.error(err);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
});
