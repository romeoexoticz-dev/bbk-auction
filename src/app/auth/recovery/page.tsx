"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Brand } from "@/components/brand";
import { createClient } from "@/lib/supabase/client";

export default function RecoveryPage() {
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function establishRecoverySession() {
      const hash = new URLSearchParams(window.location.hash.slice(1));
      const accessToken = hash.get("access_token");
      const refreshToken = hash.get("refresh_token");
      const errorDescription = hash.get("error_description");

      if (errorDescription || !accessToken || !refreshToken) {
        if (active) setError("ลิงก์ตั้งรหัสผ่านหมดอายุหรือไม่ถูกต้อง กรุณาขอลิงก์ใหม่");
        return;
      }

      const supabase = createClient();
      const { error: sessionError } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });

      if (sessionError) {
        if (active) setError("ยืนยันลิงก์ไม่สำเร็จ กรุณาขอลิงก์ตั้งรหัสผ่านใหม่");
        return;
      }

      window.history.replaceState(null, "", "/auth/recovery");
      window.location.replace("/auth/update-password");
    }

    void establishRecoverySession();
    return () => { active = false; };
  }, []);

  return (
    <main className="simple-state-page">
      <Brand />
      <span className="state-code">ACCOUNT RECOVERY</span>
      <h1>{error ? "เปิดลิงก์ไม่สำเร็จ" : "กำลังยืนยันลิงก์กู้รหัสผ่าน"}</h1>
      <p>{error || "กรุณารอสักครู่ ระบบกำลังพาไปหน้าตั้งรหัสผ่านใหม่"}</p>
      {error && <div><Link className="button button-gold" href="/auth/sign-in">ขอลิงก์ใหม่</Link></div>}
    </main>
  );
}
