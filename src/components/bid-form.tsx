"use client";

import { useActionState, useMemo, useState } from "react";
import { placeBid, type BidActionState } from "@/app/(customer)/auctions/[id]/actions";
import { calculateBuyerTotals, formatBaht } from "@/lib/auctions/pricing";

const initialState: BidActionState = {};

export function BidForm({
  auctionId,
  minimumBaht,
  requestKey,
  buyerFeeRateBps,
  buyerFeeVatRateBps,
  disabled = false,
}: {
  auctionId: string;
  minimumBaht: string;
  requestKey: string;
  buyerFeeRateBps: number;
  buyerFeeVatRateBps: number;
  disabled?: boolean;
}) {
  const [state, action, pending] = useActionState(placeBid, initialState);
  const [amount, setAmount] = useState(minimumBaht);
  const totals = useMemo(() => {
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return calculateBuyerTotals(Math.round(parsed * 100), buyerFeeRateBps, buyerFeeVatRateBps);
  }, [amount, buyerFeeRateBps, buyerFeeVatRateBps]);

  return (
    <form action={action} className="bid-form" id="bid-panel">
      <input name="auctionId" type="hidden" value={auctionId} />
      <input name="requestKey" type="hidden" value={requestKey} />
      <label htmlFor="bid-amount">ราคาเสนอของคุณ (บาท)</label>
      <div className="bid-input-row"><span>฿</span><input disabled={disabled} id="bid-amount" inputMode="decimal" min={minimumBaht} name="amount" onChange={(event) => setAmount(event.target.value)} placeholder={minimumBaht} required step="0.01" type="number" value={amount} /><button className="button button-gold" disabled={disabled || pending} type="submit">{pending ? "กำลังตรวจราคา..." : "ยืนยันเสนอราคา"}</button></div>
      <small>เสนออย่างน้อย {minimumBaht} บาท · ระบบใช้เวลาจากฐานข้อมูลตัดสิน</small>
      {totals && <div className="bid-total-preview" aria-live="polite">
        <span><small>ราคาที่เสนอ</small><strong>{formatBaht(Math.round(Number(amount) * 100))}</strong></span>
        <span><small>ค่าธรรมเนียม 10%</small><strong>{formatBaht(totals.buyerFeeAmount)}</strong></span>
        <span><small>VAT 7% ของค่าธรรมเนียม</small><strong>{formatBaht(totals.buyerFeeVatAmount)}</strong></span>
        <span className="total"><small>ยอดรวม (ยังไม่รวมค่าส่ง)</small><strong>{formatBaht(totals.totalAmount)}</strong></span>
      </div>}
      {state.message && <p className={state.ok ? "bid-success" : "form-error"} role="status">{state.message}</p>}
    </form>
  );
}
