"use client";

import { useActionState } from "react";
import { updatePassword, type UpdatePasswordState } from "@/app/auth/actions";

const initialState: UpdatePasswordState = {};

export function UpdatePasswordForm() {
  const [state, action, pending] = useActionState(updatePassword, initialState);

  return (
    <form action={action}>
      <label>รหัสผ่านใหม่<input autoComplete="new-password" minLength={8} name="password" placeholder="อย่างน้อย 8 ตัวอักษร" required type="password" /></label>
      <label>ยืนยันรหัสผ่านใหม่<input autoComplete="new-password" minLength={8} name="confirmPassword" placeholder="พิมพ์รหัสผ่านใหม่อีกครั้ง" required type="password" /></label>
      {state.error && <p className="form-error" role="alert">{state.error}</p>}
      <button className="button button-gold auth-submit" disabled={pending} type="submit">{pending ? "กำลังบันทึก..." : "บันทึกรหัสผ่านใหม่"}</button>
    </form>
  );
}
