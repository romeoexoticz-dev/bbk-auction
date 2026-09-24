"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type PaymentEvidenceState = {
  error?: string;
  success?: string;
};

const evidenceTypes = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["application/pdf", "pdf"],
]);

function publicError(message: string) {
  if (message.includes("PAYMENTS_DISABLED")) return "ระบบยังไม่เปิดรับหลักฐานการชำระ";
  if (message.includes("PAYMENT_WINDOW_EXPIRED")) return "เลยกำหนดชำระแล้ว กรุณาติดต่อแอดมิน";
  if (message.includes("PAYMENT_ALREADY_SUBMITTED")) return "ส่งหลักฐานแล้ว กรุณารอแอดมินตรวจ";
  if (message.includes("ORDER_FORBIDDEN")) return "บัญชีนี้ไม่มีสิทธิ์ส่งหลักฐานของคำสั่งซื้อนี้";
  if (message.includes("ORDER_NOT_AWAITING_PAYMENT")) return "คำสั่งซื้อนี้ไม่ได้อยู่ในสถานะรอชำระ";
  return "ส่งหลักฐานไม่สำเร็จ กรุณาตรวจไฟล์แล้วลองใหม่";
}

export async function submitPaymentEvidence(
  _state: PaymentEvidenceState,
  formData: FormData,
): Promise<PaymentEvidenceState> {
  if (process.env.NEXT_PUBLIC_PAYMENTS_ENABLED !== "true") {
    return { error: "ระบบแนบสลิปยังปิดอยู่จนกว่าจะยืนยันบัญชีร้าน" };
  }

  const orderId = formData.get("orderId");
  const requestKey = formData.get("requestKey");
  const evidence = formData.get("evidence");

  if (typeof orderId !== "string" || !/^[0-9a-f-]{36}$/i.test(orderId)) {
    return { error: "ไม่พบคำสั่งซื้อ" };
  }
  if (typeof requestKey !== "string" || !/^[0-9a-f-]{36}$/i.test(requestKey)) {
    return { error: "คำขอไม่ถูกต้อง กรุณาโหลดหน้าใหม่" };
  }
  if (!(evidence instanceof File) || evidence.size < 1) {
    return { error: "กรุณาเลือกภาพสลิปหรือไฟล์ PDF" };
  }
  const extension = evidenceTypes.get(evidence.type);
  if (!extension) return { error: "รองรับเฉพาะ JPG, PNG, WebP และ PDF" };
  if (evidence.size > 5 * 1024 * 1024) return { error: "ไฟล์ต้องมีขนาดไม่เกิน 5 MB" };

  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return { error: "กรุณาเข้าสู่ระบบใหม่" };

  const objectPath = `${userData.user.id}/${orderId}/${randomUUID()}.${extension}`;
  const bytes = Buffer.from(await evidence.arrayBuffer());
  const { error: uploadError } = await supabase.storage
    .from("payment-evidence")
    .upload(objectPath, bytes, { contentType: evidence.type, upsert: false });

  if (uploadError) {
    console.error("Unable to upload payment evidence", { code: uploadError.name });
    return { error: "อัปโหลดหลักฐานไม่สำเร็จ ระบบอาจยังไม่เปิดรับชำระ" };
  }

  const { error: submitError } = await supabase.rpc("submit_order_payment_evidence", {
    p_order_id: orderId,
    p_object_path: objectPath,
    p_original_name: evidence.name.slice(0, 255),
    p_request_key: requestKey,
  });

  if (submitError) {
    await supabase.storage.from("payment-evidence").remove([objectPath]);
    console.error("Unable to register payment evidence", { code: submitError.code });
    return { error: publicError(submitError.message) };
  }

  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/account");
  revalidatePath("/admin");
  return { success: "ส่งหลักฐานแล้ว กรุณารอแอดมินตรวจสอบ" };
}
