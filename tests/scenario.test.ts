import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzeDeal, monthlyPrincipalAndInterest } from "../lib/calculations.ts";
import { applyScenario, compareScenario } from "../lib/scenario.ts";
import { assertClose, exampleInputs } from "./helpers.ts";

const metric = (comparison: ReturnType<typeof compareScenario>, key: string) =>
  comparison.metrics.find((m) => m.key === key)!;

describe("applyScenario", () => {
  it("changes only the given fields and never modifies the original", () => {
    const base = exampleInputs();
    const snapshot = { ...base };
    const scenario = applyScenario(base, { monthlyRent: 2600 });
    assert.equal(scenario.monthlyRent, 2600);
    assert.equal(scenario.purchasePrice, base.purchasePrice);
    assert.deepEqual(base, snapshot);
  });

  it("ignores undefined changes", () => {
    const base = exampleInputs();
    assert.deepEqual(applyScenario(base, { monthlyRent: undefined }), base);
  });

  it("ignores fields that aren't part of the simulator", () => {
    const base = exampleInputs();
    const scenario = applyScenario(base, { annualTaxes: 99_999 } as never);
    assert.equal(scenario.annualTaxes, base.annualTaxes);
  });
});

describe("compareScenario", () => {
  it("shows zero change when nothing changes", () => {
    const base = exampleInputs();
    for (const m of compareScenario(base, applyScenario(base, {})).metrics) {
      assert.equal(m.change, 0, m.key);
    }
  });

  it("raises cash flow by rent × the share kept after rent-based costs", () => {
    const base = exampleInputs();
    const comparison = compareScenario(base, applyScenario(base, { monthlyRent: 2500 }));
    // Vacancy 5% + maintenance 8% + management 8% = 21%, so $100 more rent adds $79.
    assertClose(metric(comparison, "monthlyCashFlow").change!, 79);
    assertClose(metric(comparison, "annualCashFlow").change!, 948);
  });

  it("recalculates the down payment, cash invested, and loan when the price changes", () => {
    const base = exampleInputs();
    const comparison = compareScenario(base, applyScenario(base, { purchasePrice: 225_000 }));
    assert.equal(comparison.simulated.downPayment, 45_000);
    assert.equal(metric(comparison, "cashInvested").change, -5_000);
    assertClose(comparison.simulated.monthly.principalAndInterest, monthlyPrincipalAndInterest(180_000, 7, 30));
    assert.ok(metric(comparison, "capRate").change! > 0);
  });

  it("handles a 0% interest scenario", () => {
    const base = exampleInputs();
    const comparison = compareScenario(base, applyScenario(base, { interestRatePct: 0 }));
    assertClose(comparison.simulated.monthly.principalAndInterest, 200_000 / 360);
    assertClose(metric(comparison, "principalAndInterest").change!, 200_000 / 360 - 1330.6);
  });

  it("increases cash invested and lowers cash-on-cash when renovation costs rise", () => {
    const base = exampleInputs();
    const comparison = compareScenario(base, applyScenario(base, { renovationBudget: 35_000 }));
    assert.equal(metric(comparison, "cashInvested").change, 20_000);
    assert.ok(metric(comparison, "cashOnCash").change! < 0);
    assert.equal(metric(comparison, "monthlyCashFlow").change, 0);
  });

  it("reports null changes when cash-on-cash can't be calculated", () => {
    const base = exampleInputs({ downPaymentPct: 0 });
    const comparison = compareScenario(base, applyScenario(base, { renovationBudget: 0 }));
    const cashOnCash = metric(comparison, "cashOnCash");
    assert.equal(cashOnCash.scenario, null);
    assert.equal(cashOnCash.change, null);
  });

  it("matches analyzeDeal for both sides", () => {
    const base = exampleInputs();
    const scenarioInputs = applyScenario(base, { vacancyPct: 10 });
    const comparison = compareScenario(base, scenarioInputs);
    assert.deepEqual(comparison.original, analyzeDeal(base));
    assert.deepEqual(comparison.simulated, analyzeDeal(scenarioInputs));
  });
});
