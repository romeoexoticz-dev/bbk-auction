-- Verifies the approved 2-minute anti-sniping rule without retaining test data.
-- Run after migration 202609250029_automatic_bid_extension.sql.

create or replace function pg_temp.verify_automatic_bid_extension()
returns table (
  test_step text,
  passed boolean,
  result_code text,
  detail text
)
language plpgsql
as $$
declare
  v_seller_id uuid;
  v_bidder_id uuid;
  v_late_auction_id uuid := gen_random_uuid();
  v_early_auction_id uuid := gen_random_uuid();
  v_late_before timestamptz;
  v_late_after timestamptz;
  v_early_before timestamptz;
  v_early_after timestamptz;
  v_late_result jsonb;
  v_early_result jsonb;
  v_extension_audit_count integer;
begin
  begin
    select sp.user_id into v_seller_id
    from public.seller_profiles sp
    where sp.status = 'approved'
    order by sp.created_at
    limit 1;

    select bv.user_id into v_bidder_id
    from public.bidder_verifications bv
    join public.profiles p on p.id = bv.user_id
    where bv.status = 'approved'
      and p.account_status = 'active'
      and p.email_verified
    order by bv.reviewed_at desc nulls last
    limit 1;

    if v_seller_id is null or v_bidder_id is null then
      raise exception 'APPROVED_TEST_ACTORS_NOT_FOUND';
    end if;

    insert into public.auctions (
      id, seller_id, title, description, category, status,
      opening_price, current_price, min_increment, starts_at, ends_at,
      extension_window_seconds, extension_duration_seconds
    ) values
      (
        v_late_auction_id, v_seller_id, '[TEST] automatic extension late bid',
        'Rollback-only test auction for the approved automatic extension rule.',
        'ของเก่า', 'live', 100000, 100000, 5000,
        clock_timestamp() - interval '1 minute', clock_timestamp() + interval '90 seconds',
        120, 120
      ),
      (
        v_early_auction_id, v_seller_id, '[TEST] automatic extension early bid',
        'Rollback-only control auction outside the automatic extension window.',
        'ของเก่า', 'live', 100000, 100000, 5000,
        clock_timestamp() - interval '1 minute', clock_timestamp() + interval '10 minutes',
        120, 120
      );

    perform set_config('request.jwt.claim.sub', v_bidder_id::text, true);

    delete from public.bid_attempts
    where bidder_id = v_bidder_id
      and created_at > clock_timestamp() - interval '60 seconds';

    select ends_at into v_late_before
    from public.auctions where id = v_late_auction_id;

    v_late_result := public.submit_bid(v_late_auction_id, 105000, gen_random_uuid());

    select ends_at into v_late_after
    from public.auctions where id = v_late_auction_id;

    delete from public.bid_attempts
    where bidder_id = v_bidder_id
      and created_at > clock_timestamp() - interval '60 seconds';

    select ends_at into v_early_before
    from public.auctions where id = v_early_auction_id;

    v_early_result := public.submit_bid(v_early_auction_id, 105000, gen_random_uuid());

    select ends_at into v_early_after
    from public.auctions where id = v_early_auction_id;

    select count(*)::integer into v_extension_audit_count
    from public.audit_events
    where entity_type = 'auction'
      and entity_id = v_late_auction_id::text
      and event_type = 'auction.deadline_extended';

    raise exception 'ROLLBACK_AUTOMATIC_EXTENSION_TEST' using errcode = 'P9997';
  exception
    when sqlstate 'P9997' then
      return query values
        (
          'bid ใน 2 นาทีสุดท้ายต่อเวลา 2 นาที',
          coalesce((v_late_result ->> 'ok')::boolean, false)
            and v_late_after = v_late_before + interval '2 minutes',
          coalesce(v_late_result ->> 'code', 'NO_RESULT'),
          'before=' || v_late_before::text || ', after=' || v_late_after::text
        ),
        (
          'bid ก่อนช่วง 2 นาทีไม่เปลี่ยนเวลาปิด',
          coalesce((v_early_result ->> 'ok')::boolean, false)
            and v_early_after = v_early_before,
          coalesce(v_early_result ->> 'code', 'NO_RESULT'),
          'before=' || v_early_before::text || ', after=' || v_early_after::text
        ),
        (
          'บันทึก Audit เมื่อต่อเวลา',
          v_extension_audit_count = 1,
          case when v_extension_audit_count = 1 then 'AUDIT_RECORDED' else 'AUDIT_MISMATCH' end,
          'count=' || v_extension_audit_count::text
        );
  end;
end;
$$;

select * from pg_temp.verify_automatic_bid_extension();
