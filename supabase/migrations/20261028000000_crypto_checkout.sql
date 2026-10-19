-- Our own checkout page (/pay): the payment's details are kept with the order, so the page can be left and
-- opened again (address, exact amount, coin, until when the price holds), plus what has arrived so far.
alter table public.crypto_orders
  add column pay_currency text,
  add column pay_amount numeric,
  add column pay_address text,
  add column payin_extra_id text,
  add column price_expires_at timestamptz,
  add column actually_paid numeric;
