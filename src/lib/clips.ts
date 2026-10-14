import type { Moment } from './moments';
import type { Segment, Word } from './speech';

export type CaptionStyleId = 'bold' | 'highlight' | 'boxed' | 'none';

// The 3 basic styles every plan gets, plus no captions. Brand styles come with paid plans later.
export const CAPTION_STYLES: { id: CaptionStyleId; name: string }[] = [
  { id: 'bold', name: 'Bold' },
  { id: 'highlight', name: 'Highlight' },
  { id: 'boxed', name: 'Boxed' },
  { id: 'none', name: 'None' },
];

export const MIN_CLIP_SECONDS = 5;
// YouTube Shorts allows up to 3 minutes; TikTok and Reels allow more.
export const MAX_CLIP_SECONDS = 180;

export interface Clip {
  start: number;
  end: number;
  title: string;
  hook: string;
  reason: string;
  score: number;
  // The times the AI picked, for "Reset".
  original: { start: number; end: number };
  // Horizontal framing of the 9:16 crop: 0 = left edge, 50 = center, 100 = right edge.
  cropX: number;
  captionStyle: CaptionStyleId;
}

export function clipsFromMoments(moments: Moment[]): Clip[] {
  return moments.map((m) => ({
    ...m,
    original: { start: m.start, end: m.end },
    cropX: 50,
    captionStyle: 'bold',
  }));
}

export function clock(seconds: number, tenths = false): string {
  const t = Math.max(0, seconds);
  const s = Math.floor(t);
  const h = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  const frac = tenths ? `.${Math.floor((t - s) * 10)}` : '';
  return h ? `${h}:${String(mm).padStart(2, '0')}:${ss}${frac}` : `${mm}:${ss}${frac}`;
}

export interface Caption {
  words: string[];
  // Index of the word being spoken, for the highlight style.
  active: number;
}

const WORDS_PER_CAPTION = 3;
// A pause this long starts a new caption even if the current one isn't full.
const PAUSE_SECONDS = 0.6;
// Captions stay up across pauses shorter than this, so they don't blink off between phrases.
const HOLD_SECONDS = 1.2;

export interface CaptionGroup {
  start: number;
  end: number;
  words: Word[];
}

/** Splits exactly timed words into on-screen captions of up to 3 words, breaking at pauses and sentence ends. */
export function groupWords(words: Word[]): CaptionGroup[] {
  const groups: CaptionGroup[] = [];
  let current: Word[] = [];
  const flush = () => {
    if (current.length) groups.push({ start: current[0]!.start, end: current[current.length - 1]!.end, words: current });
    current = [];
  };
  words.forEach((w, i) => {
    current.push(w);
    const next = words[i + 1];
    if (current.length >= WORDS_PER_CAPTION || /[.?!,;:]$/.test(w.text) || !next || next.start - w.end > PAUSE_SECONDS) flush();
  });
  groups.forEach((g, i) => {
    const next = groups[i + 1];
    if (next && next.start - g.end < HOLD_SECONDS) g.end = Math.max(g.end, next.start);
    // Long enough to read even when the words were spoken fast.
    else g.end = Math.max(g.end, Math.min(g.start + 0.6, next?.start ?? Infinity));
  });
  return groups;
}

/** The caption on screen at time `t` from exactly timed caption groups. */
export function captionFromGroups(groups: CaptionGroup[], t: number): Caption | null {
  const g = groups.find((g) => t >= g.start && t < g.end);
  if (!g) return null;
  let active = 0;
  g.words.forEach((w, i) => {
    if (w.start <= t) active = i;
  });
  return { words: g.words.map((w) => w.text), active };
}

/** Identifies a clip's time range, to know when cached word times or an export are out of date. */
export const rangeKey = (c: { start: number; end: number }) => `${c.start.toFixed(1)}-${c.end.toFixed(1)}`;

/**
 * Word times estimated from Whisper's line times, by spreading each line over its words by length.
 * Used for the preview until exact word times exist (they're timed when a clip is exported).
 */
export function estimateWords(segments: Segment[], from: number, to: number): Word[] {
  const words: Word[] = [];
  for (const seg of segments) {
    if (seg.end <= from || seg.start >= to) continue;
    const texts = seg.text.split(/\s+/).filter(Boolean);
    const weights = texts.map((w) => w.length + 2);
    const total = weights.reduce((a, b) => a + b, 0);
    const span = seg.end - seg.start;
    let t = seg.start;
    texts.forEach((text, i) => {
      const d = (weights[i]! / total) * span;
      words.push({ text, start: t, end: t + d });
      t += d;
    });
  }
  return words;
}
