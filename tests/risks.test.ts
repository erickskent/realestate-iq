import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzeDeal, type DealInputs } from "../lib/calculations.ts";
import { analyzeRisks } from "../lib/risks.ts";
import { exampleInputs, LOSING_DEAL, STRONG_DEAL } from "./helpers.ts";

const risksFor = (inputs: DealInputs) => analyzeRisks(inputs, analyzeDeal(inputs));
const ids = (inputs: DealInputs) => risksFor(inputs).map((finding) => finding.id);

describe("analyzeRisks", () => {
  it("flags thin cash flow, low cash-on-cash, vacancy exposure, and cost sensitivity on the example", () => {
    const findings = risksFor(exampleInputs());
    assert.deepEqual(
      findings.map((f) => f.id).sort(),
      ["low-cash-on-cash", "thin-cash-flow", "unexpected-costs", "vacancy-exposure"],
    );
    const text = Object.fromEntries(findings.map((f) => [f.id, f.explanation]));
    assert.match(text["thin-cash-flow"], /\$90\/mo/);
    assert.match(text["low-cash-on-cash"], /\$65,000/);
    assert.match(text["low-cash-on-cash"], /1\.67%/);
    assert.match(text["vacancy-exposure"], /\$2,400/);
    assert.match(text["vacancy-exposure"], /\$1,085 to -\$1,315/);
    assert.match(text["unexpected-costs"], /56 months/);
  });

  it("flags negative cash flow as high severity and lists it first", () => {
    const findings = risksFor(LOSING_DEAL);
    assert.equal(findings[0].id, "negative-cash-flow");
    assert.equal(findings[0].severity, "high");
    assert.ok(!findings.some((f) => f.id === "thin-cash-flow"));
    assert.match(findings.find((f) => f.id === "unexpected-costs")!.explanation, /isn't positive/);
  });

  it("flags a high expense ratio and names the largest cost", () => {
    const finding = risksFor(LOSING_DEAL).find((f) => f.id === "high-expense-ratio")!;
    assert.match(finding.explanation, /property taxes at \$500\/mo/);
  });

  it("flags a vacancy assumption below 5% as a low-severity note", () => {
    const finding = risksFor({ ...STRONG_DEAL, vacancyPct: 2 }).find((f) => f.id === "low-vacancy-assumption")!;
    assert.equal(finding.severity, "low");
    assert.match(finding.explanation, /about 7 empty days/);
  });

  it("returns no findings for a deal that clears every check", () => {
    assert.deepEqual(ids(STRONG_DEAL), []);
  });

  it("sorts findings from high to low severity", () => {
    const order = { high: 0, medium: 1, low: 2 };
    const severities = risksFor({ ...LOSING_DEAL, vacancyPct: 0 }).map((f) => order[f.severity]);
    assert.deepEqual(severities, [...severities].sort((a, b) => a - b));
  });

  it("skips cash-on-cash when it can't be calculated", () => {
    assert.ok(!ids(exampleInputs({ downPaymentPct: 0, renovationBudget: 0 })).includes("low-cash-on-cash"));
  });
});
