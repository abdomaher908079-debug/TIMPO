-- Studio teams and brand kits.
--
-- A "workspace" is whoever pays: your own account, or the Studio owner whose team you're in. Plans,
-- usage (episodes, cloud_jobs) and brand kits belong to the workspace, so a Studio team shares one
-- pool of hours and the same brand kits.

-- The plan a profile is entitled to: unpaid or ended subscriptions count as Free
-- (same rule as effectivePlan in supabase/functions/_shared/plans.ts).
create function public.effective_plan(p public.profiles) returns text
language sql immutable set search_path = '' as $$
  select case
    when p.plan in ('pro', 'studio') and p.subscription_status in ('active', 'trialing', 'past_due') then p.plan
    else 'free'
  end;
$$;

-- Studio teams: the owner plus up to 2 people (3 in total).
create table public.team_members (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  -- Shown to the member, who can't read the owner's account.
  owner_email text,
  email text not null check (email = lower(email) and email like '%_@_%'),
  -- Set when the invited person joins.
  user_id uuid references auth.users (id) on delete cascade,
  status text not null default 'invited' check (status in ('invited', 'active')),
  created_at timestamptz not null default now(),
  unique (owner_id, email)
);

-- Someone can be in one team at a time.
create unique index team_members_one_team on public.team_members (user_id) where user_id is not null;

-- The workspace a user works in, with its effective plan and billing period. Server-side only.
create function public.workspace_of(uid uuid)
returns table (
  owner_id uuid,
  plan text,
  billing text,
  subscription_status text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at timestamptz,
  is_team_member boolean
)
language sql stable security definer set search_path = '' as $$
  select * from (
    -- A member of a team whose owner has an active Studio subscription works in the owner's workspace.
    select p.id as owner_id, public.effective_plan(p) as plan, p.billing, p.subscription_status,
           p.current_period_start, p.current_period_end, p.cancel_at, true as is_team_member
    from public.team_members m
    join public.profiles p on p.id = m.owner_id
    where m.user_id = uid and m.status = 'active' and public.effective_plan(p) = 'studio'
    union all
    select p.id, public.effective_plan(p), p.billing, p.subscription_status, p.current_period_start,
           p.current_period_end, p.cancel_at, false
    from public.profiles p
    where p.id = uid
  ) w
  order by is_team_member desc
  limit 1;
$$;

revoke execute on function public.workspace_of(uuid) from public, anon, authenticated;

-- The signed-in user's own workspace, for the website.
create function public.my_workspace()
returns table (
  owner_id uuid,
  plan text,
  billing text,
  subscription_status text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at timestamptz,
  is_team_member boolean
)
language sql stable security definer set search_path = '' as $$
  select * from public.workspace_of(auth.uid());
$$;

create function public.my_workspace_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select owner_id from public.workspace_of(auth.uid());
$$;

-- Invites: only Studio owners, at most 2 people, never yourself or someone already in your team.
create function public.check_team_invite() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  owner public.profiles;
begin
  select * into owner from public.profiles where id = new.owner_id;
  if owner is null or public.effective_plan(owner) <> 'studio' then
    raise exception 'Teams are part of the Studio plan.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.team_members where owner_id = new.owner_id) >= 2 then
    raise exception 'A Studio team has up to 3 people: you and 2 others.' using errcode = 'P0001';
  end if;
  new.owner_email := (select lower(email) from auth.users where id = new.owner_id);
  if new.email = new.owner_email then
    raise exception 'You''re already in your own team.' using errcode = 'P0001';
  end if;
  -- Invites start unaccepted; joining goes through join_team().
  new.user_id := null;
  new.status := 'invited';
  return new;
end;
$$;

create trigger team_invite_rules before insert on public.team_members
  for each row execute function public.check_team_invite();

-- The invited person accepts, signed in with the invited email.
create function public.join_team(invite_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me text := lower(auth.email());
begin
  if exists (select 1 from public.team_members where user_id = auth.uid()) then
    raise exception 'Leave your current team before joining another.' using errcode = 'P0001';
  end if;
  update public.team_members set user_id = auth.uid(), status = 'active'
  where id = invite_id and email = me and status = 'invited';
  if not found then
    raise exception 'This invite is no longer available.' using errcode = 'P0001';
  end if;
end;
$$;

alter table public.team_members enable row level security;
create policy "Owners and members see their team" on public.team_members for select
  using (owner_id = auth.uid() or user_id = auth.uid() or (status = 'invited' and email = lower(auth.email())));
create policy "Owners invite" on public.team_members for insert with check (owner_id = auth.uid());
-- Owners remove people; members leave; invited people decline.
create policy "Remove, leave or decline" on public.team_members for delete
  using (owner_id = auth.uid() or user_id = auth.uid() or (status = 'invited' and email = lower(auth.email())));

-- Usage belongs to the workspace, so a team shares its hours.
alter table public.episodes add column workspace_id uuid references auth.users (id) on delete cascade;
update public.episodes set workspace_id = user_id;
alter table public.episodes alter column workspace_id set not null;
alter table public.episodes drop constraint episodes_user_id_fingerprint_period_start_key;
alter table public.episodes add constraint episodes_workspace_fingerprint_period unique (workspace_id, fingerprint, period_start);
drop index public.episodes_user_period;
create index episodes_workspace_period on public.episodes (workspace_id, period_start);
drop policy "Read own episodes" on public.episodes;
create policy "Read workspace episodes" on public.episodes for select
  using (user_id = auth.uid() or workspace_id = public.my_workspace_id());

alter table public.cloud_jobs add column workspace_id uuid references auth.users (id) on delete cascade;
update public.cloud_jobs set workspace_id = user_id;
alter table public.cloud_jobs alter column workspace_id set not null;
drop index public.cloud_jobs_user_period;
create index cloud_jobs_workspace_period on public.cloud_jobs (workspace_id, period_start);
drop policy "Read own cloud jobs" on public.cloud_jobs;
create policy "Read workspace cloud jobs" on public.cloud_jobs for select
  using (user_id = auth.uid() or workspace_id = public.my_workspace_id());

-- Brand kits: captions and logo in a show's own look. Pro: 1, Studio: 5. Shared with the team.
create table public.brand_kits (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  font text not null default 'Inter' check (char_length(font) <= 40),
  style text not null default 'highlight' check (style in ('bold', 'highlight', 'boxed')),
  text_color text not null default '#ffffff' check (text_color ~ '^#[0-9a-f]{6}$'),
  accent_color text not null default '#9dff3c' check (accent_color ~ '^#[0-9a-f]{6}$'),
  -- Top of the captions, as a fraction of the video's height.
  position real not null default 0.66 check (position between 0.1 and 0.85),
  -- A small image (resized in the browser) stored inline, so no file storage is needed.
  logo text check (logo is null or (logo like 'data:image/%' and octet_length(logo) <= 300000)),
  logo_corner text not null default 'top-right' check (logo_corner in ('top-left', 'top-right', 'bottom-left', 'bottom-right')),
  created_at timestamptz not null default now()
);

create index brand_kits_workspace on public.brand_kits (workspace_id);

create function public.check_brand_kit_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  plan text := (select w.plan from public.workspace_of(new.workspace_id) w);
  allowed int := case plan when 'studio' then 5 when 'pro' then 1 else 0 end;
begin
  if (select count(*) from public.brand_kits where workspace_id = new.workspace_id) >= allowed then
    raise exception '%', case plan
      when 'free' then 'Brand kits are part of Pro and Studio.'
      when 'pro' then 'Pro includes 1 brand kit. Studio has up to 5, one per show.'
      else 'Studio includes up to 5 brand kits.' end
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger brand_kit_limit before insert on public.brand_kits
  for each row execute function public.check_brand_kit_limit();

alter table public.brand_kits enable row level security;
create policy "Workspace reads kits" on public.brand_kits for select using (workspace_id = public.my_workspace_id());
create policy "Workspace adds kits" on public.brand_kits for insert with check (workspace_id = public.my_workspace_id());
create policy "Workspace edits kits" on public.brand_kits for update
  using (workspace_id = public.my_workspace_id()) with check (workspace_id = public.my_workspace_id());
create policy "Workspace deletes kits" on public.brand_kits for delete using (workspace_id = public.my_workspace_id());
