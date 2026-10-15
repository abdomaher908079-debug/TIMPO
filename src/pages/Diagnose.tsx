import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { callFunction, supabase } from '../lib/supabase';

// A page that checks everything the site needs in this browser, with a report people can copy and
// send us when something doesn't work.

type Result = { ok: boolean | null; detail: string };
type Check = { name: string; run: () => Promise<Result> };

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const MODEL_CONFIG = 'https://huggingface.co/onnx-community/whisper-base.en_timestamped/resolve/main/config.json';

const pass = (detail: string): Result => ({ ok: true, detail });
const fail = (detail: string): Result => ({ ok: false, detail });
const info = (detail: string): Result => ({ ok: null, detail });
const message = (err: unknown) => (err instanceof Error ? `${err.name}: ${err.message}` : String(err));

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${what} took over ${ms / 1000}s`)), ms))]);
}

async function codec(kind: 'audio' | 'video' | 'encode', config: Record<string, unknown>): Promise<boolean> {
  try {
    const api = kind === 'audio' ? globalThis.AudioDecoder : kind === 'video' ? globalThis.VideoDecoder : globalThis.VideoEncoder;
    if (!api) return false;
    // The three APIs take different config types; the shapes used below are valid for each.
    return !!(await (api as unknown as { isConfigSupported(c: unknown): Promise<{ supported?: boolean }> }).isConfigSupported(config)).supported;
  } catch {
    return false;
  }
}

function checks(signedIn: boolean): Check[] {
  return [
    {
      name: 'Browser',
      run: async () => {
        const nav = navigator as Navigator & { deviceMemory?: number; brave?: unknown };
        const memory = nav.deviceMemory ? ` · ${nav.deviceMemory} GB memory` : '';
        return info(`${nav.brave ? 'Brave · ' : ''}${navigator.userAgent} · ${navigator.hardwareConcurrency || '?'} cores${memory}`);
      },
    },
    { name: 'Site version', run: async () => info(__APP_VERSION__) },
    {
      name: 'Fast mode (cross-origin isolation)',
      run: async () =>
        crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined'
          ? pass('On: speech recognition can use every processor core')
          : fail('Off: speech recognition will be slower'),
    },
    {
      name: 'Reading videos',
      run: async () => {
        const aac = await codec('audio', { codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2 });
        const opus = await codec('audio', { codec: 'opus', sampleRate: 48000, numberOfChannels: 2 });
        const h264 = await codec('video', { codec: 'avc1.42E01E' });
        const detail = `AAC audio ${aac ? 'yes' : 'no'} · Opus audio ${opus ? 'yes' : 'no'} · H.264 video ${h264 ? 'yes' : 'no'}`;
        if (!globalThis.AudioDecoder) return fail('This browser has no WebCodecs. Use the latest Chrome or Edge.');
        return aac || opus ? pass(detail) : fail(detail);
      },
    },
    {
      name: 'Making clips',
      run: async () => {
        const h264 = await codec('encode', { codec: 'avc1.42001f', width: 1080, height: 1920, bitrate: 6_000_000, framerate: 30 });
        return h264 ? pass('H.264 video encoding available') : fail('This browser can’t create H.264 video. Use the latest Chrome or Edge.');
      },
    },
    {
      name: 'Graphics chip (WebGPU)',
      run: async () => {
        const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
        if (!gpu) return info('Not available: speech recognition runs on the processor');
        try {
          return (await gpu.requestAdapter()) ? pass('Available') : info('No graphics adapter: runs on the processor');
        } catch (err) {
          return info(`Not usable (${message(err)}): runs on the processor`);
        }
      },
    },
    {
      name: 'Speech engine starts',
      run: () =>
        withTimeout(
          new Promise<Result>((resolve) => {
            const worker = new Worker(new URL('../lib/speech.worker.ts', import.meta.url), { type: 'module' });
            worker.onmessage = (e: MessageEvent<{ type: string; stage?: string; message?: string }>) => {
              worker.terminate();
              resolve(e.data.type === 'error' ? fail(e.data.message ?? 'Error') : pass('Started'));
            };
            worker.onerror = (e) => {
              worker.terminate();
              resolve(fail(`Blocked or failed to load${e.message ? `: ${e.message}` : ''}`));
            };
          }),
          15_000,
          'Starting',
        ),
    },
    {
      name: 'Speech runtime download',
      run: async () => {
        if (!__SPEECH_RUNTIME_GZ__) return info(`Uses ${__SPEECH_RUNTIME_URL__}`);
        const res = await withTimeout(fetch(__SPEECH_RUNTIME_GZ__, { method: 'HEAD' }), 15_000, 'Download check');
        const size = Number(res.headers.get('content-length')) || 0;
        return res.ok ? pass(`Reachable${size ? ` · ${(size / 1e6).toFixed(1)} MB` : ''}`) : fail(`HTTP ${res.status}`);
      },
    },
    {
      name: 'Speech model download (Hugging Face)',
      run: async () => {
        const res = await withTimeout(fetch(MODEL_CONFIG), 15_000, 'Download check');
        return res.ok ? pass('Reachable') : fail(`HTTP ${res.status}`);
      },
    },
    {
      name: 'Storage space',
      run: async () => {
        const est = await navigator.storage?.estimate?.();
        if (!est?.quota) return info('Unknown');
        const free = (est.quota - (est.usage ?? 0)) / 1e9;
        return free > 0.5 ? pass(`${free.toFixed(1)} GB free for the speech model`) : fail(`Only ${free.toFixed(2)} GB free: the speech model needs about 0.2 GB`);
      },
    },
    {
      name: 'Accounts server',
      run: async () => {
        if (!supabase || !SUPABASE_URL || !SUPABASE_KEY) return info('Demo mode: no accounts server');
        const res = await withTimeout(fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_KEY } }), 15_000, 'Check');
        if (!res.ok) return fail(`HTTP ${res.status}`);
        const settings = (await res.json()) as { external?: { google?: boolean; email?: boolean } };
        return pass(`Reachable · email sign-in ${settings.external?.email ? 'on' : 'off'} · Google sign-in ${settings.external?.google ? 'on' : 'off'}`);
      },
    },
    {
      name: 'AI server',
      run: async () => {
        if (!supabase) return info('Demo mode: uses the local AI server');
        if (!signedIn) return info('Log in to check');
        try {
          // An empty request: checks the server answers and accepts this login, without using an episode.
          await withTimeout(callFunction('pick-moments', {}), 20_000, 'Check');
          return pass('Reachable');
        } catch (err) {
          const status = (err as { status?: number }).status;
          return status === 400 ? pass('Reachable, login accepted') : fail(message(err));
        }
      },
    },
  ];
}

export default function Diagnose() {
  const { user, loading } = useAuth();
  const [results, setResults] = useState<(Result | undefined)[]>([]);
  const [copied, setCopied] = useState(false);
  const list = checks(!!user);

  useEffect(() => {
    if (loading) return;
    let live = true;
    setResults([]);
    list.forEach((check, i) => {
      check
        .run()
        .catch((err: unknown) => fail(message(err)))
        .then((r) => live && setResults((prev) => Object.assign([...prev], { [i]: r })));
    });
    return () => {
      live = false;
    };
    // Runs once the login is known; `list` is rebuilt every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, !!user]);

  const report = [
    `Hookcut check · ${new Date().toISOString()}`,
    `Signed in: ${user ? 'yes' : 'no'}`,
    ...list.map((c, i) => {
      const r = results[i];
      return `${r ? (r.ok === true ? '✓' : r.ok === false ? '✗' : '·') : '…'} ${c.name}: ${r?.detail ?? 'checking'}`;
    }),
  ].join('\n');

  async function copy() {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: the report is on screen to select by hand.
    }
  }

  return (
    <main className="legal">
      <h1 className="page-title">Check my browser</h1>
      <p className="muted">
        This checks everything Hookcut needs on this device. If something doesn’t work, copy the report and send it to us.
      </p>
      <ul className="diagnose">
        {list.map((c, i) => {
          const r = results[i];
          return (
            <li key={c.name} className={r ? (r.ok === true ? 'ok' : r.ok === false ? 'bad' : 'info') : 'pending'}>
              <span aria-hidden="true">{r ? (r.ok === true ? '✓' : r.ok === false ? '✗' : '·') : '…'}</span>
              <div>
                <strong>{c.name}</strong>
                <div className="muted small">{r?.detail ?? 'Checking…'}</div>
              </div>
            </li>
          );
        })}
      </ul>
      <button className="btn btn-primary" onClick={() => void copy()}>
        {copied ? 'Copied' : 'Copy report'}
      </button>
      <pre className="diagnose-report">{report}</pre>
    </main>
  );
}
