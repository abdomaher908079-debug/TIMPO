import { ApiError, GoogleGenAI } from '@google/genai';
import { z } from 'zod/v4';
import { DiagnosisSchema } from '../../src/shared/diagnosis.js';
import type { DiagnoseRequest } from '../../src/shared/types.js';
import { SYSTEM_PROMPT, userText } from '../prompt.js';
import { ProviderError, splitDataUrl } from './common.js';

// Free-tier Flash models accept photos. Override with GEMINI_MODEL.
const DEFAULT_MODEL = 'gemini-2.5-flash';

// Gemini accepts a subset of JSON Schema; drop the keys it doesn't know.
const { $schema: _ignored, ...RESPONSE_SCHEMA } = z.toJSONSchema(DiagnosisSchema) as Record<string, unknown>;

export async function diagnoseWithGemini(req: DiagnoseRequest, apiKey: string): Promise<unknown> {
  const ai = new GoogleGenAI({ apiKey });
  try {
    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || DEFAULT_MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            ...req.photos.map((photo) => {
              const { mediaType, data } = splitDataUrl(photo);
              return { inlineData: { mimeType: mediaType, data } };
            }),
            { text: userText(req) },
          ],
        },
      ],
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: 'application/json',
        responseJsonSchema: RESPONSE_SCHEMA,
      },
    });
    const text = response.text;
    if (!text) throw new ProviderError('empty', 'The AI returned an empty answer.');
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 429) throw new ProviderError('rate_limited', error.message);
      throw new ProviderError('upstream', `Gemini error ${error.status}: ${error.message}`);
    }
    if (error instanceof SyntaxError) throw new ProviderError('bad_output', 'The AI answer was not valid JSON.');
    throw error;
  }
}
