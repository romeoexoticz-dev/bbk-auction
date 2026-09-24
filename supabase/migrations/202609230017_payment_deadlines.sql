-- Automatic payment reminders, expiry, and repeated non-payment review.
-- Customer-facing actions are gated by marketplace_settings.payment_submission_enabled.

create extension if not exists pg_cron with schema pg_catalog;

alter table public.orders
  add column if not exists payment_expired_at timestamptz;

create or replace function public.set_payment_deadline_when_total_ready()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.shipping_configured_at is null and new.shipping_configured_at is not null then
    new.payment_due_at := now() + interval '24 hours';
  end if;
  return new;
end;
$$;

drop trigger if exists orders_set_payment_deadline_when_total_ready on public.orders;
create trigger orders_set_payment_deadline_when_total_ready
before update of shipping_configured_at on public.orders
for each row execute function public.set_payment_deadline_when_total_ready();

create table if not exists public.order_payment_expirations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders (id) on delete restrict,
  buyer_id uuid not null references public.profiles (id) on delete restrict,
  strike_number integer not null check (strike_number >= 1),
  expired_at timestamptz not null default now()
);

create table if not exists public.payment_default_cases (
  user_id uuid primary key references public.profiles (id) on delete restrict,
  strike_count integer not null default 0 check (strike_count >= 0),
  review_status text not null default 'warning'
    check (review_status in ('warning', 'pending_review', 'reinstated', 'kept_suspended')),
  last_expired_order_id uuid references public.orders (id) on delete restrict,
  last_expired_at timestamptz,
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  review_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.order_payment_expirations enable row level security;
alter table public.payment_default_cases enable row level security;
revoke all on public.order_payment_expirations from public, anon, authenticated;
revoke all on public.payment_default_cases from public, anon, authenticated;
grant select on public.order_payment_expirations to authenticated;
grant select on public.payment_default_cases to authenticated;

drop policy if exists "buyers and admins read payment expirations" on public.order_payment_expirations;
create policy "buyers and admins read payment expirations"
on public.order_payment_expirations for select to authenticated
using (buyer_id = auth.uid() or public.has_role('admin'));

drop policy if exists "users and admins read payment default cases" on public.payment_default_cases;
create policy "users and admins read payment default cases"
on public.payment_default_cases for select to authenticated
using (user_id = auth.uid() or public.has_role('admin'));

create or replace function public.send_due_payment_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
begin
  if not public.payment_submission_is_enabled() then return 0; end if;

  with inserted as (
    insert into public.notifications (
      user_id, notification_type, title, message, entity_type, entity_id, dedupe_key
    )
    select
      o.buyer_id,
      'payment_due_soon',
      'ใกล้ครบกำหนดชำระเงิน',
      'คำสั่งซื้อ ' || o.order_number || ' จะครบกำหนดภายใน 2 ชั่วโมง',
      'order',
      o.id::text,
      'payment-due-reminder:' || o.id::text
    from public.orders o
    where o.status = 'pending_payment'
      and o.payment_review_state in ('not_submitted', 'needs_correction')
      and o.shipping_configured_at is not null
      and o.payment_due_at > now()
      and o.payment_due_at <= now() + interval '2 hours'
    on conflict (dedupe_key) do nothing
    returning 1
  )
  select count(*) into v_count from inserted;

  return v_count;
end;
$$;

create or replace function public.expire_due_orders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_expiration public.order_payment_expirations%rowtype;
  v_case public.payment_default_cases%rowtype;
  v_expired integer := 0;
begin
  if not public.payment_submission_is_enabled() then return 0; end if;

  for v_order in
    select *
    from public.orders
    where status = 'pending_payment'
      and payment_review_state in ('not_submitted', 'needs_correction')
      and shipping_configured_at is not null
      and payment_due_at <= now()
    order by payment_due_at asc
    for update skip locked
  loop
    if exists (
      select 1 from public.order_payment_expirations where order_id = v_order.id
    ) then
      continue;
    end if;

    insert into public.payment_default_cases (
      user_id, strike_count, review_status, last_expired_order_id,
      last_expired_at, reviewed_by, reviewed_at, review_reason
    ) values (
      v_order.buyer_id, 1, 'warning', v_order.id, now(), null, null, null
    )
    on conflict (user_id) do update
    set strike_count = public.payment_default_cases.strike_count + 1,
        review_status = case
          when public.payment_default_cases.strike_count + 1 >= 2 then 'pending_review'
          else 'warning'
        end,
        last_expired_order_id = excluded.last_expired_order_id,
        last_expired_at = excluded.last_expired_at,
        reviewed_by = null,
        reviewed_at = null,
        review_reason = null,
        updated_at = now()
    returning * into v_case;

    insert into public.order_payment_expirations (
      order_id, buyer_id, strike_number, expired_at
    ) values (
      v_order.id, v_order.buyer_id, v_case.strike_count, now()
    )
    on conflict (order_id) do nothing
    returning * into v_expiration;

    if v_expiration.id is null then continue; end if;

    update public.orders
    set status = 'cancelled',
        payment_expired_at = v_expiration.expired_at,
        cancellation_reason = 'payment_window_expired'
    where id = v_order.id and status = 'pending_payment';

    if v_case.strike_count >= 2 then
      update public.profiles
      set account_status = 'suspended'
      where id = v_order.buyer_id and account_status <> 'closed';
    end if;

    insert into public.notifications (
      user_id, notification_type, title, message, entity_type, entity_id, dedupe_key
    ) values (
      v_order.buyer_id,
      case when v_case.strike_count >= 2 then 'account_suspended_nonpayment' else 'order_cancelled_nonpayment' end,
      case when v_case.strike_count >= 2 then 'ระงับสิทธิ์ประมูลชั่วคราว' else 'ยกเลิกคำสั่งซื้อเนื่องจากไม่ชำระ' end,
      case
        when v_case.strike_count >= 2 then 'ไม่ชำระภายในกำหนดเป็นครั้งที่ ' || v_case.strike_count || ' กรุณารอแอดมินตรวจสอบบัญชี'
        else 'คำสั่งซื้อ ' || v_order.order_number || ' ถูกยกเลิกและบันทึกคำเตือนครั้งที่ 1'
      end,
      'order',
      v_order.id::text,
      'payment-expired:' || v_order.id::text
    ) on conflict (dedupe_key) do nothing;

    insert into public.audit_events (actor_id, event_type, entity_type, entity_id, payload)
    values (
      null,
      case when v_case.strike_count >= 2 then 'payment.expired_account_suspended' else 'payment.expired_warning' end,
      'order',
      v_order.id::text,
      jsonb_build_object(
        'buyer_id', v_order.buyer_id,
        'strike_number', v_case.strike_count,
        'payment_due_at', v_order.payment_due_at,
        'expired_at', v_expiration.expired_at,
        'account_status', case when v_case.strike_count >= 2 then 'suspended' else 'active' end
      )
    );

    v_expired := v_expired + 1;
  end loop;

  return v_expired;
end;
$$;

create or replace function public.review_payment_default_account(
  p_user_id uuid,
  p_decision text,
  p_reason text
)
returns public.payment_default_cases
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_case public.payment_default_cases%rowtype;
  v_title text;
  v_message text;
begin
  if v_actor_id is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;
  if not public.has_role('admin', v_actor_id) then
    raise exception 'ADMIN_REQUIRED' using errcode = 'P0001';
  end if;
  if p_decision not in ('reinstate', 'keep_suspended') then
    raise exception 'INVALID_DEFAULT_REVIEW_DECISION' using errcode = 'P0001';
  end if;
  if char_length(trim(p_reason)) not between 5 and 500 then
    raise exception 'REVIEW_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_case
  from public.payment_default_cases
  where user_id = p_user_id
  for update;
  if not found then raise exception 'DEFAULT_CASE_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_case.review_status <> 'pending_review' then
    raise exception 'DEFAULT_CASE_NOT_PENDING' using errcode = 'P0001';
  end if;

  update public.payment_default_cases
  set review_status = case when p_decision = 'reinstate' then 'reinstated' else 'kept_suspended' end,
      reviewed_by = v_actor_id,
      reviewed_at = now(),
      review_reason = trim(p_reason),
      updated_at = now()
  where user_id = p_user_id
  returning * into v_case;

  if p_decision = 'reinstate' then
    update public.profiles set account_status = 'active' where id = p_user_id and account_status = 'suspended';
    v_title := 'คืนสิทธิ์ประมูลแล้ว';
    v_message := 'แอดมินตรวจสอบบัญชีและคืนสิทธิ์เข้าร่วมประมูลแล้ว';
  else
    update public.profiles set account_status = 'suspended' where id = p_user_id and account_status <> 'closed';
    v_title := 'ยังคงระงับสิทธิ์ประมูล';
    v_message := 'แอดมินตรวจสอบแล้วและยังคงระงับบัญชี: ' || trim(p_reason);
  end if;

  insert into public.notifications (
    user_id, notification_type, title, message, entity_type, entity_id, dedupe_key
  ) values (
    p_user_id,
    case when p_decision = 'reinstate' then 'account_reinstated' else 'account_suspension_confirmed' end,
    v_title,
    v_message,
    'profile',
    p_user_id::text,
    'default-review:' || p_user_id::text || ':' || v_case.updated_at::text
  ) on conflict (dedupe_key) do nothing;

  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, payload)
  values (
    v_actor_id,
    case when p_decision = 'reinstate' then 'account.reinstated_after_nonpayment_review' else 'account.suspension_confirmed_after_nonpayment' end,
    'profile',
    p_user_id::text,
    jsonb_build_object('strike_count', v_case.strike_count, 'decision', p_decision, 'reason', trim(p_reason))
  );

  return v_case;
end;
$$;

revoke all on function public.send_due_payment_reminders() from public, anon, authenticated;
revoke all on function public.expire_due_orders() from public, anon, authenticated;
revoke all on function public.review_payment_default_account(uuid, text, text) from public, anon;
grant execute on function public.review_payment_default_account(uuid, text, text) to authenticated;

select cron.schedule(
  'bbk-payment-deadline-monitor',
  '* * * * *',
  'select public.send_due_payment_reminders(); select public.expire_due_orders();'
);

insert into public.audit_events (actor_id, event_type, entity_type, entity_id, payload)
values (
  null,
  'payment.deadline_workflow_installed',
  'system',
  'bbk-payment-deadline-monitor',
  jsonb_build_object(
    'schedule', 'every_minute',
    'reminder_window_hours', 2,
    'payment_window_hours_after_total_ready', 24,
    'first_nonpayment', 'cancel_and_warn',
    'second_nonpayment', 'suspend_pending_admin_review',
    'customer_actions_gated_by_payment_switch', true,
    'payments_enabled', false,
    'approved_date', '2026-09-23'
  )
);
