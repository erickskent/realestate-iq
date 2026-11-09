import type { DealInputs } from "../lib/calculations.ts";
import { EXAMPLE_PROPERTY, validateInputs } from "../lib/dealInputs.ts";

/** The parsed example property: $250k, 20% down, 7%, 30 years, $2,400 rent. */
export function exampleInputs(overrides: Partial<DealInputs> = {}): DealInputs {
  const { inputs } = validateInputs(EXAMPLE_PROPERTY);
  if (!inputs) throw new Error("Example property should be valid");
  return { ...inputs, ...overrides };
}

/** An all-cash deal that meets every scoring benchmark. */
export const STRONG_DEAL: DealInputs = {
  purchasePrice: 100_000,
  downPaymentPct: 100,
  interestRatePct: 7,
  termYears: 30,
  renovationBudget: 0,
  monthlyRent: 2_000,
  vacancyPct: 5,
  annualTaxes: 1_200,
  annualInsurance: 1_200,
  maintenancePct: 0,
  managementPct: 0,
  otherMonthly: 0,
};

/** A heavily financed deal that loses money every month. */
export const LOSING_DEAL: DealInputs = {
  purchasePrice: 400_000,
  downPaymentPct: 10,
  interestRatePct: 8,
  termYears: 30,
  renovationBudget: 20_000,
  monthlyRent: 1_000,
  vacancyPct: 10,
  annualTaxes: 6_000,
  annualInsurance: 3_000,
  maintenancePct: 10,
  managementPct: 10,
  otherMonthly: 200,
};

export function assertClose(actual: number, expected: number, tolerance = 0.01): void {
  if (!(Math.abs(actual - expected) <= tolerance)) {
    throw new Error(`Expected ${actual} to be within ${tolerance} of ${expected}`);
  }
}

/** A well-formed AI answer for the example property, used in place of a real Claude response. */
export const VALID_ASSESSMENT = {
  summary: "The property shows modest positive cash flow of $90.40 a month.",
  risks: [
    { title: "Thin cash flow", explanation: "Monthly cash flow is $90.40." },
    { title: "Low cash-on-cash return", explanation: "The return is 1.67% on $65,000 invested." },
    { title: "Vacancy exposure", explanation: "Break-even vacancy is 8.77%." },
  ],
  improvements: [{ title: "Negotiate price", explanation: "The break-even price is $266,982.61." }],
  assumptionsToVerify: [
    { assumption: "Monthly rent of $2,400", howToVerify: "Compare signed leases for similar units." },
    { assumption: "Insurance of $1,500/yr", howToVerify: "Get a written insurance quote." },
    { assumption: "Property taxes of $3,000/yr", howToVerify: "Check the county tax record." },
  ],
};
