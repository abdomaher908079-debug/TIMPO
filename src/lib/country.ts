import { useEffect, useState } from 'react';
import { canBuyFrom, NOT_SOLD_HERE } from '../../supabase/functions/_shared/countries';

// Paid plans aren't sold everywhere (see _shared/countries.ts). The server checks again when a payment starts.
export { NOT_SOLD_HERE };

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
    // No answer at all (offline, or the demo without our API): leave it to the server.
    void country().then((c) => live && setCan(c === null ? true : canBuyFrom(c)));
    return () => {
      live = false;
    };
  }, []);
  return can;
}
