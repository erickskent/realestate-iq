import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzeDeal } from "../lib/calculations.ts";
import {
  AI_LIMITS,
  ASSESSMENT_SCHEMA,
  buildFactSheet,
  buildUserMessage,
  parseAssessment,
  SYSTEM_PROMPT,
  validateAnalyzePayload,
} from "../lib/aiAnalysis.ts";
import { exampleInputs, VALID_ASSESSMENT } from "./helpers.ts";

describe("validateAnalyzePayload", () => {
  it("accepts a complete set of valid numbers", () => {
    const result = validateAnalyzePayload({ inputs: exampleInputs() });
    assert.ok(result.ok);
    assert.deepEqual(result.inputs, exampleInputs());
  });

  it("rejects bodies that aren't an object with only `inputs`", () => {
    for (const body of [null, "text", 42, [], {}, { inputs: exampleInputs(), note: "hi" }, { inputs: [] }, { inputs: null }]) {
      assert.equal(validateAnalyzePayload(body).ok, false, JSON.stringify(body));
    }
  });

  it("rejects missing, extra, or non-numeric fields", () => {
    const { monthlyRent: _omitted, ...missingRent } = exampleInputs();
    assert.equal(validateAnalyzePayload({ inputs: missingRent }).ok, false);
    assert.equal(validateAnalyzePayload({ inputs: { ...exampleInputs(), notes: 1 } }).ok, false);
    assert.equal(validateAnalyzePayload({ inputs: { ...exampleInputs(), monthlyRent: "2400" } }).ok, false);
    assert.equal(validateAnalyzePayload({ inputs: { ...exampleInputs(), monthlyRent: null } }).ok, false);
  });

  it("applies the same range rules as the form", () => {
    const result = validateAnalyzePayload({ inputs: exampleInputs({ downPaymentPct: 150 }) });
    assert.equal(result.ok, false);
    assert.match((result as { message: string }).message, /Down payment: Must be 100% or less/);
    assert.equal(validateAnalyzePayload({ inputs: exampleInputs({ purchasePrice: 0 }) }).ok, false);
    assert.equal(validateAnalyzePayload({ inputs: exampleInputs({ termYears: 30.5 }) }).ok, false);
    assert.equal(validateAnalyzePayload({ inputs: exampleInputs({ annualTaxes: -1 }) }).ok, false);
    assert.equal(validateAnalyzePayload({ inputs: exampleInputs({ purchasePrice: 1e12 }) }).ok, false);
  });

  it("accepts edge cases the calculator supports, like 0% interest and 100% down", () => {
    assert.ok(validateAnalyzePayload({ inputs: exampleInputs({ interestRatePct: 0, downPaymentPct: 100 }) }).ok);
  });
});

describe("buildFactSheet", () => {
  it("contains the server-calculated metrics, matching the calculator", () => {
    const facts = buildFactSheet(exampleInputs());
    const analysis = analyzeDeal(exampleInputs());
    assert.equal(facts.calculatedMetrics.monthlyCashFlow_usd, Math.round(analysis.monthly.cashFlow * 100) / 100);
    assert.equal(facts.calculatedMetrics.capRate_pct, 6.82);
    assert.equal(facts.calculatedMetrics.cashOnCashReturn_pct, 1.67);
    assert.equal(facts.calculatedMetrics.monthlyMortgagePrincipalAndInterest_usd, 1330.6);
    assert.equal(facts.ruleBasedAssessment.illustrativeScore_outOf100, 40);
    assert.equal(facts.breakEvenTargets.rentForZeroMonthlyCashFlow_usd, 2285.58);
    assert.equal(facts.userInputs.monthlyRent_usd, 2400);
  });

  it("reports unreachable targets with a reason instead of a number", () => {
    const facts = buildFactSheet(exampleInputs({ downPaymentPct: 100 }));
    assert.deepEqual(Object.keys(facts.breakEvenTargets.maxPurchasePriceForZeroCashFlow_usd as object), ["status", "reason"]);
    assert.equal(facts.calculatedMetrics.debtCoverageRatio, null);
  });

  it("produces a prompt with no undefined, NaN, or Infinity values", () => {
    for (const overrides of [{}, { interestRatePct: 0 }, { downPaymentPct: 0, renovationBudget: 0 }, { monthlyRent: 0 }]) {
      const message = buildUserMessage(buildFactSheet(exampleInputs(overrides)));
      assert.doesNotMatch(message, /undefined|NaN|Infinity/);
      assert.ok(JSON.parse(message.slice(message.indexOf("{"))));
    }
  });
});

describe("prompt and schema", () => {
  it("tells the model not to invent outside facts or give advice", () => {
    assert.match(SYSTEM_PROMPT, /only source of facts/);
    assert.match(SYSTEM_PROMPT, /comparable sales/);
    assert.match(SYSTEM_PROMPT, /not financial advice/);
  });

  it("disallows extra properties at every object level", () => {
    const walk = (node: unknown): void => {
      if (typeof node !== "object" || node === null) return;
      const record = node as Record<string, unknown>;
      if (record.type === "object") {
        assert.equal(record.additionalProperties, false);
        assert.deepEqual([...(record.required as string[])].sort(), Object.keys(record.properties as object).sort());
      }
      Object.values(record).forEach(walk);
    };
    walk(ASSESSMENT_SCHEMA);
  });
});

describe("parseAssessment", () => {
  it("accepts a well-formed answer", () => {
    assert.deepEqual(parseAssessment(JSON.stringify(VALID_ASSESSMENT)), VALID_ASSESSMENT);
  });

  it("rejects invalid JSON or missing sections", () => {
    assert.equal(parseAssessment("not json"), null);
    assert.equal(parseAssessment("null"), null);
    assert.equal(parseAssessment(JSON.stringify({ ...VALID_ASSESSMENT, summary: "  " })), null);
    assert.equal(parseAssessment(JSON.stringify({ ...VALID_ASSESSMENT, risks: [] })), null);
    assert.equal(parseAssessment(JSON.stringify({ ...VALID_ASSESSMENT, improvements: [{ title: "x" }] })), null);
    assert.equal(parseAssessment(JSON.stringify({ ...VALID_ASSESSMENT, assumptionsToVerify: "x" })), null);
  });

  it("keeps at most 3 risks and trims overly long text", () => {
    const extra = { title: "Fourth", explanation: "Extra risk." };
    const longText = "a".repeat(AI_LIMITS.maxTextLength + 500);
    const parsed = parseAssessment(JSON.stringify({ ...VALID_ASSESSMENT, summary: longText, risks: [...VALID_ASSESSMENT.risks, extra] }))!;
    assert.equal(parsed.risks.length, 3);
    assert.equal(parsed.summary.length, AI_LIMITS.maxTextLength);
    assert.ok(parsed.summary.endsWith("…"));
  });
});
