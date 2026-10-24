-- Keeping the database small (Supabase's free plan has 500 MB). Saved episodes already go after 1 day
-- (Free) or 30 days (paid); this cleans up everything else that only grew.
--   episodes, cloud_jobs: usage counts only matter for the current month; kept 3 months for support.
--   ai_calls: added up per month and model into ai_costs_monthly (kept), the rows kept 90 days.
--   hour_packs: kept 90 days after they expire or are refunded, with their pack_uses.

create table public.ai_costs_monthly (
  month date not null,
  kind text not null,
  model text not null,
  paid boolean not null,
  calls int not null,
  input_tokens bigint not null,
  output_tokens bigint not null,
  seconds numeric not null,
  primary key (month, kind, model, paid)
);
alter table public.ai_costs_monthly enable row level security;

-- Adds ai_calls older than 90 days to the monthly totals, then deletes them. One transaction, so nothing is
-- counted twice or lost.
create function public.roll_up_ai_calls() returns void
language plpgsql security definer set search_path = '' as $$
declare
  cutoff timestamptz := now() - interval '90 days';
begin
  insert into public.ai_costs_monthly as m (month, kind, model, paid, calls, input_tokens, output_tokens, seconds)
  select date_trunc('month', created_at)::date, kind, model, paid, count(*), sum(input_tokens), sum(output_tokens), coalesce(sum(seconds), 0)
  from public.ai_calls where created_at < cutoff
  group by 1, 2, 3, 4
  on conflict (month, kind, model, paid) do update set
    calls = m.calls + excluded.calls,
    input_tokens = m.input_tokens + excluded.input_tokens,
    output_tokens = m.output_tokens + excluded.output_tokens,
    seconds = m.seconds + excluded.seconds;
  delete from public.ai_calls where created_at < cutoff;
end;
$$;
revoke execute on function public.roll_up_ai_calls() from public, anon, authenticated;

select cron.schedule('hookcut-storage-cleanup', '41 3 * * *', $$
  delete from public.episodes where period_start < now() - interval '3 months';
  delete from public.cloud_jobs where period_start < now() - interval '3 months';
  select public.roll_up_ai_calls();
  delete from public.hour_packs
  where coalesce(refunded_at, expires_at) < now() - interval '90 days';
  delete from public.pack_uses where created_at < now() - interval '120 days';
$$);
