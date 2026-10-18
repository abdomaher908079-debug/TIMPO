-- When the free AI's daily limit is used up, a cloud listening job waits in line instead of failing:
-- waiting_until says when it tries again, and the listen function's resume step (every 15 minutes) restarts it.
alter table public.listen_jobs add column waiting_until timestamptz;

select cron.schedule('hookcut-listen-resume', '*/15 * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/listen',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'plan_changes_secret')
    ),
    body := '{}'::jsonb
  );
$$);
