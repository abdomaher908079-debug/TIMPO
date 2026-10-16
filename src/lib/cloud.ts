import { ALL_FORMATS, AdtsOutputFormat, BlobSource, BufferTarget, Conversion, getFirstEncodableAudioCodec, Input, OggOutputFormat, Output } from 'mediabunny';
import type { Moment } from './moments';
import type { Segment } from './speech';
import { ApiError, getAccessToken, supabase } from './supabase';

// Cloud listening runs on the `listen` Supabase Edge Function (Gemini), so it needs Supabase.
export const cloudAvailable = !!supabase;

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, '');
const ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '';
// Pieces prepared and uploaded at once.
const PARALLEL = 3;

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

export interface CloudJob {
  id: string;
  // uploading → listening → finishing → done, or error
  status: 'uploading' | 'listening' | 'finishing' | 'done' | 'error';
  pieces: number;
  pieces_done: number;
  segments: Segment[] | null;
  moments: Moment[] | null;
  error: string | null;
  updated_at: string;
}

/**
 * Starts listening to an episode in the cloud: only the audio (never the video) is cut into pieces
 * of a few minutes and uploaded; our server then transcribes them and picks the moments on its own,
 * so the page can be left once this returns. The same episode again continues where it stopped
 * (only missing pieces are uploaded). `onProgress` gets 0..1 of the upload. Returns the job's id.
 */
export async function sendToCloud(
  file: File,
  seconds: number,
  fingerprint: string,
  { signal: outer, onProgress }: { signal: AbortSignal; onProgress: (p: number) => void },
): Promise<string> {
  if (!supabase) throw new Error('Cloud listening isn’t available.');
  const { job, waiting } = await call<{ job: string; waiting: { idx: number; start: number; length: number }[] }>(
    { action: 'create', seconds, fingerprint, fileName: file.name },
    outer,
  );
  if (!waiting.length) return job;
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) throw new ApiError('Please sign in again.', 401);
  const format = await audioFormat();
  // When one piece fails, the others stop too.
  const stop = new AbortController();
  const signal = AbortSignal.any([outer, stop.signal]);
  let done = 0;
  let next = 0;
  onProgress(0);
  const worker = async () => {
    while (next < waiting.length) {
      const { idx, start, length } = waiting[next++]!;
      const audio = await extractAudio(file, start, start + length, format, signal);
      await uploadPiece(`${userId}/${job}/${idx}.ogg`, audio, signal);
      await call({ action: 'uploaded', job, idx }, signal);
      onProgress(++done / waiting.length);
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(PARALLEL, waiting.length) }, worker));
  } catch (err) {
    stop.abort();
    throw err;
  }
  return job;
}

export async function getJob(id: string): Promise<CloudJob | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('listen_jobs')
    .select('id, status, pieces, pieces_done, segments, moments, error, updated_at')
    .eq('id', id)
    .maybeSingle<CloudJob>();
  if (error) throw error;
  return data;
}

export function cancelJob(id: string) {
  void call({ action: 'cancel', job: id }).catch(() => {});
}

/**
 * Checks back on a job until it's done (or failed), calling `onUpdate` as it moves. Nudges the
 * server if a job seems stalled (e.g. a step of its work stopped).
 */
export async function followJob(id: string, { signal, onUpdate }: { signal: AbortSignal; onUpdate: (job: CloudJob) => void }): Promise<CloudJob> {
  let lastKick = 0;
  for (;;) {
    if (signal.aborted) throw new DOMException('Canceled', 'AbortError');
    const job = await getJob(id);
    if (!job) throw new Error('This episode’s cloud listening has expired. Please start again.');
    onUpdate(job);
    if (job.status === 'done' || job.status === 'error') return job;
    const quiet = Date.now() - new Date(job.updated_at).getTime();
    if (job.status !== 'uploading' && quiet > 60_000 && Date.now() - lastKick > 60_000) {
      lastKick = Date.now();
      void call({ action: 'kick', job: id }).catch(() => {});
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
}

async function uploadPiece(path: string, audio: Blob, signal: AbortSignal) {
  for (let attempt = 0; ; attempt++) {
    if (signal.aborted) throw new DOMException('Canceled', 'AbortError');
    const { error } = await supabase!.storage.from('listen-audio').upload(path, audio, { contentType: audio.type });
    // Already there from an earlier try: fine.
    if (!error || /exists|duplicate/i.test(error.message)) return;
    if (attempt >= 2) throw new Error('The upload failed. Check your internet connection and try again.');
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
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

async function call<T = { ok: boolean }>(body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', apikey: ANON_KEY };
  const token = await getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  // One more try for a dropped connection or a busy server; limits and other answers are final.
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${SUPABASE_URL}/functions/v1/listen`, { method: 'POST', headers, body: JSON.stringify(body), signal });
    } catch (err) {
      if (signal?.aborted) throw err;
      if (attempt < 1) continue;
      throw new Error('We couldn’t reach our server. Check your internet connection and try again.');
    }
    const data = (await res.json().catch(() => ({}))) as T & { error?: string; reason?: string };
    if (res.ok) return data;
    if (attempt < 1 && res.status >= 500) {
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }
    throw new ApiError(data.error ?? 'Cloud listening stopped. Please try again.', res.status, data.reason);
  }
}
