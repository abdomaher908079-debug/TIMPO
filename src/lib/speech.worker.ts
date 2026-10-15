/// <reference lib="webworker" />
// Runs Whisper off the main thread so the page stays responsive during a long episode.
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import ortMjs from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';
import type { Segment } from '../../supabase/functions/_shared/moments';
import type { Word, WorkerRequest, WorkerResponse } from './speech';

// English-only Whisper: more accurate on English than the multilingual models of the same size.
// The "timestamped" builds have the extra outputs needed for exact word times (clip captions), so
// one download does both jobs.
// Quick AI (Free): base, ~200 MB, fast everywhere.
const QUICK_MODEL = 'onnx-community/whisper-base.en_timestamped';
// Best AI (Pro, Studio): small, ~400 MB, noticeably more accurate but about 3× slower, so only
// with a graphics card. Without one, paid plans use the quick model (cloud processing covers them).
const BEST_MODEL = 'onnx-community/whisper-small.en_timestamped';
const SAMPLE_RATE = 16_000;
// Lines that end this close to the end of a piece may be cut off; they're redone with the next piece.
const EDGE_SECONDS = 2;
const MAX_CARRY_SECONDS = 45;

// The speech runtime's small loader comes from our site. Its 27 MB WebAssembly file is too big for
// Cloudflare Pages (25 MB limit), so the live site loads it from VITE_SPEECH_RUNTIME_URL (your R2
// copy) or the jsDelivr CDN; see vite.config.ts. In development it comes from the local package.
env.backends.onnx.wasm!.wasmPaths = {
  mjs: ortMjs,
  wasm: import.meta.env.DEV ? '/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm' : __SPEECH_RUNTIME_URL__,
};

declare const self: DedicatedWorkerGlobalScope;
const post = (msg: WorkerResponse, transfer: Transferable[] = []) => self.postMessage(msg, transfer);

let asr: AutomaticSpeechRecognitionPipeline | null = null;
type Line = { text: string; timestamp: [number, number | null] };
// Audio after the last complete line of the previous piece, prepended to the next one.
let carry = new Float32Array(0);
let carryStart = 0;

interface GpuAdapter {
  features: { has(name: string): boolean };
}

async function gpuAdapter(): Promise<GpuAdapter | null> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<GpuAdapter | null> } }).gpu;
    return (await gpu?.requestAdapter()) ?? null;
  } catch {
    return null;
  }
}

async function load(quality: 'quick' | 'best', safe = false) {
  const progress_callback = (p: { status: string; loaded?: number; total?: number }) => {
    if (p.status === 'progress_total' && p.total) post({ type: 'loading', loaded: p.loaded ?? 0, total: p.total });
  };
  if (safe) env.backends.onnx.wasm!.numThreads = 1;
  const adapter = safe ? null : await gpuAdapter();
  if (adapter) {
    const best = quality === 'best';
    try {
      asr = (await pipeline('automatic-speech-recognition', best ? BEST_MODEL : QUICK_MODEL, {
        device: 'webgpu',
        // Half precision halves the bigger model's download where the graphics card supports it.
        dtype: { encoder_model: best && adapter.features.has('shader-f16') ? 'fp16' : 'fp32', decoder_model_merged: 'q4' },
        progress_callback,
      })) as AutomaticSpeechRecognitionPipeline;
      return post({ type: 'ready', device: 'webgpu', model: best ? 'best' : 'quick' });
    } catch (err) {
      console.warn('WebGPU speech recognition failed, using the CPU instead.', err);
    }
  }
  asr = (await pipeline('automatic-speech-recognition', QUICK_MODEL, {
    device: 'wasm',
    dtype: 'q8',
    progress_callback,
  })) as AutomaticSpeechRecognitionPipeline;
  post({ type: 'ready', device: 'wasm', model: 'quick' });
}

async function transcribe({ id, start, samples, final }: Extract<WorkerRequest, { type: 'transcribe' }>) {
  if (!asr) throw new Error('Speech recognition is not loaded.');
  const pieceStart = carry.length ? carryStart : start;
  const audio = new Float32Array(carry.length + samples.length);
  audio.set(carry);
  audio.set(samples, carry.length);
  const duration = audio.length / SAMPLE_RATE;
  if (duration < 0.1) return post({ type: 'segments', id, segments: [], doneUntil: pieceStart + duration });

  const out = await asr(audio, { chunk_length_s: 30, stride_length_s: 5, return_timestamps: true });
  const lines: Line[] = (Array.isArray(out) ? out[0] : out)?.chunks ?? [];

  let keep = lines.length;
  let cut = duration;
  if (!final) {
    // Keep lines up to the last one that safely ends before the piece does; redo the rest next time.
    keep = 0;
    for (let i = 0; i < lines.length; i++) {
      const end = lines[i]!.timestamp[1];
      if (end === null || end > duration - EDGE_SECONDS) break;
      keep = i + 1;
    }
    cut = keep ? (lines[keep - 1]!.timestamp[1] as number) : Math.max(0, duration - EDGE_SECONDS);
    // No line break found for a long stretch (music, one very long line): move on anyway.
    if (duration - cut > MAX_CARRY_SECONDS) {
      cut = duration - EDGE_SECONDS;
      keep = lines.filter((l) => l.timestamp[1] !== null && l.timestamp[1] <= cut).length;
    }
  }
  carry = final ? new Float32Array(0) : audio.slice(Math.round(cut * SAMPLE_RATE));
  carryStart = pieceStart + cut;

  const segments: Segment[] = [];
  for (const line of lines.slice(0, keep)) {
    const text = line.text.trim();
    // Whisper marks non-speech like "[Music]" or "(laughs)"; those aren't words anyone said.
    if (!text || /^[[(].*[\])]$/.test(text)) continue;
    const [s, e] = line.timestamp;
    segments.push({ start: round(pieceStart + s), end: round(pieceStart + (e ?? duration)), text });
  }
  post({ type: 'segments', id, segments, doneUntil: pieceStart + cut });
}

// Exact word times for one clip's audio, for its captions.
async function words({ id, samples }: Extract<WorkerRequest, { type: 'words' }>) {
  if (!asr) throw new Error('Speech recognition is not loaded.');
  const duration = samples.length / SAMPLE_RATE;
  if (duration < 0.1) return post({ type: 'words', id, words: [] });
  const out = await asr(samples, { chunk_length_s: 30, stride_length_s: 5, return_timestamps: 'word' });
  const lines: Line[] = (Array.isArray(out) ? out[0] : out)?.chunks ?? [];
  const result: Word[] = [];
  for (const line of lines) {
    const text = line.text.trim();
    if (!text || /^[[(].*[\])]$/.test(text)) continue;
    const [s, e] = line.timestamp;
    result.push({ text, start: round(s), end: round(Math.max(s, e ?? duration)) });
  }
  post({ type: 'words', id, words: result });
}

const round = (t: number) => Math.round(t * 100) / 100;

// Errors outside a request (e.g. inside the speech runtime's own threads) would otherwise end the worker
// with no message at all.
self.addEventListener('error', (e) => post({ type: 'error', message: `Uncaught: ${e.message || 'unknown error'}` }));
self.addEventListener('unhandledrejection', (e) =>
  post({ type: 'error', message: `Uncaught: ${e.reason instanceof Error ? e.reason.message : String(e.reason)}` }),
);

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  try {
    if (msg.type === 'load') await load(msg.quality, msg.safe);
    else if (msg.type === 'words') await words(msg);
    else await transcribe(msg);
  } catch (err) {
    post({ type: 'error', id: msg.type === 'load' ? undefined : msg.id, message: err instanceof Error ? err.message : String(err) });
  }
};
