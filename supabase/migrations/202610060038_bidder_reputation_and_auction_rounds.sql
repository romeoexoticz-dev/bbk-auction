-- Bidder reputation derived from real outcomes, plus atomic auction-round publishing.
-- Reputation is informational: existing payment-default rules remain the only enforcement.

create or replace function public.admin_bidder_reputation(
  p_search text default null,
  p_limit integer default 100
)
returns table (
  user_id uuid,
  display_name text,
  account_status public.account_status,
  email_verified boolean,
  verification_status text,
  won_auctions bigint,
  successful_orders bigint,
  payment_defaults bigint,
  score_percent numeric,
  reputation_state text,
  last_default_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  if not public.has_role('admin', auth.uid()) then
    raise exception 'ADMIN_REQUIRED' using errcode = 'P0001';
  end if;

  return query
  with bidder_users as (
    select distinct ra.user_id
    from public.role_assignments ra
    where ra.role_name = 'bidder'
  ), wins as (
    select ar.winner_id as user_id, count(*)::bigint as won_auctions
    from public.auction_results ar
    where ar.winner_id is not null and ar.reserve_met
    group by ar.winner_id
  ), successful as (
    select o.buyer_id as user_id, count(*)::bigint as successful_orders
    from public.orders o
    where o.status in ('paid', 'preparing', 'shipped', 'delivered', 'completed')
      and coalesce(o.payment_evidence_is_test, false) = false
    group by o.buyer_id
  ), defaults as (
    select ope.buyer_id as user_id,
           count(*)::bigint as payment_defaults,
           max(ope.expired_at) as last_default_at
    from public.order_payment_expirations ope
    group by ope.buyer_id
  )
  select
    p.id,
    coalesce(nullif(btrim(p.display_name), ''), 'สมาชิก ' || upper(left(p.id::text, 8))),
    p.account_status,
    p.email_verified,
    coalesce(bv.status, 'not_submitted'),
    coalesce(w.won_auctions, 0),
    coalesce(s.successful_orders, 0),
    coalesce(d.payment_defaults, 0),
    case
      when coalesce(s.successful_orders, 0) + coalesce(d.payment_defaults, 0) = 0 then null
      else round(
        coalesce(s.successful_orders, 0)::numeric * 100
        / (coalesce(s.successful_orders, 0) + coalesce(d.payment_defaults, 0)),
        0
      )
    end,
    case
      when p.account_status = 'suspended' then 'suspended'
      when coalesce(pdc.review_status, '') in ('pending_review', 'kept_suspended') then 'needs_review'
      when coalesce(pdc.strike_count, 0) >= 1 then 'warning'
      when coalesce(s.successful_orders, 0) + coalesce(d.payment_defaults, 0) = 0 then 'new'
      else 'good'
    end,
    d.last_default_at
  from bidder_users bu
  join public.profiles p on p.id = bu.user_id
  left join public.bidder_verifications bv on bv.user_id = p.id
  left join public.payment_default_cases pdc on pdc.user_id = p.id
  left join wins w on w.user_id = p.id
  left join successful s on s.user_id = p.id
  left join defaults d on d.user_id = p.id
  where p_search is null
     or btrim(p_search) = ''
     or coalesce(p.display_name, '') ilike '%' || btrim(p_search) || '%'
     or p.id::text ilike btrim(p_search) || '%'
  order by
    case
      when p.account_status = 'suspended' then 0
      when coalesce(pdc.strike_count, 0) > 0 then 1
      else 2
    end,
    d.last_default_at desc nulls last,
    p.created_at desc
  limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$$;

revoke all on function public.admin_bidder_reputation(text, integer) from public, anon;
grant execute on function public.admin_bidder_reputation(text, integer) to authenticated;

create table if not exists public.auction_rounds (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.seller_profiles (user_id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 3 and 120),
  description text not null default '' check (char_length(description) <= 1000),
  state text not null default 'draft' check (state in ('draft', 'published', 'cancelled')),
  starts_at timestamptz not null,
  first_ends_at timestamptz not null,
  close_interval_seconds integer not null default 120 check (close_interval_seconds between 60 and 86400),
  created_by uuid not null references public.profiles (id) on delete restrict,
  published_by uuid references public.profiles (id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint auction_rounds_valid_window check (first_ends_at > starts_at)
);

alter table public.auctions
  add column if not exists round_id uuid references public.auction_rounds (id) on delete set null,
  add column if not exists round_lot_number integer check (round_lot_number is null or round_lot_number between 1 and 1000);

create unique index if not exists auctions_round_lot_unique
on public.auctions (round_id, round_lot_number)
where round_id is not null and round_lot_number is not null;

create index if not exists auction_rounds_seller_created_idx
on public.auction_rounds (seller_id, created_at desc);

create index if not exists auctions_round_id_idx
on public.auctions (round_id, round_lot_number);

drop trigger if exists auction_rounds_set_updated_at on public.auction_rounds;
create trigger auction_rounds_set_updated_at
before update on public.auction_rounds
for each row execute function public.set_updated_at();

alter table public.auction_rounds enable row level security;
revoke all on public.auction_rounds from public, anon, authenticated;
grant select on public.auction_rounds to authenticated;

drop policy if exists "admins and owners read auction rounds" on public.auction_rounds;
create policy "admins and owners read auction rounds"
on public.auction_rounds for select to authenticated
using (public.has_role('admin') or seller_id = auth.uid());

create or replace function public.admin_create_auction_round(
  p_seller_id uuid,
  p_name text,
  p_description text,
  p_starts_at timestamptz,
  p_first_ends_at timestamptz,
  p_close_interval_seconds integer
)
returns public.auction_rounds
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_round public.auction_rounds%rowtype;
begin
  if v_actor_id is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;
  if not public.has_role('admin', v_actor_id) then raise exception 'ADMIN_REQUIRED' using errcode = 'P0001'; end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 3 and 120 then
    raise exception 'ROUND_NAME_REQUIRED' using errcode = 'P0001';
  end if;
  if char_length(coalesce(p_description, '')) > 1000 then
    raise exception 'ROUND_DESCRIPTION_TOO_LONG' using errcode = 'P0001';
  end if;
  if p_first_ends_at <= p_starts_at or p_first_ends_at <= now() then
    raise exception 'INVALID_ROUND_WINDOW' using errcode = 'P0001';
  end if;
  if p_close_interval_seconds not between 60 and 86400 then
    raise exception 'INVALID_CLOSE_INTERVAL' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.seller_profiles sp
    where sp.user_id = p_seller_id and sp.status = 'approved'
  ) then
    raise exception 'APPROVED_SELLER_REQUIRED' using errcode = 'P0001';
  end if;

  insert into public.auction_rounds (
    seller_id, name, description, starts_at, first_ends_at,
    close_interval_seconds, created_by
  ) values (
    p_seller_id, btrim(p_name), btrim(coalesce(p_description, '')),
    p_starts_at, p_first_ends_at, p_close_interval_seconds, v_actor_id
  ) returning * into v_round;

  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, payload)
  values (
    v_actor_id, 'auction_round.created', 'auction_round', v_round.id::text,
    jsonb_build_object(
      'name', v_round.name,
      'seller_id', v_round.seller_id,
      'starts_at', v_round.starts_at,
      'first_ends_at', v_round.first_ends_at,
      'close_interval_seconds', v_round.close_interval_seconds
    )
  );

  return v_round;
end;
$$;

create or replace function public.admin_assign_auctions_to_round(
  p_round_id uuid,
  p_auction_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_round public.auction_rounds%rowtype;
  v_requested integer;
  v_existing integer;
  v_assigned integer := 0;
begin
  if v_actor_id is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;
  if not public.has_role('admin', v_actor_id) then raise exception 'ADMIN_REQUIRED' using errcode = 'P0001'; end if;

  select * into v_round from public.auction_rounds where id = p_round_id for update;
  if not found then raise exception 'ROUND_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_round.state <> 'draft' then raise exception 'ROUND_NOT_EDITABLE' using errcode = 'P0001'; end if;

  select count(distinct value)::integer into v_requested
  from unnest(coalesce(p_auction_ids, array[]::uuid[])) as selected(value);
  if v_requested < 1 or v_requested > 100 then
    raise exception 'ROUND_ITEM_COUNT_INVALID' using errcode = 'P0001';
  end if;

  select count(*)::integer into v_existing
  from public.auctions a
  where a.round_id = p_round_id;
  if v_existing + v_requested > 100 then
    raise exception 'ROUND_ITEM_LIMIT_EXCEEDED' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from unnest(p_auction_ids) as selected(value)
    left join public.auctions a on a.id = selected.value
    where a.id is null
       or a.seller_id <> v_round.seller_id
       or a.status not in ('draft', 'rejected')
       or a.bid_count <> 0
       or a.round_id is not null
  ) then
    raise exception 'ROUND_ITEM_NOT_ELIGIBLE' using errcode = 'P0001';
  end if;

  with selected as (
    select value as auction_id, min(ordinality)::integer as position
    from unnest(p_auction_ids) with ordinality as chosen(value, ordinality)
    group by value
  )
  update public.auctions a
  set round_id = p_round_id,
      round_lot_number = v_existing + selected.position,
      starts_at = v_round.starts_at,
      ends_at = v_round.first_ends_at
        + make_interval(secs => (v_existing + selected.position - 1) * v_round.close_interval_seconds),
      version = a.version + 1
  from selected
  where a.id = selected.auction_id;

  get diagnostics v_assigned = row_count;

  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, payload)
  values (
    v_actor_id, 'auction_round.items_assigned', 'auction_round', p_round_id::text,
    jsonb_build_object('assigned_count', v_assigned, 'total_count', v_existing + v_assigned)
  );

  return v_assigned;
end;
$$;

create or replace function public.admin_publish_auction_round(
  p_round_id uuid,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_round public.auction_rounds%rowtype;
  v_auction public.auctions%rowtype;
  v_count integer := 0;
begin
  if v_actor_id is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;
  if not public.has_role('admin', v_actor_id) then raise exception 'ADMIN_REQUIRED' using errcode = 'P0001'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 5 and 500 then
    raise exception 'REVIEW_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_round from public.auction_rounds where id = p_round_id for update;
  if not found then raise exception 'ROUND_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_round.state = 'published' then
    select count(*)::integer into v_count from public.auctions where round_id = p_round_id;
    return v_count;
  end if;
  if v_round.state <> 'draft' then raise exception 'ROUND_NOT_PUBLISHABLE' using errcode = 'P0001'; end if;
  if v_round.first_ends_at <= now() then raise exception 'ROUND_WINDOW_ENDED' using errcode = 'P0001'; end if;

  select count(*)::integer into v_count from public.auctions where round_id = p_round_id;
  if v_count < 1 then raise exception 'ROUND_HAS_NO_ITEMS' using errcode = 'P0001'; end if;

  if exists (
    select 1 from public.auctions a
    where a.round_id = p_round_id
      and (a.status not in ('draft', 'rejected') or a.bid_count <> 0 or a.round_lot_number is null)
  ) then
    raise exception 'ROUND_CONTAINS_INELIGIBLE_ITEMS' using errcode = 'P0001';
  end if;

  for v_auction in
    select * from public.auctions
    where round_id = p_round_id
    order by round_lot_number
    for update
  loop
    update public.auctions
    set status = 'pending_review', version = version + 1
    where id = v_auction.id;

    insert into public.audit_events (actor_id, event_type, entity_type, entity_id, payload)
    values (
      v_actor_id, 'auction.submitted_for_review', 'auction', v_auction.id::text,
      jsonb_build_object(
        'from_status', v_auction.status,
        'to_status', 'pending_review',
        'round_id', p_round_id,
        'round_lot_number', v_auction.round_lot_number,
        'payments_enabled', false
      )
    );

    perform public.review_auction(v_auction.id, 'approve', btrim(p_reason));
  end loop;

  update public.auction_rounds
  set state = 'published', published_by = v_actor_id, published_at = now()
  where id = p_round_id;

  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, payload)
  values (
    v_actor_id, 'auction_round.published', 'auction_round', p_round_id::text,
    jsonb_build_object('item_count', v_count, 'reason', btrim(p_reason), 'atomic', true)
  );

  return v_count;
end;
$$;

revoke all on function public.admin_create_auction_round(uuid, text, text, timestamptz, timestamptz, integer) from public, anon;
revoke all on function public.admin_assign_auctions_to_round(uuid, uuid[]) from public, anon;
revoke all on function public.admin_publish_auction_round(uuid, text) from public, anon;
grant execute on function public.admin_create_auction_round(uuid, text, text, timestamptz, timestamptz, integer) to authenticated;
grant execute on function public.admin_assign_auctions_to_round(uuid, uuid[]) to authenticated;
grant execute on function public.admin_publish_auction_round(uuid, text) to authenticated;

insert into public.audit_events (actor_id, event_type, entity_type, entity_id, payload)
values (
  null,
  'risk.bidder_reputation_and_rounds_installed',
  'system',
  'bidder-reputation-auction-rounds-2026-10-06',
  jsonb_build_object(
    'reputation_source', 'real_resolved_orders_only',
    'test_payments_excluded', true,
    'new_automatic_penalties_added', false,
    'round_publish_atomic', true,
    'maximum_items_per_round', 100
  )
);
