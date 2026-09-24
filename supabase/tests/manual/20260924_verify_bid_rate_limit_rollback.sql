-- Verifies two immediate bid attempts without changing production data.
-- All bid, notification, audit, auction, and attempt changes happen inside a
-- PL/pgSQL subtransaction that is deliberately rolled back before results return.

create or replace function pg_temp.verify_bid_rate_limit()
returns table (
  test_step text,
  accepted boolean,
  result_code text,
  retry_after_seconds integer
)
language plpgsql
as $$
declare
  v_auction_id constant uuid := '7a14e383-5eea-4af5-a9e2-76d69c381832';
  v_bidder_id uuid;
  v_amount bigint;
  v_result_one jsonb;
  v_result_two jsonb;
begin
  begin
    select bidder_id into v_bidder_id
    from public.bids
    where auction_id = v_auction_id
    order by created_at desc
    limit 1;

    if v_bidder_id is null then
      raise exception 'TEST_BIDDER_NOT_FOUND' using errcode = 'P0001';
    end if;

    perform set_config('request.jwt.claim.sub', v_bidder_id::text, true);

    -- Make the fixture eligible during this test only. This update is rolled back.
    update public.auctions
    set status = 'live',
        starts_at = least(starts_at, now() - interval '1 minute'),
        ends_at = greatest(ends_at, now() + interval '5 minutes')
    where id = v_auction_id;

    -- Ignore real attempts from the preceding manual clicks during this test only.
    delete from public.bid_attempts
    where bidder_id = v_bidder_id
      and created_at > now() - interval '60 seconds';

    select current_price + public.bid_increment_for(current_price)
    into v_amount
    from public.auctions
    where id = v_auction_id;

    v_result_one := public.submit_bid(v_auction_id, v_amount, gen_random_uuid());

    select current_price + public.bid_increment_for(current_price)
    into v_amount
    from public.auctions
    where id = v_auction_id;

    v_result_two := public.submit_bid(v_auction_id, v_amount, gen_random_uuid());

    -- Force rollback of every change above while keeping result variables.
    raise exception 'ROLLBACK_RATE_LIMIT_TEST' using errcode = 'P9999';
  exception
    when sqlstate 'P9999' then
      return query values
        (
          'คำขอแรก',
          coalesce((v_result_one ->> 'ok')::boolean, false),
          v_result_one ->> 'code',
          nullif(v_result_one ->> 'retry_after_seconds', '')::integer
        ),
        (
          'คำขอที่สองทันที',
          coalesce((v_result_two ->> 'ok')::boolean, false),
          v_result_two ->> 'code',
          nullif(v_result_two ->> 'retry_after_seconds', '')::integer
        );
  end;
end;
$$;

select * from pg_temp.verify_bid_rate_limit();
