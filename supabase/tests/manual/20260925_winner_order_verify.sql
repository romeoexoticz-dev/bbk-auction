-- Read-only verification for the isolated THB 2,000 winner-order fixture.

with fixture as (
  select
    a.id as auction_id,
    a.status as auction_status,
    ar.winner_id,
    ar.winning_amount as result_winning_amount,
    ar.reserve_met,
    o.id as order_id,
    o.order_number,
    o.status as order_status,
    o.winning_amount as order_winning_amount,
    o.buyer_fee_rate_bps,
    o.buyer_fee_amount,
    o.buyer_fee_vat_rate_bps,
    o.buyer_fee_vat_amount,
    o.shipping_amount,
    o.total_amount,
    o.payment_due_at,
    o.payment_review_state
  from public.auctions a
  join public.auction_results ar on ar.auction_id = a.id
  join public.orders o on o.auction_id = a.id
  where a.id = 'c0260925-0000-4000-8100-000000000001'
)
select
  'ผู้ชนะและยอดประมูล' as test_step,
  coalesce(
    winner_id = 'c0260925-0000-4000-9100-000000000001'::uuid
      and result_winning_amount = 200000
      and reserve_met,
    false
  ) as passed,
  format('winner=%s winning=%s', winner_id, result_winning_amount) as detail
from fixture
union all
select
  'ค่าธรรมเนียม 10% และ VAT 7% ของค่าธรรมเนียม',
  coalesce(
    order_winning_amount = 200000
      and buyer_fee_rate_bps = 1000
      and buyer_fee_amount = 20000
      and buyer_fee_vat_rate_bps = 700
      and buyer_fee_vat_amount = 1400
      and shipping_amount = 0
      and total_amount = 221400,
    false
  ),
  format(
    'winning=%s fee=%s vat=%s shipping=%s total=%s',
    order_winning_amount,
    buyer_fee_amount,
    buyer_fee_vat_amount,
    shipping_amount,
    total_amount
  )
from fixture
union all
select
  'หนึ่งผลประมูลและหนึ่งออเดอร์',
  (select count(*) = 1 from public.auction_results
    where auction_id = 'c0260925-0000-4000-8100-000000000001')
    and
  (select count(*) = 1 from public.orders
    where auction_id = 'c0260925-0000-4000-8100-000000000001'),
  format(
    'results=%s orders=%s',
    (select count(*) from public.auction_results
      where auction_id = 'c0260925-0000-4000-8100-000000000001'),
    (select count(*) from public.orders
      where auction_id = 'c0260925-0000-4000-8100-000000000001')
  )
union all
select
  'สถานะรอชำระและกำหนด 24 ชั่วโมง',
  coalesce(
    order_status = 'pending_payment'
      and payment_review_state = 'not_submitted'
      and payment_due_at > now(),
    false
  ),
  format('status=%s review=%s due=%s', order_status, payment_review_state, payment_due_at)
from fixture
union all
select
  'ระบบรับเงินจริงยังปิด',
  not coalesce((
    select payment_submission_enabled
    from public.marketplace_settings
    where id = 1
  ), false),
  'payment_submission_enabled=' || coalesce((
    select payment_submission_enabled::text
    from public.marketplace_settings
    where id = 1
  ), 'false');

select
  notification_type,
  title,
  message,
  entity_type,
  entity_id,
  created_at
from public.notifications
where user_id = 'c0260925-0000-4000-9100-000000000001'
order by created_at;
