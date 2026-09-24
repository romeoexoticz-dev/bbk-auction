-- Per-order shipping configuration and controlled fulfillment transitions.
-- Approved by the owner on 2026-09-23. Delivery confirmation and completion
-- remain out of scope until the inspection/dispute window is approved.

alter table public.orders
  add column if not exists shipping_configured_by uuid references public.profiles (id) on delete set null,
  add column if not exists shipping_configured_at timestamptz,
  add column if not exists shipping_note text,
  add column if not exists preparing_at timestamptz;

create table if not exists public.order_shipping_adjustments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  actor_id uuid not null references public.profiles (id) on delete restrict,
  request_key uuid not null,
  shipping_amount bigint not null check (shipping_amount >= 0),
  reason text not null check (char_length(reason) between 5 and 500),
  created_at timestamptz not null default now(),
  unique (actor_id, request_key)
);

create table if not exists public.order_fulfillment_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  actor_id uuid not null references public.profiles (id) on delete restrict,
  request_key uuid not null,
  action text not null check (action in ('prepare', 'ship')),
  from_status public.order_status not null,
  to_status public.order_status not null,
  carrier text,
  tracking_number text,
  reason text not null check (char_length(reason) between 5 and 500),
  created_at timestamptz not null default now(),
  unique (actor_id, request_key)
);

alter table public.order_shipping_adjustments enable row level security;
alter table public.order_fulfillment_events enable row level security;
revoke all on public.order_shipping_adjustments from public, anon, authenticated;
revoke all on public.order_fulfillment_events from public, anon, authenticated;
grant select on public.order_shipping_adjustments to authenticated;
grant select on public.order_fulfillment_events to authenticated;

drop policy if exists "admins read shipping adjustments" on public.order_shipping_adjustments;
create policy "admins read shipping adjustments"
on public.order_shipping_adjustments for select to authenticated
using (public.has_role('admin') or public.has_role('finance'));

drop policy if exists "admins read fulfillment events" on public.order_fulfillment_events;
create policy "admins read fulfillment events"
on public.order_fulfillment_events for select to authenticated
using (public.has_role('admin'));

create or replace function public.configure_order_shipping(
  p_order_id uuid,
  p_shipping_amount bigint,
  p_reason text,
  p_request_key uuid
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_order public.orders%rowtype;
  v_existing public.order_shipping_adjustments%rowtype;
  v_adjustment public.order_shipping_adjustments%rowtype;
begin
  if v_actor_id is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;
  if not (public.has_role('admin', v_actor_id) or public.has_role('finance', v_actor_id)) then
    raise exception 'FINANCE_OR_ADMIN_REQUIRED' using errcode = 'P0001';
  end if;
  if p_shipping_amount is null or p_shipping_amount < 0 then
    raise exception 'INVALID_SHIPPING_AMOUNT' using errcode = 'P0001';
  end if;
  if char_length(trim(p_reason)) not between 5 and 500 then
    raise exception 'SHIPPING_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_existing
  from public.order_shipping_adjustments
  where actor_id = v_actor_id and request_key = p_request_key;
  if found then
    if v_existing.order_id <> p_order_id or v_existing.shipping_amount <> p_shipping_amount then
      raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = 'P0001';
    end if;
    select * into v_order from public.orders where id = p_order_id;
    return v_order;
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_order.status <> 'pending_payment' then
    raise exception 'SHIPPING_AMOUNT_LOCKED_AFTER_PAYMENT' using errcode = 'P0001';
  end if;
  if v_order.payment_review_state not in ('not_submitted', 'needs_correction') then
    raise exception 'SHIPPING_AMOUNT_LOCKED_AFTER_SUBMISSION' using errcode = 'P0001';
  end if;

  insert into public.order_shipping_adjustments (
    order_id, actor_id, request_key, shipping_amount, reason
  ) values (
    p_order_id, v_actor_id, p_request_key, p_shipping_amount, trim(p_reason)
  ) returning * into v_adjustment;

  update public.orders
  set shipping_amount = p_shipping_amount,
      shipping_configured_by = v_actor_id,
      shipping_configured_at = now(),
      shipping_note = trim(p_reason)
  where id = p_order_id
  returning * into v_order;

  insert into public.notifications (
    user_id, notification_type, title, message, entity_type, entity_id, dedupe_key
  ) values (
    v_order.buyer_id,
    'shipping_amount_configured',
    'กำหนดค่าจัดส่งแล้ว',
    'ตรวจสอบยอดรวมล่าสุดของคำสั่งซื้อ ' || v_order.order_number,
    'order',
    p_order_id::text,
    'shipping-configured:' || v_adjustment.id::text
  ) on conflict (dedupe_key) do nothing;

  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, payload)
  values (
    v_actor_id,
    'shipping.amount_configured',
    'order',
    p_order_id::text,
    jsonb_build_object(
      'adjustment_id', v_adjustment.id,
      'shipping_amount', p_shipping_amount,
      'total_amount', v_order.total_amount,
      'reason', trim(p_reason)
    )
  );

  return v_order;
end;
$$;

create or replace function public.advance_order_fulfillment(
  p_order_id uuid,
  p_action text,
  p_carrier text,
  p_tracking_number text,
  p_reason text,
  p_request_key uuid
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_order public.orders%rowtype;
  v_existing public.order_fulfillment_events%rowtype;
  v_event public.order_fulfillment_events%rowtype;
  v_from_status public.order_status;
  v_to_status public.order_status;
  v_title text;
  v_message text;
begin
  if v_actor_id is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;
  if not public.has_role('admin', v_actor_id) then
    raise exception 'ADMIN_REQUIRED' using errcode = 'P0001';
  end if;
  if p_action not in ('prepare', 'ship') then
    raise exception 'INVALID_FULFILLMENT_ACTION' using errcode = 'P0001';
  end if;
  if char_length(trim(p_reason)) not between 5 and 500 then
    raise exception 'FULFILLMENT_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_existing
  from public.order_fulfillment_events
  where actor_id = v_actor_id and request_key = p_request_key;
  if found then
    if v_existing.order_id <> p_order_id or v_existing.action <> p_action then
      raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = 'P0001';
    end if;
    select * into v_order from public.orders where id = p_order_id;
    return v_order;
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001'; end if;
  v_from_status := v_order.status;

  if p_action = 'prepare' then
    if v_order.status <> 'paid' or v_order.payment_review_state <> 'approved' then
      raise exception 'ORDER_NOT_READY_TO_PREPARE' using errcode = 'P0001';
    end if;
    v_to_status := 'preparing';
    update public.orders
    set status = v_to_status, preparing_at = now()
    where id = p_order_id
    returning * into v_order;
    v_title := 'ร้านกำลังเตรียมจัดส่ง';
    v_message := 'คำสั่งซื้อ ' || v_order.order_number || ' อยู่ระหว่างเตรียมบรรจุและจัดส่ง';
  else
    if v_order.status <> 'preparing' then
      raise exception 'ORDER_NOT_READY_TO_SHIP' using errcode = 'P0001';
    end if;
    if char_length(trim(coalesce(p_carrier, ''))) not between 2 and 80 then
      raise exception 'CARRIER_REQUIRED' using errcode = 'P0001';
    end if;
    if char_length(trim(coalesce(p_tracking_number, ''))) not between 3 and 100 then
      raise exception 'TRACKING_NUMBER_REQUIRED' using errcode = 'P0001';
    end if;
    v_to_status := 'shipped';
    update public.orders
    set status = v_to_status,
        carrier = trim(p_carrier),
        tracking_number = trim(p_tracking_number),
        shipped_at = now()
    where id = p_order_id
    returning * into v_order;
    v_title := 'จัดส่งสินค้าแล้ว';
    v_message := trim(p_carrier) || ' · เลขพัสดุ ' || trim(p_tracking_number);
  end if;

  insert into public.order_fulfillment_events (
    order_id, actor_id, request_key, action, from_status, to_status,
    carrier, tracking_number, reason
  ) values (
    p_order_id, v_actor_id, p_request_key, p_action, v_from_status, v_to_status,
    nullif(trim(coalesce(p_carrier, '')), ''),
    nullif(trim(coalesce(p_tracking_number, '')), ''),
    trim(p_reason)
  ) returning * into v_event;

  insert into public.notifications (
    user_id, notification_type, title, message, entity_type, entity_id, dedupe_key
  ) values (
    v_order.buyer_id,
    case when p_action = 'prepare' then 'order_preparing' else 'order_shipped' end,
    v_title,
    v_message,
    'order',
    p_order_id::text,
    'fulfillment:' || v_event.id::text
  ) on conflict (dedupe_key) do nothing;

  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, payload)
  values (
    v_actor_id,
    case when p_action = 'prepare' then 'shipping.preparing' else 'shipping.shipped' end,
    'order',
    p_order_id::text,
    jsonb_build_object(
      'fulfillment_event_id', v_event.id,
      'from_status', v_from_status,
      'to_status', v_to_status,
      'carrier', nullif(trim(coalesce(p_carrier, '')), ''),
      'tracking_number', nullif(trim(coalesce(p_tracking_number, '')), ''),
      'reason', trim(p_reason)
    )
  );

  return v_order;
end;
$$;

create or replace function public.enforce_shipping_before_payment_evidence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.orders o
    where o.id = new.order_id
      and o.buyer_id = new.buyer_id
      and o.shipping_configured_at is not null
  ) then
    raise exception 'SHIPPING_AMOUNT_REQUIRED' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists payment_evidence_requires_shipping on public.payment_evidence_submissions;
create trigger payment_evidence_requires_shipping
before insert on public.payment_evidence_submissions
for each row execute function public.enforce_shipping_before_payment_evidence();

drop policy if exists "buyers upload payment evidence while enabled" on storage.objects;
create policy "buyers upload payment evidence while enabled"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'payment-evidence'
  and (storage.foldername(name))[1] = auth.uid()::text
  and exists (
    select 1
    from public.orders o
    join public.marketplace_settings ms on ms.id = 1
    where o.id::text = (storage.foldername(name))[2]
      and o.buyer_id = auth.uid()
      and o.status = 'pending_payment'
      and o.payment_review_state in ('not_submitted', 'needs_correction')
      and o.payment_due_at >= now()
      and o.shipping_configured_at is not null
      and ms.payment_submission_enabled
  )
);

revoke all on function public.configure_order_shipping(uuid, bigint, text, uuid) from public, anon;
grant execute on function public.configure_order_shipping(uuid, bigint, text, uuid) to authenticated;
revoke all on function public.advance_order_fulfillment(uuid, text, text, text, text, uuid) from public, anon;
grant execute on function public.advance_order_fulfillment(uuid, text, text, text, text, uuid) to authenticated;
revoke all on function public.enforce_shipping_before_payment_evidence() from public, anon, authenticated;

insert into public.audit_events (actor_id, event_type, entity_type, entity_id, payload)
values (
  null,
  'shipping.workflow_installed',
  'system',
  'manual-per-order-shipping',
  jsonb_build_object(
    'shipping_amount_mode', 'admin_per_order_before_payment',
    'allowed_fulfillment_actions', jsonb_build_array('prepare', 'ship'),
    'delivery_confirmation_enabled', false,
    'payments_enabled', false,
    'approved_date', '2026-09-23'
  )
);
