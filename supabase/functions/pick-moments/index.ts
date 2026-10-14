// Supabase Edge Function: POST { segments, count } → { moments }.
// Keeps the Gemini key on the server; only signed-in users can call it.
// Deploy: supabase secrets set GEMINI_API_KEY=... && supabase functions deploy pick-moments
import { DEFAULT_GEMINI_MODEL, MomentsError, parseRequest, pickMoments } from '../_shared/moments.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

// The anon key is also a valid JWT, so check there's a real user behind the token.
async function isSignedIn(req: Request): Promise<boolean> {
  const auth = req.headers.get('Authorization');
  if (!auth) return false;
  const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/user`, {
    headers: { Authorization: auth, apikey: Deno.env.get('SUPABASE_ANON_KEY') ?? '' },
  });
  return res.ok;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    if (!(await isSignedIn(req))) return json({ error: 'Please sign in again.' }, 401);
    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) throw new MomentsError('The AI isn’t set up on the server yet.', 503);
    const request = parseRequest(await req.json().catch(() => null));
    const moments = await pickMoments(request, { apiKey, model: Deno.env.get('GEMINI_MODEL') || DEFAULT_GEMINI_MODEL });
    return json({ moments });
  } catch (err) {
    if (err instanceof MomentsError) return json({ error: err.message }, err.status);
    console.error(err);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
});
