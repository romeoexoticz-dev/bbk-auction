import type { ReactNode } from "react";
import type { Metadata } from "next";
import { MobileNotificationCenter, type MobileNotification } from "@/components/mobile-notification-center";
import { PortalShell } from "@/components/portal-shell";
import { requireRole } from "@/lib/auth/authorization";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "ศูนย์ควบคุมแอดมิน" };

const nav = [
  { label: "ภาพรวมและงานรอทำ", href: "/admin", group: "เริ่มงาน" },
  { label: "รายการประมูล", href: "/seller", group: "สินค้าและประมูล" },
  { label: "ตรวจและแก้รายการ", href: "/admin/auctions", group: "สินค้าและประมูล" },
  { label: "จัดประมูลเป็นรอบ", href: "/admin/rounds", group: "สินค้าและประมูล" },
  { label: "อนุมัติผู้ประมูล", href: "/admin/members", group: "ลูกค้าและออเดอร์" },
  { label: "ตรวจการชำระ", href: "/admin/payments", group: "ลูกค้าและออเดอร์" },
  { label: "กำหนดค่าจัดส่ง", href: "/admin/shipping", group: "ลูกค้าและออเดอร์" },
  { label: "จัดส่งสินค้า", href: "/admin/fulfillment", group: "ลูกค้าและออเดอร์" },
  { label: "ตรวจบัญชีไม่ชำระ", href: "/admin/defaults", group: "ลูกค้าและออเดอร์" },
  { label: "คะแนนผู้ประมูล", href: "/admin/reputation", group: "ข้อมูลและตรวจสอบ" },
  { label: "ความสนใจลูกค้า", href: "/admin/interests", group: "ข้อมูลและตรวจสอบ" },
  { label: "รายงานยอดและออเดอร์", href: "/admin/reports", group: "ข้อมูลและตรวจสอบ" },
  { label: "ตรวจการกดประมูล", href: "/admin/security", group: "ข้อมูลและตรวจสอบ" },
  { label: "เหตุการณ์ระบบ", href: "/admin/audit", group: "ข้อมูลและตรวจสอบ" },
  { label: "ทีมแอดมิน", href: "/admin/team", group: "ตั้งค่าทีม" },
];

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const access = await requireRole("admin", "/admin");
  let notifications: MobileNotification[] = [];
  let pushDispatchEnabled = false;

  if (access.user) {
    const supabase = await createClient();
    const [notificationResult, pushResult] = await Promise.all([
      supabase
        .from("notifications")
        .select("id,notification_type,title,message,entity_type,entity_id,read_at,created_at")
        .eq("user_id", access.user.id)
        .order("created_at", { ascending: false })
        .limit(30),
      supabase.rpc("push_dispatch_is_enabled"),
    ]);
    if (notificationResult.error) console.error("Unable to load admin notifications", { code: notificationResult.error.code });
    notifications = (notificationResult.data ?? []) as MobileNotification[];
    pushDispatchEnabled = pushResult.data === true;
  }

  const notificationVersion = notifications.map((item) => `${item.id}:${item.read_at ?? "new"}`).join("|");
  return <>
    <PortalShell eyebrow="ADMIN CONTROL" title="ศูนย์ควบคุมแอดมิน" nav={nav} accent="admin">{children}</PortalShell>
    {access.user && <MobileNotificationCenter initialNotifications={notifications} key={notificationVersion} pushDispatchEnabled={pushDispatchEnabled} userId={access.user.id} vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""} />}
  </>;
}
