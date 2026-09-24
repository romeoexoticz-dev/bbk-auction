# Payment evidence and admin review

## Scope

- A winning buyer can upload one private payment-evidence file for an order.
- Admin or finance can approve the evidence or return it for correction with a reason.
- Every submission and review is recorded in `audit_events` and creates an in-app notification.
- Evidence is stored in the private Supabase Storage bucket `payment-evidence`.
- Admin or finance sets shipping per order before the buyer can submit evidence.
- Admin advances an approved order through preparing and shipped states.
- The database sends one in-app reminder two hours before the deadline.
- On the first unpaid expiry, the order is cancelled and the buyer receives a warning.
- On the second unpaid expiry, bidding is suspended until an admin reviews the account.

## Non-goals for this phase

- No payment gateway, automatic bank reconciliation, refund, payout, or escrow.
- No live payment instructions or bank account are published.
- Buyer delivery confirmation, inspection window, disputes, and completion are deferred until their rules are approved.

## Approved rules

- Buyer fee: 10% of the winning amount.
- VAT: 7% of the buyer fee, making the effective addition 10.7%.
- Payment window: 24 hours after the admin first confirms the final shipping amount, so the buyer receives a full payment window after the total is ready.
- Existing pending orders were extended to the same rule when the deadline workflow was installed.
- Evidence types: JPG, PNG, WebP, or PDF; maximum 5 MB.
- Real payment submission stays disabled until the owner approves the bank/QR destination.
- Shipping is configured manually per order before payment; approved by the owner on 2026-09-23.

## Permission matrix

| Action | Buyer | Seller | Admin | Finance |
| --- | --- | --- | --- | --- |
| Read own evidence | Own order only | No | Yes | Yes |
| Upload evidence | Own payable order only | No | No | No |
| Approve / return evidence | No | No | Yes | Yes |
| Configure shipping amount | No | No | Yes | Yes |
| Mark preparing / shipped | No | No | Yes | No |
| Read audit events | No | No | Yes | No |

## State transitions

`not_submitted -> submitted -> approved`

`submitted -> needs_correction -> submitted`

Approval also changes the order from `pending_payment` to `paid`. Returning for correction leaves the order at `pending_payment`.

`paid -> preparing -> shipped`

The system does not advance to `delivered` or `completed` until the owner approves the inspection and dispute rules.

## Safety controls

- Two switches are required to accept uploads:
  1. `NEXT_PUBLIC_PAYMENTS_ENABLED=true` in the application environment.
  2. `marketplace_settings.payment_submission_enabled=true` in Supabase.
- Both switches currently remain false.
- The reminder and expiry jobs also check the database switch and do nothing while it is false.
- The server verifies authentication, buyer ownership, order state, deadline, file type, file size, object path, and current review state.
- Storage and database triggers reject payment evidence until shipping has been configured.
- Shipping amount is locked once evidence is submitted, and fulfillment transitions are server-enforced and idempotent.
- Submission uses an idempotency key. Admin review locks the order and only accepts a currently submitted record.
- Storage is private; access is limited by RLS and short-lived signed URLs.

## Acceptance criteria

- Disabled mode shows no upload control and cannot accept an object through Storage RLS.
- A buyer cannot upload to another buyer's order.
- Duplicate submission with the same request key returns the existing result.
- Admin approval changes the order exactly once and records the reviewer, reason, time, notification, and audit event.
- Return-for-correction keeps history and allows a new submission only while the payment window remains valid.
- Shipping changes recalculate the generated order total and produce a buyer notification and audit event.
- A tracking number can be recorded only after an approved order enters `preparing`.
- Expiry is idempotent: one order can create at most one strike, one cancellation, and one expiry notification.
- A second strike creates one admin-review case; the admin can reinstate the account or keep it suspended with a recorded reason.

## Production blockers

- Owner approval of the receiving bank/QR account.
- End-to-end test with a non-sensitive test file after both switches are intentionally enabled.
- Owner approval to turn both payment switches on after the receiving account is ready.
- Approved delivery/inspection window and dispute/return policy before enabling `delivered` and `completed` transitions.
