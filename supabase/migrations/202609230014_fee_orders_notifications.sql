-- BBK AUCTION: approved fee rules, tiered bid increments, winner orders,
-- and in-app notifications. Real payment submission stays disabled in the app
-- until the BBK bank/QR destination is approved and configured.

alter table public.auctions
  add column buyer_fee_rate_bps integer not null default 1000
    check (buyer_fee_rate_bps between 0 and 10000),
  add column buyer_fee_vat_rate_bps integer not null default 700
    check (buyer_fee_vat_rate_bps between 0 and 10000);

create or replace function public.bid_increment_for(p_current_price bigint)
returns bigint
language sql
immutable
strict
set search_path = ''
as $$
  select case
    when p_current_price < 100000 then 1000::bigint
    when p_current_price < 500000 then 5000::bigint
    else 10000::bigint
  end;
$$;

update public.auctions
set min_increment = public.bid_increment_for(current_price);

create or replace function public.calculate_buyer_totals(
  p_winning_amount bigint,
  p_fee_rate_bps integer default 1000,
  p_vat_rate_bps integer default 700
)
returns table (
  buyer_fee_amount bigint,
  buyer_fee_vat_amount bigint,
  total_amount bigint
)
language sql
immutable
strict
set search_path = ''
as $$
  with fee as (
    select ((p_winning_amount * p_fee_rate_bps + 5000) / 10000)::bigint as amount
  ), vat as (
    select amount, ((amount * p_vat_rate_bps + 5000) / 10000)::bigint as vat_amount
    from fee
  )
  select amount, vat_amount, p_winning_amount + amount + vat_amount
  from vat;
$$;

create sequence public.order_number_seq;

create or replace function public.next_order_number()
returns text
language sql
volatile
set search_path = ''
as $$
  select 'BBK-' ||
    to_char(current_timestamp at time zone 'Asia/Bangkok', 'YYYYMMDD') || '-' ||
    lpad(nextval('public.order_number_seq')::text, 6, '0');
$$;

alter table public.orders rename column amount to winning_amount;
alter table public.orders
  add column order_number text,
  add column buyer_fee_rate_bps integer not null default 1000,
  add column buyer_fee_amount bigint not null default 0,
  add column buyer_fee_vat_rate_bps integer not null default 700,
  add column buyer_fee_vat_amount bigint not null default 0,
  add column shipping_amount bigint not null default 0,
  add column payment_due_at timestamptz,
  add column payment_evidence_path text,
  add column payment_submitted_at timestamptz,
  add column payment_reviewed_by uuid references public.profiles (id) on delete set null,
  add column payment_reviewed_at timestamptz,
  add column payment_review_reason text,
  add column carrier text,
  add column tracking_number text,
  add column shipped_at timestamptz,
  add column cancellation_reason text;

update public.orders
set order_number = public.next_order_number(),
    buyer_fee_amount = ((winning_amount * 1000 + 5000) / 10000)::bigint,
    buyer_fee_vat_amount = (
      ((((winning_amount * 1000 + 5000) / 10000)::bigint) * 700 + 5000) / 10000
    )::bigint,
    payment_due_at = created_at + interval '24 hours';

alter table public.orders
  alter column order_number set default public.next_order_number(),
  alter column order_number set not null,
  alter column payment_due_at set default (now() + interval '24 hours'),
  alter column payment_due_at set not null,
  add column total_amount bigint generated always as (
    winning_amount + buyer_fee_amount + buyer_fee_vat_amount + shipping_amount
  ) stored,
  add constraint orders_order_number_unique unique (order_number),
  add constraint orders_fee_rates_valid check (
    buyer_fee_rate_bps between 0 and 10000
    and buyer_fee_vat_rate_bps between 0 and 10000
  ),
  add constraint orders_amounts_nonnegative check (
    buyer_fee_amount >= 0
    and buyer_fee_vat_amount >= 0
    and shipping_amount >= 0
  );

create table public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  notification_type text not null,
  title text not null check (char_length(title) between 1 and 160),
  message text not null check (char_length(message) between 1 and 1000),
  entity_type text,
  entity_id text,
  dedupe_key text not null unique,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_created_idx
on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

create policy "users read own notifications"
on public.notifications for select to authenticated
using (user_id = auth.uid() or public.has_role('admin'));

revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant usage, select on sequence public.notifications_id_seq to authenticated;

create or replace function public.mark_notification_read(p_notification_id bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  update public.notifications
  set read_at = coalesce(read_at, now())
  where id = p_notification_id and user_id = auth.uid();

  return found;
end;
$$;

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

create or replace function public.close_due_auctions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auction_id uuid;
  v_closed integer := 0;
begin
  for v_auction_id in
    select id
    from public.auctions
    where status in ('scheduled', 'live') and ends_at <= now()
    order by ends_at asc
    for update skip locked
  loop
    perform public.finalize_one_auction(v_auction_id, null, 'database_time');
    v_closed := v_closed + 1;
  end loop;
  return v_closed;
end;
$$;

create or replace function public.finalize_auction(p_auction_id uuid)
returns public.auction_results
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_role('admin', auth.uid()) then
    raise exception 'ADMIN_REQUIRED' using errcode = 'P0001';
  end if;
  return public.finalize_one_auction(p_auction_id, auth.uid(), 'admin');
end;
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
  v_previous_leader public.bids%rowtype;
  v_bid public.bids%rowtype;
  v_minimum bigint;
  v_next_increment bigint;
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
  if not exists (
    select 1 from public.bidder_verifications
    where user_id = v_bidder_id and status = 'approved'
  ) then
    raise exception 'BIDDER_VERIFICATION_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_auction
  from public.auctions
  where id = p_auction_id
  for update;

  if not found then raise exception 'AUCTION_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_auction.seller_id = v_bidder_id then raise exception 'SELF_BIDDING_FORBIDDEN' using errcode = 'P0001'; end if;
  if v_auction.status <> 'live' then raise exception 'AUCTION_NOT_LIVE' using errcode = 'P0001'; end if;
  if v_now < v_auction.starts_at or v_now >= v_auction.ends_at then
    raise exception 'AUCTION_OUTSIDE_BIDDING_WINDOW' using errcode = 'P0001';
  end if;

  v_next_increment := public.bid_increment_for(v_auction.current_price);
  v_minimum := case
    when v_auction.bid_count = 0 then v_auction.opening_price
    else v_auction.current_price + v_next_increment
  end;
  if p_amount < v_minimum then
    raise exception 'BID_BELOW_MINIMUM:%', v_minimum using errcode = 'P0001';
  end if;

  select * into v_previous_leader
  from public.bids
  where auction_id = p_auction_id
  order by amount desc, created_at asc
  limit 1;

  insert into public.bids (auction_id, bidder_id, amount, request_key, created_at)
  values (p_auction_id, v_bidder_id, p_amount, p_request_key, v_now)
  returning * into v_bid;

  update public.auctions
  set current_price = p_amount,
      min_increment = public.bid_increment_for(p_amount),
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

  if v_previous_leader.id is not null and v_previous_leader.bidder_id <> v_bidder_id then
    insert into public.notifications (
      user_id, notification_type, title, message, entity_type, entity_id, dedupe_key
    ) values (
      v_previous_leader.bidder_id,
      'outbid',
      'มีผู้เสนอราคาสูงกว่าคุณ',
      'กลับไปตรวจราคาล่าสุดก่อนหมดเวลาประมูล',
      'auction',
      p_auction_id::text,
      'outbid:' || v_bid.id::text || ':' || v_previous_leader.bidder_id::text
    ) on conflict (dedupe_key) do nothing;
  end if;

  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, payload)
  values (
    v_bidder_id,
    'bid.placed',
    'auction',
    p_auction_id::text,
    jsonb_build_object(
      'bid_id', v_bid.id,
      'amount', p_amount,
      'request_key', p_request_key,
      'minimum_increment', v_next_increment,
      'fee_rate_bps', v_auction.buyer_fee_rate_bps,
      'fee_vat_rate_bps', v_auction.buyer_fee_vat_rate_bps
    )
  );

  return v_bid;
end;
$$;

revoke all on function public.bid_increment_for(bigint) from public;
grant execute on function public.bid_increment_for(bigint) to anon, authenticated;
revoke all on function public.calculate_buyer_totals(bigint, integer, integer) from public;
grant execute on function public.calculate_buyer_totals(bigint, integer, integer) to anon, authenticated;
revoke all on function public.next_order_number() from public, anon, authenticated;
revoke all on function public.mark_notification_read(bigint) from public, anon;
grant execute on function public.mark_notification_read(bigint) to authenticated;
revoke all on function public.finalize_one_auction(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.close_due_auctions() from public;
grant execute on function public.close_due_auctions() to anon, authenticated;
revoke all on function public.finalize_auction(uuid) from public, anon;
grant execute on function public.finalize_auction(uuid) to authenticated;
revoke all on function public.place_bid(uuid, bigint, uuid) from public, anon;
grant execute on function public.place_bid(uuid, bigint, uuid) to authenticated;

insert into public.audit_events (actor_id, event_type, entity_type, entity_id, payload)
values (
  null,
  'fees.policy_activated',
  'system',
  'buyer-fee-2026-09-23',
  jsonb_build_object(
    'buyer_fee_rate_percent', 10,
    'vat_on_fee_percent', 7,
    'effective_total_percent', 10.7,
    'payment_window_hours', 24,
    'payments_enabled', false
  )
);
