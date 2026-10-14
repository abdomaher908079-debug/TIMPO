# PeakClip (working name)

Turn a long podcast episode into ready-to-post vertical clips. See [PLAN.md](PLAN.md) for the product
decisions, plans and build parts.

## Run it locally

```bash
npm install
npm run dev        # http://localhost:5173
```

Without Supabase keys the site runs in **demo mode**: logins are fake and only stored in your browser.

## Connect Supabase (real accounts)

1. Create a free project at https://supabase.com.
2. Copy `.env.example` to `.env.local` and fill in the values from **Project Settings → API**.
3. In **Authentication → URL Configuration**, set the Site URL (e.g. `http://localhost:5173`) and add
   `http://localhost:5173/new` to the Redirect URLs.
4. For "Continue with Google", enable the Google provider under **Authentication → Providers**.

## Finding the best moments

1. **Speech recognition** runs in the browser with Whisper (`src/lib/speech.worker.ts`, via
   Transformers.js). The model (~80 MB) downloads once and is cached by the browser. It uses the graphics
   card (WebGPU) when it can, otherwise the processor.
2. **Picking moments**: only the transcript text is sent to Gemini, which returns the best 15–90 s
   moments by transcript line, so clip times are exact. The prompt and checks live in
   `supabase/functions/_shared/moments.ts`.

The Gemini key stays on a server:
- **Locally (demo mode):** put `GEMINI_API_KEY` in `.env.local`; the dev server answers `/api/pick-moments`.
- **With Supabase:** deploy the Edge Function (only signed-in users can call it):

  ```bash
  supabase secrets set GEMINI_API_KEY=your-key
  supabase functions deploy pick-moments
  ```

**Hosting:** the site must be served with `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp` (the dev server already does) so speech recognition can use
every processor core. The speech runtime is served from our own site (a ~27 MB `.wasm` file in
`dist/assets`); some hosts cap file size at 25 MB.

## Video in the browser

Episodes are read with [Mediabunny](https://mediabunny.dev) (WebCodecs), which reads only what it needs,
so multi-GB files open instantly and never upload. See `experiments/clip-spike` for the feasibility test.
