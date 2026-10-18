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

// New purchases open only when VITE_PAYMENTS_OPEN=true; until then paid plans show "Coming soon".
export const paymentsOpen = import.meta.env.VITE_PAYMENTS_OPEN === 'true';
export const paymentsReady = paymentsOpen && !!supabase && !!import.meta.env.VITE_PADDLE_CLIENT_TOKEN;

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

/** Opens Paddle's customer portal: card, invoices, cancel. `payment` goes straight to updating the card. */
export async function openBillingPortal(target?: 'payment') {
  const { url } = await callFunction<{ url: string }>('billing-portal', target ? { target } : {});
  window.location.assign(url);
}

type PaidPlan = Exclude<PlanId, 'free'>;
type PlanQuote =
  | { timing: 'same' }
  | { timing: 'now'; action: 'charge' | 'credit' | 'none'; amount: number; currency: string }
  | { timing: 'later'; date: string | null };

const NAMES: Record<PaidPlan, string> = { pro: 'Pro', studio: 'Studio' };
const PRICES: Record<PaidPlan, Record<Billing, string>> = {
  pro: { monthly: '$15 a month', yearly: '$144 a year' },
  studio: { monthly: '$29 a month', yearly: '$288 a year' },
};
const DAY = new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric', year: 'numeric' });

/**
 * Switches a subscriber's plan after showing exactly what happens: upgrades and monthly → yearly now with
 * the prorated amount from Paddle, downgrades and yearly → monthly at the end of the paid period.
 * Resolves true when something changed.
 */
export async function switchPlan(plan: PaidPlan, billing: Billing, opts: { hasTeam: boolean }): Promise<boolean> {
  const quote = await callFunction<PlanQuote>('change-plan', { action: 'change', plan, billing, preview: true });
  if (quote.timing === 'same') {
    await callFunction('change-plan', { action: 'change', plan, billing });
    return true;
  }
  const target = `${NAMES[plan]} ${billing}`;
  let text: string;
  if (quote.timing === 'now') {
    const money = new Intl.NumberFormat(undefined, { style: 'currency', currency: quote.currency || 'USD' }).format(quote.amount);
    text =
      `Switch to ${target} now?\n\n` +
      (quote.action === 'charge'
        ? `${money} now, with credit for what's left of your current plan`
        : quote.action === 'credit'
          ? `${money} credit for what's left of your current plan`
          : 'Nothing to pay now') +
      `. Then ${PRICES[plan][billing]}${plan === 'studio' ? ', plus any extra seats' : ''}. Charged to the card on your subscription.`;
  } else {
    const when = quote.date ? DAY.format(new Date(quote.date)) : 'the end of your billing period';
    text =
      `Switch to ${target} on ${when}?\n\nYou keep your current plan until then, and pay ${PRICES[plan][billing]} from that day.` +
      (plan === 'pro' && opts.hasTeam ? ' Any team members lose access and extra seats are removed on that day.' : '') +
      ' You can change your mind any time before.';
  }
  if (!window.confirm(text)) return false;
  await callFunction('change-plan', { action: 'change', plan, billing });
  return true;
}

/** Undoes a scheduled downgrade or cancellation. */
export async function keepPlan(): Promise<void> {
  await callFunction('change-plan', { action: 'keep' });
}
