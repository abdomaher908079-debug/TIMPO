// Downloads that survive a weak connection: a request that fails is tried again, and a download cut off
// part way continues from where it stopped (a Range request) instead of failing. For the speech models
// (hundreds of MB the first time), where one dropped connection used to mean starting over.

const TRIES = 5;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function retrying(input: RequestInfo | URL, init: RequestInit | undefined): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(input, init);
      // Server hiccups are worth another try; anything else (404, …) is the answer.
      if (res.status < 500 || attempt >= TRIES) return res;
    } catch (err) {
      if (attempt >= TRIES || init?.signal?.aborted) throw err;
    }
    await wait(1000 * 2 ** (attempt - 1));
  }
}

export async function steadyFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await retrying(input, init);
  const size = Number(res.headers.get('content-length'));
  // Byte offsets only line up when the file isn't compressed on the way.
  if (res.status !== 200 || !res.body || !size || res.headers.get('content-encoding') || (init?.method && init.method !== 'GET')) return res;
  let reader = res.body.getReader();
  let received = 0;
  let tries = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            if (received < size) throw new Error('The download was cut short.');
            controller.close();
            return;
          }
          received += value.byteLength;
          tries = 0;
          controller.enqueue(value);
          return;
        } catch (err) {
          if (++tries > TRIES || init?.signal?.aborted) throw err;
          await wait(1000 * 2 ** (tries - 1));
          // Continue from the last byte that arrived; a server that won't do that can't be resumed.
          const headers = new Headers(init?.headers);
          headers.set('Range', `bytes=${received}-`);
          const rest = await fetch(input, { ...init, headers }).catch(() => null);
          if (rest?.status !== 206 || !rest.body) {
            if (tries >= TRIES) throw err;
            continue;
          }
          reader = rest.body.getReader();
        }
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
}
