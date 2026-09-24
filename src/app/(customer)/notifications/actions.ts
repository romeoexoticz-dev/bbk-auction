"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function markNotificationReadAction(notificationId: number) {
  if (!Number.isSafeInteger(notificationId) || notificationId <= 0) {
    return { ok: false };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("mark_notification_read", {
    p_notification_id: notificationId,
  });

  if (error || data !== true) {
    console.error("Unable to mark notification as read", { code: error?.code });
    return { ok: false };
  }

  revalidatePath("/account");
  return { ok: true };
}

export async function markAllNotificationsReadAction() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("mark_all_notifications_read");

  if (error) {
    console.error("Unable to mark all notifications as read", { code: error.code });
    return { ok: false, count: 0 };
  }

  revalidatePath("/account");
  return { ok: true, count: Number(data ?? 0) };
}

type PushSubscriptionInput = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export async function savePushSubscriptionAction(subscription: PushSubscriptionInput, userAgent: string) {
  if (
    !subscription ||
    typeof subscription.endpoint !== "string" ||
    !subscription.endpoint.startsWith("https://") ||
    subscription.endpoint.length > 2048 ||
    typeof subscription.keys?.p256dh !== "string" ||
    typeof subscription.keys?.auth !== "string" ||
    typeof userAgent !== "string" ||
    userAgent.length > 500
  ) {
    return { ok: false };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("save_push_subscription", {
    p_endpoint: subscription.endpoint,
    p_p256dh: subscription.keys.p256dh,
    p_auth_key: subscription.keys.auth,
    p_user_agent: userAgent,
  });

  if (error) {
    console.error("Unable to save push subscription", { code: error.code });
    return { ok: false };
  }

  return { ok: true };
}

export async function disablePushSubscriptionAction(endpoint: string) {
  if (typeof endpoint !== "string" || !endpoint.startsWith("https://") || endpoint.length > 2048) {
    return { ok: false };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("disable_push_subscription", {
    p_endpoint: endpoint,
  });

  if (error || data !== true) {
    console.error("Unable to disable push subscription", { code: error?.code });
    return { ok: false };
  }

  return { ok: true };
}
