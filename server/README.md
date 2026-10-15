# Hookcut cloud processing server

Transcribes episodes for computers and phones too slow to do it in the browser. The browser uploads the
episode's **audio only**; the server transcribes it (faster-whisper, English) with exact word times,
**deletes the audio as soon as that's done**, and forgets the transcript an hour later. Usage is checked
against the user's plan and recorded in Supabase (`cloud_jobs`).

| Plan | Cloud processing | Model |
|---|---|---|
| Free | 1 episode a week, up to 30 min, after paid jobs | base.en |
| Pro | 3 hours a month, first in line | small.en |
| Studio | 10 hours a month, first in line | small.en |

Speed on 4 CPU cores: about 10× real time with base.en, about 2–3× with small.en (a 1-hour episode takes
about 6 or 25 minutes).

## Run it free on Oracle Cloud

1. Create an [Oracle Cloud](https://www.oracle.com/cloud/free/) account (Always Free tier).
2. Create a VM: **Ampere A1** shape, 4 OCPUs and 24 GB memory (all free), Ubuntu 24.04.
3. In the VM's subnet security list, allow incoming TCP **80** and **443**. On the VM itself:
   `sudo iptables -I INPUT -p tcp -m multiport --dports 80,443 -j ACCEPT && sudo netfilter-persistent save`
4. Point a domain at the VM's public IP (an `A` record such as `cloud.hookcut.app`).
5. On the VM, install Docker (`curl -fsSL https://get.docker.com | sh`), then:

   ```bash
   git clone <your repo> hookcut && cd hookcut/server
   cp .env.example .env   # fill it in
   docker compose up -d --build
   curl https://cloud.hookcut.app/health
   ```

6. Run `supabase/migrations/20261015000000_cloud_jobs.sql` on Supabase, and set `VITE_CLOUD_URL` on the website.

Update later with `git pull && docker compose up -d --build`.

## Run it locally

```bash
python3 -m venv venv && venv/bin/pip install -r requirements.txt   # needs ffmpeg installed
AUTH_DISABLED=1 venv/bin/uvicorn app:app --port 8787
```

Then start the website with `VITE_CLOUD_URL=http://localhost:8787 npm run dev`. With `AUTH_DISABLED=1`
there are no accounts or limits: for testing only, never on a public server.
