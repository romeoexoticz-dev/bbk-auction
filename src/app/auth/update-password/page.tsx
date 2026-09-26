import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { UpdatePasswordForm } from "@/components/update-password-form";
import { getCurrentUser } from "@/lib/auth/authorization";

export const metadata: Metadata = { title: "ตั้งรหัสผ่านใหม่" };

export default async function UpdatePasswordPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/sign-in?error=recovery-expired");

  return (
    <main className="auth-page">
      <Link className="auth-back" href="/">← กลับหน้าตลาด</Link>
      <section className="auth-intro">
        <Brand />
        <span className="kicker"><i /> ACCOUNT RECOVERY</span>
        <h1>ตั้งรหัสผ่านใหม่<br /><em>เพื่อกลับเข้าสู่บัญชี</em></h1>
        <p>ลิงก์กู้คืนได้รับการยืนยันแล้ว ตั้งรหัสผ่านใหม่ที่มีอย่างน้อย 8 ตัวอักษร</p>
      </section>
      <section className="auth-panel">
        <div><span className="dash-kicker">ขั้นตอนสุดท้าย</span><h2>รหัสผ่านใหม่</h2><p>เมื่อบันทึกสำเร็จ ระบบจะพาไปหน้าบัญชีของคุณ</p></div>
        <div className="auth-card"><UpdatePasswordForm /></div>
      </section>
    </main>
  );
}
