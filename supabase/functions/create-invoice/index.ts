// Supabase Edge Function: payments with NOWPayments, for our own checkout page (/pay).
//   { action: 'start', kind: 'plan', plan, billing, coin } or { action: 'start', kind: 'pack', coin }
//     → a new order and its payment: the exact amount to send, the address, until when the price holds.
//   { action: 'status', order } → that order (the signed-in user's own), its payment checked with
//     NOWPayments, and applied if it's paid (in case NOWPayments' notice is late or lost).
//   { action: 'invoice', kind, plan, billing } → NOWPayments' own payment page, for any other coin.
// Called only through the site's /api/create-invoice (functions/api/create-invoice.ts), which adds the
// buyer's country from Cloudflare and the shared GEO_SECRET. Paid plans aren't sold in Russia, so a
// missing or Russian country is refused here too.
// Secrets: NOWPAYMENTS_API_KEY, GEO_SECRET. Deploy: supabase functions deploy create-invoice
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { canBuyFrom, NOT_SOLD_HERE } from '../_shared/countries.ts';
import { SITE } from '../_shared/email.ts';
import { type Order, settle } from '../_shared/orders.ts';
import { type Billing, PACK, PRICE_USD } from '../_shared/plans.ts';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

const API = 'https://api.nowpayments.io/v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The coins our checkout page offers (NOWPayments' codes); anything else goes through 'invoice'.
const COINS = ['usdttrc20', 'usdtbsc', 'btc'];

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
    status,
    applied: !!o.applied_at,
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
    const action = String(body.action ?? 'invoice');

    if (action === 'status') {
      const id = String(body.order ?? '');
      if (!UUID.test(id)) return json({ error: 'Order not found.' }, 404);
      const { data: o } = await admin.from('crypto_orders').select('*').eq('id', id).eq('user_id', user.id).maybeSingle<OrderRow>();
      if (!o) return json({ error: 'Order not found.' }, 404);
      if (o.payment_id && !o.applied_at) {
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
    if (action !== 'start' && action !== 'invoice') return json({ error: 'Unknown request.' }, 400);

    // Team members use their owner's plan; only the owner buys.
    const { data: team } = await admin.from('team_members').select('owner_id').eq('user_id', user.id).eq('status', 'active').limit(1).maybeSingle();
    if (team) return json({ error: 'Your team owner manages the plan.' }, 400);
    const { data: profile } = await admin
      .from('profiles')
      .select('plan, subscription_status, paddle_subscription_id')
      .eq('id', user.id)
      .maybeSingle<{ plan: string; subscription_status: string | null; paddle_subscription_id: string | null }>();
    // A live Paddle subscription is changed in Paddle; an ended one (canceled) doesn't matter here.
    if (profile?.paddle_subscription_id && ['active', 'trialing', 'past_due'].includes(profile.subscription_status ?? '')) {
      return json({ error: 'Your plan is billed through Paddle. Manage it in Plan & settings.' }, 400);
    }

    let order: { kind: 'plan' | 'pack'; plan: 'pro' | 'studio' | null; billing: Billing | null; price: number; description: string };
    if (body.kind === 'pack') {
      // Bought hour packs work only on Pro or Studio, so they're sold only there.
      if (!profile || profile.plan === 'free' || profile.subscription_status !== 'active') return json({ error: 'Extra hours are for Pro and Studio.' }, 400);
      order = { kind: 'pack', plan: null, billing: null, price: PACK.price, description: `Isla extra hours: +${PACK.hours} hours, +${PACK.episodes} episodes` };
    } else {
      const plan = body.plan === 'pro' || body.plan === 'studio' ? body.plan : null;
      const billing = body.billing === 'monthly' || body.billing === 'yearly' ? body.billing : null;
      if (!plan || !billing) return json({ error: 'Choose a plan.' }, 400);
      const name = plan === 'pro' ? 'Pro' : 'Studio';
      order = { kind: 'plan', plan, billing, price: PRICE_USD[plan][billing], description: `Isla ${name}, 1 ${billing === 'yearly' ? 'year' : 'month'}` };
    }
    const coin = String(body.coin ?? '');
    if (action === 'start' && !COINS.includes(coin)) return json({ error: 'Choose how to pay.' }, 400);

    const { data: row, error } = await admin
      .from('crypto_orders')
      .insert({ user_id: user.id, kind: order.kind, plan: order.plan, billing: order.billing, price_usd: order.price, country })
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

    if (action === 'invoice') {
      const res = await fetch(`${API}/invoice`, {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...common, success_url: `${SITE}/pay?order=${row.id}`, cancel_url: `${SITE}/pricing` }),
      });
      const invoice = (await res.json().catch(() => ({}))) as { id?: string | number; invoice_url?: string };
      if (!res.ok || !invoice.invoice_url) {
        console.error('NOWPayments invoice', res.status, invoice);
        await admin.from('crypto_orders').update({ status: 'failed' }).eq('id', row.id);
        return json({ error: "Couldn't start the payment. Try again in a minute." }, 502);
      }
      await admin.from('crypto_orders').update({ invoice_id: String(invoice.id ?? '') }).eq('id', row.id);
      return json({ url: invoice.invoice_url, order: row.id });
    }

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
        price_expires_at: payment.expiration_estimate_date ? String(payment.expiration_estimate_date) : null,
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
