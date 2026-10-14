import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAccount } from '../lib/account';
import { useAuth } from '../lib/auth';
import { openBillingPortal, paymentsReady, startCheckout } from '../lib/billing';
import { PLANS, type Plan } from '../lib/plans';

export default function Pricing() {
  const [yearly, setYearly] = useState(false);
  return (
    <section className="pricing" id="pricing" aria-labelledby="pricing-title">
      <h2 id="pricing-title" className="section-heading">Simple pricing</h2>
      <div className="billing-toggle" role="group" aria-label="Billing period">
        <button type="button" className={!yearly ? 'on' : ''} aria-pressed={!yearly} onClick={() => setYearly(false)}>
          Monthly
        </button>
        <button type="button" className={yearly ? 'on' : ''} aria-pressed={yearly} onClick={() => setYearly(true)}>
          Yearly <span className="save">save 20%</span>
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
      <p className="muted small pricing-note">Prices in US dollars. Taxes are added at checkout where they apply. Cancel any time.</p>
    </section>
  );
}

function PlanButton({ plan, yearly }: { plan: Plan; yearly: boolean }) {
  const { user, demo } = useAuth();
  const account = useAccount();
  const [error, setError] = useState<string | null>(null);
  const style = `btn ${plan.id === 'pro' ? 'btn-primary' : 'btn-outline'}`;

  if (!user) {
    return (
      <Link to="/signup" className={style}>
        {plan.id === 'free' ? 'Start free' : `Get ${plan.name}`}
      </Link>
    );
  }
  if (account.plan.id === plan.id) {
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
  // Subscribers change or cancel their plan in Paddle's billing portal.
  if (account.plan.id !== 'free') {
    return (
      <>
        <button
          type="button"
          className="btn btn-outline"
          onClick={() => openBillingPortal().catch((e: Error) => setError(e.message))}
        >
          {plan.id === 'free' ? 'Cancel in billing' : `Switch in billing`}
        </button>
        {error && <p className="error small">{error}</p>}
      </>
    );
  }
  if (plan.id === 'free') return null;
  return (
    <button type="button" className={style} disabled={!paymentsReady} onClick={() => startCheckout(plan.id as 'pro' | 'studio', yearly ? 'yearly' : 'monthly')}>
      {paymentsReady ? `Upgrade to ${plan.name}` : 'Coming soon'}
    </button>
  );
}
