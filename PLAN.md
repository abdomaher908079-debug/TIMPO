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
- **Backup server (later):** optional server processing for weak computers and phones
  (Oracle Cloud Always Free to start). Videos deleted right after processing.
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
- **Skipped:** pasting YouTube links (against YouTube's Terms of Service).
- **Design:** direction A. Dark background, orange actions, phosphor green for waveform, scores and captions.

## Plans
|                     | Free            | Pro $15/mo ($12/mo yearly) | Studio $29/mo ($24/mo yearly) |
|---------------------|-----------------|----------------------------|-------------------------------|
| Episode hours       | **1 episode per week, up to 30 min** (4/month) | 10 per month               | 20 per month                  |
| Longest episode     | 30 minutes      | Any                        | Any                           |
| Clips per episode   | 10 found, **3 exportable** (7 shown locked) | 20 | 30                  |
| Export              | 1080p           | 1080p / 4K                 | 1080p / 4K                    |
| Watermark           | Yes             | No                         | No                            |
| Caption styles      | 3 basic         | All + own brand            | All + multiple brands         |
| Server processing   | Queue, 1/week   | Priority, 3 h/month        | Priority, 10 h/month          |
| Team members        | 1               | 1                          | 3                             |

Free shows all the clips it finds but locks 7 of 10, so users see what they'd get by upgrading.
A free user costs about $0.30–0.60/month in transcription at full use (4 × 30 min).

Free = what costs us nothing (editor, saved projects, local export). Paid = what costs us money
(transcription hours, server) and what professionals need (no watermark, brand styles).

## Build parts
1. Design, plans, prices: done
2. Home, pricing, sign up, "New episode" screen: done
3. Audio → transcript → AI picks moments: done
4. Clips screen and editor: done
5. Export: clip files, captions, watermark: done
6. Accounts and limits: hours used, plans, payments
7. Backup server and launch
