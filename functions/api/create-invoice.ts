// Cloudflare Pages Function: POST /api/create-invoice → the Supabase create-invoice function, with the
// buyer's country from Cloudflare. Paid plans aren't sold in Russia (crypto payments there are barred by
// Federal Law 259-FZ), so Russian visitors are refused here, before any order exists.
// Pages secret: GEO_SECRET (the same value as the Supabase secret), so only this route can start payments.
interface Context {
  request: Request & { cf?: { country?: string } };
  env: { GEO_SECRET?: string };
}

import { canBuyFrom, NOT_SOLD_HERE } from '../../supabase/functions/_shared/countries';

const SUPABASE_URL = 'https://medqkcnpxjogeedenkee.supabase.co';

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export async function onRequestPost({ request, env }: Context): Promise<Response> {
  const country = request.cf?.country ?? '';
  if (!canBuyFrom(country)) return json({ error: NOT_SOLD_HERE, reason: 'country' }, 451);
  if (!env.GEO_SECRET) return json({ error: 'Payments are not open yet.' }, 503);
  const res = await fetch(`${SUPABASE_URL}/functions/v1/create-invoice`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: request.headers.get('Authorization') ?? '',
      apikey: request.headers.get('apikey') ?? '',
      'x-geo-secret': env.GEO_SECRET,
      'x-isla-country': country,
    },
    body: await request.text(),
  });
  return new Response(await res.text(), { status: res.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
