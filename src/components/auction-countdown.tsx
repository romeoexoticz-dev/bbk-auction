"use client";

import { useEffect, useState } from "react";

function remaining(endsAt: string) {
  const seconds = Math.max(0, Math.floor((new Date(endsAt).getTime() - Date.now()) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return seconds === 0 ? "ปิดรับประมูล" : [hours, minutes, secs].map((part) => String(part).padStart(2, "0")).join(":");
}

export function AuctionCountdown({ endsAt }: { endsAt: string }) {
  const [label, setLabel] = useState(() => remaining(endsAt));
  useEffect(() => {
    const timer = window.setInterval(() => setLabel(remaining(endsAt)), 1000);
    return () => window.clearInterval(timer);
  }, [endsAt]);
  return <span>{label}</span>;
}
