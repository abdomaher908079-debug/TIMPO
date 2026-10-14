import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { DiagnosisSchema } from '../../src/shared/diagnosis.js';
import type { DiagnoseRequest } from '../../src/shared/types.js';
import { SYSTEM_PROMPT, userText } from '../prompt.js';
import { ProviderError, splitDataUrl } from './common.js';

// Override with CLAUDE_MODEL (e.g. a cheaper Sonnet or Haiku) once we've
// compared accuracy on real photos.
const DEFAULT_MODEL = 'claude-opus-5-5';

export async function diagnoseWithClaude(req: DiagnoseRequest, apiKey: string): Promise<unknown> {
  const client = new Anthropic({ apiKey });
  const content: Anthropic.Beta.BetaContentBlockParam[] = req.photos.map((photo) => {
    const { mediaType, data } = splitDataUrl(photo);
    return { type: 'image', source: { type: 'base64', media_type: mediaType, data } };
  });
  content.push({ type: 'text', text: userText(req) });

  try {
    const response = await client.beta.messages.parse({
      model: process.env.CLAUDE_MODEL || DEFAULT_MODEL,
      max_tokens: 16000,
      output_config: { effort: 'medium', format: betaZodOutputFormat(DiagnosisSchema) },
      // If a safety classifier declines, retry on Anthropic's recommended fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content }],
    });
    if (response.stop_reason === 'refusal') throw new ProviderError('refused', 'The AI declined this request.');
    if (!response.parsed_output) throw new ProviderError('bad_output', 'The AI answer was incomplete.');
    return response.parsed_output;
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) throw new ProviderError('rate_limited', error.message);
    if (error instanceof Anthropic.APIError) {
      throw new ProviderError('upstream', `Claude error ${error.status}: ${error.message}`);
    }
    throw error;
  }
}
