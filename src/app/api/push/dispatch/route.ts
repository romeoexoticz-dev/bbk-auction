import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

export const runtime = "nodejs";

type ClaimedDelivery = {
  delivery_id: number;
  endpoint: string;
  p256dh: string;
  auth_key: string;
  notification_title: string;
  notification_message: string;
  entity_type: string | null;
  entity_id: string | null;
  notification_id: number;
};

function sameSecret(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function destination(delivery: ClaimedDelivery) {
  if (delivery.entity_type === "order" && delivery.entity_id) return `/orders/${delivery.entity_id}`;
  if (delivery.entity_type === "auction" && delivery.entity_id) return `/auctions/${delivery.entity_id}`;
  return "/account";
}

function statusCode(error: unknown) {
  if (typeof error === "object" && error !== null && "statusCode" in error) {
    const value = Number((error as { statusCode?: unknown }).statusCode);
    if (Number.isInteger(value)) return value;
  }
  return null;
}

function safeError(error: unknown) {
  if (error instanceof Error) return error.message.slice(0, 300);
  return "WEB_PUSH_DELIVERY_FAILED";
}

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const workerSecret = process.env.PUSH_DISPATCH_SECRET;
  const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
  const vapidSubject = process.env.VAPID_SUBJECT;

  if (!supabaseUrl || !publishableKey || !workerSecret || !vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
    return Response.json({ ok: false, error: "PUSH_NOT_CONFIGURED" }, { status: 503 });
  }

  const authorization = request.headers.get("authorization") ?? "";
  if (!sameSecret(authorization, `Bearer ${workerSecret}`)) {
    return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  }

  let notificationId: number | null = null;
  try {
    const body = await request.json() as { notificationId?: unknown };
    if (body.notificationId !== undefined && body.notificationId !== null) {
      const parsed = Number(body.notificationId);
      if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        return Response.json({ ok: false, error: "INVALID_NOTIFICATION_ID" }, { status: 400 });
      }
      notificationId = parsed;
    }
  } catch {
    return Response.json({ ok: false, error: "INVALID_JSON" }, { status: 400 });
  }

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  const supabase = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.rpc("claim_push_deliveries", {
    p_worker_token: workerSecret,
    p_notification_id: notificationId,
    p_limit: 50,
  });

  if (error) {
    console.error("Unable to claim push deliveries", { code: error.code });
    return Response.json({ ok: false, error: "CLAIM_FAILED" }, { status: 500 });
  }

  const deliveries = (data ?? []) as ClaimedDelivery[];
  let sent = 0;
  let failed = 0;

  for (const delivery of deliveries) {
    try {
      await webpush.sendNotification(
        {
          endpoint: delivery.endpoint,
          keys: { p256dh: delivery.p256dh, auth: delivery.auth_key },
        },
        JSON.stringify({
          title: delivery.notification_title,
          body: delivery.notification_message,
          url: destination(delivery),
          tag: `bbk-notification-${delivery.notification_id}`,
        }),
        { TTL: 3600, urgency: "high" },
      );
      sent += 1;
      const { error: completeError } = await supabase.rpc("complete_push_delivery", {
        p_worker_token: workerSecret,
        p_delivery_id: delivery.delivery_id,
        p_success: true,
        p_status_code: 201,
        p_error: null,
      });
      if (completeError) console.error("Unable to complete successful push delivery", { code: completeError.code });
    } catch (deliveryError) {
      failed += 1;
      const { error: completeError } = await supabase.rpc("complete_push_delivery", {
        p_worker_token: workerSecret,
        p_delivery_id: delivery.delivery_id,
        p_success: false,
        p_status_code: statusCode(deliveryError),
        p_error: safeError(deliveryError),
      });
      if (completeError) console.error("Unable to complete failed push delivery", { code: completeError.code });
    }
  }

  return Response.json({ ok: true, claimed: deliveries.length, sent, failed });
}
