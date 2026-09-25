-- Public, privacy-preserving bid history for customer auction pages.
-- The function never returns a bidder UUID, profile, email, phone or request key.

create or replace function public.get_public_bid_history(
  p_auction_id uuid,
  p_limit integer default 20
)
returns table (
  bid_sequence bigint,
  bidder_alias text,
  amount bigint,
  created_at timestamptz,
  is_current_user boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with eligible_bids as (
    select bid.id, bid.bidder_id, bid.amount, bid.created_at
    from public.bids as bid
    join public.auctions as auction on auction.id = bid.auction_id
    where bid.auction_id = p_auction_id
      and auction.status in ('live', 'ended', 'settled')
  ),
  participants as (
    select
      eligible_bid.bidder_id,
      row_number() over (
        order by min(eligible_bid.created_at), eligible_bid.bidder_id
      ) as alias_number
    from eligible_bids as eligible_bid
    group by eligible_bid.bidder_id
  ),
  numbered_bids as (
    select
      row_number() over (
        order by eligible_bid.created_at, eligible_bid.id
      ) as bid_sequence,
      'ผู้ประมูล #' || participant.alias_number::text as bidder_alias,
      eligible_bid.amount,
      eligible_bid.created_at,
      coalesce(eligible_bid.bidder_id = auth.uid(), false) as is_current_user
    from eligible_bids as eligible_bid
    join participants as participant on participant.bidder_id = eligible_bid.bidder_id
  )
  select
    numbered_bid.bid_sequence,
    numbered_bid.bidder_alias,
    numbered_bid.amount,
    numbered_bid.created_at,
    numbered_bid.is_current_user
  from numbered_bids as numbered_bid
  order by numbered_bid.created_at desc, numbered_bid.bid_sequence desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

revoke all on function public.get_public_bid_history(uuid, integer) from public;
grant execute on function public.get_public_bid_history(uuid, integer) to anon, authenticated;

do $verification$
begin
  if not has_function_privilege('anon', 'public.get_public_bid_history(uuid, integer)', 'EXECUTE') then
    raise exception 'ANON_PUBLIC_BID_HISTORY_ACCESS_NOT_INSTALLED';
  end if;

  if has_table_privilege('anon', 'public.bids', 'SELECT') then
    raise exception 'ANON_MUST_NOT_READ_RAW_BIDS';
  end if;
end;
$verification$;

insert into public.audit_events (actor_id, event_type, entity_type, entity_id, payload)
select
  null,
  'auction.public_bid_history_enabled',
  'system',
  'public-bid-history',
  jsonb_build_object(
    'exposed_fields', jsonb_build_array('bid_sequence', 'bidder_alias', 'amount', 'created_at', 'is_current_user'),
    'personal_data_exposed', false,
    'maximum_rows', 50,
    'approved_on', '2026-09-25'
  )
where not exists (
  select 1
  from public.audit_events
  where event_type = 'auction.public_bid_history_enabled'
    and entity_type = 'system'
    and entity_id = 'public-bid-history'
);
