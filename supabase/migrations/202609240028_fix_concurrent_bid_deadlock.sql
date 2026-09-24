-- Prevent concurrent bidders from deadlocking while preserving auction-level
-- serialization. bid_attempts.auction_id takes a KEY SHARE lock through its
-- foreign key before submit_bid locks the auction row. FOR UPDATE conflicts
-- with another transaction's KEY SHARE lock, so two bidders could deadlock.
-- FOR NO KEY UPDATE still serializes price/head updates and is compatible with
-- those foreign-key KEY SHARE locks because submit_bid never changes auctions.id.

do $migration$
declare
  v_signature constant regprocedure := 'public.submit_bid(uuid,bigint,uuid)'::regprocedure;
  v_definition text;
  v_patched_definition text;
  v_old_lock constant text := E'  for update;';
  v_new_lock constant text := E'  for no key update;';
  v_match_count integer;
begin
  select pg_get_functiondef(v_signature) into v_definition;

  v_match_count := (
    length(v_definition) - length(replace(v_definition, v_old_lock, ''))
  ) / length(v_old_lock);

  if v_match_count <> 1 then
    raise exception using
      errcode = 'P0001',
      message = 'SUBMIT_BID_AUCTION_LOCK_PATTERN_UNEXPECTED',
      detail = format('Expected exactly one FOR UPDATE lock, found %s', v_match_count);
  end if;

  v_patched_definition := replace(v_definition, v_old_lock, v_new_lock);
  execute v_patched_definition;
end;
$migration$;

do $verification$
declare
  v_definition text;
begin
  select lower(pg_get_functiondef('public.submit_bid(uuid,bigint,uuid)'::regprocedure))
  into v_definition;

  if position('for no key update' in v_definition) = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'SUBMIT_BID_NO_KEY_UPDATE_LOCK_NOT_INSTALLED';
  end if;
end;
$verification$;

insert into public.audit_events (actor_id, event_type, entity_type, entity_id, payload)
values (
  null,
  'bids.concurrent_lock_fixed',
  'system',
  'submit_bid',
  jsonb_build_object(
    'auction_lock', 'FOR NO KEY UPDATE',
    'reason', 'avoid foreign-key KEY SHARE deadlock while preserving bid serialization'
  )
);
