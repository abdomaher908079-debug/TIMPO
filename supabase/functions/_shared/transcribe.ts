// Turns a piece of an episode's audio into a timed transcript with Gemini ("cloud listening").
// Web-standard APIs only (fetch, JSON), like moments.ts.
import { DEFAULT_GEMINI_MODEL, MomentsError, type Segment } from './moments.ts';

// The browser sends the episode in pieces of this length, so each request stays quick and timings stay accurate.
export const PIECE_SECONDS = 5 * 60;
// A piece of speech-quality audio is about 1–2 MB; this leaves plenty of room.
export const MAX_PIECE_BYTES = 12 * 1024 * 1024;
const AUDIO_TYPES = ['audio/ogg', 'audio/aac', 'audio/mp4', 'audio/webm', 'audio/wav', 'audio/mpeg', 'audio/flac'];

// A compact answer (time and words per line, no JSON) costs fewer output tokens, which are most of
// the price of listening.
const PROMPT = `Transcribe this podcast audio word for word, in the language spoken.
Write one line per sentence (or at most about 10 seconds of speech). Start each line with the time the line starts,
from the beginning of this audio, as MM:SS.s (minutes, seconds, tenths), then a space, then the exact words. For example:
00:03.2 Welcome back to the show.
00:06.8 Today we're talking about sleep.
Write only what is said: no speaker names, no descriptions of sounds or music, nothing else. Skip silence and music.
If nobody speaks, write nothing.`;

const LITE = 'gemini-flash-lite-latest';

export interface Attempt {
  apiKey: string;
  model: string;
}

/**
 * Which keys and models listen, in the order to try them:
 * - Free (quick): the free-tier key (costs us nothing), Flash-Lite then Flash; only when both are
 *   busy, the paid key's Flash-Lite, so Free users never wait.
 * - Paid plans (best): the paid key once it's set (no limits, and Google doesn't use the audio),
 *   Flash then Flash-Lite. Until it's set, the free-tier key.
 */
export function listenerFor(quality: 'quick' | 'best', env: (name: string) => string | undefined): Attempt[] | null {
  const freeKey = env('GEMINI_API_KEY');
  const paidKey = env('GEMINI_PAID_API_KEY');
  let attempts: Attempt[];
  if (quality === 'quick') {
    attempts = freeKey ? [LITE, DEFAULT_GEMINI_MODEL].map((model) => ({ apiKey: freeKey, model })) : [];
    if (paidKey) attempts.push({ apiKey: paidKey, model: LITE });
  } else {
    const apiKey = paidKey || freeKey;
    attempts = apiKey ? [DEFAULT_GEMINI_MODEL, LITE].map((model) => ({ apiKey, model })) : [];
  }
  return attempts.length ? attempts : null;
}

/** "MM:SS.s", "H:MM:SS" or plain seconds → seconds. */
export function parseTime(value: unknown): number {
  if (typeof value === 'number') return value;
  const parts = String(value ?? '').trim().split(':').map(Number);
  if (!parts.length || parts.some((p) => !Number.isFinite(p))) return NaN;
  return parts.reduce((total, p) => total * 60 + p, 0);
}

/**
 * Cleans the model's lines into segments in episode time: `offset` is where the piece starts and
 * `length` its duration. Times are kept inside the piece, in order, and never overlap.
 */
export function toSegments(raw: unknown[], offset: number, length: number): Segment[] {
  const lines = raw
    .map((l) => l as { start?: unknown; end?: unknown; text?: unknown })
    .map((l) => ({ start: parseTime(l?.start), end: parseTime(l?.end), text: String(l?.text ?? '').trim() }))
    .filter((l) => l.text && Number.isFinite(l.start))
    .sort((a, b) => a.start - b.start);
  const segments: Segment[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const start = Math.max(0, Math.min(length, line.start));
    const next = i + 1 < lines.length ? Math.min(length, lines[i + 1]!.start) : length;
    // No end given (the compact answer has start times only): until the next line, but no longer
    // than slow speech would take, so a pause after it isn't counted as speech.
    let end = Number.isFinite(line.end) && line.end > start ? line.end : start + line.text.split(/\s+/).length / 1.6 + 0.5;
    end = Math.max(start, Math.min(end, next, length));
    if (end - start < 0.2 && start >= length) continue;
    segments.push({ start: round(offset + start), end: round(offset + Math.max(end, start + 0.2)), text: line.text });
  }
  return segments;
}

const round = (s: number) => Math.round(s * 100) / 100;

class Busy extends Error {}

// What a request used, for working out costs: tokens in (audio) and out (words, and any thinking).
export interface Usage {
  model: string;
  paid: boolean;
  input: number;
  output: number;
}

/** Transcribes one piece of audio, moving on to the next key or model when one is busy or out of quota. */
export async function listen(
  audio: Uint8Array,
  type: string,
  offset: number,
  length: number,
  attempts: Attempt[],
  paidKey?: string,
): Promise<{ segments: Segment[]; usage: Usage }> {
  const data = toBase64(audio);
  for (const { apiKey, model } of attempts) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { lines, input, output } = await ask(model, apiKey, type, data);
        return { segments: toSegments(lines, offset, length), usage: { model, paid: apiKey === paidKey, input, output } };
      } catch (err) {
        if (!(err instanceof Busy)) throw err;
        console.error(`Gemini ${model}: ${err.message}`);
        if (attempt === 0) await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }
  throw new MomentsError('Our AI is busy right now. Please try again in a minute.', 503);
}

// Models that turned down the "minimal thinking" setting (older ones): asked without it from then on.
const noThinkingSetting = new Set<string>();

async function ask(model: string, apiKey: string, type: string, data: string): Promise<{ lines: { start: string; text: string }[]; input: number; output: number }> {
  // Thinking is billed as output and doesn't help writing down speech, so keep it to a minimum.
  const thinking = noThinkingSetting.has(model) ? {} : { thinkingConfig: { thinkingLevel: 'minimal' } };
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ inlineData: { mimeType: type, data } }, { text: PROMPT }] }],
      generationConfig: { temperature: 0, ...thinking },
    }),
  });
  if (res.status === 429 || res.status === 404 || res.status >= 500) throw new Busy(`${res.status}`);
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    if (res.status === 400 && 'thinkingConfig' in thinking && /thinking/i.test(detail)) {
      noThinkingSetting.add(model);
      return ask(model, apiKey, type, data);
    }
    console.error('Gemini error', res.status, detail);
    throw new MomentsError('Our AI couldn’t listen to this episode. Please try again.', 502);
  }
  const body = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  };
  const usage = body.usageMetadata ?? {};
  const text = body.candidates?.[0]?.content?.parts?.filter((p) => !p.thought).map((p) => p.text ?? '').join('') ?? '';
  const lines = parseLines(text);
  if (!lines.length && /\p{L}{3}/u.test(text)) {
    // Words but no timed lines: an answer we can't use, so let the next model try.
    console.error('Gemini answer without times', body.candidates?.[0]?.finishReason, text.slice(0, 300));
    throw new Busy('unreadable answer');
  }
  return { lines, input: usage.promptTokenCount ?? 0, output: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0) };
}

/** "00:03.2 Welcome back." lines (also "[00:03.2]", "0:03", "1:02:03.4 …") → start times and words. */
export function parseLines(text: string): { start: string; text: string }[] {
  const lines: { start: string; text: string }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(/^\s*[[(]?((?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d+)?)[\])]?(?:\s*[-–]\s*[[(]?(?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d+)?[\])]?)?\s*[:\-–]?\s+(.+?)\s*$/);
    if (m) lines.push({ start: m[1]!.replace(',', '.'), text: m[2]! });
  }
  return lines;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
