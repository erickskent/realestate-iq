import type { DealInputs } from "./calculations";

export type FieldKey = keyof DealInputs;
export type RawInputs = Record<FieldKey, string>;
export type FieldErrors = Partial<Record<FieldKey, string>>;

export type FieldConfig = {
  key: FieldKey;
  label: string;
  unit: "currency" | "percent" | "years";
  period?: "month" | "year";
  hint?: string;
  min: number;
  max: number;
  /** When true, the value must be strictly greater than `min`. */
  minExclusive?: boolean;
  integer?: boolean;
};

export type FieldGroup = { title: string; fields: FieldConfig[] };

const MAX_DOLLARS = 1_000_000_000;

export const FIELD_GROUPS: FieldGroup[] = [
  {
    title: "Purchase & financing",
    fields: [
      { key: "purchasePrice", label: "Purchase price", unit: "currency", min: 0, minExclusive: true, max: MAX_DOLLARS },
      { key: "downPaymentPct", label: "Down payment", unit: "percent", hint: "Percent of purchase price", min: 0, max: 100 },
      { key: "interestRatePct", label: "Annual interest rate", unit: "percent", hint: "Fixed rate", min: 0, max: 30 },
      { key: "termYears", label: "Mortgage term", unit: "years", min: 1, max: 50, integer: true },
      { key: "renovationBudget", label: "Renovation budget", unit: "currency", hint: "Paid in cash up front", min: 0, max: MAX_DOLLARS },
    ],
  },
  {
    title: "Rental income",
    fields: [
      { key: "monthlyRent", label: "Monthly rent", unit: "currency", period: "month", min: 0, max: MAX_DOLLARS },
      { key: "vacancyPct", label: "Vacancy", unit: "percent", hint: "Share of rent lost to empty months", min: 0, max: 100 },
    ],
  },
  {
    title: "Operating expenses",
    fields: [
      { key: "annualTaxes", label: "Annual property taxes", unit: "currency", period: "year", min: 0, max: MAX_DOLLARS },
      { key: "annualInsurance", label: "Annual insurance", unit: "currency", period: "year", min: 0, max: MAX_DOLLARS },
      { key: "maintenancePct", label: "Maintenance", unit: "percent", hint: "Percent of monthly rent", min: 0, max: 100 },
      { key: "managementPct", label: "Property management", unit: "percent", hint: "Percent of monthly rent", min: 0, max: 100 },
      { key: "otherMonthly", label: "Other operating expenses", unit: "currency", period: "month", hint: "HOA, utilities, lawn care, etc.", min: 0, max: MAX_DOLLARS },
    ],
  },
];

export const ALL_FIELDS: FieldConfig[] = FIELD_GROUPS.flatMap((group) => group.fields);

/** Hypothetical single-family rental used to demonstrate the analyzer. Not a real listing. */
export const EXAMPLE_PROPERTY: RawInputs = {
  purchasePrice: "250,000",
  downPaymentPct: "20",
  interestRatePct: "7",
  termYears: "30",
  renovationBudget: "15,000",
  monthlyRent: "2,400",
  vacancyPct: "5",
  annualTaxes: "3,000",
  annualInsurance: "1,500",
  maintenancePct: "8",
  managementPct: "8",
  otherMonthly: "100",
};

export const EMPTY_INPUTS = Object.fromEntries(ALL_FIELDS.map((field) => [field.key, ""])) as RawInputs;

/** Returns null for a blank entry and NaN for anything that isn't a plain number. */
export function parseNumber(raw: string): number | null {
  const cleaned = raw.replace(/[$,%\s]/g, "");
  if (cleaned === "") return null;
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(cleaned)) return NaN;
  return Number(cleaned);
}

function formatLimit(field: FieldConfig, value: number): string {
  if (field.unit === "currency") return `$${value.toLocaleString("en-US")}`;
  if (field.unit === "percent") return `${value}%`;
  return `${value} years`;
}

function validateField(field: FieldConfig, value: number): string | undefined {
  if (Number.isNaN(value)) return "Enter a number";
  if (field.minExclusive && value <= field.min) return `Must be greater than ${formatLimit(field, field.min)}`;
  if (value < field.min) return field.min === 0 ? "Can't be negative" : `Must be at least ${formatLimit(field, field.min)}`;
  if (value > field.max) return `Must be ${formatLimit(field, field.max)} or less`;
  if (field.integer && !Number.isInteger(value)) return "Enter a whole number of years";
  return undefined;
}

export type ValidationResult = {
  /** Parsed values, present only when every field is filled in and valid. */
  inputs: DealInputs | null;
  errors: FieldErrors;
  missing: FieldKey[];
};

export function validateInputs(raw: RawInputs): ValidationResult {
  const errors: FieldErrors = {};
  const missing: FieldKey[] = [];
  const values: Partial<DealInputs> = {};

  for (const field of ALL_FIELDS) {
    const value = parseNumber(raw[field.key]);
    if (value === null) {
      missing.push(field.key);
      continue;
    }
    const error = validateField(field, value);
    if (error) errors[field.key] = error;
    else values[field.key] = value;
  }

  const complete = missing.length === 0 && Object.keys(errors).length === 0;
  return { inputs: complete ? (values as DealInputs) : null, errors, missing };
}
