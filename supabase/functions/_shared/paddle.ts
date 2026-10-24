// Paddle settings shared by the Edge Functions. Paddle is the merchant of record: it charges
// customers and handles sales tax and VAT worldwide.
import type { Billing, PlanId } from './plans.ts';

export const PADDLE_API =
  Deno.env.get('PADDLE_ENV') === 'production' ? 'https://api.paddle.com' : 'https://sandbox-api.paddle.com';

/**
 * Which plan each Paddle price is for, from the same price IDs the site uses. After a price rise, the old
 * prices go in PADDLE_LEGACY_PRICES ("pri_…:pro:monthly,pri_…:studio:yearly"): existing subscribers keep
 * paying them for as long as they stay subscribed.
 */
export function planForPrice(priceId: string | undefined): { plan: PlanId; billing: Billing } | null {
  const prices: Record<string, { plan: PlanId; billing: Billing }> = {};
  for (const plan of ['pro', 'studio'] as const) {
    for (const billing of ['monthly', 'yearly'] as const) {
      const id = Deno.env.get(`PADDLE_PRICE_${plan.toUpperCase()}_${billing.toUpperCase()}`);
      if (id) prices[id] = { plan, billing };
    }
  }
  for (const entry of (Deno.env.get('PADDLE_LEGACY_PRICES') ?? '').split(',')) {
    const [id, plan, billing] = entry.trim().split(':');
    if (id && (plan === 'pro' || plan === 'studio') && (billing === 'monthly' || billing === 'yearly')) prices[id] ??= { plan, billing };
  }
  return priceId ? (prices[priceId] ?? null) : null;
}

/** The current price of a plan (what new subscriptions and plan changes use). */
export function priceFor(plan: Exclude<PlanId, 'free'>, billing: Billing): string | undefined {
  return Deno.env.get(`PADDLE_PRICE_${plan.toUpperCase()}_${billing.toUpperCase()}`) || undefined;
}

/** Calls Paddle's API with our key. */
export function paddle(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${PADDLE_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${Deno.env.get('PADDLE_API_KEY')}`, 'Content-Type': 'application/json' },
  });
}

export interface PaddleItem {
  price: { id: string };
  quantity: number;
}

/**
 * When a plan change takes effect: upgrades (Pro → Studio) and monthly → yearly right away, prorated;
 * downgrades (Studio → Pro) and yearly → monthly at the end of the paid period.
 */
export function changeTiming(
  from: { plan: PlanId; billing: Billing },
  to: { plan: PlanId; billing: Billing },
): 'same' | 'now' | 'later' {
  if (from.plan === to.plan && from.billing === to.billing) return 'same';
  return (from.plan === 'studio' && to.plan === 'pro') || (from.billing === 'yearly' && to.billing === 'monthly') ? 'later' : 'now';
}

/**
 * The subscription's items on the new plan: the plan's price, and on Studio the extra seats at the new
 * billing's seat price (all items must share one billing cycle). Pro has no seats.
 */
export function itemsFor(to: { plan: Exclude<PlanId, 'free'>; billing: Billing }, extraSeats: number) {
  const plan = priceFor(to.plan, to.billing);
  if (!plan) throw new Error(`No price for ${to.plan} ${to.billing}`);
  const items = [{ price_id: plan, quantity: 1 }];
  const seat = seatPrice(to.billing);
  if (to.plan === 'studio' && extraSeats > 0) {
    if (!seat) throw new Error(`No seat price for ${to.billing}`);
    items.push({ price_id: seat, quantity: extraSeats });
  }
  return items;
}

/** Extra Studio seats: an item on the Studio subscription, billed like the plan (monthly or yearly). */
export function seatPrice(billing: Billing): string | undefined {
  return Deno.env.get(`PADDLE_PRICE_SEAT_${billing.toUpperCase()}`) || undefined;
}

export function isSeatPrice(priceId: string | undefined): boolean {
  return !!priceId && (priceId === seatPrice('monthly') || priceId === seatPrice('yearly'));
}
