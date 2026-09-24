-- Product trust foundation for BBK-owned auction lots.
-- Keeps policy text (returns and official contact channels) out of the schema
-- until the shop owner confirms it, while enforcing factual item evidence.

alter table public.auctions
  add column if not exists item_year text not null default '',
  add column if not exists item_model text not null default '',
  add column if not exists item_size text not null default '',
  add column if not exists condition_summary text not null default '',
  add column if not exists expert_notes text not null default '';

alter table public.auctions
  drop constraint if exists auctions_item_year_length_check,
  drop constraint if exists auctions_item_model_length_check,
  drop constraint if exists auctions_item_size_length_check,
  drop constraint if exists auctions_condition_summary_length_check,
  drop constraint if exists auctions_expert_notes_length_check;

alter table public.auctions
  add constraint auctions_item_year_length_check check (char_length(item_year) <= 80),
  add constraint auctions_item_model_length_check check (char_length(item_model) <= 160),
  add constraint auctions_item_size_length_check check (char_length(item_size) <= 160),
  add constraint auctions_condition_summary_length_check check (char_length(condition_summary) <= 500),
  add constraint auctions_expert_notes_length_check check (char_length(expert_notes) <= 2000);

alter table public.auction_media
  drop constraint if exists auction_media_media_kind_check;

alter table public.auction_media
  add constraint auction_media_media_kind_check
  check (media_kind in ('cover', 'front', 'back', 'gallery', 'defect', 'evidence'));

create unique index if not exists auction_media_one_front_per_auction_idx
  on public.auction_media (auction_id)
  where media_kind = 'front';

create unique index if not exists auction_media_one_back_per_auction_idx
  on public.auction_media (auction_id)
  where media_kind = 'back';

create or replace function public.create_auction_draft_with_details(
  p_title text,
  p_description text,
  p_category text,
  p_opening_price bigint,
  p_min_increment bigint,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_item_year text,
  p_item_model text,
  p_item_size text,
  p_condition_summary text,
  p_expert_notes text
)
returns public.auctions
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_auction public.auctions;
begin
  if btrim(coalesce(p_item_year, '')) = ''
    or btrim(coalesce(p_item_model, '')) = ''
    or btrim(coalesce(p_item_size, '')) = ''
    or char_length(btrim(coalesce(p_condition_summary, ''))) < 5
    or char_length(btrim(coalesce(p_expert_notes, ''))) < 5 then
    raise exception 'PRODUCT_TRUST_FIELDS_REQUIRED';
  end if;

  v_auction := public.create_auction_draft(
    p_title,
    p_description,
    p_category,
    p_opening_price,
    p_min_increment,
    p_starts_at,
    p_ends_at
  );

  update public.auctions
  set item_year = btrim(p_item_year),
      item_model = btrim(p_item_model),
      item_size = btrim(p_item_size),
      condition_summary = btrim(p_condition_summary),
      expert_notes = btrim(p_expert_notes)
  where id = v_auction.id
  returning * into v_auction;

  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, payload)
  values (
    auth.uid(),
    'auction.product_trust_created',
    'auction',
    v_auction.id,
    jsonb_build_object('required_fields_complete', true)
  );

  return v_auction;
end;
$$;

create or replace function public.update_auction_draft_with_details(
  p_auction_id uuid,
  p_title text,
  p_description text,
  p_category text,
  p_opening_price bigint,
  p_min_increment bigint,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_item_year text,
  p_item_model text,
  p_item_size text,
  p_condition_summary text,
  p_expert_notes text
)
returns public.auctions
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_auction public.auctions;
begin
  if btrim(coalesce(p_item_year, '')) = ''
    or btrim(coalesce(p_item_model, '')) = ''
    or btrim(coalesce(p_item_size, '')) = ''
    or char_length(btrim(coalesce(p_condition_summary, ''))) < 5
    or char_length(btrim(coalesce(p_expert_notes, ''))) < 5 then
    raise exception 'PRODUCT_TRUST_FIELDS_REQUIRED';
  end if;

  v_auction := public.update_auction_draft(
    p_auction_id,
    p_title,
    p_description,
    p_category,
    p_opening_price,
    p_min_increment,
    p_starts_at,
    p_ends_at
  );

  update public.auctions
  set item_year = btrim(p_item_year),
      item_model = btrim(p_item_model),
      item_size = btrim(p_item_size),
      condition_summary = btrim(p_condition_summary),
      expert_notes = btrim(p_expert_notes)
  where id = v_auction.id
  returning * into v_auction;

  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, payload)
  values (
    auth.uid(),
    'auction.product_trust_updated',
    'auction',
    v_auction.id,
    jsonb_build_object('required_fields_complete', true)
  );

  return v_auction;
end;
$$;

create or replace function public.enforce_auction_product_trust_before_publish()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('scheduled', 'live')
    and old.status not in ('scheduled', 'live') then
    if btrim(new.item_year) = ''
      or btrim(new.item_model) = ''
      or btrim(new.item_size) = ''
      or char_length(btrim(new.condition_summary)) < 5
      or char_length(btrim(new.expert_notes)) < 5 then
      raise exception 'PRODUCT_TRUST_FIELDS_REQUIRED';
    end if;

    if not exists (
      select 1 from public.auction_media m
      where m.auction_id = new.id and m.media_kind = 'front'
    ) or not exists (
      select 1 from public.auction_media m
      where m.auction_id = new.id and m.media_kind = 'back'
    ) or not exists (
      select 1 from public.auction_media m
      where m.auction_id = new.id and m.media_kind = 'defect'
    ) then
      raise exception 'PRODUCT_TRUST_MEDIA_REQUIRED';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_auction_product_trust_before_publish on public.auctions;
create trigger enforce_auction_product_trust_before_publish
before update of status on public.auctions
for each row execute function public.enforce_auction_product_trust_before_publish();

revoke all on function public.create_auction_draft_with_details(text, text, text, bigint, bigint, timestamptz, timestamptz, text, text, text, text, text) from public;
revoke all on function public.update_auction_draft_with_details(uuid, text, text, text, bigint, bigint, timestamptz, timestamptz, text, text, text, text, text) from public;
grant execute on function public.create_auction_draft_with_details(text, text, text, bigint, bigint, timestamptz, timestamptz, text, text, text, text, text) to authenticated;
grant execute on function public.update_auction_draft_with_details(uuid, text, text, text, bigint, bigint, timestamptz, timestamptz, text, text, text, text, text) to authenticated;
