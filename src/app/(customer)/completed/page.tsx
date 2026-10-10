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
    <div className="market-page senior-market">
      <main>
        <section className="senior-market-intro" aria-labelledby="completed-title"><div><span className="senior-market-eyebrow">รายการย้อนหลัง</span><h1 id="completed-title">ประมูลจบแล้ว</h1><p>ดูราคาปิดและรายการที่ไม่มีผู้เสนอราคา</p></div><Link className="senior-completed-link" href="/#live-lots">← กลับไปดูรายการประมูล</Link></section>
        <form action="/completed" className="senior-search" method="get"><label htmlFor="senior-completed-search">ค้นหารายการที่จบแล้ว</label><div><input defaultValue={query} id="senior-completed-search" maxLength={80} name="q" placeholder="พิมพ์ชื่อสินค้า" type="search" /><button type="submit">ค้นหา</button></div>{category && <input name="category" type="hidden" value={category} />}</form>

        <div className="market-catalog-layout completed-market-layout">
          <details className="senior-category-picker" id="categories"><summary>หมวดสินค้า: <strong>{category || "ทั้งหมด"}</strong><span aria-hidden="true">▾</span></summary><div aria-label="เลือกหมวดหมู่" className="senior-category-options"><Link aria-current={!category ? "page" : undefined} className={!category ? "active" : ""} href={completedHref(query, "")}>ทั้งหมด</Link>{auctionCategories.map((item) => <Link aria-current={category === item ? "page" : undefined} className={category === item ? "active" : ""} href={completedHref(query, item)} key={item}>{item}</Link>)}</div></details>

          <section className="content-section completed-section" id="completed-lots">
            <div className="section-heading">
              <div><h2>ผลประมูลทั้งหมด</h2></div>
              <span className="completed-count">{total.toLocaleString("th-TH")} รายการ</span>
            </div>
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
