-- What people keep: every exported clip, and each 👍/👎 given in the editor, with the clip's AI score, its place in
-- the list, how long it plays, its layout and whether it joined parts. No titles or transcript: only what shows
-- whether the AI's picks and scores match what people want (owner page, owner_feedback).
create table public.clip_feedback (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('exported', 'liked', 'disliked')),
  score int check (score between 0 and 100),
  rank int check (rank between 0 and 100),
  seconds numeric check (seconds between 0 and 600),
  layout text check (layout in ('fill', 'fit', 'split')),
  joined boolean not null default false,
  created_at timestamptz not null default now()
);
create index clip_feedback_created on public.clip_feedback (created_at);
alter table public.clip_feedback enable row level security;
create policy "Add own feedback" on public.clip_feedback for insert with check (user_id = auth.uid());

-- Old feedback goes after a year.
select cron.schedule('hookcut-clip-feedback-cleanup', '41 3 * * *', $$
  delete from public.clip_feedback where created_at < now() - interval '365 days';
$$);

-- The owners' view, last 30 days. Same check as owner_stats (owner email, two-step verified).
create function public.owner_feedback()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  month timestamptz := now() - interval '30 days';
begin
  if not exists (
    select 1 from auth.users
    where id = auth.uid()
      and lower(email) in ('abdomaher908079@gmail.com', 'islaclipsofficial@gmail.com')
      and email_confirmed_at is not null
  ) or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return jsonb_build_array(
    jsonb_build_object('title', 'What people keep (last 30 days)', 'rows', jsonb_build_array(
      jsonb_build_array('Clips exported', (select count(*) from clip_feedback where kind = 'exported' and created_at >= month)),
      jsonb_build_array('Liked (👍)', (select count(*) from clip_feedback where kind = 'liked' and created_at >= month)),
      jsonb_build_array('Disliked (👎)', (select count(*) from clip_feedback where kind = 'disliked' and created_at >= month)),
      jsonb_build_array('Average AI score, exported', (select coalesce(round(avg(score)), 0) from clip_feedback where kind = 'exported' and created_at >= month)),
      jsonb_build_array('Average AI score, liked', (select coalesce(round(avg(score)), 0) from clip_feedback where kind = 'liked' and created_at >= month)),
      jsonb_build_array('Average AI score, disliked', (select coalesce(round(avg(score)), 0) from clip_feedback where kind = 'disliked' and created_at >= month)),
      jsonb_build_array('Exported clips that joined parts', (select count(*) from clip_feedback where kind = 'exported' and joined and created_at >= month)),
      jsonb_build_array('Exported as split screen', (select count(*) from clip_feedback where kind = 'exported' and layout = 'split' and created_at >= month)),
      jsonb_build_array('Average length exported, seconds', (select coalesce(round(avg(seconds)), 0) from clip_feedback where kind = 'exported' and created_at >= month))
    )),
    jsonb_build_object('title', 'Exports by AI score (last 30 days)', 'rows', jsonb_build_array(
      jsonb_build_array('90–100', (select count(*) from clip_feedback where kind = 'exported' and score >= 90 and created_at >= month)),
      jsonb_build_array('80–89', (select count(*) from clip_feedback where kind = 'exported' and score between 80 and 89 and created_at >= month)),
      jsonb_build_array('70–79', (select count(*) from clip_feedback where kind = 'exported' and score between 70 and 79 and created_at >= month)),
      jsonb_build_array('Below 70', (select count(*) from clip_feedback where kind = 'exported' and score < 70 and created_at >= month))
    )),
    jsonb_build_object('title', 'Exports by place in the list (last 30 days)', 'rows', jsonb_build_array(
      jsonb_build_array('1st–3rd', (select count(*) from clip_feedback where kind = 'exported' and rank < 3 and created_at >= month)),
      jsonb_build_array('4th–10th', (select count(*) from clip_feedback where kind = 'exported' and rank between 3 and 9 and created_at >= month)),
      jsonb_build_array('11th and later', (select count(*) from clip_feedback where kind = 'exported' and rank >= 10 and created_at >= month))
    ))
  );
end;
$$;
revoke execute on function public.owner_feedback() from public, anon;
grant execute on function public.owner_feedback() to authenticated;
