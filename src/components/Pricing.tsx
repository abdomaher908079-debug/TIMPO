import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAccount } from '../lib/account';
import { useAuth } from '../lib/auth';
import { NOT_SOLD_HERE, useCanPay } from '../lib/country';
import { checkoutPath, openBillingPortal, paymentsOpen, paymentsReady, switchPlan } from '../lib/billing';
import { PLANS, type Plan } from '../lib/plans';
import { joinWaitlist, waitlistPlan, type WaitlistPlan } from '../lib/waitlist';
import { KIT_LIMITS } from '../lib/brandKits';
import { LIMITS, MAX_EXTRA_SEATS, PACK, PRICE_USD, SEAT_USD, TEAM_INCLUDED } from '../../supabase/functions/_shared/plans';

/** "2 h", "30 min" or "Any" for an episode length limit. */
const lengthLabel = (seconds: number | null) => (seconds === null ? 'Any' : seconds >= 3600 ? `${seconds / 3600} h` : `${Math.round(seconds / 60)} min`);

// Yearly saves this much at most (Pro 20%, Studio a little less).
const MOST_SAVED = Math.max(...(['pro', 'studio'] as const).map((id) => 1 - PRICE_USD[id].yearly / (PRICE_USD[id].monthly * 12)));

/**
 * What each plan's card shows, from the plans' real limits: who it's for, three numbers that tell the plans
 * apart at a glance, and only what it adds to the plan before it.
 */
function cardFor(plan: Plan): { forWho: string; stats: [string, string][]; plus?: string; items: [string, boolean][] } {
  const l = LIMITS[plan.id];
  const clips: [string, string] = [
    l.clipsExportable < l.clipsFound ? `${l.clipsExportable} of ${l.clipsFound}` : `${l.clipsExportable}`,
    l.clipsExportable < l.clipsFound ? 'clips exported' : 'clips each',
  ];
  const cloud = `${l.cloudSeconds / 3600} h`;
  if (plan.id === 'free') {
    return {
      forWho: 'To try Isla',
      stats: [[`${l.episodesPerPeriod}`, l.episodesPerPeriod === 1 ? 'episode / week' : 'episodes / week'], [lengthLabel(l.maxEpisodeSeconds), 'per episode'], clips],
      items: [
        ['Quick AI picks: good, not our best', true],
        ['1080p export', true],
        ['Small "Made with Isla" mark', false],
      ],
    };
  }
  if (plan.id === 'pro') {
    return {
      forWho: 'For one show posting every week',
      stats: [[`${l.hours} h`, 'a month'], [lengthLabel(l.maxEpisodeSeconds), 'length'], clips],
      plus: 'Everything in Free, plus',
      items: [
        ['Best AI: better moment picks, every clip checked twice', true],
        ['No watermark, up to 4K', true],
        ['Pro edit: headline, zoom-ins, follows the speaker', true],
        ['Your brand kit', true],
      ],
    };
  }
  return {
    forWho: 'For teams and several shows',
    stats: [[`${l.hours} h`, 'a month'], [`${TEAM_INCLUDED}`, 'people'], clips],
    plus: 'Everything in Pro, plus',
    items: [
      ['Best AI: better moment picks for every show', true],
      [`${KIT_LIMITS.studio} brand kits, one per show`, true],
      [`Team of ${TEAM_INCLUDED}, add more anytime`, true],
      [`More cloud listening (${cloud})`, true],
    ],
  };
}

export default function Pricing() {
  // Yearly first: paid upfront, and people stay longer.
  const [yearly, setYearly] = useState(true);
  const canPay = useCanPay();
  const cardsRef = useRef<HTMLDivElement>(null);
  // Phones show one plan at a time (swipe): which one is in view, starting on Pro.
  const [inView, setInView] = useState<Plan['id']>('pro');

  const show = (id: Plan['id'], smooth = true) => {
    const row = cardsRef.current;
    const card = row?.querySelector<HTMLElement>(`[data-plan="${id}"]`);
    if (row && card) row.scrollTo({ left: card.offsetLeft - (row.clientWidth - card.offsetWidth) / 2, behavior: smooth ? 'smooth' : 'auto' });
  };
  useEffect(() => {
    // Only matters when the plans are a swipeable row (phones); on wider screens they sit side by side.
    if (window.matchMedia('(max-width: 700px)').matches) show('pro', false);
  }, []);
  const onScroll = () => {
    const row = cardsRef.current;
    if (!row) return;
    const middle = row.scrollLeft + row.clientWidth / 2;
    let nearest: Plan['id'] = 'pro';
    let best = Infinity;
    row.querySelectorAll<HTMLElement>('[data-plan]').forEach((card) => {
      const d = Math.abs(card.offsetLeft + card.offsetWidth / 2 - middle);
      if (d < best) {
        best = d;
        nearest = card.dataset.plan as Plan['id'];
      }
    });
    setInView(nearest);
  };

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
          Yearly <span className="save">Save up to {Math.round(MOST_SAVED * 100)}%</span>
        </button>
      </div>
      <div className="plan-tabs" role="tablist" aria-label="Plans">
        {PLANS.map((plan) => (
          <button key={plan.id} type="button" role="tab" aria-selected={inView === plan.id} className={inView === plan.id ? 'on' : ''} onClick={() => show(plan.id)}>
            {plan.id === 'pro' ? 'Pro ★' : plan.id === 'free' ? 'Free' : plan.name}
          </button>
        ))}
      </div>
      <div className="plans" ref={cardsRef} onScroll={onScroll}>
        {PLANS.map((plan) => {
          const price = yearly ? plan.yearlyPerMonth : plan.monthly;
          const card = cardFor(plan);
          const hours = LIMITS[plan.id].hours;
          return (
            <article key={plan.id} data-plan={plan.id} className={`plan ${plan.id === 'pro' ? 'plan-featured' : ''}`}>
              {plan.id === 'pro' && <span className="plan-tag">Most popular</span>}
              <h3>{plan.name}</h3>
              <p className="plan-for">{card.forWho}</p>
              <p className="price">
                <strong>${price}</strong>
                <span>{price ? (yearly && plan.id !== 'free' ? `/month · $${PRICE_USD[plan.id].yearly} a year` : '/month') : 'forever'}</span>
              </p>
              {plan.id !== 'free' && <p className="plan-value">About ${(price / hours).toFixed(2)} per hour of podcast</p>}
              <div className="plan-stats">
                {card.stats.map(([big, small]) => (
                  <span key={small} className="plan-stat">
                    <b>{big}</b>
                    <small>{small}</small>
                  </span>
                ))}
              </div>
              {card.plus && <p className="plan-plus">{card.plus}</p>}
              <ul>
                {card.items.map(([text, yes]) => (
                  <li key={text} className={yes ? undefined : 'plan-minus'}>
                    {text}
                  </li>
                ))}
              </ul>
              <div className="plan-button">
                <PlanButton plan={plan} yearly={yearly} />
              </div>
            </article>
          );
        })}
      </div>

      <ul className="pricing-trust" aria-label="Good to know">
        <li>
          <span aria-hidden="true">🔒</span> <b>Your video never leaves your device</b>
        </li>
        <li>
          <span aria-hidden="true">↩️</span> <b>14-day refund</b>
        </li>
        <li>
          <span aria-hidden="true">✋</span> <b>Nothing to cancel</b>
        </li>
        <li>
          <span aria-hidden="true">💵</span> Pay with USDT
        </li>
      </ul>

      <div className="pricing-addons">
        <div className="addon">
          <span className="addon-icon" aria-hidden="true">
            ⏱
          </span>
          <span>
            <b>Extra hours</b>
            <small>
              +{PACK.hours} h and +{PACK.episodes} episodes, for {PACK.days} days. Pro and Studio.
            </small>
          </span>
          <span className="addon-price">${PACK.price}</span>
        </div>
        <div className="addon">
          <span className="addon-icon" aria-hidden="true">
            👥
          </span>
          <span>
            <b>Extra person on Studio</b>
            <small>Shares the plan's hours. Up to {TEAM_INCLUDED + MAX_EXTRA_SEATS} people.</small>
          </span>
          <span className="addon-price">
            ${yearly ? SEAT_USD.yearly : SEAT_USD.monthly}
            <small>{yearly ? '/yr' : '/mo'}</small>
          </span>
        </div>
      </div>

      <CompareTable yearly={yearly} />

      <p className="muted small pricing-note">
        Prices in US dollars. Pay with USDT through our payment partner NOWPayments. Plans are paid upfront for a month or a
        year and don't renew on their own. Paid plans aren't available in the Russian Federation.
      </p>
    </section>
  );
}

/** Every feature side by side, for those who want the details (folded away by default). */
function CompareTable({ yearly }: { yearly: boolean }) {
  const [f, p, s] = [LIMITS.free, LIMITS.pro, LIMITS.studio];
  const hours = (l: typeof f) => `${l.hours} h a month (up to ${l.episodesPerPeriod} episodes)`;
  const cloud = (l: typeof f) => (l.cloudJobsPerPeriod !== null ? `${l.cloudJobsPerPeriod} a ${l.period}` : `${l.cloudSeconds / 3600} h a month`);
  const price = (id: 'pro' | 'studio') => (yearly ? `$${PRICE_USD[id].yearly} a year` : `$${PRICE_USD[id].monthly} a month`);
  const rows: [string, string, string, string][] = [
    ['Price', 'Free', price('pro'), price('studio')],
    ['Episodes', `${f.episodesPerPeriod} a ${f.period}`, hours(p), hours(s)],
    ['Longest episode', lengthLabel(f.maxEpisodeSeconds), lengthLabel(p.maxEpisodeSeconds), lengthLabel(s.maxEpisodeSeconds)],
    ['Moment picks', 'Quick AI (one quick read)', 'Best AI (checked twice)', 'Best AI (checked twice)'],
    ['Clips per episode', f.clipsExportable < f.clipsFound ? `${f.clipsFound} found, ${f.clipsExportable} exported` : `${f.clipsExportable}`, `${p.clipsExportable}`, `${s.clipsExportable}`],
    ['Export', f.maxExport === '4k' ? 'Up to 4K' : '1080p', 'Up to 4K', 'Up to 4K'],
    ['Watermark', f.watermark ? 'Small mark' : 'None', 'None', 'None'],
    ['Pro edit (headline, zoom-ins, follows the speaker)', '—', '✓', '✓'],
    ['Brand kits', KIT_LIMITS.free ? `${KIT_LIMITS.free}` : '—', `${KIT_LIMITS.pro}`, `${KIT_LIMITS.studio}`],
    ['Cloud listening (phones)', cloud(f), cloud(p), cloud(s)],
    ['People', '1', '1', `${TEAM_INCLUDED} (up to ${TEAM_INCLUDED + MAX_EXTRA_SEATS})`],
    ['Editor, auto framing, split screen, upload kit', '✓', '✓', '✓'],
  ];
  return (
    <details className="compare">
      <summary>Compare every feature</summary>
      <div className="compare-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">
                <span className="visually-hidden">Feature</span>
              </th>
              <th scope="col">Free</th>
              <th scope="col">Pro</th>
              <th scope="col">Studio</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([name, ...cells]) => (
              <tr key={name}>
                <th scope="row">{name}</th>
                {cells.map((c, i) => (
                  <td key={i}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
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
