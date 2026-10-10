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
    <div className="market-page senior-market">
      {isDemo && <div className="demo-ribbon">FOUNDATION PREVIEW · ข้อมูลในหน้านี้เป็นตัวอย่าง</div>}
      <main>
        <section className="senior-market-intro" aria-labelledby="market-title">
          <div><span className="senior-market-eyebrow">บอล แบงค์เก่า</span><h1 id="market-title">เลือกสินค้าที่อยากประมูล</h1><p>ดูรูป ราคา และเวลาที่เหลือได้ทันที กดดูรายละเอียดก่อนเสนอราคา</p></div>
          <Link className="senior-completed-link" href="/completed">ดูรายการที่จบแล้ว →</Link>
        </section>
        <form action="/" className="senior-search" method="get">
          <label htmlFor="senior-search-input">ค้นหาสินค้า</label>
          <div><input defaultValue={query} id="senior-search-input" maxLength={80} name="q" placeholder="เช่น เหรียญ 10 บาท หรือธนบัตร" type="search" /><button type="submit">ค้นหา</button></div>
          {category && <input name="category" type="hidden" value={category} />}
        </form>
        <div className="market-catalog-layout">
        <details className="senior-category-picker" id="categories">
          <summary>หมวดสินค้า: <strong>{category || "ทั้งหมด"}</strong><span aria-hidden="true">▾</span></summary>
          <div aria-label="เลือกหมวดหมู่" className="senior-category-options">
            <Link aria-current={!category ? "page" : undefined} className={!category ? "active" : ""} href={marketplaceHref(query, "")}>ทั้งหมด</Link>
            {auctionCategories.map((item) => <Link aria-current={category === item ? "page" : undefined} className={category === item ? "active" : ""} href={marketplaceHref(query, item)} key={item}>{item}</Link>)}
          </div>
        </details>

        <section className="content-section" id="live-lots">
          <div className="section-heading">
            <div><h2>รายการประมูล</h2><p className="senior-section-hint">เลือกสินค้าเพื่อดูข้อมูลและเสนอราคา</p></div>
            {(query || category) && <Link href="/#live-lots">ล้างตัวกรอง</Link>}
          </div>
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

        <section className="senior-help"><h2>ประมูลครั้งแรก?</h2><p>อ่านกติกาและวิธีคิดยอดชำระให้ครบก่อนยืนยันราคา</p><Link href="/auction-rules">อ่านกติกาการประมูล →</Link></section>
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
