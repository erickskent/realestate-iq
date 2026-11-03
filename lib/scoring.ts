import type { DealAnalysis } from "./calculations.ts";
import { formatCurrency, formatPercentShort } from "./format.ts";

export type ScoreCategory = "Strong" | "Moderate" | "High Risk";
export type ScoreFactorId = "cashFlow" | "cashOnCash" | "capRate" | "expenseRatio" | "debtCoverage";

export type ScoreFactor = {
  id: ScoreFactorId;
  label: string;
  maxPoints: number;
  /** Points earned, or null when the factor can't be measured and is left out of the score. */
  points: number | null;
  /** The deal's measured value for this factor, or null when it can't be calculated. */
  value: number | null;
  rule: string;
  note?: string;
};

export type DealScore = {
  score: number;
  category: ScoreCategory;
  factors: ScoreFactor[];
  /** True when a factor couldn't be measured and the remaining points were scaled up to 100. */
  scaled: boolean;
};

/** Minimum (rounded) score for each category. Anything below `moderate` is High Risk. */
export const CATEGORY_THRESHOLDS = { strong: 70, moderate: 45 } as const;

/**
 * Each factor earns 0 points at `zeroAt`, full points at `fullAt`, and a straight-line share in between.
 * Ratios are decimals (0.1 = 10%).
 */
export const SCORING_RULES = {
  cashFlow: { label: "Monthly cash flow", maxPoints: 30, zeroAt: 0, fullAt: 400 },
  cashOnCash: { label: "Cash-on-cash return", maxPoints: 25, zeroAt: 0, fullAt: 0.1 },
  capRate: { label: "Cap rate", maxPoints: 15, zeroAt: 0.03, fullAt: 0.08 },
  expenseRatio: { label: "Expense ratio", maxPoints: 15, zeroAt: 0.6, fullAt: 0.35 },
  debtCoverage: { label: "Debt coverage (NOI ÷ mortgage)", maxPoints: 15, zeroAt: 1.0, fullAt: 1.25 },
} as const;

export const SCORING_RULE_TEXT: Record<ScoreFactorId, string> = {
  cashFlow: `0 pts at ${formatCurrency(SCORING_RULES.cashFlow.zeroAt)}/mo or less, full at ${formatCurrency(SCORING_RULES.cashFlow.fullAt)}/mo or more`,
  cashOnCash: `0 pts at ${formatPercentShort(SCORING_RULES.cashOnCash.zeroAt)} or less, full at ${formatPercentShort(SCORING_RULES.cashOnCash.fullAt)} or more`,
  capRate: `0 pts at ${formatPercentShort(SCORING_RULES.capRate.zeroAt)} or less, full at ${formatPercentShort(SCORING_RULES.capRate.fullAt)} or more`,
  expenseRatio: `Full pts at ${formatPercentShort(SCORING_RULES.expenseRatio.fullAt)} or less, 0 pts at ${formatPercentShort(SCORING_RULES.expenseRatio.zeroAt)} or more`,
  debtCoverage: `0 pts at ${SCORING_RULES.debtCoverage.zeroAt.toFixed(2)}× or less, full at ${SCORING_RULES.debtCoverage.fullAt.toFixed(2)}× or more`,
};

/** Share of credit (0–1) on a straight line from `zeroAt` to `fullAt`. Works whether higher or lower is better. */
export function linearCredit(value: number, zeroAt: number, fullAt: number): number {
  const share = (value - zeroAt) / (fullAt - zeroAt);
  return Math.min(1, Math.max(0, share));
}

export function categoryForScore(score: number): ScoreCategory {
  if (score >= CATEGORY_THRESHOLDS.strong) return "Strong";
  if (score >= CATEGORY_THRESHOLDS.moderate) return "Moderate";
  return "High Risk";
}

/** Operating expenses as a share of the rent actually collected, or null when no rent is collected. */
export function expenseRatio(analysis: DealAnalysis): number | null {
  const { operatingExpenses, effectiveIncome } = analysis.monthly;
  return effectiveIncome > 0 ? operatingExpenses / effectiveIncome : null;
}

/** NOI ÷ mortgage payment (debt service coverage ratio), or null when there's no mortgage. */
export function debtCoverage(analysis: DealAnalysis): number | null {
  const { noi, principalAndInterest } = analysis.monthly;
  return principalAndInterest > 0 ? noi / principalAndInterest : null;
}

function scoredFactor(id: ScoreFactorId, value: number): ScoreFactor {
  const rule = SCORING_RULES[id];
  return {
    id,
    label: rule.label,
    maxPoints: rule.maxPoints,
    points: rule.maxPoints * linearCredit(value, rule.zeroAt, rule.fullAt),
    value,
    rule: SCORING_RULE_TEXT[id],
  };
}

export function scoreDeal(analysis: DealAnalysis): DealScore {
  const factors: ScoreFactor[] = [scoredFactor("cashFlow", analysis.monthly.cashFlow)];

  factors.push(
    analysis.cashOnCash === null
      ? {
          id: "cashOnCash",
          label: SCORING_RULES.cashOnCash.label,
          maxPoints: SCORING_RULES.cashOnCash.maxPoints,
          points: null,
          value: null,
          rule: SCORING_RULE_TEXT.cashOnCash,
          note: "Not scored: no cash is invested, so this return can't be calculated.",
        }
      : scoredFactor("cashOnCash", analysis.cashOnCash),
  );

  factors.push(
    analysis.capRate === null
      ? { ...scoredFactor("capRate", 0), value: null, note: "No purchase price, so the cap rate can't be calculated." }
      : scoredFactor("capRate", analysis.capRate),
  );

  const ratio = expenseRatio(analysis);
  factors.push(
    ratio === null
      ? { ...scoredFactor("expenseRatio", Infinity), value: null, note: "No rent is collected, so this earns no points." }
      : scoredFactor("expenseRatio", ratio),
  );

  const coverage = debtCoverage(analysis);
  factors.push(
    coverage === null
      ? { ...scoredFactor("debtCoverage", Infinity), value: null, note: "No mortgage, so there's no loan payment to cover. Full points." }
      : scoredFactor("debtCoverage", coverage),
  );

  let earned = 0;
  let available = 0;
  for (const factor of factors) {
    if (factor.points === null) continue;
    earned += factor.points;
    available += factor.maxPoints;
  }

  const score = available > 0 ? Math.round((earned / available) * 100) : 0;
  return { score, category: categoryForScore(score), factors, scaled: available < 100 };
}
