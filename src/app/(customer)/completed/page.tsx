import Link from "next/link";
import { redirect } from "next/navigation";
import { AuctionMarketCard } from "@/components/auction-market-card";
import { Brand } from "@/components/brand";
import { auctionCategories, getCompletedAuctions } from "@/lib/auctions/queries";

export const dynamic = "force-dynamic";

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function completedHref(query: string, category: string, page = 1) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (category) params.set("category", category);
  if (page > 1) params.set("page", String(page));
  return `/completed${params.size ? `?${params.toString()}` : ""}`;
}

export default async function CompletedAuctionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const requestedPage = Math.max(1, Number.parseInt(firstParam(params.page), 10) || 1);
  const requestedQuery = firstParam(params.q);
  const requestedCategory = firstParam(params.category);
  const { auctions, total, page, totalPages, query, category } = await getCompletedAuctions({
    query: requestedQuery,
    category: requestedCategory,
    page: requestedPage,
    pageSize: 12,
  });

  if (totalPages > 0 && page > totalPages) redirect(completedHref(query, category, totalPages));

  return (
    <div className="market-page">
      <main>
        <form action="/completed" className="mobile-market-search" method="get">
          <label><span className="sr-only">ค้นหารายการประมูลจบแล้ว</span><input defaultValue={query} maxLength={80} name="q" placeholder="ค้นหารายการประมูลจบแล้ว…" type="search" /></label>
          <button aria-label="ค้นหา" type="submit">⌕</button>
        </form>

        <div className="market-catalog-layout completed-market-layout">
          <section aria-label="เลือกหมวดหมู่" className="category-strip" id="categories">
            <h2><span aria-hidden="true">▱</span> หมวดหมู่สินค้า</h2>
            <Link className={!category ? "active" : ""} href={completedHref(query, "")}><span aria-hidden="true">▦</span>ทั้งหมด</Link>
            {auctionCategories.map((item) => <span className="category-link-group" key={item}><Link className={category === item ? "active" : ""} href={completedHref(query, item)}><span aria-hidden="true">◇</span>{item}</Link></span>)}
          </section>

          <section className="content-section completed-section" id="completed-lots">
            <div className="section-heading">
              <div><span className="section-label">รายการย้อนหลัง</span><h1>ประมูลจบแล้ว</h1></div>
              <span className="completed-count">{total.toLocaleString("th-TH")} รายการ</span>
            </div>
            <form action="/completed" className="auction-filter-bar" method="get">
              <label className="auction-search"><span className="sr-only">ค้นหารายการประมูลจบแล้ว</span><input defaultValue={query} maxLength={80} name="q" placeholder="ค้นหาชื่อสินค้า รุ่น หรือรายละเอียด…" type="search" /></label>
              <label><span className="sr-only">กรองหมวดหมู่</span><select defaultValue={category} name="category"><option value="">ทุกหมวดหมู่</option>{auctionCategories.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
              <button className="button button-dark" type="submit">ค้นหา</button>
            </form>
            {auctions.length > 0 ? <div className="lot-grid completed-lot-grid">
              {auctions.map((lot) => <AuctionMarketCard key={lot.id} lot={lot} />)}
            </div> : <div className="empty-lots"><strong>{query || category ? "ไม่พบรายการที่ค้นหา" : "ยังไม่มีรายการประมูลจบแล้ว"}</strong><p>{query || category ? "ลองเปลี่ยนคำค้นหรือเลือกทุกหมวดหมู่" : "รายการที่ปิดประมูลแล้วจะปรากฏในหน้านี้"}</p>{(query || category) && <Link className="button button-outline" href="/completed">ดูรายการทั้งหมด</Link>}</div>}
            {totalPages > 1 && <nav aria-label="เปลี่ยนหน้ารายการประมูลจบแล้ว" className="auction-pagination completed-pagination">
              {page > 1 ? <Link href={completedHref(query, category, page - 1)}>← หน้าก่อน</Link> : <span aria-disabled="true">← หน้าก่อน</span>}
              <strong>หน้า {page.toLocaleString("th-TH")} / {totalPages.toLocaleString("th-TH")}</strong>
              {page < totalPages ? <Link href={completedHref(query, category, page + 1)}>หน้าถัดไป →</Link> : <span aria-disabled="true">หน้าถัดไป →</span>}
            </nav>}
          </section>
        </div>
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
