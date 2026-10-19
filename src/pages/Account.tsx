import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Team from '../components/Team';
import { useAccount } from '../lib/account';
import { useAuth } from '../lib/auth';
import { keepPlan, openBillingPortal, PACK_PRICE_ID, paymentsReady, startPackCheckout } from '../lib/billing';
import { PACK } from '../../supabase/functions/_shared/plans';
import { cloudAvailable } from '../lib/cloud';
import { formatDuration } from '../lib/format';

const DATE = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'long', day: 'numeric' });

export default function Account() {
  const { user, demo, signOut } = useAuth();
  const { plan, profile, workspace, period, usage, cloudUsage, packs, loading, refresh } = useAccount();
  const [params, setParams] = useSearchParams();
  const [billingError, setBillingError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [keeping, setKeeping] = useState(false);
  const [keepError, setKeepError] = useState<string | null>(null);

  function billing(target?: 'payment') {
    setOpening(true);
    setBillingError(null);
    openBillingPortal(target).catch((e: Error) => {
      setBillingError(e.message);
      setOpening(false);
    });
  }

  function keep() {
    setKeeping(true);
    setKeepError(null);
    keepPlan()
      .then(() => refresh())
      .catch((e: Error) => setKeepError(e.message))
      .finally(() => setKeeping(false));
  }
  // Back from checkout: the plan changes once Paddle tells our server, usually within seconds.
  const [activating, setActivating] = useState(params.get('upgraded') === '1');
  // Back from buying an hour pack: it shows up the same way.
  const [packPending, setPackPending] = useState(params.get('pack') === '1');
  // What the packs held when the page first loaded: the new pack shows up as more than that.
  const [packStart, setPackStart] = useState<number | null>(null);
  useEffect(() => {
    if (!loading && packStart === null) setPackStart(packs.seconds);
  }, [loading, packStart, packs.seconds]);

  useEffect(() => {
    if (!packPending || packStart === null) return;
    if (packs.seconds > packStart) {
      setPackPending(false);
      setParams({}, { replace: true });
      return;
    }
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > 60_000) {
        clearInterval(timer);
        setPackPending(false);
      } else void refresh();
    }, 2000);
    return () => clearInterval(timer);
  }, [packPending, packs.seconds, packStart, refresh, setParams]);

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
      <h1 className="page-title">Plan & settings</h1>
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
              onClick={() => billing()}
            >
              Invoices & billing
            </button>
          )}
        </div>
        {billingError && <p className="error">{billingError}</p>}
        {paid && profile?.subscription_status === 'past_due' && (
          <div className="notice notice-error">
            <p>Your last payment didn't go through. We'll try again, and you keep {plan.name} meanwhile. Update your card so you don't lose it.</p>
            <button type="button" className="btn btn-primary btn-inline" disabled={opening} onClick={() => billing('payment')}>
              Update card
            </button>
          </div>
        )}
        {paid && profile?.cancel_at && (
          <div className="notice">
            <p>Your plan is canceled and ends on {DATE.format(new Date(profile.cancel_at))}. You'll move to Free after that.</p>
            <button type="button" className="btn btn-outline btn-inline" disabled={keeping} onClick={keep}>
              Keep my plan
            </button>
          </div>
        )}
        {paid && !profile?.cancel_at && profile?.pending_plan && profile.pending_billing && (
          <div className="notice">
            <p>
              Switching to {profile.pending_plan === 'pro' ? 'Pro' : 'Studio'} {profile.pending_billing}
              {profile.current_period_end ? ` on ${DATE.format(new Date(profile.current_period_end))}` : ' at the end of this period'}.
              You keep {plan.name} until then.
            </p>
            <button type="button" className="btn btn-outline btn-inline" disabled={keeping} onClick={keep}>
              Keep {plan.name} {profile.billing}
            </button>
          </div>
        )}
        {keepError && <p className="error">{keepError}</p>}
        {paid && !profile?.cancel_at && profile?.current_period_end && (
          <p className="muted small">
            {plan.name} {profile.billing} · renews on {DATE.format(new Date(profile.current_period_end))}.{' '}
            <Link to="/pricing">Change plan</Link>
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
        {plan.id === 'free' && !demo && (packs.seconds > 0 || packs.episodes > 0) && (
          <div className="pack-box">
            <p className="usage-text">
              <b>Gift from Isla:</b> {formatDuration(packs.seconds)} and {packs.episodes} episode{packs.episodes === 1 ? '' : 's'} left
              {packs.expires ? `, until ${DATE.format(packs.expires)}` : ''}
            </p>
            <p className="muted small">Used after this {plan.period}'s own hours or episodes run out.</p>
          </div>
        )}
        {plan.id !== 'free' && !demo && (
          <div className="pack-box">
            <p className="usage-text">
              <b>Extra hours:</b>{' '}
              {packs.seconds > 0 || packs.episodes > 0
                ? `${formatDuration(packs.seconds)} and ${packs.episodes} episode${packs.episodes === 1 ? '' : 's'} left` +
                  (packs.expires ? `, until ${DATE.format(packs.expires)}` : '')
                : 'none'}
            </p>
            {packPending && <p className="notice" role="status">Thanks! Adding your extra hours… this usually takes a few seconds.</p>}
            <p className="muted small">
              Ran out before the month ends? Get +{PACK.hours} hours and +{PACK.episodes} episodes for ${PACK.price}, one time,
              usable for {PACK.days} days. They're used only after your monthly hours or episodes run out. Episodes come with
              the hours because each AI pick costs about the same whatever an episode's length, so lots of short files count
              as episodes rather than hours. Cloud listening isn't included.
            </p>
            {!member && paymentsReady && PACK_PRICE_ID && (
              <button type="button" className="btn btn-outline btn-inline" onClick={startPackCheckout}>
                Get +{PACK.hours} hours · ${PACK.price}
              </button>
            )}
          </div>
        )}
        {cloudAvailable && !demo && (
          <p className="usage-text">
            Cloud listening:{' '}
            {plan.cloudJobsPerPeriod !== null
              ? `${cloudUsage.episodes} of ${plan.cloudJobsPerPeriod} episode${plan.cloudJobsPerPeriod === 1 ? '' : 's'} used`
              : `${formatDuration(cloudUsage.seconds)} of ${plan.cloudSeconds / 3600} hours used`}
          </p>
        )}
      </section>

      <Team />

      {!member && (
        <p className="account-plans-link">
          <Link to="/pricing" className="btn btn-outline btn-inline">
            {plan.id === 'free' ? 'See plans' : 'Compare plans'}
          </Link>
        </p>
      )}
      {/* Phones have no sidebar, so logging out lives here too. */}
      <p className="account-logout">
        <button type="button" className="link-button" onClick={() => void signOut()}>
          Log out
        </button>
      </p>
    </main>
  );
}
