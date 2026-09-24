-- Close ended auctions from database time and record one deterministic result.
-- No order or payment is created: real-money checkout remains disabled.

create or replace function public.close_due_auctions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auction public.auctions%rowtype;
  v_winner public.bids%rowtype;
  v_reserve_met boolean;
  v_version bigint;
  v_closed integer := 0;
begin
  for v_auction in
    select *
    from public.auctions
    where status in ('scheduled', 'live')
      and ends_at <= now()
    order by ends_at asc
    for update skip locked
  loop
    select * into v_winner
    from public.bids
    where auction_id = v_auction.id
    order by amount desc, created_at asc
    limit 1;

    v_reserve_met := v_winner.id is not null
      and (v_auction.reserve_price is null or v_winner.amount >= v_auction.reserve_price);

    insert into public.auction_results (
      auction_id,
      winner_bid_id,
      winner_id,
      winning_amount,
      reserve_met,
      finalized_at
    ) values (
      v_auction.id,
      v_winner.id,
      case when v_reserve_met then v_winner.bidder_id else null end,
      case when v_reserve_met then v_winner.amount else null end,
      v_reserve_met,
      now()
    )
    on conflict (auction_id) do nothing;

    update public.auctions
    set status = 'ended',
        version = version + 1
    where id = v_auction.id
      and status in ('scheduled', 'live')
      and ends_at <= now()
    returning version into v_version;

    if found then
      insert into public.audit_events (actor_id, event_type, entity_type, entity_id, payload)
      values (
        null,
        'auction.closed_automatically',
        'auction',
        v_auction.id::text,
        jsonb_build_object(
          'from_status', v_auction.status,
          'to_status', 'ended',
          'ends_at', v_auction.ends_at,
          'winner_bid_id', case when v_reserve_met then v_winner.id else null end,
          'winner_id', case when v_reserve_met then v_winner.bidder_id else null end,
          'winning_amount', case when v_reserve_met then v_winner.amount else null end,
          'reserve_met', v_reserve_met,
          'bid_count', v_auction.bid_count,
          'version', v_version,
          'source', 'database_time',
          'payments_enabled', false
        )
      );
      v_closed := v_closed + 1;
    end if;
  end loop;

  return v_closed;
end;
$$;

revoke all on function public.close_due_auctions() from public;
grant execute on function public.close_due_auctions() to anon, authenticated;

select cron.schedule(
  'bbk-close-due-auctions',
  '* * * * *',
  'select public.close_due_auctions();'
);

-- Close any already-ended auction immediately when this migration is applied.
select public.close_due_auctions();
