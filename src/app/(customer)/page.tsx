import Link from "next/link";
import { redirect } from "next/navigation";
import { AuctionMarketCard } from "@/components/auction-market-card";
import { Brand } from "@/components/brand";
import { auctionCategories, getFeaturedAuctions } from "@/lib/auctions/queries";

export const dynamic = "force-dynamic";

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function marketplaceHref(query: string, category: string, page = 1) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (category) params.set("category", category);
  if (page > 1) params.set("page", String(page));
  return `/${params.size ? `?${params.toString()}` : ""}#live-lots`;
}

export default async function CustomerHome({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const requestedPage = Math.max(1, Number.parseInt(firstParam(params.page), 10) || 1);
  const requestedQuery = firstParam(params.q);
  const requestedCategory = firstParam(params.category);
  const { auctions, isDemo, total, page, totalPages, query, category } = await getFeaturedAuctions({ query: requestedQuery, category: requestedCategory, page: requestedPage, pageSize: 12 });
  if (totalPages > 0 && page > totalPages) redirect(marketplaceHref(query, category, totalPages));
  return (
    <div className="market-page">
      {isDemo && <div className="demo-ribbon">FOUNDATION PREVIEW · ข้อมูลในหน้านี้เป็นตัวอย่าง</div>}
      <main>
        <form action="/" className="mobile-market-search" method="get">
          <label><span className="sr-only">ค้นหารายการประมูล</span><input defaultValue={query} maxLength={80} name="q" placeholder="ค้นหาเหรียญ ธนบัตร พระ หรือการ์ด…" type="search" /></label>
          <button aria-label="ค้นหา" type="submit">⌕</button>
        </form>
        <div className="market-catalog-layout">
        <section aria-label="เลือกหมวดหมู่" className="category-strip" id="categories">
          <h2><span aria-hidden="true">▱</span> หมวดหมู่สินค้า</h2>
          <Link className={!category ? "active" : ""} href={marketplaceHref(query, "")}><span aria-hidden="true">▦</span>ทั้งหมด</Link>
          {auctionCategories.map((item) => <span className="category-link-group" key={item}><Link className={category === item ? "active" : ""} href={marketplaceHref(query, item)}><span aria-hidden="true">◇</span>{item}</Link></span>)}
        </section>

        <section className="content-section" id="live-lots">
          <div className="section-heading">
            <div><span className="section-label">กำลังประมูล</span><h2>รายการประมูล</h2></div>
            {(query || category) && <Link href="/#live-lots">ล้างตัวกรอง <span>×</span></Link>}
          </div>
          <form action="/" className="auction-filter-bar" method="get">
            <label className="auction-search"><span className="sr-only">ค้นหารายการประมูล</span><input defaultValue={query} maxLength={80} name="q" placeholder="ค้นหาชื่อสินค้า รุ่น หรือรายละเอียด…" type="search" /></label>
            <label><span className="sr-only">กรองหมวดหมู่</span><select defaultValue={category} name="category"><option value="">ทุกหมวดหมู่</option>{auctionCategories.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
            <button className="button button-dark" type="submit">ค้นหา</button>
          </form>
          <div className="auction-result-summary"><strong>{total.toLocaleString("th-TH")} รายการ</strong><span>{query ? `คำค้น “${query}”` : "รายการที่เปิดหรือกำลังจะเปิด"}{category ? ` · ${category}` : ""}</span></div>
          {auctions.length > 0 ? <div className="lot-grid">
            {auctions.map((lot) => <AuctionMarketCard key={lot.id} lot={lot} />)}
          </div> : <div className="empty-lots"><strong>{query || category ? "ไม่พบรายการที่ค้นหา" : "ยังไม่มีรายการที่เปิดประมูล"}</strong><p>{query || category ? "ลองเปลี่ยนคำค้นหรือเลือกทุกหมวดหมู่" : "เมื่อแอดมินตั้งเวลา รายการจะปรากฏตรงนี้อัตโนมัติ"}</p>{(query || category) && <Link className="button button-outline" href="/#live-lots">ดูรายการทั้งหมด</Link>}</div>}
          {totalPages > 1 && <nav aria-label="เปลี่ยนหน้ารายการประมูล" className="auction-pagination">
            {page > 1 ? <Link href={marketplaceHref(query, category, page - 1)}>← หน้าก่อน</Link> : <span aria-disabled="true">← หน้าก่อน</span>}
            <strong>หน้า {page.toLocaleString("th-TH")} / {totalPages.toLocaleString("th-TH")}</strong>
            {page < totalPages ? <Link href={marketplaceHref(query, category, page + 1)}>หน้าถัดไป →</Link> : <span aria-disabled="true">หน้าถัดไป →</span>}
          </nav>}
        </section>
        </div>

        <section className="how-section" id="how-it-works">
          <div className="section-heading center"><div><span className="section-label">เริ่มต้นง่าย</span><h2>ประมูลอย่างเป็นขั้นตอน</h2></div></div>
          <div className="step-grid">
            <article><span>01</span><h3>สมัครและยืนยันตัวตน</h3><p>สร้างบัญชีและยืนยันอีเมลก่อนเริ่มวางประมูล</p></article>
            <article><span>02</span><h3>ตรวจรายละเอียดรายการ</h3><p>ดูภาพ สภาพ ตำหนิ และข้อมูลผู้ขายให้ครบก่อนตัดสินใจ</p></article>
            <article><span>03</span><h3>วางราคาอย่างโปร่งใส</h3><p>ระบบตรวจราคาและเวลาในฐานข้อมูลก่อนยืนยันทุกครั้ง</p></article>
          </div>
        </section>
      </main>

      <footer className="market-footer">
        <Brand market />
        <nav aria-label="ข้อมูลและความปลอดภัย" className="market-footer-links">
          <Link href="/auction-rules">กติกาประมูล</Link>
          <Link href="/privacy">Privacy Policy</Link>
          <Link href="/fraud-warning">เตือนช่องปลอม</Link>
        </nav>
        <p>ต้นแบบระบบประมูลใหม่ของบอล แบงค์เก่า · ยังไม่เปิดทำธุรกรรมเงินจริง</p>
      </footer>
    </div>
  );
}
