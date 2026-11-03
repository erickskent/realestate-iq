const currencyFormat = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const percentFormat = new Intl.NumberFormat("en-US", { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const percentShortFormat = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });

/** Whole-dollar currency. Values that round to zero never show as "-$0". */
export function formatCurrency(value: number): string {
  return currencyFormat.format(Math.round(value) || 0);
}

/** Currency with an explicit sign, for showing changes ("+$120", "-$45"). */
export function formatCurrencyChange(value: number): string {
  const rounded = Math.round(value) || 0;
  return rounded > 0 ? `+${currencyFormat.format(rounded)}` : currencyFormat.format(rounded);
}

/** A ratio such as 0.0682 shown as "6.82%", or "N/A" when it can't be calculated. */
export function formatPercent(ratio: number | null): string {
  if (ratio === null) return "N/A";
  return percentFormat.format(Math.round(ratio * 10000) / 10000 || 0);
}

/** A ratio shown with at most one decimal place, e.g. 0.05 → "5%". */
export function formatPercentShort(ratio: number): string {
  return percentShortFormat.format(Math.round(ratio * 1000) / 1000 || 0);
}

/** Difference between two ratios in percentage points ("+1.20 pts"). */
export function formatPointsChange(ratioChange: number): string {
  const points = Math.round(ratioChange * 10000) / 100 || 0;
  return `${points > 0 ? "+" : ""}${points.toFixed(2)} pts`;
}
