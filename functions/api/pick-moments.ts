// Cloudflare Pages Function: POST /api/pick-moments, the AI step for the live site in demo mode
// (no Supabase yet). Same code as the dev server's endpoint (vite.config.ts); the Gemini key is a
// secret on the Cloudflare Pages project, never sent to the browser. Once Supabase is set up, the
// site calls the pick-moments Supabase function instead (logins and plan limits) and this one can
// be turned off by removing GEMINI_API_KEY from the Pages project.
import { geminiFor, MomentsError, parseRequest, pickMoments } from '../../supabase/functions/_shared/moments';

interface Env {
  GEMINI_API_KEY?: string;
  GEMINI_PAID_API_KEY?: string;
  GEMINI_MODEL_QUICK?: string;
  GEMINI_MODEL_BEST?: string;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export async function onRequestPost({ request, env }: { request: Request; env: Env }): Promise<Response> {
  try {
    // Only our own pages may use it, so other sites can't spend the AI quota from visitors' browsers.
    const origin = request.headers.get('Origin');
    if (origin && new URL(origin).host !== new URL(request.url).host) return json(403, { error: 'Not allowed.' });
    const body = (await request.json().catch(() => null)) as { quality?: string } | null;
    const quality = body?.quality === 'best' ? 'best' : 'quick';
    const gemini = geminiFor(quality, (name) => env[name as keyof Env]);
    if (!gemini) throw new MomentsError('The AI isn’t set up on the server yet.', 503);
    const moments = await pickMoments(parseRequest(body), gemini);
    return json(200, { moments });
  } catch (err) {
    if (err instanceof MomentsError) return json(err.status, { error: err.message });
    console.error(err);
    return json(500, { error: 'Something went wrong. Please try again.' });
  }
}
