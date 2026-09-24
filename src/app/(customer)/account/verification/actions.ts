"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function submitBidderApprovalRequest() {
  const supabase = await createClient();
  const { data, error: userError } = await supabase.auth.getUser();

  if (userError || !data.user) {
    redirect("/auth/sign-in?next=/account/verification");
  }
  if (!data.user.email_confirmed_at) {
    redirect("/account/verification?error=email-not-confirmed");
  }

  const { error } = await supabase.rpc("submit_bidder_approval_request");
  if (error) {
    console.error("Unable to submit bidder approval request", { code: error.code });
    const code = error.message.includes("BIDDER_SUSPENDED")
      ? "suspended"
      : error.message.includes("VERIFIED_ACTIVE_ACCOUNT_REQUIRED")
        ? "account-not-ready"
        : "request-failed";
    redirect(`/account/verification?error=${code}`);
  }

  revalidatePath("/account/verification");
  revalidatePath("/admin");
  redirect("/account/verification?status=submitted");
}
