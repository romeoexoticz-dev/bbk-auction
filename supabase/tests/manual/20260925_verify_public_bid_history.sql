-- Read-only verification for the privacy-preserving public bid history RPC.

begin;

set local role anon;

with history as (
  select *
  from public.get_public_bid_history(
    '7a14e383-5eea-4af5-a9e2-76d69c381832'::uuid,
    10
  )
)
select
  has_function_privilege('anon', 'public.get_public_bid_history(uuid, integer)', 'EXECUTE')
    and not has_table_privilege('anon', 'public.bids', 'SELECT')
    and coalesce(bool_and(
      history.bid_sequence > 0
      and history.bidder_alias ~ '^ผู้ประมูล #[0-9]+$'
      and history.amount > 0
      and history.created_at is not null
      and not history.is_current_user
    ), true) as passed,
  'PUBLIC_HISTORY_WITHOUT_PERSONAL_DATA' as result_code,
  count(*) as masked_history_rows
from history;

rollback;
