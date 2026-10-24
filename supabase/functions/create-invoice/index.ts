// Supabase Edge Function: payments with NOWPayments, for our own checkout page (/pay).
//   { action: 'start', kind: 'plan', plan, billing, coin } or { action: 'start', kind: 'pack', coin }
//     → a new order and its payment: the exact amount to send, the address, until when the price holds.
//   { action: 'status', order } → that order (the signed-in user's own), its payment checked with
//     NOWPayments, and applied if it's paid (in case NOWPayments' notice is late or lost).
// Called only through the site's /api/create-invoice (functions/api/create-invoice.ts), which adds the
// buyer's country from Cloudflare and the shared GEO_SECRET. Paid plans aren't sold in Russia, so a
// missing or Russian country is refused here too.
// Secrets: NOWPAYMENTS_API_KEY, GEO_SECRET. Deploy: supabase functions deploy create-invoice
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { canBuyFrom, NOT_SOLD_HERE } from '../_shared/countries.ts';
import { type Order, settle } from '../_shared/orders.ts';
import { type Billing, CRYPTO_MIN_USD, MAX_EXTRA_SEATS, PACK, PRICE_USD, SEAT_USD, seatsForRest } from '../_shared/plans.ts';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

const API = 'https://api.nowpayments.io/v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The coins our checkout page offers (NOWPayments' codes): USDT only, whose sending fees fit SHORT_OK_USD.
const COINS = ['usdttrc20', 'usdtbsc'];
// How long the checkout page shows an order's amount and address before asking for a new one. NOWPayments'
// own rate estimate can be shorter, but these are USDT (a dollar coin), so the amount barely moves meanwhile and
// SHORT_OK_USD covers any difference; a payment that arrives later is still credited.
const PAY_WINDOW_MS = 30 * 60_000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

interface OrderRow extends Order {
  pay_currency: string | null;
  pay_amount: number | null;
  pay_address: string | null;
  payin_extra_id: string | null;
  price_expires_at: string | null;
  actually_paid: number | null;
  payment_id: string | null;
  problem: string | null;
}

/** What the checkout page shows of an order. */
function view(o: OrderRow, status = o.status) {
  return {
    id: o.id,
    kind: o.kind,
    plan: o.plan,
    billing: o.billing,
    price: Number(o.price_usd),
    coin: o.pay_currency,
    amount: o.pay_amount != null ? Number(o.pay_amount) : null,
    address: o.pay_address,
    memo: o.payin_extra_id,
    priceUntil: o.price_expires_at,
    received: o.actually_paid != null ? Number(o.actually_paid) : 0,
    seats: o.extra_seats ?? 0,
    status,
    applied: !!o.done_at,
    problem: o.problem,
  };
}

Deno.serve(async (req) => {
  try {
    const geoSecret = Deno.env.get('GEO_SECRET');
    if (!geoSecret || req.headers.get('x-geo-secret') !== geoSecret) return json({ error: 'Not allowed.' }, 403);
    const country = (req.headers.get('x-isla-country') ?? '').toUpperCase();
    if (!canBuyFrom(country)) return json({ error: NOT_SOLD_HERE, reason: 'country' }, 451);

    const apiKey = Deno.env.get('NOWPAYMENTS_API_KEY');
    if (!apiKey) return json({ error: 'Payments are not open yet.' }, 503);

    const token = req.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
    const { data: auth } = await admin.auth.getUser(token);
    const user = auth.user;
    if (!user) return json({ error: 'Sign in first.' }, 401);

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? '');

    if (action === 'status') {
      const id = String(body.order ?? '');
      if (!UUID.test(id)) return json({ error: 'Order not found.' }, 404);
      const { data: o } = await admin.from('crypto_orders').select('*').eq('id', id).eq('user_id', user.id).maybeSingle<OrderRow>();
      if (!o) return json({ error: 'Order not found.' }, 404);
      if (o.payment_id && !o.done_at) {
        // Ask NOWPayments directly; settle() records it and applies a paid order (once).
        const res = await fetch(`${API}/payment/${encodeURIComponent(o.payment_id)}`, { headers: { 'x-api-key': apiKey } });
        if (res.ok) {
          const status = await settle(o, (await res.json()) as Record<string, unknown>);
          const { data: fresh } = await admin.from('crypto_orders').select('*').eq('id', id).single<OrderRow>();
          return json({ order: view(fresh ?? o, status) });
        }
      }
      return json({ order: view(o) });
    }
    if (action !== 'start') return json({ error: 'Unknown request.' }, 400);

    // Members of a team whose owner has Studio use the owner's plan; only the owner buys. (A team whose owner's
    // Studio has ended doesn't count, as in workspace_of.)
    const { data: ws } = await admin.rpc('workspace_of', { uid: user.id }).maybeSingle<{ is_team_member: boolean }>();
    if (ws?.is_team_member) return json({ error: 'Your team owner manages the plan.' }, 400);
    const { data: profile } = await admin
      .from('profiles')
      .select('plan, billing, subscription_status, current_period_end, extra_seats, paddle_subscription_id')
      .eq('id', user.id)
      .maybeSingle<{
        plan: string;
        billing: Billing | null;
        subscription_status: string | null;
        current_period_end: string | null;
        extra_seats: number;
        paddle_subscription_id: string | null;
      }>();
    // A live Paddle subscription is changed in Paddle; an ended one (canceled) doesn't matter here.
    if (profile?.paddle_subscription_id && ['active', 'trialing', 'past_due'].includes(profile.subscription_status ?? '')) {
      return json({ error: 'Your plan is billed through Paddle. Manage it in Plan & settings.' }, 400);
    }

    let order: { kind: 'plan' | 'pack' | 'seats'; plan: 'pro' | 'studio' | null; billing: Billing | null; price: number; seats: number; description: string };
    const running = !!profile && profile.plan !== 'free' && profile.subscription_status === 'active' && !!profile.current_period_end &&
      new Date(profile.current_period_end) > new Date();
    if (body.kind === 'seats') {
      // More people for the rest of a running Studio plan.
      if (!running || profile!.plan !== 'studio') return json({ error: 'Extra people are for Studio.' }, 400);
      const count = Math.round(Number(body.seats));
      if (!(count >= 1 && profile!.extra_seats + count <= MAX_EXTRA_SEATS)) return json({ error: `A Studio team can have up to ${3 + MAX_EXTRA_SEATS} people.` }, 400);
      const price = seatsForRest(count, profile!.billing, new Date(profile!.current_period_end!));
      if (price < CRYPTO_MIN_USD) {
        return json({ error: `That's $${price.toFixed(2)}, below the $${CRYPTO_MIN_USD} minimum for crypto payments. Add more people at once, or choose your team size when you renew.` }, 400);
      }
      order = { kind: 'seats', plan: null, billing: null, price, seats: count, description: `Isla Studio: ${count} more ${count === 1 ? 'person' : 'people'} until your plan renews` };
    } else if (body.kind === 'pack') {
      // Bought hour packs work only on Pro or Studio, so they're sold only there.
      if (!running) return json({ error: 'Extra hours are for Pro and Studio.' }, 400);
      order = { kind: 'pack', plan: null, billing: null, price: PACK.price, seats: 0, description: `Isla extra hours: +${PACK.hours} hours, +${PACK.episodes} episodes` };
    } else {
      const plan = body.plan === 'pro' || body.plan === 'studio' ? body.plan : null;
      const billing = body.billing === 'monthly' || body.billing === 'yearly' ? body.billing : null;
      if (!plan || !billing) return json({ error: 'Choose a plan.' }, 400);
      const name = plan === 'pro' ? 'Pro' : 'Studio';
      // Studio's team size is paid with the plan. Adding time to a running Studio keeps its team as it is
      // (more people are added on their own, for the rest of the plan).
      let seats = 0;
      if (plan === 'studio') {
        seats = running && profile!.plan === 'studio' ? profile!.extra_seats : Math.round(Number(body.seats ?? 0));
        if (!(seats >= 0 && seats <= MAX_EXTRA_SEATS)) return json({ error: `A Studio team can have up to ${3 + MAX_EXTRA_SEATS} people.` }, 400);
      }
      const team = seats ? `, team of ${3 + seats}` : '';
      order = {
        kind: 'plan',
        plan,
        billing,
        price: PRICE_USD[plan][billing] + seats * SEAT_USD[billing],
        seats,
        description: `Isla ${name}, 1 ${billing === 'yearly' ? 'year' : 'month'}${team}`,
      };
    }
    const coin = String(body.coin ?? '');
    if (!COINS.includes(coin)) return json({ error: 'Choose how to pay.' }, 400);

    const { data: row, error } = await admin
      .from('crypto_orders')
      .insert({ user_id: user.id, kind: order.kind, plan: order.plan, billing: order.billing, price_usd: order.price, extra_seats: order.seats, country })
      .select('*')
      .single<OrderRow>();
    if (error || !row) throw error ?? new Error('Order not saved.');
    const common = {
      price_amount: order.price,
      price_currency: 'usd',
      order_id: row.id,
      order_description: order.description,
      ipn_callback_url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/nowpayments-webhook`,
      // No fixed rate: NOWPayments' minimum with a fixed rate (about $20 in USDT) is above our $14–15 prices.
    };

    const res = await fetch(`${API}/payment`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...common, pay_currency: coin }),
    });
    const payment = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || !payment.pay_address || !payment.pay_amount) {
      console.error('NOWPayments payment', res.status, payment);
      await admin.from('crypto_orders').update({ status: 'failed' }).eq('id', row.id);
      const tooSmall = /small|minimal/i.test(String(payment.message ?? ''));
      return json(
        {
          error: tooSmall
            ? 'This amount is below the minimum for that coin right now. Go back and choose USDT on Tron.'
            : "Couldn't start the payment. Try again in a minute.",
        },
        502,
      );
    }
    const { data: saved } = await admin
      .from('crypto_orders')
      .update({
        payment_id: String(payment.payment_id),
        status: String(payment.payment_status ?? 'waiting'),
        pay_currency: coin,
        pay_amount: Number(payment.pay_amount),
        pay_address: String(payment.pay_address),
        payin_extra_id: payment.payin_extra_id ? String(payment.payin_extra_id) : null,
        price_expires_at: new Date(Date.now() + PAY_WINDOW_MS).toISOString(),
      })
      .eq('id', row.id)
      .select('*')
      .single<OrderRow>();
    return json({ order: view(saved ?? row) });
  } catch (err) {
    console.error(err);
    return json({ error: 'Something went wrong. Try again.' }, 500);
  }
});
