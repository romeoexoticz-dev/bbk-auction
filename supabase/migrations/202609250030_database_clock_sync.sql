-- Expose only the authoritative database timestamp needed for synchronized
-- customer countdowns. No table data or elevated privileges are exposed.

create or replace function public.get_database_time()
returns timestamptz
language sql
security invoker
set search_path = ''
as $$
  select clock_timestamp();
$$;

revoke all on function public.get_database_time() from public;
grant execute on function public.get_database_time() to anon, authenticated;

do $verification$
begin
  if not has_function_privilege('anon', 'public.get_database_time()', 'EXECUTE') then
    raise exception 'ANON_DATABASE_CLOCK_ACCESS_NOT_INSTALLED';
  end if;

  if not has_function_privilege('authenticated', 'public.get_database_time()', 'EXECUTE') then
    raise exception 'AUTHENTICATED_DATABASE_CLOCK_ACCESS_NOT_INSTALLED';
  end if;

  if abs(extract(epoch from (public.get_database_time() - clock_timestamp()))) > 1 then
    raise exception 'DATABASE_CLOCK_OUT_OF_TOLERANCE';
  end if;
end;
$verification$;

insert into public.audit_events (actor_id, event_type, entity_type, entity_id, payload)
values (
  null,
  'auction.database_clock_sync_enabled',
  'system',
  'auction-clock',
  jsonb_build_object(
    'source', 'postgres_clock_timestamp',
    'client_resync_seconds', 30,
    'uses_monotonic_elapsed_time', true,
    'approved_on', '2026-09-25'
  )
);
