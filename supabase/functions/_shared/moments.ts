// Picks an episode's best clip moments from its transcript with Gemini.
// Shared by the Supabase Edge Function (production) and the Vite dev server (local), so it must
// only use web-standard APIs (fetch, JSON): no Deno or Node globals.

export interface Segment {
  // Seconds from the start of the episode.
  start: number;
  end: number;
  text: string;
  // Said with strong emotion or energy (heard by cloud listening): excitement, laughter, a raised voice.
  energy?: boolean;
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
  // The "Pro edit" (paid plans): on-screen headline, words to highlight in the captions, and short
  // phrases to zoom in on. Words and phrases are copied from the clip's transcript.
  headline?: string;
  emphasis?: string[];
  punchIns?: string[];
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
// The strongest model on Gemini's free tier, and the fallback when a configured model is unavailable.
export const DEFAULT_GEMINI_MODEL = 'gemini-flash-latest';

export interface GeminiChoice {
  apiKey: string;
  model: string;
  // Tried when every model on the first key is busy or out of quota.
  backup?: GeminiChoice;
}

/**
 * Which Gemini key and model a plan's AI quality uses (see Quality in plans.ts):
 * - quick (Free): Flash-Lite on the free-tier key GEMINI_API_KEY, which costs us nothing. When the
 *   free tier is busy or out of quota, the paid key (GEMINI_PAID_API_KEY, billing on) takes over,
 *   so Free users never wait.
 * - best (Pro, Studio): the top model on the paid key (no limits, and Google doesn't use the data
 *   to improve its products). Until that key is set, the strongest model on the free key.
 * Model names can be overridden with GEMINI_MODEL_QUICK and GEMINI_MODEL_BEST.
 */
export function geminiFor(quality: 'quick' | 'best', env: (name: string) => string | undefined): GeminiChoice | null {
  const freeKey = env('GEMINI_API_KEY');
  const paidKey = env('GEMINI_PAID_API_KEY');
  if (quality === 'quick') {
    const model = env('GEMINI_MODEL_QUICK') || 'gemini-flash-lite-latest';
    const paid = paidKey ? { apiKey: paidKey, model } : undefined;
    return freeKey ? { apiKey: freeKey, model, backup: paid } : (paid ?? null);
  }
  if (paidKey) return { apiKey: paidKey, model: env('GEMINI_MODEL_BEST') || 'gemini-pro-latest' };
  return freeKey ? { apiKey: freeKey, model: DEFAULT_GEMINI_MODEL } : null;
}

export class MomentsError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const SYSTEM_PROMPT = `You are the lead editor of a team that turns podcast episodes into short vertical clips for TikTok,
Instagram Reels and YouTube Shorts. Your clips are known for stopping the scroll and being watched to the end.

You get a numbered transcript of one episode. Each line is "<line number> [<time>] <text>". Lines marked (!) were said
with strong emotion or energy: excitement, laughter, a raised voice, heavy emphasis.

Pick the moments that work best as stand-alone clips. Judge each candidate like this:
1. Hook (most important): the first sentence must stop the scroll within 3 seconds. Strong hooks are a bold or
   contrarian claim, a surprising fact or number, a direct question, a confession, the start of a story with stakes,
   a strong emotion, or a funny line. Start the clip exactly on that sentence. Never start mid-thought, with filler
   ("so", "and", "yeah", "um", "like"), or with a reference to something earlier ("as I said", "that's why").
2. Stands alone: someone who never heard the episode understands it. One idea per clip.
3. Payoff: it ends on a complete sentence that lands: a punchline, an insight, the end of the story, a clear
   takeaway, or a line that makes people comment. End right after it, not on the next topic.
4. Energy: real emotion, laughter, conflict and vivid stories beat calm explanations. Favor (!) lines.
5. Length: ${MIN_CLIP_SECONDS} to ${MAX_CLIP_SECONDS} seconds, 25 to 60 is ideal. Shorter is better when the idea is complete.

Avoid intros, outros, ads, sponsor reads, housekeeping, small talk, inside jokes, and moments that only work with
visuals. Clips must not overlap. Prefer variety: different ideas from across the episode.

For each clip give:
- startLine and endLine: the first and last transcript line numbers of the clip (inclusive).
- title: a punchy title of at most 8 words for the post, no hashtags or emojis.
- hook: the exact opening words of the clip, copied from the transcript (at most 15 words).
- headline: on-screen text shown at the top of the video, at most 7 words. It makes people need to keep
  watching (a curiosity gap or a bold promise) and is true to the clip. Sentence case, no emojis, no hashtags, no
  quotation marks, and different from the hook.
- emphasis: 3 to 8 single words copied exactly from the clip to highlight in the captions: the words carrying
  the meaning (numbers, names, strong verbs, surprising or emotional words). Never filler words.
- punchIns: 1 to 3 short phrases (2 to 5 words) copied exactly from the clip where a quick zoom-in adds impact:
  the punchline, a reveal, the strongest emotion. Not the first sentence.
- reason: one short sentence on why it will perform.
- score: 0 to 100 for how well it will perform: hook 40 points, stands alone 20, payoff 25, energy 15. Be strict and
  spread the scores out; most clips are not 90+.

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
          headline: { type: 'STRING' },
          emphasis: { type: 'ARRAY', items: { type: 'STRING' } },
          punchIns: { type: 'ARRAY', items: { type: 'STRING' } },
          reason: { type: 'STRING' },
          score: { type: 'INTEGER' },
        },
        required: ['startLine', 'endLine', 'title', 'hook', 'headline', 'emphasis', 'punchIns', 'reason', 'score'],
        propertyOrdering: ['startLine', 'endLine', 'title', 'hook', 'headline', 'emphasis', 'punchIns', 'reason', 'score'],
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
    segments.push({ start: s.start, end: Math.max(s.start, s.end), text, ...(s.energy === true ? { energy: true } : {}) });
  }
  if (!segments.length) throw new MomentsError('We didn’t hear anyone speaking in this episode.', 422);
  if (chars > MAX_TRANSCRIPT_CHARS) throw new MomentsError('This transcript is too long to process at once.', 413);
  const count = Math.max(1, Math.min(MAX_COUNT, Math.round(Number(b.count) || 10)));
  return { segments, count };
}

/** Asks Gemini for the best moments and turns its answer into clips with exact times. */
// When a model is overloaded, out of quota or gone, step down to the next one rather than fail.
const FALLBACK_CHAIN = ['gemini-pro-latest', DEFAULT_GEMINI_MODEL, 'gemini-flash-lite-latest'];

export async function pickMoments(request: PickMomentsRequest, { apiKey, model, backup }: GeminiChoice): Promise<Moment[]> {
  const after = FALLBACK_CHAIN.indexOf(model);
  const models = [model, ...(after >= 0 ? FALLBACK_CHAIN.slice(after + 1) : FALLBACK_CHAIN.slice(1))];
  let lastError: unknown;
  for (const m of models) {
    // Overload (503) is usually brief: one quick retry on the same model first.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await askGemini(request, apiKey, m);
      } catch (err) {
        lastError = err;
        if (!(err instanceof ModelProblem)) throw err;
        console.error(`Gemini ${m}: ${err.detail}`);
        if (err.detail !== 'overloaded' || attempt === 1) break;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }
  if (backup) return pickMoments(request, backup);
  throw lastError instanceof ModelProblem
    ? new MomentsError('Our AI is busy right now. Please try again in a minute.', 503)
    : lastError;
}

// The model can't answer right now, but another one might.
class ModelProblem extends MomentsError {
  constructor(readonly detail: 'overloaded' | 'quota' | 'not-found') {
    super(detail, 503);
  }
}

async function askGemini({ segments, count }: PickMomentsRequest, apiKey: string, model: string): Promise<Moment[]> {
  const transcript = segments.map((s, i) => `${i} [${clock(s.start)}]${s.energy ? ' (!)' : ''} ${s.text}`).join('\n');
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
  if (res.status === 429) throw new ModelProblem('quota');
  if (res.status === 404) throw new ModelProblem('not-found');
  if (res.status === 503 || res.status === 500) throw new ModelProblem('overloaded');
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
  headline: string;
  emphasis: unknown;
  punchIns: unknown;
  reason: string;
  score: number;
}

const normWord = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');

/** Keeps only words and phrases that really are in the clip's text (the model sometimes paraphrases). */
function fromClip(items: unknown, text: string, maxWords: number, max: number): string[] {
  if (!Array.isArray(items)) return [];
  const clip = ` ${text.split(/\s+/).map(normWord).filter(Boolean).join(' ')} `;
  const out: string[] = [];
  for (const item of items) {
    const phrase = String(item ?? '').trim();
    const words = phrase.split(/\s+/).map(normWord).filter(Boolean);
    if (!words.length || words.length > maxWords || !clip.includes(` ${words.join(' ')} `)) continue;
    if (!out.some((o) => normWord(o) === normWord(phrase))) out.push(phrase);
    if (out.length >= max) break;
  }
  return out;
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
    const text = segments.slice(a, b + 1).map((s) => s.text).join(' ');
    const headline = String(item.headline ?? '').replace(/["“”#]/g, '').trim().split(/\s+/).slice(0, 9).join(' ');
    candidates.push({
      headline: headline || undefined,
      emphasis: fromClip(item.emphasis, text, 1, 8),
      punchIns: fromClip(item.punchIns, text, 6, 3),
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
