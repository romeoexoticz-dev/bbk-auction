import Link from "next/link";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import { Brand } from "@/components/brand";
import { AuctionCountdown } from "@/components/auction-countdown";
import { AuctionLiveRefresh } from "@/components/auction-live-refresh";
import { BidForm } from "@/components/bid-form";
import { formatBaht, getAuctionById, getAuctionMedia, getAuctionOutcome, getPublicBidHistory } from "@/lib/auctions/queries";
import { getCurrentBidderVerification } from "@/lib/identity/queries";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export default async function AuctionDetailPage({ params }: PageProps<"/auctions/[id]">) {
  const { id } = await params;
  const auction = await getAuctionById(id);
  if (!auction) notFound();
  const [media, bidHistory] = await Promise.all([
    getAuctionMedia(auction.id),
    getPublicBidHistory(auction.id),
  ]);
  const primaryImage = media.find((item) => item.kind === "front") ?? media.find((item) => item.kind === "cover") ?? media[0];
  const outcome = auction.status === "ended" || auction.status === "settled"
    ? await getAuctionOutcome(auction.id)
    : null;
  const verification = auction.status === "live"
    ? await getCurrentBidderVerification()
    : null;

  const configured = isSupabaseConfigured();
  const minimum = auction.bidCount === 0 ? auction.openingPrice : auction.currentPrice + auction.minIncrement;
  const minimumBaht = (minimum / 100).toFixed(minimum % 100 === 0 ? 0 : 2);
  const startsAtLabel = new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(new Date(auction.startsAt));
  const bidDateTime = new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "Asia/Bangkok",
  });

  return (
    <div className="auction-detail-page">
      <div className="demo-ribbon">{configured ? "LIVE DATA · ราคาจริงจากฐานข้อมูลกลาง" : "DEMO LOT · ไม่รับ bid และไม่มีธุรกรรมเงินจริง"}</div>
      <header className="market-header detail-header"><Brand /><Link className="button button-outline" href="/">← กลับหน้าตลาด</Link></header>
      <main className="auction-detail">
        <section className="auction-gallery">
          <div className={`detail-art ${auction.tone}${primaryImage ? " has-photo" : ""}`} aria-label={primaryImage ? `รูปสินค้าหลัก ${auction.title}` : undefined} role={primaryImage ? "img" : undefined} style={primaryImage ? { backgroundImage: `url("${primaryImage.url}")` } : undefined}><span className="live-badge"><i /> {auction.status.toUpperCase()}</span>{!primaryImage && <span className="detail-icon">{auction.icon}</span>}<small>{primaryImage ? "ภาพสินค้าจริงจาก BBK" : "ยังไม่มีรูปสินค้า"}</small><span className="image-watermark">BBK AUCTION</span></div>
          <div className="evidence-strip">{media.length > 0 ? media.map((item) => <span className="evidence-photo" key={item.id} style={{ backgroundImage: `url("${item.url}")` }}><b>{item.kind === "front" ? "ด้านหน้า" : item.kind === "back" ? "ด้านหลัง" : item.kind === "defect" ? "ตำหนิ" : item.kind === "evidence" ? "หลักฐาน" : "เพิ่มเติม"}</b></span>) : <><span>ภาพด้านหน้า</span><span>ภาพด้านหลัง</span><span>ตำหนิ/ขอบ</span><span>หลักฐาน</span></>}</div>
        </section>
        <section className="auction-summary">
          <span className="section-label">{auction.category} · VERSION {auction.version}</span>
          <h1>{auction.title}</h1>
          <p>{auction.description}</p>
          <dl className="product-trust-grid">
            <div><dt>ปี / ยุค</dt><dd>{auction.itemYear}</dd></div>
            <div><dt>รุ่น / แบบ</dt><dd>{auction.itemModel}</dd></div>
            <div><dt>ขนาด / น้ำหนัก</dt><dd>{auction.itemSize}</dd></div>
            <div><dt>สภาพ</dt><dd>{auction.conditionSummary}</dd></div>
          </dl>
          <div className="expert-note"><strong>หมายเหตุจากผู้เชี่ยวชาญของร้าน</strong><p>{auction.expertNotes}</p></div>
          <div className="auction-facts"><div><small>{outcome?.hasWinner ? "ราคาชนะ" : "ราคาปัจจุบัน"}</small><strong>{formatBaht(outcome?.winningAmount ?? auction.currentPrice)}</strong><span>{auction.bidCount} bids</span></div><div><small>{auction.status === "ended" || auction.status === "settled" ? "สถานะ" : "ปิดรับใน"}</small><strong className="countdown-large">{auction.status === "ended" || auction.status === "settled" ? "ปิดแล้ว" : <AuctionCountdown endsAt={auction.endsAt} />}</strong><span>เวลาฐานข้อมูลเป็นตัวตัดสิน</span></div></div>
          {configured && <AuctionLiveRefresh auctionId={auction.id} auctionStatus={auction.status} startsAt={auction.startsAt} endsAt={auction.endsAt} />}
          {auction.status === "scheduled" && <div className="demo-bid-note"><strong>รายการนี้ตั้งเวลาไว้</strong><p>ระบบจะเปิดรับประมูลอัตโนมัติวันที่ {startsAtLabel} แล้วรีเฟรชหน้านี้ให้</p></div>}
          {auction.status === "live" && verification?.status === "approved" && <BidForm auctionId={auction.id} buyerFeeRateBps={auction.buyerFeeRateBps} buyerFeeVatRateBps={auction.buyerFeeVatRateBps} disabled={!configured} minimumBaht={minimumBaht} requestKey={randomUUID()} />}
          {auction.status === "live" && verification?.status !== "approved" && <div className="demo-bid-note"><strong>ขอสิทธิ์ก่อนวางประมูล</strong><p>ต้องยืนยันอีเมลและรอแอดมินอนุมัติบัญชี เพื่อป้องกันการบิดเล่น</p><Link className="button button-gold verification-inline-cta" href="/account/verification">ส่งให้แอดมินตรวจ</Link></div>}
          {(auction.status === "ended" || auction.status === "settled") && <div className="demo-bid-note"><strong>{outcome?.isCurrentUserWinner ? "คุณชนะการประมูล" : outcome?.hasWinner ? "การประมูลสิ้นสุดแล้ว" : "จบการประมูลโดยไม่มีผู้ชนะ"}</strong><p>{outcome?.hasWinner && outcome.winningAmount !== null ? `ราคาชนะ ${formatBaht(outcome.winningAmount)}${outcome.isCurrentUserWinner && outcome.totalAmount !== null ? ` · ยอดรวม ${formatBaht(outcome.totalAmount)} (ยังไม่รวมค่าส่ง)` : ""}` : "ไม่มี bid ที่ผ่านเงื่อนไข ระบบจึงไม่สร้างผู้ชนะ"}</p>{outcome?.isCurrentUserWinner && outcome.orderId && <Link className="button button-gold verification-inline-cta" href={`/orders/${outcome.orderId}`}>ดูคำสั่งซื้อ {outcome.orderNumber}</Link>}</div>}
          {!configured && <div className="demo-bid-note"><strong>โหมดตัวอย่าง</strong><p>เมื่อใส่ค่า Supabase และรัน migration แล้ว แบบฟอร์มนี้จะเรียก `place_bid` RPC ผ่าน Server Action</p></div>}
          <div className="bid-rules"><h2>ก่อนวางประมูล</h2><ul><li>ตรวจรูป สภาพ ตำหนิ และรายละเอียดสินค้าให้ครบ</li><li>สินค้าในระบบเป็นสินค้าที่ร้าน BBK คัดเลือกและนำลงเอง</li><li>ราคาและเวลาที่ยอมรับยึดฐานข้อมูลเป็นหลัก</li></ul></div>
          {auction.extensionWindowSeconds > 0 && auction.extensionDurationSeconds > 0 && <div className="demo-bid-note"><strong>กติกาต่อเวลาอัตโนมัติ</strong><p>ถ้ามีผู้เสนอราคาใน {auction.extensionWindowSeconds / 60} นาทีสุดท้าย ระบบจะต่อเวลาให้อีก {auction.extensionDurationSeconds / 60} นาที และทำซ้ำจนไม่มีราคาใหม่ในช่วงท้าย</p></div>}
        </section>
        <section className="auction-bid-history" aria-labelledby="bid-history-title">
          <div className="auction-bid-history-heading">
            <div><span className="section-label">ตรวจสอบย้อนหลังได้</span><h2 id="bid-history-title">ประวัติการเสนอราคา</h2></div>
            <strong>{auction.bidCount} ครั้ง</strong>
          </div>
          {bidHistory.length > 0 ? <ol className="auction-bid-history-list">
            {bidHistory.map((bid) => <li key={bid.sequence}>
              <div><strong>{bid.isCurrentUser ? "คุณ" : bid.bidderAlias}</strong><time dateTime={bid.createdAt}>{bidDateTime.format(new Date(bid.createdAt))}</time></div>
              <b>{formatBaht(bid.amount)}</b>
            </li>)}
          </ol> : <div className="auction-bid-history-empty"><strong>ยังไม่มีผู้เสนอราคา</strong><p>เมื่อมีราคาที่ระบบยอมรับ ประวัติจะปรากฏที่นี่โดยซ่อนข้อมูลส่วนตัวของผู้ประมูล</p></div>}
          <p className="auction-bid-history-privacy">ระบบใช้ชื่อแทนเฉพาะในรายการนี้ และไม่เปิดเผยชื่อจริง อีเมล เบอร์โทร หรือรหัสบัญชี</p>
        </section>
      </main>
      {auction.status === "live" && verification?.status === "approved" && <a className="mobile-auction-cta" href="#bid-panel"><span>ขั้นต่ำ {minimumBaht} บาท</span><strong>เสนอราคา</strong></a>}
      {auction.status === "live" && verification?.status !== "approved" && <Link className="mobile-auction-cta" href="/account/verification"><span>ยืนยันบัญชีก่อน</span><strong>ขอสิทธิ์ประมูล</strong></Link>}
    </div>
  );
}
