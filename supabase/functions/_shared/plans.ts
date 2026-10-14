// Plan limits and usage rules, shared by the browser (to show them) and the server (to enforce them).
// Web-standard TypeScript only: no Deno or Node globals. Keep in sync with PLAN.md.

export type PlanId = 'free' | 'pro' | 'studio';
export type Billing = 'monthly' | 'yearly';

export interface PlanLimits {
  id: PlanId;
  // Usage resets every week (Free, from Monday 00:00 UTC) or every billing month (paid).
  period: 'week' | 'month';
  // Hours of episodes per period.
  hours: number;
  // Longest single episode, or null for any length.
  maxEpisodeSeconds: number | null;
  // Episodes per period, or null for no count limit (only hours).
  episodesPerPeriod: number | null;
  clipsFound: number;
  clipsExportable: number;
  watermark: boolean;
  maxExport: '1080p' | '4k';
}

export const LIMITS: Record<PlanId, PlanLimits> = {
  free: {
    id: 'free',
    period: 'week',
    hours: 0.5,
    maxEpisodeSeconds: 30 * 60,
    episodesPerPeriod: 1,
    clipsFound: 10,
    clipsExportable: 3,
    watermark: true,
    maxExport: '1080p',
  },
  pro: {
    id: 'pro',
    period: 'month',
    hours: 10,
    maxEpisodeSeconds: null,
    episodesPerPeriod: null,
    clipsFound: 20,
    clipsExportable: 20,
    watermark: false,
    maxExport: '4k',
  },
  studio: {
    id: 'studio',
    period: 'month',
    hours: 20,
    maxEpisodeSeconds: null,
    episodesPerPeriod: null,
    clipsFound: 30,
    clipsExportable: 30,
    watermark: false,
    maxExport: '4k',
  },
};

// Container durations often run a fraction of a second long; don't block a 30:00 episode over that.
export const GRACE_SECONDS = 30;

export interface Period {
  start: Date;
  end: Date;
}

/** The usage period containing `now`: the paid billing period if there is one, else the Free week. */
export function currentPeriod(plan: PlanId, now: Date, billingPeriod?: { start: string | null; end: string | null }): Period {
  if (plan !== 'free' && billingPeriod?.start && billingPeriod.end) {
    const start = new Date(billingPeriod.start);
    const end = new Date(billingPeriod.end);
    if (start <= now && now < end) return { start, end };
  }
  if (LIMITS[plan].period === 'month') {
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

export type LimitReason = 'too-long' | 'no-episodes-left' | 'no-hours-left';

export interface LimitProblem {
  reason: LimitReason;
  message: string;
}

function hm(seconds: number): string {
  const m = Math.round(seconds / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m} min`;
}

/** Whether an episode of `seconds` fits the plan's limits, given this period's usage. */
export function checkEpisode(plan: PlanId, usage: Usage, seconds: number): LimitProblem | null {
  const l = LIMITS[plan];
  if (l.maxEpisodeSeconds !== null && seconds > l.maxEpisodeSeconds + GRACE_SECONDS) {
    return { reason: 'too-long', message: `Episodes on your plan can be up to ${hm(l.maxEpisodeSeconds)} long. This one is ${hm(seconds)}.` };
  }
  if (l.episodesPerPeriod !== null && usage.episodes >= l.episodesPerPeriod) {
    return {
      reason: 'no-episodes-left',
      message: `You've used your ${l.episodesPerPeriod === 1 ? 'episode' : `${l.episodesPerPeriod} episodes`} for this ${l.period}.`,
    };
  }
  const left = l.hours * 3600 - usage.seconds;
  if (seconds > left + GRACE_SECONDS) {
    return { reason: 'no-hours-left', message: `This episode is ${hm(seconds)} and you have ${hm(Math.max(0, left))} left this ${l.period}.` };
  }
  return null;
}

export interface ProfileRow {
  plan: PlanId;
  billing: Billing | null;
  subscription_status: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at: string | null;
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
