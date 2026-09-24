-- BBK AUCTION: free bidder approval using confirmed email + admin review.
-- Supersedes the Twilio/phone requirement from migration 012 without deleting
-- historical phone data. Supabase Auth remains the email source of truth.

create or replace function public.submit_bidder_approval_request()
returns public.bidder_verifications
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
  if not public.has_role('bidder', v_user_id) then
    raise exception 'BIDDER_NOT_ELIGIBLE' using errcode = 'P0001';
  end if;
  if not exists (
    select 1
    from public.profiles
    where id = v_user_id
      and account_status = 'active'
      and email_verified
  ) then
    raise exception 'VERIFIED_ACTIVE_ACCOUNT_REQUIRED' using errcode = 'P0001';
  end if;

  -- Serialize duplicate clicks without depending on a client-side disabled button.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text, 0));

  select * into v_row
  from public.bidder_verifications
  where user_id = v_user_id
  for update;

  if found then
    if v_row.status = 'suspended' then
      raise exception 'BIDDER_SUSPENDED' using errcode = 'P0001';
    end if;
    if v_row.status in ('pending_review', 'approved') then
      return v_row;
    end if;

    update public.bidder_verifications
    set status = 'pending_review',
        review_reason = null,
        reviewed_by = null,
        reviewed_at = null
    where user_id = v_user_id
    returning * into v_row;
  else
    insert into public.bidder_verifications (user_id, status)
    values (v_user_id, 'pending_review')
    returning * into v_row;
  end if;

  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, payload)
  values (
    v_user_id,
    'identity.bidder_review_requested',
    'profile',
    v_user_id::text,
    jsonb_build_object('method', 'confirmed_email_admin_review')
  );

  return v_row;
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
  if v_row.status <> 'pending_review' then
    raise exception 'REVIEW_NOT_PENDING' using errcode = 'P0001';
  end if;
  if p_decision = 'approve' and not exists (
    select 1
    from public.profiles
    where id = p_user_id
      and account_status = 'active'
      and email_verified
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
    jsonb_build_object(
      'reason', trim(p_reason),
      'method', 'confirmed_email_admin_review'
    )
  );

  return v_row;
end;
$$;

-- Keep bid acceptance database-authoritative while removing the phone OTP gate.
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

revoke all on function public.submit_bidder_approval_request() from public, anon;
grant execute on function public.submit_bidder_approval_request() to authenticated;
revoke all on function public.reserve_phone_verification_send(text) from public, anon, authenticated;
revoke all on function public.confirm_phone_verification(text) from public, anon, authenticated;
revoke all on function public.review_bidder_verification(uuid, text, text) from public, anon;
grant execute on function public.review_bidder_verification(uuid, text, text) to authenticated;
revoke all on function public.place_bid(uuid, bigint, uuid) from public, anon;
grant execute on function public.place_bid(uuid, bigint, uuid) to authenticated;
