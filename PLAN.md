# Hookcut

Turn a long podcast episode into ready-to-post vertical clips for TikTok, Reels and Shorts.

## Decisions
- **Name:** Hookcut (was the working name PeakClip; renamed because a near-identical product called Peakcut exists).
  Logo: audio-meter bars with the tallest in orange, the moment we cut out. Check the domain and handles before launch.
- **Audience:** podcasters with long episodes (1–3 h). Competitors are weak there (editor, long videos, billing).
- **How it works:** the video stays on the user's computer. The browser decodes the audio to 16 kHz
  mono, transcribes it with Whisper (in the browser, free), and sends only the transcript text to
  Gemini's free tier to pick the best moments. The browser then renders the clips.
- **Money:** free services while we build; spend on ads, not services. Improve services once
  subscriptions pay for them.
  Users just "upload a video"; the mechanism is explained in About.
- **Cloud listening:** for phones (by default) and computers without a graphics card. The episode's **audio only**
  (about 15 MB an hour, never the video) goes in 5-minute pieces through a Supabase Edge Function to Gemini, which
  writes it down with timestamps; nothing is stored. No server of our own. Captions' word timing, picking moments
  and making clips still happen as usual.
- **Hosting:** Cloudflare Pages, free (unlimited traffic, commercial use allowed). Its 25 MB file limit is below
  the speech runtime's 27 MB file, so that one file lives in Cloudflare R2 (free, your own account) once the domain
  exists, and on the jsDelivr CDN until then. Vercel's free plan forbids commercial use.
- **Legal pages:** Privacy, Terms, Refunds (14 days, Paddle needs them). Plain-language templates; get them checked.
- **Language:** English only (English Whisper model, no language picker).
- **Speech recognition:** Whisper base.en (~80 MB, downloaded once and cached by the browser), on the
  graphics card (WebGPU) when available, otherwise the processor. Segment timestamps for the whole
  episode; word timestamps for captions will be computed later only for the chosen clips.
- **Editor:** trim (handles, ±0.5 s, or start/end at a transcript line), left↔right framing of the 9:16
  crop, 3 caption styles, title. Captions in the preview use estimated word times; export uses exact ones.
  Edits live in the open tab until saved projects exist (the page warns before closing).
- **Export:** made on the user's computer (free for us): 1080×1920, MP4 (H.264 + AAC) where the browser can
  encode it (Chrome, Edge, Safari), otherwise WebM. Captions burned in with exact word times (Whisper timestamps
  only the clip being exported). Free: 3 clips, watermark top-left (clear of platform buttons and captions).
  Pro clips on Free can be watched and edited but not exported. 4K export comes with paid plans (Part 6).
- **Payments:** Paddle (merchant of record: handles worldwide sales tax/VAT, 5% + 50¢, no monthly fee, sellers
  from most countries). Lemon Squeezy is being folded into Stripe; Stripe doesn't take sellers from many countries.
- **Limits:** enforced on the server, before anything that costs us money, in one locked database step per
  workspace (`reserve_pick`, `reserve_cloud`), so requests sent at once can't slip past; given back when the AI
  fails. Free resets Mondays (UTC); paid plans every month from the subscription's start day (yearly plans too).
  - **Picks:** Pro 20 h / 40 episodes, Studio 40 h / 100 episodes a month. Each AI request costs about the same
    whatever the episode's length, so the episode count caps the worst case. The same episode can be re-picked 3
    times a month for free (4 picks in all); a longer transcript than before counts the extra time. An episode counts
    as the longest of its file length, its last word, and its transcript at 40 characters a second.
  - **Cloud listening:** counted per piece of audio actually heard, reserved just before it's sent to Gemini,
    given back if Gemini fails. Listening again costs again. Each piece's real length is checked first with
    Gemini's free token counter (32 tokens a second), so a piece can't hold more audio than it's counted as.
  - **Costs:** every AI request's model and tokens are logged in `ai_calls`, to see each plan's real cost.
  - **Worst case per month** (every limit used, top prices): Pro about $8.50 cost on $15, Studio about $19 on $29;
    yearly plans keep a profit too. Once real `ai_calls` numbers are in, set a ceiling on the AI's output at twice
    the largest real request, so no normal request is ever cut.
- **Hours:** Pro 20 h, Studio 40 h (10 h a week, shared by a team of 3): enough for 4–5 weekly shows.
- **Storage (Supabase free plan: 500 MB):** videos and exported clips never leave the user's device; cloud audio
  is deleted as soon as it's heard. Saved episodes (transcript + edits, ~100 KB per hour of episode) go 1 day
  after their last change on Free, 30 days on paid plans (and 30 days after a paid plan ends); listening jobs
  after 8 days; usage records after 3 months; AI cost rows after 90 days, kept as monthly totals in
  `ai_costs_monthly`; expired hour packs after 90 days. At about 1,000 paid users the 30-day library is about
  1 GB: move to Supabase Pro (8 GB included, $25 a month) before that.
- **Hour packs:** +17.5 h and +35 episodes for $14 (just above the crypto minimum, same rate as the old $8 for 10 h), one time, Pro and Studio owners, usable for 90 days after the
  month's own hours or episodes run out (`hour_packs`, drawn by `reserve_pick`, given back if the AI fails, emptied
  by a refund). About $0.80 an hour, a little above the plans, so heavy users are nudged to upgrade.
- **Extra Studio seats:** $8 a month / $50 a year per person beyond 3, up to 10, as a second item on the Studio
  subscription (`team-seats` function, prorated now). Seats share the plan's hours, so they cost us almost nothing.
- **Yearly first:** the pricing page opens on yearly ("2 months free").
- **Normal-month money** (1,000 Pro, 300 Studio, 13,000 Free, 25% use, 70% monthly): about $16,650 profit on
  $22,350 of prices (75%) after tax, Paddle, refunds, AI and hosting.
- **AI quality:** Free gets Quick AI (Whisper base + Gemini Flash-Lite, all free). Pro and Studio get the same
  Best AI (Whisper small, ~3× slower so only with a graphics card, + Gemini's top model on a paid key). The site
  tells Free users plainly that Pro's AI is better. Gemini steps down Pro → Flash → Flash-Lite when a model is
  overloaded or out of quota, so users get clips instead of an error.
- **What to pay for first, once subscriptions come in:**
  1. Gemini paid key (`GEMINI_PAID_API_KEY`): Pro/Studio use it (Best AI, data not used by Google, no limits);
     Free stays on the free-tier key and only falls back to the paid key when the free tier is busy. Measured
     (Oct 2026, Flash-Lite, compact transcript, minimal thinking): about 92k tokens in and 18k out per hour of
     cloud listening, roughly $0.07 per hour; picking moments about $0.02 per hour with Flash-Lite. Tokens per
     piece are recorded in `listen_pieces.usage`.
  2. The paid Gemini key also keeps paid users' cloud-listening audio out of Google's product improvement.
  3. Later: a paid transcription API for paid users if in-browser Whisper isn't good enough.
- **Brand kits:** a show's caption font (8 free Google Fonts), style, colors, position and logo, used in the preview
  and the export. Pro 1, Studio 5. Logos are resized in the browser and stored with the kit (no file storage).
- **Studio teams:** 3 people (owner + 2 invited by email). Members work in the owner's "workspace": its plan, hours,
  brand kits, cloud time and Best AI; no billing of their own. No email service yet: the owner copies an invite
  message; the person signs up with that email and clicks Join. If the owner's Studio ends, members fall back to
  their own plan. Limits and access are enforced in the database (tested on Postgres).
- **Skipped:** pasting YouTube links (against YouTube's Terms of Service).
- **Design:** direction A. Dark background, orange actions, phosphor green for waveform, scores and captions.

## Plans
|                     | Free            | Pro $15/mo ($12/mo yearly) | Studio $29/mo ($24/mo yearly) |
|---------------------|-----------------|----------------------------|-------------------------------|
| Episode hours       | **1 episode per week, up to 30 min** (4/month) | 20 per month               | 60 per month                  |
| AI quality          | Quick AI        | Best AI                    | Best AI                       |
| Longest episode     | 30 minutes      | Any                        | Any                           |
| Clips per episode   | 10 found, **3 exportable** (7 shown locked) | 20 | 30                  |
| Export              | 1080p           | 1080p / 4K                 | 1080p / 4K                    |
| Watermark           | Yes             | No                         | No                            |
| Caption styles      | 3 basic         | All + own brand            | All + multiple brands         |
| Server processing   | Queue, 1/week   | Priority, 3 h/month        | Priority, 10 h/month          |
| Team members        | 1               | 1                          | 3                             |

Free shows all the clips it finds but locks 7 of 10, so users see what they'd get by upgrading.
A free user costs us about $0 (transcription runs in their browser; Gemini free tier).

Free = what costs us nothing (editor, saved projects, local export). Paid = what costs us money
(transcription hours, server) and what professionals need (no watermark, brand styles).

## Build parts
1. Design, plans, prices: done
2. Home, pricing, sign up, "New episode" screen: done
3. Audio → transcript → AI picks moments: done
4. Clips screen and editor: done
5. Export: clip files, captions, watermark: done
6. Accounts and limits: hours used, plans, payments: done
7. Backup server and launch: done (see LAUNCH.md for the go-live steps)
