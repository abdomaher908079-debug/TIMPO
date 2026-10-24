// Picks an episode's best clip moments from its transcript with Gemini.
// Shared by the Supabase Edge Function (production) and the Vite dev server (local), so it must
// only use web-standard APIs (fetch, JSON): no Deno or Node globals.

export interface Segment {
  // Seconds from the start of the episode.
  start: number;
  end: number;
  text: string;
  // Said with strong emotion or energy: excitement, laughter, a raised voice (heard by cloud listening, or
  // from the audio's loudness when transcribed on the device).
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
  // Stretches between start and end that are left out (a tangent between the setup and the payoff), in
  // episode seconds, in order. The clip plays what's left.
  skips?: TimeRange[];
  // The upload kit: a description and hashtags for posting the clip (with `title`).
  description?: string;
  hashtags?: string[];
  // Other openings to try if the clip doesn't take off: other headlines, and a later, stronger first line
  // (its start, in episode seconds).
  altHeadlines?: string[];
  altStart?: number;
}

export interface TimeRange {
  start: number;
  end: number;
}

/** How long a moment plays: its span minus what it skips (only the parts of skips inside the span count). */
export const keptSeconds = (m: { start: number; end: number; skips?: TimeRange[] }) =>
  m.end - m.start - (m.skips ?? []).reduce((n, s) => n + Math.max(0, Math.min(m.end, s.end) - Math.max(m.start, s.start)), 0);

export interface PickMomentsRequest {
  segments: Segment[];
  count: number;
}

export const MIN_CLIP_SECONDS = 15;
// The longest a clip plays...
export const MAX_CLIP_SECONDS = 90;
// ...and the longest stretch of the episode it may cover, with the parts it skips.
const MAX_SPAN_SECONDS = 150;
// At most this many stretches left out of one clip (so at most 3 parts joined).
const MAX_SKIPS = 2;
// The first pass suggests this many clips for each one wanted (up to MAX_CANDIDATES); the review keeps the best.
const CANDIDATES_PER_CLIP = 2;
const MAX_CANDIDATES = 40;
// A line that ends a sentence (also Arabic, Chinese and Japanese marks), with an optional closing quote or bracket.
const SENTENCE_END = /[.?!…؟。！？]["'”’)\]]*$/;
export const MAX_COUNT = 30;
// About 4 hours of speech. Keeps a single request well inside the free tier's token limits.
export const MAX_TRANSCRIPT_CHARS = 400_000;
// The strongest model on Gemini's free tier, and the fallback when a configured model is unavailable.
export const DEFAULT_GEMINI_MODEL = 'gemini-flash-latest';

export interface GeminiChoice {
  apiKey: string;
  model: string;
  // The paid key (billing on): its requests cost us money.
  paid?: boolean;
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
    const paid = paidKey ? { apiKey: paidKey, model, paid: true } : undefined;
    return freeKey ? { apiKey: freeKey, model, backup: paid } : (paid ?? null);
  }
  if (paidKey) return { apiKey: paidKey, model: env('GEMINI_MODEL_BEST') || 'gemini-pro-latest', paid: true };
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
5. Length: ${MIN_CLIP_SECONDS} to ${MAX_CLIP_SECONDS} seconds of what plays (after cutLines), 25 to 60 is ideal. Shorter is
   better when the idea is complete.

Avoid intros, outros, ads, sponsor reads, housekeeping, small talk, inside jokes, and moments that only work with
visuals. Clips must not overlap. Prefer variety: different ideas from across the episode.

For each clip give:
- startLine and endLine: the first and last transcript line numbers of the clip (inclusive).
- cutLines: line numbers between startLine and endLine to leave out, when the speaker goes off on a tangent,
  repeats themselves or gets interrupted, and the clip is stronger without it: keep the setup and the payoff,
  drop the detour between them. At most ${MAX_SKIPS} separate stretches, never the first or last line, and only when
  what remains still flows naturally. Usually empty.
- title: a punchy title of at most 8 words for the post, no hashtags or emojis.
- hook: the exact opening words of the clip, copied from the transcript (at most 15 words).
- headline: on-screen text shown at the top of the video, at most 7 words. It makes people need to keep
  watching (a curiosity gap or a bold promise) and is true to the clip. Sentence case, no emojis, no hashtags, no
  quotation marks, and different from the hook.
- emphasis: 3 to 8 single words copied exactly from the clip to highlight in the captions: the words carrying
  the meaning (numbers, names, strong verbs, surprising or emotional words). Never filler words.
- punchIns: 1 to 3 short phrases (2 to 5 words) copied exactly from the clip where a quick zoom-in adds impact:
  the punchline, a reveal, the strongest emotion. Not the first sentence.
- altHeadlines: 2 other headlines for the same clip, each a different angle (a question, a bold claim, a number,
  a confession), same rules as headline. Used to post the moment again with another opening.
- altStartLine: a later line inside the clip that would make an even stronger first line (a sharper hook), so the
  clip can be posted again starting there; it must still leave a complete clip of at least ${MIN_CLIP_SECONDS} seconds.
  -1 when the first line is already the strongest.
- description: 1 to 2 sentences to post with the clip: what happens and why it's worth watching. No hashtags or
  emojis, no links, never "in this clip".
- hashtags: 3 to 5 hashtags people search for, about the clip's topic, most specific first, each one word or
  words joined without spaces, without the # sign.
- reason: one short sentence on why it will perform.
- score: 0 to 100 for how well it will perform: hook 40 points, stands alone 20, payoff 25, energy 15. Be strict and
  spread the scores out; most clips are not 90+.

Language: write the title, headline, altHeadlines, description, hashtags and reason in the language the episode is spoken in (for an Arabic episode,
Arabic, in the same dialect and tone the speakers use). Never translate them into English unless the episode is in
English. hook, emphasis and punchIns are copied from the transcript as they are.

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
          cutLines: { type: 'ARRAY', items: { type: 'INTEGER' } },
          title: { type: 'STRING' },
          hook: { type: 'STRING' },
          headline: { type: 'STRING' },
          emphasis: { type: 'ARRAY', items: { type: 'STRING' } },
          punchIns: { type: 'ARRAY', items: { type: 'STRING' } },
          altHeadlines: { type: 'ARRAY', items: { type: 'STRING' } },
          altStartLine: { type: 'INTEGER' },
          description: { type: 'STRING' },
          hashtags: { type: 'ARRAY', items: { type: 'STRING' } },
          reason: { type: 'STRING' },
          score: { type: 'INTEGER' },
        },
        required: ['startLine', 'endLine', 'cutLines', 'title', 'hook', 'headline', 'emphasis', 'punchIns', 'altHeadlines', 'altStartLine', 'description', 'hashtags', 'reason', 'score'],
        propertyOrdering: ['startLine', 'endLine', 'cutLines', 'title', 'hook', 'headline', 'emphasis', 'punchIns', 'altHeadlines', 'altStartLine', 'description', 'hashtags', 'reason', 'score'],
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
// Longest wait for one answer; a slow model then steps down to the next (also keeps a step in its time).
const GEMINI_TIMEOUT_MS = 55_000;

/** Tokens one AI request used, for working out what it cost. */
export interface AiUsage {
  model: string;
  paid: boolean;
  input: number;
  output: number;
}

/**
 * The episode's best moments: a first pass suggests twice as many as wanted, then a stricter review keeps
 * and re-scores the best (see reviewMoments). If the review can't run in time, the first pass's best are used.
 */
export async function pickMoments(request: PickMomentsRequest, choice: GeminiChoice): Promise<{ moments: Moment[]; usage: AiUsage }> {
  const started = Date.now();
  const candidates = Math.min(MAX_CANDIDATES, Math.max(request.count, request.count * CANDIDATES_PER_CLIP));
  const first = await firstPass({ ...request, count: candidates }, choice);
  // The whole request must answer within the server's limit (about 150 s): review only with time to spare.
  const left = REVIEW_DEADLINE_MS - (Date.now() - started);
  if (left >= MIN_REVIEW_MS && first.moments.length > 1) {
    try {
      const review = await reviewMoments(first.moments, request.segments, request.count, first.used, Math.min(left, GEMINI_TIMEOUT_MS));
      const usage = { ...first.usage, input: first.usage.input + review.input, output: first.usage.output + review.output };
      return { moments: review.moments, usage };
    } catch (err) {
      // The first pass's picks are good clips too; better those now than none.
      console.error('Review skipped', err instanceof Error ? err.message : err);
    }
  }
  return { moments: first.moments.slice(0, request.count), usage: first.usage };
}

/** The first pass: tries each model in turn (and the backup key) until one answers. */
async function firstPass(
  request: PickMomentsRequest,
  { apiKey, model, backup, paid = false }: GeminiChoice,
): Promise<{ moments: Moment[]; usage: AiUsage; used: { apiKey: string; model: string } }> {
  const after = FALLBACK_CHAIN.indexOf(model);
  const models = [model, ...(after >= 0 ? FALLBACK_CHAIN.slice(after + 1) : FALLBACK_CHAIN.slice(1))];
  let lastError: unknown;
  // Every model said "out of quota": the free AI's daily limit is used up, so retrying soon won't help.
  let allQuota = true;
  for (const m of models) {
    // Overload (503) is usually brief: one quick retry on the same model first.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { moments, input, output } = await askGemini(request, apiKey, m);
        return { moments, usage: { model: m, paid, input, output }, used: { apiKey, model: m } };
      } catch (err) {
        lastError = err;
        if (!(err instanceof ModelProblem)) throw err;
        if (err.detail !== 'quota') allQuota = false;
        console.error(`Gemini ${m}: ${err.detail}`);
        if (err.detail !== 'overloaded' || attempt === 1) break;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }
  if (backup) return firstPass(request, backup);
  if (!(lastError instanceof ModelProblem)) throw lastError;
  throw allQuota ? new DailyLimit() : new RateLimited();
}

export const DAILY_LIMIT_MESSAGE =
  'Isla is very busy today and has reached its daily AI limit. Please try again tomorrow; this episode wasn’t counted.';

/** Which free-tier limit a 429 hit: the per-minute one passes in seconds, the daily one only tomorrow. */
export async function quotaKind(res: Response): Promise<'minute' | 'day'> {
  const text = await res.text().catch(() => '');
  return /PerDay/i.test(text) ? 'day' : 'minute';
}

/** The free AI's daily limit is used up: retrying today won't help. */
export class DailyLimit extends MomentsError {
  constructor(message = DAILY_LIMIT_MESSAGE) {
    super(message, 503);
  }
}

/** Every model was busy (too many requests this minute, or overloaded): worth trying again shortly. */
export class RateLimited extends MomentsError {
  constructor() {
    super('Our AI is busy right now. Please try again in a minute.', 503);
  }
}

// The model can't answer right now, but another one might.
class ModelProblem extends MomentsError {
  constructor(readonly detail: 'overloaded' | 'quota' | 'not-found' | 'slow') {
    super(detail, 503);
  }
}

async function askGemini(
  { segments, count }: PickMomentsRequest,
  apiKey: string,
  model: string,
): Promise<{ moments: Moment[]; input: number; output: number }> {
  const transcript = segments.map((s, i) => `${i} [${clock(s.start)}]${s.energy ? ' (!)' : ''} ${s.text}`).join('\n');
  const length = clock(segments[segments.length - 1]!.end);
  const prompt = `Episode length: ${length}. Pick the ${count} best clips.\n\nTranscript:\n${transcript}`;
  const { json, input, output } = await callGemini(SYSTEM_PROMPT, prompt, RESPONSE_SCHEMA, apiKey, model, GEMINI_TIMEOUT_MS, 0.4);
  const raw = (json as { moments?: unknown }).moments;
  return { moments: toMoments(Array.isArray(raw) ? raw : [], segments, count), input, output };
}

/** One request to Gemini for a JSON answer in `schema`. Throws ModelProblem when another model might do. */
async function callGemini(
  system: string,
  prompt: string,
  schema: object,
  apiKey: string,
  model: string,
  timeoutMs: number,
  temperature: number,
): Promise<{ json: unknown; input: number; output: number }> {
  let res: Response;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      // A model that hangs moves on to the next one (no second try), so the step stays within its time.
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature },
      }),
    });
  } catch (err) {
    if (err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError')) throw new ModelProblem('slow');
    throw err;
  }
  // The per-minute limit passes like an overload; only the daily one counts as out of quota.
  if (res.status === 429) throw new ModelProblem((await quotaKind(res)) === 'day' ? 'quota' : 'overloaded');
  if (res.status === 404) throw new ModelProblem('not-found');
  if (res.status === 503 || res.status === 500) throw new ModelProblem('overloaded');
  if (!res.ok) {
    console.error('Gemini error', res.status, await res.text().catch(() => ''));
    throw new MomentsError('Our AI couldn’t read this episode. Please try again.', 502);
  }
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  };
  const text = data.candidates?.[0]?.content?.parts?.filter((p) => !p.thought).map((p) => p.text ?? '').join('') ?? '';
  const usage = data.usageMetadata ?? {};
  const input = usage.promptTokenCount ?? 0;
  // Thinking is billed as output.
  const output = (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0);
  try {
    return { json: JSON.parse(text), input, output };
  } catch {
    console.error('Gemini returned non-JSON', model, input, output, text.slice(0, 500));
    throw new MomentsError('Our AI gave an answer we couldn’t read. Please try again.', 502);
  }
}

// The review must finish inside this much time from the start of the request, and is only tried with at
// least MIN_REVIEW_MS left (the server stops a request after about 150 s).
const REVIEW_DEADLINE_MS = 110_000;
const MIN_REVIEW_MS = 25_000;

const REVIEW_PROMPT = `You are the head editor of a team that turns podcast episodes into short vertical clips for
TikTok, Instagram Reels and YouTube Shorts. A junior editor suggested the clips below from one episode. You decide
which ones get published. Be strict: only clips a stranger scrolling past would stop for and watch to the end.

Judge each clip exactly as it plays (the text below is everything the viewer hears):
1. Hook (most important): do the first words stop the scroll on their own, with no context?
2. Stands alone: does a stranger understand it without the rest of the episode?
3. Payoff: does it end on a line that lands, not trail off or start a new topic?
4. Energy: real emotion, laughter, conflict or a vivid story. Lines marked (!) were said with energy.

For each clip give:
- id: the clip's number as given.
- keep: true only if you would publish it.
- score: 0 to 100: hook 40, stands alone 20, payoff 25, energy 15. Be strict and spread the scores out; a clip
  with a weak first sentence never scores above 60.
- reason: one short sentence on why it will perform (or why not), in the language the episode is spoken in.`;

const REVIEW_SCHEMA = {
  type: 'OBJECT',
  properties: {
    reviews: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { id: { type: 'INTEGER' }, keep: { type: 'BOOLEAN' }, score: { type: 'INTEGER' }, reason: { type: 'STRING' } },
        required: ['id', 'keep', 'score', 'reason'],
        propertyOrdering: ['id', 'keep', 'score', 'reason'],
      },
    },
  },
  required: ['reviews'],
};

/** What a viewer hears in a moment: its lines, without the stretches it skips, (!) on lively ones. */
function heard(m: Moment, segments: Segment[]): string {
  const skipped = (s: Segment) => (m.skips ?? []).some((k) => s.start >= k.start - 0.01 && s.end <= k.end + 0.01);
  return segments
    .filter((s) => s.end > m.start + 0.01 && s.start < m.end - 0.01 && !skipped(s))
    .map((s) => `${s.energy ? '(!) ' : ''}${s.text}`)
    .join(' ');
}

/**
 * The second pass: a stricter editor judges every suggested moment as it plays, then the best `count` are
 * kept, published ones first, each with the review's score and reason. One try on the model that answered
 * the first pass; any problem throws, and the caller falls back to the first pass.
 */
export async function reviewMoments(
  moments: Moment[],
  segments: Segment[],
  count: number,
  { apiKey, model }: { apiKey: string; model: string },
  timeoutMs: number,
): Promise<{ moments: Moment[]; input: number; output: number }> {
  const list = moments
    .map((m, i) => `Clip ${i} (${Math.round(keptSeconds(m))} s). Title: ${m.title}. Headline: ${m.headline ?? ''}\n${heard(m, segments)}`)
    .join('\n\n');
  const { json, input, output } = await callGemini(REVIEW_PROMPT, `Clips:\n\n${list}`, REVIEW_SCHEMA, apiKey, model, timeoutMs, 0.2);
  const reviews = (json as { reviews?: unknown }).reviews;
  if (!Array.isArray(reviews)) throw new Error('no reviews');
  const byId = new Map<number, { keep: boolean; score: number; reason: string }>();
  for (const r of reviews as { id?: unknown; keep?: unknown; score?: unknown; reason?: unknown }[]) {
    const id = Number(r?.id);
    if (!Number.isInteger(id) || id < 0 || id >= moments.length || byId.has(id)) continue;
    byId.set(id, {
      keep: r.keep === true,
      score: Math.max(0, Math.min(100, Math.round(Number(r.score) || 0))),
      reason: String(r.reason ?? '').trim(),
    });
  }
  // Too few verdicts to trust: use the first pass instead.
  if (byId.size < moments.length / 2) throw new Error(`only ${byId.size} of ${moments.length} reviewed`);
  const judged = moments.map((m, i) => {
    const r = byId.get(i);
    // Not reviewed: kept below every reviewed one.
    return { m: r ? { ...m, score: r.score, reason: r.reason || m.reason } : { ...m, score: Math.min(m.score, 40) }, keep: r?.keep ?? false };
  });
  judged.sort((x, y) => Number(y.keep) - Number(x.keep) || y.m.score - x.m.score);
  return { moments: judged.slice(0, count).map((j) => j.m), input, output };
}

interface RawMoment {
  startLine: number;
  endLine: number;
  cutLines: unknown;
  title: string;
  hook: string;
  headline: string;
  emphasis: unknown;
  punchIns: unknown;
  altHeadlines: unknown;
  altStartLine: unknown;
  description: string;
  hashtags: unknown;
  reason: string;
  score: number;
}

const normWord = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');

/** A headline as shown on screen: no quotes or hashtags, at most 9 words. */
const cleanHeadline = (h: unknown) => String(h ?? '').replace(/["“”#]/g, '').trim().split(/\s+/).slice(0, 9).join(' ');

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
 * valid lines, 15–90 seconds of what plays, at most MAX_SKIPS stretches left out, no overlaps, at most
 * `count`, best first.
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
    const cuts = new Set(
      (Array.isArray(item.cutLines) ? item.cutLines : []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= last),
    );
    // The stretches left out between a and b (never a or b themselves), as runs of whole lines.
    const runs = () => {
      const out: [number, number][] = [];
      for (let i = a + 1; i < b; i++) {
        if (!cuts.has(i)) continue;
        const prev = out[out.length - 1];
        if (prev && prev[1] === i - 1) prev[1] = i;
        else out.push([i, i]);
      }
      return out.slice(0, MAX_SKIPS);
    };
    // A run is left out from the end of the line before it to the start of the line after it.
    const skips = (): TimeRange[] => runs().map(([f, t]) => ({ start: segments[f - 1]!.end, end: segments[t + 1]!.start }));
    const span = () => segments[b]!.end - segments[a]!.start;
    const plays = () => keptSeconds({ start: segments[a]!.start, end: segments[b]!.end, skips: skips() });
    const fits = (from: number, to: number) => {
      const [oa, ob] = [a, b];
      [a, b] = [from, to];
      const ok = plays() <= MAX_CLIP_SECONDS && span() <= MAX_SPAN_SECONDS;
      [a, b] = [oa, ob];
      return ok;
    };
    // Too long: drop lines from the end. Too short: add lines after, then before.
    while ((plays() > MAX_CLIP_SECONDS || span() > MAX_SPAN_SECONDS) && b > a) b--;
    while (plays() < MIN_CLIP_SECONDS && b < last && fits(a, b + 1)) b++;
    while (plays() < MIN_CLIP_SECONDS && a > 0 && fits(a - 1, b)) a--;
    // Whisper's lines can break in the middle of a sentence: take the next line (or two) so the speaker finishes.
    for (let more = 0; more < 2 && b < last && !SENTENCE_END.test(segments[b]!.text.trim()); more++) {
      const next = segments[b + 1]!;
      if (next.start - segments[b]!.end > 1.2 || next.end - segments[b]!.end > 12 || !fits(a, b + 1)) break;
      b++;
    }
    // A single Whisper line can be up to 30 s, so trimming by lines can't always reach the range.
    if (plays() < MIN_CLIP_SECONDS) continue;
    const left = skips();
    const start = segments[a]!.start;
    const end = left.length ? segments[b]!.end : Math.min(segments[b]!.end, start + MAX_CLIP_SECONDS);
    const out = new Set(runs().flatMap(([f, t]) => Array.from({ length: t - f + 1 }, (_, k) => f + k)));
    const text = segments.slice(a, b + 1).filter((_, k) => !out.has(a + k)).map((s) => s.text).join(' ');
    const headline = cleanHeadline(item.headline);
    const altHeadlines = [...new Set((Array.isArray(item.altHeadlines) ? item.altHeadlines : []).map(cleanHeadline))]
      .filter((h) => h && h.toLowerCase() !== headline.toLowerCase())
      .slice(0, 2);
    // A later first line: inside the clip, not in a part it leaves out, leaving a full clip after it.
    const alt = Math.round(Number(item.altStartLine));
    const altStart =
      Number.isInteger(alt) && alt > a && alt <= b && !out.has(alt) &&
      keptSeconds({ start: segments[alt]!.start, end, skips: left.filter((k) => k.start >= segments[alt]!.start) }) >= MIN_CLIP_SECONDS
        ? segments[alt]!.start
        : undefined;
    const hashtags = (Array.isArray(item.hashtags) ? item.hashtags : [])
      .map((h) => String(h ?? '').replace(/[#\s]/g, '').replace(/[^\p{L}\p{N}_]/gu, ''))
      .filter((h, i, all) => h.length >= 2 && h.length <= 40 && all.findIndex((o) => o.toLowerCase() === h.toLowerCase()) === i)
      .slice(0, 5);
    const description = String(item.description ?? '').replace(/#\S+/g, '').trim().slice(0, 300);
    candidates.push({
      headline: headline || undefined,
      ...(altHeadlines.length ? { altHeadlines } : {}),
      ...(altStart !== undefined ? { altStart } : {}),
      ...(description ? { description } : {}),
      ...(hashtags.length ? { hashtags } : {}),
      emphasis: fromClip(item.emphasis, text, 1, 8),
      punchIns: fromClip(item.punchIns, text, 6, 3),
      start,
      end,
      ...(left.length ? { skips: left } : {}),
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
