import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import BrandKits from '../components/BrandKits';
import Pricing from '../components/Pricing';
import Team from '../components/Team';
import { useAccount } from '../lib/account';
import { useAuth } from '../lib/auth';
import { openBillingPortal } from '../lib/billing';
import { cloudAvailable } from '../lib/cloud';
import { formatDuration } from '../lib/format';

const DATE = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'long', day: 'numeric' });

export default function Account() {
  const { user, demo } = useAuth();
  const { plan, profile, workspace, period, usage, cloudUsage, loading, refresh } = useAccount();
  const [params, setParams] = useSearchParams();
  const [billingError, setBillingError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  // Back from checkout: the plan changes once Paddle tells our server, usually within seconds.
  const [activating, setActivating] = useState(params.get('upgraded') === '1');

  useEffect(() => {
    if (!activating) return;
    if (plan.id !== 'free') {
      setActivating(false);
      setParams({}, { replace: true });
      return;
    }
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > 60_000) {
        clearInterval(timer);
        setActivating(false);
      } else void refresh();
    }, 2000);
    return () => clearInterval(timer);
  }, [activating, plan.id, refresh, setParams]);

  const hoursTotal = plan.hours * 3600;
  // Free counts episodes; paid plans count hours, with an episode count far above normal use.
  const byEpisodes = plan.id === 'free' && plan.episodesPerPeriod !== null;
  const share = Math.max(usage.seconds / hoursTotal, plan.episodesPerPeriod !== null ? usage.episodes / plan.episodesPerPeriod : 0);
  // Team members use the owner's plan but have no billing of their own.
  const member = !!workspace?.is_team_member;
  const paid = plan.id !== 'free' && !member;

  return (
    <main className="account-page">
      <h1 className="page-title">Your account</h1>
      <p className="muted">{user?.email}</p>

      {activating && (
        <p className="notice" role="status">
          Thanks! Activating your plan… this usually takes a few seconds.
        </p>
      )}

      <section className="card account-card" aria-label="Plan">
        <div className="account-row">
          <div>
            <p className="eyebrow">Plan</p>
            <h2 className="account-plan">{loading ? '…' : member ? `${plan.name} · team` : plan.name}</h2>
          </div>
          {paid && !demo && (
            <button
              type="button"
              className="btn btn-outline btn-inline"
              disabled={opening}
              onClick={() => {
                setOpening(true);
                setBillingError(null);
                openBillingPortal().catch((e: Error) => {
                  setBillingError(e.message);
                  setOpening(false);
                });
              }}
            >
              Manage billing
            </button>
          )}
        </div>
        {billingError && <p className="error">{billingError}</p>}
        {profile?.subscription_status === 'past_due' && (
          <p className="notice">Your last payment didn't go through. Update your card in billing to keep {plan.name}.</p>
        )}
        {paid && profile?.cancel_at && (
          <p className="notice">
            Your plan is canceled and ends on {DATE.format(new Date(profile.cancel_at))}. You'll move to Free after that.
          </p>
        )}
        {paid && !profile?.cancel_at && profile?.current_period_end && (
          <p className="muted small">
            Renews {profile.billing === 'yearly' ? 'yearly' : 'monthly'} on {DATE.format(new Date(profile.current_period_end))}.
          </p>
        )}

        <p className="eyebrow usage-label">This {plan.period}</p>
        <div className="usage-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(1, share) * 100)}>
          <i style={{ width: `${Math.min(1, share) * 100}%` }} className={share >= 1 ? 'full' : ''} />
        </div>
        <p className="usage-text">
          {byEpisodes
            ? `${usage.episodes} of ${plan.episodesPerPeriod} episode${plan.episodesPerPeriod === 1 ? '' : 's'} used`
            : `${formatDuration(usage.seconds)} of ${plan.hours} hours used` +
              (plan.episodesPerPeriod !== null ? ` · ${usage.episodes} of ${plan.episodesPerPeriod} episodes` : '')}
          <span className="muted"> · resets {DATE.format(period.end)}</span>
        </p>
        {cloudAvailable && !demo && (
          <p className="usage-text">
            Cloud listening:{' '}
            {plan.cloudJobsPerPeriod !== null
              ? `${cloudUsage.episodes} of ${plan.cloudJobsPerPeriod} episode${plan.cloudJobsPerPeriod === 1 ? '' : 's'} used`
              : `${formatDuration(cloudUsage.seconds)} of ${plan.cloudSeconds / 3600} hours used`}
          </p>
        )}
        <Link to="/new" className="btn btn-primary">
          New episode
        </Link>
      </section>

      <BrandKits />
      <Team />

      {!member && <Pricing />}
    </main>
  );
}
