import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzeDeal } from "../lib/calculations.ts";
import { categoryForScore, CATEGORY_THRESHOLDS, linearCredit, scoreDeal, SCORING_RULES } from "../lib/scoring.ts";
import { exampleInputs, LOSING_DEAL, STRONG_DEAL } from "./helpers.ts";

describe("linearCredit", () => {
  it("is 0 at or below the zero point and 1 at or above the full point", () => {
    assert.equal(linearCredit(-100, 0, 400), 0);
    assert.equal(linearCredit(0, 0, 400), 0);
    assert.equal(linearCredit(200, 0, 400), 0.5);
    assert.equal(linearCredit(400, 0, 400), 1);
    assert.equal(linearCredit(1000, 0, 400), 1);
  });

  it("works when lower values are better", () => {
    assert.equal(linearCredit(0.35, 0.6, 0.35), 1);
    assert.equal(linearCredit(0.6, 0.6, 0.35), 0);
    assertCloseTo(linearCredit(0.475, 0.6, 0.35), 0.5);
    assert.equal(linearCredit(Infinity, 0.6, 0.35), 0);
  });
});

function assertCloseTo(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
}

describe("categoryForScore boundaries", () => {
  it("uses Strong at 70 and above", () => {
    assert.equal(CATEGORY_THRESHOLDS.strong, 70);
    assert.equal(categoryForScore(100), "Strong");
    assert.equal(categoryForScore(70), "Strong");
  });

  it("uses Moderate from 45 to 69", () => {
    assert.equal(categoryForScore(69), "Moderate");
    assert.equal(categoryForScore(45), "Moderate");
  });

  it("uses High Risk below 45", () => {
    assert.equal(categoryForScore(44), "High Risk");
    assert.equal(categoryForScore(0), "High Risk");
  });
});

describe("scoreDeal", () => {
  it("has factor weights that total 100", () => {
    const total = Object.values(SCORING_RULES).reduce((sum, rule) => sum + rule.maxPoints, 0);
    assert.equal(total, 100);
  });

  it("scores the example property at 40 (High Risk) with transparent factor points", () => {
    const result = scoreDeal(analyzeDeal(exampleInputs()));
    assert.equal(result.score, 40);
    assert.equal(result.category, "High Risk");
    assert.equal(result.scaled, false);
    const points = Object.fromEntries(result.factors.map((f) => [f.id, Number(f.points!.toFixed(2))]));
    assert.deepEqual(points, { cashFlow: 6.78, cashOnCash: 4.17, capRate: 11.46, expenseRatio: 13.39, debtCoverage: 4.08 });
  });

  it("gives 100 to a deal that meets every benchmark, including full points with no mortgage", () => {
    const result = scoreDeal(analyzeDeal(STRONG_DEAL));
    assert.equal(result.score, 100);
    assert.equal(result.category, "Strong");
    const coverage = result.factors.find((f) => f.id === "debtCoverage")!;
    assert.equal(coverage.value, null);
    assert.equal(coverage.points, 15);
  });

  it("gives 0 to a deal that misses every benchmark", () => {
    const result = scoreDeal(analyzeDeal(LOSING_DEAL));
    assert.equal(result.score, 0);
    assert.equal(result.category, "High Risk");
  });

  it("leaves out cash-on-cash and scales to 100 when no cash is invested", () => {
    const analysis = analyzeDeal(exampleInputs({ downPaymentPct: 0, renovationBudget: 0 }));
    const result = scoreDeal(analysis);
    const cashOnCash = result.factors.find((f) => f.id === "cashOnCash")!;
    assert.equal(cashOnCash.points, null);
    assert.equal(result.scaled, true);
    const earned = result.factors.reduce((sum, f) => sum + (f.points ?? 0), 0);
    assert.equal(result.score, Math.round((earned / 75) * 100));
  });

  it("gives 0 expense-ratio points instead of NaN when there is no rent", () => {
    const result = scoreDeal(analyzeDeal(exampleInputs({ monthlyRent: 0 })));
    const ratio = result.factors.find((f) => f.id === "expenseRatio")!;
    assert.equal(ratio.points, 0);
    assert.ok(Number.isFinite(result.score));
  });

  it("always returns a whole number from 0 to 100", () => {
    for (const rent of [0, 500, 1500, 2400, 3500, 10_000]) {
      for (const rate of [0, 4, 7, 12]) {
        const { score } = scoreDeal(analyzeDeal(exampleInputs({ monthlyRent: rent, interestRatePct: rate })));
        assert.ok(Number.isInteger(score) && score >= 0 && score <= 100, `rent ${rent}, rate ${rate}: ${score}`);
      }
    }
  });
});
