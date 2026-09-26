"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  subscribeToAuction,
  type RealtimeChangeEvent,
  type RealtimeSubscriptionStatus,
} from "@/lib/supabase/realtime";
import { useDatabaseClock } from "@/components/database-clock-provider";

type ConnectionTone = "connecting" | "online" | "offline" | "degraded";

type ConnectionState = {
  label: string;
  tone: ConnectionTone;
};

const LIVE_CONNECTING: ConnectionState = {
  label: "กำลังเชื่อม Realtime",
  tone: "connecting",
};

function initialConnectionState(auctionStatus: "scheduled" | "live" | "ended" | "settled"): ConnectionState {
  if (auctionStatus === "scheduled") return { label: "รอเวลาเปิดประมูล", tone: "connecting" };
  if (auctionStatus === "live") return LIVE_CONNECTING;
  return { label: "ปิดประมูลแล้ว", tone: "offline" };
}

export function AuctionLiveRefresh({ auctionId, auctionStatus, startsAt, endsAt, version }: { auctionId: string; auctionStatus: "scheduled" | "live" | "ended" | "settled"; startsAt: string; endsAt: string; version: number }) {
  const router = useRouter();
  const { databaseNow } = useDatabaseClock();
  const [connection, setConnection] = useState<ConnectionState>(() => initialConnectionState(auctionStatus));
  const versionRef = useRef(version);

  useEffect(() => {
    versionRef.current = version;
  }, [version]);

  useEffect(() => {
    if (auctionStatus !== "scheduled") return;
    const delay = Math.max(0, new Date(startsAt).getTime() - databaseNow()) + 750;
    const timer = window.setTimeout(() => router.refresh(), Math.min(delay, 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [auctionStatus, databaseNow, router, startsAt]);

  useEffect(() => {
    if (auctionStatus !== "live") return;
    const delay = Math.max(0, new Date(endsAt).getTime() - databaseNow()) + 750;
    const timer = window.setTimeout(() => router.refresh(), Math.min(delay, 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [auctionStatus, databaseNow, endsAt, router]);

  useEffect(() => {
    if (auctionStatus === "ended" || auctionStatus === "settled") return;

    let disposed = false;
    let refreshTimer: number | undefined;
    let reconnectTimer: number | undefined;
    let connectionWatchdog: number | undefined;
    let realtimeHealthy = false;
    let lastRefreshAt = 0;
    let connectionGeneration = 0;
    let reconnectAttempt = 0;
    let channel: Awaited<ReturnType<typeof subscribeToAuction>> | null = null;

    const refreshAuthoritativeState = (delay = 0) => {
      if (disposed || !navigator.onLine) return;
      window.clearTimeout(refreshTimer);
      const minimumDelay = Math.max(0, 900 - (Date.now() - lastRefreshAt));
      refreshTimer = window.setTimeout(() => {
        if (disposed || !navigator.onLine) return;
        lastRefreshAt = Date.now();
        router.refresh();
      }, Math.max(delay, minimumDelay));
    };

    const handleCommittedChange = (event: RealtimeChangeEvent) => {
      const eventVersion = Number(event.record?.version);
      if (Number.isFinite(eventVersion)) {
        if (eventVersion <= versionRef.current) return;
        versionRef.current = eventVersion;
      }
      setConnection({ label: "ได้รับราคาใหม่ · กำลังตรวจฐานข้อมูล", tone: "online" });
      refreshAuthoritativeState(120);
    };

    const scheduleReconnect = () => {
      if (disposed || !navigator.onLine) return;
      window.clearTimeout(reconnectTimer);
      const delay = Math.min(10_000, 1_500 * 2 ** Math.min(reconnectAttempt, 3));
      reconnectAttempt += 1;
      reconnectTimer = window.setTimeout(() => void connectRealtime(), delay);
    };

    const connectRealtime = async () => {
      if (disposed || !navigator.onLine) return;
      const generation = ++connectionGeneration;
      const previousChannel = channel;
      channel = null;
      if (previousChannel) await previousChannel.unsubscribe();
      if (disposed || generation !== connectionGeneration || !navigator.onLine) return;

      window.clearTimeout(connectionWatchdog);
      connectionWatchdog = window.setTimeout(() => {
        if (disposed || generation !== connectionGeneration || realtimeHealthy || !navigator.onLine) return;
        setConnection({ label: "Realtime ขัดข้อง · ใช้ราคาจากฐานข้อมูล", tone: "degraded" });
        refreshAuthoritativeState();
        scheduleReconnect();
      }, 12_000);

      try {
        channel = await subscribeToAuction(
          auctionId,
          (event) => {
            if (!disposed && generation === connectionGeneration) handleCommittedChange(event);
          },
          (status: RealtimeSubscriptionStatus) => {
            if (disposed || generation !== connectionGeneration) return;
            if (status === "SUBSCRIBED") {
              realtimeHealthy = true;
              reconnectAttempt = 0;
              window.clearTimeout(connectionWatchdog);
              window.clearTimeout(reconnectTimer);
              setConnection(auctionStatus === "scheduled"
                ? { label: "Realtime พร้อม · รอเวลาเปิดประมูล", tone: "online" }
                : { label: "Realtime พร้อม · ราคาตรงกับฐานข้อมูล", tone: "online" });
              refreshAuthoritativeState();
              return;
            }

            realtimeHealthy = false;
            window.clearTimeout(connectionWatchdog);
            if (!navigator.onLine) {
              setConnection({ label: "ออฟไลน์ · จะอัปเดตเมื่ออินเทอร์เน็ตกลับมา", tone: "offline" });
            } else {
              setConnection({ label: "Realtime หลุด · กำลังเชื่อมใหม่", tone: "degraded" });
              refreshAuthoritativeState(500);
              scheduleReconnect();
            }
          },
        );
      } catch {
        if (disposed || generation !== connectionGeneration) return;
        realtimeHealthy = false;
        setConnection({ label: "Realtime ขัดข้อง · ใช้ราคาจากฐานข้อมูล", tone: "degraded" });
        refreshAuthoritativeState(500);
        scheduleReconnect();
      }
    };

    void connectRealtime();

    const handleOffline = () => {
      connectionGeneration += 1;
      realtimeHealthy = false;
      window.clearTimeout(refreshTimer);
      window.clearTimeout(reconnectTimer);
      window.clearTimeout(connectionWatchdog);
      const previousChannel = channel;
      channel = null;
      if (previousChannel) void previousChannel.unsubscribe();
      setConnection({ label: "ออฟไลน์ · จะอัปเดตเมื่ออินเทอร์เน็ตกลับมา", tone: "offline" });
    };
    const handleOnline = () => {
      setConnection(LIVE_CONNECTING);
      refreshAuthoritativeState();
      void connectRealtime();
    };
    const reconcileWhenVisible = () => {
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      if (!realtimeHealthy) {
        setConnection(LIVE_CONNECTING);
        void connectRealtime();
      }
      refreshAuthoritativeState();
    };

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    window.addEventListener("focus", reconcileWhenVisible);
    document.addEventListener("visibilitychange", reconcileWhenVisible);

    const degradedRefreshTimer = window.setInterval(() => {
      if (!realtimeHealthy && navigator.onLine && document.visibilityState === "visible") {
        refreshAuthoritativeState();
      }
    }, 30_000);

    return () => {
      disposed = true;
      connectionGeneration += 1;
      window.clearTimeout(refreshTimer);
      window.clearTimeout(reconnectTimer);
      window.clearTimeout(connectionWatchdog);
      window.clearInterval(degradedRefreshTimer);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("focus", reconcileWhenVisible);
      document.removeEventListener("visibilitychange", reconcileWhenVisible);
      if (channel) void channel.unsubscribe();
    };
  }, [auctionId, auctionStatus, router]);

  const displayedConnection = auctionStatus === "ended" || auctionStatus === "settled"
    ? initialConnectionState(auctionStatus)
    : connection;

  return <span aria-live="polite" className="realtime-status" data-state={displayedConnection.tone} role="status"><i />{displayedConnection.label}</span>;
}
