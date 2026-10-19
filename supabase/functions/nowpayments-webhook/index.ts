// Supabase Edge Function: NOWPayments' payment notifications (IPN). A signed POST for each status change;
// once an order is paid ('confirmed' or 'finished') its plan or hour pack is applied, once, and the
// buyer gets an email (_shared/orders.ts). The signature is HMAC-SHA512 of the body with its keys
// sorted, using the IPN secret from NOWPayments (Settings → Payments → Instant payment notifications).
// Secrets: NOWPAYMENTS_IPN_SECRET. Deploy: supabase functions deploy nowpayments-webhook --no-verify-jwt
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { type Order, settle } from '../_shared/orders.ts';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The body with every object's keys sorted, exactly as NOWPayments' own example does it (arrays included). */
function sorted(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) out[k] = sorted(obj[k]);
  return out;
}

async function signatureOk(body: unknown, sig: string, secret: string): Promise<boolean> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(JSON.stringify(sorted(body)))));
  const hex = Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('');
  if (hex.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('ok');
  const secret = Deno.env.get('NOWPAYMENTS_IPN_SECRET');
  const sig = req.headers.get('x-nowpayments-sig') ?? '';
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!secret || !body || !sig || !(await signatureOk(body, sig.toLowerCase(), secret))) return new Response('Bad signature', { status: 401 });

  try {
    const orderId = String(body.order_id ?? '');
    if (!UUID.test(orderId)) return new Response('ok');
    const { data: order } = await admin.from('crypto_orders').select('*').eq('id', orderId).maybeSingle<Order>();
    if (!order) return new Response('ok');
    await settle(order, body);
    return new Response('ok');
  } catch (err) {
    console.error(err);
    return new Response('error', { status: 500 });
  }
});
