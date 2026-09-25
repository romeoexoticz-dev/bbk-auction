-- Verifies one in-app reminder per participating bidder and no duplicate send.
-- All fixture changes and notifications are rolled back.

begin;

create or replace function pg_temp.verify_ending_reminders()
returns table (
  test_step text,
  passed boolean,
  result_code text,
  detail text
)
language plpgsql
as $$
declare
  v_auction_id constant uuid := '7a14e383-5eea-4af5-a9e2-76d69c381832';
  v_expected integer;
  v_first integer;
  v_second integer;
  v_notifications integer;
  v_jobs integer;
begin
  select count(distinct bidder_id)::integer into v_expected
  from public.bids
  where auction_id = v_auction_id;

  if v_expected < 1 then
    raise exception 'ENDING_REMINDER_FIXTURE_HAS_NO_BIDDERS';
  end if;

  update public.auctions
  set item_year = 'รายการทดสอบ',
      item_model = 'ทดสอบแจ้งเตือน',
      item_size = 'ไม่ใช้ขายจริง',
      condition_summary = 'ข้อมูลจำลองสำหรับทดสอบ',
      expert_notes = 'ทดสอบใน transaction และ rollback ทั้งหมด'
  where id = v_auction_id;

  with media_base as (
    select coalesce(max(position), 0) as last_position
    from public.auction_media
    where auction_id = v_auction_id
  ), desired(media_kind, offset_position) as (
    values ('front'::text, 1), ('back'::text, 2), ('defect'::text, 3)
  )
  insert into public.auction_media (
    auction_id, owner_id, bucket_id, object_path, media_kind,
    position, mime_type, byte_size
  )
  select
    v_auction_id,
    auction.seller_id,
    'auction-media',
    'tests/' || v_auction_id::text || '/ending-reminder-' || desired.media_kind || '.png',
    desired.media_kind,
    media_base.last_position + desired.offset_position,
    'image/png',
    1
  from public.auctions as auction
  cross join media_base
  cross join desired
  where auction.id = v_auction_id
    and not exists (
      select 1
      from public.auction_media existing
      where existing.auction_id = v_auction_id
        and existing.media_kind = desired.media_kind
    );

  update public.auctions
  set status = 'live',
      ends_at = clock_timestamp() + interval '14 minutes'
  where id = v_auction_id;

  delete from public.notifications
  where dedupe_key like 'auction-ending-soon:' || v_auction_id::text || ':%';

  v_first := public.send_auction_ending_reminders();
  v_second := public.send_auction_ending_reminders();

  select count(*)::integer into v_notifications
  from public.notifications
  where notification_type = 'auction_ending_soon'
    and entity_type = 'auction'
    and entity_id = v_auction_id::text
    and dedupe_key like 'auction-ending-soon:' || v_auction_id::text || ':%';

  select count(*)::integer into v_jobs
  from cron.job
  where jobname = 'bbk-auction-ending-reminders';

  return query select
    'ส่งครั้งเดียวต่อผู้ร่วมประมูล'::text,
    v_first = v_expected and v_second = 0 and v_notifications = v_expected,
    case
      when v_first = v_expected and v_second = 0 and v_notifications = v_expected
        then 'ENDING_REMINDER_DEDUPED'
      else 'ENDING_REMINDER_DUPLICATE_OR_MISSING'
    end,
    format('expected=%s first=%s second=%s rows=%s', v_expected, v_first, v_second, v_notifications);

  return query select
    'Cron ทำงานหนึ่งชุด'::text,
    v_jobs = 1,
    case when v_jobs = 1 then 'ONE_CRON_JOB' else 'CRON_JOB_COUNT_MISMATCH' end,
    format('jobs=%s', v_jobs);

  return query select
    'ลูกค้าเรียกฟังก์ชันส่งเองไม่ได้'::text,
    not has_function_privilege('anon', 'public.send_auction_ending_reminders()', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.send_auction_ending_reminders()', 'EXECUTE'),
    'SERVER_ONLY_EXECUTION'::text,
    'anon=false authenticated=false'::text;
end;
$$;

select * from pg_temp.verify_ending_reminders();

rollback;
