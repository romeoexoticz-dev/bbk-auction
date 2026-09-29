import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const flowId = url.searchParams.get("sb_flow_id");
  const requestedNext = url.searchParams.get("next");
  const safeNext = requestedNext?.startsWith("/") && !requestedNext.startsWith("//") ? requestedNext : "/";
  const next = safeNext === "/account" || safeNext.startsWith("/account#") ? "/" : safeNext;

  if (code && isSupabaseConfigured()) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(
      code,
      flowId ? { flowId } : undefined,
    );
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  }

  const error = next === "/auth/update-password" ? "recovery-expired" : "callback";
  return NextResponse.redirect(new URL(`/auth/sign-in?error=${error}`, url.origin));
}
