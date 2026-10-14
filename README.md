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

## Video in the browser

Episodes are read with [Mediabunny](https://mediabunny.dev) (WebCodecs), which reads only what it needs,
so multi-GB files open instantly and never upload. See `experiments/clip-spike` for the feasibility test.
