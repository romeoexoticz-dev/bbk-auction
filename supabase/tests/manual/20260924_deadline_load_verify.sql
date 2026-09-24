-- Verifies deadline behavior, ordering, idempotency and the real-payment kill switch.

with fixture as (
  select *
  from public.auctions
  where id = 'c0260924-0000-4000-8000-000000000010'
), fixture_bids as (
  select b.*
  from public.bids b
  where b.auction_id = 'c0260924-0000-4000-8000-000000000010'
), fixture_attempts as (
  select ba.*
  from public.bid_attempts ba
  where ba.auction_id = 'c0260924-0000-4000-8000-000000000010'
)
select
  (select count(*) from auth.users where email like 'bbk-load-%@example.invalid') as auth_accounts,
  (select count(*) from fixture_bids) as accepted_bid_rows,
  (select count(distinct request_key) from fixture_bids) as unique_accepted_requests,
  (select count(*) from fixture_attempts) as total_attempts,
  (select count(*) from fixture_attempts where outcome = 'accepted') as accepted_attempts,
  (select count(*) from fixture_attempts where reason_code in ('AUCTION_OUTSIDE_BIDDING_WINDOW', 'AUCTION_NOT_LIVE')) as deadline_rejections,
  (select count(*) from fixture_attempts where reason_code ilike '%DEADLOCK%') as deadlock_results,
  (select current_price from fixture) as current_price,
  (select bid_count from fixture) as bid_count,
  (select max(amount) from fixture_bids) as highest_stored_bid,
  coalesce((select payment_submission_enabled from public.marketplace_settings where id = 1), false) as payment_submission_enabled;

select
  b.amount,
  p.display_name,
  b.created_at,
  round(extract(epoch from (b.created_at - a.ends_at)) * 1000)::bigint as created_delta_ms
from public.bids b
join public.auctions a on a.id = b.auction_id
join public.profiles p on p.id = b.bidder_id
where b.auction_id = 'c0260924-0000-4000-8000-000000000010'
order by b.created_at;

select
  coalesce(reason_code, 'BID_ACCEPTED') as result_code,
  count(*) as attempts
from public.bid_attempts
where auction_id = 'c0260924-0000-4000-8000-000000000010'
group by coalesce(reason_code, 'BID_ACCEPTED')
order by result_code;
