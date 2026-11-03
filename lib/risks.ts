import type { DealAnalysis, DealInputs } from "./calculations.ts";
import { formatCurrency, formatPercent, formatPercentShort } from "./format.ts";
import { expenseRatio } from "./scoring.ts";
import { breakEvenVacancy } from "./targets.ts";

export type RiskSeverity = "high" | "medium" | "low";

export type RiskFinding = {
  id: "negative-cash-flow" | "thin-cash-flow" | "low-cash-on-cash" | "vacancy-exposure" | "low-vacancy-assumption" | "high-expense-ratio" | "unexpected-costs";
  severity: RiskSeverity;
  title: string;
  explanation: string;
};

/** Thresholds for each rule-based check. Ratios are decimals (0.05 = 5%). */
export const RISK_RULES = {
  thinCashFlowBelow: 200,
  lowCashOnCashBelow: 0.05,
  lowVacancyAssumptionBelow: 0.05,
  highExpenseRatioAbove: 0.5,
  repairShock: 5000,
  repairRecoveryMonthsAbove: 24,
  expenseShock: 0.1,
} as const;

const SEVERITY_ORDER: Record<RiskSeverity, number> = { high: 0, medium: 1, low: 2 };

export function analyzeRisks(inputs: DealInputs, analysis: DealAnalysis): RiskFinding[] {
  const findings: RiskFinding[] = [];
  const { monthly } = analysis;
  const cashFlow = monthly.cashFlow;

  if (cashFlow < 0) {
    findings.push({
      id: "negative-cash-flow",
      severity: "high",
      title: "Negative monthly cash flow",
      explanation: `After the ${formatCurrency(monthly.principalAndInterest)}/mo mortgage payment, the property loses about ${formatCurrency(-cashFlow)}/mo (${formatCurrency(-analysis.annualCashFlow)}/yr). That shortfall would come out of your own pocket.`,
    });
  } else if (cashFlow < RISK_RULES.thinCashFlowBelow) {
    findings.push({
      id: "thin-cash-flow",
      severity: "medium",
      title: "Thin cash flow",
      explanation: `Cash flow is ${formatCurrency(cashFlow)}/mo, under the ${formatCurrency(RISK_RULES.thinCashFlowBelow)}/mo cushion this tool looks for. That's ${formatPercentShort(monthly.grossRent > 0 ? cashFlow / monthly.grossRent : 0)} of the rent, so a small rise in costs or drop in rent could turn it negative.`,
    });
  }

  if (analysis.cashOnCash !== null && analysis.cashOnCash < RISK_RULES.lowCashOnCashBelow) {
    findings.push({
      id: "low-cash-on-cash",
      severity: "medium",
      title: "Low cash-on-cash return",
      explanation: `You'd put ${formatCurrency(analysis.cashInvested)} in up front and get ${formatCurrency(analysis.annualCashFlow)}/yr back in cash flow, a ${formatPercent(analysis.cashOnCash)} cash-on-cash return. That's below the ${formatPercentShort(RISK_RULES.lowCashOnCashBelow)} benchmark this tool uses.`,
    });
  }

  if (monthly.grossRent > 0 && analysis.annualCashFlow < monthly.grossRent) {
    const breakEven = breakEvenVacancy(inputs);
    const breakEvenText =
      breakEven.status === "ok"
        ? ` Cash flow reaches $0 at about ${formatPercentShort(breakEven.value)} vacancy, compared with the ${formatPercentShort(inputs.vacancyPct / 100)} you assumed.`
        : breakEven.status === "impossible"
          ? " Cash flow is already below $0 even with no vacancy at all."
          : "";
    findings.push({
      id: "vacancy-exposure",
      severity: "medium",
      title: "Vacancy exposure",
      explanation: `Each month the property sits empty costs ${formatCurrency(monthly.grossRent)} in rent. One extra vacant month per year would take annual cash flow from ${formatCurrency(analysis.annualCashFlow)} to ${formatCurrency(analysis.annualCashFlow - monthly.grossRent)}.${breakEvenText}`,
    });
  }

  if (inputs.vacancyPct / 100 < RISK_RULES.lowVacancyAssumptionBelow) {
    findings.push({
      id: "low-vacancy-assumption",
      severity: "low",
      title: "Vacancy assumption may be optimistic",
      explanation: `You assumed ${formatPercentShort(inputs.vacancyPct / 100)} vacancy, about ${Math.round((inputs.vacancyPct / 100) * 365)} empty days a year. Many investors plan for at least ${formatPercentShort(RISK_RULES.lowVacancyAssumptionBelow)} (about ${Math.round(RISK_RULES.lowVacancyAssumptionBelow * 365)} days) to cover turnover between tenants.`,
    });
  }

  const ratio = expenseRatio(analysis);
  if (ratio !== null && ratio > RISK_RULES.highExpenseRatioAbove) {
    const expenses: [string, number][] = [
      ["property taxes", monthly.taxes],
      ["insurance", monthly.insurance],
      ["maintenance", monthly.maintenance],
      ["property management", monthly.management],
      ["other expenses", monthly.other],
    ];
    const [largestName, largestAmount] = expenses.reduce((largest, item) => (item[1] > largest[1] ? item : largest));
    findings.push({
      id: "high-expense-ratio",
      severity: "medium",
      title: "High expense ratio",
      explanation: `Operating expenses are ${formatCurrency(monthly.operatingExpenses)}/mo, ${formatPercentShort(ratio)} of the ${formatCurrency(monthly.effectiveIncome)}/mo in rent you expect to collect. Above ${formatPercentShort(RISK_RULES.highExpenseRatioAbove)}, less of each rent dollar is left for the mortgage. The largest cost is ${largestName} at ${formatCurrency(largestAmount)}/mo.`,
    });
  }

  const expenseIncrease = monthly.operatingExpenses * RISK_RULES.expenseShock;
  const cashFlowAfterIncrease = cashFlow - expenseIncrease;
  const recoveryMonths = cashFlow > 0 ? RISK_RULES.repairShock / cashFlow : null;
  if (recoveryMonths === null || recoveryMonths > RISK_RULES.repairRecoveryMonthsAbove || cashFlowAfterIncrease < 0) {
    const repairText =
      recoveryMonths === null
        ? `A ${formatCurrency(RISK_RULES.repairShock)} surprise repair (a water heater or roof patch, for example) couldn't be paid back from cash flow, because cash flow isn't positive.`
        : `A ${formatCurrency(RISK_RULES.repairShock)} surprise repair (a water heater or roof patch, for example) would take about ${Math.ceil(recoveryMonths)} months of cash flow to pay back.`;
    findings.push({
      id: "unexpected-costs",
      severity: "medium",
      title: "Sensitive to unexpected costs",
      explanation: `${repairText} If operating expenses ran ${formatPercentShort(RISK_RULES.expenseShock)} higher than planned (${formatCurrency(expenseIncrease)}/mo more), monthly cash flow would be ${formatCurrency(cashFlowAfterIncrease)}.`,
    });
  }

  return findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}
