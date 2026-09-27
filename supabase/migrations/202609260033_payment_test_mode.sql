-- Isolated manual-payment sandbox.
-- Test evidence is enabled per order by an admin, remains visibly labelled,
-- and never advances an order to the paid/fulfillment states.

create table if not exists public.payment_test_orders (
  order_id uuid primary key references public.orders (id) on delete cascade,
  enabled_by uuid not null references public.profiles (id) on delete restrict,
  reason text not null check (char_length(reason) between 5 and 500),
  active boolean not null default true,
  enabled_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  check (expires_at > enabled_at)
);

alter table public.payment_evidence_submissions
  add column if not exists is_test boolean not null default false;

alter table public.orders
  add column if not exists payment_evidence_is_test boolean not null default false;

alter table public.payment_test_orders enable row level security;
revoke all on public.payment_test_orders from public, anon, authenticated;
grant select on public.payment_test_orders to authenticated;

drop policy if exists "admins read payment test orders" on public.payment_test_orders;
create policy "admins read payment test orders"
on public.payment_test_orders for select to authenticated
using (public.has_role('admin') or public.has_role('finance'));

create or replace function public.payment_submission_mode(
  p_order_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when coalesce((
      select ms.payment_submission_enabled
      from public.marketplace_settings ms
      where ms.id = 1
    ), false) then 'live'
    when exists (
      select 1
      from public.payment_test_orders pto
      where pto.order_id = p_order_id
        and pto.active
        and pto.expires_at >= now()
    ) then 'test'
    else 'disabled'
  end;
$$;

create or replace function public.enable_order_payment_test_mode(
  p_order_id uuid,
  p_reason text
)
returns public.payment_test_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_order public.orders%rowtype;
  v_test_order public.payment_test_orders%rowtype;
begin
  if v_actor_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  if not (public.has_role('admin', v_actor_id) or public.has_role('finance', v_actor_id)) then
    raise exception 'FINANCE_OR_ADMIN_REQUIRED' using errcode = 'P0001';
  end if;
  if char_length(trim(p_reason)) not between 5 and 500 then
    raise exception 'TEST_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_order.status <> 'pending_payment'
     or v_order.payment_review_state not in ('not_submitted', 'needs_correction') then
    raise exception 'ORDER_NOT_TESTABLE' using errcode = 'P0001';
  end if;
  if v_order.shipping_configured_at is null then
    raise exception 'SHIPPING_AMOUNT_REQUIRED' using errcode = 'P0001';
  end if;
  if v_order.payment_due_at < now() then
    raise exception 'PAYMENT_WINDOW_EXPIRED' using errcode = 'P0001';
  end if;

  insert into public.payment_test_orders (
    order_id, enabled_by, reason, active, enabled_at, expires_at
  ) values (
    p_order_id, v_actor_id, trim(p_reason), true, now(), now() + interval '24 hours'
  )
  on conflict (order_id) do update
  set enabled_by = excluded.enabled_by,
      reason = excluded.reason,
      active = true,
      enabled_at = excluded.enabled_at,
      expires_at = excluded.expires_at
  returning * into v_test_order;

  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, payload)
  values (
    v_actor_id,
    'payment.test_mode_enabled',
    'order',
    p_order_id::text,
    jsonb_build_object(
      'expires_at', v_test_order.expires_at,
      'reason', v_test_order.reason,
      'live_payment_enabled', false
    )
  );

  insert into public.notifications (
    user_id, notification_type, title, message, entity_type, entity_id, dedupe_key
  ) values (
    v_order.buyer_id,
    'payment_test_enabled',
    'เปิดทดสอบแนบสลิปแล้ว',
    'TEST — ไม่ใช่การชำระเงินจริง · คำสั่งซื้อ ' || v_order.order_number,
    'order',
    p_order_id::text,
    'payment-test-enabled:' || p_order_id::text || ':' || v_test_order.enabled_at::text
  ) on conflict (dedupe_key) do nothing;

  return v_test_order;
end;
$$;

create or replace function public.can_upload_payment_evidence(
  p_order_id text,
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
    from public.orders o
    where o.id::text = p_order_id
      and o.buyer_id = p_user_id
      and o.status = 'pending_payment'
      and o.payment_review_state in ('not_submitted', 'needs_correction')
      and o.payment_due_at >= now()
      and o.shipping_configured_at is not null
      and public.payment_submission_mode(o.id) in ('live', 'test')
  );
$$;

create or replace function public.submit_order_payment_evidence(
  p_order_id uuid,
  p_object_path text,
  p_original_name text,
  p_request_key uuid
)
returns public.payment_evidence_submissions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_order public.orders%rowtype;
  v_existing public.payment_evidence_submissions%rowtype;
  v_submission public.payment_evidence_submissions%rowtype;
  v_object record;
  v_mode text;
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;

  select * into v_existing
  from public.payment_evidence_submissions
  where buyer_id = v_user_id and request_key = p_request_key;
  if found then
    if v_existing.order_id <> p_order_id or v_existing.object_path <> p_object_path then
      raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = 'P0001';
    end if;
    return v_existing;
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_order.buyer_id <> v_user_id then raise exception 'ORDER_FORBIDDEN' using errcode = 'P0001'; end if;
  if v_order.status <> 'pending_payment' then raise exception 'ORDER_NOT_AWAITING_PAYMENT' using errcode = 'P0001'; end if;
  if v_order.payment_due_at < now() then raise exception 'PAYMENT_WINDOW_EXPIRED' using errcode = 'P0001'; end if;
  if v_order.shipping_configured_at is null then raise exception 'SHIPPING_AMOUNT_REQUIRED' using errcode = 'P0001'; end if;
  if v_order.payment_review_state not in ('not_submitted', 'needs_correction') then
    raise exception 'PAYMENT_ALREADY_SUBMITTED' using errcode = 'P0001';
  end if;

  v_mode := public.payment_submission_mode(p_order_id);
  if v_mode not in ('live', 'test') then raise exception 'PAYMENTS_DISABLED' using errcode = 'P0001'; end if;
  if char_length(trim(p_original_name)) not between 1 and 255 then raise exception 'INVALID_ORIGINAL_NAME' using errcode = 'P0001'; end if;
  if p_object_path not like v_user_id::text || '/' || p_order_id::text || '/%' then
    raise exception 'INVALID_OBJECT_PATH' using errcode = 'P0001';
  end if;

  select
    coalesce(nullif(so.metadata ->> 'mimetype', ''), 'application/octet-stream') as mime_type,
    coalesce((so.metadata ->> 'size')::bigint, 0) as byte_size
  into v_object
  from storage.objects so
  where so.bucket_id = 'payment-evidence' and so.name = p_object_path;

  if not found then raise exception 'EVIDENCE_OBJECT_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_object.mime_type not in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf') then
    raise exception 'INVALID_EVIDENCE_TYPE' using errcode = 'P0001';
  end if;
  if v_object.byte_size < 1 or v_object.byte_size > 5242880 then
    raise exception 'INVALID_EVIDENCE_SIZE' using errcode = 'P0001';
  end if;

  insert into public.payment_evidence_submissions (
    order_id, buyer_id, request_key, object_path, original_name, mime_type, byte_size, is_test
  ) values (
    p_order_id, v_user_id, p_request_key, p_object_path, trim(p_original_name),
    v_object.mime_type, v_object.byte_size, v_mode = 'test'
  ) returning * into v_submission;

  update public.orders
  set payment_evidence_id = v_submission.id,
      payment_evidence_path = v_submission.object_path,
      payment_evidence_is_test = v_submission.is_test,
      payment_submitted_at = v_submission.submitted_at,
      payment_review_state = 'submitted',
      payment_reviewed_by = null,
      payment_reviewed_at = null,
      payment_review_reason = null
  where id = p_order_id;

  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, payload)
  values (
    v_user_id,
    case when v_submission.is_test then 'payment.test_evidence_submitted' else 'payment.evidence_submitted' end,
    'order',
    p_order_id::text,
    jsonb_build_object(
      'submission_id', v_submission.id,
      'request_key', p_request_key,
      'is_test', v_submission.is_test
    )
  );

  return v_submission;
end;
$$;

create or replace function public.review_order_payment(
  p_order_id uuid,
  p_decision text,
  p_reason text
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_order public.orders%rowtype;
  v_submission public.payment_evidence_submissions%rowtype;
  v_title text;
  v_message text;
begin
  if v_actor_id is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;
  if not (public.has_role('admin', v_actor_id) or public.has_role('finance', v_actor_id)) then
    raise exception 'FINANCE_OR_ADMIN_REQUIRED' using errcode = 'P0001';
  end if;
  if p_decision not in ('approve', 'needs_correction') then raise exception 'INVALID_PAYMENT_DECISION' using errcode = 'P0001'; end if;
  if char_length(trim(p_reason)) not between 5 and 500 then raise exception 'REVIEW_REASON_REQUIRED' using errcode = 'P0001'; end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_order.status <> 'pending_payment' or v_order.payment_review_state <> 'submitted' then
    raise exception 'PAYMENT_NOT_REVIEWABLE' using errcode = 'P0001';
  end if;

  select * into v_submission
  from public.payment_evidence_submissions
  where id = v_order.payment_evidence_id and order_id = p_order_id
  for update;
  if not found or v_submission.status <> 'submitted' then
    raise exception 'PAYMENT_SUBMISSION_NOT_FOUND' using errcode = 'P0001';
  end if;

  update public.payment_evidence_submissions
  set status = case when p_decision = 'approve' then 'approved' else 'needs_correction' end,
      reviewed_by = v_actor_id,
      reviewed_at = now(),
      review_reason = trim(p_reason)
  where id = v_submission.id;

  update public.orders
  set status = case
        when p_decision = 'approve' and not v_submission.is_test then 'paid'::public.order_status
        else status
      end,
      payment_review_state = case when p_decision = 'approve' then 'approved' else 'needs_correction' end,
      payment_reviewed_by = v_actor_id,
      payment_reviewed_at = now(),
      payment_review_reason = trim(p_reason)
  where id = p_order_id
  returning * into v_order;

  if v_submission.is_test then
    v_title := case when p_decision = 'approve' then 'ตรวจหลักฐานทดสอบแล้ว' else 'ส่งหลักฐานทดสอบกลับให้แก้ไข' end;
    v_message := 'TEST — ไม่ใช่การชำระเงินจริง · คำสั่งซื้อ ' || v_order.order_number;
  elsif p_decision = 'approve' then
    v_title := 'ตรวจสอบยอดชำระแล้ว';
    v_message := 'คำสั่งซื้อ ' || v_order.order_number || ' ผ่านการตรวจสอบแล้ว';
  else
    v_title := 'กรุณาส่งหลักฐานการชำระใหม่';
    v_message := 'คำสั่งซื้อ ' || v_order.order_number || ' ต้องแก้ไขหลักฐาน: ' || trim(p_reason);
  end if;

  insert into public.notifications (
    user_id, notification_type, title, message, entity_type, entity_id, dedupe_key
  ) values (
    v_order.buyer_id,
    case when p_decision = 'approve' then 'payment_approved' else 'payment_needs_correction' end,
    v_title,
    v_message,
    'order',
    p_order_id::text,
    'payment-review:' || v_submission.id::text || ':' || p_decision
  ) on conflict (dedupe_key) do nothing;

  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, payload)
  values (
    v_actor_id,
    case
      when v_submission.is_test and p_decision = 'approve' then 'payment.test_approved'
      when v_submission.is_test then 'payment.test_needs_correction'
      when p_decision = 'approve' then 'payment.approved'
      else 'payment.needs_correction'
    end,
    'order',
    p_order_id::text,
    jsonb_build_object(
      'submission_id', v_submission.id,
      'reason', trim(p_reason),
      'is_test', v_submission.is_test,
      'order_marked_paid', p_decision = 'approve' and not v_submission.is_test
    )
  );

  return v_order;
end;
$$;

revoke all on function public.payment_submission_mode(uuid) from public, anon;
grant execute on function public.payment_submission_mode(uuid) to authenticated;
revoke all on function public.enable_order_payment_test_mode(uuid, text) from public, anon;
grant execute on function public.enable_order_payment_test_mode(uuid, text) to authenticated;
revoke all on function public.can_upload_payment_evidence(text, uuid) from public, anon;
grant execute on function public.can_upload_payment_evidence(text, uuid) to authenticated;
revoke all on function public.submit_order_payment_evidence(uuid, text, text, uuid) from public, anon;
grant execute on function public.submit_order_payment_evidence(uuid, text, text, uuid) to authenticated;
revoke all on function public.review_order_payment(uuid, text, text) from public, anon;
grant execute on function public.review_order_payment(uuid, text, text) to authenticated;

insert into public.audit_events (actor_id, event_type, entity_type, entity_id, payload)
values (
  null,
  'payment.test_mode_installed',
  'system',
  'manual-payment-test-mode-2026-09-26',
  jsonb_build_object(
    'scope', 'per_order_admin_activation',
    'expires_after_hours', 24,
    'marks_order_paid', false,
    'live_payment_enabled', false
  )
);
