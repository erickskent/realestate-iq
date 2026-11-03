import { analyzeDeal, type DealAnalysis, type DealInputs } from "./calculations.ts";
import { scoreDeal } from "./scoring.ts";

export const SCENARIO_FIELDS = ["purchasePrice", "monthlyRent", "interestRatePct", "vacancyPct", "renovationBudget"] as const;
export type ScenarioField = (typeof SCENARIO_FIELDS)[number];
export type ScenarioChanges = Partial<Pick<DealInputs, ScenarioField>>;

/** Returns a new set of inputs with the scenario's changes applied. The original inputs are never modified. */
export function applyScenario(base: DealInputs, changes: ScenarioChanges): DealInputs {
  const result = { ...base };
  for (const field of SCENARIO_FIELDS) {
    const value = changes[field];
    if (value !== undefined) result[field] = value;
  }
  return result;
}

export type MetricComparison = {
  key: "monthlyCashFlow" | "annualCashFlow" | "capRate" | "cashOnCash" | "annualNoi" | "principalAndInterest" | "cashInvested" | "score";
  label: string;
  format: "currency" | "percent" | "score";
  /** Which direction is generally favorable for this metric, used only for color hints. */
  better: "higher" | "lower" | "neutral";
  original: number | null;
  scenario: number | null;
  /** Scenario − original, or null when either side can't be calculated. */
  change: number | null;
};

export type ScenarioComparison = {
  original: DealAnalysis;
  simulated: DealAnalysis;
  metrics: MetricComparison[];
};

export function compareScenario(base: DealInputs, scenario: DealInputs): ScenarioComparison {
  const original = analyzeDeal(base);
  const simulated = analyzeDeal(scenario);

  const metric = (
    key: MetricComparison["key"],
    label: string,
    format: MetricComparison["format"],
    better: MetricComparison["better"],
    pick: (analysis: DealAnalysis) => number | null,
  ): MetricComparison => {
    const before = pick(original);
    const after = pick(simulated);
    return { key, label, format, better, original: before, scenario: after, change: before === null || after === null ? null : after - before };
  };

  return {
    original,
    simulated,
    metrics: [
      metric("monthlyCashFlow", "Monthly cash flow", "currency", "higher", (a) => a.monthly.cashFlow),
      metric("annualCashFlow", "Annual cash flow", "currency", "higher", (a) => a.annualCashFlow),
      metric("capRate", "Cap rate", "percent", "higher", (a) => a.capRate),
      metric("cashOnCash", "Cash-on-cash return", "percent", "higher", (a) => a.cashOnCash),
      metric("annualNoi", "Net operating income (annual)", "currency", "higher", (a) => a.annualNoi),
      metric("principalAndInterest", "Mortgage principal & interest", "currency", "lower", (a) => a.monthly.principalAndInterest),
      metric("cashInvested", "Total cash invested", "currency", "neutral", (a) => a.cashInvested),
      metric("score", "Illustrative deal score", "score", "higher", (a) => scoreDeal(a).score),
    ],
  };
}
