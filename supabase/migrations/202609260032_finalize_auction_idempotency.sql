-- Serialize concurrent finalizers on the auction row, then re-check whether a
-- previous worker committed the result while this worker waited for the lock.

create or replace function public.finalize_one_auction(
  p_auction_id uuid,
  p_actor_id uuid,
  p_source text
)
returns public.auction_results
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auction public.auctions%rowtype;
  v_existing public.auction_results%rowtype;
  v_result public.auction_results%rowtype;
  v_winner public.bids%rowtype;
  v_reserve_met boolean;
  v_order public.orders%rowtype;
  v_fee bigint;
  v_vat bigint;
  v_total bigint;
begin
  select * into v_existing
  from public.auction_results
  where auction_id = p_auction_id;
  if found then return v_existing; end if;

  select * into v_auction
  from public.auctions
  where id = p_auction_id
  for update;

  if not found then raise exception 'AUCTION_NOT_FOUND' using errcode = 'P0001'; end if;

  -- A concurrent worker may have finalized while this worker waited for the
  -- auction row lock. Return that committed result instead of inserting again.
  select * into v_existing
  from public.auction_results
  where auction_id = p_auction_id;
  if found then return v_existing; end if;

  if v_auction.ends_at > now() then raise exception 'AUCTION_NOT_ENDED' using errcode = 'P0001'; end if;
  if v_auction.status not in ('scheduled', 'live', 'ended') then
    raise exception 'AUCTION_CANNOT_BE_FINALIZED' using errcode = 'P0001';
  end if;

  select * into v_winner
  from public.bids
  where auction_id = p_auction_id
  order by amount desc, created_at asc
  limit 1;

  v_reserve_met := v_winner.id is not null
    and (v_auction.reserve_price is null or v_winner.amount >= v_auction.reserve_price);

  insert into public.auction_results (
    auction_id, winner_bid_id, winner_id, winning_amount, reserve_met, finalized_at
  ) values (
    p_auction_id,
    case when v_reserve_met then v_winner.id else null end,
    case when v_reserve_met then v_winner.bidder_id else null end,
    case when v_reserve_met then v_winner.amount else null end,
    v_reserve_met,
    now()
  )
  returning * into v_result;

  if v_reserve_met then
    select buyer_fee_amount, buyer_fee_vat_amount, total_amount
    into v_fee, v_vat, v_total
    from public.calculate_buyer_totals(
      v_winner.amount,
      v_auction.buyer_fee_rate_bps,
      v_auction.buyer_fee_vat_rate_bps
    );

    insert into public.orders (
      auction_id,
      buyer_id,
      seller_id,
      winning_amount,
      buyer_fee_rate_bps,
      buyer_fee_amount,
      buyer_fee_vat_rate_bps,
      buyer_fee_vat_amount,
      shipping_amount,
      payment_due_at,
      status
    ) values (
      p_auction_id,
      v_winner.bidder_id,
      v_auction.seller_id,
      v_winner.amount,
      v_auction.buyer_fee_rate_bps,
      v_fee,
      v_auction.buyer_fee_vat_rate_bps,
      v_vat,
      0,
      now() + interval '24 hours',
      'pending_payment'
    )
    on conflict (auction_id) do nothing
    returning * into v_order;

    if v_order.id is null then
      select * into v_order from public.orders where auction_id = p_auction_id;
    end if;

    insert into public.notifications (
      user_id, notification_type, title, message, entity_type, entity_id, dedupe_key
    ) values (
      v_winner.bidder_id,
      'auction_won',
      'คุณชนะการประมูล',
      'ตรวจสอบยอดชำระและกำหนดเวลาในคำสั่งซื้อ ' || v_order.order_number,
      'order',
      v_order.id::text,
      'auction-won:' || p_auction_id::text
    ) on conflict (dedupe_key) do nothing;
  end if;

  insert into public.notifications (
    user_id, notification_type, title, message, entity_type, entity_id, dedupe_key
  )
  select distinct
    b.bidder_id,
    'auction_lost',
    'การประมูลสิ้นสุดแล้ว',
    'รายการที่คุณเข้าร่วมมีผู้ชนะแล้ว',
    'auction',
    p_auction_id::text,
    'auction-lost:' || p_auction_id::text || ':' || b.bidder_id::text
  from public.bids b
  where b.auction_id = p_auction_id
    and (not v_reserve_met or b.bidder_id <> v_winner.bidder_id)
  on conflict (dedupe_key) do nothing;

  update public.auctions
  set status = 'ended', version = version + 1
  where id = p_auction_id and status in ('scheduled', 'live', 'ended');

  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, payload)
  values (
    p_actor_id,
    'auction.finalized',
    'auction',
    p_auction_id::text,
    jsonb_build_object(
      'source', p_source,
      'winner_bid_id', case when v_reserve_met then v_winner.id else null end,
      'winner_id', case when v_reserve_met then v_winner.bidder_id else null end,
      'winning_amount', case when v_reserve_met then v_winner.amount else null end,
      'buyer_fee_amount', case when v_reserve_met then v_fee else null end,
      'buyer_fee_vat_amount', case when v_reserve_met then v_vat else null end,
      'total_amount', case when v_reserve_met then v_total else null end,
      'order_id', case when v_reserve_met then v_order.id else null end,
      'reserve_met', v_reserve_met,
      'payments_enabled', false
    )
  );

  return v_result;
end;
$$;
