-- Private bidder interests and idempotent in-app notifications for newly
-- published auctions. Web Push remains independently gated and disabled.

create table if not exists public.auction_interest_preferences (
  user_id uuid not null references public.profiles (id) on delete cascade,
  category text not null check (category in ('เหรียญกษาปณ์', 'ธนบัตร', 'พระเครื่อง', 'การ์ดสะสม', 'ของเก่า')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, category)
);

create index if not exists auction_interest_preferences_category_idx
on public.auction_interest_preferences (category, user_id);

alter table public.auction_interest_preferences enable row level security;
revoke all on public.auction_interest_preferences from public, anon, authenticated;

create or replace function public.get_my_auction_interests()
returns table (category text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;
  return query
  select aip.category
  from public.auction_interest_preferences aip
  where aip.user_id = auth.uid()
  order by aip.category;
end;
$$;

create or replace function public.set_my_auction_interests(p_categories text[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_categories text[] := coalesce(p_categories, '{}'::text[]);
  v_count integer;
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;
  if cardinality(v_categories) > 5 then raise exception 'TOO_MANY_CATEGORIES' using errcode = 'P0001'; end if;
  if exists (
    select 1 from unnest(v_categories) item(category)
    where item.category not in ('เหรียญกษาปณ์', 'ธนบัตร', 'พระเครื่อง', 'การ์ดสะสม', 'ของเก่า')
  ) then raise exception 'INVALID_CATEGORY' using errcode = 'P0001'; end if;

  delete from public.auction_interest_preferences aip
  where aip.user_id = v_user_id and not (aip.category = any(v_categories));

  insert into public.auction_interest_preferences (user_id, category)
  select v_user_id, item.category
  from (select distinct unnest(v_categories) as category) item
  on conflict (user_id, category) do update set updated_at = now();

  select count(*)::integer into v_count
  from public.auction_interest_preferences aip
  where aip.user_id = v_user_id;

  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, payload)
  values (v_user_id, 'notifications.auction_interests_updated', 'profile', v_user_id::text, jsonb_build_object('selected_count', v_count));

  return v_count;
end;
$$;

create or replace function public.notify_interested_bidders_on_auction_published()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status not in ('scheduled', 'live')
    or old.status in ('scheduled', 'live') then
    return new;
  end if;

  insert into public.notifications (
    user_id, notification_type, title, message, entity_type, entity_id, dedupe_key
  )
  select
    aip.user_id,
    'auction_interest_match',
    'มีรายการใหม่ในหมวด ' || new.category,
    'เปิดรายการ “' || new.title || '” ที่ตรงกับสิ่งที่คุณสนใจ แตะเพื่อดูรายละเอียด',
    'auction',
    new.id::text,
    'auction-interest:' || new.id::text || ':' || aip.user_id::text
  from public.auction_interest_preferences aip
  join public.profiles p on p.id = aip.user_id and p.account_status = 'active'
  where aip.category = new.category
  on conflict (dedupe_key) do nothing;

  return new;
end;
$$;

drop trigger if exists auctions_notify_interested_bidders_after_publish on public.auctions;
create trigger auctions_notify_interested_bidders_after_publish
after update of status on public.auctions
for each row execute function public.notify_interested_bidders_on_auction_published();

revoke all on function public.get_my_auction_interests() from public, anon;
grant execute on function public.get_my_auction_interests() to authenticated;
revoke all on function public.set_my_auction_interests(text[]) from public, anon;
grant execute on function public.set_my_auction_interests(text[]) to authenticated;
revoke all on function public.notify_interested_bidders_on_auction_published() from public, anon, authenticated;

insert into public.audit_events (actor_id, event_type, entity_type, entity_id, payload)
values (
  null,
  'notifications.auction_interests_installed',
  'system',
  'auction-interests',
  jsonb_build_object('categories', 5, 'private_preferences', true, 'deduplicated_notifications', true)
);
