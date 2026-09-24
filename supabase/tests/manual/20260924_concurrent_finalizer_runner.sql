-- Run this script at the same time from two independent SQL Editor tabs.

create or replace function pg_temp.run_bbk_concurrent_finalizer()
returns table (
  succeeded boolean,
  result_code text,
  auction_id uuid,
  finished_at timestamptz
)
language plpgsql
as $$
declare
  v_auction_id constant uuid := 'c0260924-0000-4000-8000-000000000001';
  v_result public.auction_results%rowtype;
begin
  perform pg_sleep(2);

  begin
    v_result := public.finalize_one_auction(v_auction_id, null, 'concurrency_test');
    return query select true, 'FINALIZED', v_result.auction_id, clock_timestamp();
  exception when others then
    return query select false, sqlstate || ':' || sqlerrm, v_auction_id, clock_timestamp();
  end;
end;
$$;

select * from pg_temp.run_bbk_concurrent_finalizer();
