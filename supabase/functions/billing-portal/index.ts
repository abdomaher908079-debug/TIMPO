// Supabase Edge Function: POST → { url } of Paddle's customer portal, where subscribers update their
// card, switch between monthly and yearly, download invoices or cancel.
// Secrets: PADDLE_API_KEY, PADDLE_ENV
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { PADDLE_API } from '../_shared/paddle.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const token = req.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
  const { data: auth } = await admin.auth.getUser(token);
  if (!auth.user) return json({ error: 'Please sign in again.' }, 401);

  const { data: profile } = await admin
    .from('profiles')
    .select('paddle_customer_id, paddle_subscription_id')
    .eq('id', auth.user.id)
    .maybeSingle();
  if (!profile?.paddle_customer_id) return json({ error: 'You don’t have a subscription yet.' }, 404);

  const res = await fetch(`${PADDLE_API}/customers/${profile.paddle_customer_id}/portal-sessions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${Deno.env.get('PADDLE_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(profile.paddle_subscription_id ? { subscription_ids: [profile.paddle_subscription_id] } : {}),
  });
  if (!res.ok) {
    console.error('Paddle portal error', res.status, await res.text());
    return json({ error: 'Billing is unavailable right now. Please try again.' }, 502);
  }
  const data = (await res.json()) as { data: { urls: { general: { overview: string } } } };
  return json({ url: data.data.urls.general.overview });
});
