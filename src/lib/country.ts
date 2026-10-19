import { useEffect, useState } from 'react';

// Paid plans aren't sold in these countries (Russia: crypto payments for services are barred by
// Federal Law 259-FZ). The server checks again when a payment starts.
const BLOCKED = ['RU'];
export const NOT_SOLD_HERE = 'Paid subscriptions are currently available for international users outside the Russian Federation.';

let asked: Promise<string | null> | null = null;

/** The visitor's country from Cloudflare (/api/country), asked once per page load; null if unknown. */
function country(): Promise<string | null> {
  asked ??= fetch('/api/country')
    .then((r) => (r.ok ? (r.json() as Promise<{ country: string | null }>) : { country: null }))
    .then((d) => d.country)
    .catch(() => null);
  return asked;
}

/** Whether payments can start here: true, false, or null while still checking. */
export function useCanPay(): boolean | null {
  const [can, setCan] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void country().then((c) => live && setCan(!c || !BLOCKED.includes(c)));
    return () => {
      live = false;
    };
  }, []);
  return can;
}
