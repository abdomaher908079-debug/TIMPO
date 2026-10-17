// Supabase Edge Function: POST { extraSeats, preview? } → { extraSeats } (or, with preview, what changing
// now would charge or credit: { action: 'charge' | 'credit' | 'none', amount, currency }, nothing changed). Sets how many people a Studio owner
// can add beyond the 3 included, as an extra item on their Paddle subscription ($8 a month each, or
// $80 a year on yearly plans). Paddle charges or credits the difference for the rest of the period
// right away; paddle-webhook then confirms the new count.
// Secrets: PADDLE_API_KEY, PADDLE_ENV, PADDLE_PRICE_SEAT_{MONTHLY,YEARLY}
// Deploy: supabase functions deploy team-seats
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { PADDLE_API, seatPrice } from '../_shared/paddle.ts';
import { effectivePlan, type ProfileRow } from '../_shared/plans.ts';

// Studio: 3 people included, up to 10 in all.
const MAX_EXTRA_SEATS = 7;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

async function paddle(path: string, init: RequestInit = {}) {
  return fetch(`${PADDLE_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${Deno.env.get('PADDLE_API_KEY')}`, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const token = req.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
    const { data: auth } = await admin.auth.getUser(token);
    if (!auth.user) return json({ error: 'Please sign in again.' }, 401);

    const body = (await req.json().catch(() => ({}))) as { extraSeats?: unknown; preview?: unknown };
    const preview = body.preview === true;
    const extraSeats = Number(body.extraSeats);
    if (!Number.isInteger(extraSeats) || extraSeats < 0 || extraSeats > MAX_EXTRA_SEATS) {
      return json({ error: `A Studio team can have up to ${MAX_EXTRA_SEATS} extra seats.` }, 400);
    }

    const { data: profile } = await admin
      .from('profiles')
      .select('plan, billing, subscription_status, current_period_start, current_period_end, cancel_at, paddle_subscription_id, extra_seats')
      .eq('id', auth.user.id)
      .maybeSingle<ProfileRow & { paddle_subscription_id: string | null; extra_seats: number }>();
    if (!profile || effectivePlan(profile) !== 'studio' || !profile.paddle_subscription_id || !profile.billing) {
      return json({ error: 'Extra seats are part of the Studio plan.' }, 403);
    }
    if (profile.cancel_at) return json({ error: 'Your plan is canceled. Renew it in Manage billing to change your team.' }, 409);
    if (extraSeats === profile.extra_seats) return json({ extraSeats });

    // Never fewer seats than people already invited or in the team.
    const { count } = await admin.from('team_members').select('id', { count: 'exact', head: true }).eq('owner_id', auth.user.id);
    if ((count ?? 0) > 2 + extraSeats) {
      return json({ error: 'Remove someone from your team first, then remove the seat.' }, 409);
    }

    const seat = seatPrice(profile.billing);
    if (!seat) return json({ error: 'Extra seats aren’t set up yet.' }, 503);
    const current = await paddle(`/subscriptions/${profile.paddle_subscription_id}`);
    if (!current.ok) {
      console.error('Paddle subscription', current.status, await current.text());
      return json({ error: 'Billing is unavailable right now. Please try again.' }, 502);
    }
    const sub = ((await current.json()) as { data: { items: { price: { id: string }; quantity: number }[] } }).data;
    // Keep the plan's item; replace any seat item (monthly or yearly) with the new count.
    const items = sub.items
      .filter((i) => i.price.id !== seatPrice('monthly') && i.price.id !== seatPrice('yearly'))
      .map((i) => ({ price_id: i.price.id, quantity: i.quantity }));
    if (extraSeats > 0) items.push({ price_id: seat, quantity: extraSeats });

    const change = { items, proration_billing_mode: 'prorated_immediately', on_payment_failure: 'prevent_change' };
    if (preview) {
      // Paddle works out the exact prorated amount, tax included, without changing anything.
      const res = await paddle(`/subscriptions/${profile.paddle_subscription_id}/preview`, { method: 'PATCH', body: JSON.stringify(change) });
      if (!res.ok) {
        console.error('Paddle seat preview', res.status, await res.text());
        return json({ error: 'Billing is unavailable right now. Please try again.' }, 502);
      }
      const data = (await res.json()) as {
        data: { currency_code: string; update_summary?: { result?: { action?: string; amount?: string } } | null };
      };
      const result = data.data.update_summary?.result;
      return json({
        action: result?.action === 'charge' || result?.action === 'credit' ? result.action : 'none',
        amount: Number(result?.amount ?? 0) / 100,
        currency: data.data.currency_code,
      });
    }
    const res = await paddle(`/subscriptions/${profile.paddle_subscription_id}`, { method: 'PATCH', body: JSON.stringify(change) });
    if (!res.ok) {
      const detail = await res.text();
      console.error('Paddle seat change', res.status, detail);
      const declined = /payment|declin/i.test(detail);
      return json(
        { error: declined ? 'Your card was declined. Update it in Manage billing, then try again.' : 'We couldn’t change your seats. Please try again.' },
        declined ? 402 : 502,
      );
    }
    const updated = ((await res.json()) as { data: { updated_at: string } }).data;
    // Shown straight away; the webhook confirms the same count.
    await admin.from('profiles').update({ extra_seats: extraSeats, updated_at: updated.updated_at }).eq('id', auth.user.id);
    return json({ extraSeats });
  } catch (err) {
    console.error(err);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
});
