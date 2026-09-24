-- Payment evidence and manual review workflow.
-- Live payment submission remains disabled until both the database setting and
-- the application environment flag are explicitly enabled by the owner.

alter table public.marketplace_settings
  add column if not exists payment_submission_enabled boolean not null default false;

create table if not exists public.payment_evidence_submissions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  buyer_id uuid not null references public.profiles (id) on delete restrict,
  request_key uuid not null,
  object_path text not null unique,
  original_name text not null check (char_length(original_name) between 1 and 255),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  byte_size bigint not null check (byte_size between 1 and 5242880),
  status text not null default 'submitted'
    check (status in ('submitted', 'approved', 'needs_correction')),
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  review_reason text,
  unique (buyer_id, request_key)
);

create index if not exists payment_evidence_order_submitted_idx
on public.payment_evidence_submissions (order_id, submitted_at desc);

alter table public.orders
  add column if not exists payment_review_state text not null default 'not_submitted'
    check (payment_review_state in ('not_submitted', 'submitted', 'needs_correction', 'approved')),
  add column if not exists payment_evidence_id uuid
    references public.payment_evidence_submissions (id) on delete restrict;

alter table public.payment_evidence_submissions enable row level security;
revoke all on public.payment_evidence_submissions from public, anon, authenticated;
grant select on public.payment_evidence_submissions to authenticated;

drop policy if exists "buyers and finance read payment evidence" on public.payment_evidence_submissions;
create policy "buyers and finance read payment evidence"
on public.payment_evidence_submissions for select to authenticated
using (
  buyer_id = auth.uid()
  or public.has_role('admin')
  or public.has_role('finance')
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payment-evidence',
  'payment-evidence',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

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
      and ms.payment_submission_enabled
  )
);

drop policy if exists "buyers and finance read payment evidence objects" on storage.objects;
create policy "buyers and finance read payment evidence objects"
on storage.objects for select to authenticated
using (
  bucket_id = 'payment-evidence'
  and (
    public.has_role('admin')
    or public.has_role('finance')
    or exists (
      select 1 from public.orders o
      where o.id::text = (storage.foldername(name))[2]
        and o.buyer_id = auth.uid()
        and (storage.foldername(name))[1] = auth.uid()::text
    )
  )
);

drop policy if exists "buyers remove unsubmitted payment evidence" on storage.objects;
create policy "buyers remove unsubmitted payment evidence"
on storage.objects for delete to authenticated
using (
  bucket_id = 'payment-evidence'
  and (storage.foldername(name))[1] = auth.uid()::text
  and exists (
    select 1 from public.orders o
    where o.id::text = (storage.foldername(name))[2]
      and o.buyer_id = auth.uid()
      and o.payment_review_state in ('not_submitted', 'needs_correction')
  )
);

create or replace function public.payment_submission_is_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select ms.payment_submission_enabled
    from public.marketplace_settings ms
    where ms.id = 1
  ), false);
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
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_existing
  from public.payment_evidence_submissions
  where buyer_id = v_user_id and request_key = p_request_key;
  if found then
    if v_existing.order_id <> p_order_id or v_existing.object_path <> p_object_path then
      raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = 'P0001';
    end if;
    return v_existing;
  end if;

  if not public.payment_submission_is_enabled() then
    raise exception 'PAYMENTS_DISABLED' using errcode = 'P0001';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_order.buyer_id <> v_user_id then raise exception 'ORDER_FORBIDDEN' using errcode = 'P0001'; end if;
  if v_order.status <> 'pending_payment' then
    raise exception 'ORDER_NOT_AWAITING_PAYMENT' using errcode = 'P0001';
  end if;
  if v_order.payment_due_at < now() then
    raise exception 'PAYMENT_WINDOW_EXPIRED' using errcode = 'P0001';
  end if;
  if v_order.payment_review_state not in ('not_submitted', 'needs_correction') then
    raise exception 'PAYMENT_ALREADY_SUBMITTED' using errcode = 'P0001';
  end if;
  if char_length(trim(p_original_name)) not between 1 and 255 then
    raise exception 'INVALID_ORIGINAL_NAME' using errcode = 'P0001';
  end if;
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
    order_id, buyer_id, request_key, object_path, original_name, mime_type, byte_size
  ) values (
    p_order_id, v_user_id, p_request_key, p_object_path, trim(p_original_name),
    v_object.mime_type, v_object.byte_size
  ) returning * into v_submission;

  update public.orders
  set payment_evidence_id = v_submission.id,
      payment_evidence_path = v_submission.object_path,
      payment_submitted_at = v_submission.submitted_at,
      payment_review_state = 'submitted',
      payment_reviewed_by = null,
      payment_reviewed_at = null,
      payment_review_reason = null
  where id = p_order_id;

  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, payload)
  values (
    v_user_id,
    'payment.evidence_submitted',
    'order',
    p_order_id::text,
    jsonb_build_object('submission_id', v_submission.id, 'request_key', p_request_key)
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
  if p_decision not in ('approve', 'needs_correction') then
    raise exception 'INVALID_PAYMENT_DECISION' using errcode = 'P0001';
  end if;
  if char_length(trim(p_reason)) not between 5 and 500 then
    raise exception 'REVIEW_REASON_REQUIRED' using errcode = 'P0001';
  end if;

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
  set status = case when p_decision = 'approve' then 'paid'::public.order_status else status end,
      payment_review_state = case when p_decision = 'approve' then 'approved' else 'needs_correction' end,
      payment_reviewed_by = v_actor_id,
      payment_reviewed_at = now(),
      payment_review_reason = trim(p_reason)
  where id = p_order_id
  returning * into v_order;

  if p_decision = 'approve' then
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
    case when p_decision = 'approve' then 'payment.approved' else 'payment.needs_correction' end,
    'order',
    p_order_id::text,
    jsonb_build_object('submission_id', v_submission.id, 'reason', trim(p_reason))
  );

  return v_order;
end;
$$;

revoke all on function public.payment_submission_is_enabled() from public, anon;
grant execute on function public.payment_submission_is_enabled() to authenticated;
revoke all on function public.submit_order_payment_evidence(uuid, text, text, uuid) from public, anon;
grant execute on function public.submit_order_payment_evidence(uuid, text, text, uuid) to authenticated;
revoke all on function public.review_order_payment(uuid, text, text) from public, anon;
grant execute on function public.review_order_payment(uuid, text, text) to authenticated;

insert into public.audit_events (actor_id, event_type, entity_type, entity_id, payload)
values (
  null,
  'payment.review_workflow_installed',
  'system',
  'manual-payment-evidence',
  jsonb_build_object(
    'payment_submission_enabled', false,
    'max_file_bytes', 5242880,
    'allowed_types', jsonb_build_array('image/jpeg', 'image/png', 'image/webp', 'application/pdf')
  )
);
