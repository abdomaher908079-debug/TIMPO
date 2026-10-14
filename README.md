# FixMyCode

Snap a photo of a washer, dryer or dishwasher error code and get the cause, the fix, and the exact replacement part.

## Run it locally

```bash
npm install
npm run dev        # http://localhost:5173
```

Without Supabase keys the site runs in **demo mode**: logins are fake and only stored in your browser.

## Connect Supabase (real accounts)

1. Create a free project at https://supabase.com.
2. Copy `.env.example` to `.env.local` and fill in the values from **Project Settings → API**:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
3. In **Authentication → URL Configuration**, set the Site URL (e.g. `http://localhost:5173`) and add
   `http://localhost:5173/diagnose` to the Redirect URLs.
4. For "Continue with Google", enable the Google provider under **Authentication → Providers**
   (it needs a Google Cloud OAuth client ID and secret).

## Connect the AI

The diagnosis runs on the server (`server/diagnose.ts`), locally through `npm run dev` and on Vercel
through `api/diagnose.ts`. Add one key to `.env.local`:

- `GEMINI_API_KEY`: free tier, get one at https://aistudio.google.com/apikey
- `ANTHROPIC_API_KEY`: paid, for later, at https://console.anthropic.com

With no key the site returns fixed **sample answers**, clearly labeled, so everything else can be tested.
If both keys are set, Gemini is used; set `AI_PROVIDER=claude` to switch.

## Status

- [x] Part 1: design
- [x] Part 2: home, sign up / log in, upload screen
- [x] Part 3: AI diagnosis (Gemini free tier, Claude ready, sample mode)
- [ ] Part 4: results page
- [ ] Part 5: error-code pages for Google
- [ ] Part 6: usage limits and abuse protection
- [ ] Part 7: launch
