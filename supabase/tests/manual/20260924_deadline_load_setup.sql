-- Creates 10 disposable Auth bidders and one isolated auction fixture.
-- Test-only identities use the reserved example.invalid domain and random,
-- undisclosed passwords. No email or SMS is sent.

do $setup$
declare
  v_auction_id constant uuid := 'c0260924-0000-4000-8000-000000000010';
  v_instance_id constant uuid := '00000000-0000-0000-0000-000000000000';
  v_seller_id uuid;
  v_user_id uuid;
  v_email text;
  v_index integer;
begin
  if exists (select 1 from public.auctions where id = v_auction_id) then
    raise exception 'DEADLINE_LOAD_FIXTURE_ALREADY_EXISTS';
  end if;

  if exists (
    select 1
    from auth.users
    where id::text like 'c0260924-0000-4000-9000-0000000000__'
       or email like 'bbk-load-%@example.invalid'
  ) then
    raise exception 'DEADLINE_LOAD_TEST_ACCOUNTS_ALREADY_EXIST';
  end if;

  select sp.user_id into v_seller_id
  from public.seller_profiles sp
  where sp.status = 'approved'
  order by sp.created_at
  limit 1;

  if v_seller_id is null then
    raise exception 'APPROVED_SELLER_NOT_FOUND';
  end if;

  for v_index in 1..10 loop
    v_user_id := (
      'c0260924-0000-4000-9000-' || lpad(v_index::text, 12, '0')
    )::uuid;
    v_email := format('bbk-load-%s@example.invalid', lpad(v_index::text, 2, '0'));

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
      v_user_id,
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
      jsonb_build_object('display_name', format('[TEST-LOAD] bidder %s', lpad(v_index::text, 2, '0'))),
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
      v_user_id::text,
      v_user_id,
      jsonb_build_object('sub', v_user_id::text, 'email', v_email, 'email_verified', true),
      'email',
      null,
      clock_timestamp(),
      clock_timestamp()
    );

    update public.profiles
    set display_name = format('[TEST-LOAD] bidder %s', lpad(v_index::text, 2, '0')),
        account_status = 'active',
        email_verified = true
    where id = v_user_id;

    insert into public.role_assignments (user_id, role_name)
    values (v_user_id, 'bidder')
    on conflict (user_id, role_name) do nothing;

    insert into public.bidder_verifications (
      user_id,
      status,
      review_reason,
      reviewed_at
    ) values (
      v_user_id,
      'approved',
      'Temporary approved bidder for deadline load testing only',
      clock_timestamp()
    )
    on conflict (user_id) do update
    set status = excluded.status,
        review_reason = excluded.review_reason,
        reviewed_at = excluded.reviewed_at;
  end loop;

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
    '[TEST-LOAD] Deadline concurrency ' || to_char(clock_timestamp(), 'YYYY-MM-DD HH24:MI:SS'),
    'Disposable deadline load-test fixture. Never visible to customers after cleanup.',
    'ธนบัตร',
    'draft',
    100000,
    100000,
    5000,
    99999999,
    clock_timestamp() - interval '1 minute',
    clock_timestamp() + interval '45 seconds',
    0,
    0,
    'ทดสอบ',
    'ชุดทดสอบโหลดใกล้หมดเวลา',
    'ไม่ใช่สินค้าจริง',
    'ข้อมูลจำลองสำหรับทดสอบระบบเท่านั้น',
    'ห้ามนำรายการนี้ไปแสดงหรือใช้ขายจริง'
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
end;
$setup$;

select
  (select count(*) from auth.users where email like 'bbk-load-%@example.invalid') as auth_accounts,
  (select count(*) from public.bidder_verifications bv
    join public.profiles p on p.id = bv.user_id
    where p.display_name like '[TEST-LOAD]%' and bv.status = 'approved') as approved_bidders,
  a.id as auction_id,
  a.starts_at,
  a.ends_at,
  a.current_price,
  a.bid_count
from public.auctions a
where a.id = 'c0260924-0000-4000-8000-000000000010';
