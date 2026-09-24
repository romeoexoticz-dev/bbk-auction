import { ResendConfirmationForm } from "@/components/resend-confirmation-form";

export function EmailConfirmationMessage({
  defaultEmail,
  inline = false,
}: {
  defaultEmail?: string;
  inline?: boolean;
}) {
  return (
    <div
      aria-live="polite"
      className={`auth-message auth-email-confirmation${inline ? " auth-email-confirmation-inline" : ""}`}
      role="status"
    >
      <span aria-hidden="true" className="auth-email-icon">✉</span>
      <div>
        <small>ขั้นตอนสำคัญ</small>
        <strong>กรุณายืนยันอีเมลก่อนเข้าสู่ระบบ</strong>
        <p>เราส่งลิงก์ยืนยันไปที่อีเมลของคุณแล้ว เปิดกล่องอีเมลและกดลิงก์ยืนยันก่อน จากนั้นจึงกลับมาเข้าสู่ระบบได้</p>
        <em>ถ้าไม่พบอีเมล กรุณาตรวจโฟลเดอร์ Spam หรือ Junk</em>
        <ResendConfirmationForm defaultEmail={defaultEmail} />
      </div>
    </div>
  );
}
