-- Opt-in Web Push foundation. Dispatch remains disabled until an admin configures
-- the deployed HTTPS endpoint and matching server secret.

create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault;

alter table public.marketplace_settings
  add column if not exists push_dispatch_enabled boolean not null default false,
  add column if not exists push_dispatch_url text,
  add column if not exists push_dispatch_token_hash text,
  add column if not exists push_dispatch_secret_id uuid;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique check (char_length(endpoint) between 32 and 2048 and endpoint ~ '^https://'),
  p256dh text not null check (char_length(p256dh) between 16 and 512),
  auth_key text not null check (char_length(auth_key) between 8 and 256),
  user_agent text check (user_agent is null or char_length(user_agent) <= 500),
  active boolean not null default true,
  failure_count integer not null default 0 check (failure_count >= 0),
  last_success_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.push_deliveries (
  id bigint generated always as identity primary key,
  notification_id bigint not null references public.notifications (id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  last_status_code integer,
  last_error text,
  created_at timestamptz not null default now(),
  unique (notification_id, subscription_id)
);

create index if not exists push_subscriptions_user_active_idx
on public.push_subscriptions (user_id, active);

create index if not exists push_deliveries_ready_idx
on public.push_deliveries (status, next_attempt_at, id)
where status in ('pending', 'sending');

alter table public.push_subscriptions enable row level security;
alter table public.push_deliveries enable row level security;
revoke all on public.push_subscriptions from public, anon, authenticated;
revoke all on public.push_deliveries from public, anon, authenticated;

create or replace function public.push_dispatch_is_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select ms.push_dispatch_enabled
      and ms.push_dispatch_url is not null
      and ms.push_dispatch_token_hash is not null
      and ms.push_dispatch_secret_id is not null
    from public.marketplace_settings ms
    where ms.id = 1
  ), false);
$$;

create or replace function public.save_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth_key text,
  p_user_agent text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_subscription_id uuid;
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;
  if p_endpoint !~ '^https://' or char_length(p_endpoint) not between 32 and 2048 then
    raise exception 'INVALID_PUSH_ENDPOINT' using errcode = 'P0001';
  end if;
  if char_length(p_p256dh) not between 16 and 512 or char_length(p_auth_key) not between 8 and 256 then
    raise exception 'INVALID_PUSH_KEYS' using errcode = 'P0001';
  end if;
  if p_user_agent is not null and char_length(p_user_agent) > 500 then
    raise exception 'INVALID_USER_AGENT' using errcode = 'P0001';
  end if;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth_key, user_agent, active)
  values (v_user_id, p_endpoint, p_p256dh, p_auth_key, nullif(p_user_agent, ''), true)
  on conflict (endpoint) do update
  set user_id = excluded.user_id,
      p256dh = excluded.p256dh,
      auth_key = excluded.auth_key,
      user_agent = excluded.user_agent,
      active = true,
      failure_count = 0,
      updated_at = now()
  returning id into v_subscription_id;

  return v_subscription_id;
end;
$$;

create or replace function public.disable_push_subscription(p_endpoint text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;

  update public.push_subscriptions
  set active = false, updated_at = now()
  where endpoint = p_endpoint and user_id = auth.uid();

  return found;
end;
$$;

create or replace function public.configure_push_dispatch(
  p_dispatch_url text,
  p_dispatch_secret text,
  p_enabled boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_secret_id uuid;
begin
  if v_actor_id is null or not public.has_role('admin', v_actor_id) then
    raise exception 'ADMIN_REQUIRED' using errcode = 'P0001';
  end if;
  if p_dispatch_url !~ '^https://[^/]+/api/push/dispatch$' or char_length(p_dispatch_url) > 500 then
    raise exception 'INVALID_PUSH_DISPATCH_URL' using errcode = 'P0001';
  end if;
  if char_length(p_dispatch_secret) < 32 or char_length(p_dispatch_secret) > 256 then
    raise exception 'INVALID_PUSH_DISPATCH_SECRET' using errcode = 'P0001';
  end if;

  select push_dispatch_secret_id into v_secret_id
  from public.marketplace_settings where id = 1 for update;

  if v_secret_id is null then
    select vault.create_secret(
      p_dispatch_secret,
      'bbk_push_dispatch_secret',
      'Authorization secret for the BBK Web Push dispatcher'
    ) into v_secret_id;
  else
    perform vault.update_secret(v_secret_id, p_dispatch_secret);
  end if;

  update public.marketplace_settings
  set push_dispatch_enabled = p_enabled,
      push_dispatch_url = p_dispatch_url,
      push_dispatch_token_hash = encode(extensions.digest(p_dispatch_secret, 'sha256'), 'hex'),
      push_dispatch_secret_id = v_secret_id,
      updated_at = now()
  where id = 1;

  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, payload)
  values (
    v_actor_id,
    'notifications.push_dispatch_configured',
    'system',
    'web-push-dispatch',
    jsonb_build_object('enabled', p_enabled, 'dispatch_url', p_dispatch_url)
  );

  return public.push_dispatch_is_enabled();
end;
$$;

create or replace function public.dispatch_pending_pushes(p_notification_id bigint default null)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
  v_request_id bigint;
begin
  select ms.push_dispatch_url, ds.decrypted_secret
  into v_url, v_secret
  from public.marketplace_settings ms
  join vault.decrypted_secrets ds on ds.id = ms.push_dispatch_secret_id
  where ms.id = 1 and ms.push_dispatch_enabled;

  if v_url is null or v_secret is null then return null; end if;

  select net.http_post(
    url := v_url,
    body := jsonb_build_object('notificationId', p_notification_id),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    timeout_milliseconds := 10000
  ) into v_request_id;

  return v_request_id;
end;
$$;

create or replace function public.enqueue_push_deliveries()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.push_deliveries (notification_id, subscription_id, user_id)
  select new.id, ps.id, new.user_id
  from public.push_subscriptions ps
  where ps.user_id = new.user_id and ps.active
  on conflict (notification_id, subscription_id) do nothing;

  if public.push_dispatch_is_enabled() then
    perform public.dispatch_pending_pushes(new.id);
  end if;

  return new;
end;
$$;

drop trigger if exists notifications_enqueue_push_after_insert on public.notifications;
create trigger notifications_enqueue_push_after_insert
after insert on public.notifications
for each row execute function public.enqueue_push_deliveries();

create or replace function public.claim_push_deliveries(
  p_worker_token text,
  p_notification_id bigint default null,
  p_limit integer default 50
)
returns table (
  delivery_id bigint,
  endpoint text,
  p256dh text,
  auth_key text,
  notification_title text,
  notification_message text,
  entity_type text,
  entity_id text,
  notification_id bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_expected_hash text;
begin
  select ms.push_dispatch_token_hash into v_expected_hash
  from public.marketplace_settings ms
  where ms.id = 1 and ms.push_dispatch_enabled;

  if v_expected_hash is null
    or encode(extensions.digest(coalesce(p_worker_token, ''), 'sha256'), 'hex') <> v_expected_hash then
    raise exception 'PUSH_WORKER_UNAUTHORIZED' using errcode = '42501';
  end if;

  update public.push_deliveries
  set status = 'pending', claimed_at = null, next_attempt_at = now()
  where status = 'sending' and claimed_at < now() - interval '10 minutes';

  for v_row in
    select d.id
    from public.push_deliveries d
    join public.push_subscriptions ps on ps.id = d.subscription_id and ps.active
    where d.status = 'pending'
      and d.next_attempt_at <= now()
      and (p_notification_id is null or d.notification_id = p_notification_id)
    order by d.id
    for update of d skip locked
    limit least(greatest(coalesce(p_limit, 50), 1), 100)
  loop
    update public.push_deliveries
    set status = 'sending', claimed_at = now(), attempts = attempts + 1
    where id = v_row.id;

    return query
    select d.id, ps.endpoint, ps.p256dh, ps.auth_key,
      n.title, n.message, n.entity_type, n.entity_id, n.id
    from public.push_deliveries d
    join public.push_subscriptions ps on ps.id = d.subscription_id
    join public.notifications n on n.id = d.notification_id
    where d.id = v_row.id;
  end loop;
end;
$$;

create or replace function public.complete_push_delivery(
  p_worker_token text,
  p_delivery_id bigint,
  p_success boolean,
  p_status_code integer default null,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expected_hash text;
  v_subscription_id uuid;
  v_attempts integer;
begin
  select ms.push_dispatch_token_hash into v_expected_hash
  from public.marketplace_settings ms where ms.id = 1;
  if v_expected_hash is null
    or encode(extensions.digest(coalesce(p_worker_token, ''), 'sha256'), 'hex') <> v_expected_hash then
    raise exception 'PUSH_WORKER_UNAUTHORIZED' using errcode = '42501';
  end if;

  select subscription_id, attempts into v_subscription_id, v_attempts
  from public.push_deliveries where id = p_delivery_id and status = 'sending' for update;
  if not found then return false; end if;

  update public.push_deliveries
  set status = case when p_success then 'sent' when v_attempts >= 5 or p_status_code in (404, 410) then 'failed' else 'pending' end,
      sent_at = case when p_success then now() else null end,
      next_attempt_at = case when p_success then next_attempt_at else now() + make_interval(mins => least(v_attempts * 2, 30)) end,
      claimed_at = null,
      last_status_code = p_status_code,
      last_error = left(nullif(p_error, ''), 500)
  where id = p_delivery_id;

  if p_success then
    update public.push_subscriptions
    set last_success_at = now(), failure_count = 0, updated_at = now()
    where id = v_subscription_id;
  else
    update public.push_subscriptions
    set failure_count = failure_count + 1,
        active = case when p_status_code in (404, 410) then false else active end,
        updated_at = now()
    where id = v_subscription_id;
  end if;

  return true;
end;
$$;

revoke all on function public.push_dispatch_is_enabled() from public, anon;
grant execute on function public.push_dispatch_is_enabled() to authenticated;
revoke all on function public.save_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;
revoke all on function public.disable_push_subscription(text) from public, anon;
grant execute on function public.disable_push_subscription(text) to authenticated;
revoke all on function public.configure_push_dispatch(text, text, boolean) from public, anon;
grant execute on function public.configure_push_dispatch(text, text, boolean) to authenticated;
revoke all on function public.dispatch_pending_pushes(bigint) from public, anon, authenticated;
revoke all on function public.enqueue_push_deliveries() from public, anon, authenticated;
revoke all on function public.claim_push_deliveries(text, bigint, integer) from public, authenticated;
grant execute on function public.claim_push_deliveries(text, bigint, integer) to anon;
revoke all on function public.complete_push_delivery(text, bigint, boolean, integer, text) from public, authenticated;
grant execute on function public.complete_push_delivery(text, bigint, boolean, integer, text) to anon;

select cron.schedule(
  'bbk-push-retry-dispatch',
  '*/5 * * * *',
  'select public.dispatch_pending_pushes(null);'
);

insert into public.audit_events (actor_id, event_type, entity_type, entity_id, payload)
values (
  null,
  'notifications.web_push_foundation_installed',
  'system',
  'web-push',
  jsonb_build_object(
    'opt_in_required', true,
    'dispatch_enabled', false,
    'immediate_webhook', 'prepared',
    'retry_schedule', 'every_5_minutes',
    'secret_storage', 'supabase_vault'
  )
);
