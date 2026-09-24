-- Deletes only the isolated fixture created by 20260924_concurrent_bid_setup.sql.

do $$
declare
  v_auction_id constant uuid := 'c0260924-0000-4000-8000-000000000001';
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
end;
$$;

select not exists (
  select 1 from public.auctions
  where id = 'c0260924-0000-4000-8000-000000000001'
) as fixture_removed;
