"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getSupabasePublicEnv, isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export type AuthActionState = {
  error?: string;
  errorCode?: "email_not_confirmed";
  email?: string;
};

export type ResendConfirmationState = {
  error?: string;
  message?: string;
  cooldownUntil?: number;
};

export type PasswordResetState = {
  error?: string;
  message?: string;
};

export type UpdatePasswordState = {
  error?: string;
};

const RESEND_CONFIRMATION_COOKIE = "bbk_email_resend_after";
const RESEND_CONFIRMATION_COOLDOWN_SECONDS = 60;
const PASSWORD_RESET_COOKIE = "bbk_password_reset_after";
const PASSWORD_RESET_COOLDOWN_SECONDS = 60;

function readCredentials(formData: FormData) {
  const email = formData.get("email");
  const password = formData.get("password");
  if (typeof email !== "string" || !email.includes("@")) {
    return { error: "กรุณากรอกอีเมลให้ถูกต้อง" } as const;
  }
  if (typeof password !== "string" || password.length < 8) {
    return { error: "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร" } as const;
  }
  return { email: email.trim().toLowerCase(), password } as const;
}

function safeNextPath(value: FormDataEntryValue | null) {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//")
    ? value
    : "/";
}

function postSignInPath(value: FormDataEntryValue | null) {
  const next = safeNextPath(value);
  return next === "/account" || next.startsWith("/account#") ? "/" : next;
}

export async function signIn(
  _state: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  if (!isSupabaseConfigured()) {
    return { error: "ยังไม่ได้เชื่อม Supabase กรุณาตั้งค่า .env.local ก่อน" };
  }
  const credentials = readCredentials(formData);
  if ("error" in credentials) return credentials;

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(credentials);
  if (error?.code === "email_not_confirmed") {
    return {
      error: "กรุณายืนยันอีเมลก่อนเข้าสู่ระบบ",
      errorCode: "email_not_confirmed",
      email: credentials.email,
    };
  }
  if (error) return { error: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" };

  redirect(postSignInPath(formData.get("next")));
}

export async function signInWithGoogle(formData: FormData) {
  if (!isSupabaseConfigured()) {
    redirect("/auth/sign-in?error=provider");
  }

  const next = postSignInPath(formData.get("next"));
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const callbackUrl = new URL("/auth/callback", appUrl);
  callbackUrl.searchParams.set("next", next);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: callbackUrl.toString(),
      scopes: "openid email profile",
    },
  });

  if (error || !data.url) {
    redirect("/auth/sign-in?error=provider");
  }

  redirect(data.url);
}

export async function signUp(
  _state: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  if (!isSupabaseConfigured()) {
    return { error: "ยังไม่ได้เชื่อม Supabase กรุณาตั้งค่า .env.local ก่อน" };
  }
  const credentials = readCredentials(formData);
  if ("error" in credentials) return credentials;

  const displayName = formData.get("displayName");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    ...credentials,
    options: {
      data: {
        display_name:
          typeof displayName === "string" ? displayName.trim().slice(0, 80) : "",
      },
      emailRedirectTo: `${appUrl}/auth/callback?next=/`,
    },
  });

  if (error) return { error: "สมัครไม่สำเร็จ กรุณาตรวจอีเมลหรือทดลองใหม่" };
  if (data.session) redirect("/");
  redirect("/auth/sign-in?status=check-email");
}

export async function resendConfirmation(
  _state: ResendConfirmationState,
  formData: FormData,
): Promise<ResendConfirmationState> {
  if (!isSupabaseConfigured()) {
    return { error: "ยังไม่ได้เชื่อม Supabase กรุณาตั้งค่า .env.local ก่อน" };
  }

  const rawEmail = formData.get("email");
  if (typeof rawEmail !== "string" || !rawEmail.includes("@")) {
    return { error: "กรุณากรอกอีเมลให้ถูกต้อง" };
  }

  const cookieStore = await cookies();
  const now = Date.now();
  const resendAfter = Number(cookieStore.get(RESEND_CONFIRMATION_COOKIE)?.value ?? 0);
  if (Number.isFinite(resendAfter) && resendAfter > now) {
    return {
      error: "กรุณารอสักครู่ก่อนส่งอีเมลอีกครั้ง",
      cooldownUntil: resendAfter,
    };
  }

  const email = rawEmail.trim().toLowerCase();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const supabase = await createClient();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
    options: {
      emailRedirectTo: `${appUrl}/auth/callback?next=/`,
    },
  });

  if (error?.status === 429 || error?.code === "over_email_send_rate_limit" || error?.code === "over_request_rate_limit") {
    return {
      error: "ส่งถี่เกินไป กรุณารอประมาณ 60 วินาทีแล้วลองใหม่",
      cooldownUntil: now + RESEND_CONFIRMATION_COOLDOWN_SECONDS * 1000,
    };
  }
  if (error) {
    return { error: "ยังส่งอีเมลไม่ได้ กรุณารอสักครู่แล้วลองใหม่" };
  }

  const resendAfterTime = now + RESEND_CONFIRMATION_COOLDOWN_SECONDS * 1000;
  cookieStore.set(RESEND_CONFIRMATION_COOKIE, String(resendAfterTime), {
    httpOnly: true,
    maxAge: RESEND_CONFIRMATION_COOLDOWN_SECONDS,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });

  return {
    message: "ส่งอีเมลยืนยันอีกครั้งแล้ว กรุณาตรวจกล่องอีเมลและโฟลเดอร์ Spam หรือ Junk",
    cooldownUntil: resendAfterTime,
  };
}

export async function requestPasswordReset(
  _state: PasswordResetState,
  formData: FormData,
): Promise<PasswordResetState> {
  if (!isSupabaseConfigured()) {
    return { error: "ยังไม่ได้เชื่อม Supabase กรุณาตั้งค่า .env.local ก่อน" };
  }

  const rawEmail = formData.get("email");
  if (typeof rawEmail !== "string" || !rawEmail.includes("@")) {
    return { error: "กรุณากรอกอีเมลให้ถูกต้อง" };
  }

  const cookieStore = await cookies();
  const now = Date.now();
  const resetAfter = Number(cookieStore.get(PASSWORD_RESET_COOKIE)?.value ?? 0);
  if (Number.isFinite(resetAfter) && resetAfter > now) {
    return { error: "ส่งลิงก์แล้ว กรุณารอประมาณ 60 วินาทีก่อนขอใหม่" };
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const { url, publishableKey } = getSupabasePublicEnv();
  const supabase = createSupabaseClient(url, publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      flowType: "implicit",
      persistSession: false,
    },
  });
  const { error } = await supabase.auth.resetPasswordForEmail(
    rawEmail.trim().toLowerCase(),
    { redirectTo: `${appUrl}/auth/recovery` },
  );

  if (error?.status === 429 || error?.code === "over_email_send_rate_limit" || error?.code === "over_request_rate_limit") {
    return { error: "ส่งถี่เกินไป กรุณารอประมาณ 60 วินาทีแล้วลองใหม่" };
  }
  if (error) return { error: "ยังส่งลิงก์ไม่ได้ กรุณารอสักครู่แล้วลองใหม่" };

  cookieStore.set(PASSWORD_RESET_COOKIE, String(now + PASSWORD_RESET_COOLDOWN_SECONDS * 1000), {
    httpOnly: true,
    maxAge: PASSWORD_RESET_COOLDOWN_SECONDS,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });

  return { message: "ส่งลิงก์แล้ว กรุณาเปิด Inbox หรือ Spam/Junk แล้วกดลิงก์ ระบบจะแสดงช่องให้ตั้งรหัสผ่านใหม่" };
}

export async function updatePassword(
  _state: UpdatePasswordState,
  formData: FormData,
): Promise<UpdatePasswordState> {
  if (!isSupabaseConfigured()) {
    return { error: "ยังไม่ได้เชื่อม Supabase กรุณาตั้งค่า .env.local ก่อน" };
  }

  const password = formData.get("password");
  const confirmPassword = formData.get("confirmPassword");
  if (typeof password !== "string" || password.length < 8) {
    return { error: "รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร" };
  }
  if (password !== confirmPassword) {
    return { error: "รหัสผ่านทั้งสองช่องไม่ตรงกัน" };
  }

  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return { error: "ลิงก์ตั้งรหัสผ่านหมดอายุ กรุณาขอลิงก์ใหม่" };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: "ตั้งรหัสผ่านใหม่ไม่สำเร็จ กรุณาขอลิงก์ใหม่" };

  redirect("/account?status=password-updated");
}

export async function signOut() {
  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  redirect("/");
}
