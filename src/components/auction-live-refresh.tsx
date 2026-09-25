"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { subscribeToAuction } from "@/lib/supabase/realtime";
import { useDatabaseClock } from "@/components/database-clock-provider";

export function AuctionLiveRefresh({ auctionId, auctionStatus, startsAt, endsAt }: { auctionId: string; auctionStatus: "scheduled" | "live" | "ended" | "settled"; startsAt: string; endsAt: string }) {
  const router = useRouter();
  const { databaseNow } = useDatabaseClock();
  const [status, setStatus] = useState(auctionStatus === "scheduled" ? "รอเวลาเปิดประมูล" : auctionStatus === "live" ? "กำลังเชื่อม Realtime" : "ปิดประมูลแล้ว");

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
    const channel = subscribeToAuction(auctionId, () => {
      setStatus("ได้รับราคาใหม่แล้ว");
      router.refresh();
    });
    channel.on("system", {}, () => setStatus(auctionStatus === "scheduled" ? "รอเวลาเปิดประมูล" : auctionStatus === "live" ? "เชื่อม Realtime แล้ว" : "ปิดประมูลแล้ว"));
    return () => { void channel.unsubscribe(); };
  }, [auctionId, auctionStatus, router]);

  return <span className="realtime-status"><i />{status}</span>;
}
