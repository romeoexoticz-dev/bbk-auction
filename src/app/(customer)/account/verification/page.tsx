import Link from "next/link";
import { redirect } from "next/navigation";
import { submitBidderApprovalRequest } from "@/app/(customer)/account/verification/actions";
import { Brand } from "@/components/brand";
import { getCurrentUser } from "@/lib/auth/authorization";
import { getCurrentBidderVerification } from "@/lib/identity/queries";

const statusCopy = {
  unverified: ["พร้อมส่งให้แอดมินตรวจ", "ยืนยันอีเมลแล้วกดปุ่มด้านล่างได้เลย"],
  pending_review: ["ส่งให้แอดมินแล้ว", "รอแอดมินตรวจและอนุมัติบัญชีผู้ประมูล"],
  approved: ["พร้อมเข้าประมูล", "อีเมลและบัญชีผ่านการอนุมัติแล้ว"],
  rejected: ["แอดมินส่งกลับ", "ตรวจเหตุผลด้านล่าง แล้วส่งคำขอใหม่ได้"],
  suspended: ["บัญชีถูกระงับ", "กรุณาติดต่อแอดมิน BBK ก่อนดำเนินการต่อ"],
} as const;

const errorCopy: Record<string, string> = {
  "email-not-confirmed": "กรุณาเปิดอีเมลและกดลิงก์ยืนยันก่อนส่งให้แอดมิน",
  "account-not-ready": "บัญชียังไม่พร้อม กรุณายืนยันอีเมลหรือเข้าสู่ระบบใหม่",
  suspended: "บัญชีนี้ถูกระงับ กรุณาติดต่อแอดมิน",
  "request-failed": "ส่งคำขอไม่สำเร็จ กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง",
};

export default async function BidderVerificationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/sign-in?next=/account/verification");

  const params = await searchParams;
  const verification = await getCurrentBidderVerification();
  const status = verification?.status ?? "unverified";
  const [title, detail] = statusCopy[status];
  const canSubmit = user.email_confirmed_at && (status === "unverified" || status === "rejected");
  const error = typeof params.error === "string" ? errorCopy[params.error] : null;

  return (
    <main className="verification-page">
      <header className="market-header detail-header"><Brand /><Link className="button button-outline" href="/">← กลับหน้าตลาด</Link></header>
      <section className="verification-card">
        <span className="kicker"><i /> BIDDER APPROVAL</span>
        <h1>{title}</h1>
        <p>{detail}</p>
        {params.status === "submitted" && <p className="verification-success">ส่งคำขอให้แอดมินตรวจเรียบร้อยแล้ว</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className={`verification-status ${status}`}>
          <strong>{user.email ?? "บัญชีสมาชิก"}</strong>
          <span>{user.email_confirmed_at ? "ยืนยันอีเมลแล้ว" : "ยังไม่ยืนยันอีเมล"}</span>
        </div>
        {verification?.reviewReason && <div className="verification-reason"><strong>หมายเหตุจากแอดมิน</strong><p>{verification.reviewReason}</p></div>}
        {canSubmit && (
          <form action={submitBidderApprovalRequest} className="bidder-approval-form">
            <p className="demo-bid-note">ระบบจะส่งเฉพาะรหัสบัญชีและสถานะยืนยันอีเมลให้แอดมินตรวจ ไม่มี SMS และไม่มีค่าใช้จ่าย</p>
            <button className="button button-gold" type="submit">ส่งให้แอดมินตรวจ</button>
          </form>
        )}
        {!user.email_confirmed_at && <div className="demo-bid-note"><strong>ต้องยืนยันอีเมลก่อน</strong><p>เปิดอีเมลจาก Supabase แล้วกดลิงก์ยืนยัน จากนั้นกลับมาโหลดหน้านี้ใหม่</p></div>}
        {status === "pending_review" && <div className="demo-bid-note"><strong>ขั้นต่อไป</strong><p>ให้แอดมินเปิดหน้า /admin แล้วกดอนุมัติบัญชีนี้ จากนั้นจึงวางประมูลได้</p></div>}
        {status === "approved" && <Link className="button button-gold verification-cta" href="/">กลับไปเลือกรายการประมูล</Link>}
        <small className="verification-privacy">วิธีนี้ไม่ตรวจเจ้าของเบอร์โทร จึงต้องให้แอดมินตรวจบัญชีก่อนอนุมัติทุกครั้ง</small>
      </section>
    </main>
  );
}
