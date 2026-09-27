import Link from "next/link";
import type { ReactNode } from "react";
import { Brand } from "@/components/brand";

type PublicInfoPageProps = {
  eyebrow: string;
  title: string;
  summary: string;
  updatedAt: string;
  children: ReactNode;
};

export function PublicInfoPage({ eyebrow, title, summary, updatedAt, children }: PublicInfoPageProps) {
  return (
    <div className="public-info-page">
      <div className="demo-ribbon">ระบบอยู่ระหว่างทดสอบ · ยังไม่เปิดรับชำระเงินจริง</div>
      <header className="market-header detail-header">
        <Brand />
        <Link className="button button-outline" href="/">← กลับหน้าตลาด</Link>
      </header>
      <main className="public-info-main">
        <header className="public-info-hero">
          <span className="section-label">{eyebrow}</span>
          <h1>{title}</h1>
          <p>{summary}</p>
          <small>ปรับปรุงล่าสุด {updatedAt} · ฉบับสำหรับการทดสอบระบบ</small>
        </header>
        <article className="public-info-content">{children}</article>
        <nav aria-label="ข้อมูลสำคัญ" className="public-info-links">
          <Link href="/auction-rules">กติกาประมูล</Link>
          <Link href="/privacy">Privacy Policy</Link>
          <Link href="/fraud-warning">เตือนช่องปลอม</Link>
        </nav>
      </main>
    </div>
  );
}
