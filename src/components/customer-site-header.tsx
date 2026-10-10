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
          <div className="customer-shop-actions">
            <Link className="customer-header-notifications" href={signedIn ? "/account#notifications" : "/auth/sign-in?next=/account"}>แจ้งเตือน</Link>
            <Link className="customer-header-account" href={accountHref}>{signedIn ? "บัญชีของฉัน" : "เข้าสู่ระบบ"}</Link>
          </div>
        </div>
        <nav aria-label="เมนูร้านค้า" className="customer-shop-nav">
          <Link className="active" href="/#live-lots">กำลังประมูล</Link>
          <Link href="/completed">ประมูลจบแล้ว</Link>
          <Link href={signedIn ? "/account#bidding" : "/auth/sign-in?next=/account"}>ประมูลของฉัน</Link>
          <Link href="/auction-rules">กติกาการประมูล</Link>
          {isAdmin && <Link className="customer-admin-link" href="/admin">แอดมิน</Link>}
          {signedIn ? (
            <form action={signOut}>
              <button type="submit">ออกจากระบบ</button>
            </form>
          ) : null}
          {signedIn && <span className="customer-email-chip" title={email ?? "สมาชิก"}>{email ?? "สมาชิก"}</span>}
        </nav>
      </header>
    </div>
  );
}
