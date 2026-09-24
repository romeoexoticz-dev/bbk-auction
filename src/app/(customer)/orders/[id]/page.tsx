import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { PaymentEvidenceForm } from "@/components/payment-evidence-form";
import { PrintOrderButton } from "@/components/print-order-button";
import { formatBaht } from "@/lib/auctions/queries";
import { getCurrentUser } from "@/lib/auth/authorization";
import { createClient } from "@/lib/supabase/server";

const statusLabel: Record<string, string> = {
  pending_payment: "รอชำระ",
  paid: "ตรวจสอบแล้ว",
  preparing: "กำลังเตรียมส่ง",
  shipped: "จัดส่งแล้ว",
  delivered: "ส่งถึงแล้ว",
  completed: "สำเร็จ",
  cancelled: "ยกเลิก",
  disputed: "มีข้อโต้แย้ง",
  refunded: "คืนเงินแล้ว",
};

export default async function OrderPage({ params }: PageProps<"/orders/[id]">) {
  const user = await getCurrentUser();
  const { id } = await params;
  if (!user) redirect(`/auth/sign-in?next=/orders/${id}`);
  const supabase = await createClient();
  const { data: order, error } = await supabase
    .from("orders")
    .select("id,order_number,buyer_id,status,created_at,winning_amount,buyer_fee_amount,buyer_fee_vat_amount,shipping_amount,shipping_configured_at,shipping_note,total_amount,payment_due_at,payment_review_state,payment_evidence_path,payment_submitted_at,payment_review_reason,payment_expired_at,cancellation_reason,preparing_at,carrier,tracking_number,shipped_at,auctions(id,title)")
    .eq("id", id)
    .maybeSingle();

  if (error || !order) notFound();
  const relation = Array.isArray(order.auctions) ? order.auctions[0] : order.auctions;
  const { data: buyerProfile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", order.buyer_id)
    .maybeSingle();
  const dateFormatter = new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  });
  const orderCreatedAt = dateFormatter.format(new Date(order.created_at));
  const dueAt = new Intl.DateTimeFormat("th-TH", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(new Date(order.payment_due_at));
  const appPaymentsEnabled = process.env.NEXT_PUBLIC_PAYMENTS_ENABLED === "true";
  const [{ data: databasePaymentsEnabled }, { data: isAdmin }] = await Promise.all([
    supabase.rpc("payment_submission_is_enabled"),
    supabase.rpc("has_role", { p_role: "admin", p_user_id: user.id }),
  ]);
  const paymentsEnabled = appPaymentsEnabled && databasePaymentsEnabled === true;
  const shippingConfigured = Boolean(order.shipping_configured_at);
  const isOrderOwner = order.buyer_id === user.id;
  const buyerName = buyerProfile?.display_name?.trim() || "สมาชิก BBK";
  const buyerEmail = isOrderOwner ? user.email : null;
  const { data: signedEvidence } = order.payment_evidence_path
    ? await supabase.storage.from("payment-evidence").createSignedUrl(order.payment_evidence_path, 600)
    : { data: null };

  return (
    <main className="order-page">
      <header className="market-header detail-header order-page-header"><Brand /><div className="order-header-actions"><PrintOrderButton /><Link className="button button-outline" href={isAdmin ? "/admin" : "/account"}>← {isAdmin ? "กลับหลังบ้าน" : "กลับบัญชีของฉัน"}</Link></div></header>
      <section className="order-card">
        <article className="order-receipt" aria-labelledby="order-document-title">
          <header className="order-receipt-masthead">
            <div className="order-receipt-title">
              <span className="order-receipt-mark"><Brand compact /></span>
              <div><small>BBK AUCTION</small><h1 id="order-document-title">ใบสรุปรายการประมูล</h1><p>ORDER SUMMARY</p></div>
            </div>
            <span className={`status-pill ${order.status}`}><i />{statusLabel[order.status] ?? order.status}</span>
          </header>

          <section className="order-customer-panel">
            <div className="order-customer-copy">
              <span className="receipt-section-label">ข้อมูลลูกค้า</span>
              <strong>{buyerName}</strong>
              {buyerEmail && <span>{buyerEmail}</span>}
              {!buyerEmail && <span>ข้อมูลส่วนตัวแสดงเฉพาะเจ้าของ Order</span>}
            </div>
            <dl className="order-meta-list">
              <div><dt>เลขที่ Order</dt><dd>{order.order_number}</dd></div>
              <div><dt>วันที่สร้าง</dt><dd>{orderCreatedAt}</dd></div>
              <div><dt>กำหนดชำระ</dt><dd>{dueAt}</dd></div>
            </dl>
          </section>

          <section className="order-line-items" aria-label="รายการสินค้า">
            <div className="order-table-row order-table-head"><span>ลำดับ</span><span>รายการ</span><span>จำนวน</span><span>ราคา</span></div>
            <div className="order-table-row order-table-item"><span>1</span><div><strong>{relation?.title ?? "รายการประมูล"}</strong><small>สินค้าชนะประมูลจาก BBK AUCTION</small></div><span>1</span><strong>{formatBaht(Number(order.winning_amount))}</strong></div>
          </section>

          <section className="order-receipt-summary">
            <div className="order-receipt-note">
              <span className="receipt-section-label">หมายเหตุ</span>
              <p>ค่าธรรมเนียมผู้ซื้อ 10% และ VAT 7% คิดเฉพาะค่าธรรมเนียม รวมเป็น 10.7% ของราคาชนะ</p>
              {order.shipping_note && <p>การจัดส่ง: {order.shipping_note}</p>}
            </div>
            <div className="order-breakdown">
              <span><small>ราคาชนะ</small><strong>{formatBaht(Number(order.winning_amount))}</strong></span>
              <span><small>ค่าธรรมเนียมผู้ซื้อ 10%</small><strong>{formatBaht(Number(order.buyer_fee_amount))}</strong></span>
              <span><small>VAT 7% ของค่าธรรมเนียม</small><strong>{formatBaht(Number(order.buyer_fee_vat_amount))}</strong></span>
              <span><small>ค่าจัดส่ง</small><strong>{!shippingConfigured ? "ยังไม่กำหนด" : Number(order.shipping_amount) === 0 ? "ส่งฟรี" : formatBaht(Number(order.shipping_amount))}</strong></span>
              <span className="total"><small>{shippingConfigured ? "ยอดชำระรวม" : "ยอดรวมก่อนค่าจัดส่ง"}</small><strong>{formatBaht(Number(order.total_amount))}</strong></span>
            </div>
          </section>

          <footer className="order-receipt-footer">
            <div><strong>บอล แบงค์เก่า</strong><span>ช่องทางทางการ: เว็บไซต์ BBK AUCTION</span></div>
            <p>เอกสารสรุปรายการจากระบบ ไม่ใช่ใบกำกับภาษี</p>
          </footer>
        </article>
        <section className="order-next-step" aria-label="สถานะและขั้นตอนถัดไป">
          <span className="receipt-section-label">สถานะและขั้นตอนถัดไป</span>
        {!shippingConfigured && order.status === "pending_payment" && <div className="payment-pending-card"><strong>รอแอดมินกำหนดค่าจัดส่ง</strong><p>ยังไม่ควรชำระเงินจนกว่ายอดรวมสุทธิจะปรากฏ ระบบจะส่งการแจ้งเตือนเมื่อกำหนดค่าส่งแล้ว</p></div>}
        {shippingConfigured && !paymentsEnabled && order.status === "pending_payment" && <div className="payment-pending-card"><strong>ยอดรวมพร้อมแล้ว แต่ยังปิดรับเงินจริง</strong><p>ครบกำหนดตามกติกา {dueAt} ปุ่มแนบสลิปจะเปิดเมื่อบัญชีร้านและสวิตช์รับชำระได้รับการยืนยันจากคุณตาล</p></div>}
        {order.status === "cancelled" && order.cancellation_reason === "payment_window_expired" && <div className="payment-expired-card"><strong>Order ถูกยกเลิกเพราะเลยกำหนดชำระ</strong><p>ระบบบันทึกเหตุการณ์และแจ้งเตือนบัญชีแล้ว หากต้องการตรวจสอบ กรุณาติดต่อทีมแอดมินพร้อมเลข Order นี้</p></div>}
        {shippingConfigured && paymentsEnabled && order.status === "pending_payment" && order.payment_review_state === "not_submitted" && <section className="payment-section"><h2>แนบหลักฐานการชำระ</h2><p>ตรวจยอดและบัญชีปลายทางให้ถูกต้องก่อนส่ง หลักฐานจะแสดงเฉพาะคุณและทีมตรวจสอบ</p><PaymentEvidenceForm orderId={order.id} requestKey={randomUUID()} /></section>}
        {order.status === "pending_payment" && order.payment_review_state === "submitted" && <div className="payment-review-card"><strong>ส่งหลักฐานแล้ว · รอแอดมินตรวจ</strong><p>ระบบบันทึกเวลาและไฟล์แล้ว ไม่ต้องส่งซ้ำ</p>{signedEvidence?.signedUrl && <a href={signedEvidence.signedUrl} rel="noreferrer" target="_blank">เปิดหลักฐานที่ส่ง</a>}</div>}
        {order.status === "pending_payment" && order.payment_review_state === "needs_correction" && <section className="payment-section correction"><h2>กรุณาส่งหลักฐานใหม่</h2><p>{order.payment_review_reason || "แอดมินขอให้ตรวจและส่งหลักฐานใหม่"}</p>{signedEvidence?.signedUrl && <a href={signedEvidence.signedUrl} rel="noreferrer" target="_blank">ดูไฟล์เดิม</a>}{paymentsEnabled && <PaymentEvidenceForm orderId={order.id} requestKey={randomUUID()} />}</section>}
        {order.payment_review_state === "approved" && order.status === "paid" && <div className="tracking-card"><strong>แอดมินตรวจสอบยอดชำระแล้ว</strong><p>คำสั่งซื้อกำลังรอทีมงานเริ่มเตรียมจัดส่ง</p></div>}
        {order.status === "preparing" && <div className="tracking-card"><strong>กำลังเตรียมจัดส่ง</strong><p>ร้านกำลังตรวจสินค้าและบรรจุหีบห่อ เมื่อส่งแล้วเลขพัสดุจะแสดงที่หน้านี้</p></div>}
        {order.tracking_number && <div className="tracking-card"><small>เลขพัสดุ</small><strong>{order.tracking_number}</strong><span>{order.carrier ?? "บริษัทขนส่ง"}</span></div>}
        <div className="order-next-actions">{relation?.id && <Link className="button button-outline verification-cta" href={`/auctions/${relation.id}`}>ดูรายการประมูล</Link>}<PrintOrderButton /></div>
        </section>
      </section>
    </main>
  );
}
