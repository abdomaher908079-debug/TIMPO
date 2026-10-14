-- Accounts, plans and usage. Users can read their own rows; only the server (Edge Functions with the
-- service role) writes them, so nobody can give themselves a plan or erase their usage.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'pro', 'studio')),
  billing text check (billing in ('monthly', 'yearly')),
  -- Paddle subscription, kept in sync by the paddle-webhook function.
  paddle_customer_id text,
  paddle_subscription_id text unique,
  subscription_status text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  -- Set when the subscription is canceled but still paid up until current_period_end.
  cancel_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
create policy "Read own profile" on public.profiles for select using (auth.uid() = id);

-- Every new account starts on Free.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Accounts that existed before this migration.
insert into public.profiles (id) select id from auth.users on conflict do nothing;

-- One row per episode processed, counted against the plan for the period it was processed in.
create table public.episodes (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Identifies the video file, so trying the same episode again in a period isn't counted twice.
  fingerprint text not null,
  seconds numeric not null check (seconds >= 0),
  period_start timestamptz not null,
  created_at timestamptz not null default now(),
  unique (user_id, fingerprint, period_start)
);

create index episodes_user_period on public.episodes (user_id, period_start);

alter table public.episodes enable row level security;
create policy "Read own episodes" on public.episodes for select using (auth.uid() = user_id);
