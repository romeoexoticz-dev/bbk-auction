import Link from "next/link";
import type { ReactNode } from "react";
import { Brand } from "@/components/brand";
import { PortalNav } from "@/components/portal-nav";

type PortalShellProps = {
  eyebrow: string;
  title: string;
  nav: { label: string; href: string; active?: boolean; group?: string }[];
  children: ReactNode;
  accent?: "seller" | "admin";
  backAction?: { label: string; href: string };
};

export function PortalShell({ eyebrow, title, nav, children, accent = "seller", backAction }: PortalShellProps) {
  return (
    <div className={`portal-shell ${accent}`}>
      <aside className="portal-sidebar">
        <Brand />
        <div className="portal-identity">
          <span>{eyebrow}</span>
          <strong>{title}</strong>
        </div>
        <PortalNav eyebrow={eyebrow} items={nav} />
        <div className="portal-side-footer">
          <span className="status-dot" /> ต้นแบบระบบ — ยังไม่เปิดเงินจริง
        </div>
      </aside>
      <div className="portal-main">
        <header className="portal-topbar">
          <div>
            <span className="mobile-eyebrow">{eyebrow}</span>
            <strong>{title}</strong>
          </div>
          <div className="top-actions">
            {backAction && <Link className="portal-back-button" href={backAction.href}><span aria-hidden="true">←</span>{backAction.label}</Link>}
            <Link className="ghost-button" href="/">ดูหน้าตลาด</Link>
            {accent === "admin" ? <Link className="avatar-button" aria-label="บัญชีของฉัน" href="/account">ต</Link> : <button className="avatar-button" aria-label="เมนูบัญชี" type="button">ต</button>}
          </div>
        </header>
        {accent === "admin" && <details className="portal-mobile-menu">
          <summary>☰ เมนูแอดมิน <span>เลือกหมวดงาน</span></summary>
          <PortalNav eyebrow={eyebrow} items={nav} />
        </details>}
        <main className="portal-content">{children}</main>
      </div>
    </div>
  );
}
