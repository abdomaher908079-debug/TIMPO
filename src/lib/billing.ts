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

export const paymentsReady = !!supabase && !!import.meta.env.VITE_PADDLE_CLIENT_TOKEN;

/** Opens Paddle's checkout for a plan, on its own page (see checkout.html). */
export function startCheckout(plan: Exclude<PlanId, 'free'>, billing: Billing) {
  window.location.assign(`/checkout.html?plan=${plan}&billing=${billing}`);
}

/** Opens Paddle's customer portal: card, invoices, monthly ↔ yearly, cancel. */
export async function openBillingPortal() {
  const { url } = await callFunction<{ url: string }>('billing-portal', {});
  window.location.assign(url);
}
