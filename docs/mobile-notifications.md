# Mobile in-app notifications

## Scope

- Authenticated buyers see a fixed notification bell on every customer route.
- The unread count and notification list update through a private Supabase Realtime Broadcast channel.
- On small screens the center opens as a thumb-friendly bottom sheet; on larger screens it opens as a right-side drawer.
- Tapping a notification marks it read and routes to the related order, auction, or account page.
- Buyers can mark all notifications as read in one action.

## Permission boundary

- Notification rows remain readable only by their owner or an administrator under the existing table RLS policy.
- Realtime subscription topics use `notifications:<user-id>` and can be joined only when the topic user ID equals `auth.uid()`.
- Database inserts and updates are the source of truth. Realtime only announces committed changes.

## Current events

- Bid result and winner/order events.
- Payment deadline reminders and non-payment actions.
- Shipping amount, payment review, preparation, and shipment updates.
- Account reinstatement or suspension decisions.

## Explicit non-goals

- No operating-system push notification while the website is closed.
- No LINE, SMS, email, or marketing notification is sent.
- No browser notification permission is requested in this phase.

## Verified

- Private Broadcast trigger, topic policy, and mark-all RPC exist in the production Supabase project.
- Mark-all behavior was tested inside a rolled-back transaction; no test notification remained.
- The 390 × 844 responsive view shows a full-width bottom sheet with safe-area spacing.
- Lint and the production build pass.
