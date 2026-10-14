import { createClient } from '@supabase/supabase-js';
import { DiagnosisSchema } from '../src/shared/diagnosis.js';
import {
  APPLIANCES,
  MAX_PHOTOS,
  type DiagnoseRequest,
  type DiagnoseResponse,
  type Provider,
} from '../src/shared/types.js';
import { diagnoseWithClaude } from './providers/claude.js';
import { ProviderError, isImageDataUrl } from './providers/common.js';
import { diagnoseWithGemini } from './providers/gemini.js';
import { sampleDiagnosis } from './providers/sample.js';

// Shared by the Vercel function (api/diagnose.ts) and the dev server (vite.config.ts).

export interface HttpResult {
  status: number;
  body: DiagnoseResponse | { error: string };
}

const MAX_PHOTO_CHARS = 2_000_000; // ~1.5 MB per photo; resized photos are far smaller.

function pickProvider(): Provider {
  const chosen = process.env.AI_PROVIDER?.toLowerCase();
  if (chosen === 'gemini' || chosen === 'claude' || chosen === 'sample') return chosen;
  if (process.env.GEMINI_API_KEY) return 'gemini';
  if (process.env.ANTHROPIC_API_KEY) return 'claude';
  return 'sample';
}

function parseRequest(body: unknown): DiagnoseRequest | string {
  if (!body || typeof body !== 'object') return 'Invalid request.';
  const b = body as Record<string, unknown>;
  if (!APPLIANCES.includes(b.appliance as never)) return 'Choose which appliance has the problem.';
  const description = typeof b.description === 'string' ? b.description.trim().slice(0, 2000) : '';
  const modelNumber = typeof b.modelNumber === 'string' ? b.modelNumber.trim().slice(0, 100) : '';
  const photos = Array.isArray(b.photos) ? b.photos : [];
  if (photos.length > MAX_PHOTOS) return `Add up to ${MAX_PHOTOS} photos.`;
  if (!photos.every((p) => isImageDataUrl(p) && p.length <= MAX_PHOTO_CHARS)) {
    return "One of the photos couldn't be read. Try a JPEG or PNG.";
  }
  if (photos.length === 0 && !description) return 'Add a photo or describe the problem.';
  return { appliance: b.appliance as DiagnoseRequest['appliance'], description, modelNumber, photos };
}

// With Supabase configured, only logged-in users may use the AI. In demo mode
// (no Supabase keys) anyone can, which is fine for local testing only.
async function isAuthorized(authHeader: string | undefined): Promise<boolean> {
  const url = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return true;
  const token = authHeader?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return false;
  const { data, error } = await createClient(url, anonKey).auth.getUser(token);
  return !error && !!data.user;
}

export async function handleDiagnose(body: unknown, authHeader: string | undefined): Promise<HttpResult> {
  if (!(await isAuthorized(authHeader))) {
    return { status: 401, body: { error: 'Please log in to diagnose your appliance.' } };
  }
  const req = parseRequest(body);
  if (typeof req === 'string') return { status: 400, body: { error: req } };

  const provider = pickProvider();
  try {
    let raw: unknown;
    if (provider === 'gemini') raw = await diagnoseWithGemini(req, process.env.GEMINI_API_KEY ?? '');
    else if (provider === 'claude') raw = await diagnoseWithClaude(req, process.env.ANTHROPIC_API_KEY ?? '');
    else raw = sampleDiagnosis(req);

    // Never pass an unchecked AI answer to the website.
    const parsed = DiagnosisSchema.safeParse(raw);
    if (!parsed.success) {
      console.error(`[diagnose] ${provider} returned an invalid answer:`, parsed.error.message);
      return { status: 502, body: { error: 'The diagnosis came back incomplete. Please try again.' } };
    }
    return { status: 200, body: { diagnosis: parsed.data, provider } };
  } catch (error) {
    if (error instanceof ProviderError) {
      console.error(`[diagnose] ${provider} ${error.kind}:`, error.message);
      if (error.kind === 'rate_limited') {
        return { status: 429, body: { error: 'Lots of people are diagnosing right now. Please try again in a minute.' } };
      }
      if (error.kind === 'refused') {
        return { status: 422, body: { error: "Sorry, we can't help with this request." } };
      }
      return { status: 502, body: { error: 'The diagnosis service is having trouble. Please try again.' } };
    }
    console.error('[diagnose] unexpected error:', error);
    return { status: 500, body: { error: 'Something went wrong. Please try again.' } };
  }
}
