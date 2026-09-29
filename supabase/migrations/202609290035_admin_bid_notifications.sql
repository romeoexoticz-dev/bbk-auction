-- Notify the auction owner after every accepted bid. Rejected or rate-limited
-- attempts never insert into public.bids, so they cannot create notifications.

create or replace function public.notify_seller_on_bid_received()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seller_id uuid;
  v_auction_title text;
  v_formatted_amount text;
begin
  select a.seller_id, a.title
  into v_seller_id, v_auction_title
  from public.auctions a
  where a.id = new.auction_id;

  -- Do not notify a missing owner or echo a self-bid back to the same account.
  if v_seller_id is null or v_seller_id = new.bidder_id then
    return new;
  end if;

  v_formatted_amount := trim(to_char(new.amount / 100.0, 'FM999999999999990.00'));

  insert into public.notifications (
    user_id,
    notification_type,
    title,
    message,
    entity_type,
    entity_id,
    dedupe_key
  ) values (
    v_seller_id,
    'bid_received',
    'มีผู้เสนอราคาใหม่',
    left(
      'รายการ “' || v_auction_title || '” มีราคาใหม่ ฿' || v_formatted_amount,
      1000
    ),
    'auction',
    new.auction_id::text,
    'bid-received:' || new.id::text || ':' || v_seller_id::text
  )
  on conflict (dedupe_key) do nothing;

  return new;
end;
$$;

drop trigger if exists bids_notify_seller_after_insert on public.bids;
create trigger bids_notify_seller_after_insert
after insert on public.bids
for each row execute function public.notify_seller_on_bid_received();

revoke all on function public.notify_seller_on_bid_received() from public, anon, authenticated;

insert into public.audit_events (
  actor_id,
  event_type,
  entity_type,
  entity_id,
  payload
)
select
  null,
  'notifications.admin_bid_received_installed',
  'system',
  'admin-bid-received',
  jsonb_build_object(
    'recipient', 'auction_seller',
    'delivery', 'private_realtime_broadcast',
    'per_accepted_bid', true,
    'bidder_identity_exposed', false,
    'approved_by', 'คุณตาล',
    'approved_on', '2026-09-29'
  )
where not exists (
  select 1
  from public.audit_events ae
  where ae.event_type = 'notifications.admin_bid_received_installed'
    and ae.entity_type = 'system'
    and ae.entity_id = 'admin-bid-received'
);
