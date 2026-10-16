// Paddle settings shared by the Edge Functions. Paddle is the merchant of record: it charges
// customers and handles sales tax and VAT worldwide.
import type { Billing, PlanId } from './plans.ts';

export const PADDLE_API =
  Deno.env.get('PADDLE_ENV') === 'production' ? 'https://api.paddle.com' : 'https://sandbox-api.paddle.com';

/** Which plan each Paddle price is for, from the same price IDs the site uses. */
export function planForPrice(priceId: string | undefined): { plan: PlanId; billing: Billing } | null {
  const prices: Record<string, { plan: PlanId; billing: Billing }> = {};
  for (const plan of ['pro', 'studio'] as const) {
    for (const billing of ['monthly', 'yearly'] as const) {
      const id = Deno.env.get(`PADDLE_PRICE_${plan.toUpperCase()}_${billing.toUpperCase()}`);
      if (id) prices[id] = { plan, billing };
    }
  }
  return priceId ? (prices[priceId] ?? null) : null;
}

/** Extra Studio seats: an item on the Studio subscription, billed like the plan (monthly or yearly). */
export function seatPrice(billing: Billing): string | undefined {
  return Deno.env.get(`PADDLE_PRICE_SEAT_${billing.toUpperCase()}`) || undefined;
}

export function isSeatPrice(priceId: string | undefined): boolean {
  return !!priceId && (priceId === seatPrice('monthly') || priceId === seatPrice('yearly'));
}
