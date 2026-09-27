"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function bahtToSatang(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !/^\d{1,12}(?:\.\d{1,2})?$/.test(value)) return null;
  const [baht, fraction = ""] = value.split(".");
  const satang = Number(baht) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(satang) && satang >= 0 ? satang : null;
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function grantAdministratorRole(formData: FormData) {
  const emailValue = formData.get("email");
  const passwordValue = formData.get("currentPassword");
  const reasonValue = formData.get("reason");
  const requestKey = formData.get("requestKey");
  const confirmation = formData.get("confirmAdminAccess");
  const email = typeof emailValue === "string" ? emailValue.trim().toLowerCase() : "";
  const password = typeof passwordValue === "string" ? passwordValue : "";
  const reason = typeof reasonValue === "string" ? reasonValue.trim() : "";

  if (!emailPattern.test(email) || email.length > 320) {
    redirect("/admin/team?adminRoleError=invalid-email");
  }
  if (password.length < 1 || password.length > 1024) {
    redirect("/admin/team?adminRoleError=password-required");
  }
  if (reason.length < 5 || reason.length > 500) {
    redirect("/admin/team?adminRoleError=reason-required");
  }
  if (typeof requestKey !== "string" || !/^[0-9a-f-]{36}$/i.test(requestKey)) {
    redirect("/admin/team?adminRoleError=invalid-request");
  }
  if (confirmation !== "yes") {
    redirect("/admin/team?adminRoleError=confirmation-required");
  }

  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    redirect(`/auth/sign-in?next=${encodeURIComponent("/admin/team")}`);
  }

  const { data: isAdmin, error: roleError } = await supabase.rpc("has_role", {
    p_role: "admin",
    p_user_id: userData.user.id,
  });
  if (roleError || !isAdmin) {
    redirect("/auth/unauthorized?role=admin");
  }

  const { data, error } = await supabase.rpc("grant_admin_role", {
    p_target_email: email,
    p_current_password: password,
    p_reason: reason,
    p_request_key: requestKey,
  });

  if (error) {
    console.error("Unable to grant administrator role", { code: error.code });
    redirect("/admin/team?adminRoleError=grant-failed");
  }

  const result = (Array.isArray(data) ? data[0] : data) as { outcome?: string } | null;
  if (result?.outcome === "granted") {
    revalidatePath("/admin");
    redirect("/admin/team?adminRoleStatus=granted");
  }
  if (result?.outcome === "already_admin") {
    redirect("/admin/team?adminRoleStatus=already-admin");
  }

  const allowedErrors = new Set(["invalid_password", "rate_limited", "target_ineligible"]);
  const errorCode = result?.outcome && allowedErrors.has(result.outcome)
    ? result.outcome.replaceAll("_", "-")
    : "grant-failed";
  redirect(`/admin/team?adminRoleError=${errorCode}`);
}

export async function reviewAuction(formData: FormData) {
  const auctionId = formData.get("auctionId");
  const decision = formData.get("decision");
  const reasonValue = formData.get("reason");
  const reason = typeof reasonValue === "string" ? reasonValue.trim() : "";

  if (typeof auctionId !== "string" || !/^[0-9a-f-]{36}$/i.test(auctionId)) {
    redirect("/admin/auctions?error=invalid-auction");
  }
  if (decision !== "approve" && decision !== "reject") {
    redirect("/admin/auctions?error=invalid-decision");
  }
  if (reason.length < 5 || reason.length > 500) {
    redirect("/admin/auctions?error=reason-required");
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("review_auction", {
    p_auction_id: auctionId,
    p_decision: decision,
    p_reason: reason,
  });

  if (error) {
    console.error("Unable to review auction", { code: error.code, decision });
    const errorCode = error.message.includes("AUCTION_WINDOW_ENDED") ? "window-ended" : "review-failed";
    redirect(`/admin/auctions?error=${errorCode}`);
  }

  revalidatePath("/");
  revalidatePath("/seller");
  revalidatePath("/admin");
  redirect(`/admin/auctions?status=${decision === "approve" ? "approved" : "rejected"}`);
}

export async function returnApprovedAuctionForEdit(formData: FormData) {
  const auctionId = formData.get("auctionId");
  const reasonValue = formData.get("reason");
  const reason = typeof reasonValue === "string" ? reasonValue.trim() : "";

  if (typeof auctionId !== "string" || !/^[0-9a-f-]{36}$/i.test(auctionId)) {
    redirect("/admin/auctions?error=invalid-auction");
  }
  if (reason.length < 5 || reason.length > 500) {
    redirect("/admin/auctions?error=reason-required");
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("return_approved_auction_for_edit", {
    p_auction_id: auctionId,
    p_reason: reason,
  });

  if (error) {
    console.error("Unable to return approved auction for edit", { code: error.code });
    const errorCode = error.message.includes("AUCTION_HAS_BIDS") ? "auction-has-bids" : "return-failed";
    redirect(`/admin/auctions?error=${errorCode}`);
  }

  revalidatePath("/");
  revalidatePath("/seller");
  revalidatePath("/admin");
  redirect("/admin/auctions?status=returned");
}

export async function reviewBidderVerification(formData: FormData) {
  const userId = formData.get("userId");
  const decision = formData.get("decision");
  const reasonValue = formData.get("reason");
  const reason = typeof reasonValue === "string" ? reasonValue.trim() : "";

  if (typeof userId !== "string" || !/^[0-9a-f-]{36}$/i.test(userId)) {
    redirect("/admin/members?identityError=invalid-user");
  }
  if (decision !== "approve" && decision !== "reject") {
    redirect("/admin/members?identityError=invalid-decision");
  }
  if (reason.length < 5 || reason.length > 500) {
    redirect("/admin/members?identityError=reason-required");
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("review_bidder_verification", {
    p_user_id: userId,
    p_decision: decision,
    p_reason: reason,
  });

  if (error) {
    console.error("Unable to review bidder verification", { code: error.code, decision });
    redirect("/admin/members?identityError=review-failed");
  }

  revalidatePath("/admin");
  revalidatePath("/account/verification");
  redirect(`/admin/members?identityStatus=${decision === "approve" ? "approved" : "rejected"}`);
}

export async function reviewOrderPayment(formData: FormData) {
  const orderId = formData.get("orderId");
  const decision = formData.get("decision");
  const reasonValue = formData.get("reason");
  const reason = typeof reasonValue === "string" ? reasonValue.trim() : "";

  if (typeof orderId !== "string" || !/^[0-9a-f-]{36}$/i.test(orderId)) {
    redirect("/admin/payments?paymentError=invalid-order");
  }
  if (decision !== "approve" && decision !== "needs_correction") {
    redirect("/admin/payments?paymentError=invalid-decision");
  }
  if (reason.length < 5 || reason.length > 500) {
    redirect("/admin/payments?paymentError=reason-required");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("review_order_payment", {
    p_order_id: orderId,
    p_decision: decision,
    p_reason: reason,
  });

  if (error) {
    console.error("Unable to review order payment", { code: error.code, decision });
    redirect("/admin/payments?paymentError=review-failed");
  }

  revalidatePath("/admin");
  revalidatePath("/account");
  revalidatePath(`/orders/${orderId}`);
  const reviewedOrder = (Array.isArray(data) ? data[0] : data) as { payment_evidence_is_test?: boolean } | null;
  const outcome = reviewedOrder?.payment_evidence_is_test
    ? decision === "approve" ? "test-approved" : "test-needs-correction"
    : decision === "approve" ? "approved" : "needs-correction";
  redirect(`/admin/payments?paymentStatus=${outcome}`);
}

export async function enableOrderPaymentTestMode(formData: FormData) {
  const orderId = formData.get("orderId");
  const reasonValue = formData.get("reason");
  const reason = typeof reasonValue === "string" ? reasonValue.trim() : "";

  if (process.env.NEXT_PUBLIC_PAYMENT_TEST_MODE_ENABLED !== "true") {
    redirect("/admin/shipping?paymentTestError=app-disabled");
  }
  if (typeof orderId !== "string" || !/^[0-9a-f-]{36}$/i.test(orderId)) {
    redirect("/admin/shipping?paymentTestError=invalid-order");
  }
  if (reason.length < 5 || reason.length > 500) {
    redirect("/admin/shipping?paymentTestError=reason-required");
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("enable_order_payment_test_mode", {
    p_order_id: orderId,
    p_reason: reason,
  });

  if (error) {
    console.error("Unable to enable payment test mode", { code: error.code });
    const errorCode = error.message.includes("PAYMENT_WINDOW_EXPIRED")
      ? "window-expired"
      : error.message.includes("SHIPPING_AMOUNT_REQUIRED")
        ? "shipping-required"
        : "enable-failed";
    redirect(`/admin/shipping?paymentTestError=${errorCode}`);
  }

  revalidatePath("/admin");
  revalidatePath("/account");
  revalidatePath(`/orders/${orderId}`);
  redirect("/admin/shipping?paymentTestStatus=enabled");
}

export async function configureOrderShipping(formData: FormData) {
  const orderId = formData.get("orderId");
  const requestKey = formData.get("requestKey");
  const shippingAmount = bahtToSatang(formData.get("shippingAmount"));
  const reasonValue = formData.get("reason");
  const reason = typeof reasonValue === "string" ? reasonValue.trim() : "";

  if (typeof orderId !== "string" || !/^[0-9a-f-]{36}$/i.test(orderId)) {
    redirect("/admin/shipping?shippingError=invalid-order");
  }
  if (typeof requestKey !== "string" || !/^[0-9a-f-]{36}$/i.test(requestKey)) {
    redirect("/admin/shipping?shippingError=invalid-request");
  }
  if (shippingAmount === null) {
    redirect("/admin/shipping?shippingError=invalid-amount");
  }
  if (reason.length < 5 || reason.length > 500) {
    redirect("/admin/shipping?shippingError=reason-required");
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("configure_order_shipping", {
    p_order_id: orderId,
    p_shipping_amount: shippingAmount,
    p_reason: reason,
    p_request_key: requestKey,
  });

  if (error) {
    console.error("Unable to configure order shipping", { code: error.code });
    redirect("/admin/shipping?shippingError=configure-failed");
  }

  revalidatePath("/admin");
  revalidatePath("/account");
  revalidatePath(`/orders/${orderId}`);
  redirect("/admin/shipping?shippingStatus=configured");
}

export async function advanceOrderFulfillment(formData: FormData) {
  const orderId = formData.get("orderId");
  const requestKey = formData.get("requestKey");
  const action = formData.get("action");
  const carrierValue = formData.get("carrier");
  const trackingValue = formData.get("trackingNumber");
  const reasonValue = formData.get("reason");
  const carrier = typeof carrierValue === "string" ? carrierValue.trim() : "";
  const trackingNumber = typeof trackingValue === "string" ? trackingValue.trim() : "";
  const reason = typeof reasonValue === "string" ? reasonValue.trim() : "";

  if (typeof orderId !== "string" || !/^[0-9a-f-]{36}$/i.test(orderId)) {
    redirect("/admin/fulfillment?fulfillmentError=invalid-order");
  }
  if (typeof requestKey !== "string" || !/^[0-9a-f-]{36}$/i.test(requestKey)) {
    redirect("/admin/fulfillment?fulfillmentError=invalid-request");
  }
  if (action !== "prepare" && action !== "ship") {
    redirect("/admin/fulfillment?fulfillmentError=invalid-action");
  }
  if (reason.length < 5 || reason.length > 500) {
    redirect("/admin/fulfillment?fulfillmentError=reason-required");
  }
  if (action === "ship" && (carrier.length < 2 || trackingNumber.length < 3)) {
    redirect("/admin/fulfillment?fulfillmentError=tracking-required");
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("advance_order_fulfillment", {
    p_order_id: orderId,
    p_action: action,
    p_carrier: carrier,
    p_tracking_number: trackingNumber,
    p_reason: reason,
    p_request_key: requestKey,
  });

  if (error) {
    console.error("Unable to advance order fulfillment", { code: error.code, action });
    redirect("/admin/fulfillment?fulfillmentError=transition-failed");
  }

  revalidatePath("/admin");
  revalidatePath("/account");
  revalidatePath(`/orders/${orderId}`);
  redirect(`/admin/fulfillment?fulfillmentStatus=${action === "prepare" ? "preparing" : "shipped"}`);
}

export async function reviewPaymentDefaultAccount(formData: FormData) {
  const userId = formData.get("userId");
  const decision = formData.get("decision");
  const reasonValue = formData.get("reason");
  const reason = typeof reasonValue === "string" ? reasonValue.trim() : "";

  if (typeof userId !== "string" || !/^[0-9a-f-]{36}$/i.test(userId)) {
    redirect("/admin/defaults?defaultError=invalid-user");
  }
  if (decision !== "reinstate" && decision !== "keep_suspended") {
    redirect("/admin/defaults?defaultError=invalid-decision");
  }
  if (reason.length < 5 || reason.length > 500) {
    redirect("/admin/defaults?defaultError=reason-required");
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("review_payment_default_account", {
    p_user_id: userId,
    p_decision: decision,
    p_reason: reason,
  });

  if (error) {
    console.error("Unable to review payment default account", { code: error.code, decision });
    redirect("/admin/defaults?defaultError=review-failed");
  }

  revalidatePath("/admin");
  revalidatePath("/account");
  redirect(`/admin/defaults?defaultStatus=${decision === "reinstate" ? "reinstated" : "kept-suspended"}`);
}
