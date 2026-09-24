-- Auditable admin review transition for pending auctions.

alter table public.auctions
  add column if not exists review_notes text,
  add column if not exists reviewed_by uuid references public.profiles (id) on delete set null,
  add column if not exists reviewed_at timestamptz;

create or replace function public.review_auction(
  p_auction_id uuid,
  p_decision text,
  p_reason text
)
returns public.auction_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_id uuid := auth.uid();
  v_auction public.auctions;
  v_target_status public.auction_status;
  v_event_type text;
begin
  if v_admin_id is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  if not public.has_role('admin', v_admin_id) then
    raise exception using errcode = '42501', message = 'ADMIN_ROLE_REQUIRED';
  end if;

  if char_length(trim(coalesce(p_reason, ''))) not between 5 and 500 then
    raise exception using errcode = '22023', message = 'REVIEW_REASON_REQUIRED';
  end if;

  if p_decision not in ('approve', 'reject') then
    raise exception using errcode = '22023', message = 'INVALID_REVIEW_DECISION';
  end if;

  select * into v_auction
  from public.auctions
  where id = p_auction_id
  for update;

  if v_auction.id is null then
    raise exception using errcode = 'P0002', message = 'AUCTION_NOT_FOUND';
  end if;

  if p_decision = 'approve' and v_auction.status in ('scheduled', 'live') then
    return v_auction.status;
  end if;

  if p_decision = 'reject' and v_auction.status = 'rejected' then
    return v_auction.status;
  end if;

  if v_auction.status <> 'pending_review' then
    raise exception using errcode = '22023', message = 'INVALID_AUCTION_STATE';
  end if;

  if p_decision = 'approve' then
    if v_auction.ends_at <= now() then
      raise exception using errcode = '22023', message = 'AUCTION_WINDOW_ENDED';
    end if;
    v_target_status := case when v_auction.starts_at <= now() then 'live' else 'scheduled' end;
    v_event_type := 'auction.approved';
  else
    v_target_status := 'rejected';
    v_event_type := 'auction.rejected';
  end if;

  update public.auctions
  set status = v_target_status,
      review_notes = trim(p_reason),
      reviewed_by = v_admin_id,
      reviewed_at = now(),
      version = version + 1
  where id = p_auction_id
  returning * into v_auction;

  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, payload)
  values (
    v_admin_id,
    v_event_type,
    'auction',
    v_auction.id::text,
    jsonb_build_object(
      'from_status', 'pending_review',
      'to_status', v_auction.status,
      'reason', trim(p_reason),
      'version', v_auction.version,
      'starts_at', v_auction.starts_at,
      'ends_at', v_auction.ends_at,
      'payments_enabled', false
    )
  );

  return v_auction.status;
end;
$$;

revoke all on function public.review_auction(uuid, text, text) from public, anon;
grant execute on function public.review_auction(uuid, text, text) to authenticated;

