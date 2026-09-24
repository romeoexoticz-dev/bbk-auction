-- Verifies core duplicate-request and repeat-finalization guarantees.
-- Bid mutations run inside a deliberately rolled-back subtransaction.
-- The finalization check reuses an already-finalized auction and is read-only.

create or replace function pg_temp.verify_bid_idempotency()
returns table (
  test_step text,
  passed boolean,
  result_code text,
  detail text
)
language plpgsql
as $$
declare
  v_auction_id uuid;
  v_bidder_id uuid;
  v_request_key uuid := gen_random_uuid();
  v_amount bigint;
  v_first jsonb;
  v_retry jsonb;
  v_reused jsonb;
  v_low jsonb;
  v_matching_bid_count integer := 0;
begin
  begin
    select b.auction_id, b.bidder_id
    into v_auction_id, v_bidder_id
    from public.bids b
    join public.profiles p on p.id = b.bidder_id
    join public.bidder_verifications bv on bv.user_id = b.bidder_id
    where p.account_status = 'active'
      and p.email_verified
      and bv.status = 'approved'
    order by b.created_at desc
    limit 1;

    if v_auction_id is null or v_bidder_id is null then
      raise exception 'TEST_FIXTURE_NOT_FOUND' using errcode = 'P0001';
    end if;

    perform set_config('request.jwt.claim.sub', v_bidder_id::text, true);

    update public.auctions
    set status = 'live',
        starts_at = now() - interval '1 minute',
        ends_at = now() + interval '10 minutes'
    where id = v_auction_id;

    delete from public.bid_attempts
    where bidder_id = v_bidder_id
      and created_at > now() - interval '60 seconds';

    select current_price + public.bid_increment_for(current_price)
    into v_amount
    from public.auctions
    where id = v_auction_id;

    v_first := public.submit_bid(v_auction_id, v_amount, v_request_key);
    v_retry := public.submit_bid(v_auction_id, v_amount, v_request_key);
    v_reused := public.submit_bid(
      v_auction_id,
      v_amount + public.bid_increment_for(v_amount),
      v_request_key
    );

    select count(*)::integer
    into v_matching_bid_count
    from public.bids
    where bidder_id = v_bidder_id
      and request_key = v_request_key;

    delete from public.bid_attempts
    where bidder_id = v_bidder_id
      and created_at > now() - interval '60 seconds';

    v_low := public.submit_bid(v_auction_id, v_amount, gen_random_uuid());

    raise exception 'ROLLBACK_CORE_BID_TEST' using errcode = 'P9997';
  exception
    when sqlstate 'P9997' then
      return query values
        (
          'รับคำขอแรก',
          coalesce((v_first ->> 'ok')::boolean, false)
            and v_first ->> 'code' = 'BID_ACCEPTED'
            and coalesce((v_first ->> 'idempotent')::boolean, true) = false,
          v_first ->> 'code',
          'idempotent=' || coalesce(v_first ->> 'idempotent', 'null')
        ),
        (
          'ส่งคำขอเดิมซ้ำ',
          coalesce((v_retry ->> 'ok')::boolean, false)
            and v_retry ->> 'code' = 'BID_ACCEPTED'
            and coalesce((v_retry ->> 'idempotent')::boolean, false),
          v_retry ->> 'code',
          'idempotent=' || coalesce(v_retry ->> 'idempotent', 'null')
        ),
        (
          'หนึ่ง request key สร้างหนึ่ง bid',
          v_matching_bid_count = 1,
          case when v_matching_bid_count = 1 then 'ONE_BID_ONLY' else 'DUPLICATE_BID' end,
          'count=' || v_matching_bid_count::text
        ),
        (
          'ห้ามใช้ request key เดิมกับราคาใหม่',
          coalesce((v_reused ->> 'ok')::boolean, true) = false
            and v_reused ->> 'code' = 'IDEMPOTENCY_KEY_REUSED',
          v_reused ->> 'code',
          'ต้องปฏิเสธคำขอที่เปลี่ยนข้อมูล'
        ),
        (
          'ห้ามเสนอราคาต่ำกว่าราคาขั้นต่ำล่าสุด',
          coalesce((v_low ->> 'ok')::boolean, true) = false
            and v_low ->> 'code' = 'BID_BELOW_MINIMUM',
          v_low ->> 'code',
          'minimum_amount=' || coalesce(v_low ->> 'minimum_amount', 'null')
        );
  end;
end;
$$;

create or replace function pg_temp.verify_repeat_finalization()
returns table (
  test_step text,
  passed boolean,
  result_code text,
  detail text
)
language plpgsql
as $$
declare
  v_auction_id uuid;
  v_first public.auction_results%rowtype;
  v_second public.auction_results%rowtype;
  v_result_count integer;
  v_order_count integer;
begin
  select ar.auction_id
  into v_auction_id
  from public.auction_results ar
  where ar.reserve_met
    and exists (
      select 1 from public.orders o where o.auction_id = ar.auction_id
    )
  order by ar.finalized_at desc
  limit 1;

  if v_auction_id is null then
    return query values (
      'ปิดประมูลซ้ำ',
      false,
      'TEST_FIXTURE_NOT_FOUND',
      'ต้องมีรายการที่ปิดแล้วและสร้างออเดอร์หนึ่งรายการ'
    );
    return;
  end if;

  v_first := public.finalize_one_auction(v_auction_id, null, 'idempotency_test');
  v_second := public.finalize_one_auction(v_auction_id, null, 'idempotency_test');

  select count(*)::integer into v_result_count
  from public.auction_results where auction_id = v_auction_id;

  select count(*)::integer into v_order_count
  from public.orders where auction_id = v_auction_id;

  return query values
    (
      'ปิดประมูลซ้ำคืนผลเดิม',
      v_first.auction_id = v_second.auction_id,
      case when v_first.auction_id = v_second.auction_id then 'SAME_RESULT' else 'RESULT_MISMATCH' end,
      'auction_id=' || v_auction_id::text
    ),
    (
      'หนึ่งรายการมีผลประมูลเดียว',
      v_result_count = 1,
      case when v_result_count = 1 then 'ONE_RESULT_ONLY' else 'DUPLICATE_RESULT' end,
      'count=' || v_result_count::text
    ),
    (
      'หนึ่งรายการมีออเดอร์เดียว',
      v_order_count = 1,
      case when v_order_count = 1 then 'ONE_ORDER_ONLY' else 'DUPLICATE_ORDER' end,
      'count=' || v_order_count::text
    );
end;
$$;

select * from pg_temp.verify_bid_idempotency();
select * from pg_temp.verify_repeat_finalization();
