-- Tokens each piece used ({ model, paid, input, output }), to see what cloud listening really costs.
alter table public.listen_pieces add column usage jsonb;
