export const BUYER_FEE_RATE_BPS = 1000;
export const BUYER_FEE_VAT_RATE_BPS = 700;

export function formatBaht(satang: number) {
  return new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(satang / 100);
}

export function bidIncrementFor(currentPriceSatang: number) {
  if (currentPriceSatang < 100_000) return 1_000;
  if (currentPriceSatang < 500_000) return 5_000;
  return 10_000;
}

export function calculateBuyerTotals(
  winningAmountSatang: number,
  feeRateBps = BUYER_FEE_RATE_BPS,
  vatRateBps = BUYER_FEE_VAT_RATE_BPS,
) {
  const buyerFeeAmount = Math.floor((winningAmountSatang * feeRateBps + 5_000) / 10_000);
  const buyerFeeVatAmount = Math.floor((buyerFeeAmount * vatRateBps + 5_000) / 10_000);
  return {
    buyerFeeAmount,
    buyerFeeVatAmount,
    totalAmount: winningAmountSatang + buyerFeeAmount + buyerFeeVatAmount,
  };
}
