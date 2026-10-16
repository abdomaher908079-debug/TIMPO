// Supabase Edge Function: receives Paddle subscription events and keeps each user's plan in sync.
// Deploy without JWT checks (Paddle signs its requests instead):
//   supabase functions deploy paddle-webhook --no-verify-jwt
// Events: subscription.*, transaction.completed (hour packs), adjustment.* (refunds of hour packs).
// Secrets: PADDLE_WEBHOOK_SECRET, PADDLE_ENV, PADDLE_PRICE_{PRO,STUDIO,SEAT}_{MONTHLY,YEARLY}, PADDLE_PRICE_HOURS_PACK
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { isSeatPrice, planForPrice } from '../_shared/paddle.ts';
import { PACK } from '../_shared/plans.ts';

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
  items?: { price?: { id?: string }; quantity?: number }[];
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

  const event = JSON.parse(body) as { event_type: string; data: unknown };
  if (event.event_type === 'transaction.completed') return packBought(event.data as Transaction);
  if (event.event_type === 'adjustment.created' || event.event_type === 'adjustment.updated') return refunded(event.data as Adjustment);
  if (!event.event_type.startsWith('subscription.')) return new Response('Ignored');
  const sub = event.data as Subscription;

  // The checkout passes our user id; later events are matched by subscription id.
  const userId = sub.custom_data?.user_id;
  const match = userId ? { column: 'id', value: userId } : { column: 'paddle_subscription_id', value: sub.id };
  const { data: profile } = await admin
    .from('profiles')
    .select('updated_at, paddle_subscription_id, subscription_status')
    .eq(match.column, match.value)
    .maybeSingle<{ updated_at: string; paddle_subscription_id: string | null; subscription_status: string | null }>();
  if (!profile) {
    console.error('No profile for subscription', sub.id, userId);
    // 200 so Paddle doesn't retry an event that will never match.
    return new Response('No matching user');
  }
  // Events can arrive out of order; never let an older one overwrite a newer state.
  if (new Date(profile.updated_at) > new Date(sub.updated_at)) return new Response('Stale event');
  // The account already runs on another subscription that's still going (e.g. bought twice): only a new
  // purchase takes over; later events about the other one (renewing, ending) mustn't overwrite the account.
  const live = (status: string | null) => status === 'active' || status === 'trialing' || status === 'past_due';
  if (profile.paddle_subscription_id && profile.paddle_subscription_id !== sub.id && live(profile.subscription_status)) {
    const purchase = event.event_type === 'subscription.created' || event.event_type === 'subscription.activated';
    if (!purchase || !live(sub.status)) return new Response('Not the account’s current subscription');
    console.error('Second subscription for one account', match.value, 'was', profile.paddle_subscription_id, 'now', sub.id);
  }

  // The plan's item, and any extra Studio seats added to the same subscription.
  const items = sub.items ?? [];
  const price = items.map((i) => planForPrice(i.price?.id)).find((p) => p) ?? null;
  if (!price) console.error('No plan price in subscription', sub.id, items.map((i) => i.price?.id));
  const seats = items.filter((i) => isSeatPrice(i.price?.id)).reduce((n, i) => n + (i.quantity ?? 1), 0);
  const { error } = await admin
    .from('profiles')
    .update({
      ...(price ? { plan: price.plan, billing: price.billing, extra_seats: price.plan === 'studio' ? Math.min(7, seats) : 0 } : {}),
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

interface Transaction {
  id: string;
  status: string;
  subscription_id?: string | null;
  custom_data?: { user_id?: string } | null;
  items?: { price?: { id?: string }; quantity?: number }[];
}

interface Adjustment {
  id: string;
  action: string;
  status: string;
  transaction_id: string;
}

/** An hour pack was paid for: add it to the buyer's workspace (once, even if Paddle sends it again). */
async function packBought(txn: Transaction): Promise<Response> {
  const packPrice = Deno.env.get('PADDLE_PRICE_HOURS_PACK');
  const quantity = (txn.items ?? []).filter((i) => packPrice && i.price?.id === packPrice).reduce((n, i) => n + (i.quantity ?? 1), 0);
  if (!quantity) return new Response('Ignored');
  const userId = txn.custom_data?.user_id;
  if (!userId) {
    console.error('Hour pack without a user', txn.id);
    return new Response('No user');
  }
  const seconds = quantity * PACK.hours * 3600;
  const episodes = quantity * PACK.episodes;
  const { error } = await admin.from('hour_packs').upsert(
    {
      workspace_id: userId,
      transaction_id: txn.id,
      seconds,
      episodes,
      seconds_left: seconds,
      episodes_left: episodes,
      expires_at: new Date(Date.now() + PACK.days * 86_400_000).toISOString(),
    },
    { onConflict: 'transaction_id', ignoreDuplicates: true },
  );
  if (error) {
    console.error('Hour pack not saved', txn.id, error);
    // An unknown user will never match; anything else is worth Paddle trying again.
    return error.code === '23503' ? new Response('No matching user') : new Response('Database error', { status: 500 });
  }
  return new Response('OK');
}

/** A refund or chargeback went through: an hour pack bought in that transaction can't be used any more. */
async function refunded(adj: Adjustment): Promise<Response> {
  if ((adj.action !== 'refund' && adj.action !== 'chargeback') || adj.status !== 'approved') return new Response('Ignored');
  const { error } = await admin
    .from('hour_packs')
    .update({ refunded_at: new Date().toISOString(), seconds_left: 0, episodes_left: 0 })
    .eq('transaction_id', adj.transaction_id);
  if (error) {
    console.error(error);
    return new Response('Database error', { status: 500 });
  }
  return new Response('OK');
}

