"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type PortalNavItem = {
  label: string;
  href: string;
  active?: boolean;
};

export function PortalNav({ eyebrow, items }: { eyebrow: string; items: PortalNavItem[] }) {
  const pathname = usePathname();

  return (
    <nav aria-label={`เมนู${eyebrow}`}>
      {items.map((item) => {
        const routePath = item.href.split("#")[0];
        const active = item.active ?? pathname === routePath;
        return (
          <Link aria-current={active ? "page" : undefined} className={active ? "active" : ""} href={item.href} key={item.label}>
            <span className="nav-dot" aria-hidden="true" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
