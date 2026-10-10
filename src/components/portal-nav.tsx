"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type PortalNavItem = {
  label: string;
  href: string;
  active?: boolean;
  group?: string;
};

export function PortalNav({ eyebrow, items }: { eyebrow: string; items: PortalNavItem[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label={`เมนู${eyebrow}`}>
      {items.map((item, index) => {
        const routePath = item.href.split("#")[0];
        const active = item.active ?? pathname === routePath;
        const showGroup = Boolean(item.group && item.group !== items[index - 1]?.group);
        return (
          <div className="portal-nav-entry" key={item.href}>
            {showGroup && <span className="portal-nav-group">{item.group}</span>}
            <Link aria-current={active ? "page" : undefined} className={active ? "active" : ""} href={item.href}>
              <span className="nav-dot" aria-hidden="true" />
              {item.label}
            </Link>
          </div>
        );
      })}
    </nav>
  );
}
