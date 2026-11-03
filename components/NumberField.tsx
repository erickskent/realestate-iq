import type { FieldConfig } from "@/lib/dealInputs";

export default function NumberField({
  field,
  value,
  error,
  onChange,
  idPrefix = "field",
  hint = field.hint,
  highlighted = false,
}: {
  field: FieldConfig;
  value: string;
  error?: string;
  onChange: (value: string) => void;
  idPrefix?: string;
  hint?: string;
  highlighted?: boolean;
}) {
  const id = `${idPrefix}-${field.key}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const suffix =
    field.unit === "percent" ? "%" : field.unit === "years" ? "years" : field.period === "month" ? "/mo" : field.period === "year" ? "/yr" : null;

  return (
    <div className="field">
      <label htmlFor={id}>{field.label}</label>
      <div className={`input-wrap${error ? " has-error" : highlighted ? " is-changed" : ""}`}>
        {field.unit === "currency" && <span className="affix">$</span>}
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
        />
        {suffix && <span className="affix">{suffix}</span>}
      </div>
      {hint && (
        <p id={hintId} className="field-hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}
