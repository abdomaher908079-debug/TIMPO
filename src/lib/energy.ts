// Which lines were said with energy (excitement, laughter, a raised voice), heard from the audio itself, for
// episodes transcribed on this device. Cloud listening gets this from the AI that listens; here it comes from
// loudness and speaking speed, compared with the episode's own normal level, so quiet and loud shows alike
// get their liveliest lines marked. Marked lines show as (!) to the AI that picks the moments.
import type { Segment } from '../../supabase/functions/_shared/moments';

// Loudness is measured in blocks this long.
const BLOCK_SECONDS = 0.25;
// Blocks quieter than this are silence (pauses between lines).
const SILENT_DB = -50;
// A line this much louder than the episode's typical line counts as energetic...
const LOUD_DB = 4;
// ...or a little louder and spoken this much faster than usual.
const LIVELY_DB = 2;
const FAST = 1.3;
// At most this share of the lines is marked, so (!) keeps meaning something.
const MAX_SHARE = 0.15;

const db = (meanSquare: number) => 10 * Math.log10(Math.max(meanSquare, 1e-10));

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length ? (s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2) : 0;
}

/** The episode's loudness over time, filled in piece by piece as the audio is decoded. */
export class LoudnessTrack {
  private blocks: number[] = [];

  constructor(private readonly sampleRate: number) {}

  /** Adds mono `samples` starting `start` seconds into the episode. */
  add(start: number, samples: Float32Array) {
    const size = Math.round(BLOCK_SECONDS * this.sampleRate);
    const first = Math.round(start / BLOCK_SECONDS);
    for (let b = 0; b * size < samples.length; b++) {
      const end = Math.min(samples.length, (b + 1) * size);
      let sum = 0;
      for (let i = b * size; i < end; i++) sum += samples[i]! * samples[i]!;
      this.blocks[first + b] = db(sum / Math.max(1, end - b * size));
    }
  }

  /** The loudness of the speech from `from` to `to` (its louder blocks: the 75th percentile), or null if silent. */
  speech(from: number, to: number): number | null {
    const out: number[] = [];
    for (let b = Math.floor(from / BLOCK_SECONDS); b < Math.ceil(to / BLOCK_SECONDS); b++) {
      const v = this.blocks[b];
      if (v !== undefined && v > SILENT_DB) out.push(v);
    }
    if (!out.length) return null;
    out.sort((a, b) => a - b);
    return out[Math.floor(out.length * 0.75)]!;
  }
}

/** The segments with `energy` set on the liveliest lines (see the top of this file). */
export function markEnergy(segments: Segment[], track: LoudnessTrack): Segment[] {
  const measured = segments.map((s) => {
    const seconds = s.end - s.start;
    return { loud: track.speech(s.start, s.end), rate: seconds > 0.5 ? s.text.length / seconds : null };
  });
  const louds = measured.map((m) => m.loud).filter((v): v is number => v !== null);
  const rates = measured.map((m) => m.rate).filter((v): v is number => v !== null);
  if (louds.length < 10) return segments;
  const typicalLoud = median(louds);
  const typicalRate = median(rates);
  const candidates = measured
    .map((m, i) => ({ i, loud: m.loud ?? -Infinity, rate: m.rate ?? 0 }))
    .filter((m) => m.loud >= typicalLoud + LOUD_DB || (m.loud >= typicalLoud + LIVELY_DB && m.rate >= typicalRate * FAST))
    .sort((a, b) => b.loud - a.loud)
    .slice(0, Math.floor(segments.length * MAX_SHARE));
  const marked = new Set(candidates.map((c) => c.i));
  return segments.map((s, i) => (marked.has(i) || s.energy ? { ...s, energy: true } : s));
}
