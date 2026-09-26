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
  auctions: AuctionBidRelation | AuctionBidRelation[] | null;
};

type AuctionBidRelation = {
  title: string;
  status: string;
  current_price: number;
  ends_at: string;
};

type OrderRow = {
  id: string;
  auction_id: string;
  order_number: string;
  status: string;
  winning_amount: number;
  total_amount: number;
  payment_due_at: string;
  auctions: { title: string } | { title: string }[] | null;
};

type AuctionParticipation = {
  auctionId: string;
  title: string;
  status: string;
  currentPrice: number;
  endsAt: string;
  highestOwnBid: number;
  bidCount: number;
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

function bidAuction(value: BidRow["auctions"]) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(new Date(value));
}

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const passwordUpdated = params.status === "password-updated";
  const user = await getCurrentUser();
  if (!user) redirect("/auth/sign-in?next=/account");
  const supabase = await createClient();
  const [{ error: openError }, { error: closeError }] = await Promise.all([
    supabase.rpc("open_due_auctions"),
    supabase.rpc("close_due_auctions"),
  ]);
  if (openError) console.error("Unable to open due auctions from account", { code: openError.code });
  if (closeError) console.error("Unable to close due auctions from account", { code: closeError.code });
  const [bidResult, orderResult, notificationResult, profileResult, defaultCaseResult, interestResult] = await Promise.all([
    supabase
      .from("bids")
      .select("id,auction_id,amount,created_at,auctions(title,status,current_price,ends_at)")
      .eq("bidder_id", user.id)
      .order("created_at", { ascending: false })
      .limit(300),
    supabase
      .from("orders")
      .select("id,auction_id,order_number,status,winning_amount,total_amount,payment_due_at,auctions(title)")
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
  const wonAuctionIds = new Set(orders.map((order) => order.auction_id));
  const participationByAuction = new Map<string, AuctionParticipation>();
  for (const bid of bids) {
    const auction = bidAuction(bid.auctions);
    if (!auction) continue;
    const existing = participationByAuction.get(bid.auction_id);
    if (existing) {
      existing.highestOwnBid = Math.max(existing.highestOwnBid, Number(bid.amount));
      existing.bidCount += 1;
      continue;
    }
    participationByAuction.set(bid.auction_id, {
      auctionId: bid.auction_id,
      title: auction.title,
      status: auction.status,
      currentPrice: Number(auction.current_price),
      endsAt: auction.ends_at,
      highestOwnBid: Number(bid.amount),
      bidCount: 1,
    });
  }
  const participations = [...participationByAuction.values()];
  const activeAuctions = participations
    .filter((auction) => auction.status === "live" || auction.status === "scheduled")
    .sort((a, b) => new Date(a.endsAt).getTime() - new Date(b.endsAt).getTime());
  const lostAuctions = participations
    .filter((auction) => (auction.status === "ended" || auction.status === "settled") && !wonAuctionIds.has(auction.auctionId))
    .sort((a, b) => new Date(b.endsAt).getTime() - new Date(a.endsAt).getTime());
  const recentBids = bids.slice(0, 30);

  return (
    <main className="account-page">
      <header className="market-header detail-header"><Brand /><Link className="button button-outline" href="/">← กลับหน้าตลาด</Link></header>
      <section className="account-hero"><span className="kicker"><i /> MY BBK</span><h1>บัญชีของฉัน</h1><p>{user.email}</p></section>
      {passwordUpdated && <div className="account-system-message success"><strong>ตั้งรหัสผ่านใหม่สำเร็จ</strong><p>ครั้งต่อไปสามารถใช้รหัสผ่านใหม่นี้เข้าสู่ระบบได้</p></div>}
      {paymentDefault?.review_status === "warning" && <div className="account-system-message warning"><strong>คำเตือนการไม่ชำระครั้งที่ {paymentDefault.strike_count}</strong><p>Order ที่เลยกำหนดถูกยกเลิกแล้ว หากเกิดครั้งที่ 2 ระบบจะระงับสิทธิ์ประมูลเพื่อให้แอดมินตรวจสอบ</p></div>}
      {accountStatus === "suspended" && paymentDefault?.review_status === "pending_review" && <div className="account-system-message danger"><strong>ระงับสิทธิ์ประมูลชั่วคราว</strong><p>พบการไม่ชำระภายในกำหนด {paymentDefault.strike_count} ครั้ง กรุณารอแอดมินตรวจสอบบัญชี</p></div>}
      {paymentDefault?.review_status === "kept_suspended" && <div className="account-system-message danger"><strong>บัญชียังคงถูกระงับ</strong><p>{paymentDefault.review_reason || "กรุณาติดต่อทีมงานเพื่อขอตรวจสอบข้อมูล"}</p></div>}
      <div className="account-wide"><AuctionInterestForm selected={selectedInterests} /></div>
      <section className="account-auction-overview account-wide" aria-labelledby="my-auctions-title">
        <div className="account-auction-overview-heading"><div><span className="section-label">MY AUCTIONS</span><h2 id="my-auctions-title">การประมูลของฉัน</h2><p>แยกตามสถานะล่าสุดจากฐานข้อมูล</p></div></div>
        <div className="account-auction-columns">
          <section className="panel account-auction-column bidding-now">
            <div className="panel-heading"><div><h3>กำลังประมูล</h3><p>รายการที่ยังเปิดรับราคา</p></div><span className="table-filter">{activeAuctions.length}</span></div>
            {activeAuctions.length > 0 ? <div className="account-list">{activeAuctions.map((auction) => <Link href={`/auctions/${auction.auctionId}`} key={auction.auctionId} className="account-list-row auction-status-row">
              <div><small>ปิด {dateTime(auction.endsAt)}</small><strong>{auction.title}</strong><span>ราคาของคุณ {formatBaht(auction.highestOwnBid)} · {auction.bidCount} ครั้ง</span></div>
              <div><strong>{formatBaht(auction.currentPrice)}</strong><span className={auction.highestOwnBid >= auction.currentPrice ? "auction-position leading" : "auction-position outbid"}>{auction.highestOwnBid >= auction.currentPrice ? "นำอยู่" : "มีราคาสูงกว่า"}</span></div>
            </Link>)}</div> : <div className="account-auction-empty"><strong>ยังไม่มีรายการที่กำลังประมูล</strong><p>รายการจะย้ายมาที่นี่หลังเสนอราคาสำเร็จ</p></div>}
          </section>
          <section className="panel account-auction-column won">
            <div className="panel-heading"><div><h3>ชนะ</h3><p>รายการที่สร้างคำสั่งซื้อแล้ว</p></div><span className="table-filter">{orders.length}</span></div>
            {orders.length > 0 ? <div className="account-list">{orders.map((order) => <Link href={`/orders/${order.id}`} key={order.id} className="account-list-row auction-status-row">
              <div><small>{order.order_number}</small><strong>{relationTitle(order.auctions)}</strong><span>ครบกำหนด {dateTime(order.payment_due_at)}</span></div>
              <div><strong>{formatBaht(Number(order.total_amount))}</strong><span className="auction-position won">{statusLabel[order.status] ?? order.status}</span></div>
            </Link>)}</div> : <div className="account-auction-empty"><strong>ยังไม่มีรายการที่ชนะ</strong><p>เมื่อชนะ ระบบจะสร้างคำสั่งซื้อให้อัตโนมัติ</p></div>}
          </section>
          <section className="panel account-auction-column lost">
            <div className="panel-heading"><div><h3>ไม่ชนะ</h3><p>รายการที่ปิดแล้วและไม่ได้สินค้า</p></div><span className="table-filter">{lostAuctions.length}</span></div>
            {lostAuctions.length > 0 ? <div className="account-list">{lostAuctions.map((auction) => <Link href={`/auctions/${auction.auctionId}`} key={auction.auctionId} className="account-list-row auction-status-row">
              <div><small>ปิด {dateTime(auction.endsAt)}</small><strong>{auction.title}</strong><span>ราคาสูงสุดของคุณ {formatBaht(auction.highestOwnBid)}</span></div>
              <div><strong>{formatBaht(auction.currentPrice)}</strong><span className="auction-position lost">ราคาปิด</span></div>
            </Link>)}</div> : <div className="account-auction-empty"><strong>ยังไม่มีรายการที่ไม่ชนะ</strong><p>รายการที่จบแล้วจะถูกแยกมาแสดงตรงนี้</p></div>}
          </section>
        </div>
      </section>
      <div className="account-wide" id="notifications">
        <section className="panel account-panel">
          <div className="panel-heading"><div><h2>การแจ้งเตือน</h2><p>แจ้งเตือนภายในเว็บไซต์</p></div><span className="table-filter">{notifications.filter((item) => !item.read_at).length} ใหม่</span></div>
          {notifications.length > 0 ? <div className="account-list">{notifications.map((item) => <article className={`account-list-row notification-row ${item.read_at ? "read" : ""}`} key={item.id}>
            <div><small>{dateTime(item.created_at)}</small><strong>{item.title}</strong><span>{item.message}</span></div>
          </article>)}</div> : <div className="admin-empty"><p>ยังไม่มีการแจ้งเตือน</p></div>}
        </section>
      </div>
      <section className="panel account-panel bid-history-panel">
        <div className="panel-heading"><div><h2>ประวัติการเสนอราคา</h2><p>30 ครั้งล่าสุด แสดงเวลาและจำนวนเงินจากฐานข้อมูล</p></div><span className="table-filter">{recentBids.length}</span></div>
        {recentBids.length > 0 ? <div className="account-list">{recentBids.map((bid) => <Link href={`/auctions/${bid.auction_id}`} key={bid.id} className="account-list-row">
          <div><small>{dateTime(bid.created_at)}</small><strong>{relationTitle(bid.auctions)}</strong></div><div><strong>{formatBaht(Number(bid.amount))}</strong><span>ดูรายการ →</span></div>
        </Link>)}</div> : <div className="admin-empty"><p>ยังไม่มีประวัติการเสนอราคา</p></div>}
      </section>
    </main>
  );
}
