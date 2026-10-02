-- Notify the bidder immediately after every accepted bid. The existing
-- submit_bid function separately notifies the previous leader when outbid.
-- A trigger keeps this behavior attached to the committed bid row and makes
-- retries idempotent through the notification dedupe key.

create or replace function public.notify_bidder_on_bid_accepted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auction_title text;
  v_formatted_amount text;
begin
  select a.title
  into v_auction_title
  from public.auctions a
  where a.id = new.auction_id;

  if v_auction_title is null then
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
    new.bidder_id,
    'bid_accepted',
    'รับราคาของคุณแล้ว · คุณกำลังนำ',
    left(
      'รายการ “' || v_auction_title || '” รับราคาของคุณ ฿' || v_formatted_amount ||
      ' แล้ว หากมีผู้เสนอสูงกว่า ระบบจะแจ้งอีกครั้ง',
      1000
    ),
    'auction',
    new.auction_id::text,
    'bid-accepted:' || new.id::text || ':' || new.bidder_id::text
  )
  on conflict (dedupe_key) do nothing;

  return new;
end;
$$;

drop trigger if exists bids_notify_bidder_after_insert on public.bids;
create trigger bids_notify_bidder_after_insert
after insert on public.bids
for each row execute function public.notify_bidder_on_bid_accepted();

revoke all on function public.notify_bidder_on_bid_accepted() from public, anon, authenticated;

insert into public.audit_events (
  actor_id,
  event_type,
  entity_type,
  entity_id,
  payload
)
select
  null,
  'notifications.bidder_bid_accepted_installed',
  'system',
  'bidder-bid-accepted',
  jsonb_build_object(
    'delivery', 'private_realtime_broadcast',
    'per_accepted_bid', true,
    'outbid_notification_preserved', true,
    'bidder_identity_exposed', false,
    'approved_by', 'คุณตาล',
    'approved_on', '2026-10-02'
  )
where not exists (
  select 1
  from public.audit_events ae
  where ae.event_type = 'notifications.bidder_bid_accepted_installed'
    and ae.entity_type = 'system'
    and ae.entity_id = 'bidder-bid-accepted'
);
