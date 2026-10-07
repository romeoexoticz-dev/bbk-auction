"use client";

import { useActionState, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createAuctionDraft, updateAuctionDraft, type CreateAuctionState } from "@/app/seller/actions";
import { createClient } from "@/lib/supabase/client";

const initialState: CreateAuctionState = {};
const imageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const auctionImageSize = 800;
const auctionImageQuality = 0.82;

async function loadBrowserImage(file: File) {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = objectUrl;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function prepareAuctionImage(file: File) {
  const image = await loadBrowserImage(file);
  if (!image.naturalWidth || !image.naturalHeight) {
    throw new Error("INVALID_IMAGE_DIMENSIONS");
  }

  const canvas = document.createElement("canvas");
  canvas.width = auctionImageSize;
  canvas.height = auctionImageSize;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("CANVAS_UNAVAILABLE");

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, auctionImageSize, auctionImageSize);
  const scale = Math.min(auctionImageSize / image.naturalWidth, auctionImageSize / image.naturalHeight);
  const width = Math.round(image.naturalWidth * scale);
  const height = Math.round(image.naturalHeight * scale);
  const x = Math.round((auctionImageSize - width) / 2);
  const y = Math.round((auctionImageSize - height) / 2);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, x, y, width, height);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/webp", auctionImageQuality);
  });
  if (!blob || blob.type !== "image/webp") throw new Error("WEBP_CONVERSION_FAILED");

  const baseName = file.name.replace(/\.[^.]+$/, "") || "auction-image";
  return new File([blob], `${baseName}.webp`, {
    lastModified: file.lastModified,
    type: "image/webp",
  });
}

async function checksumSha256(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

function localDateTime(daysFromNow: number, hour: number) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  date.setHours(hour, 0, 0, 0);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export type EditableAuction = {
  id: string;
  title: string;
  description: string;
  category: string;
  openingPrice: string;
  startsAt: string;
  endsAt: string;
  itemYear: string;
  itemModel: string;
  itemSize: string;
  conditionSummary: string;
  expertNotes: string;
};

export function SellerAuctionForm({ editAuction }: { editAuction?: EditableAuction }) {
  const router = useRouter();
  const editMode = Boolean(editAuction);
  const [editState, editAction, editPending] = useActionState(updateAuctionDraft, initialState);
  const [createState, setCreateState] = useState<CreateAuctionState>(initialState);
  const [createPending, startCreateTransition] = useTransition();
  const state = editMode ? editState : createState;
  const pending = editMode ? editPending : createPending;

  function handleCreateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fullData = new FormData(form);
    const requiredImages = [
      { kind: "front", value: fullData.get("frontImage") },
      { kind: "back", value: fullData.get("backImage") },
      { kind: "defect", value: fullData.get("defectImage") },
    ].map(({ kind, value }) => ({ kind, file: value instanceof File && value.size > 0 ? value : null }));
    if (requiredImages.some(({ file }) => !file)) {
      setCreateState({ error: "กรุณาใส่รูปด้านหน้า ด้านหลัง และตำหนิสำคัญให้ครบ" });
      return;
    }

    const galleryImages = fullData
      .getAll("galleryImages")
      .filter((value): value is File => value instanceof File && value.size > 0);
    if (galleryImages.length > 2) {
      setCreateState({ error: "รูปเพิ่มเติมใส่ได้ไม่เกิน 2 รูป" });
      return;
    }
    const images = [
      ...requiredImages.map(({ kind, file }) => ({ kind, file: file! })),
      ...galleryImages.map((file) => ({ kind: "gallery", file })),
    ];
    for (const { file } of images) {
      if (!imageTypes.has(file.type)) {
        setCreateState({ error: "รองรับเฉพาะรูป JPG, PNG และ WebP" });
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        setCreateState({ error: "แต่ละรูปต้องมีขนาดไม่เกิน 10 MB" });
        return;
      }
    }

    const fields = new FormData(form);
    fields.delete("frontImage");
    fields.delete("backImage");
    fields.delete("defectImage");
    fields.delete("galleryImages");
    setCreateState({});

    startCreateTransition(async () => {
      const preparedImages: typeof images = [];
      try {
        for (const image of images) {
          preparedImages.push({ ...image, file: await prepareAuctionImage(image.file) });
        }
      } catch (error) {
        console.error("Unable to prepare auction image", { message: error instanceof Error ? error.message : "UNKNOWN" });
        setCreateState({ error: "แปลงรูปเป็น WebP 800×800 ไม่สำเร็จ กรุณาเลือกรูปใหม่แล้วลองอีกครั้ง" });
        return;
      }

      const draft = await createAuctionDraft(initialState, fields);
      if (draft.error || !draft.auctionId) {
        setCreateState(draft);
        return;
      }

      const supabase = createClient();
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) {
        setCreateState({ ...draft, warning: "สร้างฉบับร่างแล้ว แต่เซสชันหมดอายุก่อนอัปโหลดรูป กรุณาเข้าสู่ระบบใหม่" });
        return;
      }

      let uploadedCount = 0;
      for (const [position, { kind, file }] of preparedImages.entries()) {
        const objectPath = `${userData.user.id}/${draft.auctionId}/${crypto.randomUUID()}.webp`;
        const { error: uploadError } = await supabase.storage
          .from("auction-media")
          .upload(objectPath, file, { contentType: file.type, upsert: false });

        if (uploadError) {
          console.error("Unable to upload auction media", { auctionId: draft.auctionId, position, kind, code: uploadError.name });
          setCreateState({ ...draft, warning: `สร้างฉบับร่างแล้ว แต่อัปโหลดรูปสำเร็จ ${uploadedCount}/${preparedImages.length} รูป` });
          router.refresh();
          return;
        }

        const { error: metadataError } = await supabase.from("auction_media").insert({
          auction_id: draft.auctionId,
          owner_id: userData.user.id,
          object_path: objectPath,
          media_kind: kind,
          position,
          mime_type: file.type,
          byte_size: file.size,
          checksum_sha256: await checksumSha256(file),
        });
        if (metadataError) {
          console.error("Unable to register auction media", { auctionId: draft.auctionId, position, kind, code: metadataError.code });
          await supabase.storage.from("auction-media").remove([objectPath]);
          setCreateState({ ...draft, warning: `สร้างฉบับร่างแล้ว แต่บันทึกรูปสำเร็จ ${uploadedCount}/${preparedImages.length} รูป` });
          router.refresh();
          return;
        }
        uploadedCount += 1;
      }

      setCreateState({
        success: "บันทึกฉบับร่างและอัปโหลดรูป WebP 800×800 ครบแล้ว ยังไม่แสดงหน้าลูกค้าจนกว่าแอดมินจะกดเปิด",
        auctionId: draft.auctionId,
      });
      form.reset();
      router.refresh();
    });
  }

  return (
    <section className="panel seller-create-panel" id={editMode ? "edit" : "new"}>
      <div className="panel-heading">
        <div><h2>{editMode ? "แก้ไขรายการประมูล" : "สร้างรายการประมูลใหม่"}</h2><p>{editMode ? "แก้ข้อมูลสินค้าให้ครบ แล้วบันทึกก่อนเปิดประมูล" : "ระบบจะเก็บเป็นฉบับร่างจนกว่าแอดมินจะกดเปิด"}</p></div>
        <span className="status-pill"><i />{editMode ? "กำลังแก้ไข" : "ฉบับร่างเท่านั้น"}</span>
      </div>
      <form action={editMode ? editAction : undefined} className="seller-form" onSubmit={editMode ? undefined : handleCreateSubmit}>
        {editAuction && <input name="auctionId" type="hidden" value={editAuction.id} />}
        <div className="seller-form-grid">
          <label className="wide">ชื่อรายการ
            <input defaultValue={editAuction?.title} maxLength={160} minLength={3} name="title" placeholder="เช่น เหรียญรัชกาลที่ 5 เนื้อเงิน" required />
          </label>
          <label>หมวดหมู่
            <select defaultValue={editAuction?.category ?? ""} name="category" required>
              <option disabled value="">เลือกหมวดหมู่</option>
              <option>เหรียญกษาปณ์</option><option>ธนบัตร</option><option>พระเครื่อง</option><option>การ์ดสะสม</option><option>ของเล่น</option><option>ของเก่า</option>
            </select>
          </label>
          <label>ปี / ยุค
            <input defaultValue={editAuction?.itemYear} maxLength={80} name="itemYear" placeholder="เช่น พ.ศ. 2440 หรือ ไม่ทราบปี" required />
          </label>
          <label>รุ่น / แบบ
            <input defaultValue={editAuction?.itemModel} maxLength={160} name="itemModel" placeholder="เช่น รัชกาลที่ 5 หนึ่งบาท" required />
          </label>
          <label>ขนาด / น้ำหนัก
            <input defaultValue={editAuction?.itemSize} maxLength={160} name="itemSize" placeholder="เช่น 30 มม. · 15 กรัม" required />
          </label>
          <label>สภาพโดยสรุป
            <input defaultValue={editAuction?.conditionSummary} maxLength={500} minLength={5} name="conditionSummary" placeholder="เช่น ผ่านใช้ มีรอยขีดตามภาพ" required />
          </label>
          <label>ราคาเริ่มต้น (บาท)
            <input defaultValue={editAuction?.openingPrice} inputMode="decimal" min="0.01" name="openingPrice" placeholder="1000" required step="0.01" type="number" />
          </label>
          <div className="form-info"><strong>เพิ่มราคาอัตโนมัติ</strong><br />ต่ำกว่า ฿1,000 เพิ่ม ฿10 · ฿1,000–4,999 เพิ่ม ฿50 · ตั้งแต่ ฿5,000 เพิ่ม ฿100</div>
          <div className="form-info"><strong>ต่อเวลาอัตโนมัติ</strong><br />มี bid ใน 2 นาทีสุดท้าย ระบบต่อเวลาอีก 2 นาที และทำซ้ำได้</div>
          <label>วันเริ่มที่เสนอ
            <input defaultValue={editAuction?.startsAt ?? localDateTime(1, 10)} name="startsAt" required type="datetime-local" />
          </label>
          <label>วันปิดที่เสนอ
            <input defaultValue={editAuction?.endsAt ?? localDateTime(2, 20)} name="endsAt" required type="datetime-local" />
          </label>
          <label className="wide">รายละเอียดและตำหนิ
            <textarea defaultValue={editAuction?.description} maxLength={5000} minLength={20} name="description" placeholder="บอกรายละเอียด จุดสังเกต ตำหนิ และที่มาที่ตรวจสอบได้" required rows={6} />
          </label>
          <label className="wide">หมายเหตุจากผู้เชี่ยวชาญของร้าน
            <textarea defaultValue={editAuction?.expertNotes} maxLength={2000} minLength={5} name="expertNotes" placeholder="บันทึกสิ่งที่ตรวจพบจากสินค้าจริง โดยไม่ฟันธงเกินหลักฐาน" required rows={4} />
          </label>
          {!editMode && <>
            <div className="form-info wide"><strong>รูปหลักฐานที่ต้องมี 3 มุม · มาตรฐาน 800×800</strong><br />ระบบจะย่อและจัดภาพไว้กึ่งกลางโดยไม่ตัดขอบ แล้วแปลงเป็น WebP ก่อนส่งตรงไป Supabase Storage · เลือกไฟล์ JPG, PNG หรือ WebP ขนาดต้นฉบับไม่เกิน 10 MB</div>
            <label>รูปด้านหน้า
              <input accept="image/jpeg,image/png,image/webp" name="frontImage" required type="file" />
            </label>
            <label>รูปด้านหลัง
              <input accept="image/jpeg,image/png,image/webp" name="backImage" required type="file" />
            </label>
            <label>รูปตำหนิสำคัญ
              <input accept="image/jpeg,image/png,image/webp" name="defectImage" required type="file" />
            </label>
            <label>รูปเพิ่มเติม (ไม่เกิน 2 รูป)
              <input accept="image/jpeg,image/png,image/webp" multiple name="galleryImages" type="file" />
            </label>
          </>}
          {editMode && <p className="form-info wide">รูปสินค้าเดิมยังอยู่ครบ การเปลี่ยนหรือลบรูปจะเพิ่มในขั้นถัดไป</p>}
        </div>
        {state.error && <p className="form-error" role="alert">{state.error}</p>}
        {state.success && <div className="seller-form-success" role="status"><strong>{state.success}</strong>{state.auctionId && <small>เลขรายการ: {state.auctionId}</small>}</div>}
        {state.warning && <p className="seller-form-warning">{state.warning}</p>}
        <div className="seller-form-actions">
          <p>{editMode ? "บันทึกก่อน แล้วจึงกดตั้งเวลา/เปิดประมูลจากตารางด้านล่าง" : "ยังไม่มีการเรียกเก็บเงิน และรายการจะไม่เผยแพร่อัตโนมัติ"}</p>
          <div className="seller-form-buttons">
            {editMode && <a className="button button-outline" href="/seller#auctions">ยกเลิก</a>}
            <button className="button button-gold" disabled={pending} type="submit">{pending ? "กำลังบันทึก..." : editMode ? "บันทึกการแก้ไข" : "บันทึกฉบับร่าง"}</button>
          </div>
        </div>
      </form>
    </section>
  );
}
