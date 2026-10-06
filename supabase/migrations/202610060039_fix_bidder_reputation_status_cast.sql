-- Forward-fix: bidder verification status is an enum and must be returned as text.

create or replace function public.admin_bidder_reputation(
  p_search text default null,
  p_limit integer default 100
)
returns table (
  user_id uuid,
  display_name text,
  account_status public.account_status,
  email_verified boolean,
  verification_status text,
  won_auctions bigint,
  successful_orders bigint,
  payment_defaults bigint,
  score_percent numeric,
  reputation_state text,
  last_default_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  if not public.has_role('admin', auth.uid()) then
    raise exception 'ADMIN_REQUIRED' using errcode = 'P0001';
  end if;

  return query
  with bidder_users as (
    select distinct ra.user_id
    from public.role_assignments ra
    where ra.role_name = 'bidder'
  ), wins as (
    select ar.winner_id as user_id, count(*)::bigint as won_auctions
    from public.auction_results ar
    where ar.winner_id is not null and ar.reserve_met
    group by ar.winner_id
  ), successful as (
    select o.buyer_id as user_id, count(*)::bigint as successful_orders
    from public.orders o
    where o.status in ('paid', 'preparing', 'shipped', 'delivered', 'completed')
      and coalesce(o.payment_evidence_is_test, false) = false
    group by o.buyer_id
  ), defaults as (
    select ope.buyer_id as user_id,
           count(*)::bigint as payment_defaults,
           max(ope.expired_at) as last_default_at
    from public.order_payment_expirations ope
    group by ope.buyer_id
  )
  select
    p.id,
    coalesce(nullif(btrim(p.display_name), ''), 'สมาชิก ' || upper(left(p.id::text, 8))),
    p.account_status,
    p.email_verified,
    coalesce(bv.status::text, 'not_submitted'),
    coalesce(w.won_auctions, 0),
    coalesce(s.successful_orders, 0),
    coalesce(d.payment_defaults, 0),
    case
      when coalesce(s.successful_orders, 0) + coalesce(d.payment_defaults, 0) = 0 then null
      else round(
        coalesce(s.successful_orders, 0)::numeric * 100
        / (coalesce(s.successful_orders, 0) + coalesce(d.payment_defaults, 0)),
        0
      )
    end,
    case
      when p.account_status = 'suspended' then 'suspended'
      when coalesce(pdc.review_status, '') in ('pending_review', 'kept_suspended') then 'needs_review'
      when coalesce(pdc.strike_count, 0) >= 1 then 'warning'
      when coalesce(s.successful_orders, 0) + coalesce(d.payment_defaults, 0) = 0 then 'new'
      else 'good'
    end,
    d.last_default_at
  from bidder_users bu
  join public.profiles p on p.id = bu.user_id
  left join public.bidder_verifications bv on bv.user_id = p.id
  left join public.payment_default_cases pdc on pdc.user_id = p.id
  left join wins w on w.user_id = p.id
  left join successful s on s.user_id = p.id
  left join defaults d on d.user_id = p.id
  where p_search is null
     or btrim(p_search) = ''
     or coalesce(p.display_name, '') ilike '%' || btrim(p_search) || '%'
     or p.id::text ilike btrim(p_search) || '%'
  order by
    case
      when p.account_status = 'suspended' then 0
      when coalesce(pdc.strike_count, 0) > 0 then 1
      else 2
    end,
    d.last_default_at desc nulls last,
    p.created_at desc
  limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$$;

revoke all on function public.admin_bidder_reputation(text, integer) from public, anon;
grant execute on function public.admin_bidder_reputation(text, integer) to authenticated;

insert into public.audit_events (actor_id, event_type, entity_type, entity_id, payload)
values (
  null,
  'risk.bidder_reputation_status_cast_fixed',
  'system',
  'bidder-reputation-status-cast-2026-10-06',
  jsonb_build_object('verification_status_cast_to_text', true)
);
