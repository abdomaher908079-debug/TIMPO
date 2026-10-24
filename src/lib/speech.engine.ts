/// <reference lib="webworker" />
// Whisper, run inside speech.worker.ts (off the main thread, so the page stays responsive).
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import ortMjs from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';
import type { Segment } from '../../supabase/functions/_shared/moments';
import type { Word, WorkerRequest, WorkerResponse } from './speech';
import { speechGpu } from './device';
import { steadyFetch } from './steadyFetch';

// English-only Whisper: more accurate on English than the multilingual models of the same size.
// The "timestamped" builds have the extra outputs needed for exact word times (clip captions), so
// one download does both jobs.
// Quick AI (Free): base, ~200 MB, fast everywhere.
const QUICK_MODEL = 'onnx-community/whisper-base.en_timestamped';
// Best AI (Pro, Studio): small, ~400 MB, noticeably more accurate but about 3× slower, so only
// with a graphics card. Without one, paid plans use the quick model (cloud listening covers them).
const BEST_MODEL = 'onnx-community/whisper-small.en_timestamped';
// Caption timing on phones: tiny, ~40 MB, 2–3× faster than base. Only its word times are used; the
// words themselves come from the episode's transcript (see alignWords in clips.ts).
const TIMING_MODEL = 'onnx-community/whisper-tiny.en_timestamped';
const SAMPLE_RATE = 16_000;
// Lines that end this close to the end of a piece may be cut off; they're redone with the next piece.
const EDGE_SECONDS = 2;
const MAX_CARRY_SECONDS = 45;

// The speech runtime's small loader comes from our site. Its 27 MB WebAssembly file is too big for
// Cloudflare Pages (25 MB limit), so the live site carries it gzipped and unpacks it here (see
// runtimeBinary), or loads it from VITE_SPEECH_RUNTIME_URL (your R2 copy); see vite.config.ts.
// In development it comes from the local package.
// The models are big; a dropped connection continues where it stopped instead of failing.
env.fetch = steadyFetch;
env.backends.onnx.wasm!.wasmPaths = {
  mjs: ortMjs,
  wasm: import.meta.env.DEV ? '/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm' : __SPEECH_RUNTIME_URL__,
};

declare const self: DedicatedWorkerGlobalScope;

let runtime: Promise<Uint8Array> | null = null;
// Downloads and unpacks our own gzipped copy of the runtime's WebAssembly file (cached by the browser).
function runtimeBinary(): Promise<Uint8Array> {
  runtime ??= (async () => {
    const res = await steadyFetch(__SPEECH_RUNTIME_GZ__);
    if (!res.ok) throw new Error(`Couldn't download the speech runtime (HTTP ${res.status}).`);
    let bytes = new Uint8Array(await res.arrayBuffer());
    // Still gzipped, unless the host already unpacked it (Content-Encoding: gzip).
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
      const unpacked = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      bytes = new Uint8Array(await new Response(unpacked).arrayBuffer());
    }
    // WebAssembly files start with "\0asm".
    if (bytes[0] !== 0 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d) throw new Error('The speech runtime download was damaged.');
    return bytes;
  })();
  runtime.catch(() => (runtime = null));
  return runtime;
}
const post = (msg: WorkerResponse, transfer: Transferable[] = []) => self.postMessage(msg, transfer);

let asr: AutomaticSpeechRecognitionPipeline | null = null;
type Line = { text: string; timestamp: [number, number | null] };
// Audio after the last complete line of the previous piece, prepended to the next one.
let carry = new Float32Array(0);
let carryStart = 0;

async function load(quality: 'quick' | 'best', safe = false, timingOnly = false, isPhone = false) {
  let downloaded = false;
  const progress_callback = (p: { status: string; loaded?: number; total?: number }) => {
    if (p.status !== 'progress_total' || !p.total) return;
    post({ type: 'loading', loaded: p.loaded ?? 0, total: p.total });
    if (!downloaded && (p.loaded ?? 0) >= p.total) {
      downloaded = true;
      post({ type: 'stage', stage: 'starting the speech model' });
    }
  };
  // Safe mode: one thread. Phones: two, so the rest of the phone stays responsive while it listens.
  if (safe) env.backends.onnx.wasm!.numThreads = 1;
  else if (isPhone) env.backends.onnx.wasm!.numThreads = Math.min(2, navigator.hardwareConcurrency || 2);
  if (!import.meta.env.DEV && __SPEECH_RUNTIME_GZ__) {
    post({ type: 'stage', stage: 'downloading the speech runtime' });
    env.backends.onnx.wasm!.wasmBinary = await runtimeBinary();
  }
  // Never the graphics chip on phones: heavy WebGPU work can hang a phone's GPU and restart the phone. Nor for
  // caption timing: the processor's small model times a clip in seconds, and its download is the smallest.
  const useGpu = !safe && !isPhone && !timingOnly;
  if (useGpu) post({ type: 'stage', stage: 'checking the graphics chip' });
  const adapter = useGpu ? await speechGpu() : null;
  if (adapter) {
    const best = quality === 'best';
    try {
      post({ type: 'stage', stage: 'downloading the speech model (graphics chip)' });
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
  downloaded = false;
  post({ type: 'stage', stage: 'downloading the speech model (processor)' });
  asr = (await pipeline('automatic-speech-recognition', timingOnly && isPhone ? TIMING_MODEL : QUICK_MODEL, {
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

export async function handle(e: MessageEvent<WorkerRequest>) {
  const msg = e.data;
  try {
    if (msg.type === 'load') await load(msg.quality, msg.safe, msg.timingOnly, msg.phone);
    else if (msg.type === 'words') await words(msg);
    else await transcribe(msg);
  } catch (err) {
    post({ type: 'error', id: msg.type === 'load' ? undefined : msg.id, message: err instanceof Error ? err.message : String(err) });
  }
}
