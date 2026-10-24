// The speech models come from our own site (Cloudflare, next to the app) instead of Hugging Face: faster
// everywhere and no outside service in the way. Cloudflare Pages takes files up to 25 MB, so bigger model
// files are stored in numbered parts and joined here as they download (scripts/ai-models.mjs puts them in
// /ai/ when deploying). Requests keep their Hugging Face address, so the browser's cache of models already
// downloaded stays valid, and anything missing or failing on our site comes from Hugging Face as before.
import { steadyFetch } from './steadyFetch';

interface AiFile {
  size: number;
  // 0: stored whole. Otherwise stored as `<file>.000`, `<file>.001`, …
  parts: number;
}

const HF_FILE = /^https:\/\/huggingface\.co\/(onnx-community\/[^/]+)\/resolve\/main\/(.+)$/;
let manifest: Promise<Record<string, AiFile> | null> | null = null;

function hosted(): Promise<Record<string, AiFile> | null> {
  manifest ??= steadyFetch(new URL('/ai.json', self.location.origin))
    .then((res) => (res.ok ? res.json() : null))
    .then((m: { files?: Record<string, AiFile> } | null) => m?.files ?? null)
    .catch(() => null);
  return manifest;
}

async function ownCopy(path: string, file: AiFile, init?: RequestInit): Promise<Response> {
  const at = (name: string) => new URL(`/ai/${name}`, self.location.origin);
  const range = new Headers(init?.headers).get('Range');
  // The size check before a download (a 1-byte range): answered from the list of files.
  if (range === 'bytes=0-0') {
    return new Response(new Uint8Array(1), {
      status: 206,
      headers: { 'content-range': `bytes 0-0/${file.size}`, 'content-length': '1', 'content-type': 'application/octet-stream' },
    });
  }
  if (range) throw new Error('Part of a file is only served by Hugging Face.');
  const plain = { ...init, headers: undefined };
  if (!file.parts) {
    const res = await steadyFetch(at(path), plain);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  }
  const part = (i: number) => steadyFetch(at(`${path}.${String(i).padStart(3, '0')}`), plain);
  // The first part decides whether our copy is there; after that the parts stream one after another.
  const first = await part(0);
  if (!first.ok || !first.body) throw new Error(`HTTP ${first.status}`);
  let index = 0;
  let reader = first.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        const { done, value } = await reader.read();
        if (!done) return controller.enqueue(value);
        if (++index >= file.parts) return controller.close();
        const next = await part(index);
        if (!next.ok || !next.body) throw new Error(`Part ${index} of ${path}: HTTP ${next.status}`);
        reader = next.body.getReader();
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  return new Response(body, { status: 200, headers: { 'content-length': String(file.size), 'content-type': 'application/octet-stream' } });
}

/** fetch for the speech library: model files from our site when it has them, with resuming downloads. */
export async function aiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const match = HF_FILE.exec(input instanceof Request ? input.url : String(input));
  const files = match ? await hosted() : null;
  const file = match && files?.[`${match[1]}/${match[2]}`];
  if (file) {
    try {
      return await ownCopy(`${match[1]}/${match[2]}`, file, init);
    } catch (err) {
      console.warn('Model file not on our site; using Hugging Face.', err);
    }
  }
  return steadyFetch(input, init);
}
