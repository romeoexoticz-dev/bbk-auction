import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { AuthForm } from "@/components/auth-form";
import { getCurrentUser } from "@/lib/auth/authorization";
import { EmailConfirmationMessage } from "@/components/email-confirmation-message";

export const metadata: Metadata = { title: "เข้าสู่ระบบ" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const nextPath = typeof params.next === "string" && params.next.startsWith("/") ? params.next : "/";
  const checkEmail = params.status === "check-email";
  const callbackError = params.error === "callback";
  const providerError = params.error === "provider";
  const recoveryExpired = params.error === "recovery-expired";
  const googleEnabled = process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === "true";
  const user = await getCurrentUser();

  if (user) redirect(nextPath);

  return (
    <main className="auth-page">
      <Link className="auth-back" href="/">← กลับหน้าตลาด</Link>
      <section className="auth-intro">
        <Brand market />
        <span className="kicker"><i /> MEMBER ACCESS</span>
        <h1>เข้าสู่ตลาดของสะสม<br /><em>อย่างมั่นใจ</em></h1>
        <p>สมัครเป็นสมาชิกเพื่อดูรายการของ BBK วางราคา และติดตามผลการประมูล</p>
        <ul><li>ร้าน BBK เป็นผู้ลงขายเพียงรายเดียวในช่วงเริ่มต้น</li><li>สมาชิกทั่วไปใช้สำหรับเข้าประมูล</li><li>ยังไม่มีการเปิดรับชำระเงินจริง</li></ul>
      </section>
      <section className="auth-panel">
        <div><span className="dash-kicker">ยินดีต้อนรับ</span><h2>จัดการบัญชีของคุณ</h2><p>ใช้ Supabase Auth และ session แบบ cookie</p></div>
        {checkEmail && <EmailConfirmationMessage />}
        {callbackError && <div className="auth-message auth-warning">ลิงก์ยืนยันไม่สำเร็จหรือหมดอายุ กรุณาลองใหม่อีกครั้ง</div>}
        {providerError && <div className="auth-message auth-warning">ยังเข้าสู่ระบบด้วย Google ไม่สำเร็จ กรุณาลองใหม่หรือติดต่อแอดมิน</div>}
        {recoveryExpired && <div className="auth-message auth-warning">ลิงก์ตั้งรหัสผ่านหมดอายุหรือถูกเปิดคนละเบราว์เซอร์ กรุณากด “ลืมรหัสผ่าน?” เพื่อขอลิงก์ใหม่</div>}
        <AuthForm googleEnabled={googleEnabled} nextPath={nextPath} />
      </section>
    </main>
  );
}
