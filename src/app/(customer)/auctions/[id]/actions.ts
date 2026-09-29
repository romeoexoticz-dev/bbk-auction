"use server";

import { revalidatePath } from "next/cache";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export type BidActionState = { ok?: boolean; message?: string };

type BidRpcResult = {
  ok?: boolean;
  code?: string;
  retry_after_seconds?: number;
};

function bahtToSatang(value: string) {
  const normalized = value.trim().replace(/,/g, "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [baht, fraction = ""] = normalized.split(".");
  const satang = BigInt(baht) * BigInt(100) + BigInt((fraction + "00").slice(0, 2));
  return satang > BigInt(0) && satang <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(satang) : null;
}

function friendlyBidError(code: string, retryAfterSeconds?: number) {
  if (code.includes("AUTH_REQUIRED")) return "กรุณาเข้าสู่ระบบก่อนวางประมูล";
  if (code.includes("VERIFIED_ACTIVE_ACCOUNT_REQUIRED")) return "บัญชีต้องยืนยันอีเมลและอยู่ในสถานะใช้งาน";
  if (code.includes("BIDDER_VERIFICATION_REQUIRED") || code.includes("BIDDER_NOT_ELIGIBLE")) return "ต้องยืนยันอีเมลและให้แอดมินอนุมัติก่อนวางประมูล";
  if (code.includes("SELF_BIDDING_FORBIDDEN")) return "ผู้ขายวางประมูลรายการของตนเองไม่ได้";
  if (code.includes("AUCTION_NOT_LIVE") || code.includes("OUTSIDE_BIDDING_WINDOW")) return "รายการนี้ไม่ได้อยู่ในช่วงรับประมูลแล้ว";
  if (code.includes("BID_BELOW_MINIMUM")) return "ราคาต่ำกว่าขั้นต่ำล่าสุด กรุณาโหลดข้อมูลใหม่";
  if (code.includes("ALREADY_HIGHEST_BIDDER")) return "คุณเป็นผู้เสนอราคาสูงสุดอยู่แล้ว กรุณารอให้มีผู้อื่นเสนอราคาสูงกว่าก่อน";
  if (code.includes("IDEMPOTENCY_KEY_REUSED")) return "คำขอนี้ถูกใช้แล้ว กรุณาโหลดหน้าใหม่";
  if (code.includes("BID_RATE_LIMIT_SHORT")) return `กดเร็วเกินไป กรุณารอ ${Math.max(1, retryAfterSeconds ?? 2)} วินาทีแล้วลองใหม่`;
  if (code.includes("BID_RATE_LIMIT_MINUTE")) return `กดครบ 10 ครั้งต่อนาทีแล้ว กรุณารอ ${Math.max(1, retryAfterSeconds ?? 60)} วินาที`;
  if (code.includes("INVALID_BID_REQUEST")) return "ข้อมูลราคาประมูลไม่ถูกต้อง กรุณาโหลดหน้าใหม่";
  return "วางประมูลไม่สำเร็จ กรุณาลองใหม่หลังตรวจราคาล่าสุด";
}

export async function placeBid(
  _state: BidActionState,
  formData: FormData,
): Promise<BidActionState> {
  if (!isSupabaseConfigured()) return { message: "โหมดตัวอย่างยังไม่รับ bid จริง" };

  const auctionId = formData.get("auctionId");
  const requestKey = formData.get("requestKey");
  const amountValue = formData.get("amount");
  if (typeof auctionId !== "string" || typeof requestKey !== "string" || typeof amountValue !== "string") {
    return { message: "ข้อมูลคำขอไม่ครบ" };
  }

  const amount = bahtToSatang(amountValue);
  if (amount === null) return { message: "กรุณากรอกราคาเป็นตัวเลขไม่เกิน 2 ตำแหน่งทศนิยม" };

  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return { message: "กรุณาเข้าสู่ระบบก่อนวางประมูล" };
  if (!userData.user.email_confirmed_at) {
    return { message: "กรุณากดลิงก์ยืนยันอีเมลก่อนวางประมูล" };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("account_status,email_verified")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (profileError || !profile) {
    return { message: "ยังตรวจสอบสถานะบัญชีไม่ได้ กรุณาเข้าสู่ระบบใหม่" };
  }
  if (profile.account_status !== "active") {
    return { message: "บัญชีนี้ไม่ได้อยู่ในสถานะใช้งาน กรุณาติดต่อแอดมิน" };
  }
  if (!profile.email_verified) {
    return { message: "กำลังอัปเดตสถานะยืนยันอีเมล กรุณาเข้าสู่ระบบใหม่" };
  }

  const { data: verification } = await supabase
    .from("bidder_verifications")
    .select("status")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (verification?.status !== "approved") {
    return { message: "ต้องยืนยันอีเมลและให้แอดมินอนุมัติก่อนวางประมูล" };
  }

  let { data, error } = await supabase.rpc("submit_bid", {
    p_auction_id: auctionId,
    p_amount: amount,
    p_request_key: requestKey,
  });

  // Keep the current database usable until migration 026 is installed.
  if (error?.code === "PGRST202") {
    const legacyResult = await supabase.rpc("place_bid", {
      p_auction_id: auctionId,
      p_amount: amount,
      p_request_key: requestKey,
    });
    data = legacyResult.data;
    error = legacyResult.error;
    if (!error) {
      revalidatePath(`/auctions/${auctionId}`);
      revalidatePath("/");
      return { ok: true, message: "ระบบยืนยัน bid จากฐานข้อมูลแล้ว" };
    }
  }
  if (error) return { message: friendlyBidError(error.message) };

  const result = data as BidRpcResult | null;
  if (!result?.ok) {
    return { message: friendlyBidError(result?.code ?? "UNKNOWN", result?.retry_after_seconds) };
  }

  revalidatePath(`/auctions/${auctionId}`);
  revalidatePath("/");
  return { ok: true, message: "ระบบยืนยัน bid จากฐานข้อมูลแล้ว" };
}
