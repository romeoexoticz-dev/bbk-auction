-- Prevent the current highest bidder from raising their own accepted bid while
-- no other bidder has overtaken them. The auction row is already locked by
-- submit_bid, so this decision is serialized with concurrent bid acceptance.

do $migration$
declare
  v_signature constant regprocedure := 'public.submit_bid(uuid,bigint,uuid)'::regprocedure;
  v_definition text;
  v_marker constant text := 'insert into public.bids';
  v_guard constant text := E'  if v_previous_leader.id is not null and v_previous_leader.bidder_id = v_bidder_id then\n    update public.bid_attempts\n    set outcome = ''rejected'', reason_code = ''ALREADY_HIGHEST_BIDDER'', completed_at = clock_timestamp()\n    where id = v_attempt_id;\n    return jsonb_build_object(\n      ''ok'', false,\n      ''code'', ''ALREADY_HIGHEST_BIDDER'',\n      ''current_amount'', v_previous_leader.amount\n    );\n  end if;\n\n';
  v_match_count integer;
begin
  select pg_get_functiondef(v_signature) into v_definition;

  if position('ALREADY_HIGHEST_BIDDER' in v_definition) > 0 then
    return;
  end if;

  if position('select * into v_previous_leader' in lower(v_definition)) = 0
    or position('select * into v_previous_leader' in lower(v_definition)) > position(v_marker in lower(v_definition)) then
    raise exception using
      errcode = 'P0001',
      message = 'SUBMIT_BID_PREVIOUS_LEADER_LOOKUP_MISSING';
  end if;

  v_match_count := (
    length(v_definition) - length(replace(v_definition, v_marker, ''))
  ) / length(v_marker);

  if v_match_count <> 1 then
    raise exception using
      errcode = 'P0001',
      message = 'SUBMIT_BID_INSERT_PATTERN_UNEXPECTED',
      detail = format('Expected exactly one bid insert marker, found %s', v_match_count);
  end if;

  execute replace(v_definition, v_marker, v_guard || v_marker);
end;
$migration$;

do $verification$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.submit_bid(uuid,bigint,uuid)'::regprocedure)
  into v_definition;

  if position('ALREADY_HIGHEST_BIDDER' in v_definition) = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'LEADING_BIDDER_SELF_RAISE_GUARD_NOT_INSTALLED';
  end if;

  if position('for no key update' in lower(v_definition)) = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'SUBMIT_BID_SERIALIZATION_LOCK_MISSING';
  end if;
end;
$verification$;

insert into public.audit_events (actor_id, event_type, entity_type, entity_id, payload)
select
  null,
  'bids.leading_bidder_self_raise_blocked',
  'system',
  'submit_bid',
  jsonb_build_object(
    'reason_code', 'ALREADY_HIGHEST_BIDDER',
    'rule', 'current highest bidder must wait until another bidder overtakes them',
    'enforced_at', 'database'
  )
where not exists (
  select 1
  from public.audit_events
  where event_type = 'bids.leading_bidder_self_raise_blocked'
    and entity_type = 'system'
    and entity_id = 'submit_bid'
);
