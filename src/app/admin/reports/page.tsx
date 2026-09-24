import Link from "next/link";
import { formatBaht } from "@/lib/auctions/queries";
import { loadOrderReport, OrderReportError, resolveOrderReportRange } from "@/lib/reports/order-report";

export const dynamic = "force-dynamic";

const orderStatusLabels: Record<string, string> = {
  pending_payment: "รอชำระ",
  paid: "ตรวจสอบแล้ว",
  preparing: "กำลังเตรียมส่ง",
  shipped: "จัดส่งแล้ว",
  delivered: "ส่งถึงแล้ว",
  completed: "สำเร็จ",
  cancelled: "ยกเลิก",
  disputed: "มีข้อโต้แย้ง",
  refunded: "คืนเงินแล้ว",
};

function timeLabel(value: string) {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(new Date(value));
}

export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const fromValue = typeof params.from === "string" ? params.from : null;
  const toValue = typeof params.to === "string" ? params.to : null;
  let range;
  let invalidRange = false;
  try {
    range = resolveOrderReportRange(fromValue, toValue);
  } catch (error) {
    if (!(error instanceof OrderReportError) || error.code !== "invalid_range") throw error;
    invalidRange = true;
    range = resolveOrderReportRange();
  }
  const report = await loadOrderReport(range);
  const exportQuery = new URLSearchParams({ from: range.from, to: range.to });
  const displayedRows = report.rows.slice(0, 100);
  const pendingShipments = report.rows.filter((row) => row.status === "paid" || row.status === "preparing").slice(0, 30);

  return (
    <>
      <section className="dashboard-intro admin-intro report-intro">
        <div><span className="dash-kicker">รายงานหลังบ้าน</span><h1>ยอดประมูลและ Order</h1><p>สรุปราคาชนะ ค่าธรรมเนียม ยอดชำระ และสินค้าค้างส่งจากข้อมูลจริงใน Supabase</p></div>
        <Link className="button button-outline" href="/admin">← กลับภาพรวม</Link>
      </section>

      {invalidRange && <div className="seller-page-message error"><strong>ช่วงวันที่ไม่ถูกต้อง</strong><p>ระบบกลับมาแสดงข้อมูลย้อนหลัง 30 วัน กรุณาเลือกวันเริ่มไม่เกินวันสิ้นสุด และช่วงเวลาไม่เกิน 366 วัน</p></div>}

      <section className="panel report-toolbar">
        <form action="/admin/reports" method="get">
          <label>ตั้งแต่วันที่<input defaultValue={range.from} max={range.to} name="from" required type="date" /></label>
          <label>ถึงวันที่<input defaultValue={range.to} min={range.from} name="to" required type="date" /></label>
          <button className="button button-gold" type="submit">แสดงรายงาน</button>
        </form>
        <div className="report-export-actions">
          <a className="button button-outline" href={`/api/admin/reports/orders?${exportQuery.toString()}&format=csv`}>ดาวน์โหลด CSV</a>
          <a className="button button-gold" href={`/api/admin/reports/orders?${exportQuery.toString()}&format=xlsx`}>ดาวน์โหลด Excel</a>
        </div>
      </section>

      <section className="report-summary-grid" aria-label="สรุปรายงาน">
        <article><small>ยอดประมูล</small><strong>{formatBaht(report.summary.auctionValue)}</strong><span>{report.summary.orderCount.toLocaleString("th-TH")} Order</span></article>
        <article><small>ค่าธรรมเนียมรวม VAT</small><strong>{formatBaht(report.summary.feesIncludingVat)}</strong><span>ค่าธรรมเนียม {formatBaht(report.summary.buyerFees)} + VAT {formatBaht(report.summary.feeVat)}</span></article>
        <article><small>ยอดชำระที่ตรวจแล้ว</small><strong>{formatBaht(report.summary.approvedPaymentTotal)}</strong><span>{report.summary.approvedPaymentCount.toLocaleString("th-TH")} Order</span></article>
        <article><small>ยอดรอชำระ</small><strong>{formatBaht(report.summary.pendingPaymentTotal)}</strong><span>{report.summary.pendingPaymentCount.toLocaleString("th-TH")} Order</span></article>
        <article className={report.summary.pendingShipmentCount > 0 ? "attention" : ""}><small>สินค้าค้างส่ง</small><strong>{report.summary.pendingShipmentCount.toLocaleString("th-TH")} รายการ</strong><span>มูลค่า {formatBaht(report.summary.pendingShipmentTotal)}</span></article>
      </section>

      <section className="panel report-definition">
        <div className="panel-heading"><div><h2>นิยามตัวเลข</h2><p>ช่วยให้ทีมใช้ตัวเลขเดียวกันเมื่อสรุปยอด</p></div><span className="table-filter">{range.days} วัน</span></div>
        <div className="report-definition-grid">
          <p><strong>ยอดประมูล</strong><span>ผลรวมราคาชนะของ Order ที่สร้างในช่วงวันที่เลือก</span></p>
          <p><strong>ยอดชำระที่ตรวจแล้ว</strong><span>Order ที่แอดมินอนุมัติหลักฐานการชำระแล้ว</span></p>
          <p><strong>สินค้าค้างส่ง</strong><span>Order สถานะตรวจยอดแล้วหรือกำลังเตรียมส่ง</span></p>
        </div>
      </section>

      <section className="panel report-table-panel">
        <div className="panel-heading"><div><h2>รายละเอียด Order</h2><p>หน้าเว็บแสดงสูงสุด 100 รายการ ดาวน์โหลดไฟล์เพื่อดูข้อมูลทั้งหมดในช่วงวันที่</p></div><span className="table-filter">{report.rows.length.toLocaleString("th-TH")} รายการ</span></div>
        {displayedRows.length > 0 ? <div className="report-table-scroll"><table className="report-table">
          <thead><tr><th>Order</th><th>วันที่</th><th>รายการ</th><th>ลูกค้า</th><th>สถานะ</th><th>ราคาชนะ</th><th>ค่าธรรมเนียมรวม VAT</th><th>ยอดรวม</th><th /></tr></thead>
          <tbody>{displayedRows.map((row) => <tr key={row.id}>
            <td><strong>{row.orderNumber}</strong></td>
            <td>{timeLabel(row.createdAt)}</td>
            <td><strong>{row.auctionTitle}</strong><small>{row.category}</small></td>
            <td>{row.buyerName}</td>
            <td><span className={`status-pill ${row.status}`}><i />{orderStatusLabels[row.status] ?? row.status}</span></td>
            <td>{formatBaht(row.winningAmount)}</td>
            <td>{formatBaht(row.buyerFeeAmount + row.buyerFeeVatAmount)}</td>
            <td><strong>{formatBaht(row.totalAmount)}</strong></td>
            <td><Link href={`/orders/${row.id}`}>เปิด</Link></td>
          </tr>)}</tbody>
        </table></div> : <div className="admin-empty"><strong>ไม่มี Order ในช่วงวันที่นี้</strong><p>ลองเลือกช่วงวันที่ใหม่ หรือรอให้การประมูลจบและสร้าง Order ก่อน</p></div>}
      </section>

      <section className="panel report-table-panel">
        <div className="panel-heading"><div><h2>สินค้าค้างส่ง</h2><p>รายการตรวจยอดแล้วและรายการที่กำลังเตรียมส่ง</p></div><span className="table-filter">{report.summary.pendingShipmentCount.toLocaleString("th-TH")} รายการ</span></div>
        {pendingShipments.length > 0 ? <div className="report-pending-list">{pendingShipments.map((row) => <article key={row.id}>
          <div><small>{row.orderNumber}</small><strong>{row.auctionTitle}</strong><span>{row.buyerName}</span></div>
          <div><span className={`status-pill ${row.status}`}><i />{orderStatusLabels[row.status] ?? row.status}</span><strong>{formatBaht(row.totalAmount)}</strong><Link href={`/orders/${row.id}`}>เปิดใบออเดอร์</Link></div>
        </article>)}</div> : <div className="admin-empty"><strong>ไม่มีสินค้าค้างส่ง</strong><p>ไม่มี Order ที่อยู่ในสถานะตรวจยอดแล้วหรือกำลังเตรียมส่งในช่วงวันที่นี้</p></div>}
      </section>
    </>
  );
}
