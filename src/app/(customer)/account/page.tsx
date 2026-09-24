import Link from "next/link";
import { redirect } from "next/navigation";
import { AuctionInterestForm } from "@/components/auction-interest-form";
import { Brand } from "@/components/brand";
import { formatBaht } from "@/lib/auctions/queries";
import { getCurrentUser } from "@/lib/auth/authorization";
import { createClient } from "@/lib/supabase/server";

type BidRow = {
  id: string;
  amount: number;
  created_at: string;
  auction_id: string;
  auctions: { title: string; status: string } | { title: string; status: string }[] | null;
};

type OrderRow = {
  id: string;
  order_number: string;
  status: string;
  winning_amount: number;
  total_amount: number;
  payment_due_at: string;
  auctions: { title: string } | { title: string }[] | null;
};

type NotificationRow = {
  id: number;
  title: string;
  message: string;
  entity_type: string | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
};

type PaymentDefaultCase = {
  strike_count: number;
  review_status: "warning" | "pending_review" | "reinstated" | "kept_suspended";
  last_expired_at: string | null;
  review_reason: string | null;
};

const statusLabel: Record<string, string> = {
  pending_payment: "รอชำระ",
  paid: "ตรวจสอบแล้ว",
  preparing: "กำลังเตรียมส่ง",
  shipped: "จัดส่งแล้ว",
  delivered: "ส่งถึงแล้ว",
  completed: "สำเร็จ",
  cancelled: "ยกเลิก",
  disputed: "มีข้อโต้แย้ง",
  refunded: "คืนเงินแล้ว",
};

function relationTitle(value: BidRow["auctions"] | OrderRow["auctions"]) {
  if (Array.isArray(value)) return value[0]?.title ?? "รายการประมูล";
  return value?.title ?? "รายการประมูล";
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(new Date(value));
}

export default async function AccountPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/sign-in?next=/account");
  const supabase = await createClient();
  const [bidResult, orderResult, notificationResult, profileResult, defaultCaseResult, interestResult] = await Promise.all([
    supabase
      .from("bids")
      .select("id,auction_id,amount,created_at,auctions(title,status)")
      .eq("bidder_id", user.id)
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("orders")
      .select("id,order_number,status,winning_amount,total_amount,payment_due_at,auctions(title)")
      .eq("buyer_id", user.id)
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("notifications")
      .select("id,title,message,entity_type,entity_id,read_at,created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("profiles")
      .select("account_status")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("payment_default_cases")
      .select("strike_count,review_status,last_expired_at,review_reason")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase.rpc("get_my_auction_interests"),
  ]);

  const bids = (bidResult.data ?? []) as BidRow[];
  const orders = (orderResult.data ?? []) as OrderRow[];
  const notifications = (notificationResult.data ?? []) as NotificationRow[];
  const accountStatus = profileResult.data?.account_status ?? "active";
  const paymentDefault = defaultCaseResult.data as PaymentDefaultCase | null;
  if (interestResult.error) console.error("Unable to load auction interests", { code: interestResult.error.code });
  const selectedInterests = (interestResult.data ?? []).map((item: { category: string }) => item.category);

  return (
    <main className="account-page">
      <header className="market-header detail-header"><Brand /><Link className="button button-outline" href="/">← กลับหน้าตลาด</Link></header>
      <section className="account-hero"><span className="kicker"><i /> MY BBK</span><h1>บัญชีของฉัน</h1><p>{user.email}</p></section>
      {paymentDefault?.review_status === "warning" && <div className="account-system-message warning"><strong>คำเตือนการไม่ชำระครั้งที่ {paymentDefault.strike_count}</strong><p>Order ที่เลยกำหนดถูกยกเลิกแล้ว หากเกิดครั้งที่ 2 ระบบจะระงับสิทธิ์ประมูลเพื่อให้แอดมินตรวจสอบ</p></div>}
      {accountStatus === "suspended" && paymentDefault?.review_status === "pending_review" && <div className="account-system-message danger"><strong>ระงับสิทธิ์ประมูลชั่วคราว</strong><p>พบการไม่ชำระภายในกำหนด {paymentDefault.strike_count} ครั้ง กรุณารอแอดมินตรวจสอบบัญชี</p></div>}
      {paymentDefault?.review_status === "kept_suspended" && <div className="account-system-message danger"><strong>บัญชียังคงถูกระงับ</strong><p>{paymentDefault.review_reason || "กรุณาติดต่อทีมงานเพื่อขอตรวจสอบข้อมูล"}</p></div>}
      <div className="account-wide"><AuctionInterestForm selected={selectedInterests} /></div>
      <div className="account-grid">
        <section className="panel account-panel" id="notifications">
          <div className="panel-heading"><div><h2>รายการที่ชนะ</h2><p>ดูยอดรวมและสถานะคำสั่งซื้อ</p></div><span className="table-filter">{orders.length}</span></div>
          {orders.length > 0 ? <div className="account-list">{orders.map((order) => <Link href={`/orders/${order.id}`} key={order.id} className="account-list-row">
            <div><small>{order.order_number}</small><strong>{relationTitle(order.auctions)}</strong><span>ครบกำหนด {dateTime(order.payment_due_at)}</span></div>
            <div><strong>{formatBaht(Number(order.total_amount))}</strong><span>{statusLabel[order.status] ?? order.status}</span></div>
          </Link>)}</div> : <div className="admin-empty"><strong>ยังไม่มีรายการที่ชนะ</strong><p>เมื่อชนะประมูล ระบบจะสร้างคำสั่งซื้อเพียงหนึ่งรายการให้อัตโนมัติ</p></div>}
        </section>
        <section className="panel account-panel">
          <div className="panel-heading"><div><h2>การแจ้งเตือน</h2><p>แจ้งเตือนภายในเว็บไซต์</p></div><span className="table-filter">{notifications.filter((item) => !item.read_at).length} ใหม่</span></div>
          {notifications.length > 0 ? <div className="account-list">{notifications.map((item) => <article className={`account-list-row notification-row ${item.read_at ? "read" : ""}`} key={item.id}>
            <div><small>{dateTime(item.created_at)}</small><strong>{item.title}</strong><span>{item.message}</span></div>
          </article>)}</div> : <div className="admin-empty"><p>ยังไม่มีการแจ้งเตือน</p></div>}
        </section>
      </div>
      <section className="panel account-panel bid-history-panel">
        <div className="panel-heading"><div><h2>ประวัติการเสนอราคา</h2><p>แสดงเวลาและจำนวนเงินจากฐานข้อมูล</p></div><span className="table-filter">{bids.length}</span></div>
        {bids.length > 0 ? <div className="account-list">{bids.map((bid) => <Link href={`/auctions/${bid.auction_id}`} key={bid.id} className="account-list-row">
          <div><small>{dateTime(bid.created_at)}</small><strong>{relationTitle(bid.auctions)}</strong></div><div><strong>{formatBaht(Number(bid.amount))}</strong><span>ดูรายการ →</span></div>
        </Link>)}</div> : <div className="admin-empty"><p>ยังไม่มีประวัติการเสนอราคา</p></div>}
      </section>
    </main>
  );
}
