import type { Segment } from '../../supabase/functions/_shared/moments';
import { speechChunks, SPEECH_SAMPLE_RATE, type SpeechChunk } from './audio';

export type { Segment };

export interface Word {
  text: string;
  // Seconds from the start of the audio that was timed.
  start: number;
  end: number;
}

export type WorkerRequest =
  // `safe`: processor only, one thread. Used after the recognizer crashed on this device (e.g. a phone).
  // `timingOnly`: only word times are needed (captions), so phones can use a smaller model.
  | { type: 'load'; quality: 'quick' | 'best'; safe?: boolean; timingOnly?: boolean }
  | { type: 'transcribe'; id: number; start: number; samples: Float32Array; final: boolean }
  | { type: 'words'; id: number; samples: Float32Array };

export type WorkerResponse =
  | { type: 'loading'; loaded: number; total: number }
  // What the recognizer is doing while it gets ready, for error messages.
  | { type: 'stage'; stage: string }
  // `model` is the speech model actually used: best needs a graphics card.
  | { type: 'ready'; device: 'webgpu' | 'wasm'; model: 'quick' | 'best' }
  | { type: 'segments'; id: number; segments: Segment[]; doneUntil: number }
  | { type: 'words'; id: number; words: Word[] }
  | { type: 'error'; id?: number; message: string };

// How much audio Whisper gets at a time. Longer pieces mean fewer cut points to stitch.
const PIECE_SECONDS = 60;

// Set once the recognizer has crashed while loading on this device; later loads go straight to safe mode.
let safeMode = false;

export interface TranscribeOptions {
  signal: AbortSignal;
  // The plan's AI quality.
  quality: 'quick' | 'best';
  // Model download, in bytes. Only happens the first time; the browser keeps it afterwards.
  onLoading?: (loaded: number, total: number) => void;
  onReady?: (device: 'webgpu' | 'wasm', model: 'quick' | 'best') => void;
  // Seconds of the episode transcribed so far.
  onProgress?: (seconds: number) => void;
}

/**
 * Transcribes the episode's speech in the browser with Whisper. Audio is decoded one piece ahead
 * of recognition, so only a couple of minutes of audio are ever in memory.
 */
export async function transcribeEpisode(file: File, { signal, quality, onLoading, onReady, onProgress }: TranscribeOptions): Promise<Segment[]> {
  let fail: (err: Error) => void = () => {};
  const failed = new Promise<never>((_, reject) => (fail = reject));
  failed.catch(() => {});
  const waiting = new Map<number, (r: Extract<WorkerResponse, { type: 'segments' }>) => void>();
  type Ready = Extract<WorkerResponse, { type: 'ready' }>;
  let ready: (msg: Ready) => void = () => {};
  const loaded = new Promise<Ready>((resolve) => (ready = resolve));
  let isReady = false;
  let stage = 'opening the speech worker';

  // If the recognizer crashes or fails while loading, try once more in safe mode before giving up.
  const crashed = (from: Worker, message: string) => {
    // A replaced worker can still report its crash twice (an error message, then an error event).
    if (from !== worker) return;
    if (!isReady && !safeMode) {
      safeMode = true;
      stage = 'opening the speech worker';
      worker.terminate();
      worker = startWorker();
      return;
    }
    fail(new Error(`${message} (while ${stage}${safeMode ? ', safe mode' : ''})`));
  };
  const startWorker = () => {
    const w = new Worker(new URL('./speech.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.type === 'loading') onLoading?.(msg.loaded, msg.total);
      else if (msg.type === 'stage') stage = msg.stage;
      else if (msg.type === 'ready') {
        isReady = true;
        stage = 'listening';
        ready(msg);
      } else if (msg.type === 'segments') waiting.get(msg.id)?.(msg);
      else if (msg.type === 'error') crashed(w, msg.message);
    };
    // An error with no message usually means the worker's own file failed to load.
    w.onerror = (e) => crashed(w, e.message || `Speech recognition stopped unexpectedly [${e.type}${e.filename ? ` ${e.filename.split('/').pop()}:${e.lineno}` : ''}]`);
    w.postMessage({ type: 'load', quality, safe: safeMode } satisfies WorkerRequest);
    return w;
  };
  let worker = startWorker();
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
    // Load the model and decode the first piece at the same time.
    const [info, first] = await Promise.race([Promise.all([loaded, chunks.next()]), failed]);
    onReady?.(info.device, info.model);

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

export interface WordTimer {
  /** Exact word times for `start`..`end` of the episode, in episode seconds. */
  words(file: File, start: number, end: number): Promise<Word[]>;
  /** Starts downloading and loading the model now, so the first export doesn't wait for it. */
  warm(): void;
  dispose(): void;
}

/**
 * Times the words of single clips for their captions. Keeps one recognizer loaded so exporting
 * several clips loads the model once (it's already in the browser's cache from transcribing).
 */
export function createWordTimer(quality: 'quick' | 'best'): WordTimer {
  let worker: Worker | null = null;
  let loaded: Promise<void> | null = null;
  const waiting = new Map<number, { resolve: (w: Word[]) => void; reject: (e: Error) => void }>();
  let nextId = 0;

  const failAll = (err: Error) => {
    for (const w of waiting.values()) w.reject(err);
    waiting.clear();
    worker?.terminate();
    worker = null;
    loaded = null;
  };

  const start = () => {
    const w = new Worker(new URL('./speech.worker.ts', import.meta.url), { type: 'module' });
    loaded = new Promise<void>((resolve, reject) => {
      w.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const msg = e.data;
        if (msg.type === 'ready') resolve();
        else if (msg.type === 'words') {
          waiting.get(msg.id)?.resolve(msg.words);
          waiting.delete(msg.id);
        } else if (msg.type === 'error') {
          const err = new Error(msg.message);
          reject(err);
          failAll(err);
        }
      };
      w.onerror = (e) => {
        const err = new Error(e.message || 'Word timing stopped unexpectedly.');
        reject(err);
        failAll(err);
      };
    });
    loaded.catch(() => {});
    w.postMessage({ type: 'load', quality, safe: safeMode, timingOnly: true } satisfies WorkerRequest);
    worker = w;
  };

  return {
    async words(file, from, to) {
      const { speechRange } = await import('./audio');
      const [samples] = await Promise.all([speechRange(file, from, to), (worker ? loaded : (start(), loaded))!]);
      const id = nextId++;
      const result = new Promise<Word[]>((resolve, reject) => waiting.set(id, { resolve, reject }));
      const copy = new Float32Array(samples);
      worker!.postMessage({ type: 'words', id, samples: copy } satisfies WorkerRequest, [copy.buffer]);
      const words = await result;
      return words.map((w) => ({ ...w, start: w.start + from, end: w.end + from }));
    },
    warm() {
      if (!worker) start();
    },
    dispose() {
      failAll(new DOMException('Canceled', 'AbortError'));
    },
  };
}
