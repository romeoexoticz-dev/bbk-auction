import { assignAuctionsToRound, createAuctionRound, publishAuctionRound } from "@/app/admin/rounds/actions";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type RoundRow = {
  id: string; seller_id: string; name: string; description: string; state: "draft" | "published" | "cancelled";
  starts_at: string; first_ends_at: string; close_interval_seconds: number; created_at: string;
};
type AuctionRow = { id: string; title: string; status: string; seller_id: string; round_id: string | null; round_lot_number: number | null; starts_at: string; ends_at: string };
type SellerRow = { user_id: string; shop_name: string };

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(new Date(value));
}

const errorLabels: Record<string, string> = {
  "invalid-window": "เวลาเริ่มและเวลาปิดรายการแรกไม่ถูกต้อง หรือเวลาปิดผ่านไปแล้ว",
  "select-items": "กรุณาเลือกรายการอย่างน้อย 1 รายการ และไม่เกิน 100 รายการ",
  "item-ineligible": "มีรายการที่ถูกเปิดแล้ว มี bid หรืออยู่ในรอบอื่น กรุณาโหลดหน้าใหม่",
  "trust-fields": "มีรายการที่ข้อมูลปี รุ่น ขนาด สภาพ หรือหมายเหตุยังไม่ครบ",
  "trust-media": "มีรายการที่รูปหน้า หลัง หรือตำหนิสำคัญยังไม่ครบ",
  "window-ended": "เวลาปิดรายการแรกผ่านไปแล้ว กรุณาสร้างรอบใหม่",
  "reason-required": "กรุณากรอกเหตุผลอย่างน้อย 5 ตัวอักษร",
  "confirmation-required": "กรุณาติ๊กยืนยันก่อนเปิดทั้งรอบ",
};

export default async function AuctionRoundsPage({ searchParams }: PageProps<"/admin/rounds">) {
  const params = await searchParams;
  const supabase = await createClient();
  const [roundResult, auctionResult, sellerResult] = await Promise.all([
    supabase.from("auction_rounds").select("id,seller_id,name,description,state,starts_at,first_ends_at,close_interval_seconds,created_at").order("created_at", { ascending: false }).limit(30),
    supabase.from("auctions").select("id,title,status,seller_id,round_id,round_lot_number,starts_at,ends_at").in("status", ["draft", "rejected"]).eq("bid_count", 0).order("updated_at", { ascending: false }).limit(200),
    supabase.from("seller_profiles").select("user_id,shop_name").eq("status", "approved").order("created_at", { ascending: true }),
  ]);
  if (roundResult.error) console.error("Unable to load auction rounds", { code: roundResult.error.code });
  const rounds = (roundResult.data ?? []) as RoundRow[];
  const auctions = (auctionResult.data ?? []) as AuctionRow[];
  const sellers = (sellerResult.data ?? []) as SellerRow[];
  const unassigned = auctions.filter((item) => !item.round_id);
  const status = typeof params.status === "string" ? params.status : "";
  const errorCode = typeof params.error === "string" ? params.error : "";

  return <>
    <section className="dashboard-intro admin-intro"><div><span className="dash-kicker">จัดการสินค้า 50–60 รายการ</span><h1>จัดประมูลเป็นรอบ</h1><p>รวมฉบับร่าง ตั้งลำดับปิดห่างกัน และเปิดทั้งรอบในครั้งเดียว</p></div></section>
    <div className="notice-card"><span>i</span><div><strong>เปิดทั้งรอบแบบครบหรือไม่เปิดเลย</strong><p>หากรายการใดข้อมูลหรือรูปไม่ครบ ระบบจะยกเลิกคำสั่งทั้งหมด จึงไม่มีปัญหาเปิดค้างเพียงบางรายการ</p></div></div>
    {status === "created" && <div className="seller-page-message success"><strong>สร้างรอบแล้ว</strong><p>ขั้นต่อไปเลือกรายการฉบับร่างใส่รอบ</p></div>}
    {status === "assigned" && <div className="seller-page-message success"><strong>เพิ่มรายการเข้ารอบแล้ว</strong><p>ระบบกำหนดลำดับและเวลาปิดให้แต่ละรายการเรียบร้อย</p></div>}
    {status === "published" && <div className="seller-page-message success"><strong>เปิดประมูลทั้งรอบแล้ว</strong><p>รายการจะเปิดตามเวลาและปิดไล่ตามลำดับที่กำหนด</p></div>}
    {errorCode && <div className="seller-page-message error"><strong>ดำเนินการไม่สำเร็จ</strong><p>{errorLabels[errorCode] ?? "กรุณาตรวจข้อมูล โหลดหน้าใหม่ และลองอีกครั้ง"}</p></div>}

    <section className="panel"><div className="panel-heading"><div><h2>1. สร้างรอบใหม่</h2><p>เวลาทั้งหมดใช้เขตเวลาไทย · ช่วงห่างขั้นต่ำ 1 นาที</p></div></div>
      <form action={createAuctionRound} className="round-form">
        <label>ผู้ขาย<select name="sellerId" required><option value="">เลือกผู้ขาย</option>{sellers.map((seller) => <option key={seller.user_id} value={seller.user_id}>{seller.shop_name}</option>)}</select></label>
        <label>ชื่อรอบ<input maxLength={120} minLength={3} name="name" placeholder="เช่น รอบเหรียญและธนบัตร ตุลาคม" required /></label>
        <label>เวลาเริ่ม<input name="startsAt" type="datetime-local" required /></label>
        <label>เวลาปิดรายการแรก<input name="firstEndsAt" type="datetime-local" required /></label>
        <label>ปิดห่างกัน (นาที)<input defaultValue="2" max="1440" min="1" name="closeIntervalMinutes" type="number" required /></label>
        <label className="wide">รายละเอียด<textarea maxLength={1000} name="description" placeholder="หมายเหตุภายในของรอบนี้" rows={3} /></label>
        <div className="wide round-form-actions"><button className="button button-gold" type="submit">สร้างรอบฉบับร่าง</button></div>
      </form>
    </section>

    {roundResult.error ? <section className="panel"><div className="admin-empty"><strong>ยังใช้ระบบรอบไม่ได้</strong><p>ต้องติดตั้ง Migration ใหม่ก่อน</p></div></section> : rounds.length > 0 ? rounds.map((round) => {
      const items = auctions.filter((item) => item.round_id === round.id).sort((a, b) => Number(a.round_lot_number) - Number(b.round_lot_number));
      const lastEndsAt = items.length > 0 ? items[items.length - 1].ends_at : round.first_ends_at;
      return <section className="panel round-card" key={round.id}>
        <div className="panel-heading"><div><h2>{round.name}</h2><p>เริ่ม {dateLabel(round.starts_at)} · รายการแรกปิด {dateLabel(round.first_ends_at)} · ห่างกัน {round.close_interval_seconds / 60} นาที</p></div><span className={`status-pill ${round.state === "published" ? "live" : "draft"}`}><i />{round.state === "published" ? "เปิดแล้ว" : "ฉบับร่าง"}</span></div>
        <div className="round-summary"><span><small>จำนวนรายการ</small><strong>{items.length}</strong></span><span><small>รายการสุดท้ายปิด</small><strong>{dateLabel(lastEndsAt)}</strong></span><span><small>สถานะ</small><strong>{round.state === "published" ? "ลูกค้าเห็นตามเวลา" : "ยังไม่แสดงต่อลูกค้า"}</strong></span></div>
        {items.length > 0 && <ol className="round-lot-list">{items.map((item) => <li key={item.id}><span>LOT {item.round_lot_number}</span><strong>{item.title}</strong><small>ปิด {dateLabel(item.ends_at)}</small></li>)}</ol>}
        {round.state === "draft" && <>
          <form action={assignAuctionsToRound} className="round-assignment-form"><input name="roundId" type="hidden" value={round.id} /><h3>2. เลือกรายการเพิ่มเข้ารอบ</h3><p>เลือกได้รวมไม่เกิน 100 รายการ ลำดับจะเรียงตามรายการด้านล่าง</p>
            {unassigned.filter((item) => item.seller_id === round.seller_id).length > 0 ? <div className="round-checkbox-grid">{unassigned.filter((item) => item.seller_id === round.seller_id).map((item) => <label key={item.id}><input name="auctionIds" type="checkbox" value={item.id} /><span><strong>{item.title}</strong><small>{item.status === "rejected" ? "ส่งกลับแก้ไข" : "ฉบับร่าง"}</small></span></label>)}</div> : <div className="admin-empty compact"><strong>ไม่มีฉบับร่างที่ว่าง</strong><p>สร้างสินค้าเพิ่มในหน้าจัดการรายการก่อน</p></div>}
            <button className="button button-outline" type="submit">เพิ่มรายการที่เลือก</button>
          </form>
          {items.length > 0 && <form action={publishAuctionRound} className="admin-review-form round-publish-form"><input name="roundId" type="hidden" value={round.id} /><label>เหตุผลการเปิดรอบ<textarea defaultValue="ตรวจข้อมูลและรูปของทุกรายการแล้ว พร้อมเปิดประมูลเป็นรอบ" maxLength={500} minLength={5} name="reason" required rows={3} /></label><label className="round-confirm"><input name="confirm" type="checkbox" value="yes" required /> ยืนยันว่าได้ตรวจข้อมูล รูป และเวลาของทุกรายการแล้ว</label><div><button className="button button-gold" type="submit">3. เปิดประมูลทั้งรอบ</button></div></form>}
        </>}
      </section>;
    }) : <section className="panel"><div className="admin-empty"><strong>ยังไม่มีรอบประมูล</strong><p>สร้างรอบแรก แล้วเลือกรายการฉบับร่างเข้ารอบ</p></div></section>}
  </>;
}
