import type { ReactNode } from "react";
import type { Metadata } from "next";
import { PortalShell } from "@/components/portal-shell";
import { requireRole } from "@/lib/auth/authorization";

export const metadata: Metadata = { title: "ศูนย์ทีม BBK" };

const nav = [
  { label: "ภาพรวมสินค้า", href: "/seller", active: true },
  { label: "สร้างรายการ", href: "/seller#new" },
  { label: "รายการทั้งหมด", href: "/seller#auctions" },
  { label: "กลับหน้าแอดมิน", href: "/admin" },
];

export default async function SellerLayout({ children }: { children: ReactNode }) {
  await requireRole("admin", "/seller");
  await requireRole("seller", "/seller");
  return <PortalShell eyebrow="BBK TEAM" title="ศูนย์ทีม BBK" nav={nav} accent="admin" backAction={{ label: "กลับหน้าแอดมิน", href: "/admin" }}>{children}</PortalShell>;
}
