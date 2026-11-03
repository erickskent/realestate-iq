import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzeDeal, monthlyPrincipalAndInterest } from "../lib/calculations.ts";
import { assertClose, exampleInputs } from "./helpers.ts";

describe("monthlyPrincipalAndInterest", () => {
  it("matches known amortization values", () => {
    assertClose(monthlyPrincipalAndInterest(200_000, 7, 30), 1330.6);
    assertClose(monthlyPrincipalAndInterest(300_000, 6, 30), 1798.65);
    assertClose(monthlyPrincipalAndInterest(100_000, 5, 15), 790.79);
  });

  it("splits the loan evenly at 0% interest", () => {
    assert.equal(monthlyPrincipalAndInterest(120_000, 0, 10), 1000);
    assert.equal(monthlyPrincipalAndInterest(360_000, 0, 30), 1000);
  });

  it("returns 0 when there is no loan or no term", () => {
    assert.equal(monthlyPrincipalAndInterest(0, 7, 30), 0);
    assert.equal(monthlyPrincipalAndInterest(-5, 7, 30), 0);
    assert.equal(monthlyPrincipalAndInterest(100_000, 7, 0), 0);
  });

  it("never returns NaN or Infinity for valid inputs", () => {
    for (const rate of [0, 0.001, 3, 30]) {
      for (const years of [1, 15, 50]) {
        assert.ok(Number.isFinite(monthlyPrincipalAndInterest(250_000, rate, years)));
      }
    }
  });
});

describe("analyzeDeal", () => {
  const analysis = analyzeDeal(exampleInputs());

  it("calculates the example property correctly", () => {
    assert.equal(analysis.downPayment, 50_000);
    assert.equal(analysis.loanAmount, 200_000);
    assert.equal(analysis.cashInvested, 65_000);
    assertClose(analysis.monthly.vacancyLoss, 120);
    assertClose(analysis.monthly.effectiveIncome, 2280);
    assertClose(analysis.monthly.operatingExpenses, 250 + 125 + 192 + 192 + 100);
    assertClose(analysis.monthly.noi, 1421);
    assertClose(analysis.annualNoi, 17_052);
    assertClose(analysis.monthly.principalAndInterest, 1330.6);
    assertClose(analysis.monthly.cashFlow, 90.4);
    assertClose(analysis.annualCashFlow, 1084.74);
    assertClose(analysis.capRate!, 17_052 / 250_000, 1e-9);
    assertClose(analysis.cashOnCash!, analysis.annualCashFlow / 65_000, 1e-9);
  });

  it("has no mortgage payment at 100% down", () => {
    const allCash = analyzeDeal(exampleInputs({ downPaymentPct: 100 }));
    assert.equal(allCash.loanAmount, 0);
    assert.equal(allCash.monthly.principalAndInterest, 0);
    assertClose(allCash.monthly.cashFlow, allCash.monthly.noi);
  });

  it("returns null cash-on-cash instead of Infinity when no cash is invested", () => {
    const noCash = analyzeDeal(exampleInputs({ downPaymentPct: 0, renovationBudget: 0 }));
    assert.equal(noCash.cashInvested, 0);
    assert.equal(noCash.cashOnCash, null);
  });

  it("returns null cap rate when the price is zero", () => {
    assert.equal(analyzeDeal(exampleInputs({ purchasePrice: 0 })).capRate, null);
  });

  it("handles a 0% interest loan", () => {
    const zeroRate = analyzeDeal(exampleInputs({ interestRatePct: 0 }));
    assertClose(zeroRate.monthly.principalAndInterest, 200_000 / 360);
  });
});
