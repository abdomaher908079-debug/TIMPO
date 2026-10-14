import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PLANS } from '../lib/plans';

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
              <Link to="/signup" className={`btn ${plan.id === 'pro' ? 'btn-primary' : 'btn-outline'}`}>
                {plan.id === 'free' ? 'Start free' : `Get ${plan.name}`}
              </Link>
            </article>
          );
        })}
      </div>
    </section>
  );
}
