-- The owners' numbers need a session signed in with email and password (not Google), on top of two-step
-- verification. Adds that check to each owner function where it checks aal2.
do $$
declare
  f record;
  def text;
begin
  for f in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('owner_stats', 'owner_sources', 'owner_feedback')
  loop
    def := pg_get_functiondef(f.oid);
    if position('"method": "password"' in def) = 0 then
      execute replace(
        def,
        $r$coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'$r$,
        $r$coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not coalesce(auth.jwt() -> 'amr', '[]'::jsonb) @> '[{"method": "password"}]'::jsonb$r$
      );
    end if;
  end loop;
end $$;
