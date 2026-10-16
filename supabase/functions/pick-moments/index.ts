// Supabase Edge Function: POST { segments, episode: { fingerprint, seconds } } → { moments }.
// Keeps the Gemini keys on the server, and checks and counts the plan's limits (see _shared/usage.ts).
// Secrets: GEMINI_API_KEY (free tier, all plans); GEMINI_PAID_API_KEY (billing on, Pro/Studio's best AI).
// Deploy: supabase functions deploy pick-moments
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { geminiFor, MomentsError, parseRequest, pickMoments } from '../_shared/moments.ts';
import { currentPeriod, LIMITS, type WorkspaceRow } from '../_shared/plans.ts';
import { countedSeconds, logAiCall, releasePick, reservePick } from '../_shared/usage.ts';

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
    // The anon key is also a valid JWT, so check there's a real user behind the token.
    const token = req.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
    const { data: auth } = await admin.auth.getUser(token);
    const user = auth.user;
    if (!user) return json({ error: 'Please sign in again.' }, 401);

    const body = (await req.json().catch(() => null)) as { episode?: { fingerprint?: unknown; seconds?: unknown } } | null;
    const request = parseRequest(body);
    const fingerprint = typeof body?.episode?.fingerprint === 'string' ? body.episode.fingerprint.slice(0, 128) : '';
    if (!fingerprint) throw new MomentsError('Missing episode details.', 400);
    const seconds = countedSeconds(request.segments, Number(body?.episode?.seconds));

    // Studio team members use the team's plan and share its hours.
    const { data: workspace, error: wsError } = await admin.rpc('workspace_of', { uid: user.id }).maybeSingle<WorkspaceRow>();
    if (wsError) throw wsError;
    const plan = workspace?.plan ?? 'free';
    const workspaceId = workspace?.owner_id ?? user.id;
    const period = currentPeriod(plan, new Date(), { start: workspace?.current_period_start ?? null, end: workspace?.current_period_end ?? null });

    const gemini = geminiFor(LIMITS[plan].quality, (name) => Deno.env.get(name));
    if (!gemini) throw new MomentsError('The AI isn’t set up on the server yet.', 503);

    // Checked and counted in one locked step, before the AI is asked; given back if it fails.
    const pick = await reservePick(admin, { plan, workspaceId, userId: user.id, fingerprint, seconds, periodStart: period.start.toISOString() });
    if (!pick.ok) return json({ error: pick.problem.message, reason: pick.problem.reason }, 403);
    let moments;
    try {
      const result = await pickMoments({ ...request, count: LIMITS[plan].clipsFound }, gemini);
      moments = result.moments;
      await logAiCall(admin, { workspaceId, userId: user.id, kind: 'pick', usage: result.usage, seconds });
    } catch (err) {
      await releasePick(admin, workspaceId, pick);
      throw err;
    }
    return json({ moments });
  } catch (err) {
    if (err instanceof MomentsError) return json({ error: err.message }, err.status);
    console.error(err);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
});
