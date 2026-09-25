-- Verifies that an existing bidder-only account cannot use seller/admin
-- capabilities or read protected operational data. The bidder UUID never
-- leaves the database result set and this test performs no persistent writes.

begin;

drop table if exists pg_temp.authz_test_results;

create temporary table authz_test_results (
  test_step text not null,
  passed boolean not null,
  result_code text not null,
  detail text not null
) on commit preserve rows;

grant select, insert on table authz_test_results to authenticated;

create or replace function pg_temp.expect_denial(
  p_test_step text,
  p_statement text,
  p_expected_code text
)
returns table (
  test_step text,
  passed boolean,
  result_code text,
  detail text
)
language plpgsql
security invoker
as $$
begin
  begin
    execute p_statement;
    return query select
      p_test_step,
      false,
      'UNEXPECTEDLY_ALLOWED',
      'คำสั่งทำงานสำเร็จทั้งที่ต้องถูกปฏิเสธ';
  exception
    when others then
      return query select
        p_test_step,
        position(p_expected_code in sqlerrm) > 0,
        case
          when position(p_expected_code in sqlerrm) > 0 then p_expected_code
          else sqlstate || ':' || sqlerrm
        end,
        'คาดว่าจะได้รับ ' || p_expected_code;
  end;
end;
$$;

do $select_bidder$
declare
  v_bidder_id uuid;
begin
  select bidder.user_id into v_bidder_id
  from public.role_assignments bidder
  join public.profiles profile on profile.id = bidder.user_id
  where bidder.role_name = 'bidder'
    and profile.account_status = 'active'
    and not exists (
      select 1 from public.role_assignments elevated
      where elevated.user_id = bidder.user_id
        and elevated.role_name in ('admin', 'seller', 'support', 'finance')
    )
  order by bidder.assigned_at
  limit 1;

  if v_bidder_id is null then
    raise exception 'BIDDER_ONLY_TEST_SUBJECT_NOT_FOUND';
  end if;

  perform set_config('request.jwt.claim.sub', v_bidder_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
end;
$select_bidder$;

set local role authenticated;

insert into authz_test_results
select
  'บัญชีลูกค้าไม่มีสิทธิ์แอดมิน',
  not public.has_role('admin'),
  case when public.has_role('admin') then 'UNEXPECTED_ADMIN_ROLE' else 'ADMIN_ROLE_DENIED' end,
  'ตรวจจาก role_assignments ผ่าน has_role';

insert into authz_test_results
select
  'บัญชีลูกค้าไม่มีสิทธิ์ผู้ขาย',
  not public.has_role('seller'),
  case when public.has_role('seller') then 'UNEXPECTED_SELLER_ROLE' else 'SELLER_ROLE_DENIED' end,
  'ตรวจจาก role_assignments ผ่าน has_role';

insert into authz_test_results
select * from pg_temp.expect_denial(
  'เรียกรายงานความสนใจของแอดมินไม่ได้',
  'select * from public.admin_auction_interest_summary()',
  'ADMIN_REQUIRED'
);

insert into authz_test_results
select * from pg_temp.expect_denial(
  'อนุมัติรายการประมูลแทนแอดมินไม่ได้',
  $$select public.review_auction(
    gen_random_uuid(),
    'approve',
    'authorization test only'
  )$$,
  'ADMIN_ROLE_REQUIRED'
);

insert into authz_test_results
select * from pg_temp.expect_denial(
  'สร้างรายการแทนผู้ขายไม่ได้',
  $$select public.create_auction_draft_with_details(
    'Authorization test',
    'This operation must be denied before any draft is created.',
    'ของเก่า',
    100000,
    5000,
    now() + interval '1 hour',
    now() + interval '2 hours',
    'ทดสอบ',
    'ทดสอบสิทธิ์',
    'ไม่มี',
    'ข้อมูลทดสอบสิทธิ์เท่านั้น',
    'ต้องถูกปฏิเสธก่อนสร้างข้อมูล'
  )$$,
  'SELLER_ROLE_REQUIRED'
);

insert into authz_test_results
select
  'RLS ไม่ให้เห็นบทบาทของผู้อื่น',
  count(*) = 0,
  case when count(*) = 0 then 'OTHER_ROLES_HIDDEN' else 'OTHER_ROLES_VISIBLE' end,
  'rows=' || count(*)::text
from public.role_assignments
where user_id <> auth.uid();

insert into authz_test_results
select
  'RLS ไม่ให้เห็นโปรไฟล์ของผู้อื่น',
  count(*) = 0,
  case when count(*) = 0 then 'OTHER_PROFILES_HIDDEN' else 'OTHER_PROFILES_VISIBLE' end,
  'rows=' || count(*)::text
from public.profiles
where id <> auth.uid();

insert into authz_test_results
select
  'RLS ไม่ให้เห็น Audit หลังบ้าน',
  count(*) = 0,
  case when count(*) = 0 then 'AUDIT_HIDDEN' else 'AUDIT_VISIBLE' end,
  'rows=' || count(*)::text
from public.audit_events;

insert into authz_test_results
select
  'ฟังก์ชันรายชื่อแอดมินไม่เปิดเผยข้อมูล',
  count(*) = 0,
  case when count(*) = 0 then 'ADMIN_LIST_HIDDEN' else 'ADMIN_LIST_VISIBLE' end,
  'rows=' || count(*)::text
from public.admin_list_administrators();

reset role;
commit;

select test_step, passed, result_code, detail
from authz_test_results
order by test_step;
