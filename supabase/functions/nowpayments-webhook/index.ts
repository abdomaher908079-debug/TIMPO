// Supabase Edge Function: NOWPayments' payment notifications (IPN). A signed POST for each status change;
// once an order is paid ('confirmed' or 'finished') its plan or hour pack is applied, once, and the
// buyer gets an email. The signature is HMAC-SHA512 of the body with its keys sorted, using the IPN
// secret from NOWPayments (Settings → Payments → Instant payment notifications).
// Secrets: NOWPAYMENTS_IPN_SECRET. Deploy: supabase functions deploy nowpayments-webhook --no-verify-jwt
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { button, DATE, p, send, sign, SITE } from '../_shared/email.ts';
import { type Billing, PACK, PRICE_USD } from '../_shared/plans.ts';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = 86_400_000;
const PAID = ['confirmed', 'finished'];

interface Order {
  id: string;
  user_id: string;
  kind: 'plan' | 'pack';
  plan: 'pro' | 'studio' | null;
  billing: Billing | null;
  price_usd: number;
  applied_at: string | null;
}

/** The body with every object's keys sorted, exactly as NOWPayments' own example does it (arrays included). */
function sorted(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) out[k] = sorted(obj[k]);
  return out;
}

async function signatureOk(body: unknown, sig: string, secret: string): Promise<boolean> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(JSON.stringify(sorted(body)))));
  const hex = Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('');
  if (hex.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

function addMonths(from: Date, months: number): Date {
  const d = new Date(from);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

interface PlanRow {
  plan: 'free' | 'pro' | 'studio';
  billing: Billing | null;
  subscription_status: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  extra_seats: number;
  paid_with: string | null;
  updated_at: string | null;
}

/** What one day of a paid plan is worth, at the price it was bought at. */
const dayValue = (plan: 'pro' | 'studio', billing: Billing | null) =>
  billing === 'yearly' ? PRICE_USD[plan].yearly / 365 : PRICE_USD[plan].monthly / 30;

/**
 * Turns on (or extends) the bought plan. Returns its new end date. The profile is written only if it hasn't
 * changed since it was read (updated_at), so two orders paid at the same moment both count.
 */
async function applyPlan(order: Order): Promise<Date> {
  const plan = order.plan!;
  const months = order.billing === 'yearly' ? 12 : 1;
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: p, error: readError } = await admin
      .from('profiles')
      .select('plan, billing, subscription_status, current_period_start, current_period_end, extra_seats, paid_with, updated_at')
      .eq('id', order.user_id)
      .single<PlanRow>();
    if (readError || !p) throw readError ?? new Error('Profile not found.');
    const now = new Date();
    const running = p.plan !== 'free' && p.subscription_status === 'active' && !!p.current_period_end && new Date(p.current_period_end) > now;
    const same = running && p.plan === plan;
    let start = now;
    let end: Date;
    if (same) {
      // The same plan again: it runs on from the current end date.
      start = new Date(p.current_period_start ?? now);
      end = addMonths(new Date(p.current_period_end!), months);
    } else {
      // A different plan starts now. Days left on a plan that was paid for are kept, valued at what they cost;
      // a plan we gave for free isn't turned into paid time.
      const paidLeft = running && p.paid_with === 'nowpayments';
      const leftDays = paidLeft ? (new Date(p.current_period_end!).getTime() - now.getTime()) / DAY : 0;
      const credit = paidLeft ? (leftDays * dayValue(p.plan as 'pro' | 'studio', p.billing)) / dayValue(plan, order.billing) : 0;
      end = new Date(addMonths(now, months).getTime() + Math.round(credit * DAY));
    }
    let update = admin
      .from('profiles')
      .update({
        plan,
        billing: same && p.billing === 'yearly' ? 'yearly' : order.billing,
        subscription_status: 'active',
        current_period_start: start.toISOString(),
        current_period_end: end.toISOString(),
        cancel_at: null,
        pending_plan: null,
        pending_billing: null,
        extra_seats: same && plan === 'studio' ? p.extra_seats : 0,
        paid_with: 'nowpayments',
        // An ended Paddle subscription (create-invoice refuses live ones) no longer applies.
        paddle_subscription_id: null,
        updated_at: now.toISOString(),
      })
      .eq('id', order.user_id);
    update = p.updated_at ? update.eq('updated_at', p.updated_at) : update.is('updated_at', null);
    const { data: written, error } = await update.select('id');
    if (error) throw error;
    if (written?.length) return end;
  }
  throw new Error('Profile kept changing; try again.');
}

async function applyPack(order: Order): Promise<Date> {
  const until = new Date(Date.now() + PACK.days * DAY);
  const { error } = await admin.from('hour_packs').upsert(
    {
      workspace_id: order.user_id,
      transaction_id: `np-${order.id}`,
      seconds: PACK.hours * 3600,
      episodes: PACK.episodes,
      seconds_left: PACK.hours * 3600,
      episodes_left: PACK.episodes,
      expires_at: until.toISOString(),
    },
    { onConflict: 'transaction_id', ignoreDuplicates: true },
  );
  if (error) throw error;
  return until;
}

async function receipt(order: Order, until: Date) {
  const { data } = await admin.auth.admin.getUserById(order.user_id);
  const email = data.user?.email;
  if (!email) return;
  const when = DATE.format(until);
  const paid = `$${order.price_usd}`;
  if (order.kind === 'pack') {
    await send(email, {
      subject: 'Payment received: Isla extra hours',
      html: p('Hi,') + p(`Thanks! We received your payment of ${paid}. You now have <b>+${PACK.hours} hours and +${PACK.episodes} episodes</b>, usable until <b>${when}</b>.`) + button('Make clips', `${SITE}/new`) + sign,
    });
    return;
  }
  const name = order.plan === 'pro' ? 'Pro' : 'Studio';
  await send(email, {
    subject: `Payment received: Isla ${name} until ${when}`,
    html:
      p('Hi,') +
      p(`Thanks! We received your payment of ${paid}. Your Isla <b>${name}</b> plan is active until <b>${when}</b>.`) +
      p("It doesn't renew on its own: we'll email you before it ends, and you can add more time from the pricing page whenever you like.") +
      button('Make clips', `${SITE}/new`) +
      sign,
  });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('ok');
  const secret = Deno.env.get('NOWPAYMENTS_IPN_SECRET');
  const sig = req.headers.get('x-nowpayments-sig') ?? '';
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!secret || !body || !sig || !(await signatureOk(body, sig.toLowerCase(), secret))) return new Response('Bad signature', { status: 401 });

  try {
    const orderId = String(body.order_id ?? '');
    const status = String(body.payment_status ?? '');
    if (!UUID.test(orderId)) return new Response('ok');
    const { data: order } = await admin.from('crypto_orders').select('*').eq('id', orderId).maybeSingle<Order>();
    if (!order) return new Response('ok');
    await admin.from('crypto_orders').update({ status, payment_id: body.payment_id ? String(body.payment_id) : null }).eq('id', order.id);

    if (!PAID.includes(status)) return new Response('ok');
    // The invoice must be for this order's price, in dollars.
    if (String(body.price_currency ?? '').toLowerCase() !== 'usd' || Number(body.price_amount) + 0.001 < Number(order.price_usd)) {
      console.error('Price mismatch', order.id, body.price_amount, body.price_currency);
      return new Response('ok');
    }
    // Claim the order, so a repeated notification never applies it twice.
    const { data: claimed } = await admin
      .from('crypto_orders')
      .update({ applied_at: new Date().toISOString(), paid_at: new Date().toISOString() })
      .eq('id', order.id)
      .is('applied_at', null)
      .select('id');
    if (!claimed?.length) return new Response('ok');
    let until: Date;
    try {
      until = order.kind === 'pack' ? await applyPack(order) : await applyPlan(order);
    } catch (err) {
      // Not applied: let NOWPayments send it again.
      await admin.from('crypto_orders').update({ applied_at: null }).eq('id', order.id);
      throw err;
    }
    // Applied for good from here: a failed receipt must never apply the order again.
    await receipt(order, until).catch((err) => console.error('Receipt', order.id, err));
    return new Response('ok');
  } catch (err) {
    console.error(err);
    return new Response('error', { status: 500 });
  }
});
