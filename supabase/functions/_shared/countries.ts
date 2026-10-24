// Where paid plans are sold. Russia: crypto payments for services are barred by Federal Law 259-FZ.
// Shared by the pricing page (src/lib/country.ts), the site's /api/create-invoice and the create-invoice
// function, so all three agree.
export const BLOCKED_COUNTRIES = ['RU'];
export const NOT_SOLD_HERE = 'Paid subscriptions are currently available for international users outside the Russian Federation.';

/** Whether a payment may start from `country` (Cloudflare's two-letter code). Unknown ones ('XX', Tor's 'T1') may not. */
export function canBuyFrom(country: string | null | undefined): boolean {
  const c = (country ?? '').toUpperCase();
  return /^[A-Z]{2}$/.test(c) && c !== 'XX' && !BLOCKED_COUNTRIES.includes(c);
}
