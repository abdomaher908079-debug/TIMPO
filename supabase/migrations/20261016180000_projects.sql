-- Saved work ("My episodes"): each episode's transcript, clips and edits, so people can come back
-- to it on any device. Small (about 0.1 MB each); videos are never stored here.
-- Kept 1 day after the last change on Free, 30 days on paid plans (the plan at the time of reading,
-- so upgrading keeps older work too), then deleted by the hourly clean-up below.
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Identifies the video file (name, size, date, length).
  fingerprint text not null check (length(fingerprint) <= 128),
  file_name text not null default '' check (length(file_name) <= 300),
  file_size bigint not null default 0,
  info jsonb not null,
  segments jsonb not null default '[]',
  clips jsonb not null default '[]',
  -- Being listened to in the cloud (listen_jobs) and not finished yet.
  listening boolean not null default false,
  created_at timestamptz not null default now(),
  touched_at timestamptz not null default now(),
  unique (user_id, fingerprint),
  -- Keeps one row from taking much room: about 10 hours of transcript.
  constraint projects_size check (pg_column_size(segments) + pg_column_size(clips) + pg_column_size(info) < 4000000)
);
create index projects_touched on public.projects (touched_at);

alter table public.projects enable row level security;
create policy "Insert own projects" on public.projects for insert with check (auth.uid() = user_id);
create policy "Update own projects" on public.projects for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Delete own projects" on public.projects for delete using (auth.uid() = user_id);
-- Saving (upsert) needs to see your own rows. The site reads through my_projects / my_project,
-- which also hide work past its keep time.
create policy "Read own projects" on public.projects for select using (auth.uid() = user_id);

create function public.projects_touch() returns trigger language plpgsql as $$
begin
  new.touched_at := now();
  return new;
end $$;
create trigger projects_touch before insert or update on public.projects for each row execute function public.projects_touch();

-- How long work is kept on a plan.
create function public.project_keep(uid uuid) returns interval
language sql stable security definer set search_path = '' as $$
  select case when coalesce((select plan from public.workspace_of(uid)), 'free') = 'free' then interval '1 day' else interval '30 days' end;
$$;

-- The signed-in user's saved episodes, newest first, without the big transcript.
create function public.my_projects()
returns table (id uuid, fingerprint text, file_name text, file_size bigint, info jsonb, clip_count int, listening boolean,
               created_at timestamptz, touched_at timestamptz, expires_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.id, p.fingerprint, p.file_name, p.file_size, p.info, jsonb_array_length(p.clips), p.listening,
         p.created_at, p.touched_at, p.touched_at + public.project_keep(p.user_id)
  from public.projects p
  where p.user_id = auth.uid() and p.touched_at + public.project_keep(p.user_id) > now()
  order by p.touched_at desc;
$$;

-- One saved episode with everything in it.
create function public.my_project(p_fingerprint text)
returns table (id uuid, fingerprint text, file_name text, file_size bigint, info jsonb, segments jsonb, clips jsonb, listening boolean,
               created_at timestamptz, touched_at timestamptz, expires_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.id, p.fingerprint, p.file_name, p.file_size, p.info, p.segments, p.clips, p.listening,
         p.created_at, p.touched_at, p.touched_at + public.project_keep(p.user_id)
  from public.projects p
  where p.user_id = auth.uid() and p.fingerprint = p_fingerprint and p.touched_at + public.project_keep(p.user_id) > now();
$$;

revoke execute on function public.my_projects() from public, anon;
revoke execute on function public.my_project(text) from public, anon;
grant execute on function public.my_projects() to authenticated;
grant execute on function public.my_project(text) to authenticated;
revoke execute on function public.project_keep(uuid) from public, anon, authenticated;

-- Hourly clean-up: saved work past its keep time, and cloud-listening jobs older than a week.
create extension if not exists pg_cron;
select cron.schedule('hookcut-cleanup', '17 * * * *', $$
  delete from public.projects p where p.touched_at + public.project_keep(p.user_id) < now();
  delete from public.listen_jobs where created_at < now() - interval '8 days';
$$);
