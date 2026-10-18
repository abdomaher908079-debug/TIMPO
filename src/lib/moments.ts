import type { Moment, Segment } from '../../supabase/functions/_shared/moments';
import { ApiError, callFunction, supabase } from './supabase';

export type { Moment };

/** The AI's daily limit was reached: the episode waits in line on our server, as the cloud job `jobId`. */
export class InLine extends Error {
  constructor(readonly jobId: string) {
    super('In line for the AI');
  }
}

export interface EpisodeRef {
  // Identifies the video file, so retrying the same episode isn't counted twice.
  fingerprint: string;
  seconds: number;
}

/** A stable ID for a video file, from its name, size, date and length. Nothing is uploaded. */
export async function fingerprint(file: File, seconds: number): Promise<string> {
  const text = `${file.name}|${file.size}|${file.lastModified}|${Math.round(seconds)}`;
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Sends only the transcript text (never audio or video) to find the episode's best moments.
 * With Supabase it goes through the `pick-moments` Edge Function, which also checks and records the
 * plan's usage. In demo mode it goes through the dev server's /api/pick-moments.
 * Either way the Gemini key stays on the server.
 */
export async function findMoments(
  segments: Segment[],
  { count, quality }: { count: number; quality: 'quick' | 'best' },
  episode: EpisodeRef,
  signal?: AbortSignal,
): Promise<Moment[]> {
  if (supabase) {
    const data = await callFunction<{ moments?: Moment[]; waiting?: string }>('pick-moments', { segments, episode }, signal);
    if (data.waiting) throw new InLine(data.waiting);
    return data.moments ?? [];
  }

  let res: Response;
  try {
    res = await fetch('/api/pick-moments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ segments, count, quality, episode }),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new Error('We couldn’t reach our AI. Check your internet connection and try again.');
  }
  const body = (await res.json().catch(() => ({}))) as { moments?: Moment[]; error?: string };
  if (!res.ok || !body.moments) throw new ApiError(body.error ?? 'Our AI couldn’t read this episode. Please try again.', res.status);
  return body.moments;
}
