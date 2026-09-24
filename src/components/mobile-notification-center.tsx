"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { disablePushSubscriptionAction, markAllNotificationsReadAction, markNotificationReadAction, savePushSubscriptionAction } from "@/app/(customer)/notifications/actions";
import { subscribeToNotifications, type RealtimeChangeEvent } from "@/lib/supabase/realtime";

export type MobileNotification = {
  id: number;
  notification_type: string;
  title: string;
  message: string;
  entity_type: string | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
};

function dateTime(value: string) {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(new Date(value));
}

function notificationHref(item: MobileNotification) {
  if (item.entity_type === "admin_interest") return "/admin#interests";
  if (item.entity_type === "order" && item.entity_id) return `/orders/${item.entity_id}`;
  if (item.entity_type === "auction" && item.entity_id) return `/auctions/${item.entity_id}`;
  return "/account";
}

function isNotification(value: Record<string, unknown> | null): value is Record<string, unknown> & MobileNotification {
  return Boolean(value && typeof value.id === "number" && typeof value.title === "string" && typeof value.message === "string");
}

function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replaceAll("-", "+").replaceAll("_", "/");
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
}

type PushState = "checking" | "unsupported" | "unavailable" | "prompt" | "active" | "denied" | "error";

export function MobileNotificationCenter({ userId, initialNotifications, pushDispatchEnabled, vapidPublicKey }: { userId: string; initialNotifications: MobileNotification[]; pushDispatchEnabled: boolean; vapidPublicKey: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(initialNotifications);
  const [liveMessage, setLiveMessage] = useState("");
  const [pushState, setPushState] = useState<PushState>(
    pushDispatchEnabled && vapidPublicKey ? "checking" : "unavailable",
  );
  const [pushWorking, setPushWorking] = useState(false);
  const [isPending, startTransition] = useTransition();
  const unreadCount = useMemo(() => items.filter((item) => !item.read_at).length, [items]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(async () => {
      if (!pushDispatchEnabled || !vapidPublicKey) {
        if (active) setPushState("unavailable");
        return;
      }
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        if (active) setPushState("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        if (active) setPushState("denied");
        return;
      }
      try {
        const registration = await navigator.serviceWorker.register("/sw.js");
        const subscription = await registration.pushManager.getSubscription();
        if (active) setPushState(subscription ? "active" : "prompt");
      } catch {
        if (active) setPushState("error");
      }
    });
    return () => { active = false; };
  }, [pushDispatchEnabled, vapidPublicKey]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    const channel = subscribeToNotifications(userId, (event: RealtimeChangeEvent) => {
      if (isNotification(event.record)) {
        const incoming = event.record as MobileNotification;
        setItems((current) => {
          const withoutIncoming = current.filter((item) => item.id !== incoming.id);
          return [incoming, ...withoutIncoming].slice(0, 30);
        });
        if (event.event === "INSERT") setLiveMessage(`มีแจ้งเตือนใหม่: ${incoming.title}`);
      } else {
        router.refresh();
      }
    });
    return () => { void channel.unsubscribe(); };
  }, [router, userId]);

  function openNotification(item: MobileNotification) {
    const href = notificationHref(item);
    if (!item.read_at) {
      const readAt = new Date().toISOString();
      setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, read_at: readAt } : entry));
      startTransition(async () => {
        const result = await markNotificationReadAction(item.id);
        if (!result.ok) router.refresh();
      });
    }
    setOpen(false);
    router.push(href);
  }

  function markAllRead() {
    const readAt = new Date().toISOString();
    setItems((current) => current.map((item) => ({ ...item, read_at: item.read_at ?? readAt })));
    startTransition(async () => {
      const result = await markAllNotificationsReadAction();
      if (!result.ok) router.refresh();
    });
  }

  async function enablePush() {
    if (pushWorking || !pushDispatchEnabled || !vapidPublicKey) return;
    setPushWorking(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setPushState(permission === "denied" ? "denied" : "prompt");
        return;
      }
      const registration = await navigator.serviceWorker.register("/sw.js");
      const existing = await registration.pushManager.getSubscription();
      const subscription = existing ?? await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey).buffer as ArrayBuffer,
      });
      const serialized = subscription.toJSON();
      if (!serialized.endpoint || !serialized.keys?.p256dh || !serialized.keys.auth) throw new Error("PUSH_SUBSCRIPTION_INCOMPLETE");
      const result = await savePushSubscriptionAction({
        endpoint: serialized.endpoint,
        keys: { p256dh: serialized.keys.p256dh, auth: serialized.keys.auth },
      }, navigator.userAgent);
      if (!result.ok) {
        await subscription.unsubscribe();
        throw new Error("PUSH_SUBSCRIPTION_SAVE_FAILED");
      }
      setPushState("active");
      setLiveMessage("เปิดแจ้งเตือนบนมือถือแล้ว");
    } catch {
      setPushState("error");
    } finally {
      setPushWorking(false);
    }
  }

  async function disablePush() {
    if (pushWorking || !("serviceWorker" in navigator)) return;
    setPushWorking(true);
    try {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        const result = await disablePushSubscriptionAction(subscription.endpoint);
        if (!result.ok) throw new Error("PUSH_SUBSCRIPTION_DISABLE_FAILED");
        await subscription.unsubscribe();
      }
      setPushState("prompt");
      setLiveMessage("ปิดแจ้งเตือนบนมือถือแล้ว");
    } catch {
      setPushState("error");
    } finally {
      setPushWorking(false);
    }
  }

  return (
    <div className={`mobile-notifications ${open ? "open" : ""}`}>
      <span aria-live="polite" className="sr-only">{liveMessage}</span>
      <button aria-controls="mobile-notification-drawer" aria-expanded={open} aria-label={`การแจ้งเตือน${unreadCount > 0 ? ` มี ${unreadCount} รายการใหม่` : ""}`} className="notification-fab" onClick={() => setOpen(true)} type="button">
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>
        {unreadCount > 0 && <span>{unreadCount > 99 ? "99+" : unreadCount}</span>}
      </button>
      {open && <><button aria-label="ปิดการแจ้งเตือน" className="notification-backdrop" onClick={() => setOpen(false)} type="button" />
      <aside aria-label="ศูนย์แจ้งเตือน" aria-modal="true" className="notification-drawer" id="mobile-notification-drawer" role="dialog">
        <header>
          <div><small>BBK AUCTION</small><h2>การแจ้งเตือน</h2><p>{unreadCount > 0 ? `${unreadCount} รายการใหม่` : "อ่านครบแล้ว"}</p></div>
          <button aria-label="ปิด" onClick={() => setOpen(false)} type="button">×</button>
        </header>
        <section className={`push-opt-in ${pushState}`}>
          <div><strong>แจ้งเตือนบนหน้าจอมือถือ</strong><p>{pushState === "active" ? "เปิดแล้ว · รับการแจ้งเตือนแม้สลับแอปหรือปิดหน้าเว็บ" : pushState === "denied" ? "เบราว์เซอร์ปิดกั้น กรุณาเปิดสิทธิ์การแจ้งเตือนในการตั้งค่ามือถือ" : pushState === "unsupported" ? "เบราว์เซอร์นี้ยังไม่รองรับ Web Push" : pushState === "unavailable" ? "เตรียมระบบแล้ว · รอเชื่อมโดเมนเว็บไซต์จริงก่อนเปิดใช้" : pushState === "error" ? "เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่" : "กดเปิดและอนุญาตบนอุปกรณ์นี้"}</p></div>
          {pushState === "active" ? <button disabled={pushWorking} onClick={disablePush} type="button">ปิด</button> : pushState === "prompt" || pushState === "error" ? <button disabled={pushWorking} onClick={enablePush} type="button">{pushWorking ? "กำลังเปิด…" : "เปิดแจ้งเตือน"}</button> : null}
        </section>
        {unreadCount > 0 && <button className="notification-read-all" disabled={isPending} onClick={markAllRead} type="button">ทำเครื่องหมายว่าอ่านทั้งหมด</button>}
        <div className="notification-scroll">
          {items.length > 0 ? items.map((item) => <button className={`notification-card ${item.read_at ? "read" : "unread"}`} key={item.id} onClick={() => openNotification(item)} type="button">
            <span className="notification-state" />
            <span><small>{dateTime(item.created_at)}</small><strong>{item.title}</strong><p>{item.message}</p><em>แตะเพื่อดูรายละเอียด →</em></span>
          </button>) : <div className="notification-empty"><strong>ยังไม่มีการแจ้งเตือน</strong><p>เมื่อมีราคาใหม่ ใกล้หมดเวลา ผลประมูล หรือสถานะ Order ระบบจะแจ้งที่นี่</p></div>}
        </div>
        <a className="notification-account-link" href="/account">ดูบัญชีและประวัติทั้งหมด</a>
      </aside></>}
    </div>
  );
}
