import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzeDeal } from "../lib/calculations.ts";
import { breakEvenVacancy, maxPriceForCashFlow, rentForCashFlow, rentKeepShare } from "../lib/targets.ts";
import { assertClose, exampleInputs } from "./helpers.ts";

function okValue(result: ReturnType<typeof rentForCashFlow>): number {
  assert.equal(result.status, "ok");
  return (result as { value: number }).value;
}

describe("rentForCashFlow", () => {
  it("finds the example's break-even rent, accounting for rent-based expenses", () => {
    const inputs = exampleInputs();
    assertClose(rentKeepShare(inputs), 0.79, 1e-9);
    // Fixed costs: $250 taxes + $125 insurance + $100 other + $1,330.60 mortgage = $1,805.60.
    assertClose(okValue(rentForCashFlow(inputs, 0)), 1805.6 / 0.79, 0.05);
    assertClose(okValue(rentForCashFlow(inputs, 300)), 2105.6 / 0.79, 0.05);
  });

  it("produces exactly the target cash flow when plugged back in", () => {
    for (const target of [0, 300, 1000]) {
      for (const overrides of [{}, { interestRatePct: 0 }, { downPaymentPct: 100 }, { vacancyPct: 30 }]) {
        const inputs = exampleInputs(overrides);
        const rent = okValue(rentForCashFlow(inputs, target));
        assertClose(analyzeDeal({ ...inputs, monthlyRent: rent }).monthly.cashFlow, target, 1e-6);
      }
    }
  });

  it("is impossible when rent-based costs use up 100% or more of rent", () => {
    const result = rentForCashFlow(exampleInputs({ vacancyPct: 50, maintenancePct: 30, managementPct: 20 }), 0);
    assert.equal(result.status, "impossible");
    assert.match((result as { reason: string }).reason, /100%/);
    assert.equal(rentForCashFlow(exampleInputs({ vacancyPct: 60, maintenancePct: 30, managementPct: 20 }), 300).status, "impossible");
  });

  it("is always met at $0 when every cost is rent-based and nothing is fixed", () => {
    const inputs = exampleInputs({ vacancyPct: 50, maintenancePct: 50, managementPct: 0, annualTaxes: 0, annualInsurance: 0, otherMonthly: 0, downPaymentPct: 100 });
    assert.equal(rentForCashFlow(inputs, 0).status, "always");
    assert.equal(rentForCashFlow(inputs, 300).status, "impossible");
  });

  it("never returns a negative rent", () => {
    const inputs = exampleInputs({ annualTaxes: 0, annualInsurance: 0, otherMonthly: 0, downPaymentPct: 100 });
    assert.equal(okValue(rentForCashFlow(inputs, 0)), 0);
  });
});

describe("maxPriceForCashFlow", () => {
  it("finds the price that brings cash flow to the target", () => {
    for (const overrides of [{}, { interestRatePct: 0 }, { downPaymentPct: 0 }]) {
      const inputs = exampleInputs(overrides);
      const price = okValue(maxPriceForCashFlow(inputs, 0));
      assertClose(analyzeDeal({ ...inputs, purchasePrice: price }).monthly.cashFlow, 0, 1e-6);
    }
  });

  it("is undefined with 100% down because price doesn't affect cash flow", () => {
    assert.equal(maxPriceForCashFlow(exampleInputs({ downPaymentPct: 100 }), 0).status, "undefined");
  });

  it("is impossible when NOI is already below the target", () => {
    assert.equal(maxPriceForCashFlow(exampleInputs({ monthlyRent: 500 }), 0).status, "impossible");
    assert.equal(maxPriceForCashFlow(exampleInputs(), 2000).status, "impossible");
  });
});

describe("breakEvenVacancy", () => {
  it("finds the vacancy rate where cash flow reaches $0", () => {
    const inputs = exampleInputs();
    const vacancy = okValue(breakEvenVacancy(inputs));
    assertClose(analyzeDeal({ ...inputs, vacancyPct: vacancy * 100 }).monthly.cashFlow, 0, 1e-6);
  });

  it("is undefined with no rent", () => {
    assert.equal(breakEvenVacancy(exampleInputs({ monthlyRent: 0 })).status, "undefined");
  });

  it("is impossible when cash flow is negative even at 0% vacancy", () => {
    assert.equal(breakEvenVacancy(exampleInputs({ monthlyRent: 1000 })).status, "impossible");
  });

  it("is always met when there are no fixed or rent-based costs", () => {
    const inputs = exampleInputs({ maintenancePct: 0, managementPct: 0, annualTaxes: 0, annualInsurance: 0, otherMonthly: 0, downPaymentPct: 100 });
    assert.equal(breakEvenVacancy(inputs).status, "always");
  });
});
