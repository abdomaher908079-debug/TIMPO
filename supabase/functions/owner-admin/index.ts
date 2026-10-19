// Supabase Edge Function: the owners' account controls (owner page → Accounts).
// POST { action, ... } with an owner's session. Only the owners' verified emails get in; every change
// is recorded in owner_actions, and the account gets an email about it (unless `notify` is false).
// Payments are not touched: plans given here have no Paddle subscription and end on their own
// (the hookcut-gift-expiry cron); gifts of hours and episodes work on every plan, Free included.
// Deploy: supabase functions deploy owner-admin
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { button, DATE, type Letter, p, send, sign, SITE } from '../_shared/email.ts';
import { currentPeriod, LIMITS, type PlanId } from '../_shared/plans.ts';

const OWNERS = ['abdomaher908079@gmail.com', 'islaclipsofficial@gmail.com'];
// Only the site itself may call this from a browser.
const CORS = {
  'Access-Control-Allow-Origin': SITE,
  Vary: 'Origin',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A claim from the session token (already verified by getUser above). */
function claim(token: string, name: string): unknown {
  try {
    const part = token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/');
    return (JSON.parse(atob(part.padEnd(part.length + ((4 - (part.length % 4)) % 4), '='))) as Record<string, unknown>)[name];
  } catch {
    return undefined;
  }
}

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

const PLAN_NAMES: Record<PlanId, string> = { free: 'Free', pro: 'Pro', studio: 'Studio' };
const DAY = 86_400_000;

/** Text from the owner page, made safe to put in an email. */
function escape(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const hoursText = (h: number) => `${h} hour${h === 1 ? '' : 's'}`;
const episodesText = (n: number) => `${n} episode${n === 1 ? '' : 's'}`;

/** The email the account gets after an owner's change. */
function letterFor(action: string, d: Record<string, unknown>): Letter | null {
  const hi = p('Hi,');
  switch (action) {
    case 'set-plan': {
      const plan = d.plan as PlanId;
      if (plan === 'free') {
        return {
          subject: 'Your Isla account is now on the Free plan',
          html: hi + p('Your Isla account has been moved to the Free plan. Your saved episodes and clips stay.') + p('Questions? Just reply to this email.') + button('Open Isla', `${SITE}/account`) + sign,
        };
      }
      const name = PLAN_NAMES[plan];
      const until = DATE.format(new Date(String(d.until)));
      return d.extended
        ? {
            subject: `Your Isla ${name} plan now runs until ${until}`,
            html: hi + p(`Good news: your Isla ${name} plan has been extended. It now runs until <b>${until}</b>.`) + p('Nothing to do on your side. Enjoy!') + button('Open Isla', `${SITE}/new`) + sign,
          }
        : {
            subject: `You've got Isla ${name} until ${until}`,
            html:
              hi +
              p(`You've been given Isla <b>${name}</b>, free of charge, until <b>${until}</b>.`) +
              p(`It's ready now: ${hoursText(LIMITS[plan].hours)} a month, every clip, no watermark and our best AI. We'll remind you before it ends.`) +
              button('Make clips', `${SITE}/new`) +
              sign,
          };
    }
    case 'reset-usage':
      return {
        subject: 'Your Isla usage has been reset',
        html: hi + p('Your hours and episodes for this period have been reset, so you have your full allowance again.') + button('Make clips', `${SITE}/new`) + sign,
      };
    case 'gift-pack': {
      const parts = [Number(d.hours) ? hoursText(Number(d.hours)) : '', Number(d.episodes) ? episodesText(Number(d.episodes)) : ''].filter(Boolean).join(' and ');
      const until = DATE.format(new Date(String(d.until)));
      return {
        subject: `A gift from Isla: ${parts}`,
        html:
          hi +
          p(`You've been given <b>${parts}</b> extra, free, usable until <b>${until}</b> on any plan.`) +
          p("They're used after your plan's own hours or episodes run out, so you can keep making clips.") +
          button('Make clips', `${SITE}/new`) +
          sign,
      };
    }
    case 'gift-seats':
      return {
        subject: `Your Isla Studio team can now have ${d.people} people`,
        html: hi + p(`Your Studio team now has room for <b>${d.people} people</b>, you included, at no extra cost.`) + button('Invite your team', `${SITE}/account`) + sign,
      };
    case 'take-back-gifts':
      return {
        subject: 'Your Isla gift has ended',
        html: hi + p('The extra hours and episodes you were given have ended. Your plan and your saved work are unchanged.') + p('Questions? Just reply to this email.') + sign,
      };
    case 'block':
      return {
        subject: 'Your Isla account has been paused',
        html: hi + p("Your Isla account has been paused, so you can't sign in for now.") + p('If you think this is a mistake, reply to this email and we will look at it.') + sign,
      };
    case 'unblock':
      return {
        subject: 'Your Isla account is open again',
        html: hi + p('Your Isla account is open again. You can sign in as usual.') + button('Sign in', `${SITE}/auth`) + sign,
      };
    case 'delete':
      return {
        subject: 'Your Isla account has been deleted',
        html: hi + p('Your Isla account and the data saved with it have been deleted.') + p('If you think this is a mistake, reply to this email.') + sign,
      };
    case 'message':
      return {
        subject: escape(String(d.subject)),
        html: hi + String(d.text).split(/\n{2,}/).map((para) => p(escape(para).replace(/\n/g, '<br>'))).join('') + sign,
      };
  }
  return null;
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
    // The session must have passed two-step verification (the code from the authenticator app).
    if (claim(token, 'aal') !== 'aal2') return json({ error: 'Enter the code from your authenticator app first.' }, 403);

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? '');
    if (action === 'search') return json({ accounts: await search(String(body.q ?? '').trim().slice(0, 100), String(body.filter ?? 'all')) });
    if (action === 'log') {
      const { data } = await admin.from('owner_actions').select('*').order('at', { ascending: false }).limit(50);
      return json({ log: data ?? [] });
    }

    const id = String(body.id ?? '');
    if (!UUID.test(id)) return json({ error: 'Account not found.' }, 404);
    const { data: target, error: findError } = await admin.auth.admin.getUserById(id);
    if (findError || !target.user) return json({ error: 'Account not found.' }, 404);
    const email = target.user.email ?? '';
    const notify = body.notify !== false;
    // Records the change, emails the account about it, and answers the owner page.
    const done = async (details: Record<string, unknown>) => {
      const letter = notify ? letterFor(action, details) : null;
      const emailed = letter ? await send(email, letter) : false;
      await admin.from('owner_actions').insert({ owner_email: myEmail, target_email: email, action, details: { ...details, emailed } });
      return json({ ok: true, emailed, emailReady: !!Deno.env.get('BREVO_API_KEY') });
    };

    if (action === 'set-plan') {
      const plan = String(body.plan) as PlanId;
      if (plan === 'free') {
        const p = await profileOf(id);
        // A real (paying) subscription is ended in Paddle, not here.
        if (p.paddle_subscription_id) return json({ error: 'This account pays through Paddle. Cancel it there.' }, 400);
        await admin
          .from('profiles')
          .update({ plan: 'free', billing: null, subscription_status: null, current_period_start: null, current_period_end: null, cancel_at: null, extra_seats: 0, pending_plan: null, pending_billing: null, paid_with: null, updated_at: new Date().toISOString() })
          .eq('id', id);
        return await done({ plan });
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
      const extended = p.plan === plan && p.subscription_status === 'active';
      return await done({ plan, until: until.toISOString(), extended });
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
      return await done({ since: from });
    }

    if (action === 'gift-pack') {
      const hours = Math.round(Number(body.hours ?? 0) * 2) / 2;
      const episodes = Math.round(Number(body.episodes ?? 0));
      const days = Math.round(Number(body.days ?? 30));
      if (!(hours >= 0 && hours <= 200 && episodes >= 0 && episodes <= 200) || (hours === 0 && episodes === 0)) {
        return json({ error: 'Give some hours or episodes (up to 200 each).' }, 400);
      }
      if (!(days >= 1 && days <= 366)) return json({ error: 'Choose between 1 and 366 days.' }, 400);
      const until = new Date(Date.now() + days * DAY).toISOString();
      const { error } = await admin.from('hour_packs').insert({
        workspace_id: id,
        transaction_id: `gift-${crypto.randomUUID()}`,
        seconds: hours * 3600,
        episodes,
        seconds_left: hours * 3600,
        episodes_left: episodes,
        expires_at: until,
        any_plan: true,
      });
      if (error) throw error;
      return await done({ hours, episodes, until });
    }

    if (action === 'take-back-gifts') {
      const { data, error } = await admin
        .from('hour_packs')
        .update({ refunded_at: new Date().toISOString() })
        .eq('workspace_id', id)
        .eq('any_plan', true)
        .is('refunded_at', null)
        .gt('expires_at', new Date().toISOString())
        .select('id');
      if (error) throw error;
      if (!data?.length) return json({ error: 'This account has no gifts to take back.' }, 400);
      return await done({ gifts: data.length });
    }

    if (action === 'gift-seats') {
      const people = Math.round(Number(body.people));
      if (!(people >= 3 && people <= 10)) return json({ error: 'Choose 3 to 10 people.' }, 400);
      const p = await profileOf(id);
      if (p.paddle_subscription_id) return json({ error: 'This account pays through Paddle. Change seats there.' }, 400);
      if (p.plan !== 'studio' || p.subscription_status !== 'active') return json({ error: 'Give them Studio first; seats are for Studio teams.' }, 400);
      await admin.from('profiles').update({ extra_seats: people - 3, updated_at: new Date().toISOString() }).eq('id', id);
      return await done({ people });
    }

    if (action === 'message') {
      const subject = String(body.subject ?? '').trim().slice(0, 150);
      const text = String(body.text ?? '').trim().slice(0, 5000);
      if (!subject || !text) return json({ error: 'Write a subject and a message.' }, 400);
      if (!Deno.env.get('BREVO_API_KEY')) return json({ error: 'Emails are not set up yet (BREVO_API_KEY).' }, 400);
      const sent = await send(email, letterFor('message', { subject, text })!);
      if (!sent) return json({ error: "The email couldn't be sent. Try again." }, 502);
      await admin.from('owner_actions').insert({ owner_email: myEmail, target_email: email, action, details: { subject, emailed: true } });
      return json({ ok: true, emailed: true, emailReady: true });
    }

    if (action === 'block' || action === 'unblock') {
      if (OWNERS.includes(email.toLowerCase())) return json({ error: "Owners can't be blocked." }, 400);
      const { error } = await admin.auth.admin.updateUserById(id, { ban_duration: action === 'block' ? '876000h' : 'none' });
      if (error) throw error;
      return await done({});
    }

    if (action === 'reset-password') {
      const { error } = await admin.auth.resetPasswordForEmail(email, { redirectTo: `${SITE}/reset-password` });
      if (error) throw error;
      await admin.from('owner_actions').insert({ owner_email: myEmail, target_email: email, action, details: {} });
      return json({ ok: true });
    }

    if (action === 'delete') {
      if (OWNERS.includes(email.toLowerCase())) return json({ error: "Owners can't be deleted here." }, 400);
      if (String(body.confirm ?? '').toLowerCase() !== email.toLowerCase()) return json({ error: 'Type the email to confirm.' }, 400);
      const p = await profileOf(id).catch(() => null);
      if (p?.paddle_subscription_id && p.subscription_status === 'active') return json({ error: 'Cancel their paid plan in Paddle first.' }, 400);
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) throw error;
      // The email goes once the account is really gone.
      return await done({});
    }

    return json({ error: 'Unknown request.' }, 400);
  } catch (err) {
    console.error(err);
    return json({ error: err instanceof Error ? err.message : 'Something went wrong.' }, 500);
  }
});
