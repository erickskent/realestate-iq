export type DealInputs = {
  purchasePrice: number;
  downPaymentPct: number;
  interestRatePct: number;
  termYears: number;
  renovationBudget: number;
  monthlyRent: number;
  vacancyPct: number;
  annualTaxes: number;
  annualInsurance: number;
  maintenancePct: number;
  managementPct: number;
  otherMonthly: number;
};

export type MonthlyBreakdown = {
  grossRent: number;
  vacancyLoss: number;
  effectiveIncome: number;
  taxes: number;
  insurance: number;
  maintenance: number;
  management: number;
  other: number;
  operatingExpenses: number;
  noi: number;
  principalAndInterest: number;
  cashFlow: number;
};

export type DealAnalysis = {
  downPayment: number;
  loanAmount: number;
  cashInvested: number;
  monthly: MonthlyBreakdown;
  annualNoi: number;
  annualCashFlow: number;
  /** Annual NOI ÷ purchase price, or null when the price is zero. */
  capRate: number | null;
  /** Annual cash flow ÷ cash invested, or null when no cash is invested. */
  cashOnCash: number | null;
};

/**
 * Monthly principal and interest on a fixed-rate, fully amortizing loan.
 * At 0% interest the balance is simply split evenly across the payments.
 */
export function monthlyPrincipalAndInterest(loanAmount: number, annualRatePct: number, termYears: number): number {
  const payments = Math.round(termYears * 12);
  if (loanAmount <= 0 || payments <= 0) return 0;

  const monthlyRate = annualRatePct / 100 / 12;
  if (monthlyRate === 0) return loanAmount / payments;

  return (loanAmount * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -payments));
}

export function analyzeDeal(inputs: DealInputs): DealAnalysis {
  const downPayment = inputs.purchasePrice * (inputs.downPaymentPct / 100);
  const loanAmount = inputs.purchasePrice - downPayment;
  const cashInvested = downPayment + inputs.renovationBudget;

  const grossRent = inputs.monthlyRent;
  const vacancyLoss = grossRent * (inputs.vacancyPct / 100);
  const effectiveIncome = grossRent - vacancyLoss;

  const taxes = inputs.annualTaxes / 12;
  const insurance = inputs.annualInsurance / 12;
  const maintenance = grossRent * (inputs.maintenancePct / 100);
  const management = grossRent * (inputs.managementPct / 100);
  const other = inputs.otherMonthly;
  const operatingExpenses = taxes + insurance + maintenance + management + other;

  const noi = effectiveIncome - operatingExpenses;
  const principalAndInterest = monthlyPrincipalAndInterest(loanAmount, inputs.interestRatePct, inputs.termYears);
  const cashFlow = noi - principalAndInterest;

  const annualNoi = noi * 12;
  const annualCashFlow = cashFlow * 12;

  return {
    downPayment,
    loanAmount,
    cashInvested,
    monthly: {
      grossRent,
      vacancyLoss,
      effectiveIncome,
      taxes,
      insurance,
      maintenance,
      management,
      other,
      operatingExpenses,
      noi,
      principalAndInterest,
      cashFlow,
    },
    annualNoi,
    annualCashFlow,
    capRate: inputs.purchasePrice > 0 ? annualNoi / inputs.purchasePrice : null,
    cashOnCash: cashInvested > 0 ? annualCashFlow / cashInvested : null,
  };
}
