import { defineConfig, loadEnv, type Connect, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { DEFAULT_GEMINI_MODEL, MomentsError, parseRequest, pickMoments } from './supabase/functions/_shared/moments';

// Lets speech recognition use all CPU cores (SharedArrayBuffer needs cross-origin isolation).
// Production hosting must send the same two headers.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

// Local stand-in for the `pick-moments` Supabase Edge Function, used in demo mode (no Supabase keys).
// The Gemini key is read from .env.local without the VITE_ prefix, so it never reaches the browser.
function momentsApi(env: Record<string, string>): Plugin {
  const handler: Connect.NextHandleFunction = async (req, res) => {
    const send = (status: number, body: unknown) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body));
    };
    if (req.method !== 'POST') return send(405, { error: 'Method not allowed' });
    try {
      if (!env.GEMINI_API_KEY) throw new MomentsError('Add GEMINI_API_KEY to .env.local and restart the dev server.', 503);
      let raw = '';
      for await (const chunk of req) raw += chunk;
      let body: unknown = null;
      try {
        body = JSON.parse(raw);
      } catch {
        // parseRequest reports the missing transcript.
      }
      const moments = await pickMoments(parseRequest(body), {
        apiKey: env.GEMINI_API_KEY,
        model: env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
      });
      send(200, { moments });
    } catch (err) {
      if (err instanceof MomentsError) return send(err.status, { error: err.message });
      console.error(err);
      send(500, { error: 'Something went wrong. Please try again.' });
    }
  };
  return {
    name: 'hookcut-moments-api',
    configureServer: (server) => void server.middlewares.use('/api/pick-moments', handler),
    configurePreviewServer: (server) => void server.middlewares.use('/api/pick-moments', handler),
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), momentsApi(loadEnv(mode, process.cwd(), ''))],
  server: { headers: isolation },
  preview: { headers: isolation },
  worker: { format: 'es' },
  // Its WebAssembly files are located relative to the package; pre-bundling breaks that.
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
}));
