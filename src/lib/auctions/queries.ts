import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export type AuctionView = {
  id: string;
  title: string;
  description: string;
  category: string;
  status: "scheduled" | "live" | "ended" | "settled";
  openingPrice: number;
  currentPrice: number;
  minIncrement: number;
  buyerFeeRateBps: number;
  buyerFeeVatRateBps: number;
  bidCount: number;
  startsAt: string;
  endsAt: string;
  extensionWindowSeconds: number;
  extensionDurationSeconds: number;
  version: number;
  icon: string;
  tone: string;
  evidenceNote: string;
  itemYear: string;
  itemModel: string;
  itemSize: string;
  conditionSummary: string;
  expertNotes: string;
};

export type AuctionMediaView = {
  id: string;
  kind: "cover" | "front" | "back" | "gallery" | "defect" | "evidence";
  position: number;
  url: string;
};

export type AuctionOutcome = {
  hasWinner: boolean;
  isCurrentUserWinner: boolean;
  winningAmount: number | null;
  reserveMet: boolean;
  finalizedAt: string;
  orderId: string | null;
  orderNumber: string | null;
  totalAmount: number | null;
};

const now = Date.now();
export const auctionCategories = ["เหรียญกษาปณ์", "ธนบัตร", "พระเครื่อง", "การ์ดสะสม", "ของเก่า"] as const;
const customerMarketplaceStatuses: AuctionView["status"][] = ["scheduled", "live"];
const customerDetailStatuses: AuctionView["status"][] = ["scheduled", "live", "ended", "settled"];

export type MarketplaceAuctionFilters = {
  query?: string;
  category?: string;
  page?: number;
  pageSize?: number;
};

function normalizedMarketplaceFilters(filters: MarketplaceAuctionFilters) {
  const query = (filters.query ?? "")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{M}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  const category = auctionCategories.includes(filters.category as (typeof auctionCategories)[number])
    ? filters.category!
    : "";
  const page = Number.isSafeInteger(filters.page) && Number(filters.page) > 0 ? Number(filters.page) : 1;
  const pageSize = Math.min(24, Math.max(4, Number.isSafeInteger(filters.pageSize) ? Number(filters.pageSize) : 12));
  return { query, category, page, pageSize };
}

export const demoAuctions: AuctionView[] = [
  { id: "demo-coin-001", category: "เหรียญกษาปณ์", icon: "๑", title: "เหรียญรัชกาลที่ 5 เนื้อเงิน", description: "รายการตัวอย่างสำหรับทดสอบหน้าจอ กรุณาตรวจภาพด้านหน้า ด้านหลัง ตำหนิ น้ำหนัก และหลักฐานแหล่งที่มาก่อนประมูลจริง", evidenceNote: "ผ่านการตรวจข้อมูลเบื้องต้น", itemYear: "รัชกาลที่ 5", itemModel: "หนึ่งบาท เนื้อเงิน", itemSize: "โปรดตรวจข้อมูลสินค้าจริง", conditionSummary: "รายการตัวอย่าง", expertNotes: "ต้องตรวจสินค้าจริงก่อนเผยแพร่", openingPrice: 1000000, currentPrice: 1250000, minIncrement: 10000, buyerFeeRateBps: 1000, buyerFeeVatRateBps: 700, bidCount: 18, status: "live", startsAt: new Date(now - 3_600_000).toISOString(), endsAt: new Date(now + 6_133_000).toISOString(), extensionWindowSeconds: 120, extensionDurationSeconds: 120, version: 18, tone: "coin" },
  { id: "demo-note-009", category: "ธนบัตร", icon: "฿", title: "ธนบัตรแบบ 9 เลขสวย", description: "รายการตัวอย่างพร้อมตำแหน่งสำหรับภาพหน้า–หลัง หมายเลข ลายน้ำ ลายเซ็น และตำหนิที่มองเห็นได้", evidenceNote: "มีภาพหน้า–หลังและตำหนิ", itemYear: "แบบ 9", itemModel: "เลขสวย", itemSize: "ขนาดมาตรฐาน", conditionSummary: "รายการตัวอย่าง", expertNotes: "ตรวจหมายเลข ลายน้ำ และลายเซ็นจากภาพจริง", openingPrice: 500000, currentPrice: 820000, minIncrement: 10000, buyerFeeRateBps: 1000, buyerFeeVatRateBps: 700, bidCount: 11, status: "live", startsAt: new Date(now - 3_600_000).toISOString(), endsAt: new Date(now + 11_744_000).toISOString(), extensionWindowSeconds: 120, extensionDurationSeconds: 120, version: 11, tone: "note" },
  { id: "demo-amulet-014", category: "พระเครื่อง", icon: "◈", title: "พระสมเด็จ พร้อมบัตรรับรอง", description: "รายการตัวอย่างเท่านั้น บัตรรับรองและข้อมูลความแท้ต้องตรวจจากเอกสารต้นฉบับและผู้เชี่ยวชาญก่อนเผยแพร่จริง", evidenceNote: "รอตรวจเอกสารฉบับจริง", itemYear: "ไม่ระบุ", itemModel: "พระสมเด็จ", itemSize: "โปรดตรวจข้อมูลสินค้าจริง", conditionSummary: "รายการตัวอย่าง", expertNotes: "บัตรและสินค้าต้องตรวจจากต้นฉบับ", openingPrice: 1800000, currentPrice: 2400000, minIncrement: 10000, buyerFeeRateBps: 1000, buyerFeeVatRateBps: 700, bidCount: 26, status: "live", startsAt: new Date(now - 7_200_000).toISOString(), endsAt: new Date(now + 18_489_000).toISOString(), extensionWindowSeconds: 120, extensionDurationSeconds: 120, version: 26, tone: "amulet" },
  { id: "demo-card-021", category: "การ์ดสะสม", icon: "◆", title: "การ์ดเกมเกรด 10 รุ่นแรก", description: "รายการตัวอย่างสำหรับแสดงข้อมูลกล่องเกรด หมายเลขรับรอง สภาพขอบ มุม ผิวหน้า และประวัติการครอบครอง", evidenceNote: "ซีลกล่องและหมายเลขชัดเจน", itemYear: "รุ่นแรก", itemModel: "เกรด 10", itemSize: "อยู่ในกล่องเกรด", conditionSummary: "รายการตัวอย่าง", expertNotes: "ตรวจซีลและหมายเลขกับผู้ให้บริการเกรด", openingPrice: 400000, currentPrice: 670000, minIncrement: 10000, buyerFeeRateBps: 1000, buyerFeeVatRateBps: 700, bidCount: 9, status: "live", startsAt: new Date(now - 1_800_000).toISOString(), endsAt: new Date(now + 30_981_000).toISOString(), extensionWindowSeconds: 120, extensionDurationSeconds: 120, version: 9, tone: "card" },
];

function displayForCategory(category: string) {
  if (category.includes("ธนบัตร")) return { icon: "฿", tone: "note" };
  if (category.includes("พระ")) return { icon: "◈", tone: "amulet" };
  if (category.includes("การ์ด")) return { icon: "◆", tone: "card" };
  return { icon: "๑", tone: "coin" };
}

function mapAuction(row: Record<string, unknown>): AuctionView {
  const category = String(row.category ?? "ของสะสม");
  const display = displayForCategory(category);
  return {
    id: String(row.id),
    title: String(row.title),
    description: String(row.description ?? ""),
    category,
    status: row.status as AuctionView["status"],
    openingPrice: Number(row.opening_price),
    currentPrice: Number(row.current_price),
    minIncrement: Number(row.min_increment),
    buyerFeeRateBps: Number(row.buyer_fee_rate_bps ?? 1000),
    buyerFeeVatRateBps: Number(row.buyer_fee_vat_rate_bps ?? 700),
    bidCount: Number(row.bid_count),
    startsAt: String(row.starts_at),
    endsAt: String(row.ends_at),
    extensionWindowSeconds: Number(row.extension_window_seconds ?? 0),
    extensionDurationSeconds: Number(row.extension_duration_seconds ?? 0),
    version: Number(row.version),
    evidenceNote: "ข้อมูลจากฐานข้อมูลกลาง",
    itemYear: String(row.item_year ?? "ยังไม่ระบุ"),
    itemModel: String(row.item_model ?? "ยังไม่ระบุ"),
    itemSize: String(row.item_size ?? "ยังไม่ระบุ"),
    conditionSummary: String(row.condition_summary ?? "ยังไม่ระบุ"),
    expertNotes: String(row.expert_notes ?? "ยังไม่ระบุ"),
    ...display,
  };
}

const selection = "id,title,description,category,status,opening_price,current_price,min_increment,buyer_fee_rate_bps,buyer_fee_vat_rate_bps,bid_count,starts_at,ends_at,extension_window_seconds,extension_duration_seconds,version";
const trustSelection = `${selection},item_year,item_model,item_size,condition_summary,expert_notes`;

async function reconcileAuctionLifecycle() {
  const supabase = await createClient();
  const [{ error: openError }, { error: closeError }] = await Promise.all([
    supabase.rpc("open_due_auctions"),
    supabase.rpc("close_due_auctions"),
  ]);
  if (openError) console.error("Unable to open due auctions", { code: openError.code });
  if (closeError) console.error("Unable to close due auctions", { code: closeError.code });
  return supabase;
}

export async function getFeaturedAuctions(filters: MarketplaceAuctionFilters = {}) {
  const normalized = normalizedMarketplaceFilters(filters);
  const from = (normalized.page - 1) * normalized.pageSize;
  const to = from + normalized.pageSize - 1;

  if (!isSupabaseConfigured()) {
    const filtered = demoAuctions.filter((auction) => {
      const matchesCategory = !normalized.category || auction.category === normalized.category;
      const haystack = `${auction.title} ${auction.description} ${auction.category}`.toLocaleLowerCase("th-TH");
      const matchesQuery = !normalized.query || haystack.includes(normalized.query.toLocaleLowerCase("th-TH"));
      return matchesCategory && matchesQuery;
    });
    return {
      auctions: filtered.slice(from, to + 1),
      isDemo: true,
      total: filtered.length,
      page: normalized.page,
      pageSize: normalized.pageSize,
      totalPages: Math.ceil(filtered.length / normalized.pageSize),
      query: normalized.query,
      category: normalized.category,
    };
  }
  const supabase = await reconcileAuctionLifecycle();
  let currentRequest = supabase
    .from("auctions")
    .select(trustSelection, { count: "exact" })
    .in("status", customerMarketplaceStatuses)
    .order("ends_at", { ascending: true });
  if (normalized.category) currentRequest = currentRequest.eq("category", normalized.category);
  if (normalized.query) currentRequest = currentRequest.or(`title.ilike.%${normalized.query}%,description.ilike.%${normalized.query}%`);
  const { data, error, count } = await currentRequest.range(from, to);

  if (!error) {
    const total = count ?? 0;
    return { auctions: (data ?? []).map((row) => mapAuction(row)), isDemo: false, total, page: normalized.page, pageSize: normalized.pageSize, totalPages: Math.ceil(total / normalized.pageSize), query: normalized.query, category: normalized.category };
  }

  let legacyRequest = supabase
    .from("auctions")
    .select(selection, { count: "exact" })
    .in("status", customerMarketplaceStatuses)
    .order("ends_at", { ascending: true });
  if (normalized.category) legacyRequest = legacyRequest.eq("category", normalized.category);
  if (normalized.query) legacyRequest = legacyRequest.or(`title.ilike.%${normalized.query}%,description.ilike.%${normalized.query}%`);
  const legacy = await legacyRequest.range(from, to);
  if (legacy.error) {
    console.error("Unable to load auctions", { code: legacy.error.code });
    return { auctions: [] as AuctionView[], isDemo: false, total: 0, page: normalized.page, pageSize: normalized.pageSize, totalPages: 0, query: normalized.query, category: normalized.category };
  }
  const total = legacy.count ?? 0;
  return { auctions: (legacy.data ?? []).map((row) => mapAuction(row)), isDemo: false, total, page: normalized.page, pageSize: normalized.pageSize, totalPages: Math.ceil(total / normalized.pageSize), query: normalized.query, category: normalized.category };
}

export async function getAuctionById(id: string) {
  if (!isSupabaseConfigured()) {
    return demoAuctions.find((auction) => auction.id === id) ?? null;
  }
  const supabase = await reconcileAuctionLifecycle();
  const { data, error } = await supabase
    .from("auctions")
    .select(trustSelection)
    .eq("id", id)
    .in("status", customerDetailStatuses)
    .single();
  if (!error && data) return mapAuction(data);
  const legacy = await supabase
    .from("auctions")
    .select(selection)
    .eq("id", id)
    .in("status", customerDetailStatuses)
    .single();
  if (legacy.error || !legacy.data) return null;
  return mapAuction(legacy.data);
}

export async function getAuctionMedia(auctionId: string): Promise<AuctionMediaView[]> {
  if (!isSupabaseConfigured() || !/^[0-9a-f-]{36}$/i.test(auctionId)) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("auction_media")
    .select("id,object_path,media_kind,position")
    .eq("auction_id", auctionId)
    .order("position", { ascending: true });
  if (error || !data?.length) return [];

  const signed = await Promise.all(data.map(async (item) => {
    const { data: urlData, error: urlError } = await supabase.storage
      .from("auction-media")
      .createSignedUrl(String(item.object_path), 3600);
    if (urlError || !urlData?.signedUrl) return null;
    return {
      id: String(item.id),
      kind: item.media_kind as AuctionMediaView["kind"],
      position: Number(item.position),
      url: urlData.signedUrl,
    };
  }));

  return signed.filter((item): item is AuctionMediaView => item !== null);
}

export async function getAuctionOutcome(auctionId: string): Promise<AuctionOutcome | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  const [{ data: result, error }, { data: userData }] = await Promise.all([
    supabase
      .from("auction_results")
      .select("winner_id,winning_amount,reserve_met,finalized_at")
      .eq("auction_id", auctionId)
      .maybeSingle(),
    supabase.auth.getUser(),
  ]);
  if (error || !result) return null;
  const isCurrentUserWinner = Boolean(result.winner_id && result.winner_id === userData.user?.id);
  const { data: order } = isCurrentUserWinner
    ? await supabase
      .from("orders")
      .select("id,order_number,total_amount")
      .eq("auction_id", auctionId)
      .maybeSingle()
    : { data: null };
  return {
    hasWinner: Boolean(result.winner_id),
    isCurrentUserWinner,
    winningAmount: result.winning_amount === null ? null : Number(result.winning_amount),
    reserveMet: Boolean(result.reserve_met),
    finalizedAt: String(result.finalized_at),
    orderId: order?.id ?? null,
    orderNumber: order?.order_number ?? null,
    totalAmount: order?.total_amount === undefined ? null : Number(order.total_amount),
  };
}

export function formatBaht(satang: number) {
  return new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
    maximumFractionDigits: satang % 100 === 0 ? 0 : 2,
  }).format(satang / 100);
}
