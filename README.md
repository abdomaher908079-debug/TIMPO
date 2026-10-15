# Hookcut

Turn a long podcast episode into ready-to-post vertical clips. See [PLAN.md](PLAN.md) for the product
decisions, plans and build parts.

## Run it locally

```bash
npm install
npm run dev        # http://localhost:5173
```

Without Supabase keys the site runs in **demo mode**: logins, plans and usage are faked in your browser, and the
pricing buttons switch plans for free so you can try what each plan unlocks.

## Connect Supabase (real accounts)

1. Create a free project at https://supabase.com.
2. Copy `.env.example` to `.env.local` and fill in the values from **Project Settings → API**.
3. In **Authentication → URL Configuration**, set the Site URL (e.g. `http://localhost:5173`) and add
   `http://localhost:5173/new` to the Redirect URLs.
4. For "Continue with Google", enable the Google provider under **Authentication → Providers**.

## Accounts, limits and payments

- **Database:** run the files in `supabase/migrations/` in order (`supabase db push`, or paste them in the SQL
  editor). They add `profiles` (plan and subscription), `episodes` and `cloud_jobs` (usage), `team_members`
  (Studio teams) and `brand_kits`. Users can read only their own rows;
  only the server writes them.
- **Limits** live in `supabase/functions/_shared/plans.ts`, shared by the site (to show them) and the
  `pick-moments` function (to enforce them). An episode counts once it gets its clips; retrying the same file in the
  same period is free. Free resets every Monday (UTC); paid plans reset with their billing month.
- **Payments** use [Paddle](https://www.paddle.com) as merchant of record: it charges customers and handles sales tax
  and VAT worldwide (5% + 50¢ per sale, no monthly fee).

### Set up Paddle

1. Create a Paddle account (start with a [sandbox](https://sandbox-vendors.paddle.com) account for testing) and
   check your country is supported for payouts.
2. **Catalog → Products:** create Pro and Studio, each with a monthly and a yearly price
   ($15 / $144 and $29 / $288). Put the four price IDs in `.env.local` (see `.env.example`) and as Supabase secrets.
3. **Developer tools → Authentication:** create a client-side token (`VITE_PADDLE_CLIENT_TOKEN`) and an API key.
4. **Checkout → Checkout settings:** set the default payment link to `https://your-site/checkout.html`, and add your
   domain under approved domains.
5. **Developer tools → Notifications:** add a destination
   `https://<project>.supabase.co/functions/v1/paddle-webhook` for the `subscription.*` events, and copy its secret.
6. Set the server secrets and deploy:

   ```bash
   supabase secrets set PADDLE_ENV=sandbox PADDLE_API_KEY=... PADDLE_WEBHOOK_SECRET=... \
     PADDLE_PRICE_PRO_MONTHLY=pri_... PADDLE_PRICE_PRO_YEARLY=pri_... \
     PADDLE_PRICE_STUDIO_MONTHLY=pri_... PADDLE_PRICE_STUDIO_YEARLY=pri_...
   supabase functions deploy pick-moments
   supabase functions deploy billing-portal
   supabase functions deploy paddle-webhook --no-verify-jwt
   ```

Subscribers manage their card, invoices, plan and cancellation in Paddle's portal ("Manage billing" on the Account
page). A canceled plan stays active until the end of the paid period.

## Finding the best moments

1. **Speech recognition** runs in the browser with Whisper (`src/lib/speech.worker.ts`, via
   Transformers.js). The model (~80 MB) downloads once and is cached by the browser. It uses the graphics
   card (WebGPU) when it can, otherwise the processor.
2. **Picking moments**: only the transcript text is sent to Gemini, which returns the best 15–90 s
   moments by transcript line, so clip times are exact. The prompt and checks live in
   `supabase/functions/_shared/moments.ts`.

Free plans get **Quick AI** (Whisper base, Gemini Flash-Lite); Pro and Studio get **Best AI** (Whisper small on
a graphics card, and Gemini's top model when `GEMINI_PAID_API_KEY`, a key from a project with billing on, is set).
If a model is overloaded or out of quota, it steps down to the next one instead of failing.

The Gemini keys stay on a server:
- **Locally (demo mode):** put `GEMINI_API_KEY` in `.env.local`; the dev server answers `/api/pick-moments`.
- **With Supabase:** deploy the Edge Function (only signed-in users can call it):

  ```bash
  supabase secrets set GEMINI_API_KEY=your-key
  supabase functions deploy pick-moments
  ```

**Hosting:** the site must be served with `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp` (the dev server already does) so speech recognition can use
every processor core, **except** `/checkout.html`, where Paddle's checkout frame can't load under them.
`public/_headers` does this on Cloudflare Pages. The speech runtime's 27 MB file is over Pages' 25 MB limit, so the
build ships it gzipped (about 7 MB, `dist/speech-runtime/`) and the speech worker unpacks it; set
`VITE_SPEECH_RUNTIME_URL` to load an uncompressed copy from elsewhere (e.g. Cloudflare R2) instead.
Every `/assets/*` file must also get the two headers above, or the browser won't start the speech worker.
If something doesn't work on a device, open `/diagnose` there (“Check my browser” in the footer).

## Exporting clips

Clips are rendered on the user's computer (`src/lib/render.ts`): trimmed, cropped to 9:16 with the clip's framing,
scaled to 1080×1920, with captions and, on Free, the watermark drawn in (`src/lib/draw.ts`). Captions use exact word
times from Whisper, computed only for the clip being exported. Browsers that can encode H.264 (Chrome, Edge, Safari)
produce MP4; others produce WebM.

## Cloud listening

Phones (by default) and computers without a graphics card can listen in the cloud: the browser cuts the episode's
audio (never the video) into 5-minute pieces and sends them to the `transcribe` Edge Function, which has Gemini write
each one down with timestamps and keeps nothing. Captions' word timing still runs on the device, clip by clip, at
export. Usage is checked against the plan and recorded in `cloud_jobs`. Needs only Supabase and `GEMINI_API_KEY`:
`supabase functions deploy transcribe`.

## Going live

See [LAUNCH.md](LAUNCH.md): domain, Supabase, Gemini, Paddle, Cloudflare hosting and the cloud server, step by step.

## Video in the browser

Episodes are read with [Mediabunny](https://mediabunny.dev) (WebCodecs), which reads only what it needs,
so multi-GB files open instantly and never upload. See `experiments/clip-spike` for the feasibility test.
