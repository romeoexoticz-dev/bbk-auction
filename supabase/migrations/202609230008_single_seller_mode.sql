-- Single-seller launch mode: BBK is the only account allowed to sell.

create table if not exists public.marketplace_settings (
  id smallint primary key default 1 check (id = 1),
  seller_mode text not null default 'single_owner' check (seller_mode in ('single_owner', 'marketplace')),
  primary_seller_id uuid not null references public.profiles (id) on delete restrict,
  updated_at timestamptz not null default now()
);

do $$
declare
  v_primary_seller_id uuid;
begin
  select coalesce(
    (select seller_id from public.auctions order by created_at asc limit 1),
    (select user_id from public.seller_profiles where status = 'approved' order by reviewed_at asc nulls last limit 1),
    (select user_id from public.role_assignments where role_name = 'seller' order by assigned_at asc limit 1)
  ) into v_primary_seller_id;

  if v_primary_seller_id is null then
    raise exception using errcode = 'P0002', message = 'PRIMARY_SELLER_NOT_FOUND';
  end if;

  insert into public.marketplace_settings (id, seller_mode, primary_seller_id)
  values (1, 'single_owner', v_primary_seller_id)
  on conflict (id) do update
  set seller_mode = 'single_owner',
      primary_seller_id = excluded.primary_seller_id,
      updated_at = now();

  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, payload)
  values (
    null,
    'marketplace.single_seller_enabled',
    'marketplace',
    '1',
    jsonb_build_object(
      'seller_mode', 'single_owner',
      'primary_seller_id', v_primary_seller_id,
      'external_seller_registration', false,
      'payments_enabled', false
    )
  );
end;
$$;

alter table public.marketplace_settings enable row level security;
revoke all on public.marketplace_settings from public, anon, authenticated;

create or replace function public.has_role(
  p_role text,
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
    from public.role_assignments ra
    join public.profiles p on p.id = ra.user_id
    where ra.user_id = p_user_id
      and ra.role_name = p_role
      and p.account_status = 'active'
      and (
        p_role <> 'seller'
        or exists (
          select 1
          from public.marketplace_settings ms
          where ms.id = 1
            and (
              ms.seller_mode = 'marketplace'
              or (ms.seller_mode = 'single_owner' and ms.primary_seller_id = p_user_id)
            )
        )
      )
  );
$$;

create or replace function public.enforce_seller_role_mode()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role_name = 'seller' and not exists (
    select 1 from public.marketplace_settings ms
    where ms.id = 1
      and (ms.seller_mode = 'marketplace' or ms.primary_seller_id = new.user_id)
  ) then
    raise exception using errcode = '42501', message = 'EXTERNAL_SELLER_REGISTRATION_CLOSED';
  end if;
  return new;
end;
$$;

drop trigger if exists role_assignments_single_seller_guard on public.role_assignments;
create trigger role_assignments_single_seller_guard
before insert or update on public.role_assignments
for each row execute function public.enforce_seller_role_mode();

create or replace function public.enforce_seller_profile_mode()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.marketplace_settings ms
    where ms.id = 1
      and (ms.seller_mode = 'marketplace' or ms.primary_seller_id = new.user_id)
  ) then
    raise exception using errcode = '42501', message = 'EXTERNAL_SELLER_REGISTRATION_CLOSED';
  end if;
  return new;
end;
$$;

drop trigger if exists seller_profiles_single_seller_guard on public.seller_profiles;
create trigger seller_profiles_single_seller_guard
before insert or update on public.seller_profiles
for each row execute function public.enforce_seller_profile_mode();

revoke all on function public.enforce_seller_role_mode() from public, anon, authenticated;
revoke all on function public.enforce_seller_profile_mode() from public, anon, authenticated;
