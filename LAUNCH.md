# Launch checklist

Everything Hookcut needs to go live, in order. Free to run until paying users arrive; see "Money" in PLAN.md.

## 1. Name and domain
- [ ] Check the domain (`hookcut.com`, `hookcut.app` or `gethookcut.com`), TikTok and Instagram handles, and do a
      quick trademark search for "Hookcut" (software / video).
- [ ] Buy the domain (Namecheap, Porkbun or Cloudflare Registrar, about $10–15 a year).
- [ ] Set up a support email address on it (e.g. `support@…`; Zoho Mail or Cloudflare Email Routing are free).

## 2. Supabase (accounts and usage)
- [x] Create a project at supabase.com (free).
- [x] Run the files in `supabase/migrations/` in order (SQL editor, or `supabase db push`).
- [ ] Authentication → URL Configuration: Site URL = your domain; add `https://<domain>/new` and
      `https://<domain>/account` to Redirect URLs.
- [x] Authentication → Providers → Google: turn on "Continue with Google" (needs a Google Cloud OAuth client).
- [ ] Deploy the functions and secrets (README → "Set up Paddle", step 6), including `GEMINI_API_KEY`.

## 3. Gemini
- [x] Create a free API key at https://aistudio.google.com/apikey and set it as `GEMINI_API_KEY` on Supabase.
- [ ] In AI Studio, check the key's daily request limits. Each episode is one request.
- [ ] Later, once subscriptions pay for it: a key from a Google Cloud project **with billing on**, set as
      `GEMINI_PAID_API_KEY`. Paid plans then get Gemini's top model and their transcripts stay private.
      Then update "What we send to AI" in `src/pages/Legal.tsx` to say paid plans use Google's paid service.

## 4. Paddle (payments)
- [ ] Follow README → "Set up Paddle" in the **sandbox** first.
- [ ] Buy each plan with Paddle's test card; check the Account page switches plan, and that canceling in
      Manage billing shows the end date.
- [ ] Apply for a live account: Paddle reviews your website (it needs the Pricing, Terms, Privacy and Refund
      pages, which are built in). Then repeat the setup with live keys and set `PADDLE_ENV=production`.
- [ ] Confirm Paddle pays out to your country and add your payout details.

## 5. Website (Cloudflare Pages)
- [ ] Cloudflare → Workers & Pages → Create → Pages → connect this GitHub repository.
      Build command `npm run build`, output directory `dist`.
- [ ] Settings → Environment variables: everything in `.env.example` that starts with `VITE_`.
      `VITE_LEGAL_NAME` and `VITE_SUPPORT_EMAIL` appear on the legal pages.
- [ ] Custom domains: add your domain (easiest if the domain itself is on Cloudflare).
- [ ] Check: open the site, then DevTools → Console → `crossOriginIsolated` should be `true` on /new.

### Speech runtime file (optional: Cloudflare R2)
Cloudflare Pages accepts files up to 25 MB and the speech runtime file is 27 MB, so the site ships it gzipped
(about 7 MB) and unpacks it in the browser. Nothing to set up. Only if you'd rather serve it from R2:
- [ ] Cloudflare → R2 → create a bucket (e.g. `hookcut-files`). R2's free plan includes 10 GB and no
      download fees.
- [ ] Upload `node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm` (after `npm install`).
- [ ] Bucket → Settings → Custom Domains: connect e.g. `files.<your domain>` (the `r2.dev` address is for testing
      only and is rate-limited).
- [ ] Bucket → Settings → CORS policy: allow `GET` from `https://<your domain>`.
- [ ] Set `VITE_SPEECH_RUNTIME_URL=https://files.<your domain>/ort-wasm-simd-threaded.asyncify.wasm` in the
      Pages environment variables and redeploy.
- [ ] After upgrading the speech library (`npm update`), upload the new file too.

## 6. Cloud listening (phones)
- [x] Deploy the `listen` function (`supabase functions deploy listen --no-verify-jwt`). It uses the same `GEMINI_API_KEY`.

## 7. Before announcing
- [ ] Have the Terms, Privacy and Refund pages checked (they're plain-language templates, not legal advice).
- [ ] Full test on a real computer: sign up → upload an episode → clips → export → upgrade (sandbox) →
      Pro features (4K, no watermark, Best AI on a computer with a graphics card).
- [ ] Test on a phone with cloud listening.
- [ ] Try the free plan limits: a second episode in the same week is blocked.
