import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { AuctionCountdown } from "@/components/auction-countdown";
import { signOut } from "@/app/auth/actions";
import { getCurrentUser } from "@/lib/auth/authorization";
import { auctionCategories, formatBaht, getFeaturedAuctions } from "@/lib/auctions/queries";

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
  const [{ auctions, isDemo, total, page, totalPages, query, category }, user] = await Promise.all([
    getFeaturedAuctions({ query: requestedQuery, category: requestedCategory, page: requestedPage, pageSize: 12 }),
    getCurrentUser(),
  ]);
  if (totalPages > 0 && page > totalPages) redirect(marketplaceHref(query, category, totalPages));
  return (
    <div className="market-page">
      {isDemo && <div className="demo-ribbon">FOUNDATION PREVIEW · ข้อมูลในหน้านี้เป็นตัวอย่าง</div>}
      <div className="market-promise-bar">
        <span>BBK AUCTION</span>
        <span>ประมูลก่อน ชำระเมื่อชนะ</span>
        <span>ตรวจสอบราคาและเวลาด้วยระบบกลาง</span>
      </div>
      <header className="market-header">
        <div className="market-header-main">
          <Brand />
          <form action="/" className="market-header-search" method="get">
            <label>
              <span className="sr-only">ค้นหารายการประมูล</span>
              <input defaultValue={query} maxLength={80} name="q" placeholder="ค้นหาเหรียญ ธนบัตร พระเครื่อง การ์ด และของสะสม" type="search" />
            </label>
            {category && <input name="category" type="hidden" value={category} />}
            <button type="submit">ค้นหา</button>
          </form>
          <div className="header-actions">
            <Link className="header-shortcut" href="/#live-lots"><span aria-hidden="true">♢</span><small>ประมูล</small></Link>
            <Link className="header-shortcut" href={user ? "/account#notifications" : "/auth/sign-in?next=/account"}><span aria-hidden="true">♧</span><small>แจ้งเตือน</small></Link>
            <Link className="header-shortcut" href={user ? "/account" : "/auth/sign-in?next=/account"}><span aria-hidden="true">○</span><small>บัญชี</small></Link>
          </div>
        </div>
        <nav className="market-nav" aria-label="เมนูหลัก">
          <Link className="active" href="/">ประมูลสด</Link>
          <Link href="#categories">หมวดหมู่</Link>
          <Link href="#how-it-works">วิธีใช้งาน</Link>
          {user ? (
            <>
              <Link className="button button-gold" href="/account/verification">ขอสิทธิ์ประมูล</Link>
              <span className="account-badge">
                <small>เข้าสู่ระบบแล้ว</small>
                <strong>{user.email ?? "สมาชิก"}</strong>
              </span>
              <form action={signOut}>
                <button className="button button-outline" type="submit">ออกจากระบบ</button>
              </form>
            </>
          ) : (
            <Link className="button button-dark" href="/auth/sign-in">เข้าสู่ระบบ</Link>
          )}
        </nav>
      </header>

      <main>
        <form action="/" className="mobile-market-search" method="get">
          <label><span className="sr-only">ค้นหารายการประมูล</span><input defaultValue={query} maxLength={80} name="q" placeholder="ค้นหาเหรียญ ธนบัตร พระ หรือการ์ด…" type="search" /></label>
          <button aria-label="ค้นหา" type="submit">⌕</button>
        </form>
        <section className="hero">
          <div className="hero-orbit orbit-one" />
          <div className="hero-orbit orbit-two" />
          <div className="hero-copy">
            <span className="kicker"><i /> คัดสรรของสะสมที่มีเรื่องราว</span>
            <h1>ของดี มีที่มา<br /><em>ประมูลอย่างมั่นใจ</em></h1>
            <p>รายการเหรียญเก่า ธนบัตร พระเครื่อง การ์ดเกม และของสะสมจาก BBK พร้อมประวัติการประมูลที่ตรวจสอบได้</p>
            <div className="hero-actions">
              <Link className="button button-gold" href="#live-lots">ดูรายการประมูล</Link>
              <Link className="button button-quiet" href="#how-it-works">เรียนรู้วิธีประมูล <span>→</span></Link>
            </div>
            <div className="trust-row">
              <span><b>✓</b> สินค้าจากร้าน BBK</span>
              <span><b>✓</b> ราคาอัปเดตจากฐานข้อมูล</span>
              <span><b>✓</b> มีประวัติการทำรายการ</span>
            </div>
          </div>
          <div className="hero-showcase">
            <figure className="hero-feature-image">
              <Image alt="ภาพรายการเด่นธนบัตร 10 บาท รุ่น 9 พร้อมตรา BBK AUCTION" fill priority sizes="(max-width: 820px) 92vw, 48vw" src="/brand/bbk-auction-hero.png" />
            </figure>
          </div>
        </section>

        <section aria-label="เลือกหมวดหมู่" className="category-strip" id="categories">
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
            {auctions.map((lot) => (
              <Link className="lot-card-link" href={`/auctions/${lot.id}`} key={lot.id}>
              <article className="lot-card">
                <div
                  aria-label={lot.primaryImageUrl ? `รูปหน้ารายการ ${lot.title}` : undefined}
                  className={`lot-art ${lot.tone}${lot.primaryImageUrl ? " has-photo" : ""}`}
                  role={lot.primaryImageUrl ? "img" : undefined}
                  style={lot.primaryImageUrl ? { backgroundImage: `url("${lot.primaryImageUrl}")` } : undefined}
                >
                  <span className="live-badge"><i /> {lot.status.toUpperCase()}</span>
                  {!lot.primaryImageUrl && <span className="lot-icon">{lot.icon}</span>}
                  {lot.primaryImageUrl && <span className="image-watermark lot-image-watermark">BBK AUCTION</span>}
                  <span className="lot-time"><AuctionCountdown endsAt={lot.endsAt} /></span>
                </div>
                <div className="lot-body">
                  <span className="lot-category">{lot.category}</span>
                  <h3>{lot.title}</h3>
                  <p>{lot.evidenceNote}</p>
                  <div className="lot-price"><div><small>ราคาปัจจุบัน</small><strong>{formatBaht(lot.currentPrice)}</strong></div><span>{lot.bidCount} bids</span></div>
                </div>
              </article>
              </Link>
            ))}
          </div> : <div className="empty-lots"><strong>{query || category ? "ไม่พบรายการที่ค้นหา" : "ยังไม่มีรายการที่เปิดประมูล"}</strong><p>{query || category ? "ลองเปลี่ยนคำค้นหรือเลือกทุกหมวดหมู่" : "เมื่อแอดมินตั้งเวลา รายการจะปรากฏตรงนี้อัตโนมัติ"}</p>{(query || category) && <Link className="button button-outline" href="/#live-lots">ดูรายการทั้งหมด</Link>}</div>}
          {totalPages > 1 && <nav aria-label="เปลี่ยนหน้ารายการประมูล" className="auction-pagination">
            {page > 1 ? <Link href={marketplaceHref(query, category, page - 1)}>← หน้าก่อน</Link> : <span aria-disabled="true">← หน้าก่อน</span>}
            <strong>หน้า {page.toLocaleString("th-TH")} / {totalPages.toLocaleString("th-TH")}</strong>
            {page < totalPages ? <Link href={marketplaceHref(query, category, page + 1)}>หน้าถัดไป →</Link> : <span aria-disabled="true">หน้าถัดไป →</span>}
          </nav>}
        </section>

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
        <Brand />
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
