import { fontWeight, type BrandKit } from './brandKits';
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

/**
 * How a clip fills the vertical frame:
 * - fill: a 9:16 crop of the video, following `track` (the speaker's face) or `cropX`.
 * - fit: the whole picture across the middle, over a blurred copy of itself. For people sitting
 *   too far apart for one crop, or videos without faces (screens, slides).
 */
export type Layout = 'fill' | 'fit';

// Where the crop sits over time: `x` is the crop's position (0 = left edge, 100 = right edge) from
// episode time `t` on.
export type FramingTrack = { t: number; x: number }[];

/**
 * The crop position at episode time `t`. Following the speaker (`track`) is part of the Pro edit;
 * without it the crop stays where the faces are most of the time (`cropX`).
 */
export function cropAt(framing: { cropX: number; track?: FramingTrack }, t: number, follow = true): number {
  const track = framing.track;
  if (!follow || !track?.length) return framing.cropX;
  let x = track[0]!.x;
  for (const k of track) {
    if (k.t > t) break;
    x = k.x;
  }
  return x;
}

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
  // Crop of the video, or the whole picture over a blurred copy (see framing.ts).
  layout: Layout;
  // Where the crop follows the speaker over time (auto framing). None = cropX all along.
  track?: FramingTrack;
  // Auto framing has looked at this clip (or the user framed it).
  framed?: boolean;
  // The Pro edit, written by the AI with the moment (see Moment): a headline on screen, words
  // highlighted in the captions, phrases to zoom in on, plus framing that follows the speaker. Each part
  // can be turned off for this clip (proOff); `proEdit: false` (older saves) means all of them.
  headline?: string;
  emphasis?: string[];
  punchIns?: string[];
  proEdit?: boolean;
  proOff?: ProPart[];
  captionStyle: CaptionStyleId;
  // A brand kit's look instead of captionStyle. undefined = not chosen yet (the first kit is used).
  brandKitId?: string | null;
  // The person's own touches (editor → Style & effects).
  edit?: ClipEdit;
}

/** The person's own touches on a clip. Everything optional: absent means the default. */
export interface ClipEdit {
  captionSize?: 'small' | 'large';
  captionPlace?: 'top' | 'middle' | 'bottom';
  // Text color of the captions, over the style's or brand kit's.
  captionColor?: string;
  // How each caption appears: fading in, or popping in. Absent: it simply appears.
  captionMotion?: 'fade' | 'pop';
  // Words the AI misheard, replaced wherever they appear in the clip's captions.
  fixes?: { from: string; to: string }[];
  // Extra zoom on the picture (1 = none), on top of the Pro edit's zoom-ins.
  zoom?: number;
  // The picture fades in from black at the start and out to black at the end.
  fadeIn?: boolean;
  fadeOut?: boolean;
}

export const CAPTION_SIZES = { small: 0.82, large: 1.22 } as const;
export const CAPTION_PLACES = { top: 0.2, middle: 0.44, bottom: 0.66 } as const;
export const FADE_SECONDS = 0.5;

/** The caption look with the clip's own touches (size, place, color, motion) applied. */
export function editedLook(look: CaptionLook, edit: ClipEdit | undefined): CaptionLook {
  if (!edit) return look;
  return {
    ...look,
    size: edit.captionSize ? CAPTION_SIZES[edit.captionSize] : look.size,
    position: edit.captionPlace ? CAPTION_PLACES[edit.captionPlace] : look.position,
    textColor: edit.captionColor ?? look.textColor,
    motion: edit.captionMotion ?? look.motion,
  };
}

/** Caption groups with the clip's word fixes applied (matching whole words, keeping punctuation). */
export function fixWords(groups: CaptionGroup[], fixes: ClipEdit['fixes']): CaptionGroup[] {
  const list = (fixes ?? []).filter((f) => normWord(f.from) && f.to.trim());
  if (!list.length) return groups;
  const swap = new Map(list.map((f) => [normWord(f.from), f.to.trim()]));
  return groups.map((g) => ({
    ...g,
    words: g.words.map((w) => {
      const to = swap.get(normWord(w.text));
      if (!to) return w;
      // Keep the punctuation around the word (a comma or full stop after it).
      const [, before = '', after = ''] = /^([^\p{L}\p{N}]*)[\s\S]*?([^\p{L}\p{N}]*)$/u.exec(w.text) ?? [];
      return { ...w, text: `${before}${to}${after}` };
    }),
  }));
}

/** How dark the picture is at time `t` (0 = normal, 1 = black) from the clip's fade in and out. */
export function fadeAt(clip: Pick<Clip, 'start' | 'end' | 'edit'>, t: number): number {
  const e = clip.edit;
  if (!e) return 0;
  if (e.fadeIn && t < clip.start + FADE_SECONDS) return Math.max(0, 1 - (t - clip.start) / FADE_SECONDS);
  if (e.fadeOut && t > clip.end - FADE_SECONDS) return Math.min(1, (t - (clip.end - FADE_SECONDS)) / FADE_SECONDS);
  return 0;
}

/** How a caption that has been up for `since` seconds is drawn: its opacity and scale. */
export function captionMotion(look: CaptionLook, since: number | undefined): { alpha: number; scale: number } {
  if (since === undefined || !look.motion) return { alpha: 1, scale: 1 };
  if (look.motion === 'fade') return { alpha: Math.min(1, since / 0.2), scale: 1 };
  const x = Math.min(1, since / 0.15);
  return { alpha: Math.min(1, since / 0.08), scale: 0.78 + 0.22 * (1 - (1 - x) * (1 - x)) };
}

/** Everything that decides how captions look, from a basic style or a brand kit. */
export interface CaptionLook {
  style: CaptionStyleId;
  font: string;
  weight: number;
  textColor: string;
  // The highlighted word (Highlight).
  accentColor: string;
  // The box behind words (Boxed), as a CSS color.
  boxColor: string;
  // Top of the captions, as a fraction of the video's height.
  position: number;
  // Size relative to the normal one (1), and how each caption appears.
  size?: number;
  motion?: 'fade' | 'pop';
}

const PHOSPHOR = '#9dff3c';

/** How a clip's captions look: its brand kit if it uses one, otherwise its basic style. */
export function captionLook(clip: Pick<Clip, 'captionStyle' | 'brandKitId'>, kits: BrandKit[]): { look: CaptionLook; kit: BrandKit | null } {
  const kit = (clip.brandKitId && kits.find((k) => k.id === clip.brandKitId)) || null;
  if (kit) {
    return {
      kit,
      look: {
        style: kit.style,
        font: kit.font,
        weight: fontWeight(kit.font),
        textColor: kit.text_color,
        accentColor: kit.accent_color,
        boxColor: kit.accent_color,
        position: kit.position,
      },
    };
  }
  const style = clip.captionStyle;
  return {
    kit: null,
    look: {
      style,
      font: 'Inter',
      weight: style === 'boxed' ? 800 : 900,
      textColor: '#ffffff',
      accentColor: PHOSPHOR,
      boxColor: 'rgba(0, 0, 0, 0.82)',
      position: 0.66,
    },
  };
}

export function clipsFromMoments(moments: Moment[]): Clip[] {
  return moments.map((m) => ({
    ...m,
    original: { start: m.start, end: m.end },
    cropX: 50,
    // The whole picture until auto framing finds a face to follow: a crop of slides or a screen
    // would cut off the text.
    layout: 'fit',
    captionStyle: 'bold',
    proOff: rememberedProOff(),
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
  // Words highlighted by the Pro edit.
  emphasis?: boolean[];
  // Seconds since this caption appeared (for fade and pop).
  since?: number;
}

const normWord = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');

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
export function captionFromGroups(groups: CaptionGroup[], t: number, emphasis?: string[]): Caption | null {
  const g = groups.find((g) => t >= g.start && t < g.end);
  if (!g) return null;
  let active = 0;
  g.words.forEach((w, i) => {
    if (w.start <= t) active = i;
  });
  const marked = emphasis?.length ? new Set(emphasis.map(normWord)) : null;
  return {
    words: g.words.map((w) => w.text),
    active,
    since: t - g.start,
    ...(marked ? { emphasis: g.words.map((w) => marked.has(normWord(w.text))) } : {}),
  };
}

// --- Pro edit: zoom-ins ---

export interface Zoom {
  start: number;
  end: number;
}

const ZOOM = 0.12;
const ZOOM_IN_SECONDS = 0.25;
const ZOOM_OUT_SECONDS = 0.45;

/** When to zoom in: from each punch-in phrase's first word until a moment after its sentence ends. */
export function zoomsFor(words: Word[], phrases: string[] | undefined): Zoom[] {
  if (!phrases?.length || !words.length) return [];
  const norm = words.map((w) => normWord(w.text));
  const zooms: Zoom[] = [];
  for (const phrase of phrases) {
    const target = phrase.split(/\s+/).map(normWord).filter(Boolean);
    if (!target.length) continue;
    for (let i = 0; i + target.length <= norm.length; i++) {
      if (!target.every((t, k) => norm[i + k] === t)) continue;
      // Hold the zoom to the end of the sentence (or at least 1.5 s, at most 4 s).
      let j = i + target.length - 1;
      while (j + 1 < words.length && !/[.?!]$/.test(words[j]!.text) && words[j + 1]!.start - words[i]!.start < 4) j++;
      const start = words[i]!.start;
      const end = Math.min(start + 4, Math.max(start + 1.5, words[j]!.end + 0.3));
      if (!zooms.some((z) => start < z.end && z.start < end)) zooms.push({ start, end });
      break;
    }
  }
  return zooms.sort((a, b) => a.start - b.start);
}

/** How far zoomed in (1 = not at all) at time `t`: a quick ease in, a hold, and a gentler ease out. */
export function zoomAt(zooms: Zoom[], t: number): number {
  for (const z of zooms) {
    if (t < z.start || t > z.end + ZOOM_OUT_SECONDS) continue;
    const ease = (x: number) => x * x * (3 - 2 * x);
    if (t < z.start + ZOOM_IN_SECONDS) return 1 + ZOOM * ease((t - z.start) / ZOOM_IN_SECONDS);
    if (t <= z.end) return 1 + ZOOM;
    return 1 + ZOOM * ease(1 - (t - z.end) / ZOOM_OUT_SECONDS);
  }
  return 1;
}

/** The parts of the Pro edit, each one a choice. */
export type ProPart = 'headline' | 'highlight' | 'zoom' | 'follow';
export const PRO_PARTS: { id: ProPart; label: string }[] = [
  { id: 'headline', label: 'AI headline at the top' },
  { id: 'highlight', label: 'Highlighted key words in the captions' },
  { id: 'zoom', label: 'Quick zoom-ins on the best lines' },
  { id: 'follow', label: 'Framing that follows the speaker' },
];

/**
 * Which parts of the Pro edit a clip gets: paid plans (and previews of Pro-only clips), minus the parts
 * turned off for this clip.
 */
export function proParts(clip: Pick<Clip, 'proEdit' | 'proOff'>, pro: boolean): Record<ProPart, boolean> {
  const on = pro && clip.proEdit !== false;
  const off = clip.proOff ?? [];
  return {
    headline: on && !off.includes('headline'),
    highlight: on && !off.includes('highlight'),
    zoom: on && !off.includes('zoom'),
    follow: on && !off.includes('follow'),
  };
}

// The parts someone turned off last time, used for their next clips (this browser only).
const PRO_OFF_KEY = 'hookcut_pro_off';
export function rememberedProOff(): ProPart[] {
  try {
    const list = JSON.parse(localStorage.getItem(PRO_OFF_KEY) ?? '[]') as unknown;
    return Array.isArray(list) ? list.filter((p): p is ProPart => PRO_PARTS.some((x) => x.id === p)) : [];
  } catch {
    return [];
  }
}
export function rememberProOff(off: ProPart[]) {
  try {
    localStorage.setItem(PRO_OFF_KEY, JSON.stringify(off));
  } catch {
    // Just not remembered.
  }
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

const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');

/**
 * Caption words with the transcript's text and the word timer's times. The timer (a small speech
 * model on phones) hears some words wrong; the transcript has them right but only rough times.
 * Words both agree on take the timer's times; the rest are spread between them. Falls back to the
 * timer's own words when the two hardly agree.
 */
export function alignWords(transcript: Word[], timed: Word[]): Word[] {
  const a = transcript.map((w) => norm(w.text));
  const b = timed.map((w) => norm(w.text));
  // Longest common subsequence of the two word lists.
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) dp[i]![j] = a[i] && a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  }
  const match = new Array<number>(n).fill(-1);
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (a[i] && a[i] === b[j]) match[i++] = j++;
    else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++;
    else j++;
  }
  const anchors = match.filter((j) => j >= 0).length;
  if (!timed.length || anchors < Math.max(2, 0.4 * Math.min(n, m))) return timed;

  // Words outside the clip before the first or after the last shared word are dropped.
  const first = match.findIndex((j) => j >= 0);
  const last = n - 1 - [...match].reverse().findIndex((j) => j >= 0);
  const out: Word[] = [];
  for (let i = 0; i < n; i++) {
    const j = match[i]!;
    if (j >= 0) {
      out.push({ text: transcript[i]!.text, start: timed[j]!.start, end: timed[j]!.end });
      continue;
    }
    // A run of unmatched words: spread it over the gap between its neighbours.
    let k = i;
    while (k + 1 < n && match[k + 1]! < 0) k++;
    // Before the first or after the last shared word, the transcript runs past the clip: keep only as
    // many words as the timer heard there.
    let run = transcript.slice(i, k + 1);
    if (i < first) run = run.slice(Math.max(0, run.length - match[first]!));
    else if (i > last) run = run.slice(0, m - 1 - match[last]!);
    const prev = out[out.length - 1];
    const gapStart = prev ? prev.end : timed[0]!.start;
    const nextMatch = k + 1 < n ? timed[match[k + 1]!] : undefined;
    const gapEnd = Math.max(gapStart, nextMatch ? nextMatch.start : timed[m - 1]!.end);
    const weights = run.map((w) => w.text.length + 2);
    const total = weights.reduce((s, x) => s + x, 0) || 1;
    let t = gapStart;
    run.forEach((w, r) => {
      const d = ((gapEnd - gapStart) * weights[r]!) / total;
      out.push({ text: w.text, start: t, end: t + d });
      t += d;
    });
    i = k;
  }
  return out;
}
