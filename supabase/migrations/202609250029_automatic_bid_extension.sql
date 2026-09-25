-- Owner-approved anti-sniping rule:
-- an accepted bid within the final 2 minutes extends the deadline by 2 minutes.
-- The existing atomic submit_bid RPC already applies the configured window and
-- duration while holding the auction row lock; this migration activates it.

alter table public.auctions
  alter column extension_window_seconds set default 120,
  alter column extension_duration_seconds set default 120;

-- Activate only auctions whose rules can still be changed safely. Never change
-- a live auction's deadline rule after customers have started bidding.
update public.auctions
set extension_window_seconds = 120,
    extension_duration_seconds = 120,
    updated_at = clock_timestamp()
where status in ('draft', 'pending_review', 'scheduled')
  and extension_window_seconds = 0
  and extension_duration_seconds = 0;

create or replace function public.audit_automatic_deadline_extension()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'live'
    and new.status = 'live'
    and old.extension_window_seconds > 0
    and old.extension_duration_seconds > 0
    and new.ends_at = old.ends_at + make_interval(secs => old.extension_duration_seconds) then
    insert into public.audit_events (actor_id, event_type, entity_type, entity_id, payload)
    values (
      auth.uid(),
      'auction.deadline_extended',
      'auction',
      new.id::text,
      jsonb_build_object(
        'previous_ends_at', old.ends_at,
        'new_ends_at', new.ends_at,
        'extension_window_seconds', old.extension_window_seconds,
        'extension_duration_seconds', old.extension_duration_seconds,
        'trigger', 'accepted_late_bid'
      )
    );
  end if;

  return new;
end;
$$;

drop trigger if exists auctions_audit_automatic_extension on public.auctions;
create trigger auctions_audit_automatic_extension
after update of ends_at on public.auctions
for each row execute function public.audit_automatic_deadline_extension();

do $verification$
declare
  v_window_default text;
  v_duration_default text;
  v_submit_bid_definition text;
begin
  select pg_get_expr(ad.adbin, ad.adrelid)
  into v_window_default
  from pg_attrdef ad
  join pg_attribute a on a.attrelid = ad.adrelid and a.attnum = ad.adnum
  where ad.adrelid = 'public.auctions'::regclass
    and a.attname = 'extension_window_seconds';

  select pg_get_expr(ad.adbin, ad.adrelid)
  into v_duration_default
  from pg_attrdef ad
  join pg_attribute a on a.attrelid = ad.adrelid and a.attnum = ad.adnum
  where ad.adrelid = 'public.auctions'::regclass
    and a.attname = 'extension_duration_seconds';

  select lower(pg_get_functiondef('public.submit_bid(uuid,bigint,uuid)'::regprocedure))
  into v_submit_bid_definition;

  if v_window_default <> '120' or v_duration_default <> '120' then
    raise exception 'AUTOMATIC_EXTENSION_DEFAULTS_NOT_INSTALLED';
  end if;

  if position('ends_at - v_now <= make_interval(secs => extension_window_seconds)' in v_submit_bid_definition) = 0 then
    raise exception 'SUBMIT_BID_EXTENSION_LOGIC_NOT_FOUND';
  end if;
end;
$verification$;

insert into public.audit_events (actor_id, event_type, entity_type, entity_id, payload)
values (
  null,
  'auction.automatic_extension_enabled',
  'system',
  'auction-rules',
  jsonb_build_object(
    'extension_window_seconds', 120,
    'extension_duration_seconds', 120,
    'applies_to', 'new_and_not-yet-live_auctions',
    'approved_on', '2026-09-25'
  )
);
