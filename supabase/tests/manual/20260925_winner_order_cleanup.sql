-- Destructive cleanup for exactly one winner-order fixture and one test user.
-- DO NOT RUN without fresh action-time approval from the user.

do $cleanup$
declare
  v_auction_id constant uuid := 'c0260925-0000-4000-8100-000000000001';
  v_bidder_id constant uuid := 'c0260925-0000-4000-9100-000000000001';
  v_email constant text := 'bbk-winner-order-01@example.invalid';
begin
  if exists (
    select 1
    from auth.users
    where id = v_bidder_id and email <> v_email
  ) then
    raise exception 'CLEANUP_IDENTITY_GUARD_FAILED';
  end if;

  delete from public.push_deliveries
  where user_id = v_bidder_id
     or notification_id in (
       select id from public.notifications
       where entity_id = v_auction_id::text
          or entity_id in (
            select id::text from public.orders where auction_id = v_auction_id
          )
     );

  delete from public.notifications
  where user_id = v_bidder_id
     or entity_id = v_auction_id::text
     or entity_id in (
       select id::text from public.orders where auction_id = v_auction_id
     );

  delete from public.order_fulfillment_events
  where order_id in (select id from public.orders where auction_id = v_auction_id);

  delete from public.order_shipping_adjustments
  where order_id in (select id from public.orders where auction_id = v_auction_id);

  delete from public.payment_evidence_submissions
  where order_id in (select id from public.orders where auction_id = v_auction_id);

  delete from public.order_payment_expirations
  where order_id in (select id from public.orders where auction_id = v_auction_id);

  delete from public.payment_default_cases
  where user_id = v_bidder_id
     or last_expired_order_id in (
       select id from public.orders where auction_id = v_auction_id
     );

  delete from public.audit_events
  where actor_id = v_bidder_id
     or (entity_type = 'auction' and entity_id = v_auction_id::text)
     or (entity_type = 'order' and entity_id in (
       select id::text from public.orders where auction_id = v_auction_id
     ))
     or (entity_type = 'profile' and entity_id = v_bidder_id::text);

  delete from public.orders where auction_id = v_auction_id;
  delete from public.auction_results where auction_id = v_auction_id;
  delete from public.bid_attempts where auction_id = v_auction_id or bidder_id = v_bidder_id;
  delete from public.bids where auction_id = v_auction_id or bidder_id = v_bidder_id;
  delete from public.auction_media where auction_id = v_auction_id;
  delete from public.auctions where id = v_auction_id;

  delete from auth.users
  where id = v_bidder_id and email = v_email;
end;
$cleanup$;

select
  (select count(*) from public.auctions
    where id = 'c0260925-0000-4000-8100-000000000001') as fixture_rows,
  (select count(*) from auth.users
    where id = 'c0260925-0000-4000-9100-000000000001'
      and email = 'bbk-winner-order-01@example.invalid') as test_auth_accounts,
  (select count(*) from public.profiles
    where id = 'c0260925-0000-4000-9100-000000000001') as test_profiles,
  (select count(*) from public.bids
    where auction_id = 'c0260925-0000-4000-8100-000000000001') as bid_rows,
  (select count(*) from public.orders
    where auction_id = 'c0260925-0000-4000-8100-000000000001') as order_rows;
