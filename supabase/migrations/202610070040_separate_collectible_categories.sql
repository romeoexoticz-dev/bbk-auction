-- Keep customer-facing categories distinct and correct the three imported
-- reference lots that were grouped under trading cards.

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
    select 1 from public.seller_profiles sp
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
  if p_category not in ('เหรียญกษาปณ์', 'ธนบัตร', 'พระเครื่อง', 'การ์ดสะสม', 'ของเล่น', 'ของเก่า') then
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
    seller_id, title, description, category, status, opening_price,
    current_price, min_increment, starts_at, ends_at
  ) values (
    v_seller_id, trim(p_title), trim(p_description), p_category, 'draft',
    p_opening_price, p_opening_price, p_min_increment, p_starts_at, p_ends_at
  ) returning * into v_auction;

  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, payload)
  values (
    v_seller_id, 'auction.draft_created', 'auction', v_auction.id::text,
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
  if p_category not in ('เหรียญกษาปณ์', 'ธนบัตร', 'พระเครื่อง', 'การ์ดสะสม', 'ของเล่น', 'ของเก่า') then
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
    v_seller_id, 'auction.draft_updated', 'auction', v_auction.id::text,
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

alter table public.auction_interest_preferences
  drop constraint if exists auction_interest_preferences_category_check;

alter table public.auction_interest_preferences
  add constraint auction_interest_preferences_category_check
  check (category in ('เหรียญกษาปณ์', 'ธนบัตร', 'พระเครื่อง', 'การ์ดสะสม', 'ของเล่น', 'ของเก่า'));

create or replace function public.set_my_auction_interests(p_categories text[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_categories text[];
  v_previous text[];
  v_count integer;
  v_audit_id bigint;
  v_display_name text;
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;

  select coalesce(array_agg(item.category order by item.category), '{}'::text[])
  into v_categories
  from (select distinct unnest(coalesce(p_categories, '{}'::text[])) as category) item;

  if cardinality(v_categories) > 6 then raise exception 'TOO_MANY_CATEGORIES' using errcode = 'P0001'; end if;
  if exists (
    select 1 from unnest(v_categories) item(category)
    where item.category is null
      or item.category not in ('เหรียญกษาปณ์', 'ธนบัตร', 'พระเครื่อง', 'การ์ดสะสม', 'ของเล่น', 'ของเก่า')
  ) then raise exception 'INVALID_CATEGORY' using errcode = 'P0001'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text, 0));

  select coalesce(array_agg(aip.category order by aip.category), '{}'::text[])
  into v_previous
  from public.auction_interest_preferences aip
  where aip.user_id = v_user_id;

  if v_previous = v_categories then return cardinality(v_categories); end if;

  delete from public.auction_interest_preferences aip
  where aip.user_id = v_user_id and not (aip.category = any(v_categories));

  insert into public.auction_interest_preferences (user_id, category)
  select v_user_id, item.category
  from unnest(v_categories) item(category)
  on conflict (user_id, category) do update set updated_at = now();

  v_count := cardinality(v_categories);
  select coalesce(nullif(trim(p.display_name), ''), 'สมาชิก BBK')
  into v_display_name
  from public.profiles p
  where p.id = v_user_id;

  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, payload)
  values (
    v_user_id, 'notifications.auction_interests_updated', 'profile',
    v_user_id::text, jsonb_build_object('selected_count', v_count)
  ) returning id into v_audit_id;

  insert into public.notifications (
    user_id, notification_type, title, message, entity_type, entity_id, dedupe_key
  )
  select
    ra.user_id,
    'admin_auction_interest_update',
    'ลูกค้าอัปเดตสิ่งที่อยากประมูล',
    v_display_name || case
      when v_count = 0 then ' ปิดความสนใจทุกหมวด'
      else ' สนใจ: ' || array_to_string(v_categories, ', ')
    end,
    'admin_interest',
    v_user_id::text,
    'admin-interest-update:' || v_audit_id::text || ':' || ra.user_id::text
  from public.role_assignments ra
  join public.profiles admin_profile
    on admin_profile.id = ra.user_id and admin_profile.account_status = 'active'
  where ra.role_name = 'admin'
  on conflict (dedupe_key) do nothing;

  return v_count;
end;
$$;

with corrections(auction_id, old_category, new_category) as (
  values
    ('ab4af466-fe88-4d58-871d-473cdfad857a'::uuid, 'การ์ดสะสม'::text, 'ของเก่า'::text),
    ('7728756c-024f-4e06-93ed-c62fac682cb1'::uuid, 'การ์ดสะสม'::text, 'ของเก่า'::text),
    ('97eabcb4-f811-46c6-b7a3-841d9d517b75'::uuid, 'การ์ดสะสม'::text, 'ของเล่น'::text)
), updated as (
  update public.auctions a
  set category = c.new_category,
      version = a.version + 1,
      updated_at = now()
  from corrections c
  where a.id = c.auction_id
    and a.category = c.old_category
  returning a.id, c.old_category, c.new_category
)
insert into public.audit_events (actor_id, event_type, entity_type, entity_id, payload)
select
  null,
  'auction.category_corrected',
  'auction',
  u.id::text,
  jsonb_build_object('from', u.old_category, 'to', u.new_category, 'reason', 'separate_customer_categories')
from updated u;
