import Link from "next/link";
import { AuctionCountdown } from "@/components/auction-countdown";
import { formatBaht, type AuctionView } from "@/lib/auctions/queries";

export function AuctionMarketCard({ lot }: { lot: AuctionView }) {
  const completed = lot.status === "ended" || lot.status === "settled";
  const statusLabel = completed ? "ประมูลจบแล้ว" : lot.status === "scheduled" ? "เร็ว ๆ นี้" : "กำลังประมูล";
  const resultLabel = lot.bidCount === 0 ? "ไม่มีคนประมูล" : `จบที่ ${formatBaht(lot.currentPrice)}`;

  return (
    <Link className="lot-card-link" href={`/auctions/${lot.id}`}>
      <article className={`lot-card${completed ? " completed" : ""}`}>
        <div
          aria-label={lot.primaryImageUrl ? `รูปหน้ารายการ ${lot.title}` : undefined}
          className={`lot-art ${lot.tone}${lot.primaryImageUrl ? " has-photo" : ""}`}
          role={lot.primaryImageUrl ? "img" : undefined}
          style={lot.primaryImageUrl ? { backgroundImage: `url("${lot.primaryImageUrl}")` } : undefined}
        >
          <span className={`live-badge${completed ? " completed" : ""}`}><i /> {statusLabel}</span>
          {!lot.primaryImageUrl && <span className="lot-icon">{lot.icon}</span>}
          {lot.primaryImageUrl && <span className="image-watermark lot-image-watermark">BBK AUCTION</span>}
          {completed && <span className="lot-time completed">{resultLabel}</span>}
        </div>
        {!completed && <div aria-label="เวลาประมูลคงเหลือ" className="lot-countdown-bar"><span>เหลือเวลา</span><strong><AuctionCountdown endsAt={lot.endsAt} /></strong></div>}
        <div className="lot-body">
          <span className="lot-category">{lot.category}</span>
          <h3>{lot.title}</h3>
          <p>{lot.evidenceNote}</p>
          {completed && <div className={`lot-result${lot.bidCount === 0 ? " empty" : ""}`}>{resultLabel}</div>}
          <div className="lot-price"><div><small>{completed ? lot.bidCount === 0 ? "ราคาเริ่มต้น" : "ราคาปิด" : "ราคาปัจจุบัน"}</small><strong>{formatBaht(lot.currentPrice)}</strong></div><span>{lot.bidCount} bids</span></div>
        </div>
      </article>
    </Link>
  );
}
