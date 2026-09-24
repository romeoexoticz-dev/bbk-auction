-- Notify admins when a customer changes auction interests and expose private,
-- admin-only summaries for merchandising decisions.

create or replace function public.set_my_auction_interests(p_categories text[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_categories text[];
  v_previous text[];
  v_count integer;
  v_audit_id bigint;
  v_display_name text;
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;

  select coalesce(array_agg(item.category order by item.category), '{}'::text[])
  into v_categories
  from (select distinct unnest(coalesce(p_categories, '{}'::text[])) as category) item;

  if cardinality(v_categories) > 5 then raise exception 'TOO_MANY_CATEGORIES' using errcode = 'P0001'; end if;
  if exists (
    select 1 from unnest(v_categories) item(category)
    where item.category is null
      or item.category not in ('เหรียญกษาปณ์', 'ธนบัตร', 'พระเครื่อง', 'การ์ดสะสม', 'ของเก่า')
  ) then raise exception 'INVALID_CATEGORY' using errcode = 'P0001'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text, 0));

  select coalesce(array_agg(aip.category order by aip.category), '{}'::text[])
  into v_previous
  from public.auction_interest_preferences aip
  where aip.user_id = v_user_id;

  if v_previous = v_categories then return cardinality(v_categories); end if;

  delete from public.auction_interest_preferences aip
  where aip.user_id = v_user_id and not (aip.category = any(v_categories));

  insert into public.auction_interest_preferences (user_id, category)
  select v_user_id, item.category
  from unnest(v_categories) item(category)
  on conflict (user_id, category) do update set updated_at = now();

  v_count := cardinality(v_categories);
  select coalesce(nullif(trim(p.display_name), ''), 'สมาชิก BBK')
  into v_display_name
  from public.profiles p
  where p.id = v_user_id;

  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, payload)
  values (
    v_user_id,
    'notifications.auction_interests_updated',
    'profile',
    v_user_id::text,
    jsonb_build_object('selected_count', v_count)
  )
  returning id into v_audit_id;

  insert into public.notifications (
    user_id, notification_type, title, message, entity_type, entity_id, dedupe_key
  )
  select
    ra.user_id,
    'admin_auction_interest_update',
    'ลูกค้าอัปเดตสิ่งที่อยากประมูล',
    v_display_name || case
      when v_count = 0 then ' ปิดความสนใจทุกหมวด'
      else ' สนใจ: ' || array_to_string(v_categories, ', ')
    end,
    'admin_interest',
    v_user_id::text,
    'admin-interest-update:' || v_audit_id::text || ':' || ra.user_id::text
  from public.role_assignments ra
  join public.profiles admin_profile
    on admin_profile.id = ra.user_id and admin_profile.account_status = 'active'
  where ra.role_name = 'admin'
  on conflict (dedupe_key) do nothing;

  return v_count;
end;
$$;

create or replace function public.admin_auction_interest_summary()
returns table (category text, interested_count bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.has_role('admin', auth.uid()) then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;

  return query
  select aip.category, count(distinct aip.user_id)::bigint
  from public.auction_interest_preferences aip
  join public.profiles p on p.id = aip.user_id and p.account_status = 'active'
  group by aip.category
  order by count(distinct aip.user_id) desc, aip.category;
end;
$$;

create or replace function public.admin_recent_auction_interests(p_limit integer default 30)
returns table (
  user_id uuid,
  display_name text,
  categories text[],
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.has_role('admin', auth.uid()) then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;

  return query
  select
    aip.user_id,
    coalesce(nullif(trim(p.display_name), ''), 'สมาชิก BBK')::text,
    array_agg(aip.category order by aip.category)::text[],
    max(aip.updated_at)
  from public.auction_interest_preferences aip
  join public.profiles p on p.id = aip.user_id and p.account_status = 'active'
  group by aip.user_id, p.display_name
  order by max(aip.updated_at) desc
  limit least(greatest(coalesce(p_limit, 30), 1), 100);
end;
$$;

revoke all on function public.admin_auction_interest_summary() from public, anon;
grant execute on function public.admin_auction_interest_summary() to authenticated;
revoke all on function public.admin_recent_auction_interests(integer) from public, anon;
grant execute on function public.admin_recent_auction_interests(integer) to authenticated;

insert into public.audit_events (actor_id, event_type, entity_type, entity_id, payload)
values (
  null,
  'notifications.admin_interest_reporting_installed',
  'system',
  'admin-interest-reporting',
  jsonb_build_object('admin_notification', true, 'summary_private', true, 'unchanged_save_deduplicated', true)
);
