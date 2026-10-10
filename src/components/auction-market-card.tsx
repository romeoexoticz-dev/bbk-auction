import Link from "next/link";
import { AuctionCountdown } from "@/components/auction-countdown";
import { formatBaht, type AuctionView } from "@/lib/auctions/queries";

export function AuctionMarketCard({ lot }: { lot: AuctionView }) {
  const completed = lot.status === "ended" || lot.status === "settled";
  const statusClassName = completed ? "completed" : lot.status === "scheduled" ? "scheduled" : "live";
  const statusLabel = completed ? "ประมูลจบแล้ว" : lot.status === "scheduled" ? "เร็ว ๆ นี้" : "กำลังประมูล";
  const resultLabel = lot.bidCount === 0 ? "ไม่มีคนประมูล" : `จบที่ ${formatBaht(lot.currentPrice)}`;

  return (
    <Link aria-label={`${lot.title} ${statusLabel} ${completed ? resultLabel : `ราคาปัจจุบัน ${formatBaht(lot.currentPrice)}`} ดูรายละเอียด`} className="lot-card-link" href={`/auctions/${lot.id}`}>
      <article className={`lot-card senior-lot-card${completed ? " completed" : ""}`}>
        <div
          aria-label={lot.primaryImageUrl ? `รูปหน้ารายการ ${lot.title}` : undefined}
          className={`lot-art ${lot.tone}${lot.primaryImageUrl ? " has-photo" : ""}`}
          role={lot.primaryImageUrl ? "img" : undefined}
          style={lot.primaryImageUrl ? { backgroundImage: `url("${lot.primaryImageUrl}")` } : undefined}
        >
          {!lot.primaryImageUrl && <span className="lot-icon">{lot.icon}</span>}
          {lot.primaryImageUrl && <span className="image-watermark lot-image-watermark">BBK AUCTION</span>}
        </div>
        <div className="lot-body">
          <span className={`live-badge ${statusClassName}`}><i /> {statusLabel}</span>
          <span className="lot-category">{lot.category}</span>
          <h3>{lot.title}</h3>
          <div className="lot-price"><div><small>{completed ? lot.bidCount === 0 ? "ราคาเริ่มต้น" : "ราคาปิด" : "ราคาปัจจุบัน"}</small><strong>{formatBaht(lot.currentPrice)}</strong></div><span>{lot.bidCount.toLocaleString("th-TH")} ครั้ง</span></div>
        </div>
        {completed ? <div className={`lot-result${lot.bidCount === 0 ? " empty" : ""}`}>{resultLabel}</div> : <div aria-label="เวลาประมูลคงเหลือ" className="lot-countdown-bar"><span className="senior-time-label">เวลาที่เหลือ</span><strong><AuctionCountdown endsAt={lot.endsAt} /></strong></div>}
        <span className="lot-card-cta">{completed ? "ดูผลประมูล →" : lot.status === "scheduled" ? "ดูรายละเอียด →" : "ดูสินค้าและเสนอราคา →"}</span>
      </article>
    </Link>
  );
}
