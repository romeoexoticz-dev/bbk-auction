-- Safe production verification for 202609290035_admin_bid_notifications.sql.
-- The synthetic bid and its notification are rolled back before this script ends.

begin;

select set_config('app.test_bid_id', gen_random_uuid()::text, true);

with source_bid as (
  select
    a.id as auction_id,
    bidder.id as bidder_id,
    a.seller_id,
    a.current_price + 10000 as test_amount
  from public.auctions a
  cross join lateral (
    select p.id
    from public.profiles p
    where p.id <> a.seller_id
      and p.account_status = 'active'
    order by p.created_at asc
    limit 1
  ) bidder
  order by a.created_at desc
  limit 1
)
insert into public.bids (
  id,
  auction_id,
  bidder_id,
  amount,
  request_key,
  created_at
)
select
  current_setting('app.test_bid_id')::uuid,
  sb.auction_id,
  sb.bidder_id,
  sb.test_amount,
  gen_random_uuid(),
  clock_timestamp()
from source_bid sb;

select
  current_setting('app.test_bid_id')::uuid as synthetic_bid_id,
  n.entity_id::uuid as auction_id,
  count(n.id) as matching_notification_count,
  min(n.notification_type) as notification_type,
  min(n.title) as notification_title,
  min(n.message) as notification_message
from public.notifications n
where n.dedupe_key like
  'bid-received:' || current_setting('app.test_bid_id') || ':%'
group by n.entity_id;

rollback;
