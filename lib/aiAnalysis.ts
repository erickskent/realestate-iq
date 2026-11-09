import { analyzeDeal, type DealInputs } from "./calculations.ts";
import { ALL_FIELDS, validateInputs, type RawInputs } from "./dealInputs.ts";
import { analyzeRisks } from "./risks.ts";
import { debtCoverage, expenseRatio, scoreDeal } from "./scoring.ts";
import { breakEvenVacancy, maxPriceForCashFlow, RENT_TARGETS, rentForCashFlow, type TargetResult } from "./targets.ts";

/** Limits that keep each AI request small, bounded, and inexpensive. */
export const AI_LIMITS = {
  /** Largest request body the API route will read. A valid request is well under 1 KB. */
  maxBodyBytes: 4_000,
  /** Upper bound on the model's output, including its internal reasoning. */
  maxOutputTokens: 8_000,
  /** How long the server waits for Claude before giving up. No automatic retries. */
  timeoutMs: 28_000,
  /** Longest string accepted in any field of the AI's answer. */
  maxTextLength: 1_200,
} as const;

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

export type PayloadValidation = { ok: true; inputs: DealInputs } | { ok: false; message: string };

/**
 * Checks the JSON body sent by the browser: `{ inputs: { ...12 numbers } }`.
 * Uses the same field rules as the form, and rejects anything extra.
 */
export function validateAnalyzePayload(body: unknown): PayloadValidation {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, message: "Request body must be a JSON object." };
  }
  const bodyKeys = Object.keys(body);
  if (bodyKeys.length !== 1 || bodyKeys[0] !== "inputs") {
    return { ok: false, message: "Request body must contain only an `inputs` object." };
  }

  const inputs = (body as { inputs: unknown }).inputs;
  if (typeof inputs !== "object" || inputs === null || Array.isArray(inputs)) {
    return { ok: false, message: "`inputs` must be an object." };
  }

  const expected = new Set<string>(ALL_FIELDS.map((field) => field.key));
  const received = Object.keys(inputs);
  const unexpected = received.filter((key) => !expected.has(key));
  if (unexpected.length > 0) return { ok: false, message: `Unexpected field: ${unexpected[0].slice(0, 40)}.` };

  const raw = {} as RawInputs;
  for (const field of ALL_FIELDS) {
    const value = (inputs as Record<string, unknown>)[field.key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return { ok: false, message: `${field.label} must be a number.` };
    }
    raw[field.key] = String(value);
  }

  const validation = validateInputs(raw);
  if (!validation.inputs) {
    const [key, error] = Object.entries(validation.errors)[0] ?? [];
    const label = ALL_FIELDS.find((field) => field.key === key)?.label ?? "An input";
    return { ok: false, message: `${label}: ${error ?? "invalid value"}.` };
  }
  return { ok: true, inputs: validation.inputs };
}

// ---------------------------------------------------------------------------
// Fact sheet: the only information the AI receives
// ---------------------------------------------------------------------------

const round2 = (value: number) => Math.round(value * 100) / 100;
const pct = (ratio: number | null) => (ratio === null ? null : round2(ratio * 100));

const TARGET_STATUS = { impossible: "not_reachable", undefined: "not_applicable", always: "always_met" } as const;

type TargetFact = number | { status: (typeof TARGET_STATUS)[keyof typeof TARGET_STATUS]; reason: string };

function targetFact(result: TargetResult, transform: (value: number) => number = round2): TargetFact {
  return result.status === "ok" ? transform(result.value) : { status: TARGET_STATUS[result.status], reason: result.reason };
}

/**
 * Every number the AI is allowed to use, recalculated on the server from validated inputs.
 * Units are in the key names so nothing has to be guessed.
 */
export function buildFactSheet(inputs: DealInputs) {
  const analysis = analyzeDeal(inputs);
  const score = scoreDeal(analysis);
  const coverage = debtCoverage(analysis);
  const ratio = expenseRatio(analysis);
  const { monthly } = analysis;

  return {
    userInputs: {
      purchasePrice_usd: inputs.purchasePrice,
      downPayment_pct: inputs.downPaymentPct,
      annualInterestRate_pct: inputs.interestRatePct,
      mortgageTerm_years: inputs.termYears,
      renovationBudget_usd: inputs.renovationBudget,
      monthlyRent_usd: inputs.monthlyRent,
      vacancy_pctOfRent: inputs.vacancyPct,
      annualPropertyTaxes_usd: inputs.annualTaxes,
      annualInsurance_usd: inputs.annualInsurance,
      maintenance_pctOfRent: inputs.maintenancePct,
      propertyManagement_pctOfRent: inputs.managementPct,
      otherOperatingExpenses_usdPerMonth: inputs.otherMonthly,
    },
    calculatedMetrics: {
      loanAmount_usd: round2(analysis.loanAmount),
      downPayment_usd: round2(analysis.downPayment),
      totalCashInvested_usd: round2(analysis.cashInvested),
      monthlyMortgagePrincipalAndInterest_usd: round2(monthly.principalAndInterest),
      monthlyEffectiveRentalIncome_usd: round2(monthly.effectiveIncome),
      monthlyVacancyLoss_usd: round2(monthly.vacancyLoss),
      monthlyOperatingExpenses_usd: round2(monthly.operatingExpenses),
      monthlyNetOperatingIncome_usd: round2(monthly.noi),
      annualNetOperatingIncome_usd: round2(analysis.annualNoi),
      monthlyCashFlow_usd: round2(monthly.cashFlow),
      annualCashFlow_usd: round2(analysis.annualCashFlow),
      capRate_pct: pct(analysis.capRate),
      cashOnCashReturn_pct: pct(analysis.cashOnCash),
      expenseRatio_pctOfCollectedRent: pct(ratio),
      debtCoverageRatio: coverage === null ? null : round2(coverage),
    },
    ruleBasedAssessment: {
      illustrativeScore_outOf100: score.score,
      scoreCategory: score.category,
      riskFlags: analyzeRisks(inputs, analysis).map((risk) => ({ severity: risk.severity, title: risk.title, detail: risk.explanation })),
    },
    breakEvenTargets: {
      rentForZeroMonthlyCashFlow_usd: targetFact(rentForCashFlow(inputs, RENT_TARGETS[0])),
      rentFor300MonthlyCashFlow_usd: targetFact(rentForCashFlow(inputs, RENT_TARGETS[1])),
      maxPurchasePriceForZeroCashFlow_usd: targetFact(maxPriceForCashFlow(inputs, 0)),
      breakEvenVacancy_pct: targetFact(breakEvenVacancy(inputs), (value) => round2(value * 100)),
    },
    modelAssumptions: [
      "Fixed-rate, fully amortizing mortgage; payment is principal and interest only (no PMI).",
      "Taxes and insurance are operating expenses. Maintenance and management are a percentage of full monthly rent; vacancy reduces income.",
      "Cash invested is down payment plus renovation budget. Closing costs and reserves are not included.",
      "Cap rate uses purchase price only. Rent and expenses are held constant; no appreciation, rent growth, loan paydown, or tax effects.",
    ],
  };
}

export type FactSheet = ReturnType<typeof buildFactSheet>;

// ---------------------------------------------------------------------------
// Prompt and output format
// ---------------------------------------------------------------------------

export const SYSTEM_PROMPT = `You are the AI analysis feature of RealEstateIQ, an educational tool for first-time rental property investors. The user message contains a fact sheet: numbers the user entered, metrics the app calculated with fixed formulas, the app's rule-based score and risk flags, and break-even targets.

Ground rules:
- The fact sheet is your only source of facts. You know nothing about this property's location, condition, neighborhood, market rents, comparable sales, local taxes, or future interest rates, so do not state or estimate any of them. Where a conclusion would depend on outside information, say what the user should verify instead of guessing.
- When you mention a number, use the value from the fact sheet rather than recalculating it. Do not introduce new dollar amounts or percentages that aren't in the fact sheet, except simple differences between two fact-sheet numbers.
- Write in plain, friendly English for someone who has never invested before. Briefly explain any term you use.
- This is educational information, not financial advice. Do not tell the user to buy or not buy, do not call the deal objectively good or bad, and do not predict or promise returns. Describe what the numbers show, why, and what would change them.

What to return:
- summary: 3–5 sentences interpreting the overall picture the numbers paint.
- risks: the 3 most significant risks shown by these numbers, most significant first, each tied to specific fact-sheet figures.
- improvements: 2–4 changes the user could explore (for example price, rent, financing, or expenses), each linked to fact-sheet numbers or break-even targets and framed as something to look into, not an instruction.
- assumptionsToVerify: 3–5 inputs or assumptions the user should confirm with real documents or local sources (lender quotes, insurance quotes, tax records, leases, inspections), with how to check each one.`;

const textItem = (fields: Record<string, string>) => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(fields),
  properties: Object.fromEntries(Object.entries(fields).map(([key, description]) => [key, { type: "string", description }])),
});

/** JSON schema the API enforces on Claude's answer. */
export const ASSESSMENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "risks", "improvements", "assumptionsToVerify"],
  properties: {
    summary: { type: "string", description: "3–5 sentence plain-English interpretation." },
    risks: {
      type: "array",
      description: "Exactly 3 risks, most significant first.",
      items: textItem({ title: "Short risk name.", explanation: "Why it matters, citing fact-sheet numbers." }),
    },
    improvements: {
      type: "array",
      description: "2–4 changes worth exploring.",
      items: textItem({ title: "Short name of the change.", explanation: "What it would affect, citing fact-sheet numbers." }),
    },
    assumptionsToVerify: {
      type: "array",
      description: "3–5 inputs or assumptions to confirm.",
      items: textItem({ assumption: "The input or assumption to confirm.", howToVerify: "Where or how to confirm it." }),
    },
  },
} as const;

export function buildUserMessage(factSheet: FactSheet): string {
  return `Here is the fact sheet for the property the user is analyzing, as JSON:\n\n${JSON.stringify(factSheet, null, 2)}`;
}

// ---------------------------------------------------------------------------
// Output validation
// ---------------------------------------------------------------------------

export type AiTextItem = { title: string; explanation: string };
export type AiAssumption = { assumption: string; howToVerify: string };
export type AiAssessment = {
  summary: string;
  risks: AiTextItem[];
  improvements: AiTextItem[];
  assumptionsToVerify: AiAssumption[];
};

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  return trimmed.length > AI_LIMITS.maxTextLength ? `${trimmed.slice(0, AI_LIMITS.maxTextLength - 1)}…` : trimmed;
}

function cleanList<K extends string>(value: unknown, keys: [K, K], maxItems: number): Record<K, string>[] | null {
  if (!Array.isArray(value)) return null;
  const items: Record<K, string>[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) return null;
    const first = cleanText((entry as Record<string, unknown>)[keys[0]]);
    const second = cleanText((entry as Record<string, unknown>)[keys[1]]);
    if (!first || !second) return null;
    items.push({ [keys[0]]: first, [keys[1]]: second } as Record<K, string>);
  }
  return items.length > 0 ? items.slice(0, maxItems) : null;
}

/** Parses and checks Claude's JSON answer. Returns null if anything is missing or malformed. */
export function parseAssessment(text: string): AiAssessment | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const record = data as Record<string, unknown>;

  const summary = cleanText(record.summary);
  const risks = cleanList(record.risks, ["title", "explanation"], 3);
  const improvements = cleanList(record.improvements, ["title", "explanation"], 4);
  const assumptionsToVerify = cleanList(record.assumptionsToVerify, ["assumption", "howToVerify"], 5);
  if (!summary || !risks || !improvements || !assumptionsToVerify) return null;

  return { summary, risks, improvements, assumptionsToVerify };
}
