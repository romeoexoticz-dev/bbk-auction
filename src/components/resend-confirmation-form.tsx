"use client";

import { useActionState, useEffect, useState } from "react";
import {
  resendConfirmation,
  type ResendConfirmationState,
} from "@/app/auth/actions";

const initialState: ResendConfirmationState = {};

export function ResendConfirmationForm({ defaultEmail }: { defaultEmail?: string }) {
  const [state, action, pending] = useActionState(resendConfirmation, initialState);
  const [clock, setClock] = useState(() => Date.now());

  useEffect(() => {
    if (!state.cooldownUntil) return;
    const refresh = window.setTimeout(() => setClock(Date.now()), 0);
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => {
      window.clearTimeout(refresh);
      window.clearInterval(timer);
    };
  }, [state.cooldownUntil]);

  const secondsLeft = state.cooldownUntil
    ? Math.max(0, Math.ceil((state.cooldownUntil - clock) / 1000))
    : 0;

  const disabled = pending || secondsLeft > 0;

  return (
    <form action={action} className="resend-confirmation-form">
      {defaultEmail
        ? <input name="email" type="hidden" value={defaultEmail} />
        : (
          <label>
            อีเมลที่ใช้สมัคร
            <input
              autoComplete="email"
              inputMode="email"
              name="email"
              placeholder="name@example.com"
              required
              type="email"
            />
          </label>
        )}
      {state.error && <p className="resend-feedback resend-error" role="alert">{state.error}</p>}
      {state.message && <p className="resend-feedback resend-success" role="status">{state.message}</p>}
      <button className="button resend-confirmation-button" disabled={disabled} type="submit">
        {pending
          ? "กำลังส่ง..."
          : secondsLeft > 0
            ? `ส่งได้อีกครั้งใน ${secondsLeft} วินาที`
            : "ส่งอีเมลยืนยันอีกครั้ง"}
      </button>
    </form>
  );
}
