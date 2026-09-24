import "server-only";

import { createClient } from "@/lib/supabase/server";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const BANGKOK_OFFSET = "+07:00";
const DAY_MS = 86_400_000;
const MAX_RANGE_DAYS = 366;
const MAX_EXPORT_ROWS = 25_000;
const PAGE_SIZE = 1_000;

export type OrderReportRange = {
  from: string;
  to: string;
  fromIso: string;
  toExclusiveIso: string;
  days: number;
};

export type OrderReportRow = {
  id: string;
  orderNumber: string;
  createdAt: string;
  auctionTitle: string;
  category: string;
  buyerName: string;
  status: string;
  paymentReviewState: string;
  winningAmount: number;
  buyerFeeAmount: number;
  buyerFeeVatAmount: number;
  shippingAmount: number;
  totalAmount: number;
  paymentDueAt: string;
  carrier: string;
  trackingNumber: string;
  shippedAt: string | null;
};

export type OrderReport = {
  range: OrderReportRange;
  rows: OrderReportRow[];
  summary: {
    orderCount: number;
    auctionValue: number;
    buyerFees: number;
    feeVat: number;
    feesIncludingVat: number;
    approvedPaymentCount: number;
    approvedPaymentTotal: number;
    pendingPaymentCount: number;
    pendingPaymentTotal: number;
    pendingShipmentCount: number;
    pendingShipmentTotal: number;
  };
};

type RawOrder = {
  id: string;
  order_number: string;
  buyer_id: string;
  status: string;
  created_at: string;
  winning_amount: number;
  buyer_fee_amount: number;
  buyer_fee_vat_amount: number;
  shipping_amount: number;
  total_amount: number;
  payment_due_at: string;
  payment_review_state: string;
  carrier: string | null;
  tracking_number: string | null;
  shipped_at: string | null;
  auctions: { title: string; category: string } | { title: string; category: string }[] | null;
};

export class OrderReportError extends Error {
  constructor(public code: "unauthorized" | "forbidden" | "invalid_range" | "too_many_rows" | "query_failed") {
    super(code);
  }
}

function formatBangkokDate(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function defaultOrderReportRange(now = new Date()) {
  const to = formatBangkokDate(now);
  const toDate = new Date(`${to}T00:00:00${BANGKOK_OFFSET}`);
  return { from: formatBangkokDate(new Date(toDate.getTime() - 29 * DAY_MS)), to };
}

export function resolveOrderReportRange(fromValue?: string | null, toValue?: string | null): OrderReportRange {
  const defaults = defaultOrderReportRange();
  const from = fromValue && DATE_PATTERN.test(fromValue) ? fromValue : defaults.from;
  const to = toValue && DATE_PATTERN.test(toValue) ? toValue : defaults.to;
  const fromDate = new Date(`${from}T00:00:00${BANGKOK_OFFSET}`);
  const toDate = new Date(`${to}T00:00:00${BANGKOK_OFFSET}`);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || fromDate > toDate) {
    throw new OrderReportError("invalid_range");
  }
  const days = Math.floor((toDate.getTime() - fromDate.getTime()) / DAY_MS) + 1;
  if (days > MAX_RANGE_DAYS) throw new OrderReportError("invalid_range");
  return {
    from,
    to,
    fromIso: fromDate.toISOString(),
    toExclusiveIso: new Date(toDate.getTime() + DAY_MS).toISOString(),
    days,
  };
}

async function requireAdmin() {
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) throw new OrderReportError("unauthorized");
  const { data: allowed, error: roleError } = await supabase.rpc("has_role", {
    p_role: "admin",
    p_user_id: userData.user.id,
  });
  if (roleError || !allowed) throw new OrderReportError("forbidden");
  return supabase;
}

export async function loadOrderReport(range: OrderReportRange): Promise<OrderReport> {
  const supabase = await requireAdmin();
  const rows: RawOrder[] = [];
  let expectedCount: number | null = null;

  for (let offset = 0; offset < MAX_EXPORT_ROWS; offset += PAGE_SIZE) {
    const { data, error, count } = await supabase
      .from("orders")
      .select("id,order_number,buyer_id,status,created_at,winning_amount,buyer_fee_amount,buyer_fee_vat_amount,shipping_amount,total_amount,payment_due_at,payment_review_state,carrier,tracking_number,shipped_at,auctions(title,category)", { count: offset === 0 ? "exact" : undefined })
      .gte("created_at", range.fromIso)
      .lt("created_at", range.toExclusiveIso)
      .order("created_at", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new OrderReportError("query_failed");
    if (offset === 0) {
      expectedCount = count;
      if ((expectedCount ?? 0) > MAX_EXPORT_ROWS) throw new OrderReportError("too_many_rows");
    }
    const page = (data ?? []) as RawOrder[];
    rows.push(...page);
    if (page.length < PAGE_SIZE || rows.length === expectedCount) break;
  }

  const buyerIds = [...new Set(rows.map((row) => row.buyer_id))];
  const buyerNameById = new Map<string, string>();
  for (let offset = 0; offset < buyerIds.length; offset += 200) {
    const ids = buyerIds.slice(offset, offset + 200);
    const { data, error } = await supabase.from("profiles").select("id,display_name").in("id", ids);
    if (error) throw new OrderReportError("query_failed");
    for (const profile of data ?? []) buyerNameById.set(profile.id, profile.display_name?.trim() || "สมาชิก BBK");
  }

  const reportRows: OrderReportRow[] = rows.map((row) => {
    const auction = Array.isArray(row.auctions) ? row.auctions[0] : row.auctions;
    return {
      id: row.id,
      orderNumber: row.order_number,
      createdAt: row.created_at,
      auctionTitle: auction?.title ?? "รายการประมูล",
      category: auction?.category ?? "ไม่ระบุหมวด",
      buyerName: buyerNameById.get(row.buyer_id) ?? "สมาชิก BBK",
      status: row.status,
      paymentReviewState: row.payment_review_state,
      winningAmount: Number(row.winning_amount),
      buyerFeeAmount: Number(row.buyer_fee_amount),
      buyerFeeVatAmount: Number(row.buyer_fee_vat_amount),
      shippingAmount: Number(row.shipping_amount),
      totalAmount: Number(row.total_amount),
      paymentDueAt: row.payment_due_at,
      carrier: row.carrier ?? "",
      trackingNumber: row.tracking_number ?? "",
      shippedAt: row.shipped_at,
    };
  });

  const approvedPayments = reportRows.filter((row) => row.paymentReviewState === "approved");
  const pendingPayments = reportRows.filter((row) => row.status === "pending_payment");
  const pendingShipments = reportRows.filter((row) => row.status === "paid" || row.status === "preparing");
  const sum = (items: OrderReportRow[], key: keyof Pick<OrderReportRow, "winningAmount" | "buyerFeeAmount" | "buyerFeeVatAmount" | "shippingAmount" | "totalAmount">) =>
    items.reduce((total, item) => total + item[key], 0);

  return {
    range,
    rows: reportRows,
    summary: {
      orderCount: reportRows.length,
      auctionValue: sum(reportRows, "winningAmount"),
      buyerFees: sum(reportRows, "buyerFeeAmount"),
      feeVat: sum(reportRows, "buyerFeeVatAmount"),
      feesIncludingVat: sum(reportRows, "buyerFeeAmount") + sum(reportRows, "buyerFeeVatAmount"),
      approvedPaymentCount: approvedPayments.length,
      approvedPaymentTotal: sum(approvedPayments, "totalAmount"),
      pendingPaymentCount: pendingPayments.length,
      pendingPaymentTotal: sum(pendingPayments, "totalAmount"),
      pendingShipmentCount: pendingShipments.length,
      pendingShipmentTotal: sum(pendingShipments, "totalAmount"),
    },
  };
}
