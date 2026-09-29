"use client";

import { useEffect, useMemo, useState } from "react";
import type { AuctionMediaView } from "@/lib/auctions/queries";

function mediaLabel(kind: AuctionMediaView["kind"]) {
  if (kind === "front") return "ด้านหน้า";
  if (kind === "back") return "ด้านหลัง";
  if (kind === "defect") return "ตำหนิ";
  if (kind === "evidence") return "หลักฐาน";
  if (kind === "cover") return "ภาพปก";
  return "เพิ่มเติม";
}

export function AuctionImageGallery({
  icon,
  media,
  status,
  title,
  tone,
}: {
  icon: string;
  media: AuctionMediaView[];
  status: string;
  title: string;
  tone: string;
}) {
  const initialIndex = useMemo(() => {
    const frontIndex = media.findIndex((item) => item.kind === "front");
    if (frontIndex >= 0) return frontIndex;
    const coverIndex = media.findIndex((item) => item.kind === "cover");
    return coverIndex >= 0 ? coverIndex : 0;
  }, [media]);
  const [selectedIndex, setSelectedIndex] = useState(initialIndex);
  const [viewerOpen, setViewerOpen] = useState(false);
  const selected = media[selectedIndex];

  useEffect(() => {
    if (!viewerOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setViewerOpen(false);
      if (event.key === "ArrowLeft") setSelectedIndex((current) => (current - 1 + media.length) % media.length);
      if (event.key === "ArrowRight") setSelectedIndex((current) => (current + 1) % media.length);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [media.length, viewerOpen]);

  function move(step: number) {
    setSelectedIndex((current) => (current + step + media.length) % media.length);
  }

  return (
    <section className="auction-gallery">
      {selected ? (
        <button
          aria-label={`ขยายรูป${mediaLabel(selected.kind)} ${title}`}
          className={`detail-art gallery-main-button ${tone} has-photo`}
          onClick={() => setViewerOpen(true)}
          style={{ backgroundImage: `url("${selected.url}")` }}
          type="button"
        >
          <span className="live-badge"><i /> {status.toUpperCase()}</span>
          <small>{title.startsWith("TEST") ? "ภาพตัวอย่างสำหรับทดสอบ · แตะเพื่อขยาย" : "ภาพสินค้าจริงจาก BBK · แตะเพื่อขยาย"}</small>
          <span className="image-watermark">BBK AUCTION</span>
        </button>
      ) : (
        <div className={`detail-art ${tone}`}><span className="live-badge"><i /> {status.toUpperCase()}</span><span className="detail-icon">{icon}</span><small>ยังไม่มีรูปสินค้า</small><span className="image-watermark">BBK AUCTION</span></div>
      )}

      <div className="evidence-strip">
        {media.length > 0 ? media.map((item, index) => (
          <button
            aria-label={`ดูรูป${mediaLabel(item.kind)} ${title}`}
            aria-pressed={index === selectedIndex}
            className="evidence-photo"
            key={item.id}
            onClick={() => { setSelectedIndex(index); setViewerOpen(true); }}
            style={{ backgroundImage: `url("${item.url}")` }}
            type="button"
          >
            <b>{mediaLabel(item.kind)}</b>
          </button>
        )) : <><span>ภาพด้านหน้า</span><span>ภาพด้านหลัง</span><span>ตำหนิ/ขอบ</span><span>หลักฐาน</span></>}
      </div>

      {viewerOpen && selected && (
        <div aria-label={`ดูรูปสินค้า ${title}`} aria-modal="true" className="image-viewer" onClick={() => setViewerOpen(false)} role="dialog">
          <button aria-label="ปิดรูปภาพ" className="image-viewer-close" onClick={() => setViewerOpen(false)} type="button">×</button>
          {media.length > 1 && <button aria-label="รูปก่อนหน้า" className="image-viewer-nav previous" onClick={(event) => { event.stopPropagation(); move(-1); }} type="button">‹</button>}
          <div aria-label={`รูป${mediaLabel(selected.kind)} ${title}`} className="image-viewer-photo" onClick={(event) => event.stopPropagation()} role="img" style={{ backgroundImage: `url("${selected.url}")` }} />
          {media.length > 1 && <button aria-label="รูปถัดไป" className="image-viewer-nav next" onClick={(event) => { event.stopPropagation(); move(1); }} type="button">›</button>}
          <div className="image-viewer-caption">{mediaLabel(selected.kind)} · {selectedIndex + 1}/{media.length}</div>
        </div>
      )}
    </section>
  );
}
