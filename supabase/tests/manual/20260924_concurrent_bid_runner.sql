-- Run from two independent SQL Editor browser tabs.
-- Change the two arguments on the final line:
-- runner A: (0, 100000, 'c0260924-0000-4000-8000-0000000000a1')
-- runner B: (1, 105000, 'c0260924-0000-4000-8000-0000000000b1')

create or replace function pg_temp.run_bbk_concurrent_bid(
  p_bidder_offset integer,
  p_amount bigint,
  p_request_key uuid
)
returns table (
  bidder_id uuid,
  amount bigint,
  ok boolean,
  result_code text,
  finished_at timestamptz
)
language plpgsql
as $$
declare
  v_auction_id constant uuid := 'c0260924-0000-4000-8000-000000000001';
  v_bidder_id uuid;
  v_seller_id uuid;
  v_starts_at timestamptz;
  v_result jsonb;
begin
  select a.seller_id, a.starts_at
  into v_seller_id, v_starts_at
  from public.auctions a
  where a.id = v_auction_id;

  select p.id into v_bidder_id
  from public.profiles p
  join public.bidder_verifications bv on bv.user_id = p.id
  join public.role_assignments ra on ra.user_id = p.id and ra.role_name = 'bidder'
  where bv.status = 'approved'
    and p.account_status = 'active'
    and p.email_verified
    and p.id <> v_seller_id
  order by p.id
  offset p_bidder_offset
  limit 1;

  if v_bidder_id is null then
    raise exception 'APPROVED_TEST_BIDDER_NOT_FOUND';
  end if;

  perform set_config('request.jwt.claim.sub', v_bidder_id::text, true);
  perform pg_sleep(greatest(0, extract(epoch from (v_starts_at - clock_timestamp()))));

  v_result := public.submit_bid(v_auction_id, p_amount, p_request_key);

  return query select
    v_bidder_id,
    p_amount,
    coalesce((v_result ->> 'ok')::boolean, false),
    v_result ->> 'code',
    clock_timestamp();
end;
$$;

-- Replace only this line for runner B.
select * from pg_temp.run_bbk_concurrent_bid(
  0,
  100000,
  'c0260924-0000-4000-8000-0000000000a1'
);
