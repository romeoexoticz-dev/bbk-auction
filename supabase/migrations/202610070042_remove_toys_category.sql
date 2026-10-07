-- Hide the removed toys category from the marketplace while retaining its rows
-- and an audit trail. Refuse to proceed if a toy auction has transaction data.
do $$
begin
  if exists (
    select 1
    from public.auctions a
    where a.category = 'ของเล่น'
      and (
        exists (select 1 from public.bids b where b.auction_id = a.id)
        or exists (select 1 from public.orders o where o.auction_id = a.id)
        or exists (select 1 from public.auction_results r where r.auction_id = a.id)
      )
  ) then
    raise exception 'TOY_AUCTIONS_HAVE_TRANSACTION_HISTORY';
  end if;
end;
$$;

with cancelled as (
  update public.auctions
  set status = 'cancelled',
      review_notes = 'ยกเลิกหมวดของเล่นตามคำขอเจ้าของระบบ',
      reviewed_at = now(),
      version = version + 1,
      updated_at = now()
  where category = 'ของเล่น'
    and status in ('live', 'scheduled')
  returning id, title, status, version
)
insert into public.audit_events (actor_id, event_type, entity_type, entity_id, payload)
select
  null,
  'auction.category_removed',
  'auction',
  id::text,
  jsonb_build_object(
    'from_status', 'live_or_scheduled',
    'to_status', status,
    'category', 'ของเล่น',
    'reason', 'เจ้าของระบบขอถอดหมวดของเล่นออกจากเว็บไซต์',
    'version', version,
    'payments_enabled', false
  )
from cancelled;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.auctions'::regclass
      and conname = 'auctions_removed_toys_must_be_cancelled'
  ) then
    alter table public.auctions
      add constraint auctions_removed_toys_must_be_cancelled
      check (category <> 'ของเล่น' or status = 'cancelled');
  end if;
end;
$$;
