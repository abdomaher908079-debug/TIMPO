// Supabase Edge Function: the owners' account controls (owner page → Accounts).
// POST { action, ... } with an owner's session. Only the owners' verified emails get in; every change
// is recorded in owner_actions. Payments are not touched: plans given here have no Paddle subscription
// and end on their own (the hookcut-gift-expiry cron).
// Deploy: supabase functions deploy owner-admin
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { currentPeriod, type PlanId } from '../_shared/plans.ts';

const OWNERS = ['abdomaher908079@gmail.com', 'islaclipsofficial@gmail.com'];
const SITE = 'https://islaclips.com';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

interface Profile {
  id: string;
  plan: PlanId;
  billing: string | null;
  subscription_status: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  paddle_subscription_id: string | null;
  extra_seats: number;
}

const FILTERS = ['all', 'free', 'pro', 'studio', 'gifted', 'paying', 'blocked'] as const;

/** Accounts matching the search (email contains `q`) and filter, newest first, with what an owner needs to see. */
async function search(q: string, filter: string) {
  const { data, error } = await admin.rpc('owner_accounts', { p_query: q, p_filter: FILTERS.includes(filter as never) ? filter : 'all' });
  if (error) throw error;
  return data;
}

async function profileOf(id: string): Promise<Profile> {
  const { data, error } = await admin.from('profiles').select('*').eq('id', id).single<Profile>();
  if (error || !data) throw new Error('Account not found.');
  return data;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const token = req.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
    const { data: auth } = await admin.auth.getUser(token);
    const me = auth.user;
    const myEmail = me?.email?.toLowerCase() ?? '';
    if (!me || !OWNERS.includes(myEmail) || !me.email_confirmed_at) return json({ error: 'Not allowed.' }, 403);

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? '');
    if (action === 'search') return json({ accounts: await search(String(body.q ?? '').trim(), String(body.filter ?? 'all')) });
    if (action === 'log') {
      const { data } = await admin.from('owner_actions').select('*').order('at', { ascending: false }).limit(50);
      return json({ log: data ?? [] });
    }

    const id = String(body.id ?? '');
    const { data: target, error: findError } = await admin.auth.admin.getUserById(id);
    if (findError || !target.user) return json({ error: 'Account not found.' }, 404);
    const email = target.user.email ?? '';
    const record = (details: Record<string, unknown>) =>
      admin.from('owner_actions').insert({ owner_email: myEmail, target_email: email, action, details });

    if (action === 'set-plan') {
      const plan = String(body.plan) as PlanId;
      if (plan === 'free') {
        const p = await profileOf(id);
        // A real (paying) subscription is ended in Paddle, not here.
        if (p.paddle_subscription_id) return json({ error: 'This account pays through Paddle. Cancel it there.' }, 400);
        await admin
          .from('profiles')
          .update({ plan: 'free', billing: null, subscription_status: null, current_period_start: null, current_period_end: null, cancel_at: null, extra_seats: 0, pending_plan: null, pending_billing: null, updated_at: new Date().toISOString() })
          .eq('id', id);
        await record({ plan });
        return json({ ok: true });
      }
      if (plan !== 'pro' && plan !== 'studio') return json({ error: 'Unknown plan.' }, 400);
      const until = new Date(String(body.until ?? ''));
      if (Number.isNaN(until.getTime()) || until.getTime() < Date.now() + 3600_000) return json({ error: 'Choose an end date in the future.' }, 400);
      const p = await profileOf(id);
      if (p.paddle_subscription_id) return json({ error: 'This account pays through Paddle. Change it there.' }, 400);
      // Keep the start when only extending the same plan, so usage keeps counting from it.
      const keep = p.plan === plan && p.subscription_status === 'active' && p.current_period_start;
      const start = keep ? p.current_period_start! : new Date().toISOString();
      const days = (until.getTime() - new Date(start).getTime()) / 86_400_000;
      await admin
        .from('profiles')
        .update({
          plan,
          billing: days > 32 ? 'yearly' : 'monthly',
          subscription_status: 'active',
          current_period_start: start,
          current_period_end: until.toISOString(),
          cancel_at: null,
          pending_plan: null,
          pending_billing: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);
      await record({ plan, until: until.toISOString() });
      return json({ ok: true });
    }

    if (action === 'reset-usage') {
      const p = await profileOf(id);
      const period = currentPeriod(p.subscription_status === 'active' ? p.plan : 'free', new Date(), {
        start: p.current_period_start,
        end: p.current_period_end,
      });
      const from = period.start.toISOString();
      await admin.from('episodes').delete().eq('workspace_id', id).gte('period_start', from);
      await admin.from('cloud_jobs').delete().eq('workspace_id', id).gte('period_start', from);
      await record({ since: from });
      return json({ ok: true });
    }

    if (action === 'block' || action === 'unblock') {
      if (OWNERS.includes(email.toLowerCase())) return json({ error: "Owners can't be blocked." }, 400);
      const { error } = await admin.auth.admin.updateUserById(id, { ban_duration: action === 'block' ? '876000h' : 'none' });
      if (error) throw error;
      await record({});
      return json({ ok: true });
    }

    if (action === 'reset-password') {
      const { error } = await admin.auth.resetPasswordForEmail(email, { redirectTo: `${SITE}/reset-password` });
      if (error) throw error;
      await record({});
      return json({ ok: true });
    }

    if (action === 'delete') {
      if (OWNERS.includes(email.toLowerCase())) return json({ error: "Owners can't be deleted here." }, 400);
      if (String(body.confirm ?? '').toLowerCase() !== email.toLowerCase()) return json({ error: 'Type the email to confirm.' }, 400);
      const p = await profileOf(id).catch(() => null);
      if (p?.paddle_subscription_id && p.subscription_status === 'active') return json({ error: 'Cancel their paid plan in Paddle first.' }, 400);
      await record({});
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ error: 'Unknown request.' }, 400);
  } catch (err) {
    console.error(err);
    return json({ error: err instanceof Error ? err.message : 'Something went wrong.' }, 500);
  }
});
