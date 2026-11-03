import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EMPTY_INPUTS, EXAMPLE_PROPERTY, parseNumber, validateInputs } from "../lib/dealInputs.ts";

describe("parseNumber", () => {
  it("accepts plain numbers, commas, dollar signs, and percent signs", () => {
    assert.equal(parseNumber("250000"), 250_000);
    assert.equal(parseNumber("$1,200.50"), 1200.5);
    assert.equal(parseNumber(" 7.5% "), 7.5);
    assert.equal(parseNumber(".5"), 0.5);
    assert.equal(parseNumber("-3"), -3);
  });

  it("returns null for blank input", () => {
    assert.equal(parseNumber(""), null);
    assert.equal(parseNumber("   "), null);
  });

  it("returns NaN for text, scientific notation, and hex", () => {
    for (const value of ["abc", "1e5", "0x10", "--5", "1.2.3", "Infinity"]) {
      assert.ok(Number.isNaN(parseNumber(value)), value);
    }
  });
});

describe("validateInputs", () => {
  it("accepts the example property", () => {
    const result = validateInputs(EXAMPLE_PROPERTY);
    assert.ok(result.inputs);
    assert.deepEqual(result.errors, {});
    assert.deepEqual(result.missing, []);
  });

  it("reports every blank field as missing, not as an error", () => {
    const result = validateInputs(EMPTY_INPUTS);
    assert.equal(result.inputs, null);
    assert.equal(result.missing.length, 12);
    assert.deepEqual(result.errors, {});
  });

  it("rejects invalid values with clear messages", () => {
    const result = validateInputs({
      ...EXAMPLE_PROPERTY,
      purchasePrice: "0",
      downPaymentPct: "120",
      termYears: "29.5",
      monthlyRent: "-5",
      vacancyPct: "abc",
      interestRatePct: "31",
    });
    assert.equal(result.inputs, null);
    assert.equal(result.errors.purchasePrice, "Must be greater than $0");
    assert.equal(result.errors.downPaymentPct, "Must be 100% or less");
    assert.equal(result.errors.termYears, "Enter a whole number of years");
    assert.equal(result.errors.monthlyRent, "Can't be negative");
    assert.equal(result.errors.vacancyPct, "Enter a number");
    assert.equal(result.errors.interestRatePct, "Must be 30% or less");
  });

  it("accepts boundary values", () => {
    const result = validateInputs({ ...EXAMPLE_PROPERTY, downPaymentPct: "100", interestRatePct: "0", termYears: "1", vacancyPct: "0" });
    assert.ok(result.inputs);
  });
});
