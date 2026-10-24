-- Studio team seats paid like everything else: chosen with a Studio plan (extra_seats on a 'plan' order),
-- or added for the rest of a running plan (a 'seats' order).
alter table public.crypto_orders drop constraint crypto_orders_kind_check;
alter table public.crypto_orders add constraint crypto_orders_kind_check check (kind in ('plan', 'pack', 'seats'));
alter table public.crypto_orders add column extra_seats int not null default 0 check (extra_seats between 0 and 7);
