"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";

type ClockAnchor = {
  databaseMs: number;
  deviceWallMs: number;
  monotonicMs: number | null;
};

type DatabaseClockValue = {
  databaseNow: () => number;
  synced: boolean;
};

const DatabaseClockContext = createContext<DatabaseClockValue | null>(null);

function monotonicNow() {
  return typeof performance === "undefined" ? null : performance.now();
}

export function DatabaseClockProvider({
  children,
  initialDatabaseNow,
  initialClockSynced,
  syncEnabled,
}: {
  children: ReactNode;
  initialDatabaseNow: string;
  initialClockSynced: boolean;
  syncEnabled: boolean;
}) {
  const initialDatabaseMs = Date.parse(initialDatabaseNow);
  const [anchor, setAnchor] = useState<ClockAnchor>(() => ({
    databaseMs: Number.isFinite(initialDatabaseMs) ? initialDatabaseMs : Date.now(),
    deviceWallMs: Date.now(),
    monotonicMs: monotonicNow(),
  }));
  const [synced, setSynced] = useState(initialClockSynced && Number.isFinite(initialDatabaseMs));

  const databaseNow = useCallback(() => {
    const currentMonotonic = monotonicNow();
    if (currentMonotonic !== null && anchor.monotonicMs !== null) {
      return anchor.databaseMs + (currentMonotonic - anchor.monotonicMs);
    }
    return anchor.databaseMs + (Date.now() - anchor.deviceWallMs);
  }, [anchor]);

  const syncClock = useCallback(async () => {
    if (!syncEnabled) return;

    const wallStarted = Date.now();
    const monotonicStarted = monotonicNow();
    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_database_time");
    const wallFinished = Date.now();
    const monotonicFinished = monotonicNow();
    const databaseMs = typeof data === "string" ? Date.parse(data) : Number.NaN;

    if (error || !Number.isFinite(databaseMs)) {
      console.error("Unable to synchronize database clock", { code: error?.code });
      return;
    }

    setAnchor({
      databaseMs,
      deviceWallMs: (wallStarted + wallFinished) / 2,
      monotonicMs: monotonicStarted !== null && monotonicFinished !== null
        ? (monotonicStarted + monotonicFinished) / 2
        : null,
    });
    setSynced(true);
  }, [syncEnabled]);

  useEffect(() => {
    const initialSync = window.setTimeout(() => void syncClock(), 0);
    const interval = window.setInterval(() => void syncClock(), 30_000);
    const resyncWhenVisible = () => {
      if (document.visibilityState === "visible") void syncClock();
    };
    window.addEventListener("online", syncClock);
    document.addEventListener("visibilitychange", resyncWhenVisible);
    return () => {
      window.clearTimeout(initialSync);
      window.clearInterval(interval);
      window.removeEventListener("online", syncClock);
      document.removeEventListener("visibilitychange", resyncWhenVisible);
    };
  }, [syncClock]);

  const value = useMemo(() => ({ databaseNow, synced }), [databaseNow, synced]);
  return <DatabaseClockContext.Provider value={value}>{children}</DatabaseClockContext.Provider>;
}

export function useDatabaseClock() {
  const value = useContext(DatabaseClockContext);
  if (!value) throw new Error("useDatabaseClock must be used inside DatabaseClockProvider");
  return value;
}
