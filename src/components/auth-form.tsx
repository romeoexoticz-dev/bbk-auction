"use client";

import { useActionState, useState } from "react";
import { signIn, signUp, type AuthActionState } from "@/app/auth/actions";
import { EmailConfirmationMessage } from "@/components/email-confirmation-message";

const initialState: AuthActionState = {};

export function AuthForm({ nextPath }: { nextPath: string }) {
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [signInState, signInAction, signInPending] = useActionState(signIn, initialState);
  const [signUpState, signUpAction, signUpPending] = useActionState(signUp, initialState);
  const state = mode === "sign-in" ? signInState : signUpState;
  const pending = mode === "sign-in" ? signInPending : signUpPending;

  return (
    <div className="auth-card">
      <div className="auth-tabs" role="tablist" aria-label="เลือกรูปแบบบัญชี">
        <button className={mode === "sign-in" ? "active" : ""} onClick={() => setMode("sign-in")} role="tab" type="button">เข้าสู่ระบบ</button>
        <button className={mode === "sign-up" ? "active" : ""} onClick={() => setMode("sign-up")} role="tab" type="button">สมัครสมาชิก</button>
      </div>
      <form action={mode === "sign-in" ? signInAction : signUpAction}>
        <input name="next" type="hidden" value={nextPath} />
        {mode === "sign-up" && <label>ชื่อที่ใช้แสดง<input autoComplete="name" name="displayName" placeholder="เช่น คุณตาล" type="text" /></label>}
        <label>อีเมล<input autoComplete="email" inputMode="email" name="email" placeholder="name@example.com" required type="email" /></label>
        <label>รหัสผ่าน<input autoComplete={mode === "sign-in" ? "current-password" : "new-password"} minLength={8} name="password" placeholder="อย่างน้อย 8 ตัวอักษร" required type="password" /></label>
        {state.errorCode === "email_not_confirmed"
          ? <EmailConfirmationMessage defaultEmail={state.email} inline />
          : state.error && <p className="form-error" role="alert">{state.error}</p>}
        <button className="button button-gold auth-submit" disabled={pending} type="submit">{pending ? "กำลังดำเนินการ..." : mode === "sign-in" ? "เข้าสู่ระบบ" : "สร้างบัญชี"}</button>
      </form>
      <p className="auth-footnote">บัญชีใหม่เป็นบัญชีผู้ประมูล ต้องยืนยันอีเมลก่อนวางราคา ขณะนี้ยังไม่เปิดรับสมัครผู้ขายภายนอก</p>
    </div>
  );
}
