// Plan limits and usage rules, shared by the browser (to show them) and the server (to enforce them).
// Web-standard TypeScript only: no Deno or Node globals. Keep in sync with PLAN.md.

export type PlanId = 'free' | 'pro' | 'studio';
// Free gets our quick AI (free services). Paid plans get our best AI: a larger speech model and the
// strongest Gemini model on a paid API key. Pro and Studio are equally smart; they differ in hours and extras.
export type Quality = 'quick' | 'best';
export type Billing = 'monthly' | 'yearly';

export interface PlanLimits {
  id: PlanId;
  // Usage resets every week (Free, from Monday 00:00 UTC) or every billing month (paid).
  period: 'week' | 'month';
  // Hours of episodes per period.
  hours: number;
  // Longest single episode, or null for any length.
  maxEpisodeSeconds: number | null;
  // Episodes per period, or null for no count limit (only hours). Each AI request costs about the
  // same whatever the episode's length, so paid plans have a count too (far above normal use).
  episodesPerPeriod: number | null;
  clipsFound: number;
  clipsExportable: number;
  watermark: boolean;
  maxExport: '1080p' | '4k';
  quality: Quality;
  // Cloud listening (for phones and slow computers): seconds of audio per period, episodes per period
  // (null = only seconds). Enforced by the transcribe function.
  cloudSeconds: number;
  cloudJobsPerPeriod: number | null;
}

// Early access: while paid plans are closed (VITE_PAYMENTS_OPEN), Free is more generous. Set to false when
// payments open, so Free goes back to its normal limits.
export const EARLY_ACCESS = true;

export const LIMITS: Record<PlanId, PlanLimits> = {
  free: EARLY_ACCESS
    ? {
        id: 'free',
        period: 'week',
        hours: 6,
        maxEpisodeSeconds: 2 * 3600,
        episodesPerPeriod: 3,
        clipsFound: 10,
        clipsExportable: 10,
        watermark: true,
        maxExport: '1080p',
        quality: 'quick',
        cloudSeconds: 6 * 3600,
        cloudJobsPerPeriod: 3,
      }
    : {
        id: 'free',
        period: 'week',
        hours: 0.5,
        maxEpisodeSeconds: 30 * 60,
        episodesPerPeriod: 1,
        clipsFound: 10,
        clipsExportable: 3,
        watermark: true,
        maxExport: '1080p',
        quality: 'quick',
        cloudSeconds: 30 * 60,
        cloudJobsPerPeriod: 1,
      },
  pro: {
    id: 'pro',
    period: 'month',
    hours: 20,
    maxEpisodeSeconds: null,
    episodesPerPeriod: 40,
    clipsFound: 20,
    clipsExportable: 20,
    watermark: false,
    maxExport: '4k',
    quality: 'best',
    cloudSeconds: 3 * 3600,
    cloudJobsPerPeriod: null,
  },
  studio: {
    id: 'studio',
    period: 'month',
    hours: 40,
    maxEpisodeSeconds: null,
    episodesPerPeriod: 100,
    clipsFound: 30,
    clipsExportable: 30,
    watermark: false,
    maxExport: '4k',
    quality: 'best',
    cloudSeconds: 10 * 3600,
    cloudJobsPerPeriod: null,
  },
};

// Container durations often run a fraction of a second long; don't block a 30:00 episode over that.
export const GRACE_SECONDS = 30;

// Hour packs: one-time, for Pro and Studio, used once the month's own hours or episodes run out. They add
// episodes too (2 per hour, like Pro), since each AI pick costs about the same whatever the episode's length.
export const PACK = { hours: 10, episodes: 20, days: 90, price: 8 };
const PACK_HINT = `Need more? Get +${PACK.hours} hours and +${PACK.episodes} episodes for $${PACK.price} in Plan & settings.`;

// Times the AI may pick the moments of one episode in a period: the first time plus 3 free re-picks.
export const PICKS_PER_EPISODE = 4;

// Faster than anyone speaks (about 15 characters a second is normal): an episode is counted as at least
// its transcript's length divided by this, so a long transcript with made-up short times can't dodge limits.
export const MAX_CHARS_PER_SECOND = 40;

/** Adds whole months in UTC, keeping the day of the month (or the month's last day when it's shorter). */
function addMonths(date: Date, months: number): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + months;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(date.getUTCDate(), last), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()));
}

export interface Period {
  start: Date;
  end: Date;
}

/**
 * The usage period containing `now`. Paid plans: Paddle's billing period when it's a month; yearly
 * plans get a month at a time counted from the start of the year (so their hours come every month);
 * after a late renewal, the month continues from the last start rather than restarting. Without billing dates (set by hand): the calendar month. Free: the week from Monday 00:00 UTC.
 */
export function currentPeriod(plan: PlanId, now: Date, billingPeriod?: { start: string | null; end: string | null }): Period {
  if (LIMITS[plan].period === 'month') {
    const anchor = plan !== 'free' && billingPeriod?.start ? new Date(billingPeriod.start) : null;
    const billingEnd = billingPeriod?.end ? new Date(billingPeriod.end) : null;
    // A monthly subscription inside its paid period: exactly Paddle's period, so usage resets when Paddle
    // renews (Paddle keeps the 31st after a short month; counting months ourselves would drift).
    if (anchor && billingEnd && anchor <= now && now < billingEnd && billingEnd.getTime() - anchor.getTime() <= 32 * 86_400_000) {
      return { start: anchor, end: billingEnd };
    }
    if (anchor && !Number.isNaN(anchor.getTime())) {
      // Months are always counted from the anchor itself, so short months don't shift later ones.
      let k = (now.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + (now.getUTCMonth() - anchor.getUTCMonth());
      if (addMonths(anchor, k) > now) k--;
      if (addMonths(anchor, k + 1) <= now) k++;
      return { start: addMonths(anchor, k), end: addMonths(anchor, k + 1) };
    }
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return { start, end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)) };
  }
  // Weeks start Monday 00:00 UTC.
  const day = (now.getUTCDay() + 6) % 7;
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day));
  return { start, end: new Date(start.getTime() + 7 * 86_400_000) };
}

export interface Usage {
  episodes: number;
  seconds: number;
}

export type LimitReason = 'too-long' | 'no-episodes-left' | 'no-hours-left' | 'no-repicks-left';

export interface LimitProblem {
  reason: LimitReason;
  message: string;
}

function hm(seconds: number): string {
  const m = Math.round(seconds / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m} min`;
}

/** The message for a limit the episode doesn't fit. `left` is the time left this period (for no-hours-left). */
export function limitProblem(plan: PlanId, reason: LimitReason, seconds: number, left = 0): LimitProblem {
  const l = LIMITS[plan];
  switch (reason) {
    case 'too-long':
      return { reason, message: `Episodes on your plan can be up to ${hm(l.maxEpisodeSeconds ?? 0)} long. This one is ${hm(seconds)}.` };
    case 'no-episodes-left':
      return {
        reason,
        message:
          `You've used your ${l.episodesPerPeriod === 1 ? 'episode' : `${l.episodesPerPeriod} episodes`} for this ${l.period}.` +
          (plan === 'free' ? '' : ` ${PACK_HINT}`),
      };
    case 'no-hours-left':
      return {
        reason,
        message: `This episode is ${hm(seconds)} and you have ${hm(Math.max(0, left))} left this ${l.period}.` + (plan === 'free' ? '' : ` ${PACK_HINT}`),
      };
    case 'no-repicks-left':
      return {
        reason,
        message: `The AI has already picked this episode's moments ${PICKS_PER_EPISODE} times this ${l.period}. Your clips from those picks are still yours to edit.`,
      };
  }
}

/**
 * Whether an episode of `seconds` fits the plan's limits, given this period's usage and what's left in
 * hour packs (`packs`, paid plans only). A quick check
 * for the page and before cloud listening; the server's reserve_pick (in the database) is the one that
 * counts, in a single locked step.
 */
export function checkEpisode(plan: PlanId, usage: Usage, seconds: number, packs: Usage = { episodes: 0, seconds: 0 }): LimitProblem | null {
  const l = LIMITS[plan];
  if (plan === 'free') packs = { episodes: 0, seconds: 0 };
  if (l.maxEpisodeSeconds !== null && seconds > l.maxEpisodeSeconds + GRACE_SECONDS) return limitProblem(plan, 'too-long', seconds);
  if (l.episodesPerPeriod !== null && usage.episodes >= l.episodesPerPeriod + packs.episodes) return limitProblem(plan, 'no-episodes-left', seconds);
  const left = Math.max(0, l.hours * 3600 - usage.seconds) + packs.seconds;
  if (seconds > left + GRACE_SECONDS) return limitProblem(plan, 'no-hours-left', seconds, left);
  return null;
}

export interface ProfileRow {
  plan: PlanId;
  // Studio seats beyond the 3 included (missing in demo mode).
  extra_seats?: number;
  // A downgrade waiting for the end of the paid period (change-plan).
  pending_plan?: 'pro' | 'studio' | null;
  pending_billing?: Billing | null;
  billing: Billing | null;
  subscription_status: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at: string | null;
}

/**
 * The workspace a user works in (from the database's workspace_of): their own account, or the
 * Studio team they're in. Its plan is already the effective plan.
 */
export interface WorkspaceRow {
  owner_id: string;
  plan: PlanId;
  billing: Billing | null;
  subscription_status: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at: string | null;
  is_team_member: boolean;
}

/**
 * The plan a profile is entitled to. A subscription canceled by the user stays `active` until its
 * paid period ends (with `cancel_at` set); `canceled` and `paused` mean it has ended.
 */
export function effectivePlan(profile: ProfileRow | null): PlanId {
  if (!profile || profile.plan === 'free') return 'free';
  const status = profile.subscription_status;
  return status === 'active' || status === 'trialing' || status === 'past_due' ? profile.plan : 'free';
}

/**
 * Whether an episode of `seconds` fits the plan's cloud listening this period (mirrors checkEpisode).
 * Listening the same episode again doesn't count as another episode, but its time does: every piece of
 * audio heard is counted (reserve_cloud in the database), so the check needs the time left either way.
 */
export function checkCloud(plan: PlanId, usage: Usage, seconds: number, repeat = false): LimitProblem | null {
  const l = LIMITS[plan];
  if (!repeat && l.cloudJobsPerPeriod !== null && usage.episodes >= l.cloudJobsPerPeriod) return cloudProblem(plan, 'no-episodes-left', seconds);
  const left = l.cloudSeconds - usage.seconds;
  if (seconds > left + GRACE_SECONDS) return cloudProblem(plan, 'no-hours-left', seconds, left);
  return null;
}

export function cloudProblem(plan: PlanId, reason: 'no-episodes-left' | 'no-hours-left', seconds: number, left = 0): LimitProblem {
  const l = LIMITS[plan];
  return reason === 'no-episodes-left'
    ? { reason, message: `You've used your cloud listening for this ${l.period}. You can still listen on this device, or upgrade for more.` }
    : { reason, message: `This episode needs ${hm(seconds)} of cloud listening and you have ${hm(Math.max(0, left))} left this ${l.period}. You can still listen on this device.` };
}
