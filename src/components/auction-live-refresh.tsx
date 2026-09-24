"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { subscribeToAuction } from "@/lib/supabase/realtime";

export function AuctionLiveRefresh({ auctionId, auctionStatus, startsAt, endsAt }: { auctionId: string; auctionStatus: "scheduled" | "live" | "ended" | "settled"; startsAt: string; endsAt: string }) {
  const router = useRouter();
  const [status, setStatus] = useState(auctionStatus === "scheduled" ? "รอเวลาเปิดประมูล" : auctionStatus === "live" ? "กำลังเชื่อม Realtime" : "ปิดประมูลแล้ว");

  useEffect(() => {
    if (auctionStatus !== "scheduled") return;
    const delay = Math.max(0, new Date(startsAt).getTime() - Date.now()) + 750;
    const timer = window.setTimeout(() => router.refresh(), Math.min(delay, 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [auctionStatus, router, startsAt]);

  useEffect(() => {
    if (auctionStatus !== "live") return;
    const delay = Math.max(0, new Date(endsAt).getTime() - Date.now()) + 750;
    const timer = window.setTimeout(() => router.refresh(), Math.min(delay, 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [auctionStatus, endsAt, router]);

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
