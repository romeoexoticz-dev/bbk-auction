-- Read-only verification for the public database clock used by countdowns.

begin;
set local role anon;

select
  'ผู้ใช้ทั่วไปอ่านเวลาฐานข้อมูลได้' as test_step,
  abs(extract(epoch from (public.get_database_time() - clock_timestamp()))) < 1 as passed,
  'DATABASE_CLOCK_AVAILABLE' as result_code
union all
select
  'สิทธิ์เรียกเวลาฐานข้อมูล' as test_step,
  has_function_privilege('anon', 'public.get_database_time()', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.get_database_time()', 'EXECUTE') as passed,
  'LEAST_PRIVILEGE_EXECUTE_ONLY' as result_code;

rollback;
