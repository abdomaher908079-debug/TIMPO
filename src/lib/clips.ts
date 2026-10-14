import type { Moment } from './moments';
import type { Segment } from './speech';

export type CaptionStyleId = 'bold' | 'highlight' | 'boxed';

// The 3 basic styles every plan gets. Brand styles come with paid plans later.
export const CAPTION_STYLES: { id: CaptionStyleId; name: string }[] = [
  { id: 'bold', name: 'Bold' },
  { id: 'highlight', name: 'Highlight' },
  { id: 'boxed', name: 'Boxed' },
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

/**
 * The caption on screen at time `t`: a few words around the one being spoken.
 * Whisper gives times per line, so word times are estimated by spreading the line's time over its
 * words by length. Exact word times come with export.
 */
export function captionAt(segments: Segment[], t: number): Caption | null {
  // Lines are in order; binary search for the last one starting at or before t.
  let lo = 0;
  let hi = segments.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segments[mid]!.start <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  const seg = found >= 0 ? segments[found] : undefined;
  if (!seg || t >= seg.end) return null;
  const words = seg.text.split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const weights = words.map((w) => w.length + 2);
  const total = weights.reduce((a, b) => a + b, 0);
  const progress = ((t - seg.start) / Math.max(0.01, seg.end - seg.start)) * total;
  let index = 0;
  for (let acc = 0; index < words.length - 1; index++) {
    acc += weights[index]!;
    if (acc > progress) break;
  }
  const first = Math.floor(index / WORDS_PER_CAPTION) * WORDS_PER_CAPTION;
  return { words: words.slice(first, first + WORDS_PER_CAPTION), active: index - first };
}
