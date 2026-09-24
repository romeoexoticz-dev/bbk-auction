"use client";

import { useActionState } from "react";
import {
  submitPaymentEvidence,
  type PaymentEvidenceState,
} from "@/app/(customer)/orders/[id]/actions";

const initialState: PaymentEvidenceState = {};

export function PaymentEvidenceForm({
  orderId,
  requestKey,
}: {
  orderId: string;
  requestKey: string;
}) {
  const [state, action, pending] = useActionState(submitPaymentEvidence, initialState);

  return (
    <form action={action} className="payment-upload-form">
      <input name="orderId" type="hidden" value={orderId} />
      <input name="requestKey" type="hidden" value={requestKey} />
      <label>
        รูปสลิปหรือหลักฐานการโอน
        <input
          accept="image/jpeg,image/png,image/webp,application/pdf"
          name="evidence"
          required
          type="file"
        />
        <small>รองรับ JPG, PNG, WebP หรือ PDF ขนาดไม่เกิน 5 MB</small>
      </label>
      {state.error && <p className="form-error" role="alert">{state.error}</p>}
      {state.success && <p className="payment-form-success" role="status">{state.success}</p>}
      <button className="button button-gold" disabled={pending} type="submit">
        {pending ? "กำลังส่ง..." : "ส่งหลักฐานให้แอดมินตรวจ"}
      </button>
    </form>
  );
}
