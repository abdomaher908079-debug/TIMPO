import type { Moment, Segment } from '../../supabase/functions/_shared/moments';
import { getAccessToken, supabase } from './auth';

export type { Moment };

/**
 * Sends only the transcript text (never audio or video) to find the episode's best moments.
 * With Supabase it goes through the `pick-moments` Edge Function; in demo mode, through the dev
 * server's /api/pick-moments. Either way the Gemini key stays on the server.
 */
export async function findMoments(segments: Segment[], count: number, signal?: AbortSignal): Promise<Moment[]> {
  let url = '/api/pick-moments';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (supabase) {
    url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/pick-moments`;
    headers.apikey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
    const token = await getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ segments, count }), signal });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new Error('We couldn’t reach our AI. Check your internet connection and try again.');
  }
  const body = (await res.json().catch(() => ({}))) as { moments?: Moment[]; error?: string };
  if (!res.ok || !body.moments) throw new Error(body.error ?? 'Our AI couldn’t read this episode. Please try again.');
  return body.moments;
}
