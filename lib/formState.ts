import { EMPTY_INPUTS, EXAMPLE_PROPERTY, type FieldKey, type RawInputs } from "./dealInputs.ts";

type Snapshot = { raw: RawInputs; isExample: boolean };

export type FormState = Snapshot & {
  /** The inputs as they were before the last what-if scenario was applied, so it can be undone. */
  beforeApply: Snapshot | null;
};

export type FormAction =
  | { type: "edit"; key: FieldKey; value: string }
  | { type: "loadExample" }
  | { type: "clear" }
  | { type: "applyScenario"; changes: Partial<RawInputs> }
  | { type: "undoApply" };

export const INITIAL_FORM_STATE: FormState = { raw: EXAMPLE_PROPERTY, isExample: true, beforeApply: null };

export function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case "edit":
      return { raw: { ...state.raw, [action.key]: action.value }, isExample: false, beforeApply: null };
    case "loadExample":
      return INITIAL_FORM_STATE;
    case "clear":
      return { raw: EMPTY_INPUTS, isExample: false, beforeApply: null };
    case "applyScenario":
      if (Object.keys(action.changes).length === 0) return state;
      return {
        raw: { ...state.raw, ...action.changes },
        isExample: false,
        beforeApply: { raw: state.raw, isExample: state.isExample },
      };
    case "undoApply":
      if (!state.beforeApply) return state;
      return { ...state.beforeApply, beforeApply: null };
  }
}
