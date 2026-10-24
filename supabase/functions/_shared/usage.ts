// Counting what each workspace uses, on the server. The checks run in the database (reserve_pick,
// reserve_cloud in supabase/migrations/20261017000000_usage_guard.sql), one locked step per workspace,
// with the limits from plans.ts. Every AI request's tokens are logged in ai_calls.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';
import type { AiUsage, Segment } from './moments.ts';
import { GRACE_SECONDS, LIMITS, limitProblem, MAX_CHARS_PER_SECOND, PICKS_PER_EPISODE, type LimitProblem, type LimitReason, type PlanId } from './plans.ts';

/**
 * The time an episode counts as: the longest of the file's length, the last word heard, and what its
 * transcript would take to say, so a shortened or squeezed transcript can't dodge the limits.
 */
export function countedSeconds(segments: Segment[], fileSeconds: number): number {
  const lastWord = segments.length ? segments[segments.length - 1]!.end : 0;
  const chars = segments.reduce((n, s) => n + s.text.length, 0);
  return Math.max(lastWord, Number.isFinite(fileSeconds) ? fileSeconds : 0, chars / MAX_CHARS_PER_SECOND, 0);
}

export type Pick = { ok: true; id: number; isNew: boolean; oldSeconds: number; token: string | null } | { ok: false; problem: LimitProblem };

/**
 * Takes one AI pick for the episode if the plan allows it (see reserve_pick). Once the period's own
 * hours or episodes are used up, paid plans draw on their hour packs.
 */
export async function reservePick(
  admin: SupabaseClient,
  p: { plan: PlanId; workspaceId: string; userId: string; fingerprint: string; seconds: number; periodStart: string },
): Promise<Pick> {
  const l = LIMITS[p.plan];
  const { data, error } = await admin.rpc('reserve_pick', {
    p_workspace: p.workspaceId,
    p_user: p.userId,
    p_fingerprint: p.fingerprint,
    p_seconds: p.seconds,
    p_period: p.periodStart,
    p_max_seconds: l.hours * 3600,
    p_max_episodes: l.episodesPerPeriod,
    p_max_episode_seconds: l.maxEpisodeSeconds,
    p_max_picks: PICKS_PER_EPISODE,
    p_grace: GRACE_SECONDS,
    p_use_packs: p.plan !== 'free',
  });
  if (error) throw error;
  const r = data as { ok: boolean; id?: number; new?: boolean; old_seconds?: number; token?: string; reason?: LimitReason; left?: number };
  if (!r.ok) return { ok: false, problem: limitProblem(p.plan, r.reason ?? 'no-hours-left', p.seconds, Number(r.left ?? 0)) };
  return { ok: true, id: Number(r.id), isNew: !!r.new, oldSeconds: Number(r.old_seconds ?? 0), token: r.token ?? null };
}

/** Gives back a pick the AI couldn't make. Never throws: the original error is what matters. */
export async function releasePick(admin: SupabaseClient, workspaceId: string, pick: Pick): Promise<void> {
  if (!pick.ok) return;
  const { error } = await admin.rpc('release_pick', {
    p_workspace: workspaceId,
    p_id: pick.id,
    p_new: pick.isNew,
    p_old_seconds: pick.oldSeconds,
    p_token: pick.token,
  });
  if (error) console.error('Pick not given back', error);
}

/** Takes `seconds` of cloud listening for a piece of audio; false when it doesn't fit what's left. */
export async function reserveCloud(
  admin: SupabaseClient,
  p: { plan: PlanId; workspaceId: string; userId: string; fingerprint: string; periodStart: string; seconds: number },
): Promise<boolean> {
  const l = LIMITS[p.plan];
  const { data, error } = await admin.rpc('reserve_cloud', {
    p_workspace: p.workspaceId,
    p_user: p.userId,
    p_fingerprint: p.fingerprint,
    p_period: p.periodStart,
    p_seconds: p.seconds,
    p_max_seconds: l.cloudSeconds,
    p_max_jobs: l.cloudJobsPerPeriod,
    p_grace: GRACE_SECONDS,
  });
  if (error) throw error;
  return data === true;
}

/** Gives back cloud listening for a piece the AI couldn't hear. Never throws. */
export async function releaseCloud(
  admin: SupabaseClient,
  p: { workspaceId: string; fingerprint: string; periodStart: string; seconds: number },
): Promise<void> {
  const { error } = await admin.rpc('release_cloud', {
    p_workspace: p.workspaceId,
    p_fingerprint: p.fingerprint,
    p_period: p.periodStart,
    p_seconds: p.seconds,
  });
  if (error) console.error('Cloud listening not given back', error);
}

/** Logs what an AI request used. Never throws: a missing log line must not fail the user's request. */
export async function logAiCall(
  admin: SupabaseClient,
  p: { workspaceId: string; userId: string; kind: 'pick' | 'listen'; usage: AiUsage; seconds?: number },
): Promise<void> {
  const { error } = await admin.from('ai_calls').insert({
    workspace_id: p.workspaceId,
    user_id: p.userId,
    kind: p.kind,
    model: p.usage.model,
    paid: p.usage.paid,
    input_tokens: p.usage.input,
    output_tokens: p.usage.output,
    seconds: p.seconds ?? null,
  });
  if (error) console.error('AI call not logged', error);
}
