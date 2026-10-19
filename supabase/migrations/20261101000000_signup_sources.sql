-- Where people heard about Isla: their answer after signing up ("How did you hear about Isla?"), and the
-- link they first came from (?ref=… or utm_source=…), to see which promotion brings users.
create table public.signup_sources (
  user_id uuid primary key references auth.users (id) on delete cascade,
  answer text check (answer in ('tiktok', 'instagram', 'youtube', 'reddit', 'product_hunt', 'google', 'friend', 'creator', 'other', 'skipped')),
  detail text check (char_length(detail) <= 200),
  ref text check (char_length(ref) <= 60),
  created_at timestamptz not null default now()
);
alter table public.signup_sources enable row level security;
create policy "Read own source" on public.signup_sources for select using (user_id = auth.uid());
create policy "Add own source" on public.signup_sources for insert with check (user_id = auth.uid());
create policy "Change own source" on public.signup_sources for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- The owners' view: answers and links, counted. Same check as owner_stats (owner email, two-step verified).
create function public.owner_sources()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
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
    jsonb_build_object('title', 'How people heard about Isla (their answer)', 'rows', coalesce((
      select jsonb_agg(jsonb_build_array(name, n) order by n desc)
      from (
        select case answer
            when 'tiktok' then 'TikTok' when 'instagram' then 'Instagram' when 'youtube' then 'YouTube'
            when 'reddit' then 'Reddit' when 'product_hunt' then 'Product Hunt' when 'google' then 'Google search'
            when 'friend' then 'A friend' when 'creator' then 'A creator or podcaster' when 'other' then 'Other'
            else 'Didn''t say' end as name,
          count(*) as n
        from signup_sources group by 1
      ) a
    ), '[]'::jsonb)),
    jsonb_build_object('title', 'Links they came from (?ref=)', 'rows', coalesce((
      select jsonb_agg(jsonb_build_array(ref, n) order by n desc)
      from (select ref, count(*) as n from signup_sources where ref is not null group by ref) r
    ), '[]'::jsonb)),
    jsonb_build_object('title', 'What "Other" people wrote (latest 20)', 'list', coalesce((
      select jsonb_agg(detail) from (
        select detail from signup_sources where answer = 'other' and detail is not null order by created_at desc limit 20
      ) d
    ), '[]'::jsonb))
  );
end;
$$;
revoke execute on function public.owner_sources() from public, anon;
grant execute on function public.owner_sources() to authenticated;
