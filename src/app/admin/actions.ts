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
    redirect("/admin?adminRoleError=invalid-email#administrators");
  }
  if (password.length < 1 || password.length > 1024) {
    redirect("/admin?adminRoleError=password-required#administrators");
  }
  if (reason.length < 5 || reason.length > 500) {
    redirect("/admin?adminRoleError=reason-required#administrators");
  }
  if (typeof requestKey !== "string" || !/^[0-9a-f-]{36}$/i.test(requestKey)) {
    redirect("/admin?adminRoleError=invalid-request#administrators");
  }
  if (confirmation !== "yes") {
    redirect("/admin?adminRoleError=confirmation-required#administrators");
  }

  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    redirect(`/auth/sign-in?next=${encodeURIComponent("/admin#administrators")}`);
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
    redirect("/admin?adminRoleError=grant-failed#administrators");
  }

  const result = (Array.isArray(data) ? data[0] : data) as { outcome?: string } | null;
  if (result?.outcome === "granted") {
    revalidatePath("/admin");
    redirect("/admin?adminRoleStatus=granted#administrators");
  }
  if (result?.outcome === "already_admin") {
    redirect("/admin?adminRoleStatus=already-admin#administrators");
  }

  const allowedErrors = new Set(["invalid_password", "rate_limited", "target_ineligible"]);
  const errorCode = result?.outcome && allowedErrors.has(result.outcome)
    ? result.outcome.replaceAll("_", "-")
    : "grant-failed";
  redirect(`/admin?adminRoleError=${errorCode}#administrators`);
}

export async function reviewAuction(formData: FormData) {
  const auctionId = formData.get("auctionId");
  const decision = formData.get("decision");
  const reasonValue = formData.get("reason");
  const reason = typeof reasonValue === "string" ? reasonValue.trim() : "";

  if (typeof auctionId !== "string" || !/^[0-9a-f-]{36}$/i.test(auctionId)) {
    redirect("/admin?error=invalid-auction#review");
  }
  if (decision !== "approve" && decision !== "reject") {
    redirect("/admin?error=invalid-decision#review");
  }
  if (reason.length < 5 || reason.length > 500) {
    redirect("/admin?error=reason-required#review");
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
    redirect(`/admin?error=${errorCode}#review`);
  }

  revalidatePath("/");
  revalidatePath("/seller");
  revalidatePath("/admin");
  redirect(`/admin?status=${decision === "approve" ? "approved" : "rejected"}#review`);
}

export async function returnApprovedAuctionForEdit(formData: FormData) {
  const auctionId = formData.get("auctionId");
  const reasonValue = formData.get("reason");
  const reason = typeof reasonValue === "string" ? reasonValue.trim() : "";

  if (typeof auctionId !== "string" || !/^[0-9a-f-]{36}$/i.test(auctionId)) {
    redirect("/admin?error=invalid-auction#corrections");
  }
  if (reason.length < 5 || reason.length > 500) {
    redirect("/admin?error=reason-required#corrections");
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("return_approved_auction_for_edit", {
    p_auction_id: auctionId,
    p_reason: reason,
  });

  if (error) {
    console.error("Unable to return approved auction for edit", { code: error.code });
    const errorCode = error.message.includes("AUCTION_HAS_BIDS") ? "auction-has-bids" : "return-failed";
    redirect(`/admin?error=${errorCode}#corrections`);
  }

  revalidatePath("/");
  revalidatePath("/seller");
  revalidatePath("/admin");
  redirect("/admin?status=returned#corrections");
}

export async function reviewBidderVerification(formData: FormData) {
  const userId = formData.get("userId");
  const decision = formData.get("decision");
  const reasonValue = formData.get("reason");
  const reason = typeof reasonValue === "string" ? reasonValue.trim() : "";

  if (typeof userId !== "string" || !/^[0-9a-f-]{36}$/i.test(userId)) {
    redirect("/admin?identityError=invalid-user#members");
  }
  if (decision !== "approve" && decision !== "reject") {
    redirect("/admin?identityError=invalid-decision#members");
  }
  if (reason.length < 5 || reason.length > 500) {
    redirect("/admin?identityError=reason-required#members");
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("review_bidder_verification", {
    p_user_id: userId,
    p_decision: decision,
    p_reason: reason,
  });

  if (error) {
    console.error("Unable to review bidder verification", { code: error.code, decision });
    redirect("/admin?identityError=review-failed#members");
  }

  revalidatePath("/admin");
  revalidatePath("/account/verification");
  redirect(`/admin?identityStatus=${decision === "approve" ? "approved" : "rejected"}#members`);
}

export async function reviewOrderPayment(formData: FormData) {
  const orderId = formData.get("orderId");
  const decision = formData.get("decision");
  const reasonValue = formData.get("reason");
  const reason = typeof reasonValue === "string" ? reasonValue.trim() : "";

  if (typeof orderId !== "string" || !/^[0-9a-f-]{36}$/i.test(orderId)) {
    redirect("/admin?paymentError=invalid-order#payments");
  }
  if (decision !== "approve" && decision !== "needs_correction") {
    redirect("/admin?paymentError=invalid-decision#payments");
  }
  if (reason.length < 5 || reason.length > 500) {
    redirect("/admin?paymentError=reason-required#payments");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("review_order_payment", {
    p_order_id: orderId,
    p_decision: decision,
    p_reason: reason,
  });

  if (error) {
    console.error("Unable to review order payment", { code: error.code, decision });
    redirect("/admin?paymentError=review-failed#payments");
  }

  revalidatePath("/admin");
  revalidatePath("/account");
  revalidatePath(`/orders/${orderId}`);
  const reviewedOrder = (Array.isArray(data) ? data[0] : data) as { payment_evidence_is_test?: boolean } | null;
  const outcome = reviewedOrder?.payment_evidence_is_test
    ? decision === "approve" ? "test-approved" : "test-needs-correction"
    : decision === "approve" ? "approved" : "needs-correction";
  redirect(`/admin?paymentStatus=${outcome}#payments`);
}

export async function enableOrderPaymentTestMode(formData: FormData) {
  const orderId = formData.get("orderId");
  const reasonValue = formData.get("reason");
  const reason = typeof reasonValue === "string" ? reasonValue.trim() : "";

  if (process.env.NEXT_PUBLIC_PAYMENT_TEST_MODE_ENABLED !== "true") {
    redirect("/admin?paymentTestError=app-disabled#shipping");
  }
  if (typeof orderId !== "string" || !/^[0-9a-f-]{36}$/i.test(orderId)) {
    redirect("/admin?paymentTestError=invalid-order#shipping");
  }
  if (reason.length < 5 || reason.length > 500) {
    redirect("/admin?paymentTestError=reason-required#shipping");
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
    redirect(`/admin?paymentTestError=${errorCode}#shipping`);
  }

  revalidatePath("/admin");
  revalidatePath("/account");
  revalidatePath(`/orders/${orderId}`);
  redirect("/admin?paymentTestStatus=enabled#shipping");
}

export async function configureOrderShipping(formData: FormData) {
  const orderId = formData.get("orderId");
  const requestKey = formData.get("requestKey");
  const shippingAmount = bahtToSatang(formData.get("shippingAmount"));
  const reasonValue = formData.get("reason");
  const reason = typeof reasonValue === "string" ? reasonValue.trim() : "";

  if (typeof orderId !== "string" || !/^[0-9a-f-]{36}$/i.test(orderId)) {
    redirect("/admin?shippingError=invalid-order#shipping");
  }
  if (typeof requestKey !== "string" || !/^[0-9a-f-]{36}$/i.test(requestKey)) {
    redirect("/admin?shippingError=invalid-request#shipping");
  }
  if (shippingAmount === null) {
    redirect("/admin?shippingError=invalid-amount#shipping");
  }
  if (reason.length < 5 || reason.length > 500) {
    redirect("/admin?shippingError=reason-required#shipping");
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
    redirect("/admin?shippingError=configure-failed#shipping");
  }

  revalidatePath("/admin");
  revalidatePath("/account");
  revalidatePath(`/orders/${orderId}`);
  redirect("/admin?shippingStatus=configured#shipping");
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
    redirect("/admin?fulfillmentError=invalid-order#fulfillment");
  }
  if (typeof requestKey !== "string" || !/^[0-9a-f-]{36}$/i.test(requestKey)) {
    redirect("/admin?fulfillmentError=invalid-request#fulfillment");
  }
  if (action !== "prepare" && action !== "ship") {
    redirect("/admin?fulfillmentError=invalid-action#fulfillment");
  }
  if (reason.length < 5 || reason.length > 500) {
    redirect("/admin?fulfillmentError=reason-required#fulfillment");
  }
  if (action === "ship" && (carrier.length < 2 || trackingNumber.length < 3)) {
    redirect("/admin?fulfillmentError=tracking-required#fulfillment");
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
    redirect("/admin?fulfillmentError=transition-failed#fulfillment");
  }

  revalidatePath("/admin");
  revalidatePath("/account");
  revalidatePath(`/orders/${orderId}`);
  redirect(`/admin?fulfillmentStatus=${action === "prepare" ? "preparing" : "shipped"}#fulfillment`);
}

export async function reviewPaymentDefaultAccount(formData: FormData) {
  const userId = formData.get("userId");
  const decision = formData.get("decision");
  const reasonValue = formData.get("reason");
  const reason = typeof reasonValue === "string" ? reasonValue.trim() : "";

  if (typeof userId !== "string" || !/^[0-9a-f-]{36}$/i.test(userId)) {
    redirect("/admin?defaultError=invalid-user#payment-defaults");
  }
  if (decision !== "reinstate" && decision !== "keep_suspended") {
    redirect("/admin?defaultError=invalid-decision#payment-defaults");
  }
  if (reason.length < 5 || reason.length > 500) {
    redirect("/admin?defaultError=reason-required#payment-defaults");
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("review_payment_default_account", {
    p_user_id: userId,
    p_decision: decision,
    p_reason: reason,
  });

  if (error) {
    console.error("Unable to review payment default account", { code: error.code, decision });
    redirect("/admin?defaultError=review-failed#payment-defaults");
  }

  revalidatePath("/admin");
  revalidatePath("/account");
  redirect(`/admin?defaultStatus=${decision === "reinstate" ? "reinstated" : "kept-suspended"}#payment-defaults`);
}
