-- Destructive cleanup for the exact deadline-load fixture and 10 test accounts.
-- DO NOT RUN without fresh action-time approval from the user.

do $cleanup$
declare
  v_auction_id constant uuid := 'c0260924-0000-4000-8000-000000000010';
begin
  delete from public.push_deliveries
  where notification_id in (
    select id from public.notifications
    where entity_id = v_auction_id::text
       or entity_id in (select id::text from public.orders where auction_id = v_auction_id)
  );

  delete from public.notifications
  where entity_id = v_auction_id::text
     or entity_id in (select id::text from public.orders where auction_id = v_auction_id);

  delete from public.order_fulfillment_events
  where order_id in (select id from public.orders where auction_id = v_auction_id);
  delete from public.order_shipping_adjustments
  where order_id in (select id from public.orders where auction_id = v_auction_id);
  delete from public.payment_evidence_submissions
  where order_id in (select id from public.orders where auction_id = v_auction_id);
  delete from public.order_payment_expirations
  where order_id in (select id from public.orders where auction_id = v_auction_id);

  delete from public.audit_events
  where (entity_type = 'auction' and entity_id = v_auction_id::text)
     or (entity_type = 'order' and entity_id in (
       select id::text from public.orders where auction_id = v_auction_id
     ));

  delete from public.orders where auction_id = v_auction_id;
  delete from public.auction_results where auction_id = v_auction_id;
  delete from public.bid_attempts where auction_id = v_auction_id;
  delete from public.bids where auction_id = v_auction_id;
  delete from public.auction_media where auction_id = v_auction_id;
  delete from public.auctions where id = v_auction_id;

  delete from auth.users
  where id::text like 'c0260924-0000-4000-9000-0000000000__'
    and email like 'bbk-load-%@example.invalid';
end;
$cleanup$;

select
  (select count(*) from public.auctions where id = 'c0260924-0000-4000-8000-000000000010') as fixture_rows,
  (select count(*) from auth.users where email like 'bbk-load-%@example.invalid') as test_auth_accounts;
