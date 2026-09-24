-- Verifies the rolling 10-attempts-per-minute limit without changing data.
-- The setup attempts and rejected request are deliberately rolled back.

create or replace function pg_temp.verify_bid_minute_limit()
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
  v_result jsonb;
  v_index integer;
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

    delete from public.bid_attempts
    where bidder_id = v_bidder_id
      and created_at > now() - interval '60 seconds';

    -- Ten attempts spaced three seconds apart: inside one minute but outside
    -- the two-second rule, so the rolling-minute rule is tested independently.
    for v_index in 1..10 loop
      insert into public.bid_attempts (
        bidder_id,
        auction_id,
        amount,
        request_key,
        outcome,
        reason_code,
        created_at,
        completed_at
      ) values (
        v_bidder_id,
        v_auction_id,
        100000,
        gen_random_uuid(),
        'rejected',
        'TEST_SETUP',
        clock_timestamp() - make_interval(secs => v_index * 3),
        clock_timestamp() - make_interval(secs => v_index * 3)
      );
    end loop;

    v_result := public.submit_bid(v_auction_id, 99999999, gen_random_uuid());

    raise exception 'ROLLBACK_MINUTE_LIMIT_TEST' using errcode = 'P9998';
  exception
    when sqlstate 'P9998' then
      return query values (
        'คำขอครั้งที่ 11 ภายในหนึ่งนาที',
        coalesce((v_result ->> 'ok')::boolean, false),
        v_result ->> 'code',
        nullif(v_result ->> 'retry_after_seconds', '')::integer
      );
  end;
end;
$$;

select * from pg_temp.verify_bid_minute_limit();
