// Picks an episode's best clip moments from its transcript with Gemini.
// Shared by the Supabase Edge Function (production) and the Vite dev server (local), so it must
// only use web-standard APIs (fetch, JSON): no Deno or Node globals.

export interface Segment {
  // Seconds from the start of the episode.
  start: number;
  end: number;
  text: string;
}

export interface Moment {
  start: number;
  end: number;
  title: string;
  // The line a viewer hears first; becomes the clip's opening caption.
  hook: string;
  // Why this moment works as a short clip.
  reason: string;
  // 0–100: how likely the clip is to do well on its own.
  score: number;
}

export interface PickMomentsRequest {
  segments: Segment[];
  count: number;
}

export const MIN_CLIP_SECONDS = 15;
export const MAX_CLIP_SECONDS = 90;
export const MAX_COUNT = 30;
// About 4 hours of speech. Keeps a single request well inside the free tier's token limits.
export const MAX_TRANSCRIPT_CHARS = 400_000;
export const DEFAULT_GEMINI_MODEL = 'gemini-flash-latest';

export class MomentsError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const SYSTEM_PROMPT = `You are a senior short-form video editor for podcasts.
You get a numbered transcript of one episode. Each line is "<line number> [<time>] <text>".
Pick the moments that will work best as stand-alone vertical clips on TikTok, Instagram Reels and YouTube Shorts.

A great clip:
- Hooks in the first 3 seconds: a bold claim, a surprising fact, a question, a strong emotion or a funny line.
- Makes sense without the rest of the episode. Never start mid-thought or with "and", "so" or "but" referring back.
- Has a payoff: a punchline, an insight, a story ending or a clear takeaway. Ends on a complete sentence.
- Is ${MIN_CLIP_SECONDS} to ${MAX_CLIP_SECONDS} seconds long (30 to 60 is ideal).

Avoid: intros, outros, ads and sponsor reads, housekeeping, small talk, and moments that only work with visuals.
Clips must not overlap. Spread them across the episode when quality is similar.

For each clip give:
- startLine and endLine: the first and last transcript line numbers of the clip (inclusive).
- title: a punchy title of at most 8 words, written for social media, no hashtags or emojis.
- hook: the exact opening words of the clip, copied from the transcript (at most 15 words).
- reason: one short sentence on why it will perform.
- score: 0 to 100 for how well it will perform as a stand-alone clip. Be honest and spread the scores out.

Return the clips best first.`;

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    moments: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          startLine: { type: 'INTEGER' },
          endLine: { type: 'INTEGER' },
          title: { type: 'STRING' },
          hook: { type: 'STRING' },
          reason: { type: 'STRING' },
          score: { type: 'INTEGER' },
        },
        required: ['startLine', 'endLine', 'title', 'hook', 'reason', 'score'],
        propertyOrdering: ['startLine', 'endLine', 'title', 'hook', 'reason', 'score'],
      },
    },
  },
  required: ['moments'],
};

function clock(seconds: number): string {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Checks a request body from the browser and returns it cleaned up, or throws a MomentsError. */
export function parseRequest(body: unknown): PickMomentsRequest {
  const b = body as Partial<PickMomentsRequest> | null;
  if (!b || !Array.isArray(b.segments)) throw new MomentsError('Missing transcript.', 400);
  const segments: Segment[] = [];
  let chars = 0;
  for (const s of b.segments) {
    if (!s || typeof s.text !== 'string' || !Number.isFinite(s.start) || !Number.isFinite(s.end)) {
      throw new MomentsError('Malformed transcript.', 400);
    }
    const text = s.text.trim();
    if (!text) continue;
    chars += text.length;
    segments.push({ start: s.start, end: Math.max(s.start, s.end), text });
  }
  if (!segments.length) throw new MomentsError('We didn’t hear anyone speaking in this episode.', 422);
  if (chars > MAX_TRANSCRIPT_CHARS) throw new MomentsError('This transcript is too long to process at once.', 413);
  const count = Math.max(1, Math.min(MAX_COUNT, Math.round(Number(b.count) || 10)));
  return { segments, count };
}

/** Asks Gemini for the best moments and turns its answer into clips with exact times. */
export async function pickMoments(
  { segments, count }: PickMomentsRequest,
  { apiKey, model = DEFAULT_GEMINI_MODEL }: { apiKey: string; model?: string },
): Promise<Moment[]> {
  const transcript = segments.map((s, i) => `${i} [${clock(s.start)}] ${s.text}`).join('\n');
  const length = clock(segments[segments.length - 1]!.end);
  const prompt = `Episode length: ${length}. Pick the ${count} best clips.\n\nTranscript:\n${transcript}`;

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA, temperature: 0.4 },
    }),
  });
  if (res.status === 429) throw new MomentsError('Our AI is busy right now. Please try again in a minute.', 503);
  if (!res.ok) {
    console.error('Gemini error', res.status, await res.text().catch(() => ''));
    throw new MomentsError('Our AI couldn’t read this episode. Please try again.', 502);
  }
  const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  let raw: unknown;
  try {
    raw = (JSON.parse(text) as { moments?: unknown }).moments;
  } catch {
    console.error('Gemini returned non-JSON', text.slice(0, 500));
    throw new MomentsError('Our AI gave an answer we couldn’t read. Please try again.', 502);
  }
  return toMoments(Array.isArray(raw) ? raw : [], segments, count);
}

interface RawMoment {
  startLine: number;
  endLine: number;
  title: string;
  hook: string;
  reason: string;
  score: number;
}

/**
 * Turns the model's line numbers into clip times, and enforces what the prompt only asks for:
 * valid lines, 15–90 seconds, no overlaps, at most `count`, best first.
 */
export function toMoments(raw: unknown[], segments: Segment[], count: number): Moment[] {
  const last = segments.length - 1;
  const lineOf = (n: unknown) => Math.max(0, Math.min(last, Math.round(Number(n))));
  const candidates: Moment[] = [];
  for (const item of raw as Partial<RawMoment>[]) {
    if (!item || !Number.isFinite(Number(item.startLine)) || !Number.isFinite(Number(item.endLine))) continue;
    let a = lineOf(item.startLine);
    let b = lineOf(item.endLine);
    if (b < a) [a, b] = [b, a];
    const span = () => segments[b]!.end - segments[a]!.start;
    // Too long: drop lines from the end. Too short: add lines after, then before.
    while (span() > MAX_CLIP_SECONDS && b > a) b--;
    while (span() < MIN_CLIP_SECONDS && b < last && segments[b + 1]!.end - segments[a]!.start <= MAX_CLIP_SECONDS) b++;
    while (span() < MIN_CLIP_SECONDS && a > 0 && segments[b]!.end - segments[a - 1]!.start <= MAX_CLIP_SECONDS) a--;
    // A single Whisper line can be up to 30 s, so trimming by lines can't always reach the range.
    if (span() < MIN_CLIP_SECONDS) continue;
    const start = segments[a]!.start;
    const end = Math.min(segments[b]!.end, start + MAX_CLIP_SECONDS);
    candidates.push({
      start,
      end,
      title: String(item.title ?? '').trim() || 'Untitled moment',
      hook: String(item.hook ?? '').trim() || segments[a]!.text,
      reason: String(item.reason ?? '').trim(),
      score: Math.max(0, Math.min(100, Math.round(Number(item.score) || 0))),
    });
  }
  candidates.sort((x, y) => y.score - x.score);
  const picked: Moment[] = [];
  for (const m of candidates) {
    if (picked.length >= count) break;
    if (picked.some((p) => m.start < p.end && p.start < m.end)) continue;
    picked.push(m);
  }
  return picked;
}
