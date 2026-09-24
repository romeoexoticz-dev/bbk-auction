-- Seller-owned edits for draft/rejected auctions with no bids.

create or replace function public.update_auction_draft(
  p_auction_id uuid,
  p_title text,
  p_description text,
  p_category text,
  p_opening_price bigint,
  p_min_increment bigint,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
returns public.auctions
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

  if not exists (
    select 1 from public.seller_profiles
    where user_id = v_seller_id and status = 'approved'
  ) then
    raise exception using errcode = '42501', message = 'SELLER_APPROVAL_REQUIRED';
  end if;

  select * into v_auction
  from public.auctions
  where id = p_auction_id
  for update;

  if v_auction.id is null or v_auction.seller_id <> v_seller_id then
    raise exception using errcode = 'P0002', message = 'AUCTION_NOT_FOUND';
  end if;

  if v_auction.status not in ('draft', 'rejected') then
    raise exception using errcode = '22023', message = 'INVALID_AUCTION_STATE';
  end if;

  if v_auction.bid_count <> 0 or exists (
    select 1 from public.bids where auction_id = p_auction_id
  ) then
    raise exception using errcode = '22023', message = 'AUCTION_HAS_BIDS';
  end if;

  if char_length(trim(coalesce(p_title, ''))) not between 3 and 160 then
    raise exception using errcode = '22023', message = 'INVALID_TITLE';
  end if;

  if char_length(trim(coalesce(p_description, ''))) not between 20 and 5000 then
    raise exception using errcode = '22023', message = 'INVALID_DESCRIPTION';
  end if;

  if p_category not in ('เหรียญกษาปณ์', 'ธนบัตร', 'พระเครื่อง', 'การ์ดสะสม', 'ของเก่า') then
    raise exception using errcode = '22023', message = 'INVALID_CATEGORY';
  end if;

  if p_opening_price is null or p_opening_price <= 0
    or p_min_increment is null or p_min_increment <= 0 then
    raise exception using errcode = '22023', message = 'INVALID_PRICE';
  end if;

  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception using errcode = '22023', message = 'INVALID_AUCTION_WINDOW';
  end if;

  update public.auctions
  set title = trim(p_title),
      description = trim(p_description),
      category = p_category,
      opening_price = p_opening_price,
      current_price = p_opening_price,
      min_increment = p_min_increment,
      starts_at = p_starts_at,
      ends_at = p_ends_at,
      version = version + 1
  where id = p_auction_id
  returning * into v_auction;

  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, payload)
  values (
    v_seller_id,
    'auction.draft_updated',
    'auction',
    v_auction.id::text,
    jsonb_build_object(
      'status', v_auction.status,
      'category', v_auction.category,
      'opening_price', v_auction.opening_price,
      'min_increment', v_auction.min_increment,
      'starts_at', v_auction.starts_at,
      'ends_at', v_auction.ends_at,
      'version', v_auction.version,
      'payments_enabled', false
    )
  );

  return v_auction;
end;
$$;

revoke all on function public.update_auction_draft(uuid, text, text, text, bigint, bigint, timestamptz, timestamptz)
from public, anon;

grant execute on function public.update_auction_draft(uuid, text, text, text, bigint, bigint, timestamptz, timestamptz)
to authenticated;
