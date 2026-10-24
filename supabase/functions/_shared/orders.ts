// Paid NOWPayments orders: recording each payment's status and, once it's paid, turning on the plan or
// hour pack (once) and emailing a receipt. Used by nowpayments-webhook (NOWPayments' signed notices) and
// create-invoice's 'status' (asking NOWPayments directly, in case a notice is late or lost).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { button, DATE, p, send, sign, SITE } from './email.ts';
import { addMonths, type Billing, MAX_EXTRA_SEATS, PACK, PRICE_USD } from './plans.ts';

const DAY = 86_400_000;
// 'confirmed': seen on the blockchain; 'finished': passed on to our wallet. Either means paid.
export const PAID = ['confirmed', 'finished'];
// Final states a later, older notice must not overwrite.
const SETTLED = [...PAID, 'refunded'];

/** A paid order that can't be applied any more (it's closed and refunded by hand). */
class CantApply extends Error {
  constructor(readonly problem: 'studio-ended') {
    super(problem);
  }
}

export interface Order {
  status: string;
  id: string;
  user_id: string;
  kind: 'plan' | 'pack' | 'seats';
  plan: 'pro' | 'studio' | null;
  billing: Billing | null;
  price_usd: number;
  // Studio people beyond the 3 included: the team size bought with a plan, or how many a 'seats' order adds.
  extra_seats: number;
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
        // Studio's team as bought (adding time to a running Studio keeps the team it has).
        extra_seats: plan === 'studio' ? (same ? p.extra_seats : order.extra_seats) : 0,
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

/**
 * Adds the bought people to the running Studio team, for the rest of the plan. Returns the plan's end.
 * The Studio may have ended (or changed) between ordering and the payment arriving: then nothing is added.
 */
async function applySeats(order: Order): Promise<Date> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: p, error: readError } = await admin
      .from('profiles')
      .select('plan, subscription_status, extra_seats, current_period_end, updated_at')
      .eq('id', order.user_id)
      .single<{ plan: string; subscription_status: string | null; extra_seats: number; current_period_end: string | null; updated_at: string }>();
    if (readError || !p) throw readError ?? new Error('Profile not found.');
    const now = new Date();
    const studio = p.plan === 'studio' && p.subscription_status === 'active' && !!p.current_period_end && new Date(p.current_period_end) > now;
    if (!studio) throw new CantApply('studio-ended');
    const { data: written, error } = await admin
      .from('profiles')
      .update({ extra_seats: Math.min(MAX_EXTRA_SEATS, p.extra_seats + order.extra_seats), updated_at: now.toISOString() })
      .eq('id', order.user_id)
      .eq('updated_at', p.updated_at)
      .select('id');
    if (error) throw error;
    if (written?.length) return new Date(p.current_period_end ?? now);
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
  if (order.kind === 'seats') {
    const people = `${order.extra_seats} more ${order.extra_seats === 1 ? 'person' : 'people'}`;
    await send(email, {
      subject: `Payment received: ${people} on your Isla team`,
      html: p('Hi,') + p(`Thanks! We received your payment of ${paid}. Your Studio team now has room for <b>${people}</b>, until your plan renews on <b>${when}</b>.`) + button('Invite them', `${SITE}/account`) + sign,
    });
    return;
  }
  const name = order.plan === 'pro' ? 'Pro' : 'Studio';
  const team = order.plan === 'studio' && order.extra_seats ? `, with a team of <b>${3 + order.extra_seats} people</b>,` : '';
  await send(email, {
    subject: `Payment received: Isla ${name} until ${when}`,
    html:
      p('Hi,') +
      p(`Thanks! We received your payment of ${paid}. Your Isla <b>${name}</b> plan${team} is active until <b>${when}</b>.`) +
      p("It doesn't renew on its own: we'll email you before it ends, and you can add more time from the pricing page whenever you like.") +
      button('Make clips', `${SITE}/new`) +
      sign,
  });
}

/** Tells the buyer, and us, that a paid order couldn't be applied and will be refunded. */
async function refundNotice(order: Order) {
  const { data } = await admin.auth.admin.getUserById(order.user_id);
  const email = data.user?.email;
  console.error('Refund due', order.id, email, order.price_usd);
  const people = `${order.extra_seats} more ${order.extra_seats === 1 ? 'person' : 'people'}`;
  if (email) {
    await send(email, {
      subject: 'Your Isla payment: we’ll refund it',
      html:
        p('Hi,') +
        p(`We received your payment of $${order.price_usd} for ${people} on your Studio team, but your Studio plan had ended before it arrived, so we couldn’t add them.`) +
        p('We’ll send the money back. Reply to this email with the wallet address (and network) to refund to, or tell us if you’d rather use it towards a new Studio plan.') +
        sign,
    });
  }
  await send('support@islaclips.com', {
    subject: `Refund due: order ${order.id}`,
    html: p(`A seats order was paid after the buyer’s Studio plan ended. Refund $${order.price_usd} to ${email ?? order.user_id}.`) + p(`Order: ${order.id}`),
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
    until = order.kind === 'pack' ? await applyPack(order) : order.kind === 'seats' ? await applySeats(order) : await applyPlan(order);
  } catch (err) {
    if (err instanceof CantApply) {
      // Closed for good (no retry), and both the buyer and we are told, so the money goes back.
      await admin.from('crypto_orders').update({ done_at: new Date().toISOString(), problem: err.problem }).eq('id', order.id);
      await refundNotice(order).catch((e) => console.error('Refund notice', order.id, e));
      return status;
    }
    // Not applied: the next notice (or status check) tries again.
    await admin.from('crypto_orders').update({ applied_at: null }).eq('id', order.id);
    throw err;
  }
  await admin.from('crypto_orders').update({ done_at: new Date().toISOString() }).eq('id', order.id);
  // Applied for good from here: a failed receipt must never apply the order again.
  await receipt(order, until).catch((err) => console.error('Receipt', order.id, err));
  return status;
}
