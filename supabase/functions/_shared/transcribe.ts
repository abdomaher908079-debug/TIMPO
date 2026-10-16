// Turns a piece of an episode's audio into a timed transcript with Gemini ("cloud listening").
// Web-standard APIs only (fetch, JSON), like moments.ts.
import { DEFAULT_GEMINI_MODEL, MomentsError, type Segment } from './moments.ts';

// The browser sends the episode in pieces of this length, so each request stays quick and timings stay accurate.
export const PIECE_SECONDS = 5 * 60;
// A piece of speech-quality audio is about 1–2 MB; this leaves plenty of room.
export const MAX_PIECE_BYTES = 12 * 1024 * 1024;
const AUDIO_TYPES = ['audio/ogg', 'audio/aac', 'audio/mp4', 'audio/webm', 'audio/wav', 'audio/mpeg', 'audio/flac'];

const PROMPT = `Transcribe this podcast audio word for word, in the language spoken.
Split it into short lines: one sentence, or at most about 10 seconds of speech each.
For each line give start and end as MM:SS.s (minutes, seconds, tenths) from the beginning of this audio, and the exact words.
Write only what is said: no speaker names, no descriptions of sounds or music, no summaries.
Skip silence and music. If nobody speaks, return no lines.`;

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    lines: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { start: { type: 'STRING' }, end: { type: 'STRING' }, text: { type: 'STRING' } },
        required: ['start', 'end', 'text'],
        propertyOrdering: ['start', 'end', 'text'],
      },
    },
  },
  required: ['lines'],
};

/**
 * Which Gemini key and models listen for a plan: Flash-Lite, or Flash for Best AI. The paid key for
 * everyone once it's set (see geminiFor), otherwise the free-tier key.
 */
export function listenerFor(quality: 'quick' | 'best', env: (name: string) => string | undefined): { apiKey: string; models: string[] } | null {
  const apiKey = env('GEMINI_PAID_API_KEY') || env('GEMINI_API_KEY');
  if (!apiKey) return null;
  // When a model is busy or out of quota, the other one takes over.
  const models = quality === 'best' ? [DEFAULT_GEMINI_MODEL, 'gemini-flash-lite-latest'] : ['gemini-flash-lite-latest', DEFAULT_GEMINI_MODEL];
  return { apiKey, models };
}

export function audioType(type: string): string | null {
  const base = type.split(';')[0]!.trim().toLowerCase();
  return AUDIO_TYPES.includes(base) ? base : null;
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
    // A missing or impossible end: about 2.5 words a second, never past the next line.
    let end = Number.isFinite(line.end) && line.end > start ? line.end : start + line.text.split(/\s+/).length / 2.5;
    end = Math.max(start, Math.min(end, next, length));
    if (end - start < 0.2 && start >= length) continue;
    segments.push({ start: round(offset + start), end: round(offset + Math.max(end, start + 0.2)), text: line.text });
  }
  return segments;
}

const round = (s: number) => Math.round(s * 100) / 100;

class Busy extends Error {}

/** Transcribes one piece of audio. Steps down to the next model when one is busy or out of quota. */
export async function listen(
  audio: Uint8Array,
  type: string,
  offset: number,
  length: number,
  { apiKey, models }: { apiKey: string; models: string[] },
): Promise<Segment[]> {
  const data = toBase64(audio);
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return toSegments(await ask(model, apiKey, type, data), offset, length);
      } catch (err) {
        if (!(err instanceof Busy)) throw err;
        console.error(`Gemini ${model}: ${err.message}`);
        if (attempt === 0) await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }
  throw new MomentsError('Our AI is busy right now. Please try again in a minute.', 503);
}

async function ask(model: string, apiKey: string, type: string, data: string): Promise<unknown[]> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ inlineData: { mimeType: type, data } }, { text: PROMPT }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA, temperature: 0 },
    }),
  });
  if (res.status === 429 || res.status === 404 || res.status >= 500) throw new Busy(`${res.status}`);
  if (!res.ok) {
    console.error('Gemini error', res.status, await res.text().catch(() => ''));
    throw new MomentsError('Our AI couldn’t listen to this episode. Please try again.', 502);
  }
  const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[] };
  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  try {
    const lines = (JSON.parse(text) as { lines?: unknown }).lines;
    return Array.isArray(lines) ? lines : [];
  } catch {
    // Usually a cut-off answer: let the other model try.
    console.error('Gemini returned non-JSON', body.candidates?.[0]?.finishReason, text.slice(0, 300));
    throw new Busy('unreadable answer');
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
