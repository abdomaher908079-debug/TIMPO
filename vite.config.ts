import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { defineConfig, loadEnv, type Connect, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { geminiFor, MomentsError, parseRequest, pickMoments } from './supabase/functions/_shared/moments';

// Lets speech recognition use all CPU cores (SharedArrayBuffer needs cross-origin isolation).
// Production hosting must send the same two headers, except on /checkout.html: Paddle's checkout
// frame can't load in an isolated page.
const isolation: Plugin = {
  name: 'hookcut-isolation',
  configureServer: (server) => void server.middlewares.use(isolate),
  configurePreviewServer: (server) => void server.middlewares.use(isolate),
};
function isolate(req: Connect.IncomingMessage, res: import('node:http').ServerResponse, next: Connect.NextFunction) {
  if (!req.url?.startsWith('/checkout')) {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  }
  next();
}

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
      let raw = '';
      for await (const chunk of req) raw += chunk;
      let body: unknown = null;
      try {
        body = JSON.parse(raw);
      } catch {
        // parseRequest reports the missing transcript.
      }
      // Demo mode has no accounts, so the page says which plan's AI to use.
      const quality = (body as { quality?: string } | null)?.quality === 'best' ? 'best' : 'quick';
      const gemini = geminiFor(quality, (name) => env[name]);
      if (!gemini) throw new MomentsError('Add GEMINI_API_KEY to .env.local and restart the dev server.', 503);
      const { moments } = await pickMoments(parseRequest(body), gemini);
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

const ORT_VERSION = JSON.parse(readFileSync('node_modules/onnxruntime-web/package.json', 'utf8')).version as string;
const ORT_WASM = 'ort-wasm-simd-threaded.asyncify.wasm';

// The speech runtime's 27 MB WebAssembly file is over Cloudflare Pages' 25 MB limit, so the site carries it
// gzipped (about 7 MB) and the speech worker unpacks it. VITE_SPEECH_RUNTIME_URL can point at your own
// uncompressed copy instead (e.g. in Cloudflare R2). See LAUNCH.md.
const SPEECH_RUNTIME_GZ = `/speech-runtime/ort-${ORT_VERSION}.wasm.gz`;

function speechRuntimeUrl(env: Record<string, string>) {
  return env.VITE_SPEECH_RUNTIME_URL || `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/${ORT_WASM}`;
}

function speechRuntimeGz(): Plugin {
  return {
    name: 'hookcut-speech-runtime-gz',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: SPEECH_RUNTIME_GZ.slice(1),
        source: gzipSync(readFileSync(`node_modules/onnxruntime-web/dist/${ORT_WASM}`), { level: 9 }),
      });
    },
  };
}

// The runtime also has a built-in fallback pointing at that file, which would make the build copy it
// into the site. Point the fallback at the same address instead.
function ortWasmElsewhere(url: string): Plugin {
  const fallback = `new URL("${ORT_WASM}",import.meta.url)`;
  return {
    name: 'hookcut-ort-wasm-elsewhere',
    enforce: 'pre',
    apply: 'build',
    transform(code, id) {
      if (!id.includes('onnxruntime-web') || !code.includes(fallback)) return null;
      return code.split(fallback).join(`new URL(${JSON.stringify(url)})`);
    },
  };
}

function appVersion() {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const runtimeUrl = speechRuntimeUrl(env);
  const ownCopy = !env.VITE_SPEECH_RUNTIME_URL;
  return {
    plugins: [react(), isolation, momentsApi(env), ...(ownCopy ? [speechRuntimeGz()] : [])],
    worker: { format: 'es', plugins: () => [ortWasmElsewhere(runtimeUrl)] },
    define: {
      __SPEECH_RUNTIME_URL__: JSON.stringify(runtimeUrl),
      __SPEECH_RUNTIME_GZ__: JSON.stringify(ownCopy ? SPEECH_RUNTIME_GZ : ''),
      __APP_VERSION__: JSON.stringify(appVersion()),
    },
    build: { rollupOptions: { input: { main: 'index.html', checkout: 'checkout.html' } } },
    // Its WebAssembly files are located relative to the package; pre-bundling breaks that.
    optimizeDeps: { exclude: ['@huggingface/transformers'] },
  };
});
