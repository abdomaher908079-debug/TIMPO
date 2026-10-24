// A clip's sound, made ready to post: as loud as TikTok, Reels and Shorts expect, without distortion,
// with no click where it's cut, and fading with the picture when the clip fades in or out.
import { AudioSample, AudioSampleSink, type Input } from 'mediabunny';
import { FINISH_SECONDS, MAX_CLIP_SECONDS, type CaptionGroup } from './clips';

// Social platforms play everything at about -14 LUFS; quieter clips sound weak next to other posts.
const TARGET_DB = -14;
// Never more than this louder (noise would come up too) or quieter.
const MAX_BOOST_DB = 18;
const MAX_CUT_DB = -10;
// Loudness is measured in blocks this long; blocks this quiet are silence and don't count.
const BLOCK_SECONDS = 0.4;
const SILENT_DB = -60;
// Above this level a soft limiter rounds peaks off instead of clipping them.
const KNEE = 0.85;
// A tiny fade where the clip is cut, so it never starts or ends on a click.
const EDGE_SECONDS = 0.02;

const db = (x: number) => 20 * Math.log10(Math.max(x, 1e-9));

/** Gain (a multiplier) that brings the clip's speech to the platforms' loudness. */
export async function loudnessGain(input: Input, start: number, end: number): Promise<number> {
  const track = await input.getPrimaryAudioTrack();
  if (!track) return 1;
  const sink = new AudioSampleSink(track);
  const blocks: number[] = [];
  let energy = 0;
  let frames = 0;
  let blockFrames = 0;
  let peak = 0;
  for await (const sample of sink.samples(start, end)) {
    const n = sample.numberOfFrames;
    blockFrames ||= Math.round(sample.sampleRate * BLOCK_SECONDS);
    const plane = new Float32Array(n);
    const mono = new Float32Array(n);
    for (let c = 0; c < sample.numberOfChannels; c++) {
      sample.copyTo(plane, { planeIndex: c, format: 'f32-planar' });
      for (let i = 0; i < n; i++) mono[i]! += plane[i]! / sample.numberOfChannels;
    }
    sample.close();
    for (let i = 0; i < n; i++) {
      const v = mono[i]!;
      peak = Math.max(peak, Math.abs(v));
      energy += v * v;
      if (++frames >= blockFrames) {
        blocks.push(energy / frames);
        energy = 0;
        frames = 0;
      }
    }
  }
  if (frames) blocks.push(energy / frames);
  const loud = blocks.filter((e) => 10 * Math.log10(Math.max(e, 1e-12)) > SILENT_DB);
  if (!loud.length || !peak) return 1;
  const level = 10 * Math.log10(loud.reduce((a, b) => a + b, 0) / loud.length);
  const wanted = Math.max(MAX_CUT_DB, Math.min(MAX_BOOST_DB, TARGET_DB - level));
  // The soft limiter handles a few dB over full scale on rare peaks; beyond that, boost less.
  const headroom = db(1.6 / peak);
  return 10 ** (Math.min(wanted, headroom) / 20);
}

/** Rounds peaks above KNEE off smoothly, so loud moments never clip. */
function limit(x: number): number {
  const a = Math.abs(x);
  if (a <= KNEE) return x;
  return Math.sign(x) * (KNEE + (1 - KNEE) * Math.tanh((a - KNEE) / (1 - KNEE)));
}

/**
 * Processes one block of the clip's sound: loudness `gain`, the soft limiter, and fades. `duration` is
 * the clip's length; `fadeIn`/`fadeOut` are the clip's own fades in seconds (0 for just the tiny edge fade).
 */
export function processSound(sample: AudioSample, gain: number, duration: number, fadeIn: number, fadeOut: number): AudioSample {
  const n = sample.numberOfFrames;
  const channels = sample.numberOfChannels;
  const rate = sample.sampleRate;
  const data = new Float32Array(n * channels);
  const inLen = Math.max(EDGE_SECONDS, fadeIn);
  const outLen = Math.max(EDGE_SECONDS, fadeOut);
  for (let c = 0; c < channels; c++) {
    const plane = data.subarray(c * n, (c + 1) * n);
    sample.copyTo(plane, { planeIndex: c, format: 'f32-planar' });
    for (let i = 0; i < n; i++) {
      const t = sample.timestamp + i / rate;
      let v = limit(plane[i]! * gain);
      if (t < inLen) v *= Math.max(0, t / inLen);
      if (t > duration - outLen) v *= Math.max(0, (duration - t) / outLen);
      plane[i] = v;
    }
  }
  const out = new AudioSample({ data, format: 'f32-planar', numberOfChannels: channels, sampleRate: rate, timestamp: sample.timestamp });
  sample.close();
  return out;
}

// A word that ends a sentence, even with a closing quote or bracket after it (also Arabic, Chinese and Japanese marks).
const SENTENCE_END = /[.?!…؟。！？]["'”’)\]]*$/;
// Words further apart than this aren't one sentence any more (another speaker, or a pause).
const SENTENCE_GAP = 1.2;

/**
 * The clip's start and end, tidied with the exact word times: dead air before the first word and after
 * the last one is cut (keeping a breath), a last word running to the very end gets room to finish, and a
 * sentence still going at the end is finished when it ends within a few seconds (the speaker's last words
 * must not be cut off). `captions` should reach a few seconds past the clip's end for that.
 */
export function cleanEdges(start: number, end: number, captions: CaptionGroup[], videoEnd: number): { start: number; end: number } {
  const all = captions.flatMap((g) => g.words);
  const words = all.filter((w) => w.end > start && w.start < end);
  if (!words.length) return { start, end };
  const first = words[0]!;
  const last = words[words.length - 1]!;
  let s = start;
  let e = end;
  if (first.start - start > 0.6) s = first.start - 0.15;
  const finish = SENTENCE_END.test(last.text) ? null : sentenceEnd(all, last, end, s);
  if (finish) e = Math.min(videoEnd, finish.end + 0.35);
  else if (end - last.end > 0.8) e = last.end + 0.35;
  else if (last.end > end - 0.12) e = Math.min(videoEnd, Math.max(end, last.end + 0.25));
  return e - s >= 3 ? { start: s, end: e } : { start, end };
}

/** The word that ends the sentence `last` is in, if it follows without a break within FINISH_SECONDS of `end`. */
function sentenceEnd(all: CaptionGroup['words'], last: CaptionGroup['words'][number], end: number, start: number) {
  let prev = last;
  for (const w of all) {
    if (w.start < last.end - 1e-6 || w === last) continue;
    if (w.start - prev.end > SENTENCE_GAP || w.start > end + FINISH_SECONDS) return null;
    if (w.end - start > MAX_CLIP_SECONDS) return null;
    if (SENTENCE_END.test(w.text)) return w;
    prev = w;
  }
  return null;
}
