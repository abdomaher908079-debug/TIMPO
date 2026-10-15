import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  getFirstEncodableAudioCodec,
  Input,
  Mp4OutputFormat,
  Output,
  WebMOutputFormat,
} from 'mediabunny';
import type { Segment, Word } from './speech';
import { getAccessToken } from './supabase';

// Our cloud processing server (server/). Not set = the option isn't offered.
const CLOUD_URL = (import.meta.env.VITE_CLOUD_URL as string | undefined)?.replace(/\/$/, '');
export const cloudAvailable = !!CLOUD_URL;

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

export type CloudStage =
  | { stage: 'extracting'; progress: number }
  | { stage: 'uploading'; progress: number }
  | { stage: 'queued'; position: number }
  | { stage: 'listening'; progress: number };

export interface CloudTranscript {
  segments: Segment[];
  // Exact word times for the whole episode, so exporting clips needs no more speech recognition.
  words: Word[];
}

/**
 * Transcribes an episode on our server: extracts the audio only (mono speech quality, about
 * 15 MB per hour), uploads it, and waits for the transcript. The server deletes the audio once done.
 */
export async function transcribeInCloud(
  file: File,
  seconds: number,
  quality: 'quick' | 'best',
  { signal, onStage }: { signal: AbortSignal; onStage: (s: CloudStage) => void },
): Promise<CloudTranscript> {
  if (!CLOUD_URL) throw new Error('Cloud processing isn’t available.');
  const audio = await extractAudio(file, signal, (p) => onStage({ stage: 'extracting', progress: p }));
  const token = await getAccessToken();
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  const form = new FormData();
  form.append('audio', audio.blob, `episode${audio.extension}`);
  form.append('seconds', String(seconds));
  form.append('quality', quality);
  const created = await upload(`${CLOUD_URL}/jobs`, form, headers, signal, (p) => onStage({ stage: 'uploading', progress: p }));
  const id = created.id as string;

  const cancel = () => void fetch(`${CLOUD_URL}/jobs/${id}`, { method: 'DELETE', headers }).catch(() => {});
  signal.addEventListener('abort', cancel);
  try {
    for (;;) {
      if (signal.aborted) throw new DOMException('Canceled', 'AbortError');
      const res = await fetch(`${CLOUD_URL}/jobs/${id}`, { headers, signal });
      const job = (await res.json().catch(() => ({}))) as {
        status?: string;
        position?: number;
        progress?: number;
        error?: string;
        detail?: string;
        result?: CloudTranscript;
      };
      if (!res.ok) throw new Error(job.detail ?? 'Cloud processing stopped. Please try again.');
      if (job.status === 'done' && job.result) return { segments: job.result.segments, words: job.result.words };
      if (job.status === 'error' || job.status === 'canceled') throw new Error(job.error ?? 'Cloud processing stopped. Please try again.');
      if (job.status === 'queued') onStage({ stage: 'queued', position: job.position ?? 0 });
      else onStage({ stage: 'listening', progress: job.progress ?? 0 });
      await new Promise((r) => setTimeout(r, 2000));
    }
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}

// Speech-quality audio: mono and low bitrate is plenty for transcription and keeps uploads small.
async function extractAudio(file: File, signal: AbortSignal, onProgress: (p: number) => void) {
  let codec = await getFirstEncodableAudioCodec(['opus', 'aac'], { numberOfChannels: 1, sampleRate: 16000 });
  let sampleRate = 16000;
  if (!codec) {
    // Some AAC encoders don't do 16 kHz.
    codec = await getFirstEncodableAudioCodec(['opus', 'aac'], { numberOfChannels: 1, sampleRate: 48000 });
    sampleRate = 48000;
  }
  if (!codec) throw new Error("This browser can't prepare audio for cloud processing. Try the latest Chrome.");
  const format = codec === 'opus' ? new WebMOutputFormat() : new Mp4OutputFormat({ fastStart: 'in-memory' });
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const output = new Output({ format, target: new BufferTarget() });
    const conversion = await Conversion.init({
      input,
      output,
      showWarnings: false,
      video: { discard: true },
      audio: { codec, numberOfChannels: 1, sampleRate, bitrate: 32_000, forceTranscode: true },
    });
    if (!conversion.isValid) throw new Error("We couldn't read this episode's audio.");
    conversion.onProgress = onProgress;
    const stop = () => void conversion.cancel();
    signal.addEventListener('abort', stop);
    try {
      await conversion.execute();
    } finally {
      signal.removeEventListener('abort', stop);
    }
    if (signal.aborted) throw new DOMException('Canceled', 'AbortError');
    return { blob: new Blob([output.target.buffer!], { type: format.mimeType }), extension: format.fileExtension };
  } finally {
    input.dispose();
  }
}

// XMLHttpRequest, because fetch can't report upload progress.
function upload(
  url: string,
  body: FormData,
  headers: Record<string, string>,
  signal: AbortSignal,
  onProgress: (p: number) => void,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(xhr.responseText) as Record<string, unknown>;
      } catch {
        // Not JSON: use the generic message below.
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error((data.detail as string | undefined) ?? 'The upload failed. Please try again.'));
    };
    xhr.onerror = () => reject(new Error('The upload failed. Check your internet connection and try again.'));
    xhr.onabort = () => reject(new DOMException('Canceled', 'AbortError'));
    signal.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(body);
  });
}
