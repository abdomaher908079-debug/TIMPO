import { ALL_FORMATS, AudioSampleSink, BlobSource, Input, type AudioSample } from 'mediabunny';

// Whisper expects mono audio at 16 kHz.
export const SPEECH_SAMPLE_RATE = 16_000;

export interface SpeechChunk {
  // Where this chunk starts in the episode, in seconds.
  start: number;
  // Mono PCM at SPEECH_SAMPLE_RATE.
  samples: Float32Array;
}

/**
 * Decodes the episode's audio and yields it as mono 16 kHz chunks of about
 * `chunkSeconds` each, so a multi-hour episode never sits in memory at once.
 * `onProgress` receives 0..1 of the episode processed.
 */
export async function* speechChunks(
  file: File,
  { chunkSeconds = 30, onProgress, signal }: { chunkSeconds?: number; onProgress?: (p: number) => void; signal?: AbortSignal } = {},
): AsyncGenerator<SpeechChunk> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error('This video has no audio track.');
    const duration = await input.computeDuration();
    const sink = new AudioSampleSink(track);

    let sourceRate = 0;
    let pending: Float32Array<ArrayBuffer>[] = [];
    let pendingFrames = 0;
    let chunkStart = 0;

    const flush = async (): Promise<SpeechChunk | null> => {
      if (!pendingFrames) return null;
      const mono = new Float32Array(pendingFrames);
      let offset = 0;
      for (const part of pending) {
        mono.set(part, offset);
        offset += part.length;
      }
      const chunk = { start: chunkStart, samples: await resample(mono, sourceRate) };
      chunkStart += pendingFrames / sourceRate;
      pending = [];
      pendingFrames = 0;
      return chunk;
    };

    for await (const sample of sink.samples()) {
      try {
        if (signal?.aborted) throw new DOMException('Canceled', 'AbortError');
        if (!sourceRate) {
          sourceRate = sample.sampleRate;
          chunkStart = Math.max(0, sample.timestamp);
        }
        pending.push(toMono(sample));
        pendingFrames += sample.numberOfFrames;
        if (pendingFrames >= chunkSeconds * sourceRate) {
          const chunk = await flush();
          if (chunk) yield chunk;
          onProgress?.(Math.min(1, chunkStart / duration));
        }
      } finally {
        sample.close();
      }
    }
    const last = await flush();
    if (last) yield last;
    onProgress?.(1);
  } finally {
    input.dispose();
  }
}

/** One stretch of the episode's audio as mono 16 kHz, e.g. a clip for word timing. */
export async function speechRange(file: File, start: number, end: number): Promise<Float32Array> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error('This video has no audio track.');
    const sink = new AudioSampleSink(track);
    const parts: Float32Array<ArrayBuffer>[] = [];
    let rate = 0;
    let first = start;
    for await (const sample of sink.samples(start, end)) {
      try {
        if (!rate) {
          rate = sample.sampleRate;
          first = sample.timestamp;
        }
        parts.push(toMono(sample));
      } finally {
        sample.close();
      }
    }
    if (!rate) return new Float32Array(0);
    // The first decoded block may begin a little before `start`; cut to the exact range.
    const from = Math.max(0, Math.round((start - first) * rate));
    const to = Math.round((end - first) * rate);
    const total = parts.reduce((n, p) => n + p.length, 0);
    const mono = new Float32Array(Math.max(0, Math.min(total, to) - from));
    let offset = -from;
    for (const part of parts) {
      const a = Math.max(0, -offset);
      const b = Math.min(part.length, mono.length - offset);
      if (b > a) mono.set(part.subarray(a, b), offset + a);
      offset += part.length;
    }
    return resample(mono, rate);
  } finally {
    input.dispose();
  }
}

function toMono(sample: AudioSample): Float32Array<ArrayBuffer> {
  const frames = sample.numberOfFrames;
  const mono = new Float32Array(frames);
  const plane = new Float32Array(frames);
  for (let ch = 0; ch < sample.numberOfChannels; ch++) {
    sample.copyTo(plane, { planeIndex: ch, format: 'f32-planar' });
    for (let i = 0; i < frames; i++) mono[i]! += plane[i]!;
  }
  if (sample.numberOfChannels > 1) {
    const scale = 1 / sample.numberOfChannels;
    for (let i = 0; i < frames; i++) mono[i]! *= scale;
  }
  return mono;
}

// The browser's own resampler (with proper filtering) via an offline audio graph.
async function resample(mono: Float32Array<ArrayBuffer>, fromRate: number): Promise<Float32Array> {
  if (fromRate === SPEECH_SAMPLE_RATE) return mono;
  const outFrames = Math.max(1, Math.round((mono.length * SPEECH_SAMPLE_RATE) / fromRate));
  const ctx = new OfflineAudioContext(1, outFrames, SPEECH_SAMPLE_RATE);
  const buffer = ctx.createBuffer(1, mono.length, fromRate);
  buffer.copyToChannel(mono, 0);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start();
  const rendered = await ctx.startRendering();
  return rendered.getChannelData(0);
}
