import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

export type RealtimeChangeEvent = {
  event: string;
  type: string;
  table: string;
  schema: string;
  record: Record<string, unknown> | null;
  old_record: Record<string, unknown> | null;
};

export type RealtimeSubscriptionStatus =
  | "SUBSCRIBED"
  | "TIMED_OUT"
  | "CLOSED"
  | "CHANNEL_ERROR";

export type RealtimeStatusHandler = (
  status: RealtimeSubscriptionStatus,
  error?: Error,
) => void;

export function subscribeToAuction(
  auctionId: string,
  onCommittedChange: (event: RealtimeChangeEvent) => void,
  onStatus?: RealtimeStatusHandler,
): RealtimeChannel {
  const supabase = createClient();

  return supabase
    .channel(`auction:${auctionId}`, { config: { private: true } })
    .on("broadcast", { event: "*" }, ({ payload }) => {
      onCommittedChange(payload as RealtimeChangeEvent);
    })
    .subscribe((status, error) => {
      onStatus?.(status, error);
    });
}

export function subscribeToNotifications(
  userId: string,
  onCommittedChange: (event: RealtimeChangeEvent) => void,
  onStatus?: RealtimeStatusHandler,
): RealtimeChannel {
  const supabase = createClient();

  return supabase
    .channel(`notifications:${userId}`, { config: { private: true } })
    .on("broadcast", { event: "*" }, ({ payload }) => {
      onCommittedChange(payload as RealtimeChangeEvent);
    })
    .subscribe((status, error) => {
      onStatus?.(status, error);
    });
}
