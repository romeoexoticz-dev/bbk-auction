import Link from "next/link";
import { Brand } from "@/components/brand";

export default function UnauthorizedPage() {
  return (
    <main className="simple-state-page">
      <Brand />
      <span className="state-code">403</span>
      <h1>บัญชีนี้ยังไม่มีสิทธิ์เข้าพื้นที่ดังกล่าว</h1>
      <p>ขณะนี้ร้าน BBK เป็นผู้ขายเพียงรายเดียว บัญชีสมาชิกทั่วไปใช้สำหรับเข้าร่วมประมูล ส่วนพื้นที่แอดมินจำกัดเฉพาะทีมงาน</p>
      <div><Link className="button button-dark" href="/">กลับหน้าตลาด</Link><Link className="button button-outline" href="/auth/sign-in">เปลี่ยนบัญชี</Link></div>
    </main>
  );
}
