-- BBK AUCTION: administrator role management with password step-up.
-- The current administrator's password is checked inside this transaction and
-- is never stored in an application table, audit payload, or notification.

create table public.admin_role_grant_requests (
  request_key uuid primary key,
  actor_id uuid not null references public.profiles (id) on delete restrict,
  target_user_id uuid references public.profiles (id) on delete restrict,
  target_email_hash text not null,
  reason text not null check (char_length(reason) between 5 and 500),
  outcome text not null check (outcome in (
    'pending',
    'invalid_password',
    'rate_limited',
    'target_ineligible',
    'already_admin',
    'granted'
  )),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index admin_role_grant_requests_actor_created_idx
on public.admin_role_grant_requests (actor_id, created_at desc);

alter table public.admin_role_grant_requests enable row level security;
revoke all on public.admin_role_grant_requests from public, anon, authenticated;

create or replace function public.grant_admin_role(
  p_target_email text,
  p_current_password text,
  p_reason text,
  p_request_key uuid
)
returns table (
  outcome text,
  target_user_id uuid,
  target_display_name text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_name text;
  v_email text := lower(trim(coalesce(p_target_email, '')));
  v_email_hash text;
  v_reason text := trim(coalesce(p_reason, ''));
  v_password_hash text;
  v_target_id uuid;
  v_target_name text;
  v_failed_attempts integer;
  v_inserted integer;
  v_existing public.admin_role_grant_requests%rowtype;
begin
  if v_actor_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  if not public.has_role('admin', v_actor_id) then
    raise exception 'ADMIN_REQUIRED' using errcode = 'P0001';
  end if;
  if p_request_key is null then
    raise exception 'REQUEST_KEY_REQUIRED' using errcode = 'P0001';
  end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or char_length(v_email) > 320 then
    raise exception 'INVALID_EMAIL' using errcode = 'P0001';
  end if;
  if char_length(v_reason) < 5 or char_length(v_reason) > 500 then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  if p_current_password is null
    or char_length(p_current_password) < 1
    or char_length(p_current_password) > 1024 then
    raise exception 'PASSWORD_REQUIRED' using errcode = 'P0001';
  end if;

  v_email_hash := encode(extensions.digest(v_email, 'sha256'), 'hex');

  -- Serialize attempts by the acting administrator. This also makes retries
  -- deterministic without relying on a disabled browser button.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('admin-role-grant:' || v_actor_id::text, 0)
  );

  select * into v_existing
  from public.admin_role_grant_requests
  where request_key = p_request_key;

  if found then
    if v_existing.actor_id <> v_actor_id
      or v_existing.target_email_hash <> v_email_hash
      or v_existing.reason <> v_reason then
      raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = 'P0001';
    end if;

    return query
    select v_existing.outcome, v_existing.target_user_id, p.display_name
    from (select 1) seed
    left join public.profiles p on p.id = v_existing.target_user_id;
    return;
  end if;

  select count(*)::integer into v_failed_attempts
  from public.admin_role_grant_requests r
  where r.actor_id = v_actor_id
    and r.outcome = 'invalid_password'
    and r.created_at >= now() - interval '15 minutes';

  if v_failed_attempts >= 5 then
    insert into public.admin_role_grant_requests (
      request_key, actor_id, target_email_hash, reason, outcome, completed_at
    ) values (
      p_request_key, v_actor_id, v_email_hash, v_reason, 'rate_limited', now()
    );
    return query select 'rate_limited'::text, null::uuid, null::text;
    return;
  end if;

  insert into public.admin_role_grant_requests (
    request_key, actor_id, target_email_hash, reason, outcome
  ) values (
    p_request_key, v_actor_id, v_email_hash, v_reason, 'pending'
  );

  select u.encrypted_password into v_password_hash
  from auth.users u
  where u.id = v_actor_id;

  if coalesce(v_password_hash, '') = ''
    or extensions.crypt(p_current_password, v_password_hash) <> v_password_hash then
    update public.admin_role_grant_requests
    set outcome = 'invalid_password', completed_at = now()
    where request_key = p_request_key;

    return query select 'invalid_password'::text, null::uuid, null::text;
    return;
  end if;

  -- Look up the target only after step-up succeeds to avoid account discovery
  -- through password failures.
  select u.id, p.display_name
  into v_target_id, v_target_name
  from auth.users u
  join public.profiles p on p.id = u.id
  where lower(u.email) = v_email
    and u.email_confirmed_at is not null
    and p.email_verified
    and p.account_status = 'active'
  limit 1;

  if v_target_id is null then
    update public.admin_role_grant_requests
    set outcome = 'target_ineligible', completed_at = now()
    where request_key = p_request_key;

    return query select 'target_ineligible'::text, null::uuid, null::text;
    return;
  end if;

  insert into public.role_assignments (user_id, role_name, assigned_by)
  values (v_target_id, 'admin', v_actor_id)
  on conflict (user_id, role_name) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    update public.admin_role_grant_requests
    set target_user_id = v_target_id,
        outcome = 'already_admin',
        completed_at = now()
    where request_key = p_request_key;

    return query select 'already_admin'::text, v_target_id, v_target_name;
    return;
  end if;

  update public.admin_role_grant_requests
  set target_user_id = v_target_id,
      outcome = 'granted',
      completed_at = now()
  where request_key = p_request_key;

  select coalesce(nullif(trim(p.display_name), ''), 'แอดมิน BBK')
  into v_actor_name
  from public.profiles p
  where p.id = v_actor_id;

  insert into public.audit_events (
    actor_id, event_type, entity_type, entity_id, payload
  ) values (
    v_actor_id,
    'roles.admin_granted',
    'profile',
    v_target_id::text,
    jsonb_build_object(
      'reason', v_reason,
      'request_key', p_request_key,
      'step_up_method', 'current_password'
    )
  );

  insert into public.notifications (
    user_id, notification_type, title, message,
    entity_type, entity_id, dedupe_key
  )
  select
    ra.user_id,
    'admin_role_granted',
    case when ra.user_id = v_target_id
      then 'บัญชีได้รับสิทธิ์แอดมินแล้ว'
      else 'มีการเพิ่มแอดมินใหม่'
    end,
    case when ra.user_id = v_target_id
      then 'บัญชีของคุณได้รับสิทธิ์แอดมินโดย ' || v_actor_name || ' กรุณาตรวจสอบสิทธิ์ก่อนเริ่มงาน'
      else v_actor_name || ' เพิ่ม ' || coalesce(nullif(trim(v_target_name), ''), 'สมาชิก BBK') || ' เป็นแอดมิน'
    end,
    'profile',
    v_target_id::text,
    'admin-role-granted:' || p_request_key::text || ':' || ra.user_id::text
  from public.role_assignments ra
  join public.profiles p on p.id = ra.user_id
  where ra.role_name = 'admin'
    and p.account_status = 'active'
  on conflict (dedupe_key) do nothing;

  return query select 'granted'::text, v_target_id, v_target_name;
end;
$$;

create or replace function public.admin_list_administrators()
returns table (
  user_id uuid,
  display_name text,
  email text,
  assigned_at timestamptz,
  assigned_by_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    ra.user_id,
    coalesce(nullif(trim(p.display_name), ''), 'แอดมิน BBK') as display_name,
    u.email::text,
    ra.assigned_at,
    assigner.display_name as assigned_by_name
  from public.role_assignments ra
  join public.profiles p on p.id = ra.user_id
  join auth.users u on u.id = ra.user_id
  left join public.profiles assigner on assigner.id = ra.assigned_by
  where ra.role_name = 'admin'
    and public.has_role('admin', auth.uid())
  order by ra.assigned_at asc;
$$;

revoke all on function public.grant_admin_role(text, text, text, uuid) from public, anon;
grant execute on function public.grant_admin_role(text, text, text, uuid) to authenticated;
revoke all on function public.admin_list_administrators() from public, anon;
grant execute on function public.admin_list_administrators() to authenticated;

insert into public.audit_events (actor_id, event_type, entity_type, entity_id, payload)
values (
  null,
  'roles.admin_management_installed',
  'system',
  'admin-role-management',
  jsonb_build_object(
    'grant_policy', 'all_active_admins',
    'step_up_method', 'current_password',
    'failed_password_limit', 5,
    'window_minutes', 15
  )
);
