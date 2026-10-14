import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleDiagnose } from '../server/diagnose.js';

// Photos plus the AI's thinking can take a while.
export const config = { maxDuration: 60 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const result = await handleDiagnose(req.body, req.headers.authorization);
  return res.status(result.status).json(result.body);
}
