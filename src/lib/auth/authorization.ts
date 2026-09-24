import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export type AppRole = "bidder" | "seller" | "admin" | "support" | "finance";

export async function getCurrentUser() {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user;
}

export async function requireRole(role: AppRole, returnTo: string) {
  if (!isSupabaseConfigured()) {
    return { demo: true as const, user: null };
  }

  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError || !userData.user) {
    redirect(`/auth/sign-in?next=${encodeURIComponent(returnTo)}`);
  }

  const { data: allowed, error: roleError } = await supabase.rpc("has_role", {
    p_role: role,
    p_user_id: userData.user.id,
  });

  if (roleError || !allowed) {
    redirect(`/auth/unauthorized?role=${role}`);
  }

  return { demo: false as const, user: userData.user };
}
