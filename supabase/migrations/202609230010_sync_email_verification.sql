-- Keep the public bidder profile aligned with Supabase Auth.
-- Auth remains the source of truth for whether an email has been confirmed.

create or replace function public.enforce_profile_email_verified()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select (u.email_confirmed_at is not null)
  into new.email_verified
  from auth.users u
  where u.id = new.id;

  if not found then
    new.email_verified := false;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_enforce_email_verified on public.profiles;
create trigger profiles_enforce_email_verified
before insert or update of email_verified on public.profiles
for each row execute function public.enforce_profile_email_verified();

create or replace function public.sync_profile_email_verified()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
  set email_verified = (new.email_confirmed_at is not null)
  where id = new.id;

  return new;
end;
$$;

drop trigger if exists on_auth_user_email_confirmation_changed on auth.users;
create trigger on_auth_user_email_confirmation_changed
after update of email_confirmed_at on auth.users
for each row
when (old.email_confirmed_at is distinct from new.email_confirmed_at)
execute function public.sync_profile_email_verified();

-- Repair profiles created before the synchronization trigger existed.
update public.profiles p
set email_verified = (u.email_confirmed_at is not null)
from auth.users u
where u.id = p.id
  and p.email_verified is distinct from (u.email_confirmed_at is not null);

revoke all on function public.enforce_profile_email_verified() from public, anon, authenticated;
revoke all on function public.sync_profile_email_verified() from public, anon, authenticated;
