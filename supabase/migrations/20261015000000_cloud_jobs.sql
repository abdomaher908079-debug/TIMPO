-- Cloud processing usage: one row per episode transcribed on our server (see server/).
-- Readable by its owner; written only by the server with the service role.
create table public.cloud_jobs (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  seconds numeric not null check (seconds >= 0),
  period_start timestamptz not null,
  created_at timestamptz not null default now()
);

create index cloud_jobs_user_period on public.cloud_jobs (user_id, period_start);

alter table public.cloud_jobs enable row level security;
create policy "Read own cloud jobs" on public.cloud_jobs for select using (auth.uid() = user_id);
