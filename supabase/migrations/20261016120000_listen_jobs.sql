-- Cloud listening in the background: the phone uploads the episode's audio in pieces, then the
-- `listen` Edge Function transcribes them and picks the moments on its own, so people can leave
-- the page. Audio is deleted as soon as each piece is transcribed; jobs are kept for 7 days.
create table public.listen_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  workspace_id uuid not null references auth.users (id) on delete cascade,
  fingerprint text not null,
  file_name text not null default '',
  seconds numeric not null check (seconds > 0),
  pieces int not null check (pieces > 0),
  pieces_done int not null default 0,
  -- uploading → listening → finishing → done (or error)
  status text not null default 'uploading',
  segments jsonb,
  moments jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index listen_jobs_user on public.listen_jobs (user_id, created_at desc);
alter table public.listen_jobs enable row level security;
create policy "Read own listen jobs" on public.listen_jobs for select using (auth.uid() = user_id);

create table public.listen_pieces (
  job_id uuid not null references public.listen_jobs (id) on delete cascade,
  idx int not null,
  start numeric not null,
  length numeric not null,
  -- waiting (not uploaded yet) → pending → running → done
  status text not null default 'waiting',
  attempts int not null default 0,
  claimed_at timestamptz,
  segments jsonb,
  primary key (job_id, idx)
);
-- Only the server reads and writes pieces.
alter table public.listen_pieces enable row level security;

-- Hands up to `n` uploaded pieces to one worker. Pieces a worker took but didn't finish within
-- 3 minutes (it stopped) can be taken again.
create function public.claim_listen_pieces(p_job uuid, p_n int)
returns setof public.listen_pieces
language sql
security definer
set search_path = public
as $$
  update listen_pieces p
  set status = 'running', claimed_at = now(), attempts = p.attempts + 1
  where (p.job_id, p.idx) in (
    select job_id, idx from listen_pieces
    where job_id = p_job
      and (status = 'pending' or (status = 'running' and claimed_at < now() - interval '3 minutes'))
    order by idx
    limit p_n
    for update skip locked
  )
  returning p.*;
$$;

-- Exactly one worker gets to finish a job: the one that sees every piece done first.
create function public.finish_listen_job(p_job uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  with won as (
    update listen_jobs set status = 'finishing', updated_at = now()
    where id = p_job and status = 'listening'
      and not exists (select 1 from listen_pieces where job_id = p_job and status <> 'done')
    returning 1
  )
  select exists (select 1 from won);
$$;

revoke execute on function public.claim_listen_pieces(uuid, int) from public, anon, authenticated;
revoke execute on function public.finish_listen_job(uuid) from public, anon, authenticated;

-- Pieces of audio waiting to be transcribed, under <user id>/<job id>/<piece>.ogg.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('listen-audio', 'listen-audio', false, 12582912, array['audio/ogg', 'audio/aac', 'audio/mp4', 'audio/webm']);
create policy "Upload own listen audio" on storage.objects for insert to authenticated
  with check (bucket_id = 'listen-audio' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Replace own listen audio" on storage.objects for update to authenticated
  using (bucket_id = 'listen-audio' and (storage.foldername(name))[1] = auth.uid()::text);
