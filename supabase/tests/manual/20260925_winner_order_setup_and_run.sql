-- Creates one disposable bidder and one isolated auction, places a winning
-- THB 2,000 bid, finalizes the exact fixture twice, and asserts the order math.
--
-- DO NOT RUN without fresh action-time approval to create the temporary Auth
-- account. No email/SMS is sent. Real payment submission must remain disabled.

do $winner_order_test$
declare
  v_auction_id constant uuid := 'c0260925-0000-4000-8100-000000000001';
  v_bidder_id constant uuid := 'c0260925-0000-4000-9100-000000000001';
  v_request_key constant uuid := 'c0260925-0000-4000-a100-000000000001';
  v_instance_id constant uuid := '00000000-0000-0000-0000-000000000000';
  v_email constant text := 'bbk-winner-order-01@example.invalid';
  v_seller_id uuid;
  v_bid_result jsonb;
  v_first_result public.auction_results%rowtype;
  v_second_result public.auction_results%rowtype;
  v_order public.orders%rowtype;
  v_result_count integer;
  v_order_count integer;
  v_winner_notification_count integer;
begin
  if coalesce((
    select payment_submission_enabled
    from public.marketplace_settings
    where id = 1
  ), false) then
    raise exception 'PAYMENT_SUBMISSION_MUST_REMAIN_DISABLED';
  end if;

  if exists (select 1 from public.auctions where id = v_auction_id) then
    raise exception 'WINNER_ORDER_FIXTURE_ALREADY_EXISTS';
  end if;

  if exists (
    select 1 from auth.users
    where id = v_bidder_id or email = v_email
  ) then
    raise exception 'WINNER_ORDER_TEST_ACCOUNT_ALREADY_EXISTS';
  end if;

  select sp.user_id into v_seller_id
  from public.seller_profiles sp
  where sp.status = 'approved'
  order by sp.created_at
  limit 1;

  if v_seller_id is null then
    raise exception 'APPROVED_SELLER_NOT_FOUND';
  end if;

  insert into auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    confirmation_token,
    recovery_token,
    email_change_token_new,
    email_change,
    phone_change,
    phone_change_token,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
  ) values (
    v_instance_id,
    v_bidder_id,
    'authenticated',
    'authenticated',
    v_email,
    crypt(gen_random_uuid()::text, gen_salt('bf')),
    clock_timestamp(),
    '',
    '',
    '',
    '',
    '',
    '',
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    jsonb_build_object('display_name', '[TEST-WINNER] bidder 01'),
    clock_timestamp(),
    clock_timestamp()
  );

  insert into auth.identities (
    provider_id,
    user_id,
    identity_data,
    provider,
    last_sign_in_at,
    created_at,
    updated_at
  ) values (
    v_bidder_id::text,
    v_bidder_id,
    jsonb_build_object(
      'sub', v_bidder_id::text,
      'email', v_email,
      'email_verified', true
    ),
    'email',
    null,
    clock_timestamp(),
    clock_timestamp()
  );

  update public.profiles
  set display_name = '[TEST-WINNER] bidder 01',
      account_status = 'active',
      email_verified = true
  where id = v_bidder_id;

  insert into public.role_assignments (user_id, role_name)
  values (v_bidder_id, 'bidder')
  on conflict (user_id, role_name) do nothing;

  insert into public.bidder_verifications (
    user_id,
    status,
    review_reason,
    reviewed_at
  ) values (
    v_bidder_id,
    'approved',
    'Temporary approved bidder for winner-order testing only',
    clock_timestamp()
  )
  on conflict (user_id) do update
  set status = excluded.status,
      review_reason = excluded.review_reason,
      reviewed_at = excluded.reviewed_at;

  insert into public.auctions (
    id,
    seller_id,
    title,
    description,
    category,
    status,
    opening_price,
    current_price,
    min_increment,
    reserve_price,
    starts_at,
    ends_at,
    extension_window_seconds,
    extension_duration_seconds,
    item_year,
    item_model,
    item_size,
    condition_summary,
    expert_notes
  ) values (
    v_auction_id,
    v_seller_id,
    '[TEST-WINNER] Order total 2,214 baht',
    'Disposable internal fixture. This is not a real product.',
    'ระบบทดสอบ',
    'draft',
    100000,
    100000,
    5000,
    200000,
    clock_timestamp() - interval '1 minute',
    clock_timestamp() + interval '10 minutes',
    0,
    0,
    'ทดสอบ',
    'ชุดทดสอบผู้ชนะและออเดอร์',
    'ไม่ใช่สินค้าจริง',
    'ข้อมูลจำลองสำหรับทดสอบระบบเท่านั้น',
    'ห้ามนำรายการนี้ไปใช้ขายจริง'
  );

  insert into public.auction_media (
    auction_id, owner_id, object_path, media_kind, position, mime_type, byte_size
  ) values
    (v_auction_id, v_seller_id, v_seller_id || '/' || v_auction_id || '/test-front.png', 'front', 0, 'image/png', 1),
    (v_auction_id, v_seller_id, v_seller_id || '/' || v_auction_id || '/test-back.png', 'back', 1, 'image/png', 1),
    (v_auction_id, v_seller_id, v_seller_id || '/' || v_auction_id || '/test-defect.png', 'defect', 2, 'image/png', 1);

  update public.auctions
  set status = 'live'
  where id = v_auction_id;

  perform set_config('request.jwt.claim.sub', v_bidder_id::text, true);
  v_bid_result := public.submit_bid(v_auction_id, 200000, v_request_key);

  if not coalesce((v_bid_result ->> 'ok')::boolean, false)
    or v_bid_result ->> 'code' <> 'BID_ACCEPTED' then
    raise exception 'TEST_BID_FAILED:%', v_bid_result;
  end if;

  -- The deadline race was tested separately. Move only this exact fixture past
  -- its deadline so this test can focus on finalization and order accounting.
  update public.auctions
  set ends_at = now() - interval '1 second'
  where id = v_auction_id;

  v_first_result := public.finalize_one_auction(
    v_auction_id,
    null,
    'manual_winner_order_test'
  );
  v_second_result := public.finalize_one_auction(
    v_auction_id,
    null,
    'manual_winner_order_test_repeat'
  );

  select count(*)::integer into v_result_count
  from public.auction_results
  where auction_id = v_auction_id;

  select count(*)::integer into v_order_count
  from public.orders
  where auction_id = v_auction_id;

  select * into v_order
  from public.orders
  where auction_id = v_auction_id;

  select count(*)::integer into v_winner_notification_count
  from public.notifications
  where user_id = v_bidder_id
    and notification_type = 'auction_won'
    and entity_id = v_order.id::text;

  if v_first_result.auction_id <> v_second_result.auction_id
    or v_result_count <> 1
    or v_order_count <> 1 then
    raise exception 'FINALIZATION_NOT_IDEMPOTENT';
  end if;

  if v_first_result.winner_id <> v_bidder_id
    or v_first_result.winning_amount <> 200000
    or not v_first_result.reserve_met then
    raise exception 'WINNER_RESULT_MISMATCH';
  end if;

  if v_order.winning_amount <> 200000
    or v_order.buyer_fee_rate_bps <> 1000
    or v_order.buyer_fee_amount <> 20000
    or v_order.buyer_fee_vat_rate_bps <> 700
    or v_order.buyer_fee_vat_amount <> 1400
    or v_order.shipping_amount <> 0
    or v_order.total_amount <> 221400
    or v_order.status <> 'pending_payment'
    or v_order.payment_review_state <> 'not_submitted'
    or v_order.payment_due_at < now() + interval '23 hours 59 minutes'
    or v_order.payment_due_at > now() + interval '24 hours 1 minute' then
    raise exception 'ORDER_ACCOUNTING_OR_DEADLINE_MISMATCH';
  end if;

  if v_winner_notification_count <> 1 then
    raise exception 'WINNER_NOTIFICATION_COUNT_MISMATCH:%', v_winner_notification_count;
  end if;
end;
$winner_order_test$;

select
  a.id as auction_id,
  a.status as auction_status,
  ar.winner_id,
  ar.winning_amount,
  ar.reserve_met,
  o.id as order_id,
  o.order_number,
  o.status as order_status,
  o.winning_amount,
  o.buyer_fee_amount,
  o.buyer_fee_vat_amount,
  o.shipping_amount,
  o.total_amount,
  o.payment_due_at,
  o.payment_review_state,
  (select count(*) from public.auction_results x where x.auction_id = a.id) as result_rows,
  (select count(*) from public.orders x where x.auction_id = a.id) as order_rows,
  (select count(*) from public.notifications n
    where n.user_id = ar.winner_id and n.notification_type = 'auction_won') as winner_notifications,
  coalesce((select payment_submission_enabled from public.marketplace_settings where id = 1), false)
    as payment_submission_enabled
from public.auctions a
join public.auction_results ar on ar.auction_id = a.id
join public.orders o on o.auction_id = a.id
where a.id = 'c0260925-0000-4000-8100-000000000001';
