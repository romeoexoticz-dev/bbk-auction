"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const uuidPattern = /^[0-9a-f-]{36}$/i;

function bangkokDateTime(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}:00+07:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export async function createAuctionRound(formData: FormData) {
  const sellerId = formData.get("sellerId");
  const nameValue = formData.get("name");
  const descriptionValue = formData.get("description");
  const startsAt = bangkokDateTime(formData.get("startsAt"));
  const firstEndsAt = bangkokDateTime(formData.get("firstEndsAt"));
  const closeIntervalMinutes = Number(formData.get("closeIntervalMinutes"));
  const name = typeof nameValue === "string" ? nameValue.trim() : "";
  const description = typeof descriptionValue === "string" ? descriptionValue.trim() : "";

  if (typeof sellerId !== "string" || !uuidPattern.test(sellerId)) redirect("/admin/rounds?error=invalid-seller");
  if (name.length < 3 || name.length > 120) redirect("/admin/rounds?error=invalid-name");
  if (description.length > 1000) redirect("/admin/rounds?error=invalid-description");
  if (!startsAt || !firstEndsAt || new Date(firstEndsAt) <= new Date(startsAt)) redirect("/admin/rounds?error=invalid-window");
  if (!Number.isInteger(closeIntervalMinutes) || closeIntervalMinutes < 1 || closeIntervalMinutes > 1440) {
    redirect("/admin/rounds?error=invalid-interval");
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_create_auction_round", {
    p_seller_id: sellerId,
    p_name: name,
    p_description: description,
    p_starts_at: startsAt,
    p_first_ends_at: firstEndsAt,
    p_close_interval_seconds: closeIntervalMinutes * 60,
  });

  if (error) {
    console.error("Unable to create auction round", { code: error.code });
    redirect(`/admin/rounds?error=${error.message.includes("INVALID_ROUND_WINDOW") ? "invalid-window" : "create-failed"}`);
  }

  revalidatePath("/admin/rounds");
  redirect("/admin/rounds?status=created");
}

export async function assignAuctionsToRound(formData: FormData) {
  const roundId = formData.get("roundId");
  const auctionIds = formData.getAll("auctionIds").filter((value): value is string => typeof value === "string" && uuidPattern.test(value));

  if (typeof roundId !== "string" || !uuidPattern.test(roundId)) redirect("/admin/rounds?error=invalid-round");
  if (auctionIds.length < 1 || auctionIds.length > 100) redirect("/admin/rounds?error=select-items");

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_assign_auctions_to_round", {
    p_round_id: roundId,
    p_auction_ids: auctionIds,
  });

  if (error) {
    console.error("Unable to assign auctions to round", { code: error.code });
    const code = error.message.includes("ROUND_ITEM_NOT_ELIGIBLE") ? "item-ineligible" : "assign-failed";
    redirect(`/admin/rounds?error=${code}`);
  }

  revalidatePath("/admin/rounds");
  revalidatePath("/seller");
  redirect("/admin/rounds?status=assigned");
}

export async function publishAuctionRound(formData: FormData) {
  const roundId = formData.get("roundId");
  const reasonValue = formData.get("reason");
  const confirmation = formData.get("confirm");
  const reason = typeof reasonValue === "string" ? reasonValue.trim() : "";

  if (typeof roundId !== "string" || !uuidPattern.test(roundId)) redirect("/admin/rounds?error=invalid-round");
  if (reason.length < 5 || reason.length > 500) redirect("/admin/rounds?error=reason-required");
  if (confirmation !== "yes") redirect("/admin/rounds?error=confirmation-required");

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_publish_auction_round", {
    p_round_id: roundId,
    p_reason: reason,
  });

  if (error) {
    console.error("Unable to publish auction round", { code: error.code });
    const errorCode = error.message.includes("PRODUCT_TRUST_FIELDS_REQUIRED")
      ? "trust-fields"
      : error.message.includes("PRODUCT_TRUST_MEDIA_REQUIRED")
        ? "trust-media"
        : error.message.includes("ROUND_WINDOW_ENDED")
          ? "window-ended"
          : "publish-failed";
    redirect(`/admin/rounds?error=${errorCode}`);
  }

  revalidatePath("/");
  revalidatePath("/seller");
  revalidatePath("/admin");
  revalidatePath("/admin/rounds");
  redirect("/admin/rounds?status=published");
}
