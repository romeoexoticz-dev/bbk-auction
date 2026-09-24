-- Manual test fixture only. Do not include this file in production migrations.
-- Creates one clearly-labelled live auction for verifying bid rate limits.

begin;

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
  bid_count,
  version,
  review_notes,
  reviewed_by,
  reviewed_at,
  buyer_fee_rate_bps,
  buyer_fee_vat_rate_bps
)
values (
  '7a14e383-5eea-4af5-a9e2-76d69c381832',
  'f81931b8-c802-4e1e-be4a-ba59d88b6fb6',
  'ทดสอบระบบกันกดรัว 1,000 บาท — ไม่ขายจริง',
  'รายการทดสอบชั่วคราวสำหรับตรวจการจำกัด 2 วินาทีและ 10 ครั้งต่อนาที ไม่มีการขายหรือเรียกเก็บเงินจริง',
  'ของเก่า',
  'live',
  100000,
  100000,
  5000,
  null,
  now() - interval '1 minute',
  now() + interval '10 minutes',
  0,
  0,
  0,
  0,
  'คุณตาลอนุมัติสร้างเพื่อทดสอบระบบกันกดรัวเท่านั้น',
  'f81931b8-c802-4e1e-be4a-ba59d88b6fb6',
  now(),
  1000,
  700
)
on conflict (id) do nothing;

insert into public.audit_events (actor_id, event_type, entity_type, entity_id, payload)
select
  'f81931b8-c802-4e1e-be4a-ba59d88b6fb6',
  'auction.rate_limit_test_created',
  'auction',
  '7a14e383-5eea-4af5-a9e2-76d69c381832',
  jsonb_build_object(
    'opening_price', 100000,
    'duration_minutes', 10,
    'payments_enabled', false,
    'purpose', 'bid_rate_limit_manual_test'
  )
where exists (
  select 1 from public.auctions
  where id = '7a14e383-5eea-4af5-a9e2-76d69c381832'
)
and not exists (
  select 1 from public.audit_events
  where event_type = 'auction.rate_limit_test_created'
    and entity_id = '7a14e383-5eea-4af5-a9e2-76d69c381832'
);

commit;

select id, title, status, opening_price, current_price, starts_at, ends_at
from public.auctions
where id = '7a14e383-5eea-4af5-a9e2-76d69c381832';
