import { z } from 'zod/v4';

// The one answer format every AI provider must return. The server validates
// each response against it, so the website can trust every field.
// Unknown values are empty strings rather than null: Gemini's schema support
// for nullable fields is limited.
export const DiagnosisSchema = z.object({
  appliance: z.string().describe('Appliance type, e.g. "front-load washer", "vented dryer", "built-in dishwasher"'),
  brand: z.string().describe('Brand if visible or stated, else ""'),
  model_number: z.string().describe('Model number read from the label or given by the user, else ""'),
  error_code: z.string().describe('Error code shown on the display or described, else ""'),
  summary: z.string().describe('One or two plain-language sentences: what is most likely wrong'),
  confidence: z.enum(['low', 'medium', 'high']),
  likely_causes: z
    .array(
      z.object({
        cause: z.string().describe('Short name using the professional part or fault name'),
        likelihood: z.enum(['high', 'medium', 'low']),
        explanation: z.string().describe('Plain-language explanation for a non-technical person'),
      }),
    )
    .describe('Most likely first, 1 to 4 items'),
  difficulty: z.enum(['easy', 'moderate', 'hard', 'pro_only']),
  safety_warnings: z.array(z.string()),
  steps: z.array(z.string()).describe('Ordered checks and fixes, easiest and cheapest first'),
  parts: z
    .array(
      z.object({
        name: z.string().describe('Professional part name, e.g. "Drain pump"'),
        plain_name: z.string().describe('What it is in plain words, e.g. "the small motor that pushes water out"'),
        search_query: z.string().describe('Store search query: brand + model number (when known) + part name'),
        why: z.string(),
      }),
    )
    .describe('Replacement parts that may be needed; empty if none is likely needed'),
  call_a_pro_if: z.array(z.string()),
  need_more_info: z.string().describe('If unsure, exactly what to photograph or describe next; else ""'),
});

export type Diagnosis = z.infer<typeof DiagnosisSchema>;
