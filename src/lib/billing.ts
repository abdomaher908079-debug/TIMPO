import type { Billing, PlanId } from '../../supabase/functions/_shared/plans';
import { callFunction, supabase } from './supabase';

// Paddle price IDs for each paid plan, from the Paddle dashboard (Catalog → Products).
export const PRICE_IDS: Record<Exclude<PlanId, 'free'>, Record<Billing, string | undefined>> = {
  pro: {
    monthly: import.meta.env.VITE_PADDLE_PRICE_PRO_MONTHLY as string | undefined,
    yearly: import.meta.env.VITE_PADDLE_PRICE_PRO_YEARLY as string | undefined,
  },
  studio: {
    monthly: import.meta.env.VITE_PADDLE_PRICE_STUDIO_MONTHLY as string | undefined,
    yearly: import.meta.env.VITE_PADDLE_PRICE_STUDIO_YEARLY as string | undefined,
  },
};

// The one-time hour pack (+10 hours and +20 episodes).
export const PACK_PRICE_ID = import.meta.env.VITE_PADDLE_PRICE_HOURS_PACK as string | undefined;

export const paymentsReady = !!supabase && !!import.meta.env.VITE_PADDLE_CLIENT_TOKEN;

/** Opens Paddle's checkout for a plan, on its own page (see checkout.html). */
export function startCheckout(plan: Exclude<PlanId, 'free'>, billing: Billing) {
  window.location.assign(`/checkout.html?plan=${plan}&billing=${billing}`);
}

/** Opens Paddle's checkout for an hour pack. */
export function startPackCheckout() {
  window.location.assign('/checkout.html?pack=hours');
}

/** What changing to `extraSeats` would charge or credit right now (prorated, tax included). */
export async function previewExtraSeats(extraSeats: number): Promise<{ action: 'charge' | 'credit' | 'none'; amount: number; currency: string }> {
  return callFunction('team-seats', { extraSeats, preview: true });
}

/** Sets how many people a Studio owner can add beyond the 3 included; Paddle bills the difference now. */
export async function setExtraSeats(extraSeats: number): Promise<void> {
  await callFunction<{ extraSeats: number }>('team-seats', { extraSeats });
}

/** Opens Paddle's customer portal: card, invoices, monthly ↔ yearly, cancel. */
export async function openBillingPortal() {
  const { url } = await callFunction<{ url: string }>('billing-portal', {});
  window.location.assign(url);
}
