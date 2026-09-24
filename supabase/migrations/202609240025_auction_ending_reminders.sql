-- One in-app reminder per participating bidder when a live auction has
-- 15 minutes or less remaining. Database time is authoritative.

create or replace function public.send_auction_ending_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted integer := 0;
begin
  insert into public.notifications (
    user_id,
    notification_type,
    title,
    message,
    entity_type,
    entity_id,
    dedupe_key
  )
  select
    participant.bidder_id,
    'auction_ending_soon',
    'ใกล้หมดเวลาประมูล',
    left(
      'รายการ “' || auction.title || '” จะปิดในไม่เกิน 15 นาที ตรวจราคาล่าสุดก่อนหมดเวลา',
      1000
    ),
    'auction',
    auction.id::text,
    'auction-ending-soon:' || auction.id::text || ':' || participant.bidder_id::text
  from public.auctions auction
  join (
    select distinct bid.auction_id, bid.bidder_id
    from public.bids bid
  ) participant on participant.auction_id = auction.id
  where auction.status = 'live'
    and auction.ends_at > now()
    and auction.ends_at <= now() + interval '15 minutes'
  on conflict (dedupe_key) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

revoke all on function public.send_auction_ending_reminders() from public, anon, authenticated;

select cron.schedule(
  'bbk-auction-ending-reminders',
  '* * * * *',
  'select public.send_auction_ending_reminders();'
);

-- Catch auctions already inside the reminder window at installation time.
select public.send_auction_ending_reminders();

insert into public.audit_events (actor_id, event_type, entity_type, entity_id, payload)
values (
  null,
  'notifications.auction_ending_reminders_installed',
  'system',
  'bbk-auction-ending-reminders',
  jsonb_build_object(
    'schedule', 'every_minute',
    'window_minutes', 15,
    'delivery', 'in_app',
    'recipients', 'participating_bidders',
    'dedupe', 'once_per_auction_per_bidder',
    'time_source', 'database'
  )
);
