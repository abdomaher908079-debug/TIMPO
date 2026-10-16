// Supabase Edge Function: cloud listening for phones and slow computers.
// POST multipart form { audio, start, length, seconds, fingerprint } → { segments } in episode time.
// Without audio ({ seconds, fingerprint } only) it just checks and records the plan's limits, so the
// browser can then send all the pieces at once.
// The browser sends the episode's audio only (never the video), a few minutes at a time. Each piece
// goes to Gemini to be written down and is not stored. Checks the plan's cloud limits and records
// the episode once (in cloud_jobs). Secrets: GEMINI_API_KEY (and GEMINI_PAID_API_KEY for Best AI).
// Deploy: supabase functions deploy transcribe
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { MomentsError } from '../_shared/moments.ts';
import { checkCloud, checkEpisode, currentPeriod, GRACE_SECONDS, LIMITS, type WorkspaceRow } from '../_shared/plans.ts';
import { audioType, listen, listenerFor, MAX_PIECE_BYTES, PIECE_SECONDS } from '../_shared/transcribe.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const token = req.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
    const { data: auth } = await admin.auth.getUser(token);
    const user = auth.user;
    if (!user) return json({ error: 'Please sign in again.' }, 401);

    const form = await req.formData().catch(() => null);
    const audio = form?.get('audio');
    const start = Number(form?.get('start'));
    const length = Number(form?.get('length'));
    const seconds = Number(form?.get('seconds'));
    const fingerprint = String(form?.get('fingerprint') ?? '').slice(0, 128);
    const checkOnly = audio === null || audio === undefined;
    if (!(checkOnly || audio instanceof File) || !fingerprint) throw new MomentsError('Missing audio.', 400);
    if (!(seconds > 0 && seconds <= 12 * 3600)) throw new MomentsError('Invalid episode length.', 400);
    let type: string | null = null;
    if (audio instanceof File) {
      if (!(start >= 0 && start < seconds + GRACE_SECONDS) || !(length > 0 && length <= PIECE_SECONDS * 2)) {
        throw new MomentsError('Invalid part of the episode.', 400);
      }
      if (audio.size > MAX_PIECE_BYTES) throw new MomentsError('This part of the audio is too large.', 413);
      type = audioType(audio.type);
      if (!type) throw new MomentsError('Unsupported audio format.', 415);
    }

    // Studio team members use the team's plan and share its hours.
    const { data: workspace, error: wsError } = await admin.rpc('workspace_of', { uid: user.id }).maybeSingle<WorkspaceRow>();
    if (wsError) throw wsError;
    const plan = workspace?.plan ?? 'free';
    const workspaceId = workspace?.owner_id ?? user.id;
    const period = currentPeriod(plan, new Date(), { start: workspace?.current_period_start ?? null, end: workspace?.current_period_end ?? null });
    const periodStart = period.start.toISOString();

    const [cloud, episodes] = await Promise.all([
      admin.from('cloud_jobs').select('fingerprint, seconds').eq('workspace_id', workspaceId).eq('period_start', periodStart),
      admin.from('episodes').select('fingerprint, seconds').eq('workspace_id', workspaceId).eq('period_start', periodStart),
    ]);
    if (cloud.error) throw cloud.error;
    if (episodes.error) throw episodes.error;
    const used = (rows: { seconds: number }[]) => ({ episodes: rows.length, seconds: rows.reduce((n, r) => n + Number(r.seconds), 0) });
    // The episode's other parts, and trying the same episode again this period, are already counted.
    if (!cloud.data.some((r) => r.fingerprint === fingerprint)) {
      const problem =
        (episodes.data.some((r) => r.fingerprint === fingerprint) ? null : checkEpisode(plan, used(episodes.data), seconds)) ??
        checkCloud(plan, used(cloud.data), seconds);
      if (problem) return json({ error: problem.message, reason: problem.reason }, 403);
      const { error } = await admin
        .from('cloud_jobs')
        .upsert(
          { user_id: user.id, workspace_id: workspaceId, fingerprint, seconds, period_start: periodStart },
          { onConflict: 'workspace_id,fingerprint,period_start', ignoreDuplicates: true },
        );
      if (error) throw error;
    }

    const listener = listenerFor(LIMITS[plan].quality, (name) => Deno.env.get(name));
    if (!listener) throw new MomentsError('The AI isn’t set up on the server yet.', 503);
    if (!(audio instanceof File) || !type) return json({ ok: true });
    const segments = await listen(new Uint8Array(await audio.arrayBuffer()), type, start, length, listener);
    return json({ segments });
  } catch (err) {
    if (err instanceof MomentsError) return json({ error: err.message }, err.status);
    console.error(err);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
});
