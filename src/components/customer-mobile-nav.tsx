"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items: { href: string; label: string; icon: string; auth?: boolean }[] = [
  { href: "/", label: "หน้าแรก", icon: "⌂" },
  { href: "/#live-lots", label: "ประมูล", icon: "◈" },
  { href: "/#categories", label: "หมวดหมู่", icon: "▦" },
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
          : item.href === "/"
            ? pathname === "/"
            : false;
        return <Link className={active ? "active" : ""} href={href} key={item.label}><span aria-hidden="true">{item.icon}</span><small>{item.label}</small></Link>;
      })}
    </nav>
  );
}
