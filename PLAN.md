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
- **Backup server:** optional cloud processing for weak computers and phones (Oracle Cloud Always Free,
  4 ARM cores). Uploads the episode's **audio only** (about 15 MB an hour, never the video), transcribes it with
  exact word times, deletes the audio right after, forgets the transcript within an hour. Suggested automatically
  on phones and computers without a graphics card. Picking moments and making clips still happen as usual.
- **Hosting:** Netlify free plan (commercial use allowed; Cloudflare Pages caps files at 25 MB and our speech
  runtime is 27 MB; Vercel's free plan forbids commercial use).
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
- **Limits:** enforced on the server when the AI picks moments (the only step that costs us). Free resets
  Mondays (UTC); paid plans with their billing month. Retrying the same episode in a period is free.
- **Hours:** Pro 20 h, Studio 60 h. Episode hours cost us almost nothing (speech and rendering run on the user's
  computer; Gemini is about a cent per episode), so they're generous: a weekly 3-hour show fits Pro with room. The
  costly part, cloud processing, keeps its own smaller caps.
- **AI quality:** Free gets Quick AI (Whisper base + Gemini Flash-Lite, all free). Pro and Studio get the same
  Best AI (Whisper small, ~3× slower so only with a graphics card, + Gemini's top model on a paid key). The site
  tells Free users plainly that Pro's AI is better. Gemini steps down Pro → Flash → Flash-Lite when a model is
  overloaded or out of quota, so users get clips instead of an error.
- **What to pay for first, once subscriptions come in:**
  1. Gemini paid key (`GEMINI_PAID_API_KEY`) → Best AI picks for Pro/Studio. About $0.01–0.05 per episode.
  2. Cloud processing server (Part 7) for paid users without a graphics card, so they get the larger speech model too.
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
