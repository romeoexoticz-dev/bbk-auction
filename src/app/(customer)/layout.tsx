import type { ReactNode } from "react";
import { CustomerMobileNav } from "@/components/customer-mobile-nav";
import { MobileNotificationCenter, type MobileNotification } from "@/components/mobile-notification-center";
import { getCurrentUser } from "@/lib/auth/authorization";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function CustomerLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  let notifications: MobileNotification[] = [];
  let pushDispatchEnabled = false;

  if (user) {
    const supabase = await createClient();
    const [notificationResult, pushResult] = await Promise.all([
      supabase
        .from("notifications")
        .select("id,notification_type,title,message,entity_type,entity_id,read_at,created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(30),
      supabase.rpc("push_dispatch_is_enabled"),
    ]);
    if (notificationResult.error) console.error("Unable to load mobile notifications", { code: notificationResult.error.code });
    notifications = (notificationResult.data ?? []) as MobileNotification[];
    pushDispatchEnabled = pushResult.data === true;
  }

  const notificationVersion = notifications.map((item) => `${item.id}:${item.read_at ?? "new"}`).join("|");
  return <><div className="customer-mobile-shell">{children}</div><CustomerMobileNav signedIn={Boolean(user)} />{user && <MobileNotificationCenter initialNotifications={notifications} key={notificationVersion} pushDispatchEnabled={pushDispatchEnabled} userId={user.id} vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""} />}</>;
}
