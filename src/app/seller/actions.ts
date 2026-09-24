"use server";

import { createHash, randomUUID } from "node:crypto";
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

const imageTypes = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
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

  const requiredImages = [
    { kind: "front", value: formData.get("frontImage") },
    { kind: "back", value: formData.get("backImage") },
    { kind: "defect", value: formData.get("defectImage") },
  ].map(({ kind, value }) => ({ kind, file: value instanceof File && value.size > 0 ? value : null }));
  if (requiredImages.some(({ file }) => !file)) return { error: "กรุณาใส่รูปด้านหน้า ด้านหลัง และตำหนิสำคัญให้ครบ" };

  const galleryImages = formData
    .getAll("galleryImages")
    .filter((value): value is File => value instanceof File && value.size > 0);
  if (galleryImages.length > 2) return { error: "รูปเพิ่มเติมใส่ได้ไม่เกิน 2 รูป" };
  const images = [
    ...requiredImages.map(({ kind, file }) => ({ kind, file: file! })),
    ...galleryImages.map((file) => ({ kind: "gallery", file })),
  ];

  if (images.length > 5) return { error: "อัปโหลดรูปได้ไม่เกิน 5 รูปต่อรายการ" };
  for (const { file: image } of images) {
    if (!imageTypes.has(image.type)) return { error: "รองรับเฉพาะรูป JPG, PNG และ WebP" };
    if (image.size > 10 * 1024 * 1024) return { error: "แต่ละรูปต้องมีขนาดไม่เกิน 10 MB" };
  }

  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return { error: "กรุณาเข้าสู่ระบบใหม่" };

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

  const uploadedPaths: string[] = [];
  let mediaWarning: string | undefined;

  for (const [position, { kind, file: image }] of images.entries()) {
    const extension = imageTypes.get(image.type)!;
    const objectPath = `${userData.user.id}/${row.id}/${randomUUID()}.${extension}`;
    const bytes = Buffer.from(await image.arrayBuffer());
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const { error: uploadError } = await supabase.storage
      .from("auction-media")
      .upload(objectPath, bytes, { contentType: image.type, upsert: false });

    if (uploadError) {
      console.error("Unable to upload auction media", {
        auctionId: row.id,
        position,
        kind,
        code: uploadError.name,
        message: uploadError.message,
      });
      mediaWarning = "บันทึกฉบับร่างแล้ว แต่มีรูปบางรูปอัปโหลดไม่สำเร็จ";
      break;
    }

    uploadedPaths.push(objectPath);
    const { error: metadataError } = await supabase.from("auction_media").insert({
      auction_id: row.id,
      owner_id: userData.user.id,
      object_path: objectPath,
      media_kind: kind,
      position,
      mime_type: image.type,
      byte_size: image.size,
      checksum_sha256: checksum,
    });

    if (metadataError) {
      console.error("Unable to register auction media", {
        auctionId: row.id,
        position,
        kind,
        code: metadataError.code,
        message: metadataError.message,
      });
      await supabase.storage.from("auction-media").remove([objectPath]);
      uploadedPaths.pop();
      mediaWarning = "บันทึกฉบับร่างแล้ว แต่มีรูปบางรูปบันทึกไม่สำเร็จ";
      break;
    }
  }

  if (mediaWarning && uploadedPaths.length > 0) {
    // Keep successfully registered media; the draft remains editable and unpublished.
    console.warn("Auction draft has partial media", { auctionId: row.id, uploaded: uploadedPaths.length });
  }

  revalidatePath("/seller");
  return {
    success: "บันทึกรายการเป็นฉบับร่างแล้ว ยังไม่แสดงหน้าลูกค้าจนกว่าแอดมินจะกดเปิด",
    warning: mediaWarning,
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
