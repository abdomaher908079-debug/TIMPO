-- Cloud listening now runs on Gemini (supabase/functions/transcribe) instead of our own server.
-- One row per episode and period, so the parts of an episode, and trying it again, count once.
alter table public.cloud_jobs add column fingerprint text;
create unique index cloud_jobs_workspace_fingerprint_period on public.cloud_jobs (workspace_id, fingerprint, period_start);
