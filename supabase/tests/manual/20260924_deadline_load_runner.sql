-- Prepare this script in 10 independent SQL Editor tabs first. Then run the
-- setup script and immediately start all 10 tabs so SQL Editor does not hit
-- its upstream timeout while pg_sleep waits for the auction deadline.
-- Change only the final bidder index (1..10). Each call sleeps until its target.

create or replace function pg_temp.run_bbk_deadline_bid(p_bidder_index integer)
returns table (
  bidder_index integer,
  bidder_id uuid,
  amount bigint,
  target_offset_ms integer,
  ok boolean,
  result_code text,
  finished_at timestamptz,
  finished_delta_ms bigint
)
language plpgsql
as $$
declare
  v_auction_id constant uuid := 'c0260924-0000-4000-8000-000000000010';
  v_bidder_id uuid;
  v_amount bigint;
  v_offset_ms integer;
  v_target_at timestamptz;
  v_ends_at timestamptz;
  v_result jsonb;
  v_finished_at timestamptz;
begin
  if p_bidder_index not between 1 and 10 then
    raise exception 'BIDDER_INDEX_OUT_OF_RANGE';
  end if;

  v_bidder_id := (
    'c0260924-0000-4000-9000-' || lpad(p_bidder_index::text, 12, '0')
  )::uuid;
  v_amount := 100000 + (p_bidder_index * 5000);
  v_offset_ms := case p_bidder_index
    when 1 then -2000
    when 2 then -1600
    when 3 then -1200
    when 4 then -800
    when 5 then -400
    when 6 then 0
    when 7 then 100
    when 8 then 300
    when 9 then 600
    when 10 then 1000
  end;

  select a.ends_at into v_ends_at
  from public.auctions a
  where a.id = v_auction_id;

  if v_ends_at is null then
    raise exception 'DEADLINE_LOAD_AUCTION_NOT_FOUND';
  end if;

  if not exists (
    select 1
    from public.profiles p
    join public.bidder_verifications bv on bv.user_id = p.id
    where p.id = v_bidder_id
      and p.account_status = 'active'
      and p.email_verified
      and bv.status = 'approved'
  ) then
    raise exception 'DEADLINE_LOAD_BIDDER_NOT_READY';
  end if;

  v_target_at := v_ends_at + (v_offset_ms::text || ' milliseconds')::interval;
  perform set_config('request.jwt.claim.sub', v_bidder_id::text, true);
  perform pg_sleep(greatest(0, extract(epoch from (v_target_at - clock_timestamp()))));

  v_result := public.submit_bid(
    v_auction_id,
    v_amount,
    ('c0260924-0000-4000-a000-' || lpad(p_bidder_index::text, 12, '0'))::uuid
  );
  v_finished_at := clock_timestamp();

  return query select
    p_bidder_index,
    v_bidder_id,
    v_amount,
    v_offset_ms,
    coalesce((v_result ->> 'ok')::boolean, false),
    v_result ->> 'code',
    v_finished_at,
    round(extract(epoch from (v_finished_at - v_ends_at)) * 1000)::bigint;
end;
$$;

select * from pg_temp.run_bbk_deadline_bid(1);
