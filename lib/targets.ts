import { analyzeDeal, monthlyPrincipalAndInterest, type DealInputs } from "./calculations.ts";
import { formatCurrency, formatPercentShort } from "./format.ts";

export type TargetResult =
  /** `value` is the target; `current` is the deal's value today, for comparison. */
  | { status: "ok"; value: number; current: number }
  /** No value of this input can reach the target. */
  | { status: "impossible"; reason: string }
  /** The question doesn't apply to this deal. */
  | { status: "undefined"; reason: string }
  /** The target is met no matter what value this input takes. */
  | { status: "always"; reason: string };

export const RENT_TARGETS = [0, 300] as const;

const EPSILON = 1e-9;

/** Share of each rent dollar left after vacancy, maintenance, and management, which are all set as % of rent. */
export function rentKeepShare(inputs: DealInputs): number {
  return 1 - (inputs.vacancyPct + inputs.maintenancePct + inputs.managementPct) / 100;
}

/** Monthly costs that don't change with rent: taxes, insurance, other expenses, and the mortgage payment. */
export function fixedMonthlyCosts(inputs: DealInputs): number {
  const loanAmount = inputs.purchasePrice * (1 - inputs.downPaymentPct / 100);
  return (
    inputs.annualTaxes / 12 +
    inputs.annualInsurance / 12 +
    inputs.otherMonthly +
    monthlyPrincipalAndInterest(loanAmount, inputs.interestRatePct, inputs.termYears)
  );
}

/**
 * Monthly rent needed for a target monthly cash flow, keeping every other input the same.
 * Cash flow = rent × keep share − fixed costs, so rent = (target + fixed costs) ÷ keep share.
 */
export function rentForCashFlow(inputs: DealInputs, targetCashFlow: number): TargetResult {
  const keepShare = rentKeepShare(inputs);
  const needed = targetCashFlow + fixedMonthlyCosts(inputs);
  const rentPctTotal = inputs.vacancyPct + inputs.maintenancePct + inputs.managementPct;

  if (keepShare <= EPSILON) {
    if (Math.abs(keepShare) <= EPSILON && needed <= EPSILON) {
      return { status: "always", reason: "With no fixed costs, cash flow is the same at any rent." };
    }
    return {
      status: "impossible",
      reason: `Vacancy, maintenance, and management add up to ${formatPercentShort(rentPctTotal / 100)} of rent, so every extra rent dollar is used up by rent-based costs. No rent level reaches this target.`,
    };
  }

  return { status: "ok", value: Math.max(0, needed / keepShare), current: inputs.monthlyRent };
}

/**
 * Highest purchase price that still produces the target monthly cash flow, keeping the down payment %,
 * interest rate, term, rent, and every expense the same. Taxes and insurance don't change with price here.
 */
export function maxPriceForCashFlow(inputs: DealInputs, targetCashFlow: number): TargetResult {
  const loanShare = 1 - inputs.downPaymentPct / 100;
  if (loanShare <= EPSILON) {
    return {
      status: "undefined",
      reason: "With 100% down there's no mortgage, so the purchase price doesn't change monthly cash flow in this model.",
    };
  }

  const noi = analyzeDeal(inputs).monthly.noi;
  const availableForMortgage = noi - targetCashFlow;
  if (availableForMortgage < 0) {
    return {
      status: "impossible",
      reason: `Net operating income is ${formatCurrency(noi)}/mo, below the ${formatCurrency(targetCashFlow)}/mo target before any mortgage payment. A lower price can't close that gap because taxes and insurance are entered separately.`,
    };
  }

  const paymentPerLoanDollar = monthlyPrincipalAndInterest(1, inputs.interestRatePct, inputs.termYears);
  const maxLoan = availableForMortgage / paymentPerLoanDollar;
  return { status: "ok", value: maxLoan / loanShare, current: inputs.purchasePrice };
}

/** Highest vacancy rate (as a ratio) before monthly cash flow drops to $0, keeping everything else the same. */
export function breakEvenVacancy(inputs: DealInputs): TargetResult {
  if (inputs.monthlyRent <= 0) {
    return { status: "undefined", reason: "No rent is entered, so there's no vacancy to measure." };
  }

  const otherRentShare = (inputs.maintenancePct + inputs.managementPct) / 100;
  const vacancy = 1 - otherRentShare - fixedMonthlyCosts(inputs) / inputs.monthlyRent;

  if (vacancy < 0) {
    return {
      status: "impossible",
      reason: "Cash flow is below $0 even with the property rented every month (0% vacancy).",
    };
  }
  if (vacancy >= 1) {
    return { status: "always", reason: "Cash flow stays at or above $0 even if the property is never rented." };
  }
  return { status: "ok", value: vacancy, current: inputs.vacancyPct / 100 };
}
