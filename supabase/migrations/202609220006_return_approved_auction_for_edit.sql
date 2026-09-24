-- Controlled admin correction for an approved auction that has no bids.

create or replace function public.return_approved_auction_for_edit(
  p_auction_id uuid,
  p_reason text
)
returns public.auction_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_id uuid := auth.uid();
  v_auction public.auctions;
  v_from_status public.auction_status;
begin
  if v_admin_id is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  if not public.has_role('admin', v_admin_id) then
    raise exception using errcode = '42501', message = 'ADMIN_ROLE_REQUIRED';
  end if;

  if char_length(trim(coalesce(p_reason, ''))) not between 5 and 500 then
    raise exception using errcode = '22023', message = 'REVIEW_REASON_REQUIRED';
  end if;

  select * into v_auction
  from public.auctions
  where id = p_auction_id
  for update;

  if v_auction.id is null then
    raise exception using errcode = 'P0002', message = 'AUCTION_NOT_FOUND';
  end if;

  if v_auction.status = 'rejected' then
    return v_auction.status;
  end if;

  if v_auction.status not in ('scheduled', 'live') then
    raise exception using errcode = '22023', message = 'INVALID_AUCTION_STATE';
  end if;

  if v_auction.bid_count <> 0 or exists (
    select 1 from public.bids where auction_id = p_auction_id
  ) then
    raise exception using errcode = '22023', message = 'AUCTION_HAS_BIDS';
  end if;

  if exists (
    select 1 from public.auction_results where auction_id = p_auction_id
  ) or exists (
    select 1 from public.orders where auction_id = p_auction_id
  ) then
    raise exception using errcode = '22023', message = 'AUCTION_ALREADY_FINALIZED';
  end if;

  v_from_status := v_auction.status;

  update public.auctions
  set status = 'rejected',
      review_notes = trim(p_reason),
      reviewed_by = v_admin_id,
      reviewed_at = now(),
      version = version + 1
  where id = p_auction_id
  returning * into v_auction;

  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, payload)
  values (
    v_admin_id,
    'auction.returned_for_edit',
    'auction',
    v_auction.id::text,
    jsonb_build_object(
      'from_status', v_from_status,
      'to_status', v_auction.status,
      'reason', trim(p_reason),
      'bid_count', v_auction.bid_count,
      'version', v_auction.version,
      'payments_enabled', false
    )
  );

  return v_auction.status;
end;
$$;

revoke all on function public.return_approved_auction_for_edit(uuid, text) from public, anon;
grant execute on function public.return_approved_auction_for_edit(uuid, text) to authenticated;
