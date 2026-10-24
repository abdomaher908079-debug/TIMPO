/// <reference lib="webworker" />
// Starts the speech engine (speech.engine.ts). Kept tiny and separate so that if the engine itself
// fails to load, we still learn why instead of the worker ending with no message.
import type { WorkerRequest, WorkerResponse } from './speech';

declare const self: DedicatedWorkerGlobalScope;
const post = (msg: WorkerResponse) => self.postMessage(msg);

// Errors outside a request (e.g. inside the speech runtime's own threads).
self.addEventListener('error', (e) => post({ type: 'error', message: `Uncaught: ${e.message || 'unknown error'}` }));
self.addEventListener('unhandledrejection', (e) =>
  post({ type: 'error', message: `Uncaught: ${e.reason instanceof Error ? e.reason.message : String(e.reason)}` }),
);

// Requests that arrive while the engine is loading.
const queue: MessageEvent<WorkerRequest>[] = [];
self.onmessage = (e: MessageEvent<WorkerRequest>) => queue.push(e);

post({ type: 'stage', stage: 'starting the speech engine' });
import('./speech.engine').then(
  ({ handle }) => {
    self.onmessage = handle;
    for (const e of queue.splice(0)) void handle(e);
  },
  (err: unknown) => post({ type: 'error', message: `The speech engine didn't load: ${err instanceof Error ? err.message : String(err)}` }),
);
