-- Give existing pending orders the same full 24-hour window as new orders.

with adjusted as (
  update public.orders
  set payment_due_at = shipping_configured_at + interval '24 hours'
  where status = 'pending_payment'
    and payment_review_state in ('not_submitted', 'needs_correction')
    and shipping_configured_at is not null
    and payment_due_at < shipping_configured_at + interval '24 hours'
  returning id
)
insert into public.audit_events (actor_id, event_type, entity_type, entity_id, payload)
select
  null,
  'payment.deadline_backfill_applied',
  'system',
  'payment-deadline-backfill-20260923',
  jsonb_build_object('adjusted_orders', count(*), 'payments_enabled', false)
from adjusted;
