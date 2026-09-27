import { randomUUID } from "node:crypto";
import Link from "next/link";
import { advanceOrderFulfillment, configureOrderShipping, enableOrderPaymentTestMode, grantAdministratorRole, returnApprovedAuctionForEdit, reviewBidderVerification, reviewOrderPayment, reviewPaymentDefaultAccount } from "@/app/admin/actions";
import { AUCTION_CATEGORIES } from "@/lib/auctions/categories";
import { formatBaht } from "@/lib/auctions/queries";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type AuditRow = {
  id: number;
  event_type: string;
  entity_id: string;
  created_at: string;
};

type CorrectionRow = {
  id: string;
  title: string;
  status: "scheduled" | "live";
  bid_count: number;
  starts_at: string;
  ends_at: string;
};

type BidderVerificationRow = {
  user_id: string;
  status: "pending_review";
  updated_at: string;
};

type PaymentReviewRow = {
  id: string;
  order_number: string;
  winning_amount: number;
  buyer_fee_amount: number;
  buyer_fee_vat_amount: number;
  shipping_amount: number;
  total_amount: number;
  payment_submitted_at: string;
  payment_evidence_id: string;
  buyer_id: string;
  auctions: { title: string } | { title: string }[] | null;
};

type PaymentEvidenceRow = {
  id: string;
  object_path: string;
  original_name: string;
  mime_type: string;
  byte_size: number;
  submitted_at: string;
  is_test: boolean;
};

type PaymentTestOrderRow = {
  order_id: string;
  active: boolean;
  enabled_at: string;
  expires_at: string;
};

type ShippingOrderRow = {
  id: string;
  order_number: string;
  status: string;
  payment_review_state: string;
  winning_amount: number;
  buyer_fee_amount: number;
  buyer_fee_vat_amount: number;
  shipping_amount: number;
  shipping_configured_at: string | null;
  total_amount: number;
  buyer_id: string;
  created_at: string;
  auctions: { title: string } | { title: string }[] | null;
};

type FulfillmentOrderRow = {
  id: string;
  order_number: string;
  status: "paid" | "preparing";
  winning_amount: number;
  buyer_fee_amount: number;
  buyer_fee_vat_amount: number;
  shipping_amount: number;
  total_amount: number;
  buyer_id: string;
  preparing_at: string | null;
  auctions: { title: string } | { title: string }[] | null;
};

type PaymentDefaultRow = {
  user_id: string;
  strike_count: number;
  last_expired_order_id: string;
  last_expired_at: string;
  review_status: "pending_review";
};

type InterestSummaryRow = {
  category: string;
  interested_count: number;
};

type RecentInterestRow = {
  user_id: string;
  display_name: string;
  categories: string[];
  updated_at: string;
};

type AdministratorRow = {
  user_id: string;
  display_name: string;
  email: string;
  assigned_at: string;
  assigned_by_name: string | null;
};

type RejectedBidAttemptRow = {
  id: number;
  bidder_id: string;
  auction_id: string | null;
  amount: number | null;
  reason_code: string | null;
  retry_after_seconds: number | null;
  created_at: string;
  auctions: { title: string } | { title: string }[] | null;
};

const auditLabels: Record<string, string> = {
  "auction.draft_created": "สร้างฉบับร่าง",
  "auction.submitted_for_review": "ตรวจความพร้อมก่อนเปิด",
  "auction.approved": "ตั้งเวลา/เปิดประมูล",
  "auction.rejected": "ส่งกลับให้แก้ไข",
  "auction.returned_for_edit": "ยกเลิกรายการและส่งกลับ",
  "auction.opened_automatically": "เปิดประมูลอัตโนมัติ",
  "auction.closed_automatically": "ปิดประมูลอัตโนมัติ",
  "auction.finalized": "จบการประมูล",
  "fees.policy_activated": "เปิดใช้นโยบายค่าธรรมเนียม",
  "bid.placed": "วางราคาสำเร็จ",
  "roles.bootstrap_assigned": "เพิ่มสิทธิ์บัญชี",
  "roles.admin_management_installed": "ติดตั้งระบบจัดการแอดมิน",
  "roles.admin_granted": "เพิ่มแอดมินใหม่",
  "identity.phone_otp_requested": "ขอรหัสยืนยันเบอร์ (ระบบเดิม)",
  "identity.phone_verified": "ยืนยันเบอร์สำเร็จ (ระบบเดิม)",
  "identity.bidder_review_requested": "ส่งบัญชีให้แอดมินตรวจ",
  "identity.bidder_approved": "อนุมัติผู้ประมูล",
  "identity.bidder_rejected": "ส่งบัญชีกลับให้แก้ไข",
  "payment.evidence_submitted": "ลูกค้าส่งหลักฐานการชำระ",
  "payment.approved": "อนุมัติหลักฐานการชำระ",
  "payment.needs_correction": "ส่งหลักฐานกลับให้แก้ไข",
  "payment.review_workflow_installed": "ติดตั้งระบบตรวจหลักฐานการชำระ",
  "payment.test_mode_installed": "ติดตั้งโหมดทดสอบการชำระ",
  "payment.test_mode_enabled": "เปิดทดสอบแนบสลิปรายออเดอร์",
  "payment.test_evidence_submitted": "ลูกค้าส่งสลิปจำลอง",
  "payment.test_approved": "อนุมัติสลิปจำลอง",
  "payment.test_needs_correction": "ส่งสลิปจำลองกลับให้แก้ไข",
  "shipping.workflow_installed": "ติดตั้งระบบค่าส่งและจัดส่ง",
  "shipping.amount_configured": "กำหนดค่าจัดส่ง",
  "shipping.preparing": "เริ่มเตรียมจัดส่ง",
  "shipping.shipped": "บันทึกการจัดส่ง",
  "payment.deadline_workflow_installed": "ติดตั้งระบบติดตามกำหนดชำระ",
  "payment.deadline_backfill_applied": "ปรับเวลา Order เดิมให้ครบ 24 ชั่วโมง",
  "notifications.mobile_center_installed": "ติดตั้งศูนย์แจ้งเตือนบนมือถือ",
  "notifications.web_push_foundation_installed": "ติดตั้งโครง Web Push",
  "notifications.auction_ending_reminders_installed": "ติดตั้งแจ้งเตือนก่อนหมดเวลาประมูล",
  "notifications.push_dispatch_configured": "ตั้งค่าตัวส่ง Push",
  "notifications.auction_interests_installed": "ติดตั้งระบบหมวดที่ลูกค้าสนใจ",
  "notifications.auction_interests_updated": "ลูกค้าอัปเดตหมวดที่สนใจ",
  "notifications.admin_interest_reporting_installed": "ติดตั้งรายงานความสนใจสำหรับแอดมิน",
  "payment.expired_warning": "ยกเลิก Order และเตือนครั้งแรก",
  "payment.expired_account_suspended": "ระงับบัญชีจากการไม่ชำระซ้ำ",
  "account.reinstated_after_nonpayment_review": "คืนสิทธิ์หลังตรวจบัญชี",
  "account.suspension_confirmed_after_nonpayment": "ยืนยันระงับบัญชี",
  "bids.rate_limit_installed": "ติดตั้งระบบกันกดประมูลรัว",
};

const bidRejectionLabels: Record<string, string> = {
  BID_RATE_LIMIT_SHORT: "กดถี่กว่า 2 วินาที",
  BID_RATE_LIMIT_MINUTE: "เกิน 10 ครั้งต่อนาที",
  BID_BELOW_MINIMUM: "ราคาต่ำกว่าขั้นต่ำ",
  AUCTION_NOT_LIVE: "รายการไม่ได้เปิดประมูล",
  AUCTION_OUTSIDE_BIDDING_WINDOW: "อยู่นอกเวลาประมูล",
  SELF_BIDDING_FORBIDDEN: "ผู้ขายประมูลสินค้าตนเอง",
  BIDDER_NOT_ELIGIBLE: "บัญชียังไม่มีสิทธิ์ประมูล",
  VERIFIED_ACTIVE_ACCOUNT_REQUIRED: "บัญชียังไม่พร้อมใช้งาน",
  BIDDER_VERIFICATION_REQUIRED: "ยังไม่ผ่านการอนุมัติ",
  INVALID_BID_REQUEST: "ข้อมูลคำขอไม่ถูกต้อง",
};

function timeLabel(value: string) {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(new Date(value));
}

export type AdminSection = "overview" | "auctions" | "members" | "interests" | "payments" | "shipping" | "fulfillment" | "defaults" | "team" | "security" | "audit";

const sectionIntro: Record<AdminSection, { kicker: string; title: string; description: string }> = {
  overview: { kicker: "ระบบส่วนกลาง", title: "ภาพรวมหลังบ้าน BBK", description: "ดูงานที่ต้องทำและเลือกเข้าหมวดที่ต้องการ" },
  auctions: { kicker: "รายการประมูล", title: "ตรวจและแก้รายการประมูล", description: "จัดการรายการที่อนุมัติแล้วและส่งกลับแก้ไขอย่างมีประวัติ" },
  members: { kicker: "สมาชิก", title: "อนุมัติผู้ประมูล", description: "ตรวจบัญชีลูกค้าก่อนให้สิทธิ์เข้าร่วมประมูล" },
  interests: { kicker: "ข้อมูลลูกค้า", title: "ความสนใจของลูกค้า", description: "ดูหมวดสินค้าที่ลูกค้าอยากประมูลเพื่อวางแผนรายการ" },
  payments: { kicker: "การชำระ", title: "ตรวจหลักฐานการชำระ", description: "ตรวจสลิปจริงหรือสลิปจำลองโดยไม่ปะปนกัน" },
  shipping: { kicker: "ยอดสุทธิ", title: "กำหนดค่าจัดส่ง", description: "กำหนดค่าส่งก่อนเปิดให้ลูกค้าแนบหลักฐาน" },
  fulfillment: { kicker: "คลังและขนส่ง", title: "เตรียมและจัดส่งสินค้า", description: "เริ่มเตรียมสินค้าและบันทึกเลขพัสดุหลังตรวจยอด" },
  defaults: { kicker: "ควบคุมความเสี่ยง", title: "ตรวจบัญชีไม่ชำระ", description: "พิจารณาบัญชีที่ไม่ชำระตามกำหนดซ้ำ" },
  team: { kicker: "สิทธิ์เข้าถึง", title: "จัดการทีมแอดมิน", description: "เพิ่มและตรวจรายชื่อผู้มีสิทธิ์เข้าหลังบ้าน" },
  security: { kicker: "ความปลอดภัย", title: "ตรวจการเสนอราคาผิดปกติ", description: "ดูการกดรัว ราคาต่ำ และคำขอที่ระบบปฏิเสธ" },
  audit: { kicker: "ตรวจสอบย้อนหลัง", title: "เหตุการณ์ระบบ", description: "ดูประวัติการเปลี่ยนสถานะและการทำงานสำคัญ" },
};

export async function AdminDashboardContent({
  searchParams,
  section = "overview",
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  section?: AdminSection;
}) {
  const params = await searchParams;
  const returned = params.status === "returned";
  const identityApproved = params.identityStatus === "approved";
  const identityRejected = params.identityStatus === "rejected";
  const identityError = typeof params.identityError === "string";
  const paymentApproved = params.paymentStatus === "approved";
  const paymentNeedsCorrection = params.paymentStatus === "needs-correction";
  const paymentTestApproved = params.paymentStatus === "test-approved";
  const paymentTestNeedsCorrection = params.paymentStatus === "test-needs-correction";
  const paymentError = typeof params.paymentError === "string";
  const paymentTestEnabled = params.paymentTestStatus === "enabled";
  const paymentTestError = typeof params.paymentTestError === "string" ? params.paymentTestError : "";
  const shippingConfigured = params.shippingStatus === "configured";
  const shippingError = typeof params.shippingError === "string";
  const fulfillmentPreparing = params.fulfillmentStatus === "preparing";
  const fulfillmentShipped = params.fulfillmentStatus === "shipped";
  const fulfillmentError = typeof params.fulfillmentError === "string";
  const defaultReinstated = params.defaultStatus === "reinstated";
  const defaultKeptSuspended = params.defaultStatus === "kept-suspended";
  const defaultError = typeof params.defaultError === "string";
  const adminRoleGranted = params.adminRoleStatus === "granted";
  const adminRoleAlreadyExists = params.adminRoleStatus === "already-admin";
  const adminRoleError = typeof params.adminRoleError === "string" ? params.adminRoleError : "";
  const appPaymentTestModeEnabled = process.env.NEXT_PUBLIC_PAYMENT_TEST_MODE_ENABLED === "true";

  const supabase = await createClient();
  const [liveResult, auditResult, rejectedBidResult, correctionResult, bidderResult, paymentResult, shippingResult, fulfillmentResult, defaultResult, interestSummaryResult, recentInterestResult, administratorResult, currentUserResult] = await Promise.all([
    supabase.from("auctions").select("id", { count: "exact", head: true }).eq("status", "live"),
    supabase
      .from("audit_events")
      .select("id,event_type,entity_id,created_at")
      .order("created_at", { ascending: false })
      .limit(8),
    supabase
      .from("bid_attempts")
      .select("id,bidder_id,auction_id,amount,reason_code,retry_after_seconds,created_at,auctions(title)")
      .eq("outcome", "rejected")
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("auctions")
      .select("id,title,status,bid_count,starts_at,ends_at")
      .in("status", ["scheduled", "live"])
      .eq("bid_count", 0)
      .order("ends_at", { ascending: true })
      .limit(20),
    supabase
      .from("bidder_verifications")
      .select("user_id,status,updated_at")
      .eq("status", "pending_review")
      .order("updated_at", { ascending: true })
      .limit(30),
    supabase
      .from("orders")
      .select("id,order_number,winning_amount,buyer_fee_amount,buyer_fee_vat_amount,shipping_amount,total_amount,payment_submitted_at,payment_evidence_id,buyer_id,auctions(title)")
      .eq("status", "pending_payment")
      .eq("payment_review_state", "submitted")
      .order("payment_submitted_at", { ascending: true })
      .limit(30),
    supabase
      .from("orders")
      .select("id,order_number,status,payment_review_state,winning_amount,buyer_fee_amount,buyer_fee_vat_amount,shipping_amount,shipping_configured_at,total_amount,buyer_id,created_at,auctions(title)")
      .eq("status", "pending_payment")
      .in("payment_review_state", ["not_submitted", "needs_correction"])
      .order("created_at", { ascending: true })
      .limit(50),
    supabase
      .from("orders")
      .select("id,order_number,status,winning_amount,buyer_fee_amount,buyer_fee_vat_amount,shipping_amount,total_amount,buyer_id,preparing_at,auctions(title)")
      .in("status", ["paid", "preparing"])
      .order("updated_at", { ascending: true })
      .limit(50),
    supabase
      .from("payment_default_cases")
      .select("user_id,strike_count,last_expired_order_id,last_expired_at,review_status")
      .eq("review_status", "pending_review")
      .order("last_expired_at", { ascending: true })
      .limit(50),
    supabase.rpc("admin_auction_interest_summary"),
    supabase.rpc("admin_recent_auction_interests", { p_limit: 30 }),
    supabase.rpc("admin_list_administrators"),
    supabase.auth.getUser(),
  ]);

  if (auditResult.error) console.error("Unable to load audit events", { code: auditResult.error.code });
  if (rejectedBidResult.error && rejectedBidResult.error.code !== "PGRST205") console.error("Unable to load rejected bid attempts", { code: rejectedBidResult.error.code });
  if (bidderResult.error) console.error("Unable to load bidder verification queue", { code: bidderResult.error.code });
  if (paymentResult.error) console.error("Unable to load payment review queue", { code: paymentResult.error.code });
  if (shippingResult.error) console.error("Unable to load shipping configuration queue", { code: shippingResult.error.code });
  if (fulfillmentResult.error) console.error("Unable to load fulfillment queue", { code: fulfillmentResult.error.code });
  if (defaultResult.error) console.error("Unable to load payment default review queue", { code: defaultResult.error.code });
  if (interestSummaryResult.error) console.error("Unable to load auction interest summary", { code: interestSummaryResult.error.code });
  if (recentInterestResult.error) console.error("Unable to load recent auction interests", { code: recentInterestResult.error.code });
  if (administratorResult.error) console.error("Unable to load administrator list", { code: administratorResult.error.code });

  const audits = (auditResult.data ?? []) as AuditRow[];
  const rejectedBidAttempts = (rejectedBidResult.data ?? []) as RejectedBidAttemptRow[];
  const corrections = (correctionResult.data ?? []) as CorrectionRow[];
  const bidderReviews = (bidderResult.data ?? []) as BidderVerificationRow[];
  const paymentReviews = (paymentResult.data ?? []) as PaymentReviewRow[];
  const shippingOrders = (shippingResult.data ?? []) as ShippingOrderRow[];
  const fulfillmentOrders = (fulfillmentResult.data ?? []) as FulfillmentOrderRow[];
  const paymentDefaults = (defaultResult.data ?? []) as PaymentDefaultRow[];
  const interestSummary = (interestSummaryResult.data ?? []) as InterestSummaryRow[];
  const recentInterests = (recentInterestResult.data ?? []) as RecentInterestRow[];
  const administrators = (administratorResult.data ?? []) as AdministratorRow[];
  const currentAdminEmail = currentUserResult.data.user?.email ?? "";
  const shippingOrderIds = shippingOrders.map((item) => item.id);
  const { data: paymentTestOrderData, error: paymentTestOrderError } = appPaymentTestModeEnabled && shippingOrderIds.length > 0
    ? await supabase
        .from("payment_test_orders")
        .select("order_id,active,enabled_at,expires_at")
        .in("order_id", shippingOrderIds)
    : { data: [] as PaymentTestOrderRow[], error: null };
  if (paymentTestOrderError) console.error("Unable to load payment test orders", { code: paymentTestOrderError.code });
  const paymentTestOrderById = new Map(
    ((paymentTestOrderData ?? []) as PaymentTestOrderRow[]).map((item) => [item.order_id, item]),
  );
  const interestCountByCategory = new Map(interestSummary.map((item) => [item.category, Number(item.interested_count)]));
  const totalInterestedCustomers = new Set(recentInterests.map((item) => item.user_id)).size;
  const bidderIds = [...new Set([
    ...bidderReviews.map((item) => item.user_id),
    ...rejectedBidAttempts.map((item) => item.bidder_id),
  ])];
  const paymentEvidenceIds = paymentReviews.map((item) => item.payment_evidence_id);
  const paymentBuyerIds = [...new Set([
    ...paymentReviews.map((item) => item.buyer_id),
    ...shippingOrders.map((item) => item.buyer_id),
    ...fulfillmentOrders.map((item) => item.buyer_id),
    ...paymentDefaults.map((item) => item.user_id),
  ])];
  const { data: bidderProfiles } = bidderIds.length > 0
    ? await supabase.from("profiles").select("id,display_name,email_verified,account_status").in("id", bidderIds)
    : { data: [] as { id: string; display_name: string | null; email_verified: boolean; account_status: string }[] };
  const bidderProfileById = new Map((bidderProfiles ?? []).map((profile) => [profile.id, profile]));
  const [{ data: paymentEvidenceData }, { data: paymentBuyerProfiles }] = await Promise.all([
    paymentEvidenceIds.length > 0
      ? supabase.from("payment_evidence_submissions").select("id,object_path,original_name,mime_type,byte_size,submitted_at,is_test").in("id", paymentEvidenceIds)
      : Promise.resolve({ data: [] as PaymentEvidenceRow[] }),
    paymentBuyerIds.length > 0
      ? supabase.from("profiles").select("id,display_name").in("id", paymentBuyerIds)
      : Promise.resolve({ data: [] as { id: string; display_name: string | null }[] }),
  ]);
  const paymentEvidence = (paymentEvidenceData ?? []) as PaymentEvidenceRow[];
  const paymentEvidenceById = new Map(paymentEvidence.map((item) => [item.id, item]));
  const paymentBuyerById = new Map((paymentBuyerProfiles ?? []).map((item) => [item.id, item.display_name]));
  const { data: paymentSignedData } = paymentEvidence.length > 0
    ? await supabase.storage.from("payment-evidence").createSignedUrls(paymentEvidence.map((item) => item.object_path), 600)
    : { data: [] as { path: string; signedUrl: string }[] };
  const paymentSignedUrlByPath = new Map((paymentSignedData ?? []).map((item) => [item.path, item.signedUrl]));
  const intro = sectionIntro[section];

  return (
    <>
      <section className="dashboard-intro admin-intro"><div><span className="dash-kicker">{intro.kicker}</span><h1>{intro.title}</h1><p>{intro.description}</p></div><div className="system-health"><i /><span><small>สถานะระบบ</small><strong>เชื่อมฐานข้อมูลแล้ว</strong></span></div></section>
      <div className="admin-alert"><span>!</span><p><strong>ระบบเงินจริงถูกปิด</strong> — สร้างและเปิดรายการทดสอบได้ แต่ยังไม่มีการเรียกเก็บเงินจริง</p></div>
      {appPaymentTestModeEnabled && <div className="payment-test-banner admin-payment-test-banner" role="note"><strong>TEST — ไม่ใช่การชำระเงินจริง</strong><p>หลังบ้านเปิดเฉพาะเครื่องมือทดสอบรายออเดอร์ การอนุมัติสลิปจำลองจะไม่เปลี่ยนสถานะเป็นชำระแล้วและไม่เข้าสู่คิวจัดส่ง</p></div>}
      {returned && <div className="seller-page-message success"><strong>ยกเลิกรายการและส่งกลับแล้ว</strong><p>รายการไม่มีผู้ประมูล เหตุผลและผู้ดำเนินการถูกบันทึกใน Audit trail</p></div>}
      {identityApproved && <div className="seller-page-message success"><strong>อนุมัติผู้ประมูลแล้ว</strong><p>บัญชีนี้สามารถวางประมูลได้แล้ว</p></div>}
      {identityRejected && <div className="seller-page-message success"><strong>ส่งบัญชีกลับแล้ว</strong><p>สมาชิกจะเห็นเหตุผลและแก้ไขข้อมูลได้</p></div>}
      {identityError && <div className="seller-page-message error"><strong>ตรวจบัญชีไม่สำเร็จ</strong><p>กรุณาตรวจเหตุผล สถานะอีเมล และลองใหม่</p></div>}
      {paymentApproved && <div className="seller-page-message success"><strong>อนุมัติหลักฐานการชำระแล้ว</strong><p>คำสั่งซื้อเปลี่ยนเป็นตรวจสอบแล้วและบันทึก Audit trail เรียบร้อย</p></div>}
      {paymentNeedsCorrection && <div className="seller-page-message success"><strong>ส่งหลักฐานกลับให้แก้ไขแล้ว</strong><p>ลูกค้าจะเห็นเหตุผลและส่งไฟล์ใหม่ได้เมื่อระบบรับชำระเปิดอยู่</p></div>}
      {paymentTestApproved && <div className="seller-page-message success"><strong>ตรวจสลิปจำลองผ่านแล้ว</strong><p>TEST — ไม่ใช่การชำระเงินจริง · ออเดอร์ยังคงรอชำระและไม่เข้าคิวจัดส่ง</p></div>}
      {paymentTestNeedsCorrection && <div className="seller-page-message success"><strong>ส่งสลิปจำลองกลับให้แก้ไขแล้ว</strong><p>TEST — ลูกค้าสามารถแนบไฟล์จำลองใหม่ได้ภายในช่วงทดสอบ</p></div>}
      {paymentError && <div className="seller-page-message error"><strong>ตรวจหลักฐานไม่สำเร็จ</strong><p>กรุณาโหลดหน้าใหม่ ตรวจสถานะ และลองอีกครั้ง</p></div>}
      {paymentTestEnabled && <div className="seller-page-message success"><strong>เปิดโหมดทดสอบให้ออเดอร์แล้ว</strong><p>TEST — ไม่ใช่การชำระเงินจริง · ลูกค้าแนบสลิปจำลองได้ภายใน 24 ชั่วโมง</p></div>}
      {paymentTestError && <div className="seller-page-message error"><strong>เปิดโหมดทดสอบไม่สำเร็จ</strong><p>{paymentTestError === "window-expired" ? "ออเดอร์เลยกำหนดชำระแล้ว" : paymentTestError === "shipping-required" ? "ต้องกำหนดค่าจัดส่งก่อน" : paymentTestError === "app-disabled" ? "สวิตช์โหมดทดสอบในแอปยังปิดอยู่" : "กรุณาตรวจสถานะออเดอร์และลองใหม่"}</p></div>}
      {shippingConfigured && <div className="seller-page-message success"><strong>กำหนดค่าจัดส่งแล้ว</strong><p>ยอดรวมคำสั่งซื้อคำนวณใหม่และแจ้งลูกค้าเรียบร้อย</p></div>}
      {shippingError && <div className="seller-page-message error"><strong>กำหนดค่าจัดส่งไม่สำเร็จ</strong><p>ค่าจัดส่งแก้ไขได้ก่อนลูกค้าส่งหลักฐานการชำระเท่านั้น</p></div>}
      {fulfillmentPreparing && <div className="seller-page-message success"><strong>เปลี่ยนสถานะเป็นกำลังเตรียมส่งแล้ว</strong><p>ลูกค้าได้รับการแจ้งเตือนภายในเว็บไซต์</p></div>}
      {fulfillmentShipped && <div className="seller-page-message success"><strong>บันทึกการจัดส่งแล้ว</strong><p>บริษัทขนส่งและเลขพัสดุแสดงในหน้าคำสั่งซื้อของลูกค้าแล้ว</p></div>}
      {fulfillmentError && <div className="seller-page-message error"><strong>เปลี่ยนสถานะจัดส่งไม่สำเร็จ</strong><p>กรุณาตรวจสถานะ เลขพัสดุ และลองอีกครั้ง</p></div>}
      {defaultReinstated && <div className="seller-page-message success"><strong>คืนสิทธิ์ประมูลแล้ว</strong><p>บัญชีกลับมาใช้งานได้และลูกค้าได้รับการแจ้งเตือนแล้ว</p></div>}
      {defaultKeptSuspended && <div className="seller-page-message success"><strong>ยืนยันระงับบัญชีแล้ว</strong><p>เหตุผลและผู้ตรวจถูกบันทึกใน Audit trail เรียบร้อย</p></div>}
      {defaultError && <div className="seller-page-message error"><strong>ตรวจบัญชีไม่สำเร็จ</strong><p>กรุณาโหลดหน้าใหม่ ตรวจสถานะ และลองอีกครั้ง</p></div>}
      {adminRoleGranted && <div className="seller-page-message success"><strong>เพิ่มแอดมินใหม่แล้ว</strong><p>สิทธิ์ถูกบันทึก พร้อม Audit trail และแจ้งเตือนทีมแอดมินแล้ว</p></div>}
      {adminRoleAlreadyExists && <div className="seller-page-message success"><strong>บัญชีนี้เป็นแอดมินอยู่แล้ว</strong><p>ระบบไม่เพิ่มสิทธิ์ซ้ำและไม่มีข้อมูลซ้ำในฐานข้อมูล</p></div>}
      {adminRoleError && <div className="seller-page-message error"><strong>เพิ่มแอดมินไม่สำเร็จ</strong><p>{adminRoleError === "invalid-password" ? "รหัสผ่านของแอดมินผู้ดำเนินการไม่ถูกต้อง" : adminRoleError === "rate-limited" ? "กรอกรหัสผ่านผิดครบ 5 ครั้ง กรุณารอ 15 นาทีแล้วลองใหม่" : adminRoleError === "target-ineligible" ? "ไม่พบบัญชีที่พร้อมใช้งาน กรุณาให้บัญชีนั้นสมัครและยืนยันอีเมลก่อน" : "กรุณาตรวจอีเมล รหัสผ่าน เหตุผล และลองใหม่"}</p></div>}
      {section === "overview" && <><section className="metric-grid admin-metrics">
        <article><span className="metric-icon">▣</span><small>รายการที่กำลัง Live</small><strong>{liveResult.count ?? 0}</strong><em>ข้อมูลจริงในฐานข้อมูล</em></article>
        <article><span className="metric-icon">⌕</span><small>ผู้ประมูลรอตรวจ</small><strong>{bidderReviews.length}</strong><em className={bidderReviews.length > 0 ? "warn" : "good"}>{bidderReviews.length > 0 ? "มีบัญชีรอดำเนินการ" : "คิวว่าง"}</em></article>
        <article><span className="metric-icon">♙</span><small>โหมดผู้ขาย</small><strong>BBK</strong><em>ผู้ขายรายเดียว · ปิดรับภายนอก</em></article>
        <article><span className="metric-icon">◎</span><small>เหตุการณ์ล่าสุด</small><strong>{audits.length}</strong><em>แสดงไม่เกิน 8 เหตุการณ์</em></article>
      </section>
      <section className="admin-quick-grid" aria-label="งานหลักของแอดมิน">
        <Link href="/seller#new"><span>＋</span><strong>เพิ่มรายการประมูล</strong><small>สร้าง ตรวจ และตั้งเวลาในหน้าเดียว</small></Link>
        <Link href="/admin/members"><span>{bidderReviews.length}</span><strong>ผู้ประมูลรอตรวจ</strong><small>อนุมัติบัญชีลูกค้า</small></Link>
        <Link href="/admin/payments"><span>{paymentReviews.length}</span><strong>หลักฐานรอตรวจ</strong><small>ตรวจยอดและสลิป</small></Link>
        <Link href="/admin/fulfillment"><span>{fulfillmentOrders.length}</span><strong>รายการรอจัดส่ง</strong><small>เตรียมของและใส่เลขพัสดุ</small></Link>
      </section>
      <section className="admin-category-grid" aria-label="หมวดงานหลังบ้าน">
        <Link href="/admin/auctions"><strong>รายการประมูล</strong><small>ตรวจและส่งกลับแก้ไข</small></Link>
        <Link href="/admin/interests"><strong>ความสนใจลูกค้า</strong><small>วางแผนสินค้าที่ลูกค้าต้องการ</small></Link>
        <Link href="/admin/shipping"><strong>ค่าจัดส่ง</strong><small>กำหนดยอดสุทธิก่อนรับหลักฐาน</small></Link>
        <Link href="/admin/defaults"><strong>บัญชีไม่ชำระ</strong><small>ตรวจและคืนสิทธิ์บัญชี</small></Link>
        <Link href="/admin/team"><strong>ทีมแอดมิน</strong><small>ดูรายชื่อและเพิ่มผู้ดูแล</small></Link>
        <Link href="/admin/security"><strong>ความปลอดภัย</strong><small>ตรวจการกดประมูลผิดปกติ</small></Link>
        <Link href="/admin/audit"><strong>เหตุการณ์ระบบ</strong><small>เปิดประวัติตรวจสอบย้อนหลัง</small></Link>
        <Link href="/admin/reports"><strong>รายงาน</strong><small>ยอดประมูล การชำระ และค้างส่ง</small></Link>
      </section></>}
      {section === "interests" && <section className="panel admin-interest-panel" id="interests">
        <div className="panel-heading"><div><h2>ลูกค้าอยากประมูลอะไร</h2><p>ข้อมูลส่วนตัวสำหรับวางแผนสินค้า แสดงเฉพาะบัญชีแอดมิน</p></div><span className="table-filter">{totalInterestedCustomers} ลูกค้า</span></div>
        <div className="admin-interest-summary">
          {AUCTION_CATEGORIES.map((category) => <article key={category.value}>
            <span>{category.icon}</span><div><small>{category.value}</small><strong>{interestCountByCategory.get(category.value) ?? 0}</strong><em>คนสนใจ</em></div>
          </article>)}
        </div>
        {recentInterests.length > 0 ? <div className="admin-interest-list">
          {recentInterests.map((item) => <article key={item.user_id}>
            <div><strong>{item.display_name}</strong><small>อัปเดต {timeLabel(item.updated_at)}</small></div>
            <div>{item.categories.map((category) => <span key={category}>{category}</span>)}</div>
          </article>)}
        </div> : <div className="admin-empty"><strong>ยังไม่มีลูกค้าเลือกหมวด</strong><p>เมื่อลูกค้ากดบันทึกสิ่งที่สนใจ ข้อมูลสรุปและการแจ้งเตือนจะปรากฏที่นี่</p></div>}
      </section>}
      {section === "team" && <section className="panel admin-management-panel" id="administrators">
        <div className="panel-heading"><div><h2>จัดการแอดมิน</h2><p>เพิ่มได้เฉพาะบัญชีที่สมัคร ยืนยันอีเมล และมีสถานะใช้งานแล้ว</p></div><span className="table-filter">{administrators.length} แอดมิน</span></div>
        <div className="admin-management-grid">
          <form action={grantAdministratorRole} className="admin-review-form admin-grant-form">
            <input defaultValue={randomUUID()} name="requestKey" type="hidden" />
            <div className="admin-actor-summary"><small>แอดมินผู้ดำเนินการ</small><strong>{currentAdminEmail}</strong></div>
            <label>รหัสผ่านของแอดมินผู้ดำเนินการ
              <input autoComplete="off" maxLength={1024} name="currentPassword" placeholder="พิมพ์รหัสผ่านเพื่อยืนยันตัวตน" required type="password" />
            </label>
            <label>อีเมลบัญชีที่จะเพิ่ม
              <input autoComplete="off" inputMode="email" maxLength={320} name="email" placeholder="name@example.com" required type="email" />
            </label>
            <label>เหตุผลในการเพิ่มสิทธิ์
              <textarea maxLength={500} minLength={5} name="reason" placeholder="เช่น เพิ่มเจ้าหน้าที่ดูแลรายการประมูลและสมาชิก" required rows={3} />
            </label>
            <label className="admin-confirmation"><input name="confirmAdminAccess" required type="checkbox" value="yes" /><span>ฉันตรวจสอบบัญชีแล้ว และยืนยันให้บัญชีนี้เข้าถึงหน้าแอดมิน</span></label>
            <div><button className="button button-gold" type="submit">ยืนยันเพิ่มแอดมิน</button></div>
          </form>
          <div className="administrator-list">
            {administrators.length > 0 ? administrators.map((item) => <article key={item.user_id}>
              <div><strong>{item.display_name}</strong><small>{item.email}</small></div>
              <span><small>เพิ่มเมื่อ</small><strong>{timeLabel(item.assigned_at)}</strong><em>{item.assigned_by_name ? `โดย ${item.assigned_by_name}` : "บัญชีเริ่มต้นของระบบ"}</em></span>
            </article>) : <div className="admin-empty compact"><p>ยังโหลดรายชื่อแอดมินไม่ได้ กรุณาตรวจว่าติดตั้ง Migration แล้ว</p></div>}
          </div>
        </div>
        <div className="admin-role-safety"><strong>ความปลอดภัย</strong><span>ไม่เก็บรหัสผ่าน · ผิด 5 ครั้งล็อก 15 นาที · ทุกการเพิ่มสิทธิ์มี Audit trail</span></div>
      </section>}
      {section === "audit" && <section className="panel audit-panel" id="audit">
        <div className="panel-heading"><div><h2>เหตุการณ์ล่าสุด</h2><p>ประวัติการทำงานจริงสำหรับตรวจสอบย้อนหลัง</p></div></div>
        {audits.length > 0 ? <ol className="timeline">{audits.map((item) => <li key={item.id}><i /><div><strong>{auditLabels[item.event_type] ?? item.event_type}</strong><p>{item.entity_id.slice(0, 12)}</p><small>{timeLabel(item.created_at)}</small></div></li>)}</ol> : <div className="admin-empty compact"><p>ยังไม่มีเหตุการณ์</p></div>}
      </section>}
      {section === "security" && <section className="panel bid-security-panel" id="bid-security">
        <div className="panel-heading"><div><h2>การเสนอราคาที่ถูกปฏิเสธ</h2><p>ตรวจการกดรัว ราคาต่ำกว่าขั้นต่ำ และบัญชีที่ยังไม่มีสิทธิ์ โดยไม่เปิดเผยข้อมูลนี้แก่ลูกค้าคนอื่น</p></div><span className="table-filter">{rejectedBidAttempts.length} เหตุการณ์</span></div>
        {rejectedBidAttempts.length > 0 ? <div className="bid-security-list">{rejectedBidAttempts.map((item) => {
          const auction = Array.isArray(item.auctions) ? item.auctions[0] : item.auctions;
          const bidder = bidderProfileById.get(item.bidder_id);
          return <article key={item.id}>
            <div><strong>{bidder?.display_name || "สมาชิก BBK"}</strong><small>{auction?.title ?? "ไม่พบรายการประมูล"}</small></div>
            <span><small>เหตุผล</small><strong>{bidRejectionLabels[item.reason_code ?? ""] ?? item.reason_code ?? "ไม่ระบุ"}</strong></span>
            <span><small>ราคาที่พยายามเสนอ</small><strong>{item.amount ? formatBaht(Number(item.amount)) : "-"}</strong></span>
            <span><small>เวลา</small><strong>{timeLabel(item.created_at)}</strong>{item.retry_after_seconds ? <em>รอ {item.retry_after_seconds} วินาที</em> : null}</span>
          </article>;
        })}</div> : <div className="admin-empty compact"><strong>ยังไม่พบการกดผิดปกติ</strong><p>เมื่อระบบปฏิเสธคำขอ เหตุผลและเวลาจะปรากฏที่นี่</p></div>}
      </section>}
      {section === "members" && <section className="panel" id="members">
        <div className="panel-heading"><div><h2>อนุมัติผู้ประมูล</h2><p>อีเมลผ่านการยืนยันแล้ว แอดมินตรวจชื่อและสถานะบัญชีก่อนอนุมัติ</p></div><span className="table-filter">{bidderReviews.length} บัญชี</span></div>
        {bidderReviews.length > 0 ? <div className="admin-review-list">{bidderReviews.map((item, index) => {
          const profile = bidderProfileById.get(item.user_id);
          return <article className="admin-review-card" key={item.user_id}>
            <div className="admin-review-heading">
              <span className="review-number">{String(index + 1).padStart(2, "0")}</span>
              <div><span>EMAIL VERIFIED</span><h3>{profile?.display_name || "สมาชิก BBK"}</h3><small>ส่งคำขอ {timeLabel(item.updated_at)}</small></div>
              <span className="status-pill review"><i />รอตรวจ</span>
            </div>
            <div className="admin-review-facts bidder-review-facts">
              <span><small>ยืนยันอีเมล</small><strong>{profile?.email_verified ? "ผ่าน" : "ยังไม่ผ่าน"}</strong></span>
              <span><small>สถานะบัญชี</small><strong>{profile?.account_status ?? "ไม่พบข้อมูล"}</strong></span>
            </div>
            <form action={reviewBidderVerification} className="admin-review-form">
              <input name="userId" type="hidden" value={item.user_id} />
              <label>เหตุผลประกอบการตัดสิน
                <textarea defaultValue="ตรวจอีเมลและสถานะบัญชีแล้ว" maxLength={500} minLength={5} name="reason" required rows={3} />
              </label>
              <div><button className="button button-outline review-reject" name="decision" type="submit" value="reject">ส่งกลับให้แก้ไข</button><button className="button button-gold" name="decision" type="submit" value="approve">อนุมัติผู้ประมูล</button></div>
            </form>
          </article>;
        })}</div> : <div className="admin-empty"><strong>ยังไม่มีบัญชีรอตรวจ</strong><p>สมาชิกที่ยืนยันอีเมลและกดส่งให้แอดมินจะปรากฏตรงนี้</p></div>}
      </section>}
      {section === "payments" && <section className="panel" id="payments">
        <div className="panel-heading"><div><h2>ตรวจหลักฐานการชำระ</h2><p>ไฟล์เป็นข้อมูลส่วนตัว เปิดดูได้เฉพาะลูกค้าเจ้าของรายการและทีมแอดมิน/การเงิน</p></div><span className="table-filter">{paymentReviews.length} รายการ</span></div>
        {paymentReviews.length > 0 ? <div className="admin-review-list">{paymentReviews.map((item, index) => {
          const evidence = paymentEvidenceById.get(item.payment_evidence_id);
          const auction = Array.isArray(item.auctions) ? item.auctions[0] : item.auctions;
          const evidenceUrl = evidence ? paymentSignedUrlByPath.get(evidence.object_path) : undefined;
          return <article className="admin-review-card" key={item.id}>
            {evidence?.is_test && <div className="payment-test-banner"><strong>TEST — ไม่ใช่การชำระเงินจริง</strong><p>ตรวจขั้นตอนและไฟล์จำลองเท่านั้น การอนุมัติจะไม่เปลี่ยนออเดอร์เป็นชำระแล้ว</p></div>}
            <div className="admin-review-heading">
              <span className="review-number">{String(index + 1).padStart(2, "0")}</span>
              <div><span>{item.order_number}</span><h3>{auction?.title ?? "รายการประมูล"}</h3><small>{paymentBuyerById.get(item.buyer_id) || "ลูกค้า BBK"} · ส่ง {timeLabel(item.payment_submitted_at)}</small></div>
              <span className="status-pill review"><i />{evidence?.is_test ? "รอตรวจสลิปทดสอบ" : "รอตรวจสลิป"}</span>
            </div>
            <div className="admin-review-facts payment-review-facts">
              <span><small>ราคาชนะ</small><strong>{formatBaht(Number(item.winning_amount))}</strong></span>
              <span><small>ค่าธรรมเนียมรวม VAT</small><strong>{formatBaht(Number(item.buyer_fee_amount) + Number(item.buyer_fee_vat_amount))}</strong></span>
              <span><small>ค่าจัดส่ง</small><strong>{formatBaht(Number(item.shipping_amount))}</strong></span>
              <span><small>ยอดที่ต้องตรวจ</small><strong>{formatBaht(Number(item.total_amount))}</strong></span>
            </div>
            <div className="admin-media-row"><div className="admin-media-meta"><strong>{evidence?.is_test ? "สลิปจำลองส่วนตัว" : "หลักฐานส่วนตัว"}</strong><small>{evidence ? `${evidence.original_name} · ${Math.ceil(Number(evidence.byte_size) / 1024)} KB · ${evidence.mime_type}` : "ไม่พบข้อมูลไฟล์"}</small></div><div><Link href={`/orders/${item.id}`}>เปิดใบออเดอร์</Link>{evidenceUrl ? <a href={evidenceUrl} rel="noreferrer" target="_blank">{evidence?.is_test ? "เปิดสลิปจำลองเพื่อตรวจ" : "เปิดหลักฐานเพื่อตรวจ"}</a> : <span>ไม่พบลิงก์ไฟล์</span>}</div></div>
            <form action={reviewOrderPayment} className="admin-review-form">
              <input name="orderId" type="hidden" value={item.id} />
              <label>เหตุผลประกอบการตรวจ
                <textarea defaultValue={evidence?.is_test ? "ตรวจไฟล์จำลองและขั้นตอนระบบแล้ว ไม่มีการรับเงินจริง" : "ตรวจยอด เลขรายการ และหลักฐานการโอนแล้ว"} maxLength={500} minLength={5} name="reason" required rows={3} />
              </label>
              <div><button className="button button-outline review-reject" name="decision" type="submit" value="needs_correction">ส่งกลับให้แก้ไข</button><button className="button button-gold" name="decision" type="submit" value="approve">{evidence?.is_test ? "อนุมัติหลักฐานทดสอบ" : "อนุมัติยอดชำระ"}</button></div>
            </form>
          </article>;
        })}</div> : <div className="admin-empty"><strong>ยังไม่มีหลักฐานรอตรวจ</strong><p>เมื่อเปิดโหมดทดสอบรายออเดอร์และลูกค้าส่งสลิปจำลอง รายการจะปรากฏในคิวนี้</p></div>}
      </section>}
      {section === "shipping" && <section className="panel" id="shipping">
        <div className="panel-heading"><div><h2>กำหนดค่าจัดส่งราย Order</h2><p>ต้องกำหนดก่อนลูกค้าส่งหลักฐาน เมื่อส่งหลักฐานแล้วระบบจะล็อกยอดทันที</p></div><span className="table-filter">{shippingOrders.length} รายการ</span></div>
        {shippingOrders.length > 0 ? <div className="admin-review-list">{shippingOrders.map((item, index) => {
          const auction = Array.isArray(item.auctions) ? item.auctions[0] : item.auctions;
          const paymentTestOrder = paymentTestOrderById.get(item.id);
          const paymentTestActive = Boolean(paymentTestOrder?.active);
          return <article className="admin-review-card" key={item.id}>
            <div className="admin-review-heading">
              <span className="review-number">{String(index + 1).padStart(2, "0")}</span>
              <div><span>{item.order_number}</span><h3>{auction?.title ?? "รายการประมูล"}</h3><small>{paymentBuyerById.get(item.buyer_id) || "ลูกค้า BBK"} · {item.shipping_configured_at ? "กำหนดค่าส่งแล้ว" : "รอกำหนดค่าส่ง"}</small></div>
              <span className={`status-pill ${item.shipping_configured_at ? "scheduled" : "review"}`}><i />{item.shipping_configured_at ? "แก้ไขได้" : "ต้องดำเนินการ"}</span>
            </div>
            <div className="admin-review-facts payment-review-facts">
              <span><small>ราคาชนะ</small><strong>{formatBaht(Number(item.winning_amount))}</strong></span>
              <span><small>ค่าธรรมเนียมรวม VAT</small><strong>{formatBaht(Number(item.buyer_fee_amount) + Number(item.buyer_fee_vat_amount))}</strong></span>
              <span><small>ค่าจัดส่ง</small><strong>{item.shipping_configured_at ? formatBaht(Number(item.shipping_amount)) : "ยังไม่กำหนด"}</strong></span>
              <span><small>ยอดรวมปัจจุบัน</small><strong>{formatBaht(Number(item.total_amount))}</strong></span>
            </div>
            <div className="admin-media-row admin-order-link-row"><strong>ตรวจข้อมูลก่อนบันทึก</strong><div><Link href={`/orders/${item.id}`}>เปิดใบออเดอร์</Link></div></div>
            <form action={configureOrderShipping} className="admin-review-form shipping-config-form">
              <input name="orderId" type="hidden" value={item.id} />
              <input name="requestKey" type="hidden" value={randomUUID()} />
              <label>ค่าจัดส่ง (บาท)
                <input defaultValue={item.shipping_configured_at ? (Number(item.shipping_amount) / 100).toFixed(2) : ""} inputMode="decimal" min="0" name="shippingAmount" placeholder="เช่น 50 หรือ 0 หากส่งฟรี" required step="0.01" type="number" />
              </label>
              <label>เหตุผล/วิธีจัดส่ง
                <textarea defaultValue="กำหนดตามขนาด น้ำหนัก และการป้องกันสินค้าของรายการนี้" maxLength={500} minLength={5} name="reason" required rows={3} />
              </label>
              <div><button className="button button-gold" type="submit">{item.shipping_configured_at ? "บันทึกค่าจัดส่งใหม่" : "ยืนยันค่าจัดส่ง"}</button></div>
            </form>
            {appPaymentTestModeEnabled && item.shipping_configured_at && (
              paymentTestActive ? <div className="payment-test-banner payment-test-control"><strong>TEST — ไม่ใช่การชำระเงินจริง</strong><p>ลูกค้าแนบสลิปจำลองได้ถึง {timeLabel(paymentTestOrder!.expires_at)} และการอนุมัติจะไม่ส่งออเดอร์เข้าคิวจัดส่ง</p></div> : <form action={enableOrderPaymentTestMode} className="admin-review-form payment-test-control">
                <input name="orderId" type="hidden" value={item.id} />
                <div className="payment-test-banner"><strong>TEST — ไม่ใช่การชำระเงินจริง</strong><p>เปิดสิทธิ์แนบสลิปจำลองเฉพาะออเดอร์นี้เป็นเวลา 24 ชั่วโมง</p></div>
                <label>เหตุผลการเปิดทดสอบ
                  <textarea defaultValue="เปิดทดสอบแนบสลิปสำหรับออเดอร์จำลอง ไม่มีการรับเงินจริง" maxLength={500} minLength={5} name="reason" required rows={3} />
                </label>
                <div><button className="button button-outline" type="submit">เปิดโหมดแนบสลิปทดสอบ</button></div>
              </form>
            )}
          </article>;
        })}</div> : <div className="admin-empty"><strong>ไม่มี Order รอกำหนดค่าส่ง</strong><p>Order ที่รอชำระและยังไม่ส่งสลิปจะปรากฏตรงนี้</p></div>}
      </section>}
      {section === "fulfillment" && <section className="panel" id="fulfillment">
        <div className="panel-heading"><div><h2>เตรียมและบันทึกการจัดส่ง</h2><p>แสดงเฉพาะ Order ที่ตรวจยอดแล้วหรือกำลังเตรียมส่ง</p></div><span className="table-filter">{fulfillmentOrders.length} รายการ</span></div>
        {fulfillmentOrders.length > 0 ? <div className="admin-review-list">{fulfillmentOrders.map((item, index) => {
          const auction = Array.isArray(item.auctions) ? item.auctions[0] : item.auctions;
          return <article className="admin-review-card" key={item.id}>
            <div className="admin-review-heading">
              <span className="review-number">{String(index + 1).padStart(2, "0")}</span>
              <div><span>{item.order_number}</span><h3>{auction?.title ?? "รายการประมูล"}</h3><small>{paymentBuyerById.get(item.buyer_id) || "ลูกค้า BBK"} · ยอด {formatBaht(Number(item.total_amount))}</small></div>
              <span className={`status-pill ${item.status}`}><i />{item.status === "paid" ? "ตรวจยอดแล้ว" : "กำลังเตรียมส่ง"}</span>
            </div>
            <div className="admin-review-facts payment-review-facts">
              <span><small>ราคาชนะ</small><strong>{formatBaht(Number(item.winning_amount))}</strong></span>
              <span><small>ค่าธรรมเนียมรวม VAT</small><strong>{formatBaht(Number(item.buyer_fee_amount) + Number(item.buyer_fee_vat_amount))}</strong></span>
              <span><small>ค่าจัดส่ง</small><strong>{formatBaht(Number(item.shipping_amount))}</strong></span>
              <span><small>ยอดรวม</small><strong>{formatBaht(Number(item.total_amount))}</strong></span>
            </div>
            <div className="admin-media-row admin-order-link-row"><strong>ข้อมูล Order และลูกค้า</strong><div><Link href={`/orders/${item.id}`}>เปิดใบออเดอร์</Link></div></div>
            {item.status === "paid" ? <form action={advanceOrderFulfillment} className="admin-review-form">
              <input name="orderId" type="hidden" value={item.id} />
              <input name="requestKey" type="hidden" value={randomUUID()} />
              <input name="action" type="hidden" value="prepare" />
              <input name="carrier" type="hidden" value="" />
              <input name="trackingNumber" type="hidden" value="" />
              <label>บันทึกการเริ่มเตรียมสินค้า
                <textarea defaultValue="ตรวจยอดแล้ว เริ่มตรวจสภาพและบรรจุสินค้าเพื่อจัดส่ง" maxLength={500} minLength={5} name="reason" required rows={3} />
              </label>
              <div><button className="button button-gold" type="submit">เริ่มเตรียมจัดส่ง</button></div>
            </form> : <form action={advanceOrderFulfillment} className="admin-review-form shipping-config-form">
              <input name="orderId" type="hidden" value={item.id} />
              <input name="requestKey" type="hidden" value={randomUUID()} />
              <input name="action" type="hidden" value="ship" />
              <label>บริษัทขนส่ง
                <input maxLength={80} minLength={2} name="carrier" placeholder="เช่น ไปรษณีย์ไทย หรือ Flash Express" required />
              </label>
              <label>เลขพัสดุ
                <input autoComplete="off" maxLength={100} minLength={3} name="trackingNumber" placeholder="กรอกตามใบรับส่งสินค้า" required />
              </label>
              <label>หมายเหตุการจัดส่ง
                <textarea defaultValue="ตรวจสินค้า บรรจุหีบห่อ และส่งมอบให้บริษัทขนส่งแล้ว" maxLength={500} minLength={5} name="reason" required rows={3} />
              </label>
              <div><button className="button button-gold" type="submit">ยืนยันว่าจัดส่งแล้ว</button></div>
            </form>}
          </article>;
        })}</div> : <div className="admin-empty"><strong>ยังไม่มี Order รอจัดส่ง</strong><p>เมื่อแอดมินอนุมัติหลักฐานการชำระ รายการจะเข้าคิวเตรียมส่งอัตโนมัติ</p></div>}
      </section>}
      {section === "defaults" && <section className="panel" id="payment-defaults">
        <div className="panel-heading"><div><h2>ตรวจบัญชีไม่ชำระซ้ำ</h2><p>บัญชีจะเข้าคิวนี้เมื่อไม่ชำระภายใน 24 ชั่วโมงเป็นครั้งที่ 2 ระบบระงับสิทธิ์ไว้จนกว่าแอดมินจะตัดสิน</p></div><span className="table-filter">{paymentDefaults.length} บัญชี</span></div>
        {paymentDefaults.length > 0 ? <div className="admin-review-list">{paymentDefaults.map((item, index) => <article className="admin-review-card" key={item.user_id}>
          <div className="admin-review-heading">
            <span className="review-number">{String(index + 1).padStart(2, "0")}</span>
            <div><span>ระงับชั่วคราว</span><h3>{paymentBuyerById.get(item.user_id) || "สมาชิก BBK"}</h3><small>ไม่ชำระ {item.strike_count} ครั้ง · ล่าสุด {timeLabel(item.last_expired_at)}</small></div>
            <span className="status-pill review"><i />รอแอดมินตรวจ</span>
          </div>
          <div className="admin-review-facts bidder-review-facts">
            <span><small>จำนวนครั้ง</small><strong>{item.strike_count}</strong></span>
            <span><small>Order ล่าสุด</small><strong>{item.last_expired_order_id.slice(0, 12)}</strong></span>
          </div>
          <form action={reviewPaymentDefaultAccount} className="admin-review-form">
            <input name="userId" type="hidden" value={item.user_id} />
            <label>เหตุผลประกอบการตัดสิน
              <textarea defaultValue="ตรวจประวัติการไม่ชำระและข้อมูลบัญชีแล้ว" maxLength={500} minLength={5} name="reason" required rows={3} />
            </label>
            <div><button className="button button-outline review-reject" name="decision" type="submit" value="keep_suspended">คงการระงับ</button><button className="button button-gold" name="decision" type="submit" value="reinstate">คืนสิทธิ์ประมูล</button></div>
          </form>
        </article>)}</div> : <div className="admin-empty"><strong>ไม่มีบัญชีรอตรวจ</strong><p>ครั้งแรกระบบจะยกเลิก Order และเตือน ครั้งที่ 2 จึงระงับและส่งเข้าคิวนี้</p></div>}
      </section>}
      {section === "auctions" && <section className="panel" id="corrections">
        <div className="panel-heading"><div><h2>แก้ไขรายการที่อนุมัติแล้ว</h2><p>ส่งกลับได้เฉพาะรายการ Scheduled/Live ที่ยังไม่มีผู้ประมูล ระบบจะตรวจซ้ำในฐานข้อมูลก่อนเปลี่ยนสถานะ</p></div><span className="table-filter">{corrections.length} รายการ</span></div>
        {corrections.length > 0 ? <div className="admin-review-list">{corrections.map((item) => <article className="admin-review-card" key={item.id}>
          <div className="admin-review-heading"><div><span>{item.status.toUpperCase()}</span><h3>{item.title}</h3><small>{item.bid_count} bids · ปิด {timeLabel(item.ends_at)}</small></div><span className={`status-pill ${item.status}`}><i />{item.status}</span></div>
          <form action={returnApprovedAuctionForEdit} className="admin-review-form">
            <input name="auctionId" type="hidden" value={item.id} />
            <label>เหตุผลที่ยกเลิกและส่งกลับ
              <textarea defaultValue="เวลาปิดประมูลผ่านแล้ว กรุณาแก้วันเริ่มและวันปิดให้เป็นเวลาใหม่" maxLength={500} minLength={5} name="reason" required rows={3} />
            </label>
            <div><button className="button button-outline review-reject" type="submit">ยกเลิกและส่งกลับให้แก้ไข</button></div>
          </form>
        </article>)}</div> : <div className="admin-empty"><strong>ไม่มีรายการที่แก้ไขได้</strong><p>รายการที่มีผู้ประมูลแล้วจะไม่แสดงและไม่สามารถส่งกลับด้วยคำสั่งนี้</p></div>}
      </section>}
      {section === "overview" && <section className="safety-bar"><div><span>✓</span><p><strong>หลักควบคุมระบบ</strong> การตัดสินใช้เวลาจากฐานข้อมูล ล็อกรายการ และบันทึกแอดมิน เหตุผล เวลา และสถานะใหม่</p></div><span className="status-pill live"><i />Audit เปิดใช้งาน</span></section>}
    </>
  );
}

export default async function AdminDashboard({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <AdminDashboardContent searchParams={searchParams} />;
}
