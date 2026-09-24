-- Open admin-approved scheduled auctions from database time.
-- Cron is the primary worker; read-time RPC calls are a safe recovery path.

create extension if not exists pg_cron;

create or replace function public.open_due_auctions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auction record;
  v_version bigint;
  v_opened integer := 0;
begin
  for v_auction in
    select id, starts_at, ends_at
    from public.auctions
    where status = 'scheduled'
      and starts_at <= now()
      and ends_at > now()
    order by starts_at asc
    for update skip locked
  loop
    update public.auctions
    set status = 'live',
        version = version + 1
    where id = v_auction.id
      and status = 'scheduled'
      and starts_at <= now()
      and ends_at > now()
    returning version into v_version;

    if found then
      insert into public.audit_events (actor_id, event_type, entity_type, entity_id, payload)
      values (
        null,
        'auction.opened_automatically',
        'auction',
        v_auction.id::text,
        jsonb_build_object(
          'from_status', 'scheduled',
          'to_status', 'live',
          'starts_at', v_auction.starts_at,
          'ends_at', v_auction.ends_at,
          'version', v_version,
          'source', 'database_time',
          'payments_enabled', false
        )
      );
      v_opened := v_opened + 1;
    end if;
  end loop;

  return v_opened;
end;
$$;

revoke all on function public.open_due_auctions() from public;
grant execute on function public.open_due_auctions() to anon, authenticated;

select cron.schedule(
  'bbk-open-due-auctions',
  '* * * * *',
  'select public.open_due_auctions();'
);

-- Open any already-due auction immediately when this migration is applied.
select public.open_due_auctions();
