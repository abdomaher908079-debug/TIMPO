import { ALL_FORMATS, AdtsOutputFormat, BlobSource, BufferTarget, Conversion, getFirstEncodableAudioCodec, Input, OggOutputFormat, Output } from 'mediabunny';
import type { Segment } from './speech';
import { ApiError, getAccessToken, supabase } from './supabase';

// Cloud listening runs on the `transcribe` Supabase Edge Function (Gemini), so it needs Supabase.
export const cloudAvailable = !!supabase;

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, '');
const ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '';
// Must match PIECE_SECONDS in supabase/functions/_shared/transcribe.ts.
const PIECE_SECONDS = 5 * 60;
// Pieces in flight at once: while some are with the AI, the phone prepares the next ones.
const PARALLEL = 4;

/**
 * Whether this device is likely too slow to transcribe in the browser: no graphics card for
 * speech recognition, or a phone or tablet.
 */
export async function deviceLooksSlow(): Promise<boolean> {
  if (/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)) return true;
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return !(await gpu?.requestAdapter());
  } catch {
    return true;
  }
}

/**
 * Transcribes an episode in the cloud: only the audio (never the video) is cut into pieces of a few
 * minutes, and each piece goes to Gemini through our server, which doesn't keep it. `onProgress`
 * gets 0..1. Word timing for captions still happens on the device, clip by clip, when exporting.
 */
export async function transcribeInCloud(
  file: File,
  seconds: number,
  fingerprint: string,
  { signal: outer, onProgress }: { signal: AbortSignal; onProgress: (p: number) => void },
): Promise<Segment[]> {
  if (!cloudAvailable) throw new Error('Cloud listening isn’t available.');
  // When one piece fails, the others stop too.
  const stop = new AbortController();
  const signal = AbortSignal.any([outer, stop.signal]);
  const format = await audioFormat();
  // A last piece shorter than about a minute and a half joins the one before it.
  const count = Math.max(1, Math.round(seconds / PIECE_SECONDS + 0.2));
  const results: Segment[][] = [];
  let done = 0;
  const run = async (i: number) => {
    const start = i * PIECE_SECONDS;
    const end = i === count - 1 ? seconds : start + PIECE_SECONDS;
    const audio = await extractAudio(file, start, end, format, signal);
    results[i] = await send(audio, { start, length: end - start, seconds, fingerprint }, signal);
    onProgress(++done / count);
  };
  onProgress(0);
  // The plan's limits are checked once, up front, so no audio is prepared for nothing.
  await call(new FormData(), { seconds, fingerprint }, signal);
  let next = 0;
  const worker = async () => {
    while (next < count) await run(next++);
  };
  try {
    await Promise.all(Array.from({ length: Math.min(PARALLEL, count) }, worker));
  } finally {
    stop.abort();
  }
  return results.flat();
}

interface AudioFormat {
  codec: 'opus' | 'aac';
  sampleRate: number;
}

// Speech-quality audio in a format Gemini reads: Opus in Ogg, or AAC where Opus can't be encoded.
async function audioFormat(): Promise<AudioFormat> {
  // Some AAC encoders don't do 16 kHz.
  for (const sampleRate of [16000, 48000]) {
    const codec = await getFirstEncodableAudioCodec(['opus', 'aac'], { numberOfChannels: 1, sampleRate });
    if (codec === 'opus' || codec === 'aac') return { codec, sampleRate };
  }
  throw new Error("This browser can't prepare audio for cloud listening. Try the latest Chrome or Safari.");
}

async function extractAudio(file: File, start: number, end: number, { codec, sampleRate }: AudioFormat, signal: AbortSignal): Promise<Blob> {
  const format = codec === 'opus' ? new OggOutputFormat() : new AdtsOutputFormat();
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const output = new Output({ format, target: new BufferTarget() });
    const conversion = await Conversion.init({
      input,
      output,
      showWarnings: false,
      trim: { start, end },
      video: { discard: true },
      audio: { codec, numberOfChannels: 1, sampleRate, bitrate: 32_000, forceTranscode: true },
    });
    if (!conversion.isValid) throw new Error("We couldn't read this episode's audio.");
    const stop = () => void conversion.cancel();
    signal.addEventListener('abort', stop);
    try {
      await conversion.execute();
    } finally {
      signal.removeEventListener('abort', stop);
    }
    if (signal.aborted) throw new DOMException('Canceled', 'AbortError');
    return new Blob([output.target.buffer!], { type: codec === 'opus' ? 'audio/ogg' : 'audio/aac' });
  } finally {
    input.dispose();
  }
}

async function send(
  audio: Blob,
  piece: { start: number; length: number; seconds: number; fingerprint: string },
  signal: AbortSignal,
): Promise<Segment[]> {
  const form = new FormData();
  form.append('audio', audio, audio.type === 'audio/ogg' ? 'piece.ogg' : 'piece.aac');
  return (await call(form, piece, signal)).segments ?? [];
}

async function call(form: FormData, fields: Record<string, string | number>, signal: AbortSignal) {
  for (const [k, v] of Object.entries(fields)) form.append(k, String(v));
  const headers: Record<string, string> = { apikey: ANON_KEY };
  const token = await getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  // One more try for a dropped connection or a busy AI; limits and other answers are final.
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${SUPABASE_URL}/functions/v1/transcribe`, { method: 'POST', headers, body: form, signal });
    } catch (err) {
      if (signal.aborted) throw err;
      if (attempt < 1) continue;
      throw new Error('We couldn’t reach our server. Check your internet connection and try again.');
    }
    const data = (await res.json().catch(() => ({}))) as { segments?: Segment[]; ok?: boolean; error?: string; reason?: string };
    if (res.ok && (data.segments || data.ok)) return data;
    if (attempt < 1 && (res.status >= 500 || res.status === 429)) {
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }
    throw new ApiError(data.error ?? 'Cloud listening stopped. Please try again.', res.status, data.reason);
  }
}
