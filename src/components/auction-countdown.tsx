"use client";

import { useEffect, useState } from "react";
import { useDatabaseClock } from "@/components/database-clock-provider";

function remaining(endsAt: string, databaseNow: number) {
  const seconds = Math.max(0, Math.ceil((new Date(endsAt).getTime() - databaseNow) / 1000));
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (seconds === 0) return "ปิดรับประมูล";
  if (days > 0) return `${days} วัน ${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  return [hours, minutes, secs].map((part) => String(part).padStart(2, "0")).join(":");
}

export function AuctionCountdown({ endsAt }: { endsAt: string }) {
  const { databaseNow, synced } = useDatabaseClock();
  // Keep the server and first client render identical. The authoritative
  // database-clock value is applied immediately after hydration.
  const [label, setLabel] = useState("--:--:--");
  useEffect(() => {
    const update = () => setLabel(remaining(endsAt, databaseNow()));
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [databaseNow, endsAt]);
  return <span data-clock-source={synced ? "database" : "fallback"}>{label}</span>;
}
