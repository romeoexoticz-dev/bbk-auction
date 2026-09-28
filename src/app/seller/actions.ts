"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { bidIncrementFor } from "@/lib/auctions/pricing";

export type CreateAuctionState = {
  error?: string;
  success?: string;
  warning?: string;
  auctionId?: string;
};

const categories = new Set([
  "เหรียญกษาปณ์",
  "ธนบัตร",
  "พระเครื่อง",
  "การ์ดสะสม",
  "ของเก่า",
]);

function textField(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function bahtToSatang(value: string) {
  if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(value)) return null;
  const [baht, fraction = ""] = value.split(".");
  const satang = Number(baht) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(satang) && satang > 0 ? satang : null;
}

function bangkokDateTimeToIso(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}:00+07:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function publicError(message: string) {
  if (message.includes("AUTH_REQUIRED")) return "กรุณาเข้าสู่ระบบใหม่";
  if (message.includes("SELLER_ROLE_REQUIRED")) return "บัญชีนี้ยังไม่มีสิทธิ์ผู้ขาย";
  if (message.includes("SELLER_APPROVAL_REQUIRED")) return "บัญชีผู้ขายยังไม่ผ่านการอนุมัติ";
  if (message.includes("PRODUCT_TRUST_FIELDS_REQUIRED")) return "กรุณากรอกปี รุ่น ขนาด สภาพ และหมายเหตุจากผู้เชี่ยวชาญให้ครบ";
  return "บันทึกรายการไม่สำเร็จ กรุณาตรวจข้อมูลแล้วลองใหม่";
}

function productTrustFields(formData: FormData) {
  return {
    itemYear: textField(formData, "itemYear"),
    itemModel: textField(formData, "itemModel"),
    itemSize: textField(formData, "itemSize"),
    conditionSummary: textField(formData, "conditionSummary"),
    expertNotes: textField(formData, "expertNotes"),
  };
}

function validateProductTrust(fields: ReturnType<typeof productTrustFields>) {
  if (!fields.itemYear || fields.itemYear.length > 80) return "กรุณาระบุปีหรือยุคของสินค้า";
  if (!fields.itemModel || fields.itemModel.length > 160) return "กรุณาระบุรุ่นหรือแบบของสินค้า";
  if (!fields.itemSize || fields.itemSize.length > 160) return "กรุณาระบุขนาดหรือน้ำหนักของสินค้า";
  if (fields.conditionSummary.length < 5 || fields.conditionSummary.length > 500) return "สรุปสภาพสินค้าต้องยาว 5–500 ตัวอักษร";
  if (fields.expertNotes.length < 5 || fields.expertNotes.length > 2000) return "หมายเหตุจากผู้เชี่ยวชาญต้องยาว 5–2,000 ตัวอักษร";
  return null;
}

export async function createAuctionDraft(
  _state: CreateAuctionState,
  formData: FormData,
): Promise<CreateAuctionState> {
  const title = textField(formData, "title");
  const description = textField(formData, "description");
  const category = textField(formData, "category");
  const openingPrice = bahtToSatang(textField(formData, "openingPrice"));
  const startsAt = bangkokDateTimeToIso(textField(formData, "startsAt"));
  const endsAt = bangkokDateTimeToIso(textField(formData, "endsAt"));
  const trust = productTrustFields(formData);

  if (title.length < 3 || title.length > 160) {
    return { error: "ชื่อรายการต้องยาว 3–160 ตัวอักษร" };
  }
  if (description.length < 20 || description.length > 5000) {
    return { error: "รายละเอียดต้องยาว 20–5,000 ตัวอักษร" };
  }
  if (!categories.has(category)) return { error: "กรุณาเลือกหมวดหมู่" };
  if (openingPrice === null) {
    return { error: "ราคาเริ่มต้นต้องมากกว่า 0" };
  }
  if (!startsAt || !endsAt || new Date(endsAt) <= new Date(startsAt)) {
    return { error: "วันปิดประมูลต้องอยู่หลังวันเริ่มประมูล" };
  }
  const trustError = validateProductTrust(trust);
  if (trustError) return { error: trustError };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_auction_draft_with_details", {
    p_title: title,
    p_description: description,
    p_category: category,
    p_opening_price: openingPrice,
    p_min_increment: bidIncrementFor(openingPrice),
    p_starts_at: startsAt,
    p_ends_at: endsAt,
    p_item_year: trust.itemYear,
    p_item_model: trust.itemModel,
    p_item_size: trust.itemSize,
    p_condition_summary: trust.conditionSummary,
    p_expert_notes: trust.expertNotes,
  });

  if (error || !data) {
    console.error("Unable to create auction draft", { code: error?.code });
    return { error: publicError(error?.message ?? "UNKNOWN") };
  }

  const row = (Array.isArray(data) ? data[0] : data) as { id?: string };
  if (!row?.id) return { error: "สร้างฉบับร่างแล้ว แต่ไม่พบเลขรายการ กรุณาติดต่อแอดมิน" };

  revalidatePath("/seller");
  return {
    success: "สร้างฉบับร่างแล้ว กำลังอัปโหลดรูปตรงไปยังพื้นที่จัดเก็บ",
    auctionId: row.id,
  };
}

export async function updateAuctionDraft(
  _state: CreateAuctionState,
  formData: FormData,
): Promise<CreateAuctionState> {
  const auctionId = textField(formData, "auctionId");
  const title = textField(formData, "title");
  const description = textField(formData, "description");
  const category = textField(formData, "category");
  const openingPrice = bahtToSatang(textField(formData, "openingPrice"));
  const startsAt = bangkokDateTimeToIso(textField(formData, "startsAt"));
  const endsAt = bangkokDateTimeToIso(textField(formData, "endsAt"));
  const trust = productTrustFields(formData);

  if (!/^[0-9a-f-]{36}$/i.test(auctionId)) return { error: "ไม่พบรายการที่ต้องการแก้ไข" };
  if (title.length < 3 || title.length > 160) return { error: "ชื่อรายการต้องยาว 3–160 ตัวอักษร" };
  if (description.length < 20 || description.length > 5000) return { error: "รายละเอียดต้องยาว 20–5,000 ตัวอักษร" };
  if (!categories.has(category)) return { error: "กรุณาเลือกหมวดหมู่" };
  if (openingPrice === null) return { error: "ราคาเริ่มต้นต้องมากกว่า 0" };
  if (!startsAt || !endsAt || new Date(endsAt) <= new Date(startsAt)) {
    return { error: "วันปิดประมูลต้องอยู่หลังวันเริ่มประมูล" };
  }
  const trustError = validateProductTrust(trust);
  if (trustError) return { error: trustError };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("update_auction_draft_with_details", {
    p_auction_id: auctionId,
    p_title: title,
    p_description: description,
    p_category: category,
    p_opening_price: openingPrice,
    p_min_increment: bidIncrementFor(openingPrice),
    p_starts_at: startsAt,
    p_ends_at: endsAt,
    p_item_year: trust.itemYear,
    p_item_model: trust.itemModel,
    p_item_size: trust.itemSize,
    p_condition_summary: trust.conditionSummary,
    p_expert_notes: trust.expertNotes,
  });

  if (error || !data) {
    console.error("Unable to update auction draft", { code: error?.code });
    if (error?.message.includes("INVALID_AUCTION_STATE")) return { error: "สถานะรายการเปลี่ยนแล้ว จึงแก้ไขไม่ได้" };
    if (error?.message.includes("AUCTION_HAS_BIDS")) return { error: "รายการมีผู้ประมูลแล้ว จึงแก้ไขไม่ได้" };
    return { error: publicError(error?.message ?? "UNKNOWN") };
  }

  revalidatePath("/seller");
  revalidatePath("/admin");
  return { success: "บันทึกการแก้ไขแล้ว ตรวจข้อมูลอีกครั้งก่อนเปิดประมูล", auctionId };
}

export async function publishAuction(formData: FormData) {
  const auctionId = formData.get("auctionId");
  if (typeof auctionId !== "string" || !/^[0-9a-f-]{36}$/i.test(auctionId)) {
    redirect("/seller?error=invalid-auction#auctions");
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_auction_for_review", {
    p_auction_id: auctionId,
  });

  if (error) {
    console.error("Unable to prepare auction for publishing", { code: error.code });
    redirect("/seller?error=publish-failed#auctions");
  }

  const { error: publishError } = await supabase.rpc("review_auction", {
    p_auction_id: auctionId,
    p_decision: "approve",
    p_reason: "ตรวจความพร้อมและเปิดรายการโดยแอดมินร้าน BBK",
  });

  if (publishError) {
    console.error("Unable to publish auction", { code: publishError.code });
    const errorCode = publishError.message.includes("AUCTION_WINDOW_ENDED")
      ? "window-ended"
      : publishError.message.includes("PRODUCT_TRUST_FIELDS_REQUIRED")
        ? "trust-fields"
        : publishError.message.includes("PRODUCT_TRUST_MEDIA_REQUIRED")
          ? "trust-media"
          : "publish-failed";
    redirect(`/seller?error=${errorCode}#auctions`);
  }

  revalidatePath("/seller");
  revalidatePath("/admin");
  revalidatePath("/");
  redirect("/seller?status=published#auctions");
}
