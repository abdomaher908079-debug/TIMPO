// What a clip keeps of the episode, and how its times map to the exported video. A clip covers start..end, minus
// the stretches the AI left out (skips: a tangent between the setup and the payoff) and, when tightened, the
// pauses and filler words ("um", "uh") between the words. Plain logic, shared by the export and the preview.
import type { TimeRange } from '../../supabase/functions/_shared/moments';
import type { Word } from './speech';

export type { TimeRange };

// A pause longer than this between two words is cut down...
const PAUSE_SECONDS = 0.5;
// ...keeping this much breathing room after the last word and before the next.
const KEEP_AFTER = 0.15;
const KEEP_BEFORE = 0.1;
// Cuts shorter than this aren't worth a jump, and kept bits shorter than this are dropped.
const MIN_CUT = 0.12;
const MIN_KEEP = 0.15;
// Hesitation sounds, cut wherever they're a word on their own. Only sounds that are no word in any common
// language (never "like" or "so"); "um" only in English, as it's a word in Portuguese ("one") and German.
const FILLERS = new Set(['umm', 'uh', 'uhh', 'uhm', 'erm', 'hmm', 'mm', 'mmm']);
const ENGLISH_FILLERS = new Set(['um']);
// Telling English apart: these short words make up a good part of any English speech.
const ENGLISH = new Set(['the', 'and', 'to', 'of', 'is', 'you', 'that', 'it', 'in', 'i', 'a', 'this', 'what', 'we', 'was']);

const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}]/gu, '');

/** Whether the words are English (for "um"). */
export const isEnglish = (words: Word[]) => words.length > 0 && words.filter((w) => ENGLISH.has(norm(w.text))).length >= words.length * 0.12;

/** Whether a word is only a hesitation sound ("uh", and "um" in English). */
export const isFiller = (w: string, english = false) => FILLERS.has(norm(w)) || (english && ENGLISH_FILLERS.has(norm(w)));

/**
 * The stretches of the episode the clip plays, in order. `words` are the clip's timed words (for pauses and
 * fillers); `tighten` cuts long pauses and filler words, `skips` are always left out.
 */
export function keptRanges(start: number, end: number, skips: TimeRange[] = [], words: Word[] = [], tighten = true): TimeRange[] {
  const cuts: TimeRange[] = skips.map((s) => ({ start: Math.max(start, s.start), end: Math.min(end, s.end) }));
  if (tighten) {
    const spoken = words.filter((w) => w.end > start && w.start < end).sort((a, b) => a.start - b.start);
    const english = isEnglish(spoken);
    const real = spoken.filter((w) => !isFiller(w.text, english));
    for (const w of spoken) if (isFiller(w.text, english)) cuts.push({ start: w.start, end: w.end });
    for (let i = 1; i < real.length; i++) {
      const gap = real[i]!.start - real[i - 1]!.end;
      if (gap > PAUSE_SECONDS) cuts.push({ start: real[i - 1]!.end + KEEP_AFTER, end: real[i]!.start - KEEP_BEFORE });
    }
  }
  const sorted = cuts.filter((c) => c.end - c.start >= MIN_CUT).sort((a, b) => a.start - b.start);
  const kept: TimeRange[] = [];
  let at = start;
  for (const c of sorted) {
    if (c.start > at) kept.push({ start: at, end: c.start });
    at = Math.max(at, c.end);
  }
  if (end > at) kept.push({ start: at, end });
  const out = kept.filter((k) => k.end - k.start >= MIN_KEEP);
  return out.length ? out : [{ start, end }];
}

/** How long the kept stretches play. */
export const playedSeconds = (ranges: TimeRange[]) => ranges.reduce((n, r) => n + (r.end - r.start), 0);

/** Where episode time `t` lands in the exported clip, or null if it's cut. */
export function outputTime(ranges: TimeRange[], t: number): number | null {
  let before = 0;
  for (const r of ranges) {
    if (t < r.start) return null;
    if (t < r.end) return before + (t - r.start);
    before += r.end - r.start;
  }
  return null;
}

/** The kept stretch that `t` is in, or the next one after it (for the preview to jump to), or null at the end. */
export function rangeAtOrAfter(ranges: TimeRange[], t: number): TimeRange | null {
  return ranges.find((r) => t < r.end) ?? null;
}

/** A kept part of one block of sound: frames [from, to) of the block, played at `at` seconds in the clip. */
export interface Piece {
  from: number;
  to: number;
  at: number;
  // A cut is right before / after this piece: fade a few milliseconds so it doesn't click.
  cutBefore: boolean;
  cutAfter: boolean;
}

/** The kept parts of a block of sound that starts at episode time `t0`, `frames` long at `rate`. */
export function soundPieces(ranges: TimeRange[], t0: number, frames: number, rate: number): Piece[] {
  const t1 = t0 + frames / rate;
  const out: Piece[] = [];
  let before = 0;
  ranges.forEach((r, i) => {
    const s = Math.max(r.start, t0);
    const e = Math.min(r.end, t1);
    if (e > s) {
      const from = Math.round((s - t0) * rate);
      const to = Math.min(frames, Math.round((e - t0) * rate));
      if (to > from) out.push({ from, to, at: before + (s - r.start), cutBefore: i > 0 && s === r.start, cutAfter: i < ranges.length - 1 && e === r.end });
    }
    before += r.end - r.start;
  });
  return out;
}
