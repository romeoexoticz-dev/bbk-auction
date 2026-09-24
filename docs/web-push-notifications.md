# Web Push notifications

BBK Auction uses an explicit opt-in Web Push flow. The browser permission prompt is shown only after the signed-in user taps **เปิดแจ้งเตือน**. Subscription endpoints and encryption keys are private database records and are never returned to other users.

## Delivery flow

1. A notification is created by the existing server-authoritative auction or order workflow.
2. The database creates one idempotent `push_deliveries` row per active subscription.
3. When dispatch is enabled, Supabase `pg_net` calls the private `/api/push/dispatch` route immediately.
4. A five-minute database cron retries pending deliveries if the first call fails.
5. The route claims rows with a shared secret, sends encrypted Web Push messages, and records success or retry state.

## Safe default

The migration installs the queue with `push_dispatch_enabled = false`. Installing the migration does not send a push message, create a browser permission prompt, or activate customer-facing automation.

## Production activation checklist

- Deploy the app to its final HTTPS Vercel URL.
- Generate one VAPID key pair and store the public key in both `NEXT_PUBLIC_VAPID_PUBLIC_KEY` and `VAPID_PUBLIC_KEY`.
- Store the private key only in `VAPID_PRIVATE_KEY`.
- Set `VAPID_SUBJECT` to the approved support email or website URL.
- Generate a random server secret of at least 32 characters and store it only in `PUSH_DISPATCH_SECRET`.
- Add the same values to the Vercel production environment without exposing private values in logs.
- While signed in as an admin, call `configure_push_dispatch('https://<domain>/api/push/dispatch', '<secret>', true)` once.
- Test opt-in, background delivery, notification click-through, retry, and unsubscribe on Android and iPhone before enabling for customers.

Activation changes customer-facing behavior and must be explicitly approved before the final configuration call.
