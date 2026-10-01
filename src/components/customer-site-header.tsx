import Link from "next/link";
import { signOut } from "@/app/auth/actions";
import { Brand } from "@/components/brand";

export function CustomerSiteHeader({
  email,
  isAdmin,
  signedIn,
}: {
  email?: string | null;
  isAdmin: boolean;
  signedIn: boolean;
}) {
  const accountHref = signedIn ? "/account" : "/auth/sign-in?next=/account";

  return (
    <div className="customer-site-chrome">
      <div className="customer-promise-bar">BBK AUCTION · ประมูลก่อน ชำระเมื่อชนะ · ไม่ต้องเติมเหรียญ</div>
      <header className="customer-shop-header">
        <div className="customer-shop-header-main">
          <Brand market />
          <form action="/" className="customer-shop-search" method="get">
            <label>
              <span className="sr-only">ค้นหาสินค้าทั้งหมด</span>
              <input maxLength={80} name="q" placeholder="ค้นหาธนบัตร เหรียญ พระเครื่อง การ์ด…" type="search" />
            </label>
            <button type="submit">ค้นหา</button>
          </form>
          <div className="customer-shop-actions">
            <Link className="customer-order-link" href={signedIn ? "/account#orders" : "/auth/sign-in?next=/account"}>
              <span aria-hidden="true">▣</span><strong>ออเดอร์ของฉัน</strong>
            </Link>
            <Link aria-label="แจ้งเตือน" className="customer-icon-link" href={signedIn ? "/account#notifications" : "/auth/sign-in?next=/account"}>♢</Link>
            <Link aria-label="บัญชีของฉัน" className="customer-icon-link" href={accountHref}>○</Link>
          </div>
        </div>
        <nav aria-label="เมนูร้านค้า" className="customer-shop-nav">
          <Link className="active" href="/#live-lots">สินค้าประมูล</Link>
          <Link href="/completed">ประมูลจบแล้ว</Link>
          <Link href={signedIn ? "/account#interests" : "/auth/sign-in?next=/account"}>รายการติดตาม</Link>
          <Link href={signedIn ? "/account#bidding" : "/auth/sign-in?next=/account"}>ประมูลของฉัน</Link>
          <Link href={accountHref}>บัญชีของฉัน</Link>
          <Link href="/auction-rules">กติกาการประมูล</Link>
          <Link href="/fraud-warning">ศูนย์ช่วยเหลือ</Link>
          {isAdmin && <Link className="customer-admin-link" href="/admin">แอดมิน</Link>}
          {signedIn ? (
            <form action={signOut}>
              <button type="submit">ออกจากระบบ</button>
            </form>
          ) : (
            <Link className="customer-signin-link" href="/auth/sign-in">เข้าสู่ระบบ</Link>
          )}
          {signedIn && <span className="customer-email-chip" title={email ?? "สมาชิก"}>{email ?? "สมาชิก"}</span>}
        </nav>
      </header>
    </div>
  );
}
