"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { bidIncrementFor } from "@/lib/auctions/pricing";
import referenceAuctionImport from "@/data/reference-auction-expansion";

export type CreateAuctionState = {
  error?: string;
  success?: string;
  warning?: string;
  auctionId?: string;
};

export type ReferenceCatalogDraft = {
  sourceId: string;
  auctionId: string;
  imageUrl: string;
  existed: boolean;
};

export type ReferenceCatalogBatchResult = {
  error?: string;
  drafts: ReferenceCatalogDraft[];
  nextOffset: number;
  total: number;
};

export type ReferenceTestBatchResult = {
  error?: string;
  drafts: ReferenceCatalogDraft[];
  nextOffset: number;
  total: number;
};

export type ReferenceTestPublishResult = {
  error?: string;
  published: number;
};

const categories = new Set([
  "เหรียญกษาปณ์",
  "ธนบัตร",
  "พระเครื่อง",
  "การ์ดสะสม",
  "ของเล่น",
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

function referenceCatalogMarker(sourceId: string) {
  return `[REFERENCE-CATALOG:${sourceId}]`;
}

export async function createReferenceCatalogDraftBatch(
  offset: number,
): Promise<ReferenceCatalogBatchResult> {
  const total = referenceAuctionImport.length;
  const safeOffset = Number.isInteger(offset) ? Math.max(0, Math.min(offset, total)) : 0;
  const batch = referenceAuctionImport.slice(safeOffset, safeOffset + 6);
  if (batch.length === 0) return { drafts: [], nextOffset: total, total };

  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return { error: "กรุณาเข้าสู่ระบบใหม่", drafts: [], nextOffset: safeOffset, total };
  }

  const { data: existingRows, error: existingError } = await supabase
    .from("auctions")
    .select("id,description")
    .eq("seller_id", userData.user.id)
    .in("status", ["draft", "rejected", "pending_review"])
    .limit(500);
  if (existingError) {
    console.error("Unable to inspect reference catalog drafts", { code: existingError.code });
    return { error: "ตรวจรายการเดิมไม่สำเร็จ กรุณาลองใหม่", drafts: [], nextOffset: safeOffset, total };
  }

  const drafts: ReferenceCatalogDraft[] = [];
  const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  for (const item of batch) {
    const endsAt = new Date(Date.now() + (item.durationDays + 1) * 24 * 60 * 60 * 1000).toISOString();
    const marker = referenceCatalogMarker(item.sourceId);
    const existing = existingRows?.find((row) => row.description?.includes(marker));
    if (existing) {
      drafts.push({ sourceId: item.sourceId, auctionId: existing.id, imageUrl: item.referenceImageUrl, existed: true });
      continue;
    }

    const openingPrice = Math.round(item.openingPrice * 100);
    const { data, error } = await supabase.rpc("create_auction_draft_with_details", {
      p_title: item.title,
      p_description: item.description,
      p_category: item.category,
      p_opening_price: openingPrice,
      p_min_increment: bidIncrementFor(openingPrice),
      p_starts_at: startsAt,
      p_ends_at: endsAt,
      p_item_year: item.itemYear,
      p_item_model: item.itemModel,
      p_item_size: item.itemSize,
      p_condition_summary: item.conditionSummary,
      p_expert_notes: item.expertNotes,
    });
    const row = (Array.isArray(data) ? data[0] : data) as { id?: string } | null;
    if (error || !row?.id) {
      console.error("Unable to create reference catalog draft", { sourceId: item.sourceId, code: error?.code });
      return {
        error: `สร้างฉบับร่างได้ ${drafts.length}/${batch.length} รายการในชุดนี้ กรุณากดทำต่ออีกครั้ง`,
        drafts,
        nextOffset: safeOffset,
        total,
      };
    }
    drafts.push({ sourceId: item.sourceId, auctionId: row.id, imageUrl: item.referenceImageUrl, existed: false });
  }

  revalidatePath("/seller");
  return { drafts, nextOffset: safeOffset + batch.length, total };
}

export async function prepareReferenceTestDraftBatch(
  offset: number,
): Promise<ReferenceTestBatchResult> {
  const total = referenceAuctionImport.length;
  const safeOffset = Number.isInteger(offset) ? Math.max(0, Math.min(offset, total)) : 0;
  const batch = referenceAuctionImport.slice(safeOffset, safeOffset + 6);
  if (batch.length === 0) return { drafts: [], nextOffset: total, total };

  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return { error: "กรุณาเข้าสู่ระบบใหม่", drafts: [], nextOffset: safeOffset, total };
  }
  const { data: rows, error: rowsError } = await supabase
    .from("auctions")
    .select("id,description,status")
    .eq("seller_id", userData.user.id)
    .in("status", ["draft", "rejected"])
    .limit(500);
  if (rowsError) {
    console.error("Unable to load reference test drafts", { code: rowsError.code });
    return { error: "โหลดรายการทดสอบไม่สำเร็จ", drafts: [], nextOffset: safeOffset, total };
  }

  const startsAt = new Date(Date.now() - 60 * 1000).toISOString();
  const drafts: ReferenceCatalogDraft[] = [];
  for (const item of batch) {
    const endsAt = new Date(Date.now() + item.durationDays * 24 * 60 * 60 * 1000).toISOString();
    const marker = referenceCatalogMarker(item.sourceId);
    const row = rows?.find((candidate) => candidate.description?.includes(marker));
    if (!row) {
      return {
        error: `ไม่พบฉบับร่าง ${item.sourceId} หรือรายการไม่ได้อยู่ในสถานะที่เปิดทดสอบได้`,
        drafts,
        nextOffset: safeOffset,
        total,
      };
    }
    const testTitle = `TEST — ไม่ขายจริง · ${item.title}`.slice(0, 160);
    const testDescription = `TEST — รายการจำลองเพื่อทดสอบระบบเท่านั้น ไม่มีการขายหรือรับชำระเงินจริง\n\n${item.description}`.slice(0, 5000);
    const openingPrice = Math.round(item.openingPrice * 100);
    const { error } = await supabase.rpc("update_auction_draft_with_details", {
      p_auction_id: row.id,
      p_title: testTitle,
      p_description: testDescription,
      p_category: item.category,
      p_opening_price: openingPrice,
      p_min_increment: bidIncrementFor(openingPrice),
      p_starts_at: startsAt,
      p_ends_at: endsAt,
      p_item_year: item.itemYear,
      p_item_model: item.itemModel,
      p_item_size: item.itemSize,
      p_condition_summary: "TEST — ใช้ภาพอ้างอิงเท่านั้น ไม่ใช่สภาพสินค้าจริง",
      p_expert_notes: "TEST — ยังไม่ได้ตรวจสินค้าจริง ห้ามใช้เพื่อฟันธงความแท้ สภาพ หรือราคา",
    });
    if (error) {
      console.error("Unable to prepare reference test draft", { sourceId: item.sourceId, code: error.code });
      return { error: "เตรียมรายการทดสอบไม่สำเร็จ กรุณาลองใหม่", drafts, nextOffset: safeOffset, total };
    }
    drafts.push({ sourceId: item.sourceId, auctionId: row.id, imageUrl: item.referenceImageUrl, existed: true });
  }
  return { drafts, nextOffset: safeOffset + batch.length, total };
}

export async function publishReferenceTestBatch(auctionIds: string[]): Promise<ReferenceTestPublishResult> {
  if (!Array.isArray(auctionIds) || auctionIds.length < 1 || auctionIds.length > 6 || auctionIds.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) {
    return { error: "ชุดรายการทดสอบไม่ถูกต้อง", published: 0 };
  }
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return { error: "กรุณาเข้าสู่ระบบใหม่", published: 0 };
  const { data: rows, error: rowsError } = await supabase
    .from("auctions")
    .select("id,title,description,status")
    .eq("seller_id", userData.user.id)
    .in("id", auctionIds);
  if (rowsError || rows?.length !== auctionIds.length) return { error: "ตรวจสิทธิ์รายการทดสอบไม่สำเร็จ", published: 0 };

  const trustedSourceIds = new Set(referenceAuctionImport.map((item) => item.sourceId));
  let published = 0;
  for (const row of rows) {
    const marker = row.description?.match(/\[REFERENCE-CATALOG:([^\]]+)\]/)?.[1];
    if (!row.title.startsWith("TEST — ไม่ขายจริง") || !marker || !trustedSourceIds.has(marker)) {
      return { error: "พบรายการที่ไม่ใช่ชุด TEST ที่อนุญาต จึงหยุดเปิดรายการ", published };
    }
    if (row.status === "draft" || row.status === "rejected") {
      const { error } = await supabase.rpc("submit_auction_for_review", { p_auction_id: row.id });
      if (error) return { error: "ส่งรายการ TEST เพื่อตรวจไม่สำเร็จ", published };
    }
    const { error } = await supabase.rpc("review_auction", {
      p_auction_id: row.id,
      p_decision: "approve",
      p_reason: "เปิดรายการ TEST จากภาพอ้างอิงเพื่อทดสอบหน้าตลาด ไม่มีการขายจริง",
    });
    if (error) {
      console.error("Unable to publish reference test auction", { auctionId: row.id, code: error.code });
      return { error: "เปิดรายการ TEST ไม่สำเร็จ กรุณาตรวจรูปและสถานะ", published };
    }
    published += 1;
  }
  revalidatePath("/");
  revalidatePath("/seller");
  return { published };
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
