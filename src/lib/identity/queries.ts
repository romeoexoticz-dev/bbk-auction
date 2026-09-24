import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export type BidderVerificationStatus =
  | "unverified"
  | "pending_review"
  | "approved"
  | "rejected"
  | "suspended";

export type BidderVerification = {
  status: BidderVerificationStatus;
  reviewReason: string | null;
};

export async function getCurrentBidderVerification(): Promise<BidderVerification | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return null;

  const { data, error } = await supabase
    .from("bidder_verifications")
    .select("status,review_reason")
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (error || !data) {
    return {
      status: "unverified",
      reviewReason: null,
    };
  }

  return {
    status: data.status as BidderVerificationStatus,
    reviewReason: data.review_reason,
  };
}
