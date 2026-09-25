"use client";

import { useEffect, useState } from "react";
import { useDatabaseClock } from "@/components/database-clock-provider";

function remaining(endsAt: string, databaseNow: number) {
  const seconds = Math.max(0, Math.ceil((new Date(endsAt).getTime() - databaseNow) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return seconds === 0 ? "ปิดรับประมูล" : [hours, minutes, secs].map((part) => String(part).padStart(2, "0")).join(":");
}

export function AuctionCountdown({ endsAt }: { endsAt: string }) {
  const { databaseNow, synced } = useDatabaseClock();
  const [label, setLabel] = useState(() => remaining(endsAt, databaseNow()));
  useEffect(() => {
    const update = () => setLabel(remaining(endsAt, databaseNow()));
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [databaseNow, endsAt]);
  return <span data-clock-source={synced ? "database" : "fallback"}>{label}</span>;
}
