-- Seller draft creation is server-authoritative and always starts in `draft`.
-- Proposed dates are editable draft data; publishing remains an admin action.

create or replace function public.create_auction_draft(
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
    select 1
    from public.seller_profiles sp
    where sp.user_id = v_seller_id and sp.status = 'approved'
  ) then
    raise exception using errcode = '42501', message = 'SELLER_APPROVAL_REQUIRED';
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

  insert into public.auctions (
    seller_id,
    title,
    description,
    category,
    status,
    opening_price,
    current_price,
    min_increment,
    starts_at,
    ends_at
  )
  values (
    v_seller_id,
    trim(p_title),
    trim(p_description),
    p_category,
    'draft',
    p_opening_price,
    p_opening_price,
    p_min_increment,
    p_starts_at,
    p_ends_at
  )
  returning * into v_auction;

  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, payload)
  values (
    v_seller_id,
    'auction.draft_created',
    'auction',
    v_auction.id::text,
    jsonb_build_object(
      'status', v_auction.status,
      'category', v_auction.category,
      'opening_price', v_auction.opening_price,
      'min_increment', v_auction.min_increment,
      'payments_enabled', false
    )
  );

  return v_auction;
end;
$$;

revoke all on function public.create_auction_draft(text, text, text, bigint, bigint, timestamptz, timestamptz)
from public, anon;

grant execute on function public.create_auction_draft(text, text, text, bigint, bigint, timestamptz, timestamptz)
to authenticated;

