-- Invite rewards: each account has an invite code. Someone who signs up through it and makes their first
-- episode gets, with the person who invited them, a gift of hours and episodes (hour_packs, any_plan).
-- Up to 10 rewards a month per inviter, so fake accounts can't farm hours.

create table public.invite_codes (
  user_id uuid primary key references auth.users (id) on delete cascade,
  code text not null unique,
  created_at timestamptz not null default now()
);
alter table public.invite_codes enable row level security;
create policy "Read own invite code" on public.invite_codes for select using (user_id = auth.uid());

create table public.referrals (
  id bigint generated always as identity primary key,
  invited_id uuid not null unique references auth.users (id) on delete cascade,
  inviter_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  rewarded_at timestamptz,
  check (invited_id <> inviter_id)
);
create index referrals_inviter on public.referrals (inviter_id, rewarded_at);
alter table public.referrals enable row level security;
create policy "Read own referrals" on public.referrals for select using (inviter_id = auth.uid() or invited_id = auth.uid());

-- The signed-in user's invite code (made the first time) and how their invites are doing.
create function public.my_invite()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  c text;
begin
  if me is null then
    raise exception 'not signed in';
  end if;
  select code into c from invite_codes where user_id = me;
  while c is null loop
    begin
      c := substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
      insert into invite_codes (user_id, code) values (me, c);
    exception when unique_violation then
      c := null;
    end;
  end loop;
  return jsonb_build_object(
    'code', c,
    'joined', (select count(*) from referrals where inviter_id = me),
    'rewarded', (select count(*) from referrals where inviter_id = me and rewarded_at is not null)
  );
end;
$$;
revoke execute on function public.my_invite() from public, anon;
grant execute on function public.my_invite() to authenticated;

-- Records who invited the signed-in user. Only for new accounts (made in the last 3 days), once, and never
-- your own code. Returns whether it counted.
create function public.claim_invite(p_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  inviter uuid;
begin
  if me is null then
    return false;
  end if;
  if (select created_at from auth.users where id = me) < now() - interval '3 days' then
    return false;
  end if;
  select user_id into inviter from invite_codes where code = lower(trim(p_code));
  if inviter is null or inviter = me then
    return false;
  end if;
  insert into referrals (invited_id, inviter_id) values (me, inviter) on conflict (invited_id) do nothing;
  return found;
end;
$$;
revoke execute on function public.claim_invite(text) from public, anon;
grant execute on function public.claim_invite(text) to authenticated;

-- The reward: on an invited person's first episode, a gift for both (3 hours and 3 episodes, for 60 days),
-- unless their inviter already got 10 rewards in the last 30 days.
create function public.reward_invite()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r referrals%rowtype;
begin
  select * into r from referrals where invited_id = new.user_id and rewarded_at is null for update;
  if not found then
    return new;
  end if;
  if (select count(*) from referrals where inviter_id = r.inviter_id and rewarded_at > now() - interval '30 days') >= 10 then
    return new;
  end if;
  update referrals set rewarded_at = now() where id = r.id;
  insert into hour_packs (workspace_id, transaction_id, seconds, episodes, seconds_left, episodes_left, expires_at, any_plan)
  values
    (r.invited_id, 'invite-' || r.id || '-joined', 3 * 3600, 3, 3 * 3600, 3, now() + interval '60 days', true),
    (r.inviter_id, 'invite-' || r.id || '-inviter', 3 * 3600, 3, 3 * 3600, 3, now() + interval '60 days', true)
  on conflict (transaction_id) do nothing;
  return new;
end;
$$;
revoke execute on function public.reward_invite() from public, anon, authenticated;
create trigger reward_invite after insert on public.episodes for each row execute function public.reward_invite();
