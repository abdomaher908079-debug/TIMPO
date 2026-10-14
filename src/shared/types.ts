// Plain types and constants shared by the website and the server. Kept free of
// zod so the browser bundle doesn't include the validation library.
import type { Diagnosis } from './diagnosis';

export type { Diagnosis };

export const APPLIANCES = ['Washer', 'Dryer', 'Dishwasher'] as const;
export type Appliance = (typeof APPLIANCES)[number];
export const MAX_PHOTOS = 3;

export interface DiagnoseRequest {
  appliance: Appliance;
  description: string;
  modelNumber: string;
  // JPEG data URLs, resized in the browser before upload.
  photos: string[];
}

export type Provider = 'gemini' | 'claude' | 'sample';

export interface DiagnoseResponse {
  diagnosis: Diagnosis;
  provider: Provider;
}
