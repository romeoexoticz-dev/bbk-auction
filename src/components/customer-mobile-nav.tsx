"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items: { href: string; label: string; icon: string; auth?: boolean }[] = [
  { href: "/", label: "รายการประมูล", icon: "◈" },
  { href: "/completed", label: "จบแล้ว", icon: "✓" },
  { href: "/account#notifications", label: "แจ้งเตือน", icon: "♢", auth: true },
  { href: "/account", label: "บัญชี", icon: "○", auth: true },
];

export function CustomerMobileNav({ signedIn }: { signedIn: boolean }) {
  const pathname = usePathname();
  if (pathname.startsWith("/auctions/") || pathname.startsWith("/orders/")) return null;

  return (
    <nav aria-label="เมนูลูกค้าบนมือถือ" className="customer-mobile-nav">
      {items.map((item) => {
        const href = item.auth && !signedIn ? "/auth/sign-in?next=/account" : item.href;
        const active = item.href === "/account"
          ? pathname === "/account"
          : item.href === "/completed"
            ? pathname === "/completed"
          : item.href === "/"
            ? pathname === "/"
            : false;
        return <Link className={active ? "active" : ""} href={href} key={item.label}>{item.label === "แจ้งเตือน" ? <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg> : <span aria-hidden="true">{item.icon}</span>}<small>{item.label}</small></Link>;
      })}
    </nav>
  );
}
