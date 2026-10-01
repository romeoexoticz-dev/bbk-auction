"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createReferenceCatalogDraftBatch, type ReferenceCatalogDraft } from "@/app/seller/actions";
import { createClient } from "@/lib/supabase/client";

const imageSize = 800;

async function referenceImageFile(url: string, sourceId: string) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("REFERENCE_IMAGE_UNAVAILABLE");
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = objectUrl;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = imageSize;
    canvas.height = imageSize;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("CANVAS_UNAVAILABLE");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, imageSize, imageSize);
    const scale = Math.min(imageSize / image.naturalWidth, imageSize / image.naturalHeight);
    const width = Math.round(image.naturalWidth * scale);
    const height = Math.round(image.naturalHeight * scale);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, Math.round((imageSize - width) / 2), Math.round((imageSize - height) / 2), width, height);
    const output = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.82));
    if (!output) throw new Error("WEBP_CONVERSION_FAILED");
    return new File([output], `${sourceId}.webp`, { type: "image/webp" });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function checksumSha256(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

async function attachReferenceImage(draft: ReferenceCatalogDraft, userId: string) {
  const supabase = createClient();
  const { data: existing, error: inspectError } = await supabase
    .from("auction_media")
    .select("id")
    .eq("auction_id", draft.auctionId)
    .eq("media_kind", "evidence")
    .limit(1);
  if (inspectError) throw inspectError;
  if (existing?.length) return;

  const file = await referenceImageFile(draft.imageUrl, draft.sourceId);
  const objectPath = `${userId}/${draft.auctionId}/${crypto.randomUUID()}.webp`;
  const { error: uploadError } = await supabase.storage
    .from("auction-media")
    .upload(objectPath, file, { contentType: file.type, upsert: false });
  if (uploadError) throw uploadError;

  const { error: metadataError } = await supabase.from("auction_media").insert({
    auction_id: draft.auctionId,
    owner_id: userId,
    object_path: objectPath,
    media_kind: "evidence",
    position: 99,
    mime_type: file.type,
    byte_size: file.size,
    checksum_sha256: await checksumSha256(file),
  });
  if (metadataError) {
    await supabase.storage.from("auction-media").remove([objectPath]);
    throw metadataError;
  }
}

export function ReferenceCatalogImporter() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function runImport() {
    setRunning(true);
    setError("");
    setMessage("กำลังตรวจบัญชีผู้ขาย...");
    const supabase = createClient();
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      setError("เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่");
      setRunning(false);
      return;
    }

    let offset = 0;
    try {
      while (true) {
        const result = await createReferenceCatalogDraftBatch(offset);
        if (result.error && result.drafts.length === 0) throw new Error(result.error);
        for (const draft of result.drafts) {
          setMessage(`กำลังแนบภาพอ้างอิง ${progress + 1}/${result.total}...`);
          await attachReferenceImage(draft, userData.user.id);
          setProgress((value) => value + 1);
        }
        if (result.error) throw new Error(result.error);
        offset = result.nextOffset;
        if (offset >= result.total) break;
      }
      setMessage("สร้างฉบับร่าง 60 รายการและแนบภาพอ้างอิงครบแล้ว — ยังไม่แสดงต่อลูกค้า");
      router.refresh();
    } catch (caught) {
      console.error("Reference catalog import failed", caught);
      setError(caught instanceof Error ? caught.message : "นำเข้าไม่สำเร็จ กรุณากดทำต่ออีกครั้ง");
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="panel seller-create-panel">
      <div className="panel-heading">
        <div><h2>นำเข้าสินค้าพี่บอล 60 รายการ</h2><p>ใช้ภาพเดิมเป็นภาพอ้างอิง และเก็บทุกรายการเป็นฉบับร่างเท่านั้น</p></div>
        <span className="status-pill"><i />ภายในทีม</span>
      </div>
      <div className="notice-card">
        <span>!</span>
        <div><strong>ภาพอ้างอิงไม่ใช่ภาพยืนยันสภาพสินค้า</strong><p>ก่อนเปิดประมูล ต้องแก้ข้อมูลและเพิ่มภาพสินค้าจริงด้านหน้า ด้านหลัง และตำหนิให้ครบ ระบบจะไม่ยอมเปิดรายการที่มีเพียงภาพอ้างอิง</p></div>
      </div>
      <p>ระบบจะสร้าง 60 ฉบับร่าง ราคาเริ่มต้น 100 บาท แปลงภาพเป็น WebP 800×800 และป้องกันการสร้างซ้ำหากกดใหม่</p>
      {progress > 0 && <p className="seller-form-success" role="status"><strong>ดำเนินการแล้ว {progress} รายการ</strong></p>}
      {message && <p className="seller-form-success" role="status"><strong>{message}</strong></p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="seller-form-actions">
        <p>รายการจะไม่แสดงในตลาดจนกว่าแอดมินตรวจภาพจริงและกดเปิดประมูล</p>
        <button className="button button-gold" disabled={running} onClick={runImport} type="button">{running ? "กำลังนำเข้า..." : progress > 0 ? "ทำต่อ / ตรวจซ้ำ" : "เริ่มนำเข้า 60 รายการ"}</button>
      </div>
    </section>
  );
}
