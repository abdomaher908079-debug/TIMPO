-- The owners' dashboard (islaclips.com/owner, a page of its own): how many people use Isla. Only the
-- owners' verified accounts can read it.
create or replace function public.owner_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  today timestamptz := date_trunc('day', now());
  week timestamptz := now() - interval '7 days';
begin
  if not exists (
    select 1 from auth.users
    where id = auth.uid()
      and lower(email) in ('abdomaher908079@gmail.com', 'islaclipsofficial@gmail.com')
      and email_confirmed_at is not null
  ) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'users', jsonb_build_object(
      'total', (select count(*) from auth.users),
      'today', (select count(*) from auth.users where created_at >= today),
      'week', (select count(*) from auth.users where created_at >= week),
      'google', (select count(*) from auth.users where raw_app_meta_data ->> 'provider' = 'google')
    ),
    'active', jsonb_build_object(
      'today', (select count(distinct user_id) from episodes where created_at >= today),
      'week', (select count(distinct user_id) from episodes where created_at >= week)
    ),
    'episodes', jsonb_build_object(
      'total', (select count(*) from episodes),
      'today', (select count(*) from episodes where created_at >= today),
      'week', (select count(*) from episodes where created_at >= week),
      'cloud_today', (select count(*) from listen_jobs where created_at >= today),
      'in_line', (select count(*) from listen_jobs where waiting_until is not null and status in ('listening', 'finishing'))
    ),
    'ai_today', (select count(*) from ai_calls where created_at >= today),
    'waitlist', jsonb_build_object(
      'pro', (select count(*) from pro_waitlist where plan = 'pro'),
      'studio', (select count(*) from pro_waitlist where plan = 'studio'),
      'emails', coalesce((select jsonb_agg(jsonb_build_object('email', email, 'plan', plan, 'at', created_at) order by created_at desc) from pro_waitlist), '[]'::jsonb)
    ),
    'recent', coalesce((
      select jsonb_agg(r order by r.at desc)
      from (
        select u.email, u.created_at as at, u.raw_app_meta_data ->> 'provider' as via,
          (select count(*) from episodes e where e.user_id = u.id) as episodes
        from auth.users u
        order by u.created_at desc
        limit 30
      ) r
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.owner_stats() from public, anon;
grant execute on function public.owner_stats() to authenticated;
