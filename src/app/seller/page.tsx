import Link from "next/link";
import { publishAuction } from "@/app/seller/actions";
import { SellerAuctionForm, type EditableAuction } from "@/components/seller-auction-form";
import { formatBaht } from "@/lib/auctions/queries";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type SellerAuctionRow = {
  id: string;
  title: string;
  status: "draft" | "pending_review" | "scheduled" | "live" | "ended" | "settled" | "rejected" | "cancelled" | "voided";
  current_price: number;
  bid_count: number;
  updated_at: string;
  review_notes: string | null;
  description: string;
  category: string;
  opening_price: number;
  min_increment: number;
  starts_at: string;
  ends_at: string;
  item_year?: string;
  item_model?: string;
  item_size?: string;
  condition_summary?: string;
  expert_notes?: string;
};

const sellerAuctionSelection = "id,title,status,current_price,bid_count,updated_at,review_notes,description,category,opening_price,min_increment,starts_at,ends_at,item_year,item_model,item_size,condition_summary,expert_notes";
const legacySellerAuctionSelection = "id,title,status,current_price,bid_count,updated_at,review_notes,description,category,opening_price,min_increment,starts_at,ends_at";

const statusDisplay: Record<SellerAuctionRow["status"], { label: string; className: string }> = {
  draft: { label: "ฉบับร่าง", className: "draft" },
  pending_review: { label: "พร้อมเปิด", className: "review" },
  scheduled: { label: "ตั้งเวลาแล้ว", className: "scheduled" },
  live: { label: "กำลังประมูล", className: "live" },
  ended: { label: "จบการประมูล", className: "ended" },
  settled: { label: "ปิดรายการ", className: "settled" },
  rejected: { label: "ส่งกลับแก้ไข", className: "rejected" },
  cancelled: { label: "ยกเลิก", className: "cancelled" },
  voided: { label: "ระงับ", className: "voided" },
};

function shortId(id: string) {
  return id.slice(0, 8).toUpperCase();
}

function updatedLabel(value: string) {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(new Date(value));
}

function dateTimeInput(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

export default async function SellerDashboard({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const published = params.status === "published";
  const publishError = typeof params.error === "string";
  const windowEnded = params.error === "window-ended";
  const editId = typeof params.edit === "string" ? params.edit : undefined;
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;

  const [{ data: auctionData, error: auctionError }, { data: sellerProfile }] = userId
    ? await Promise.all([
        (async () => {
          const current = await supabase
            .from("auctions")
            .select(sellerAuctionSelection)
            .eq("seller_id", userId)
            .order("updated_at", { ascending: false })
            .limit(50);
          if (!current.error) return current;
          return supabase
            .from("auctions")
            .select(legacySellerAuctionSelection)
            .eq("seller_id", userId)
            .order("updated_at", { ascending: false })
            .limit(50);
        })(),
        supabase
          .from("seller_profiles")
          .select("shop_name,status")
          .eq("user_id", userId)
          .maybeSingle(),
      ])
    : [{ data: [], error: null }, { data: null }];

  if (auctionError) console.error("Unable to load seller auctions", { code: auctionError.code });
  const rows = (auctionData ?? []) as SellerAuctionRow[];
  const liveCount = rows.filter((row) => row.status === "live").length;
  const scheduledCount = rows.filter((row) => row.status === "scheduled").length;
  const draftCount = rows.filter((row) => row.status === "draft" || row.status === "rejected").length;
  const currentValue = rows
    .filter((row) => row.status === "live")
    .reduce((sum, row) => sum + Number(row.current_price), 0);
  const selectedEdit = rows.find((row) => row.id === editId && (row.status === "draft" || row.status === "rejected") && row.bid_count === 0);
  const editAuction: EditableAuction | undefined = selectedEdit ? {
    id: selectedEdit.id,
    title: selectedEdit.title,
    description: selectedEdit.description,
    category: selectedEdit.category,
    openingPrice: (Number(selectedEdit.opening_price) / 100).toFixed(2),
    startsAt: dateTimeInput(selectedEdit.starts_at),
    endsAt: dateTimeInput(selectedEdit.ends_at),
    itemYear: selectedEdit.item_year ?? "",
    itemModel: selectedEdit.item_model ?? "",
    itemSize: selectedEdit.item_size ?? "",
    conditionSummary: selectedEdit.condition_summary ?? "",
    expertNotes: selectedEdit.expert_notes ?? "",
  } : undefined;

  return (
    <>
      <section className="dashboard-intro">
        <div><span className="dash-kicker">หลังบ้านร้าน BBK</span><h1>จัดการสินค้าในหน้าเดียว</h1><p>สร้างฉบับร่าง ตรวจข้อมูล แล้วตั้งเวลาเปิดประมูลได้ทันทีโดยไม่ต้องส่งอนุมัติซ้ำ</p></div>
        <Link className="button button-gold" href="/seller#new">＋ สร้างรายการ</Link>
      </section>
      <div className="notice-card"><span>i</span><div><strong>ฉบับร่างยังไม่แสดงต่อลูกค้า</strong><p>รายการจะขึ้นหน้าตลาดเมื่อกด “ตั้งเวลา/เปิดประมูล” เท่านั้น ระบบเงินจริงยังปิดอยู่</p></div></div>
      {published && <div className="seller-page-message success"><strong>ตั้งเวลาเปิดประมูลแล้ว</strong><p>ถ้าถึงเวลาเริ่ม ระบบจะเปิดทันที หากยังไม่ถึงเวลาจะเปิดให้อัตโนมัติ</p></div>}
      {publishError && <div className="seller-page-message error"><strong>ยังเปิดรายการไม่ได้</strong><p>{windowEnded ? "เวลาปิดผ่านไปแล้ว กรุณาแก้วันเริ่มและวันปิดก่อน" : params.error === "trust-fields" ? "กรุณาแก้รายการและกรอกปี รุ่น ขนาด สภาพ และหมายเหตุจากผู้เชี่ยวชาญให้ครบ" : params.error === "trust-media" ? "รายการต้องมีรูปด้านหน้า ด้านหลัง และตำหนิสำคัญก่อนเปิดประมูล" : "กรุณาตรวจข้อมูล วันที่ และสิทธิ์บัญชี แล้วลองใหม่"}</p></div>}
      <section className="metric-grid">
        <article><span className="metric-icon">◷</span><small>กำลังประมูล</small><strong>{liveCount}</strong><em>ข้อมูลจริงของบัญชีนี้</em></article>
        <article><span className="metric-icon">⌁</span><small>ตั้งเวลาแล้ว</small><strong>{scheduledCount}</strong><em>{scheduledCount > 0 ? "ระบบจะเปิดให้อัตโนมัติ" : "ยังไม่มีรายการรอเปิด"}</em></article>
        <article><span className="metric-icon">✎</span><small>ฉบับร่าง/ต้องแก้</small><strong>{draftCount}</strong><em>ยังไม่แสดงหน้าลูกค้า</em></article>
        <article><span className="metric-icon">◎</span><small>ยอดประมูลที่กำลัง Live</small><strong>{formatBaht(currentValue)}</strong><em>ยังไม่เปิดธุรกรรมเงินจริง</em></article>
      </section>

      <SellerAuctionForm editAuction={editAuction} />

      <section className="panel" id="auctions">
        <div className="panel-heading"><div><h2>รายการของฉัน</h2><p>ข้อมูลจากฐานข้อมูลกลาง เรียงจากการแก้ไขล่าสุด</p></div><span className="table-filter">ทั้งหมด {rows.length} รายการ</span></div>
        {rows.length > 0 ? <div className="table-wrap">
          <table>
            <thead><tr><th>รายการ</th><th>สถานะ</th><th>ราคาปัจจุบัน</th><th>จำนวน Bid</th><th>อัปเดต</th><th>การทำงาน</th></tr></thead>
            <tbody>{rows.map((row) => {
              const display = statusDisplay[row.status];
              return <tr key={row.id}>
                <td><div className="item-cell"><span>{shortId(row.id).slice(0, 2)}</span><div><small>{shortId(row.id)}</small><strong>{row.title}</strong>{row.status === "rejected" && row.review_notes && <small className="review-note">เหตุผล: {row.review_notes}</small>}</div></div></td>
                <td><span className={`status-pill ${display.className}`}><i />{display.label}</span></td>
                <td><strong>{formatBaht(Number(row.current_price))}</strong></td>
                <td>{row.bid_count}</td>
                <td>{updatedLabel(row.updated_at)}</td>
                <td>{["draft", "rejected", "pending_review"].includes(row.status) && row.bid_count === 0 ? <div className="table-actions">
                  {(row.status === "draft" || row.status === "rejected") && <Link className="table-action table-action-edit" href={`/seller?edit=${row.id}#edit`}>แก้ไข</Link>}
                  <form action={publishAuction}>
                    <input name="auctionId" type="hidden" value={row.id} />
                    <button className="table-action" type="submit">ตั้งเวลา/เปิดประมูล</button>
                  </form>
                </div> : <span className="table-action-muted">รอดำเนินการ</span>}</td>
              </tr>;
            })}</tbody>
          </table>
        </div> : <div className="seller-empty"><strong>ยังไม่มีรายการของคุณตาล</strong><p>กรอกแบบฟอร์มด้านบนเพื่อสร้างฉบับร่างรายการแรก</p></div>}
      </section>
      <section className="seller-checklist">
        <div><span className="progress-ring">BBK</span><div><h3>{sellerProfile?.shop_name ?? "บอล แบงค์เก่า"}</h3><p>ผู้ขายรายเดียวของระบบ · จัดการโดยทีมแอดมิน BBK</p></div></div>
        <span className="status-pill live"><i />หลังบ้านพร้อมใช้งาน</span>
      </section>
    </>
  );
}
