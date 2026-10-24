-- People who asked to hear when paid plans open (while Isla is Free-only). One row per person.
create table public.pro_waitlist (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  plan text not null check (plan in ('pro', 'studio')),
  created_at timestamptz not null default now()
);

alter table public.pro_waitlist enable row level security;

create policy "Read own waitlist entry" on public.pro_waitlist for select to authenticated
  using (user_id = auth.uid());
create policy "Join waitlist" on public.pro_waitlist for insert to authenticated
  with check (user_id = auth.uid() and email = (auth.jwt() ->> 'email'));
create policy "Change own waitlist entry" on public.pro_waitlist for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and email = (auth.jwt() ->> 'email'));
create policy "Leave waitlist" on public.pro_waitlist for delete to authenticated
  using (user_id = auth.uid());
