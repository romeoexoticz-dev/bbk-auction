import Link from "next/link";
import type { ReactNode } from "react";
import { Brand } from "@/components/brand";

type PortalShellProps = {
  eyebrow: string;
  title: string;
  nav: { label: string; href: string; active?: boolean }[];
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
        <nav aria-label={`เมนู${eyebrow}`}>
          {nav.map((item) => (
            <Link className={item.active ? "active" : ""} href={item.href} key={item.label}>
              <span className="nav-dot" aria-hidden="true" />
              {item.label}
            </Link>
          ))}
        </nav>
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
            <button className="avatar-button" aria-label="เมนูบัญชี" type="button">ต</button>
          </div>
        </header>
        <main className="portal-content">{children}</main>
      </div>
    </div>
  );
}
