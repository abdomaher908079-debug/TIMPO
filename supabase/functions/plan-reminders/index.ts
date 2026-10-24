// Supabase Edge Function, run every hour by the hookcut-plan-reminders cron (x-cron-secret).
// For plans given from the owner page or paid upfront through NOWPayments (no Paddle subscription): reminder emails 7, 3 and 1 day before the
// plan ends, then "your plan has ended" and back to Free when it ends without being renewed.
// Emails go through Brevo's API (secret BREVO_API_KEY); without it, plans still end on time.
// Deploy: supabase functions deploy plan-reminders --no-verify-jwt
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { button, DATE, type Letter, p, send as sendLetter, sign, SITE } from '../_shared/email.ts';

const DAY = 86_400_000;

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

type Kind = '7d' | '3d' | '1d' | 'ended';

interface Gift {
  id: string;
  plan: 'pro' | 'studio';
  current_period_end: string;
  // 'nowpayments' when the plan was paid for (renewed by paying again), null when we gave it.
  paid_with: string | null;
}

const PLAN_NAMES = { pro: 'Pro', studio: 'Studio' };

function letter(kind: Kind, plan: Gift['plan'], end: Date, paid: boolean): Letter {
  const name = PLAN_NAMES[plan];
  const when = DATE.format(end);
  if (kind === 'ended') {
    return {
      subject: `Your Isla ${name} plan has ended`,
      html:
        p('Hi,') +
        p(`Your Isla ${name} plan ended on ${when}, and your account is now on the Free plan.`) +
        p(
          paid
            ? 'Your saved episodes and clips are kept for at least 30 days. To get every clip, no watermark and our best AI back, buy another month or year from the pricing page.'
            : 'Your saved episodes and clips are kept for at least 30 days. To get every clip, no watermark and our best AI back, reply to this email and we’ll renew your plan.',
        ) +
        button(paid ? 'Renew my plan' : 'Open Isla', `${SITE}/${paid ? 'pricing' : 'account'}`) +
        sign,
    };
  }
  const left = kind === '7d' ? 'in 7 days' : kind === '3d' ? 'in 3 days' : 'tomorrow';
  return {
    subject: `Your Isla ${name} plan ends ${left}`,
    html:
      p('Hi,') +
      p(`A reminder that your Isla ${name} plan ends ${left}, on ${when}.`) +
      p(
        paid
          ? `It doesn’t renew on its own. To keep it without a break, buy more time from the pricing page; it’s added to the end of your plan. If you don’t, your account moves to the Free plan on ${when}; your saved work stays.`
          : `To keep it without a break, reply to this email and we’ll renew it. If you don’t, your account moves to the Free plan on ${when}; your saved work stays.`,
      ) +
      button(paid ? 'Renew my plan' : 'See my plan', `${SITE}/${paid ? 'pricing' : 'account'}`) +
      sign,
  };
}

function send(to: string, kind: Kind, g: Gift, end: Date): Promise<boolean> {
  return sendLetter(to, letter(kind, g.plan, end, !!g.paid_with));
}

/** The reminder due now, if any: only the nearest one, so a short gift doesn't get a late "7 days" email. */
function due(end: Date, now: number): Kind | null {
  const left = end.getTime() - now;
  if (left <= 0) return 'ended';
  if (left <= DAY) return '1d';
  if (left <= 3 * DAY) return '3d';
  if (left <= 7 * DAY) return '7d';
  return null;
}

Deno.serve(async (req) => {
  const secret = Deno.env.get('PLAN_CHANGES_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) return new Response('Not allowed', { status: 401 });
  const now = Date.now();
  const { data: gifts, error } = await admin
    .from('profiles')
    .select('id, plan, current_period_end, paid_with')
    .is('paddle_subscription_id', null)
    .neq('plan', 'free')
    .eq('subscription_status', 'active')
    .not('current_period_end', 'is', null)
    .lte('current_period_end', new Date(now + 7 * DAY).toISOString());
  if (error) {
    console.error(error);
    return new Response('error', { status: 500 });
  }
  let sent = 0;
  let ended = 0;
  for (const g of (gifts ?? []) as Gift[]) {
    const end = new Date(g.current_period_end);
    const kind = due(end, now);
    if (!kind) continue;
    const { data: already } = await admin
      .from('plan_emails')
      .select('kind')
      .eq('user_id', g.id)
      .eq('period_end', g.current_period_end)
      .eq('kind', kind)
      .maybeSingle();
    if (!already) {
      const { data: user } = await admin.auth.admin.getUserById(g.id);
      const email = user.user?.email;
      if (email && (await send(email, kind, g, end))) {
        await admin.from('plan_emails').insert({ user_id: g.id, period_end: g.current_period_end, kind });
        sent++;
      }
    }
    if (kind === 'ended') {
      // Back to Free, unless the plan was renewed meanwhile (a new end date).
      await admin
        .from('profiles')
        .update({ plan: 'free', billing: null, subscription_status: null, current_period_start: null, current_period_end: null, cancel_at: null, extra_seats: 0, pending_plan: null, pending_billing: null, paid_with: null, paid_from: null, updated_at: new Date().toISOString() })
        .eq('id', g.id)
        .eq('current_period_end', g.current_period_end)
        .is('paddle_subscription_id', null);
      ended++;
    }
  }
  return new Response(JSON.stringify({ checked: gifts?.length ?? 0, sent, ended, email: !!Deno.env.get('BREVO_API_KEY') }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
