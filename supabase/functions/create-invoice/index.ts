// Supabase Edge Function: starts a payment with NOWPayments (crypto, or card through its on-ramp).
// POST { kind: 'plan', plan, billing } or { kind: 'pack' } → { url } of NOWPayments' payment page.
// Called only through the site's /api/create-invoice (functions/api/create-invoice.ts), which adds the
// buyer's country from Cloudflare and the shared GEO_SECRET. Paid plans aren't sold in Russia, so a
// missing or Russian country is refused here too.
// Secrets: NOWPAYMENTS_API_KEY, GEO_SECRET. Deploy: supabase functions deploy create-invoice
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { type Billing, PACK, PRICE_USD } from '../_shared/plans.ts';

const SITE = 'https://islaclips.com';
const BLOCKED_COUNTRIES = ['RU'];
const NOT_HERE = 'Paid subscriptions are currently available for international users outside the Russian Federation.';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  try {
    const geoSecret = Deno.env.get('GEO_SECRET');
    if (!geoSecret || req.headers.get('x-geo-secret') !== geoSecret) return json({ error: 'Not allowed.' }, 403);
    const country = (req.headers.get('x-isla-country') ?? '').toUpperCase();
    if (!/^[A-Z]{2}$/.test(country) || BLOCKED_COUNTRIES.includes(country)) return json({ error: NOT_HERE, reason: 'country' }, 451);

    const apiKey = Deno.env.get('NOWPAYMENTS_API_KEY');
    if (!apiKey) return json({ error: 'Payments are not open yet.' }, 503);

    const token = req.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
    const { data: auth } = await admin.auth.getUser(token);
    const user = auth.user;
    if (!user) return json({ error: 'Sign in first.' }, 401);

    // Team members use their owner's plan; only the owner buys.
    const { data: team } = await admin.from('team_members').select('owner_id').eq('user_id', user.id).eq('status', 'active').limit(1).maybeSingle();
    if (team) return json({ error: 'Your team owner manages the plan.' }, 400);
    const { data: profile } = await admin
      .from('profiles')
      .select('plan, subscription_status, paddle_subscription_id')
      .eq('id', user.id)
      .maybeSingle<{ plan: string; subscription_status: string | null; paddle_subscription_id: string | null }>();
    if (profile?.paddle_subscription_id && profile.subscription_status === 'active') {
      return json({ error: 'Your plan is billed through Paddle. Manage it in Plan & settings.' }, 400);
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    let order: { kind: 'plan' | 'pack'; plan: 'pro' | 'studio' | null; billing: Billing | null; price: number; description: string };
    if (body.kind === 'pack') {
      // Bought hour packs work only on Pro or Studio, so they're sold only there.
      if (!profile || profile.plan === 'free' || profile.subscription_status !== 'active') return json({ error: 'Extra hours are for Pro and Studio.' }, 400);
      order = { kind: 'pack', plan: null, billing: null, price: PACK.price, description: `Isla extra hours: +${PACK.hours} hours, +${PACK.episodes} episodes` };
    } else {
      const plan = body.plan === 'pro' || body.plan === 'studio' ? body.plan : null;
      const billing = body.billing === 'monthly' || body.billing === 'yearly' ? body.billing : null;
      if (!plan || !billing) return json({ error: 'Choose a plan.' }, 400);
      const name = plan === 'pro' ? 'Pro' : 'Studio';
      order = { kind: 'plan', plan, billing, price: PRICE_USD[plan][billing], description: `Isla ${name}, 1 ${billing === 'yearly' ? 'year' : 'month'}` };
    }

    const { data: row, error } = await admin
      .from('crypto_orders')
      .insert({ user_id: user.id, kind: order.kind, plan: order.plan, billing: order.billing, price_usd: order.price, country })
      .select('id')
      .single<{ id: string }>();
    if (error || !row) throw error ?? new Error('Order not saved.');

    const res = await fetch('https://api.nowpayments.io/v1/invoice', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        price_amount: order.price,
        price_currency: 'usd',
        order_id: row.id,
        order_description: order.description,
        ipn_callback_url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/nowpayments-webhook`,
        success_url: `${SITE}/account?paid=1`,
        cancel_url: `${SITE}/pricing`,
        is_fixed_rate: true,
      }),
    });
    const invoice = (await res.json().catch(() => ({}))) as { id?: string | number; invoice_url?: string; message?: string };
    if (!res.ok || !invoice.invoice_url) {
      console.error('NOWPayments invoice', res.status, invoice);
      await admin.from('crypto_orders').update({ status: 'failed' }).eq('id', row.id);
      return json({ error: "Couldn't start the payment. Try again in a minute." }, 502);
    }
    await admin.from('crypto_orders').update({ invoice_id: String(invoice.id ?? '') }).eq('id', row.id);
    return json({ url: invoice.invoice_url });
  } catch (err) {
    console.error(err);
    return json({ error: 'Something went wrong. Try again.' }, 500);
  }
});
