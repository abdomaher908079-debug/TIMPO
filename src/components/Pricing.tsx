import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAccount } from '../lib/account';
import { useAuth } from '../lib/auth';
import { NOT_SOLD_HERE, useCanPay } from '../lib/country';
import { checkoutPath, openBillingPortal, paymentsOpen, paymentsReady, switchPlan } from '../lib/billing';
import { PLANS, type Plan } from '../lib/plans';
import { joinWaitlist, waitlistPlan, type WaitlistPlan } from '../lib/waitlist';
import { PACK } from '../../supabase/functions/_shared/plans';

export default function Pricing() {
  // Yearly first: paid upfront, and people stay longer.
  const [yearly, setYearly] = useState(true);
  const canPay = useCanPay();
  return (
    <section className="pricing" id="pricing" aria-label="Plans">
      {paymentsOpen && canPay === false && (
        <p className="notice" role="status">
          {NOT_SOLD_HERE}
        </p>
      )}
      <div className="billing-toggle" role="group" aria-label="Billing period">
        <button type="button" className={!yearly ? 'on' : ''} aria-pressed={!yearly} onClick={() => setYearly(false)}>
          Monthly
        </button>
        <button type="button" className={yearly ? 'on' : ''} aria-pressed={yearly} onClick={() => setYearly(true)}>
          Yearly <span className="save">2 months free</span>
        </button>
      </div>
      <div className="plans">
        {PLANS.map((plan) => {
          const price = yearly ? plan.yearlyPerMonth : plan.monthly;
          return (
            <article key={plan.id} className={`plan card ${plan.id === 'pro' ? 'plan-featured' : ''}`}>
              {plan.id === 'pro' && <span className="plan-tag">Most popular</span>}
              <h3>{plan.name}</h3>
              <p className="price">
                <strong>${price}</strong>
                <span>{price ? (yearly ? '/mo, billed yearly' : '/month') : 'forever'}</span>
              </p>
              <ul>
                {plan.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <PlanButton plan={plan} yearly={yearly} />
            </article>
          );
        })}
      </div>
      <div className="card pricing-extras">
        <h3>Need more?</h3>
        <p>
          <b>
            Extra hours: +{PACK.hours} hours and +{PACK.episodes} episodes for ${PACK.price}
          </b>
          , one time, for Pro and Studio. Usable for {PACK.days} days, after your monthly hours or episodes run out.
        </p>
        <p>
          <b>Bigger teams: $8 a month ($80 a year) per extra person</b> on Studio, up to 10 people. Choose your team size when
          you buy, or add people later from Plan &amp; settings. Everyone shares the plan's hours.
        </p>
      </div>
      <p className="muted small pricing-note">
        Prices in US dollars. Pay with crypto (USDT, BTC, ETH and more) through our payment partner NOWPayments. Plans are
        paid upfront for a month or a year and don't renew on their own, so there's nothing to cancel. Paid plans aren't
        available in the Russian Federation.
      </p>
    </section>
  );
}

function PlanButton({ plan, yearly }: { plan: Plan; yearly: boolean }) {
  const { user, demo } = useAuth();
  const account = useAccount();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canPay = useCanPay();
  const navigate = useNavigate();
  const style = `btn ${plan.id === 'pro' ? 'btn-primary' : 'btn-outline'}`;

  if (!user) {
    return (
      <Link to="/signup" className={style}>
        {plan.id === 'free' ? 'Start free' : paymentsOpen ? `Get ${plan.name}` : 'Start free, get notified'}
      </Link>
    );
  }
  const current = account.plan.id;
  const currentBilling = account.profile?.billing ?? 'monthly';
  const billing = yearly ? 'yearly' : 'monthly';
  const member = !!account.workspace?.is_team_member;
  // Team members use the owner's plan: only the owner can change it, and buying their own would do nothing.
  if (member) {
    return (
      <button type="button" className="btn btn-outline" disabled>
        {current === plan.id ? "Your team's plan" : 'Set by your team owner'}
      </button>
    );
  }
  // Paddle subscribers (auto-renewing) switch through Paddle below; everyone else pays upfront.
  const paddle = current !== 'free' && !!account.profile?.paddle_subscription_id;
  if (current === plan.id && (plan.id === 'free' || (paddle && currentBilling === billing))) {
    return (
      <button type="button" className="btn btn-outline" disabled>
        Your plan
      </button>
    );
  }
  // Demo mode: switch plans for free, to try what each one unlocks.
  if (demo) {
    return (
      <button type="button" className={style} onClick={() => account.setDemoPlan(plan.id)}>
        Switch to {plan.name} (demo)
      </button>
    );
  }
  // Subscribers switch here (shown the exact amount first); cancelling and invoices are in Paddle's billing page.
  if (paddle) {
    const pending = account.profile?.pending_plan === plan.id && account.profile?.pending_billing === billing;
    return (
      <>
        <button
          type="button"
          className="btn btn-outline"
          disabled={busy || pending}
          onClick={() => {
            setError(null);
            if (plan.id === 'free') {
              openBillingPortal().catch((e: Error) => setError(e.message));
              return;
            }
            setBusy(true);
            switchPlan(plan.id as 'pro' | 'studio', billing, { hasTeam: (account.profile?.extra_seats ?? 0) > 0 || current === 'studio' })
              .then((changed) => (changed ? account.refresh() : undefined))
              .catch((e: Error) => setError(e.message))
              .finally(() => setBusy(false));
          }}
        >
          {plan.id === 'free'
            ? 'Cancel in billing'
            : pending
              ? 'Scheduled'
              : current === plan.id
                ? `Switch to ${billing}`
                : `Switch to ${plan.name}`}
        </button>
        {error && <p className="error small">{error}</p>}
      </>
    );
  }
  if (plan.id === 'free') return null;
  if (!paymentsOpen) {
    if (current === plan.id) {
      return (
        <button type="button" className="btn btn-outline" disabled>
          Your plan
        </button>
      );
    }
    return <NotifyButton plan={plan} style={style} />;
  }
  // Not sold here: the notice above the plans says why.
  if (canPay === false) return null;
  const period = yearly ? 'year' : 'month';
  const label = current === plan.id ? `Add 1 ${period}` : current === 'free' ? `Get ${plan.name}` : `Switch to ${plan.name}`;
  // The checkout page explains everything step by step, switching plans included.
  const to = checkoutPath({ kind: 'plan', plan: plan.id as 'pro' | 'studio', billing });
  return (
    <button type="button" className={style} disabled={!paymentsReady || canPay === null} onClick={() => navigate(to)}>
      {paymentsReady ? label : 'Coming soon'}
    </button>
  );
}

/** While paid plans are closed: ask to be emailed when they open. */
function NotifyButton({ plan, style }: { plan: Plan; style: string }) {
  const { user } = useAuth();
  const [joined, setJoined] = useState<WaitlistPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user) void waitlistPlan(user.id).then(setJoined);
  }, [user]);

  if (joined === plan.id) {
    return (
      <p className="notify-done">
        ✓ We'll email you at {user?.email} when {plan.name} opens.
      </p>
    );
  }
  return (
    <>
      <button
        type="button"
        className={style}
        disabled={busy || !user}
        onClick={() => {
          if (!user) return;
          setBusy(true);
          setError(null);
          joinWaitlist(user.id, user.email, plan.id as WaitlistPlan)
            .then(() => setJoined(plan.id as WaitlistPlan))
            .catch((e: Error) => setError(e.message))
            .finally(() => setBusy(false));
        }}
      >
        {busy ? 'Saving…' : `Notify me when ${plan.name} opens`}
      </button>
      {error && <p className="error small">{error}</p>}
    </>
  );
}
