// Supabase Edge Function: receives Paddle subscription events and keeps each user's plan in sync.
// Deploy without JWT checks (Paddle signs its requests instead):
//   supabase functions deploy paddle-webhook --no-verify-jwt
// Secrets: PADDLE_WEBHOOK_SECRET, PADDLE_ENV, PADDLE_PRICE_{PRO,STUDIO}_{MONTHLY,YEARLY}
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { planForPrice } from '../_shared/paddle.ts';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

const encoder = new TextEncoder();

// Paddle-Signature: ts=1671552777;h1=<hex HMAC-SHA256 of "ts:body"> (several h1 while a secret rotates).
async function verifySignature(body: string, header: string | null, secret: string): Promise<boolean> {
  if (!header) return false;
  const parts = header.split(';').map((p) => p.split('=') as [string, string]);
  const ts = parts.find(([k]) => k === 'ts')?.[1];
  const signatures = parts.filter(([k]) => k === 'h1').map(([, v]) => v);
  if (!ts || !signatures.length) return false;
  // Refuse old events replayed by someone who captured one.
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`${ts}:${body}`)));
  const expected = Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('');
  return signatures.some((s) => s.length === expected.length && timingSafeEqual(s, expected));
}

function timingSafeEqual(a: string, b: string): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

interface Subscription {
  id: string;
  status: string;
  customer_id: string;
  updated_at: string;
  custom_data?: { user_id?: string } | null;
  items?: { price?: { id?: string } }[];
  current_billing_period?: { starts_at: string; ends_at: string } | null;
  scheduled_change?: { action: string; effective_at: string } | null;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const body = await req.text();
  const secret = Deno.env.get('PADDLE_WEBHOOK_SECRET');
  if (!secret || !(await verifySignature(body, req.headers.get('Paddle-Signature'), secret))) {
    return new Response('Invalid signature', { status: 401 });
  }

  const event = JSON.parse(body) as { event_type: string; data: Subscription };
  if (!event.event_type.startsWith('subscription.')) return new Response('Ignored');
  const sub = event.data;

  // The checkout passes our user id; later events are matched by subscription id.
  const userId = sub.custom_data?.user_id;
  const match = userId ? { column: 'id', value: userId } : { column: 'paddle_subscription_id', value: sub.id };
  const { data: profile } = await admin.from('profiles').select('updated_at').eq(match.column, match.value).maybeSingle();
  if (!profile) {
    console.error('No profile for subscription', sub.id, userId);
    // 200 so Paddle doesn't retry an event that will never match.
    return new Response('No matching user');
  }
  // Events can arrive out of order; never let an older one overwrite a newer state.
  if (new Date(profile.updated_at) > new Date(sub.updated_at)) return new Response('Stale event');

  const price = planForPrice(sub.items?.[0]?.price?.id);
  if (!price) console.error('Unknown Paddle price', sub.items?.[0]?.price?.id);
  const { error } = await admin
    .from('profiles')
    .update({
      ...(price ? { plan: price.plan, billing: price.billing } : {}),
      paddle_customer_id: sub.customer_id,
      paddle_subscription_id: sub.id,
      subscription_status: sub.status,
      current_period_start: sub.current_billing_period?.starts_at ?? null,
      current_period_end: sub.current_billing_period?.ends_at ?? null,
      cancel_at: sub.scheduled_change?.action === 'cancel' ? sub.scheduled_change.effective_at : null,
      updated_at: sub.updated_at,
    })
    .eq(match.column, match.value);
  if (error) {
    console.error(error);
    // 500 makes Paddle retry later.
    return new Response('Database error', { status: 500 });
  }
  return new Response('OK');
});
