"use client";

import { useEffect, useState } from "react";
import { useDatabaseClock } from "@/components/database-clock-provider";

type CountdownParts = {
  closed: boolean;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
};

function remaining(endsAt: string, databaseNow: number): CountdownParts {
  const seconds = Math.max(0, Math.ceil((new Date(endsAt).getTime() - databaseNow) / 1000));
  return {
    closed: seconds === 0,
    days: Math.floor(seconds / 86_400),
    hours: Math.floor((seconds % 86_400) / 3_600),
    minutes: Math.floor((seconds % 3_600) / 60),
    seconds: seconds % 60,
  };
}

const units: Array<{ key: Exclude<keyof CountdownParts, "closed">; label: string }> = [
  { key: "days", label: "วัน" },
  { key: "hours", label: "ชั่วโมง" },
  { key: "minutes", label: "นาที" },
  { key: "seconds", label: "วินาที" },
];

export function AuctionCountdown({ endsAt }: { endsAt: string }) {
  const { databaseNow, synced } = useDatabaseClock();
  // Keep the server and first client render identical. The authoritative
  // database-clock value is applied immediately after hydration.
  const [parts, setParts] = useState<CountdownParts | null>(null);
  useEffect(() => {
    const update = () => setParts(remaining(endsAt, databaseNow()));
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [databaseNow, endsAt]);

  const ariaLabel = parts?.closed
    ? "ปิดรับประมูล"
    : parts
      ? `เหลือ ${parts.days} วัน ${parts.hours} ชั่วโมง ${parts.minutes} นาที ${parts.seconds} วินาที`
      : "กำลังโหลดเวลาประมูล";

  return (
    <span
      aria-label={ariaLabel}
      className={`auction-countdown${parts?.closed ? " is-closed" : ""}`}
      data-clock-source={synced ? "database" : "fallback"}
    >
      {parts?.closed ? (
        <span className="auction-countdown-closed">ปิดรับประมูล</span>
      ) : (
        units.map(({ key, label }) => (
          <span className="auction-countdown-part" key={key}>
            <b>{parts ? String(parts[key]).padStart(2, "0") : "--"}</b>
            <small>{label}</small>
          </span>
        ))
      )}
    </span>
  );
}
