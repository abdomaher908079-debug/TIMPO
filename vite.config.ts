import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const MAX_BODY_BYTES = 8 * 1024 * 1024;

// Serves /api/diagnose during `npm run dev`, using the same handler as the
// Vercel function in api/diagnose.ts.
function devApi(): Plugin {
  return {
    name: 'fixmycode-dev-api',
    configureServer(server) {
      server.middlewares.use('/api/diagnose', async (req, res) => {
        const send = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(body));
        };
        if (req.method !== 'POST') return send(405, { error: 'Method not allowed' });

        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > MAX_BODY_BYTES) return send(413, { error: 'Photos are too large.' });
          chunks.push(chunk);
        }
        let body: unknown;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          return send(400, { error: 'Invalid request.' });
        }
        const { handleDiagnose } = await server.ssrLoadModule('/server/diagnose.ts');
        const result = await handleDiagnose(body, req.headers.authorization);
        send(result.status, result.body);
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Make .env / .env.local values (API keys) visible to the server code.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''));
  return { plugins: [react(), devApi()] };
});
