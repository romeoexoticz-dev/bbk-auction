import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type ReputationRow = {
  user_id: string;
  display_name: string;
  account_status: "active" | "suspended" | "closed";
  email_verified: boolean;
  verification_status: string;
  won_auctions: number;
  successful_orders: number;
  payment_defaults: number;
  score_percent: number | null;
  reputation_state: "good" | "new" | "warning" | "needs_review" | "suspended";
  last_default_at: string | null;
};

const stateLabels: Record<ReputationRow["reputation_state"], string> = {
  good: "ประวัติดี",
  new: "สมาชิกใหม่",
  warning: "ใบเหลือง",
  needs_review: "รอตรวจ",
  suspended: "พักสิทธิ์",
};

function dateLabel(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(new Date(value));
}

export default async function BidderReputationPage({ searchParams }: PageProps<"/admin/reputation">) {
  const params = await searchParams;
  const search = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_bidder_reputation", { p_search: search || null, p_limit: 300 });
  if (error) console.error("Unable to load bidder reputation", { code: error.code });
  const rows = (data ?? []) as ReputationRow[];
  const yellowCount = rows.filter((row) => row.reputation_state === "warning").length;
  const reviewCount = rows.filter((row) => ["needs_review", "suspended"].includes(row.reputation_state)).length;
  const scoredRows = rows.filter((row) => row.score_percent !== null);
  const averageScore = scoredRows.length > 0
    ? Math.round(scoredRows.reduce((sum, row) => sum + Number(row.score_percent), 0) / scoredRows.length)
    : null;

  return <>
    <section className="dashboard-intro admin-intro">
      <div><span className="dash-kicker">ควบคุมความเสี่ยง</span><h1>คะแนนผู้ประมูล</h1><p>อิงเฉพาะออเดอร์เงินจริงที่ชำระสำเร็จและผิดนัด ไม่รวมสลิป TEST และไม่เพิ่มบทลงโทษใหม่</p></div>
      <Link className="button button-outline" href="/admin/defaults">ตรวจบัญชีไม่ชำระ</Link>
    </section>
    <div className="notice-card"><span>i</span><div><strong>คะแนนนี้เป็นข้อมูลประกอบการตรวจ</strong><p>สมาชิกที่ยังไม่มีออเดอร์จริงจะแสดง “ยังไม่มีข้อมูล” ใบเหลืองและการพักสิทธิ์ยังใช้กติกาเดิม: ครั้งแรกเตือน ครั้งที่สองส่งให้แอดมินตรวจ</p></div></div>
    <section className="metric-grid">
      <article><span className="metric-icon">◎</span><small>ผู้ประมูลทั้งหมด</small><strong>{rows.length}</strong><em>เฉพาะบัญชีที่มีบทบาทผู้ประมูล</em></article>
      <article><span className="metric-icon">%</span><small>คะแนนเฉลี่ย</small><strong>{averageScore === null ? "—" : `${averageScore}%`}</strong><em>คำนวณจากผู้มีผลลัพธ์จริง</em></article>
      <article><span className="metric-icon">!</span><small>ใบเหลือง</small><strong>{yellowCount}</strong><em className={yellowCount > 0 ? "warn" : "good"}>ผิดนัดครั้งแรก</em></article>
      <article><span className="metric-icon">⌕</span><small>รอตรวจ/พักสิทธิ์</small><strong>{reviewCount}</strong><em className={reviewCount > 0 ? "warn" : "good"}>ต้องตรวจโดยแอดมิน</em></article>
    </section>
    <section className="panel">
      <div className="panel-heading"><div><h2>ประวัติความน่าเชื่อถือ</h2><p>ค้นด้วยชื่อหรือรหัสบัญชี ระบบไม่เปิดเผยข้อมูลนี้ต่อสาธารณะ</p></div><form className="admin-inline-search"><input defaultValue={search} maxLength={100} name="q" placeholder="ค้นหาสมาชิก" /><button className="button button-gold" type="submit">ค้นหา</button></form></div>
      {error ? <div className="admin-empty"><strong>ยังอ่านคะแนนไม่ได้</strong><p>ต้องติดตั้ง Migration ใหม่ก่อน หน้านี้จึงจะแสดงข้อมูล</p></div> : rows.length > 0 ? <div className="table-wrap"><table>
        <thead><tr><th>สมาชิก</th><th>สถานะ</th><th>คะแนน</th><th>ชนะประมูล</th><th>ชำระสำเร็จ</th><th>ผิดนัด</th><th>ผิดนัดล่าสุด</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.user_id}>
          <td><div className="item-cell"><span>{row.display_name.slice(0, 2).toUpperCase()}</span><div><strong>{row.display_name}</strong><small>{row.user_id.slice(0, 8).toUpperCase()} · {row.email_verified ? "ยืนยันอีเมลแล้ว" : "ยังไม่ยืนยันอีเมล"}</small></div></div></td>
          <td><span className={`reputation-pill ${row.reputation_state}`}>{stateLabels[row.reputation_state]}</span></td>
          <td><strong>{row.score_percent === null ? "ยังไม่มีข้อมูล" : `${Number(row.score_percent)}%`}</strong></td>
          <td>{row.won_auctions}</td><td>{row.successful_orders}</td><td>{row.payment_defaults}</td><td>{dateLabel(row.last_default_at)}</td>
        </tr>)}</tbody>
      </table></div> : <div className="admin-empty"><strong>ไม่พบสมาชิก</strong><p>ลองเปลี่ยนคำค้นหา หรือตรวจว่าบัญชีได้รับบทบาทผู้ประมูลแล้ว</p></div>}
    </section>
  </>;
}
