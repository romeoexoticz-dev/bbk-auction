-- BBK AUCTION: greenfield core schema
-- Money values are stored as integer satang. All decisions use database time.

create extension if not exists pgcrypto;

create type public.account_status as enum ('active', 'suspended', 'closed');
create type public.seller_status as enum ('pending', 'approved', 'rejected', 'suspended');
create type public.auction_status as enum (
  'draft', 'pending_review', 'scheduled', 'live', 'ended', 'settled',
  'rejected', 'cancelled', 'voided'
);
create type public.order_status as enum (
  'pending_payment', 'paid', 'preparing', 'shipped', 'delivered', 'completed',
  'cancelled', 'disputed', 'refunded'
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  account_status public.account_status not null default 'active',
  email_verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.roles (
  name text primary key check (name in ('bidder', 'seller', 'admin', 'support', 'finance')),
  description text not null
);

insert into public.roles (name, description) values
  ('bidder', 'May participate in eligible auctions'),
  ('seller', 'May manage an approved seller account'),
  ('admin', 'May review and control marketplace operations'),
  ('support', 'May assist customers without financial authority'),
  ('finance', 'May review approved financial operations');

create table public.role_assignments (
  user_id uuid not null references public.profiles (id) on delete cascade,
  role_name text not null references public.roles (name) on delete restrict,
  assigned_by uuid references public.profiles (id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (user_id, role_name)
);

create table public.seller_profiles (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  shop_name text not null,
  status public.seller_status not null default 'pending',
  verification_notes text,
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.auctions (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.seller_profiles (user_id) on delete restrict,
  title text not null check (char_length(title) between 3 and 160),
  description text not null default '',
  category text not null,
  status public.auction_status not null default 'draft',
  opening_price bigint not null check (opening_price > 0),
  current_price bigint not null check (current_price > 0),
  min_increment bigint not null check (min_increment > 0),
  reserve_price bigint check (reserve_price is null or reserve_price >= opening_price),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  extension_window_seconds integer not null default 0 check (extension_window_seconds between 0 and 3600),
  extension_duration_seconds integer not null default 0 check (extension_duration_seconds between 0 and 3600),
  bid_count integer not null default 0 check (bid_count >= 0),
  version bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint auctions_valid_times check (ends_at > starts_at),
  constraint auctions_initial_price check (current_price >= opening_price)
);

create table public.bids (
  id uuid primary key default gen_random_uuid(),
  auction_id uuid not null references public.auctions (id) on delete restrict,
  bidder_id uuid not null references public.profiles (id) on delete restrict,
  amount bigint not null check (amount > 0),
  request_key uuid not null,
  created_at timestamptz not null default now(),
  unique (bidder_id, request_key)
);

create table public.auction_results (
  auction_id uuid primary key references public.auctions (id) on delete restrict,
  winner_bid_id uuid unique references public.bids (id) on delete restrict,
  winner_id uuid references public.profiles (id) on delete restrict,
  winning_amount bigint check (winning_amount is null or winning_amount > 0),
  reserve_met boolean not null default false,
  finalized_at timestamptz not null default now()
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  auction_id uuid not null unique references public.auctions (id) on delete restrict,
  buyer_id uuid not null references public.profiles (id) on delete restrict,
  seller_id uuid not null references public.profiles (id) on delete restrict,
  amount bigint not null check (amount > 0),
  status public.order_status not null default 'pending_payment',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id) on delete set null,
  event_type text not null,
  entity_type text not null,
  entity_id text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index auctions_status_ends_at_idx on public.auctions (status, ends_at);
create index auctions_seller_created_at_idx on public.auctions (seller_id, created_at desc);
create index bids_auction_amount_idx on public.bids (auction_id, amount desc, created_at asc);
create index bids_bidder_created_at_idx on public.bids (bidder_id, created_at desc);
create index orders_buyer_created_at_idx on public.orders (buyer_id, created_at desc);
create index orders_seller_created_at_idx on public.orders (seller_id, created_at desc);
create index audit_events_entity_idx on public.audit_events (entity_type, entity_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger seller_profiles_set_updated_at before update on public.seller_profiles
for each row execute function public.set_updated_at();
create trigger auctions_set_updated_at before update on public.auctions
for each row execute function public.set_updated_at();
create trigger orders_set_updated_at before update on public.orders
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, email_verified)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email, ''), '@', 1)),
    new.email_confirmed_at is not null
  );

  insert into public.role_assignments (user_id, role_name)
  values (new.id, 'bidder');
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.has_role(
  p_role text,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.role_assignments ra
    join public.profiles p on p.id = ra.user_id
    where ra.user_id = p_user_id
      and ra.role_name = p_role
      and p.account_status = 'active'
  );
$$;

create or replace function public.place_bid(
  p_auction_id uuid,
  p_amount bigint,
  p_request_key uuid
)
returns public.bids
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bidder_id uuid := auth.uid();
  v_auction public.auctions%rowtype;
  v_existing public.bids%rowtype;
  v_bid public.bids%rowtype;
  v_minimum bigint;
  v_now timestamptz := now();
begin
  if v_bidder_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_existing
  from public.bids
  where bidder_id = v_bidder_id and request_key = p_request_key;

  if found then
    if v_existing.auction_id <> p_auction_id or v_existing.amount <> p_amount then
      raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = 'P0001';
    end if;
    return v_existing;
  end if;

  if not public.has_role('bidder', v_bidder_id) then
    raise exception 'BIDDER_NOT_ELIGIBLE' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = v_bidder_id and account_status = 'active' and email_verified
  ) then
    raise exception 'VERIFIED_ACTIVE_ACCOUNT_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_auction
  from public.auctions
  where id = p_auction_id
  for update;

  if not found then
    raise exception 'AUCTION_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_auction.seller_id = v_bidder_id then
    raise exception 'SELF_BIDDING_FORBIDDEN' using errcode = 'P0001';
  end if;
  if v_auction.status <> 'live' then
    raise exception 'AUCTION_NOT_LIVE' using errcode = 'P0001';
  end if;
  if v_now < v_auction.starts_at or v_now >= v_auction.ends_at then
    raise exception 'AUCTION_OUTSIDE_BIDDING_WINDOW' using errcode = 'P0001';
  end if;

  v_minimum := case
    when v_auction.bid_count = 0 then v_auction.opening_price
    else v_auction.current_price + v_auction.min_increment
  end;

  if p_amount < v_minimum then
    raise exception 'BID_BELOW_MINIMUM:%', v_minimum using errcode = 'P0001';
  end if;

  insert into public.bids (auction_id, bidder_id, amount, request_key, created_at)
  values (p_auction_id, v_bidder_id, p_amount, p_request_key, v_now)
  returning * into v_bid;

  update public.auctions
  set current_price = p_amount,
      bid_count = bid_count + 1,
      version = version + 1,
      ends_at = case
        when extension_window_seconds > 0
          and extension_duration_seconds > 0
          and ends_at - v_now <= make_interval(secs => extension_window_seconds)
        then ends_at + make_interval(secs => extension_duration_seconds)
        else ends_at
      end
  where id = p_auction_id;

  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, payload)
  values (
    v_bidder_id,
    'bid.placed',
    'auction',
    p_auction_id::text,
    jsonb_build_object('bid_id', v_bid.id, 'amount', p_amount, 'request_key', p_request_key)
  );

  return v_bid;
end;
$$;

create or replace function public.finalize_auction(p_auction_id uuid)
returns public.auction_results
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auction public.auctions%rowtype;
  v_winner public.bids%rowtype;
  v_result public.auction_results%rowtype;
begin
  if not public.has_role('admin', auth.uid()) then
    raise exception 'ADMIN_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_result from public.auction_results where auction_id = p_auction_id;
  if found then return v_result; end if;

  select * into v_auction from public.auctions where id = p_auction_id for update;
  if not found then raise exception 'AUCTION_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_auction.ends_at > now() then raise exception 'AUCTION_NOT_ENDED' using errcode = 'P0001'; end if;
  if v_auction.status not in ('live', 'ended') then
    raise exception 'AUCTION_CANNOT_BE_FINALIZED' using errcode = 'P0001';
  end if;

  select * into v_winner
  from public.bids
  where auction_id = p_auction_id
  order by amount desc, created_at asc
  limit 1;

  insert into public.auction_results (
    auction_id, winner_bid_id, winner_id, winning_amount, reserve_met
  ) values (
    p_auction_id,
    v_winner.id,
    v_winner.bidder_id,
    v_winner.amount,
    v_winner.id is not null and (v_auction.reserve_price is null or v_winner.amount >= v_auction.reserve_price)
  )
  returning * into v_result;

  update public.auctions set status = 'ended', version = version + 1 where id = p_auction_id;

  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, payload)
  values (auth.uid(), 'auction.finalized', 'auction', p_auction_id::text,
    jsonb_build_object('winner_bid_id', v_winner.id, 'winning_amount', v_winner.amount));

  return v_result;
end;
$$;

-- Broadcast only committed database changes to private auction channels.
create or replace function public.broadcast_auction_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.broadcast_changes(
    'auction:' || coalesce(new.id, old.id)::text,
    tg_op, tg_op, tg_table_name, tg_table_schema, new, old
  );
  return coalesce(new, old);
end;
$$;

create or replace function public.broadcast_bid_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.broadcast_changes(
    'auction:' || coalesce(new.auction_id, old.auction_id)::text,
    tg_op, tg_op, tg_table_name, tg_table_schema, new, old
  );
  return coalesce(new, old);
end;
$$;

create trigger auctions_broadcast_after_change
after insert or update or delete on public.auctions
for each row execute function public.broadcast_auction_change();

create trigger bids_broadcast_after_change
after insert or update or delete on public.bids
for each row execute function public.broadcast_bid_change();

alter table public.profiles enable row level security;
alter table public.roles enable row level security;
alter table public.role_assignments enable row level security;
alter table public.seller_profiles enable row level security;
alter table public.auctions enable row level security;
alter table public.bids enable row level security;
alter table public.auction_results enable row level security;
alter table public.orders enable row level security;
alter table public.audit_events enable row level security;

create policy "users read own profile" on public.profiles
for select to authenticated using (id = auth.uid() or public.has_role('admin'));
create policy "admins manage profiles" on public.profiles
for all to authenticated using (public.has_role('admin')) with check (public.has_role('admin'));

create policy "authenticated read roles" on public.roles
for select to authenticated using (true);
create policy "users read own role assignments" on public.role_assignments
for select to authenticated using (user_id = auth.uid() or public.has_role('admin'));
create policy "admins manage role assignments" on public.role_assignments
for all to authenticated using (public.has_role('admin')) with check (public.has_role('admin'));

create policy "users read own seller profile" on public.seller_profiles
for select to authenticated using (user_id = auth.uid() or public.has_role('admin'));
create policy "admins manage seller profiles" on public.seller_profiles
for all to authenticated using (public.has_role('admin')) with check (public.has_role('admin'));

create policy "public read published auctions" on public.auctions
for select to anon, authenticated using (status in ('scheduled', 'live', 'ended', 'settled'));
create policy "sellers read own auctions" on public.auctions
for select to authenticated using (seller_id = auth.uid());
create policy "admins manage auctions" on public.auctions
for all to authenticated using (public.has_role('admin')) with check (public.has_role('admin'));

create policy "bidders read own bids" on public.bids
for select to authenticated using (bidder_id = auth.uid() or public.has_role('admin'));

create policy "public read published results" on public.auction_results
for select to anon, authenticated using (
  exists (
    select 1 from public.auctions a
    where a.id = auction_id and a.status in ('ended', 'settled')
  )
);
create policy "admins manage results" on public.auction_results
for all to authenticated using (public.has_role('admin')) with check (public.has_role('admin'));

create policy "order participants read orders" on public.orders
for select to authenticated using (
  buyer_id = auth.uid() or seller_id = auth.uid() or public.has_role('admin')
);
create policy "admins manage orders" on public.orders
for all to authenticated using (public.has_role('admin')) with check (public.has_role('admin'));

create policy "admins read audit events" on public.audit_events
for select to authenticated using (public.has_role('admin'));

-- Realtime private-channel authorization. Database triggers are the only writers.
drop policy if exists "authenticated receive auction broadcasts" on realtime.messages;
create policy "authenticated receive auction broadcasts"
on realtime.messages for select to authenticated
using (
  extension = 'broadcast'
  and realtime.topic() like 'auction:%'
  and exists (
    select 1 from public.auctions a
    where 'auction:' || a.id::text = realtime.topic()
      and (
        a.status in ('scheduled', 'live', 'ended', 'settled')
        or a.seller_id = auth.uid()
        or public.has_role('admin')
      )
  )
);

revoke all on all tables in schema public from anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select on public.auctions, public.auction_results to anon, authenticated;
grant select on public.profiles, public.roles, public.role_assignments,
  public.seller_profiles, public.bids, public.orders, public.audit_events to authenticated;
grant insert, update, delete on public.profiles, public.role_assignments,
  public.seller_profiles, public.auctions, public.auction_results, public.orders to authenticated;
grant usage, select on all sequences in schema public to authenticated;

revoke all on function public.place_bid(uuid, bigint, uuid) from public, anon;
grant execute on function public.place_bid(uuid, bigint, uuid) to authenticated;
revoke all on function public.finalize_auction(uuid) from public, anon;
grant execute on function public.finalize_auction(uuid) to authenticated;
revoke all on function public.has_role(text, uuid) from public, anon;
grant execute on function public.has_role(text, uuid) to authenticated;
