// Supabase Edge Function: cloud listening that keeps going after people leave the page.
// The browser cuts the episode's audio (never the video) into pieces, uploads them to the private
// `listen-audio` bucket and tells us; we transcribe each piece with Gemini (deleting the audio
// right after), then pick the best moments, all on our own. The browser just checks back.
//   { action: 'create', seconds, fingerprint, fileName } → { job, waiting: [{ idx, start, length }] }
//     Checks the plan's limits. The same episode again continues its unfinished job.
//   { action: 'uploaded', job, idx }  a piece is uploaded; starts working on it.
//   { action: 'kick', job }           makes sure a job that stalled keeps going.
//   { action: 'cancel', job }         stops a job and deletes its audio.
// Work runs in steps of under 2 minutes (the free plan's limit), each starting the next.
// Secrets: GEMINI_API_KEY (and GEMINI_PAID_API_KEY). Deploy: supabase functions deploy listen --no-verify-jwt
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { geminiFor, MomentsError, pickMoments, type Segment } from '../_shared/moments.ts';
import { checkCloud, checkEpisode, currentPeriod, LIMITS, type PlanId, type WorkspaceRow } from '../_shared/plans.ts';
import { listen, listenerFor, PIECE_SECONDS } from '../_shared/transcribe.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SELF_URL = `${Deno.env.get('SUPABASE_URL')}/functions/v1/listen`;
const admin = createClient(Deno.env.get('SUPABASE_URL')!, SERVICE_KEY, { auth: { persistSession: false } });
const BUCKET = 'listen-audio';
// Pieces transcribed at once by one step, and how long a step keeps taking more.
const PARALLEL = 4;
const STEP_MS = 75_000;
const MAX_ATTEMPTS = 3;
const KEEP_DAYS = 7;

interface Job {
  id: string;
  user_id: string;
  workspace_id: string;
  fingerprint: string;
  seconds: number;
  pieces: number;
  status: string;
}

/** How an episode is cut into pieces: about 5 minutes each, a short last piece joins the one before. */
function pieces(seconds: number) {
  const count = Math.max(1, Math.round(seconds / PIECE_SECONDS + 0.2));
  return Array.from({ length: count }, (_, idx) => {
    const start = idx * PIECE_SECONDS;
    return { idx, start, length: (idx === count - 1 ? seconds : start + PIECE_SECONDS) - start };
  });
}

async function workspaceOf(userId: string) {
  const { data, error } = await admin.rpc('workspace_of', { uid: userId }).maybeSingle<WorkspaceRow>();
  if (error) throw error;
  const plan: PlanId = data?.plan ?? 'free';
  const period = currentPeriod(plan, new Date(), { start: data?.current_period_start ?? null, end: data?.current_period_end ?? null });
  return { plan, workspaceId: data?.owner_id ?? userId, periodStart: period.start.toISOString() };
}

async function create(userId: string, body: { seconds?: unknown; fingerprint?: unknown; fileName?: unknown }) {
  const seconds = Number(body.seconds);
  const fingerprint = String(body.fingerprint ?? '').slice(0, 128);
  if (!fingerprint || !(seconds > 0 && seconds <= 12 * 3600)) throw new MomentsError('Invalid episode.', 400);

  await cleanUp();

  // The same episode again: continue its job, or hand back its results.
  const { data: existing } = await admin
    .from('listen_jobs')
    .select('id, status')
    .eq('user_id', userId)
    .eq('fingerprint', fingerprint)
    .neq('status', 'error')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; status: string }>();
  if (existing) {
    const { data: waiting } = await admin.from('listen_pieces').select('idx, start, length').eq('job_id', existing.id).eq('status', 'waiting').order('idx');
    if (existing.status !== 'uploading' && existing.status !== 'listening') return { job: existing.id, waiting: [] };
    EdgeRuntime.waitUntil(work(existing.id));
    return { job: existing.id, waiting: waiting ?? [] };
  }

  const { plan, workspaceId, periodStart } = await workspaceOf(userId);
  const [cloud, episodes] = await Promise.all([
    admin.from('cloud_jobs').select('fingerprint, seconds').eq('workspace_id', workspaceId).eq('period_start', periodStart),
    admin.from('episodes').select('fingerprint, seconds').eq('workspace_id', workspaceId).eq('period_start', periodStart),
  ]);
  if (cloud.error) throw cloud.error;
  if (episodes.error) throw episodes.error;
  const used = (rows: { seconds: number }[]) => ({ episodes: rows.length, seconds: rows.reduce((n, r) => n + Number(r.seconds), 0) });
  // Trying the same episode again this period is free.
  if (!cloud.data.some((r) => r.fingerprint === fingerprint)) {
    const problem =
      (episodes.data.some((r) => r.fingerprint === fingerprint) ? null : checkEpisode(plan, used(episodes.data), seconds)) ??
      checkCloud(plan, used(cloud.data), seconds);
    if (problem) return { error: problem.message, reason: problem.reason, status: 403 };
    const { error } = await admin
      .from('cloud_jobs')
      .upsert(
        { user_id: userId, workspace_id: workspaceId, fingerprint, seconds, period_start: periodStart },
        { onConflict: 'workspace_id,fingerprint,period_start', ignoreDuplicates: true },
      );
    if (error) throw error;
  }

  const list = pieces(seconds);
  const { data: job, error } = await admin
    .from('listen_jobs')
    .insert({ user_id: userId, workspace_id: workspaceId, fingerprint, seconds, pieces: list.length, file_name: String(body.fileName ?? '').slice(0, 200) })
    .select('id')
    .single<{ id: string }>();
  if (error) throw error;
  const { error: piecesError } = await admin.from('listen_pieces').insert(list.map((p) => ({ job_id: job.id, ...p })));
  if (piecesError) throw piecesError;
  return { job: job.id, waiting: list };
}

/**
 * Forgets old jobs (any user's) and deletes audio they left behind: finished jobs after a week,
 * and uploads abandoned for a day. A little at a time, whenever someone starts a job.
 */
async function cleanUp() {
  const week = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString();
  const day = new Date(Date.now() - 86_400_000).toISOString();
  const { data: old } = await admin
    .from('listen_jobs')
    .select('id, user_id, status, created_at')
    .or(`created_at.lt.${week},and(status.in.(uploading,listening),updated_at.lt.${day})`)
    .limit(20);
  for (const job of old ?? []) {
    const folder = `${job.user_id}/${job.id}`;
    const { data: files } = await admin.storage.from(BUCKET).list(folder);
    if (files?.length) await admin.storage.from(BUCKET).remove(files.map((f) => `${folder}/${f.name}`));
    if (job.created_at < week) await admin.from('listen_jobs').delete().eq('id', job.id);
    else await admin.from('listen_jobs').update({ status: 'error', error: 'This upload was not finished.' }).eq('id', job.id);
  }
}

const audioPath = (job: Job, idx: number) => `${job.user_id}/${job.id}/${idx}.ogg`;

/** Transcribes uploaded pieces for up to STEP_MS, then hands over to a new step if work is left. */
async function work(jobId: string) {
  const started = Date.now();
  const { data: job } = await admin.from('listen_jobs').select('*').eq('id', jobId).maybeSingle<Job>();
  if (!job || (job.status !== 'listening' && job.status !== 'uploading')) return;
  const { plan } = await workspaceOf(job.user_id);
  const listener = listenerFor(LIMITS[plan].quality, (name) => Deno.env.get(name));
  if (!listener) return fail(job, 'The AI isn’t set up on the server yet.');

  while (Date.now() - started < STEP_MS) {
    const { data: claimed, error } = await admin.rpc('claim_listen_pieces', { p_job: job.id, p_n: PARALLEL });
    if (error) throw error;
    if (!claimed?.length) break;
    await Promise.all(
      (claimed as { idx: number; start: number; length: number; attempts: number }[]).map(async (piece) => {
        try {
          const { data: blob, error: dlError } = await admin.storage.from(BUCKET).download(audioPath(job, piece.idx));
          if (dlError || !blob) throw dlError ?? new Error('missing audio');
          const { segments, usage } = await listen(
            new Uint8Array(await blob.arrayBuffer()),
            blob.type || 'audio/ogg',
            Number(piece.start),
            Number(piece.length),
            listener,
            Deno.env.get('GEMINI_PAID_API_KEY'),
          );
          await admin.from('listen_pieces').update({ status: 'done', segments, usage }).eq('job_id', job.id).eq('idx', piece.idx);
          await admin.storage.from(BUCKET).remove([audioPath(job, piece.idx)]);
        } catch (err) {
          console.error(`job ${job.id} piece ${piece.idx}:`, err);
          if (piece.attempts >= MAX_ATTEMPTS) {
            await fail(job, err instanceof MomentsError ? err.message : 'We couldn’t listen to part of this episode. Please try again.');
          } else {
            await admin.from('listen_pieces').update({ status: 'pending' }).eq('job_id', job.id).eq('idx', piece.idx);
          }
        }
      }),
    );
    const { count } = await admin.from('listen_pieces').select('idx', { count: 'exact', head: true }).eq('job_id', job.id).eq('status', 'done');
    await admin.from('listen_jobs').update({ pieces_done: count ?? 0, updated_at: new Date().toISOString() }).eq('id', job.id).in('status', ['uploading', 'listening']);
  }

  const { data: won } = await admin.rpc('finish_listen_job', { p_job: job.id });
  if (won) return finish(job, plan);
  // Work left (or still uploading): the next step picks it up.
  const { count: left } = await admin.from('listen_pieces').select('idx', { count: 'exact', head: true }).eq('job_id', job.id).in('status', ['pending', 'running']);
  if (left) kickSelf(job.id);
}

function kickSelf(jobId: string) {
  EdgeRuntime.waitUntil(
    fetch(SELF_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ action: 'kick', job: jobId }),
    }).catch((err) => console.error('kick failed', err)),
  );
}

async function fail(job: Job, message: string) {
  await admin.from('listen_jobs').update({ status: 'error', error: message, updated_at: new Date().toISOString() }).eq('id', job.id);
  const { data: files } = await admin.storage.from(BUCKET).list(`${job.user_id}/${job.id}`);
  if (files?.length) await admin.storage.from(BUCKET).remove(files.map((f) => `${job.user_id}/${job.id}/${f.name}`));
}

/** All pieces heard: put the transcript together, pick the moments, and count the episode. */
async function finish(job: Job, plan: PlanId) {
  const { data: rows } = await admin.from('listen_pieces').select('segments').eq('job_id', job.id).order('idx');
  const segments = (rows ?? []).flatMap((r) => (r.segments as Segment[] | null) ?? []);
  let moments = null;
  let error: string | null = null;
  if (!segments.length) error = 'We didn’t hear anyone speaking in this episode.';
  else {
    try {
      const gemini = geminiFor(LIMITS[plan].quality, (name) => Deno.env.get(name));
      if (!gemini) throw new MomentsError('The AI isn’t set up on the server yet.', 503);
      moments = await pickMoments({ segments, count: LIMITS[plan].clipsFound }, gemini);
      const { periodStart } = await workspaceOf(job.user_id);
      await admin
        .from('episodes')
        .upsert(
          { user_id: job.user_id, workspace_id: job.workspace_id, fingerprint: job.fingerprint, seconds: Math.max(job.seconds, segments[segments.length - 1]!.end), period_start: periodStart },
          { onConflict: 'workspace_id,fingerprint,period_start', ignoreDuplicates: true },
        );
    } catch (err) {
      console.error(`job ${job.id} moments:`, err);
      // The transcript is kept; the page can try picking the moments again.
      error = err instanceof MomentsError ? err.message : 'Finding the best moments stopped. Please try again.';
    }
  }
  await admin
    .from('listen_jobs')
    .update({ status: 'done', segments, moments, error, pieces_done: job.pieces, updated_at: new Date().toISOString() })
    .eq('id', job.id);
}

async function ownJob(userId: string | null, jobId: unknown): Promise<Job> {
  const { data: job } = await admin.from('listen_jobs').select('*').eq('id', String(jobId ?? '')).maybeSingle<Job>();
  if (!job || (userId && job.user_id !== userId)) throw new MomentsError('This job has expired. Please start again.', 404);
  return job;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const token = req.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
    // Our own next step, or a signed-in user.
    const internal = token === SERVICE_KEY;
    let userId: string | null = null;
    if (!internal) {
      const { data } = await admin.auth.getUser(token);
      if (!data.user) return json({ error: 'Please sign in again.' }, 401);
      userId = data.user.id;
    }
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    if (body.action === 'create' && userId) {
      const result = await create(userId, body);
      if ('error' in result) return json({ error: result.error, reason: result.reason }, result.status);
      return json(result);
    }
    if (body.action === 'uploaded' && userId) {
      const job = await ownJob(userId, body.job);
      await admin.from('listen_pieces').update({ status: 'pending' }).eq('job_id', job.id).eq('idx', Number(body.idx)).eq('status', 'waiting');
      // Listening starts as soon as pieces arrive; the job leaves "uploading" once all are in.
      const { count } = await admin.from('listen_pieces').select('idx', { count: 'exact', head: true }).eq('job_id', job.id).eq('status', 'waiting');
      if (!count) await admin.from('listen_jobs').update({ status: 'listening', updated_at: new Date().toISOString() }).eq('id', job.id).eq('status', 'uploading');
      EdgeRuntime.waitUntil(work(job.id));
      return json({ ok: true });
    }
    if (body.action === 'cancel' && userId) {
      const job = await ownJob(userId, body.job);
      if (job.status !== 'done') await fail(job, 'Canceled.');
      return json({ ok: true });
    }
    if (body.action === 'kick') {
      const job = await ownJob(userId, body.job);
      EdgeRuntime.waitUntil(work(job.id));
      return json({ ok: true });
    }
    return json({ error: 'Unknown request.' }, 400);
  } catch (err) {
    if (err instanceof MomentsError) return json({ error: err.message }, err.status);
    console.error(err);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
});
