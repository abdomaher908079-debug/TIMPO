# PeakClip (working name)

Turn a long podcast episode into ready-to-post vertical clips for TikTok, Reels and Shorts.

## Decisions
- **Audience:** podcasters with long episodes (1–3 h). Competitors are weak there (editor, long videos, billing).
- **How it works:** the video stays on the user's computer. The browser extracts a small audio file,
  the server transcribes it and the AI picks the best moments, then the browser renders the clips.
  Users just "upload a video"; the mechanism is explained in About.
- **Backup server (later):** optional server processing for weak computers and phones
  (Oracle Cloud Always Free to start). Videos deleted right after processing.
- **Skipped:** pasting YouTube links (against YouTube's Terms of Service).
- **Design:** direction A. Dark background, orange actions, phosphor green for waveform, scores and captions.

## Plans
|                     | Free            | Pro $15/mo ($12/mo yearly) | Studio $29/mo ($24/mo yearly) |
|---------------------|-----------------|----------------------------|-------------------------------|
| Episode hours       | 1 per **week**  | 10 per month               | 20 per month                  |
| Longest episode     | 1 hour          | Any                        | Any                           |
| Clips per episode   | 10 found, **3 exportable** (7 shown locked) | 20 | 30                  |
| Export              | 1080p           | 1080p / 4K                 | 1080p / 4K                    |
| Watermark           | Yes             | No                         | No                            |
| Caption styles      | 3 basic         | All + own brand            | All + multiple brands         |
| Server processing   | Queue, 1/week   | Priority, 3 h/month        | Priority, 10 h/month          |
| Team members        | 1               | 1                          | 3                             |

Free shows all the clips it finds but locks 7 of 10, so users see what they'd get by upgrading.
A free user costs about $1–1.60/month in transcription at full use (~4 h). Lower the weekly hour if
free usage gets too expensive.

Free = what costs us nothing (editor, saved projects, local export). Paid = what costs us money
(transcription hours, server) and what professionals need (no watermark, brand styles).

## Build parts
1. Design, plans, prices: done
2. Home, pricing, sign up, "New episode" screen
3. Audio → transcript → AI picks moments
4. Clips screen and editor
5. Export: clip files, captions, watermark
6. Accounts and limits: hours used, plans, payments
7. Backup server and launch
