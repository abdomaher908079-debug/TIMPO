// Paid NOWPayments orders: recording each payment's status and, once it's paid, turning on the plan or
// hour pack (once) and emailing a receipt. Used by nowpayments-webhook (NOWPayments' signed notices) and
// create-invoice's 'status' (asking NOWPayments directly, in case a notice is late or lost).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { button, DATE, p, send, sign, SITE } from './email.ts';
import { addMonths, type Billing, PACK, PRICE_USD } from './plans.ts';

const DAY = 86_400_000;
// 'confirmed': seen on the blockchain; 'finished': passed on to our wallet. Either means paid.
export const PAID = ['confirmed', 'finished'];
// Final states a later, older notice must not overwrite.
const SETTLED = [...PAID, 'refunded'];

export interface Order {
  status: string;
  id: string;
  user_id: string;
  kind: 'plan' | 'pack';
  plan: 'pro' | 'studio' | null;
  billing: Billing | null;
  price_usd: number;
  // Claimed for applying (set first) and really applied (set after).
  applied_at: string | null;
  done_at: string | null;
}

/** A payment's details from NOWPayments (its signed notice, or GET /v1/payment/:id). */
export interface PaymentInfo {
  payment_id?: unknown;
  payment_status?: unknown;
  price_amount?: unknown;
  price_currency?: unknown;
  actually_paid?: unknown;
}

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

interface PlanRow {
  plan: 'free' | 'pro' | 'studio';
  billing: Billing | null;
  subscription_status: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  extra_seats: number;
  paid_with: string | null;
  paid_from: string | null;
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
      .select('plan, billing, subscription_status, current_period_start, current_period_end, extra_seats, paid_with, paid_from, updated_at')
      .eq('id', order.user_id)
      .single<PlanRow>();
    if (readError || !p) throw readError ?? new Error('Profile not found.');
    const now = new Date();
    const running = p.plan !== 'free' && p.subscription_status === 'active' && !!p.current_period_end && new Date(p.current_period_end) > now;
    const same = running && p.plan === plan;
    let start = now;
    let end: Date;
    // From when the time is paid for: a plan we gave stays free up to its end, and only what's bought counts.
    let paidFrom = now;
    if (same) {
      // The same plan again: it runs on from the current end date.
      start = new Date(p.current_period_start ?? now);
      end = addMonths(new Date(p.current_period_end!), months);
      paidFrom = p.paid_with && p.paid_from ? new Date(p.paid_from) : new Date(p.current_period_end!);
    } else {
      // A different plan starts now. Paid days left on the old plan are kept, valued at what they cost; days
      // we gave for free aren't turned into paid time.
      const paidStart = p.paid_with && p.paid_from ? Math.max(now.getTime(), new Date(p.paid_from).getTime()) : null;
      const leftDays = running && paidStart !== null ? Math.max(0, new Date(p.current_period_end!).getTime() - paidStart) / DAY : 0;
      const credit = leftDays ? (leftDays * dayValue(p.plan as 'pro' | 'studio', p.billing)) / dayValue(plan, order.billing) : 0;
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
        paid_from: paidFrom.toISOString(),
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

/**
 * Records a payment's status on its order and, once paid in full, applies the order: claimed first so it
 * applies only once however many notices arrive, released again if applying fails so a retry can finish it.
 * Returns the order's status afterwards.
 */
export async function settle(order: Order, payment: PaymentInfo): Promise<string> {
  const status = String(payment.payment_status ?? '');
  if (!status) return order.status;
  if (!SETTLED.includes(order.status) || SETTLED.includes(status)) {
    await admin
      .from('crypto_orders')
      .update({
        status,
        payment_id: payment.payment_id ? String(payment.payment_id) : undefined,
        actually_paid: payment.actually_paid != null ? Number(payment.actually_paid) : undefined,
      })
      .eq('id', order.id);
  }
  if (!PAID.includes(status)) return status;
  // The payment must be for this order's price, in dollars.
  if (String(payment.price_currency ?? '').toLowerCase() !== 'usd' || Number(payment.price_amount) + 0.001 < Number(order.price_usd)) {
    console.error('Price mismatch', order.id, payment.price_amount, payment.price_currency);
    return status;
  }
  // Claim it: unclaimed, or claimed over 10 minutes ago without finishing (that try died half-way).
  const stale = new Date(Date.now() - 10 * 60_000).toISOString();
  const { data: claimed } = await admin
    .from('crypto_orders')
    .update({ applied_at: new Date().toISOString(), paid_at: new Date().toISOString() })
    .eq('id', order.id)
    .is('done_at', null)
    .or(`applied_at.is.null,applied_at.lt.${stale}`)
    .select('id');
  if (!claimed?.length) return status;
  let until: Date;
  try {
    until = order.kind === 'pack' ? await applyPack(order) : await applyPlan(order);
  } catch (err) {
    // Not applied: the next notice (or status check) tries again.
    await admin.from('crypto_orders').update({ applied_at: null }).eq('id', order.id);
    throw err;
  }
  await admin.from('crypto_orders').update({ done_at: new Date().toISOString() }).eq('id', order.id);
  // Applied for good from here: a failed receipt must never apply the order again.
  await receipt(order, until).catch((err) => console.error('Receipt', order.id, err));
  return status;
}
