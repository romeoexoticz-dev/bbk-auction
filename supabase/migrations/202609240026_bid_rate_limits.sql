-- Server-enforced bid throttling and an append-only rejection log.
-- Approved policy: at least 2 seconds between attempts and no more than
-- 10 attempts in a rolling 60-second window for each authenticated bidder.

create table if not exists public.bid_attempts (
  id bigint generated always as identity primary key,
  bidder_id uuid not null references public.profiles (id) on delete restrict,
  auction_id uuid references public.auctions (id) on delete set null,
  amount bigint,
  request_key uuid,
  outcome text not null check (outcome in ('pending', 'accepted', 'rejected')),
  reason_code text,
  retry_after_seconds integer check (retry_after_seconds is null or retry_after_seconds >= 0),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists bid_attempts_bidder_created_at_idx
  on public.bid_attempts (bidder_id, created_at desc);
create index if not exists bid_attempts_rejected_created_at_idx
  on public.bid_attempts (created_at desc)
  where outcome = 'rejected';
create index if not exists bid_attempts_auction_created_at_idx
  on public.bid_attempts (auction_id, created_at desc);

alter table public.bid_attempts enable row level security;

drop policy if exists "admins read bid attempts" on public.bid_attempts;
create policy "admins read bid attempts" on public.bid_attempts
for select to authenticated
using (public.has_role('admin', auth.uid()));

revoke all on public.bid_attempts from public, anon, authenticated;
grant select on public.bid_attempts to authenticated;

create or replace function public.submit_bid(
  p_auction_id uuid,
  p_amount bigint,
  p_request_key uuid
)
returns jsonb
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
  v_attempt_id bigint;
  v_last_attempt_at timestamptz;
  v_oldest_minute_attempt_at timestamptz;
  v_attempt_count integer;
  v_minimum bigint;
  v_next_increment bigint;
  v_retry_after integer;
  v_now timestamptz := clock_timestamp();
begin
  if v_bidder_id is null then
    return jsonb_build_object('ok', false, 'code', 'AUTH_REQUIRED');
  end if;

  -- An accepted request remains idempotent and does not consume another slot.
  select * into v_existing
  from public.bids
  where bidder_id = v_bidder_id and request_key = p_request_key;
  if found then
    if v_existing.auction_id <> p_auction_id or v_existing.amount <> p_amount then
      return jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_KEY_REUSED');
    end if;
    return jsonb_build_object(
      'ok', true,
      'code', 'BID_ACCEPTED',
      'idempotent', true,
      'bid_id', v_existing.id,
      'amount', v_existing.amount
    );
  end if;

  -- Serialize attempts from the same account even when they target different lots.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_bidder_id::text, 0)
  );
  v_now := clock_timestamp();

  -- Recheck after the per-account lock so two simultaneous retries with the
  -- same idempotency key both resolve to the one accepted bid.
  select * into v_existing
  from public.bids
  where bidder_id = v_bidder_id and request_key = p_request_key;
  if found then
    if v_existing.auction_id <> p_auction_id or v_existing.amount <> p_amount then
      return jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_KEY_REUSED');
    end if;
    return jsonb_build_object(
      'ok', true,
      'code', 'BID_ACCEPTED',
      'idempotent', true,
      'bid_id', v_existing.id,
      'amount', v_existing.amount
    );
  end if;

  select max(created_at) into v_last_attempt_at
  from public.bid_attempts
  where bidder_id = v_bidder_id;

  if v_last_attempt_at is not null and v_last_attempt_at > v_now - interval '2 seconds' then
    v_retry_after := greatest(1, ceil(extract(epoch from (v_last_attempt_at + interval '2 seconds' - v_now)))::integer);
    insert into public.bid_attempts (
      bidder_id, auction_id, amount, request_key, outcome, reason_code,
      retry_after_seconds, created_at, completed_at
    ) values (
      v_bidder_id, p_auction_id, p_amount, p_request_key, 'rejected',
      'BID_RATE_LIMIT_SHORT', v_retry_after, v_now, v_now
    );
    return jsonb_build_object(
      'ok', false,
      'code', 'BID_RATE_LIMIT_SHORT',
      'retry_after_seconds', v_retry_after
    );
  end if;

  select count(*)::integer, min(created_at)
  into v_attempt_count, v_oldest_minute_attempt_at
  from public.bid_attempts
  where bidder_id = v_bidder_id
    and created_at > v_now - interval '60 seconds';

  if v_attempt_count >= 10 then
    v_retry_after := greatest(1, ceil(extract(epoch from (v_oldest_minute_attempt_at + interval '60 seconds' - v_now)))::integer);
    insert into public.bid_attempts (
      bidder_id, auction_id, amount, request_key, outcome, reason_code,
      retry_after_seconds, created_at, completed_at
    ) values (
      v_bidder_id, p_auction_id, p_amount, p_request_key, 'rejected',
      'BID_RATE_LIMIT_MINUTE', v_retry_after, v_now, v_now
    );
    return jsonb_build_object(
      'ok', false,
      'code', 'BID_RATE_LIMIT_MINUTE',
      'retry_after_seconds', v_retry_after
    );
  end if;

  insert into public.bid_attempts (
    bidder_id, auction_id, amount, request_key, outcome, created_at
  ) values (
    v_bidder_id, p_auction_id, p_amount, p_request_key, 'pending', v_now
  ) returning id into v_attempt_id;

  if p_auction_id is null or p_request_key is null or p_amount is null or p_amount <= 0 then
    update public.bid_attempts
    set outcome = 'rejected', reason_code = 'INVALID_BID_REQUEST', completed_at = clock_timestamp()
    where id = v_attempt_id;
    return jsonb_build_object('ok', false, 'code', 'INVALID_BID_REQUEST');
  end if;

  if not public.has_role('bidder', v_bidder_id) then
    update public.bid_attempts
    set outcome = 'rejected', reason_code = 'BIDDER_NOT_ELIGIBLE', completed_at = clock_timestamp()
    where id = v_attempt_id;
    return jsonb_build_object('ok', false, 'code', 'BIDDER_NOT_ELIGIBLE');
  end if;
  if not exists (
    select 1 from public.profiles
    where id = v_bidder_id and account_status = 'active' and email_verified
  ) then
    update public.bid_attempts
    set outcome = 'rejected', reason_code = 'VERIFIED_ACTIVE_ACCOUNT_REQUIRED', completed_at = clock_timestamp()
    where id = v_attempt_id;
    return jsonb_build_object('ok', false, 'code', 'VERIFIED_ACTIVE_ACCOUNT_REQUIRED');
  end if;
  if not exists (
    select 1 from public.bidder_verifications
    where user_id = v_bidder_id and status = 'approved'
  ) then
    update public.bid_attempts
    set outcome = 'rejected', reason_code = 'BIDDER_VERIFICATION_REQUIRED', completed_at = clock_timestamp()
    where id = v_attempt_id;
    return jsonb_build_object('ok', false, 'code', 'BIDDER_VERIFICATION_REQUIRED');
  end if;

  select * into v_auction
  from public.auctions
  where id = p_auction_id
  for update;

  if not found then
    update public.bid_attempts
    set outcome = 'rejected', reason_code = 'AUCTION_NOT_FOUND', completed_at = clock_timestamp()
    where id = v_attempt_id;
    return jsonb_build_object('ok', false, 'code', 'AUCTION_NOT_FOUND');
  end if;
  if v_auction.seller_id = v_bidder_id then
    update public.bid_attempts
    set outcome = 'rejected', reason_code = 'SELF_BIDDING_FORBIDDEN', completed_at = clock_timestamp()
    where id = v_attempt_id;
    return jsonb_build_object('ok', false, 'code', 'SELF_BIDDING_FORBIDDEN');
  end if;
  if v_auction.status <> 'live' then
    update public.bid_attempts
    set outcome = 'rejected', reason_code = 'AUCTION_NOT_LIVE', completed_at = clock_timestamp()
    where id = v_attempt_id;
    return jsonb_build_object('ok', false, 'code', 'AUCTION_NOT_LIVE');
  end if;
  if v_now < v_auction.starts_at or v_now >= v_auction.ends_at then
    update public.bid_attempts
    set outcome = 'rejected', reason_code = 'AUCTION_OUTSIDE_BIDDING_WINDOW', completed_at = clock_timestamp()
    where id = v_attempt_id;
    return jsonb_build_object('ok', false, 'code', 'AUCTION_OUTSIDE_BIDDING_WINDOW');
  end if;

  v_next_increment := public.bid_increment_for(v_auction.current_price);
  v_minimum := case
    when v_auction.bid_count = 0 then v_auction.opening_price
    else v_auction.current_price + v_next_increment
  end;
  if p_amount < v_minimum then
    update public.bid_attempts
    set outcome = 'rejected', reason_code = 'BID_BELOW_MINIMUM', completed_at = clock_timestamp()
    where id = v_attempt_id;
    return jsonb_build_object(
      'ok', false,
      'code', 'BID_BELOW_MINIMUM',
      'minimum_amount', v_minimum
    );
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

  update public.bid_attempts
  set outcome = 'accepted', reason_code = 'BID_ACCEPTED', completed_at = clock_timestamp()
  where id = v_attempt_id;

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
      'fee_vat_rate_bps', v_auction.buyer_fee_vat_rate_bps,
      'rate_limit_policy', '2_seconds_and_10_per_minute'
    )
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'BID_ACCEPTED',
    'idempotent', false,
    'bid_id', v_bid.id,
    'amount', v_bid.amount
  );
end;
$$;

-- Prevent authenticated clients from bypassing the throttled entry point.
revoke all on function public.place_bid(uuid, bigint, uuid) from public, anon, authenticated;
revoke all on function public.submit_bid(uuid, bigint, uuid) from public, anon;
grant execute on function public.submit_bid(uuid, bigint, uuid) to authenticated;

insert into public.audit_events (actor_id, event_type, entity_type, entity_id, payload)
values (
  null,
  'bids.rate_limit_installed',
  'system',
  'bid-rate-limit-2026-09-24',
  jsonb_build_object(
    'minimum_interval_seconds', 2,
    'maximum_attempts_per_minute', 10,
    'enforced_at', 'database'
  )
);
