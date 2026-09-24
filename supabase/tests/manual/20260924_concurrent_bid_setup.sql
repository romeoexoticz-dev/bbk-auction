-- Creates one isolated live auction used only by the concurrent-connection test.

do $$
declare
  v_auction_id constant uuid := 'c0260924-0000-4000-8000-000000000001';
  v_seller_id uuid;
begin
  if exists (select 1 from public.auctions where id = v_auction_id) then
    raise exception 'CONCURRENT_TEST_FIXTURE_ALREADY_EXISTS';
  end if;

  select sp.user_id into v_seller_id
  from public.seller_profiles sp
  where sp.status = 'approved'
  order by sp.created_at
  limit 1;

  if v_seller_id is null then
    raise exception 'APPROVED_SELLER_NOT_FOUND';
  end if;

  insert into public.auctions (
    id, seller_id, title, description, category, status,
    opening_price, current_price, min_increment, reserve_price,
    starts_at, ends_at
  ) values (
    v_auction_id,
    v_seller_id,
    '[TEST] Concurrent bid ' || to_char(clock_timestamp(), 'YYYY-MM-DD HH24:MI:SS'),
    'Temporary concurrency fixture. Delete after verification.',
    'ธนบัตร',
    'live',
    100000,
    100000,
    5000,
    99999999,
    clock_timestamp() + interval '30 seconds',
    clock_timestamp() + interval '10 minutes'
  );
end;
$$;

select id, title, status, starts_at, ends_at, current_price, bid_count
from public.auctions
where id = 'c0260924-0000-4000-8000-000000000001';
