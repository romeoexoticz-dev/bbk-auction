-- BBK AUCTION: phone OTP + manual bidder approval.
-- OTP codes stay with Twilio Verify and are never stored in Postgres.

create type public.bidder_verification_status as enum (
  'unverified', 'pending_review', 'approved', 'rejected', 'suspended'
);

create table public.bidder_verifications (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  phone_e164 text unique,
  phone_verified_at timestamptz,
  status public.bidder_verification_status not null default 'unverified',
  review_reason text,
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  otp_last_sent_at timestamptz,
  otp_window_started_at timestamptz,
  otp_send_count integer not null default 0 check (otp_send_count between 0 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bidder_phone_e164_format check (
    phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'
  ),
  constraint bidder_phone_verified_consistent check (
    phone_verified_at is null or phone_e164 is not null
  )
);

create trigger bidder_verifications_set_updated_at
before update on public.bidder_verifications
for each row execute function public.set_updated_at();

alter table public.bidder_verifications enable row level security;

create policy "users read own bidder verification"
on public.bidder_verifications for select to authenticated
using (user_id = auth.uid() or public.has_role('admin'));

revoke all on public.bidder_verifications from anon, authenticated;
grant select on public.bidder_verifications to authenticated;

create or replace function public.reserve_phone_verification_send(p_phone_e164 text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.bidder_verifications%rowtype;
  v_now timestamptz := now();
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  if p_phone_e164 !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'INVALID_PHONE' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = v_user_id and account_status = 'active' and email_verified
  ) then
    raise exception 'VERIFIED_ACTIVE_ACCOUNT_REQUIRED' using errcode = 'P0001';
  end if;

  insert into public.bidder_verifications (user_id)
  values (v_user_id)
  on conflict (user_id) do nothing;

  select * into v_row
  from public.bidder_verifications
  where user_id = v_user_id
  for update;

  if v_row.status = 'suspended' then
    raise exception 'BIDDER_SUSPENDED' using errcode = 'P0001';
  end if;
  if v_row.status = 'approved' and v_row.phone_e164 is distinct from p_phone_e164 then
    raise exception 'ADMIN_RESET_REQUIRED' using errcode = 'P0001';
  end if;
  if v_row.otp_last_sent_at is not null and v_row.otp_last_sent_at > v_now - interval '60 seconds' then
    raise exception 'OTP_COOLDOWN' using errcode = 'P0001';
  end if;

  if v_row.otp_window_started_at is null or v_row.otp_window_started_at <= v_now - interval '24 hours' then
    v_row.otp_window_started_at := v_now;
    v_row.otp_send_count := 0;
  end if;
  if v_row.otp_send_count >= 5 then
    raise exception 'OTP_DAILY_LIMIT' using errcode = 'P0001';
  end if;

  begin
    update public.bidder_verifications
    set phone_e164 = p_phone_e164,
        phone_verified_at = case when phone_e164 is distinct from p_phone_e164 then null else phone_verified_at end,
        status = case
          when status = 'approved' and phone_e164 = p_phone_e164 then status
          else 'unverified'::public.bidder_verification_status
        end,
        review_reason = case when status = 'approved' then review_reason else null end,
        reviewed_by = case when status = 'approved' then reviewed_by else null end,
        reviewed_at = case when status = 'approved' then reviewed_at else null end,
        otp_last_sent_at = v_now,
        otp_window_started_at = v_row.otp_window_started_at,
        otp_send_count = v_row.otp_send_count + 1
    where user_id = v_user_id;
  exception when unique_violation then
    raise exception 'PHONE_UNAVAILABLE' using errcode = 'P0001';
  end;

  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, payload)
  values (
    v_user_id,
    'identity.phone_otp_requested',
    'profile',
    v_user_id::text,
    jsonb_build_object('phone_last4', right(p_phone_e164, 4))
  );

  return true;
end;
$$;

create or replace function public.confirm_phone_verification(p_phone_e164 text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.bidder_verifications%rowtype;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_row
  from public.bidder_verifications
  where user_id = v_user_id
  for update;

  if not found or v_row.phone_e164 is distinct from p_phone_e164 then
    raise exception 'PHONE_REQUEST_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_row.status = 'suspended' then
    raise exception 'BIDDER_SUSPENDED' using errcode = 'P0001';
  end if;

  update public.bidder_verifications
  set phone_verified_at = now(),
      status = case
        when status = 'approved' then status
        else 'pending_review'::public.bidder_verification_status
      end,
      review_reason = case when status = 'approved' then review_reason else null end,
      reviewed_by = case when status = 'approved' then reviewed_by else null end,
      reviewed_at = case when status = 'approved' then reviewed_at else null end
  where user_id = v_user_id;

  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, payload)
  values (
    v_user_id,
    'identity.phone_verified',
    'profile',
    v_user_id::text,
    jsonb_build_object('phone_last4', right(p_phone_e164, 4))
  );

  return true;
end;
$$;

create or replace function public.review_bidder_verification(
  p_user_id uuid,
  p_decision text,
  p_reason text
)
returns public.bidder_verifications
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.bidder_verifications%rowtype;
  v_status public.bidder_verification_status;
begin
  if not public.has_role('admin', auth.uid()) then
    raise exception 'ADMIN_REQUIRED' using errcode = 'P0001';
  end if;
  if p_decision not in ('approve', 'reject') then
    raise exception 'INVALID_DECISION' using errcode = 'P0001';
  end if;
  if char_length(trim(coalesce(p_reason, ''))) < 5 or char_length(p_reason) > 500 then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_row
  from public.bidder_verifications
  where user_id = p_user_id
  for update;

  if not found then
    raise exception 'VERIFICATION_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_row.phone_verified_at is null then
    raise exception 'PHONE_NOT_VERIFIED' using errcode = 'P0001';
  end if;
  if p_decision = 'approve' and not exists (
    select 1 from public.profiles
    where id = p_user_id and account_status = 'active' and email_verified
  ) then
    raise exception 'VERIFIED_ACTIVE_ACCOUNT_REQUIRED' using errcode = 'P0001';
  end if;

  v_status := case
    when p_decision = 'approve' then 'approved'::public.bidder_verification_status
    else 'rejected'::public.bidder_verification_status
  end;

  update public.bidder_verifications
  set status = v_status,
      review_reason = trim(p_reason),
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where user_id = p_user_id
  returning * into v_row;

  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, payload)
  values (
    auth.uid(),
    case when p_decision = 'approve' then 'identity.bidder_approved' else 'identity.bidder_rejected' end,
    'profile',
    p_user_id::text,
    jsonb_build_object('reason', trim(p_reason), 'phone_last4', right(v_row.phone_e164, 4))
  );

  return v_row;
end;
$$;

-- Add phone verification + admin approval to the database-authoritative bid gate.
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
  if not exists (
    select 1 from public.bidder_verifications
    where user_id = v_bidder_id
      and status = 'approved'
      and phone_verified_at is not null
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

revoke all on function public.reserve_phone_verification_send(text) from public, anon;
grant execute on function public.reserve_phone_verification_send(text) to authenticated;
revoke all on function public.confirm_phone_verification(text) from public, anon;
grant execute on function public.confirm_phone_verification(text) to authenticated;
revoke all on function public.review_bidder_verification(uuid, text, text) from public, anon;
grant execute on function public.review_bidder_verification(uuid, text, text) to authenticated;

