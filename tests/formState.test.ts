import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzeDeal } from "../lib/calculations.ts";
import { EMPTY_INPUTS, EXAMPLE_PROPERTY, validateInputs } from "../lib/dealInputs.ts";
import { formReducer, INITIAL_FORM_STATE, type FormAction, type FormState } from "../lib/formState.ts";

const run = (actions: FormAction[], start: FormState = INITIAL_FORM_STATE) => actions.reduce(formReducer, start);
const cashFlow = (state: FormState) => analyzeDeal(validateInputs(state.raw).inputs!).monthly.cashFlow;

describe("what-if apply and undo", () => {
  it("applies a rent change from $2,400 to $2,800 and Undo restores the original inputs exactly", () => {
    const applied = run([{ type: "applyScenario", changes: { monthlyRent: "2,800" } }]);
    assert.equal(applied.raw.monthlyRent, "2,800");
    assert.equal(applied.isExample, false);
    assert.ok(applied.beforeApply);
    assert.ok(cashFlow(applied) > cashFlow(INITIAL_FORM_STATE));

    const undone = formReducer(applied, { type: "undoApply" });
    assert.deepEqual(undone.raw, EXAMPLE_PROPERTY);
    assert.equal(undone.isExample, true);
    assert.equal(undone.beforeApply, null);
    assert.equal(cashFlow(undone), cashFlow(INITIAL_FORM_STATE));
  });

  it("restores the user's own edited inputs, not the example", () => {
    const edited = run([
      { type: "edit", key: "purchasePrice", value: "310,000" },
      { type: "edit", key: "monthlyRent", value: "2,650" },
    ]);
    const undone = run([{ type: "applyScenario", changes: { monthlyRent: "3,000", interestRatePct: "5.5" } }, { type: "undoApply" }], edited);
    assert.deepEqual(undone.raw, edited.raw);
    assert.equal(undone.isExample, false);
  });

  it("only changes the fields in the scenario", () => {
    const applied = run([{ type: "applyScenario", changes: { vacancyPct: "10" } }]);
    assert.deepEqual(applied.raw, { ...EXAMPLE_PROPERTY, vacancyPct: "10" });
  });

  it("does nothing when an empty scenario is applied, so Undo isn't offered", () => {
    assert.equal(run([{ type: "applyScenario", changes: {} }]), INITIAL_FORM_STATE);
  });

  it("does nothing when Undo is used with nothing to undo", () => {
    assert.equal(run([{ type: "undoApply" }]), INITIAL_FORM_STATE);
  });

  it("undoes only the most recent apply", () => {
    const state = run([
      { type: "applyScenario", changes: { monthlyRent: "2,800" } },
      { type: "applyScenario", changes: { monthlyRent: "3,000" } },
      { type: "undoApply" },
    ]);
    assert.equal(state.raw.monthlyRent, "2,800");
    assert.equal(state.beforeApply, null);
  });

  it("clears the Undo option once the user edits, loads the example, or clears the form", () => {
    const applied = run([{ type: "applyScenario", changes: { monthlyRent: "2,800" } }]);
    for (const action of [{ type: "edit", key: "annualTaxes", value: "3,200" }, { type: "loadExample" }, { type: "clear" }] as FormAction[]) {
      assert.equal(formReducer(applied, action).beforeApply, null, action.type);
    }
    assert.deepEqual(formReducer(applied, { type: "clear" }).raw, EMPTY_INPUTS);
  });
});
