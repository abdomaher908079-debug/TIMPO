// Checkout page: opens Paddle's checkout for the plan in the URL, as the signed-in user.
// Paddle charges the card and handles tax; its webhook then updates the plan (paddle-webhook).
import { effectivePlan, type Billing, type ProfileRow } from '../supabase/functions/_shared/plans';
import { PACK_PRICE_ID, PRICE_IDS } from './lib/billing';
import { supabase } from './lib/supabase';

interface PaddleJs {
  Environment: { set(env: string): void };
  Initialize(options: { token: string; eventCallback?: (e: { name?: string }) => void }): void;
  Checkout: {
    open(options: {
      items: { priceId: string; quantity: number }[];
      customer?: { email: string };
      customData?: Record<string, string>;
      settings?: Record<string, unknown>;
    }): void;
  };
}

const status = document.getElementById('status')!;
const fail = (message: string) => {
  status.textContent = message;
  status.className = 'error';
};

async function main() {
  const params = new URLSearchParams(location.search);
  const plan = params.get('plan');
  const billing = (params.get('billing') === 'yearly' ? 'yearly' : 'monthly') as Billing;
  // ?pack=hours: a one-time hour pack, for Pro and Studio owners.
  const pack = params.get('pack') === 'hours';
  const priceId = pack ? PACK_PRICE_ID : plan === 'pro' || plan === 'studio' ? PRICE_IDS[plan][billing] : undefined;
  const token = import.meta.env.VITE_PADDLE_CLIENT_TOKEN as string | undefined;
  const Paddle = (window as unknown as { Paddle?: PaddleJs }).Paddle;
  if (!supabase || !token || !priceId) return fail('Payments aren’t set up yet.');
  if (!Paddle) return fail('The checkout couldn’t load. Check your internet connection or turn off ad blockers for this page.');

  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;
  if (!user) {
    location.replace('/signup');
    return;
  }
  const { data: profile, error } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle<ProfileRow>();
  if (error) return fail('We couldn’t check your account. Please try again.');
  if (pack && effectivePlan(profile) === 'free') {
    status.innerHTML = 'Extra hours are for Pro and Studio. <a href="/pricing">See plans</a>';
    return;
  }
  // Already subscribed: changing plan happens in Paddle's billing page, never with a second subscription.
  if (!pack && effectivePlan(profile) !== 'free') {
    status.innerHTML = 'You already have a plan. To change it, choose the plan on the <a href="/pricing">Pricing</a> page.';
    return;
  }

  if (import.meta.env.VITE_PADDLE_ENV !== 'production') Paddle.Environment.set('sandbox');
  Paddle.Initialize({
    token,
    eventCallback: (e) => {
      if (e.name === 'checkout.closed') location.assign('/account');
    },
  });
  Paddle.Checkout.open({
    items: [{ priceId, quantity: 1 }],
    customer: user.email ? { email: user.email } : undefined,
    // Tells our webhook which account the subscription or hour pack belongs to.
    customData: { user_id: user.id },
    settings: { displayMode: 'overlay', theme: 'dark', successUrl: `${location.origin}/account?${pack ? 'pack=1' : 'upgraded=1'}` },
  });
  status.textContent = 'Complete your payment in the checkout window.';
}

void main();
