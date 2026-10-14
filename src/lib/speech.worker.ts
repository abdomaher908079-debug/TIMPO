/// <reference lib="webworker" />
// Runs Whisper off the main thread so the page stays responsive during a long episode.
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import ortMjs from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';
import ortWasm from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import type { Segment } from '../../supabase/functions/_shared/moments';
import type { WorkerRequest, WorkerResponse } from './speech';

// English-only Whisper: more accurate on English than the multilingual model of the same size.
const MODEL = 'onnx-community/whisper-base.en';
const SAMPLE_RATE = 16_000;
// Lines that end this close to the end of a piece may be cut off; they're redone with the next piece.
const EDGE_SECONDS = 2;
const MAX_CARRY_SECONDS = 45;

// Serve the speech runtime from our own site rather than a public CDN (the default).
env.backends.onnx.wasm!.wasmPaths = { mjs: ortMjs, wasm: ortWasm };

declare const self: DedicatedWorkerGlobalScope;
const post = (msg: WorkerResponse, transfer: Transferable[] = []) => self.postMessage(msg, transfer);

let asr: AutomaticSpeechRecognitionPipeline | null = null;
type Line = { text: string; timestamp: [number, number | null] };
// Audio after the last complete line of the previous piece, prepended to the next one.
let carry = new Float32Array(0);
let carryStart = 0;

async function hasWebGpu(): Promise<boolean> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return !!(await gpu?.requestAdapter());
  } catch {
    return false;
  }
}

async function load() {
  const progress_callback = (p: { status: string; loaded?: number; total?: number }) => {
    if (p.status === 'progress_total' && p.total) post({ type: 'loading', loaded: p.loaded ?? 0, total: p.total });
  };
  if (await hasWebGpu()) {
    try {
      asr = (await pipeline('automatic-speech-recognition', MODEL, {
        device: 'webgpu',
        dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
        progress_callback,
      })) as AutomaticSpeechRecognitionPipeline;
      return post({ type: 'ready', device: 'webgpu' });
    } catch (err) {
      console.warn('WebGPU speech recognition failed, using the CPU instead.', err);
    }
  }
  asr = (await pipeline('automatic-speech-recognition', MODEL, {
    device: 'wasm',
    dtype: 'q8',
    progress_callback,
  })) as AutomaticSpeechRecognitionPipeline;
  post({ type: 'ready', device: 'wasm' });
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

const round = (t: number) => Math.round(t * 100) / 100;

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  try {
    if (msg.type === 'load') await load();
    else await transcribe(msg);
  } catch (err) {
    post({ type: 'error', id: msg.type === 'transcribe' ? msg.id : undefined, message: err instanceof Error ? err.message : String(err) });
  }
};
