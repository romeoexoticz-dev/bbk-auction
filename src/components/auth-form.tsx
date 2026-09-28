"use client";

import { type MouseEvent, useActionState, useState } from "react";
import { requestPasswordReset, signIn, signInWithGoogle, signUp, type AuthActionState, type PasswordResetState } from "@/app/auth/actions";
import { EmailConfirmationMessage } from "@/components/email-confirmation-message";

const initialState: AuthActionState = {};
const initialResetState: PasswordResetState = {};

export function AuthForm({ googleEnabled, nextPath }: { googleEnabled: boolean; nextPath: string }) {
  const [mode, setMode] = useState<"sign-in" | "sign-up" | "forgot-password">("sign-in");
  const [signInState, signInAction, signInPending] = useActionState(signIn, initialState);
  const [signUpState, signUpAction, signUpPending] = useActionState(signUp, initialState);
  const [resetState, resetAction, resetPending] = useActionState(requestPasswordReset, initialResetState);
  const state = mode === "sign-in" ? signInState : mode === "sign-up" ? signUpState : resetState;
  const pending = mode === "sign-in" ? signInPending : mode === "sign-up" ? signUpPending : resetPending;

  function submitFromButton(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  return (
    <div className="auth-card">
      {googleEnabled && mode !== "forgot-password" && <>
        <form action={signInWithGoogle}>
          <input name="next" type="hidden" value={nextPath} />
          <button className="auth-google" type="submit">
            <span aria-hidden="true">G</span>
            ดำเนินการต่อด้วย Google
          </button>
        </form>
        <div className="auth-divider"><span>หรือใช้อีเมล</span></div>
      </>}
      {mode !== "forgot-password" && <div className="auth-tabs" role="tablist" aria-label="เลือกรูปแบบบัญชี">
        <button className={mode === "sign-in" ? "active" : ""} onClick={() => setMode("sign-in")} role="tab" type="button">เข้าสู่ระบบ</button>
        <button className={mode === "sign-up" ? "active" : ""} onClick={() => setMode("sign-up")} role="tab" type="button">สมัครสมาชิก</button>
      </div>}
      {mode === "forgot-password" && <div className="auth-reset-heading"><small>ขั้นตอน 1 จาก 2</small><strong>ขอลิงก์เปลี่ยนรหัสผ่าน</strong><p>กรอกอีเมลที่ใช้สมัครก่อน จากนั้นเปิดลิงก์ในอีเมล ระบบจึงจะแสดงช่อง “รหัสผ่านใหม่” และ “ยืนยันรหัสผ่านใหม่”</p></div>}
      <form action={mode === "sign-in" ? signInAction : mode === "sign-up" ? signUpAction : resetAction}>
        <input name="next" type="hidden" value={nextPath} />
        {mode === "sign-up" && <label>ชื่อที่ใช้แสดง<input autoComplete="name" name="displayName" placeholder="เช่น คุณตาล" type="text" /></label>}
        <label>อีเมล<input autoComplete="email" inputMode="email" name="email" placeholder="name@example.com" required type="email" /></label>
        {mode !== "forgot-password" && <label>รหัสผ่าน<input autoComplete={mode === "sign-in" ? "current-password" : "new-password"} minLength={8} name="password" placeholder="อย่างน้อย 8 ตัวอักษร" required type="password" /></label>}
        {"errorCode" in state && state.errorCode === "email_not_confirmed"
          ? <EmailConfirmationMessage defaultEmail={state.email} inline />
          : state.error ? <p className="form-error" role="alert">{state.error}</p>
          : "message" in state && state.message ? <p className="form-success" role="status">{state.message}</p>
          : null}
        <button className="button button-gold auth-submit" disabled={pending} onClick={submitFromButton} type="submit">{pending ? "กำลังดำเนินการ..." : mode === "sign-in" ? "เข้าสู่ระบบ" : mode === "sign-up" ? "สร้างบัญชี" : "ส่งลิงก์ไปที่อีเมล"}</button>
      </form>
      {mode === "sign-in" && <button className="auth-text-action" onClick={() => setMode("forgot-password")} type="button">ลืมรหัสผ่าน?</button>}
      {mode === "forgot-password" && <button className="auth-text-action" onClick={() => setMode("sign-in")} type="button">← กลับไปเข้าสู่ระบบ</button>}
      <p className="auth-footnote">บัญชีอีเมลต้องยืนยันอีเมลก่อนใช้งาน และทุกบัญชียังต้องได้รับอนุมัติผู้ประมูลก่อนวางราคา ขณะนี้ยังไม่เปิดรับสมัครผู้ขายภายนอก</p>
    </div>
  );
}
