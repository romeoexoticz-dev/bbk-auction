"use client";

import { useActionState } from "react";
import { createAuctionDraft, updateAuctionDraft, type CreateAuctionState } from "@/app/seller/actions";

const initialState: CreateAuctionState = {};

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
  const editMode = Boolean(editAuction);
  const [state, action, pending] = useActionState(editMode ? updateAuctionDraft : createAuctionDraft, initialState);

  return (
    <section className="panel seller-create-panel" id={editMode ? "edit" : "new"}>
      <div className="panel-heading">
        <div><h2>{editMode ? "แก้ไขรายการประมูล" : "สร้างรายการประมูลใหม่"}</h2><p>{editMode ? "แก้ข้อมูลสินค้าให้ครบ แล้วบันทึกก่อนเปิดประมูล" : "ระบบจะเก็บเป็นฉบับร่างจนกว่าแอดมินจะกดเปิด"}</p></div>
        <span className="status-pill"><i />{editMode ? "กำลังแก้ไข" : "ฉบับร่างเท่านั้น"}</span>
      </div>
      <form action={action} className="seller-form">
        {editAuction && <input name="auctionId" type="hidden" value={editAuction.id} />}
        <div className="seller-form-grid">
          <label className="wide">ชื่อรายการ
            <input defaultValue={editAuction?.title} maxLength={160} minLength={3} name="title" placeholder="เช่น เหรียญรัชกาลที่ 5 เนื้อเงิน" required />
          </label>
          <label>หมวดหมู่
            <select defaultValue={editAuction?.category ?? ""} name="category" required>
              <option disabled value="">เลือกหมวดหมู่</option>
              <option>เหรียญกษาปณ์</option><option>ธนบัตร</option><option>พระเครื่อง</option><option>การ์ดสะสม</option><option>ของเก่า</option>
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
            <div className="form-info wide"><strong>รูปหลักฐานที่ต้องมี 3 มุม</strong><br />ใช้ภาพสินค้าจริง ชัดเจน และไม่แต่งภาพจนสภาพคลาดเคลื่อน · JPG, PNG หรือ WebP รูปละไม่เกิน 10 MB</div>
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
