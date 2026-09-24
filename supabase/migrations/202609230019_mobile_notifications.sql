-- Mobile-first in-app notification center with private Realtime delivery.

create index if not exists notifications_user_unread_created_idx
on public.notifications (user_id, created_at desc)
where read_at is null;

create or replace function public.mark_all_notifications_read()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  update public.notifications
  set read_at = now()
  where user_id = auth.uid() and read_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.broadcast_notification_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.broadcast_changes(
    'notifications:' || coalesce(new.user_id, old.user_id)::text,
    tg_op, tg_op, tg_table_name, tg_table_schema, new, old
  );
  return coalesce(new, old);
end;
$$;

drop trigger if exists notifications_broadcast_after_change on public.notifications;
create trigger notifications_broadcast_after_change
after insert or update on public.notifications
for each row execute function public.broadcast_notification_change();

drop policy if exists "users receive own notification broadcasts" on realtime.messages;
create policy "users receive own notification broadcasts"
on realtime.messages for select to authenticated
using (
  extension = 'broadcast'
  and realtime.topic() = 'notifications:' || auth.uid()::text
);

revoke all on function public.mark_all_notifications_read() from public, anon;
grant execute on function public.mark_all_notifications_read() to authenticated;

insert into public.audit_events (actor_id, event_type, entity_type, entity_id, payload)
values (
  null,
  'notifications.mobile_center_installed',
  'system',
  'mobile-notification-center',
  jsonb_build_object(
    'delivery', 'private_realtime_broadcast',
    'surface', 'mobile_bottom_sheet',
    'external_push_enabled', false,
    'installed_at', now()
  )
);
