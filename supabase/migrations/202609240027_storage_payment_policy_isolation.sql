-- Keep the payment-evidence storage policy from reading the private
-- marketplace_settings table as the authenticated role. PostgreSQL may
-- evaluate every permissive INSERT policy on storage.objects, even when the
-- bucket predicate belongs to a different bucket, which previously blocked
-- auction-media uploads with a marketplace_settings permission error.

create or replace function public.can_upload_payment_evidence(
  p_order_id text,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.orders o
    join public.marketplace_settings ms on ms.id = 1
    where o.id::text = p_order_id
      and o.buyer_id = p_user_id
      and o.status = 'pending_payment'
      and o.payment_review_state in ('not_submitted', 'needs_correction')
      and o.payment_due_at >= now()
      and o.shipping_configured_at is not null
      and ms.payment_submission_enabled
  );
$$;

revoke all on function public.can_upload_payment_evidence(text, uuid)
from public, anon;
grant execute on function public.can_upload_payment_evidence(text, uuid)
to authenticated;

drop policy if exists "buyers upload payment evidence while enabled"
on storage.objects;

create policy "buyers upload payment evidence while enabled"
on storage.objects for insert to authenticated
with check (
  case
    when bucket_id = 'payment-evidence'
      and (storage.foldername(name))[1] = auth.uid()::text
    then public.can_upload_payment_evidence(
      (storage.foldername(name))[2],
      auth.uid()
    )
    else false
  end
);

insert into public.audit_events (
  actor_id,
  event_type,
  entity_type,
  entity_id,
  payload
)
values (
  null,
  'storage.payment_policy_isolated',
  'system',
  'storage-payment-policy-isolation-2026-09-24',
  jsonb_build_object(
    'auction_media_uploads_unblocked', true,
    'marketplace_settings_remains_private', true
  )
)
on conflict do nothing;
