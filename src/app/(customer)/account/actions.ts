"use server";

import { revalidatePath } from "next/cache";
import { AUCTION_CATEGORY_VALUES } from "@/lib/auctions/categories";
import { createClient } from "@/lib/supabase/server";

export type InterestState = { error?: string; success?: string };

export async function saveAuctionInterests(_previous: InterestState, formData: FormData): Promise<InterestState> {
  const categories = [...new Set(formData.getAll("categories").map(String))];
  if (categories.length > 5 || categories.some((category) => !AUCTION_CATEGORY_VALUES.has(category))) {
    return { error: "หมวดหมู่ไม่ถูกต้อง กรุณาเลือกใหม่" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_my_auction_interests", {
    p_categories: categories,
  });

  if (error) {
    console.error("Unable to save auction interests", { code: error.code });
    return { error: "บันทึกไม่สำเร็จ กรุณาลองใหม่" };
  }

  revalidatePath("/account");
  return {
    success: Number(data ?? 0) > 0
      ? `บันทึกแล้ว ${Number(data)} หมวด ระบบจะแจ้งเมื่อมีรายการใหม่ที่ตรงกัน`
      : "บันทึกแล้ว คุณปิดการแจ้งเตือนตามความสนใจทั้งหมด",
  };
}
