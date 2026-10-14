import type { Segment } from '../../supabase/functions/_shared/moments';
import { speechChunks, SPEECH_SAMPLE_RATE, type SpeechChunk } from './audio';

export type { Segment };

export type WorkerRequest =
  | { type: 'load' }
  | { type: 'transcribe'; id: number; start: number; samples: Float32Array; final: boolean };

export type WorkerResponse =
  | { type: 'loading'; loaded: number; total: number }
  | { type: 'ready'; device: 'webgpu' | 'wasm' }
  | { type: 'segments'; id: number; segments: Segment[]; doneUntil: number }
  | { type: 'error'; id?: number; message: string };

// How much audio Whisper gets at a time. Longer pieces mean fewer cut points to stitch.
const PIECE_SECONDS = 60;

export interface TranscribeOptions {
  signal: AbortSignal;
  // Model download, in bytes. Only happens the first time; the browser keeps it afterwards.
  onLoading?: (loaded: number, total: number) => void;
  onReady?: (device: 'webgpu' | 'wasm') => void;
  // Seconds of the episode transcribed so far.
  onProgress?: (seconds: number) => void;
}

/**
 * Transcribes the episode's speech in the browser with Whisper. Audio is decoded one piece ahead
 * of recognition, so only a couple of minutes of audio are ever in memory.
 */
export async function transcribeEpisode(file: File, { signal, onLoading, onReady, onProgress }: TranscribeOptions): Promise<Segment[]> {
  const worker = new Worker(new URL('./speech.worker.ts', import.meta.url), { type: 'module' });
  let fail: (err: Error) => void = () => {};
  const failed = new Promise<never>((_, reject) => (fail = reject));
  failed.catch(() => {});
  const waiting = new Map<number, (r: Extract<WorkerResponse, { type: 'segments' }>) => void>();
  let ready: (device: 'webgpu' | 'wasm') => void = () => {};
  const loaded = new Promise<'webgpu' | 'wasm'>((resolve) => (ready = resolve));

  worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const msg = e.data;
    if (msg.type === 'loading') onLoading?.(msg.loaded, msg.total);
    else if (msg.type === 'ready') ready(msg.device);
    else if (msg.type === 'segments') waiting.get(msg.id)?.(msg);
    else fail(new Error(msg.message));
  };
  worker.onerror = (e) => fail(new Error(e.message || 'Speech recognition stopped unexpectedly.'));
  const abort = () => fail(new DOMException('Canceled', 'AbortError'));
  signal.addEventListener('abort', abort);

  let nextId = 0;
  const recognize = (chunk: SpeechChunk, final: boolean) => {
    const id = nextId++;
    // Copy so the buffer can be handed to the worker without touching the decoder's memory.
    const samples = new Float32Array(chunk.samples);
    const done = new Promise<Extract<WorkerResponse, { type: 'segments' }>>((resolve) => waiting.set(id, resolve));
    worker.postMessage({ type: 'transcribe', id, start: chunk.start, samples, final } satisfies WorkerRequest, [samples.buffer]);
    return Promise.race([done, failed]).finally(() => waiting.delete(id));
  };

  const chunks = speechChunks(file, { chunkSeconds: PIECE_SECONDS, signal });
  try {
    worker.postMessage({ type: 'load' } satisfies WorkerRequest);
    // Load the model and decode the first piece at the same time.
    const [device, first] = await Promise.race([Promise.all([loaded, chunks.next()]), failed]);
    onReady?.(device);

    const segments: Segment[] = [];
    let current = first;
    let end = 0;
    while (!current.done) {
      const chunk = current.value;
      end = chunk.start + chunk.samples.length / SPEECH_SAMPLE_RATE;
      const next = chunks.next();
      next.catch(() => {});
      // Recognize this piece while the next one is being decoded.
      const [result, following] = await Promise.all([recognize(chunk, false), Promise.race([next, failed])]);
      segments.push(...result.segments);
      onProgress?.(result.doneUntil);
      current = following;
    }
    // The worker holds back the audio after the last complete line; finish it.
    const last = await recognize({ start: end, samples: new Float32Array(0) }, true);
    segments.push(...last.segments);
    onProgress?.(end);
    return segments;
  } finally {
    signal.removeEventListener('abort', abort);
    worker.terminate();
    // Closes the video file if we stopped early.
    chunks.return(undefined).catch(() => {});
  }
}
