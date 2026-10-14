// Supabase Edge Function: POST { segments, episode: { fingerprint, seconds } } → { moments }.
// Keeps the Gemini key on the server, checks the user's plan limits, and records usage.
// Deploy: supabase secrets set GEMINI_API_KEY=... && supabase functions deploy pick-moments
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { DEFAULT_GEMINI_MODEL, MomentsError, parseRequest, pickMoments } from '../_shared/moments.ts';
import { checkEpisode, currentPeriod, effectivePlan, LIMITS, type ProfileRow } from '../_shared/plans.ts';

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

    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) throw new MomentsError('The AI isn’t set up on the server yet.', 503);
    const body = (await req.json().catch(() => null)) as { episode?: { fingerprint?: unknown; seconds?: unknown } } | null;
    const request = parseRequest(body);
    const fingerprint = typeof body?.episode?.fingerprint === 'string' ? body.episode.fingerprint.slice(0, 128) : '';
    if (!fingerprint) throw new MomentsError('Missing episode details.', 400);
    // The longer of the file's length and the speech heard, so a shortened transcript can't dodge limits.
    const lastWord = request.segments[request.segments.length - 1]!.end;
    const seconds = Math.max(lastWord, Number(body?.episode?.seconds) || 0);

    const now = new Date();
    const { data: profile } = await admin.from('profiles').select('*').eq('id', user.id).maybeSingle<ProfileRow>();
    const plan = effectivePlan(profile);
    const period = currentPeriod(plan, now, { start: profile?.current_period_start ?? null, end: profile?.current_period_end ?? null });
    const periodStart = period.start.toISOString();

    const { data: rows, error } = await admin
      .from('episodes')
      .select('fingerprint, seconds')
      .eq('user_id', user.id)
      .eq('period_start', periodStart);
    if (error) throw error;
    // Trying the same episode again this period is free.
    const repeat = rows.some((r) => r.fingerprint === fingerprint);
    if (!repeat) {
      const usage = { episodes: rows.length, seconds: rows.reduce((n, r) => n + Number(r.seconds), 0) };
      const problem = checkEpisode(plan, usage, seconds);
      if (problem) return json({ error: problem.message, reason: problem.reason }, 403);
    }

    const moments = await pickMoments({ ...request, count: LIMITS[plan].clipsFound }, {
      apiKey,
      model: Deno.env.get('GEMINI_MODEL') || DEFAULT_GEMINI_MODEL,
    });

    // Counted only once the moments are found, so failures don't use up the plan.
    if (!repeat) {
      const { error: insertError } = await admin
        .from('episodes')
        .upsert({ user_id: user.id, fingerprint, seconds, period_start: periodStart }, { onConflict: 'user_id,fingerprint,period_start', ignoreDuplicates: true });
      if (insertError) console.error('Usage not recorded', insertError);
    }
    return json({ moments });
  } catch (err) {
    if (err instanceof MomentsError) return json({ error: err.message }, err.status);
    console.error(err);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
});
