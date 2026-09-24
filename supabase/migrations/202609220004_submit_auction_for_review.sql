-- Idempotent seller transition: draft/rejected -> pending_review.

create or replace function public.submit_auction_for_review(p_auction_id uuid)
returns public.auction_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seller_id uuid := auth.uid();
  v_auction public.auctions;
begin
  if v_seller_id is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  if not public.has_role('seller', v_seller_id) then
    raise exception using errcode = '42501', message = 'SELLER_ROLE_REQUIRED';
  end if;

  select * into v_auction
  from public.auctions
  where id = p_auction_id
  for update;

  if v_auction.id is null or v_auction.seller_id <> v_seller_id then
    raise exception using errcode = 'P0002', message = 'AUCTION_NOT_FOUND';
  end if;

  if v_auction.status = 'pending_review' then
    return v_auction.status;
  end if;

  if v_auction.status not in ('draft', 'rejected') then
    raise exception using errcode = '22023', message = 'INVALID_AUCTION_STATE';
  end if;

  update public.auctions
  set status = 'pending_review', version = version + 1
  where id = p_auction_id
  returning * into v_auction;

  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, payload)
  values (
    v_seller_id,
    'auction.submitted_for_review',
    'auction',
    v_auction.id::text,
    jsonb_build_object(
      'from_status', 'draft',
      'to_status', v_auction.status,
      'version', v_auction.version,
      'payments_enabled', false
    )
  );

  return v_auction.status;
end;
$$;

revoke all on function public.submit_auction_for_review(uuid) from public, anon;
grant execute on function public.submit_auction_for_review(uuid) to authenticated;

