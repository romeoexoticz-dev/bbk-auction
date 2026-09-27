-- Allow signed-out visitors to receive live auction prices without exposing
-- bidder ids, seller ids, reserve prices, or any other private row fields.

create or replace function public.broadcast_auction_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auction_id uuid;
  v_new_record jsonb := null;
  v_old_record jsonb := null;
begin
  if tg_op = 'DELETE' then
    v_auction_id := old.id;
    v_old_record := jsonb_build_object(
      'id', old.id,
      'status', old.status,
      'current_price', old.current_price,
      'bid_count', old.bid_count,
      'starts_at', old.starts_at,
      'ends_at', old.ends_at,
      'version', old.version,
      'updated_at', old.updated_at
    );
  else
    v_auction_id := new.id;
    v_new_record := jsonb_build_object(
      'id', new.id,
      'status', new.status,
      'current_price', new.current_price,
      'bid_count', new.bid_count,
      'starts_at', new.starts_at,
      'ends_at', new.ends_at,
      'version', new.version,
      'updated_at', new.updated_at
    );

    if tg_op = 'UPDATE' then
      v_old_record := jsonb_build_object(
        'id', old.id,
        'status', old.status,
        'current_price', old.current_price,
        'bid_count', old.bid_count,
        'starts_at', old.starts_at,
        'ends_at', old.ends_at,
        'version', old.version,
        'updated_at', old.updated_at
      );
    end if;
  end if;

  perform realtime.send(
    jsonb_build_object(
      'event', tg_op,
      'type', tg_op,
      'table', tg_table_name,
      'schema', tg_table_schema,
      'record', v_new_record,
      'old_record', v_old_record
    ),
    tg_op,
    'auction:' || v_auction_id::text,
    true
  );

  return coalesce(new, old);
end;
$$;

-- An accepted bid always updates public.auctions in the same transaction.
-- Broadcasting the bid row as well is redundant and could reveal bidder_id.
drop trigger if exists bids_broadcast_after_change on public.bids;
drop function if exists public.broadcast_bid_change();

drop policy if exists "anonymous receive published auction broadcasts" on realtime.messages;
create policy "anonymous receive published auction broadcasts"
on realtime.messages for select to anon
using (
  extension = 'broadcast'
  and realtime.topic() like 'auction:%'
  and exists (
    select 1
    from public.auctions a
    where 'auction:' || a.id::text = realtime.topic()
      and a.status in ('scheduled', 'live', 'ended', 'settled')
  )
);

insert into public.audit_events (actor_id, event_type, entity_type, entity_id, payload)
values (
  null,
  'auction.public_realtime_enabled',
  'system',
  'public-safe-auction-realtime',
  jsonb_build_object(
    'channel', 'private_broadcast',
    'anonymous_read', true,
    'payload', jsonb_build_array('id', 'status', 'current_price', 'bid_count', 'starts_at', 'ends_at', 'version', 'updated_at'),
    'bid_rows_broadcast', false,
    'installed_at', now()
  )
);
