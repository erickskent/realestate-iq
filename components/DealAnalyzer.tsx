"use client";

import { useMemo, useReducer } from "react";
import { analyzeDeal, type DealAnalysis } from "@/lib/calculations";
import { FIELD_GROUPS, validateInputs, type FieldKey, type RawInputs } from "@/lib/dealInputs";
import { formatCurrency, formatPercent } from "@/lib/format";
import { formReducer, INITIAL_FORM_STATE } from "@/lib/formState";
import AiAnalysis from "./AiAnalysis";
import DealAssessment from "./DealAssessment";
import NumberField from "./NumberField";
import RiskAnalysis from "./RiskAnalysis";
import WhatIfSimulator from "./WhatIfSimulator";
import WhatMustChange from "./WhatMustChange";

function tone(value: number | null): "positive" | "negative" | "neutral" {
  if (value === null || Math.abs(value) < 0.005) return "neutral";
  return value > 0 ? "positive" : "negative";
}

export default function DealAnalyzer() {
  const [{ raw, isExample, beforeApply }, dispatch] = useReducer(formReducer, INITIAL_FORM_STATE);

  const validation = useMemo(() => validateInputs(raw), [raw]);
  const analysis = useMemo(() => (validation.inputs ? analyzeDeal(validation.inputs) : null), [validation]);

  const updateField = (key: FieldKey, value: string) => dispatch({ type: "edit", key, value });
  const loadExample = () => dispatch({ type: "loadExample" });
  const clearAll = () => dispatch({ type: "clear" });
  const applyScenario = (changes: Partial<RawInputs>) => dispatch({ type: "applyScenario", changes });
  const undoApply = () => dispatch({ type: "undoApply" });

  const errorCount = Object.keys(validation.errors).length;

  return (
    <>
      <div className="dashboard">
        <section className="panel form-panel" aria-labelledby="property-heading">
          <div className="panel-header">
            <h2 id="property-heading">Property details</h2>
            <div className="form-actions">
              <button type="button" className="button button-secondary" onClick={loadExample}>
                Load example property
              </button>
              <button type="button" className="button button-ghost" onClick={clearAll}>
                Clear all
              </button>
            </div>
          </div>

          {isExample && (
            <p className="example-banner">
              <strong>Example property</strong>
              Illustrative numbers for a hypothetical single-family rental, not a real listing. Replace them with your
              own property&apos;s numbers.
            </p>
          )}

          <form onSubmit={(event) => event.preventDefault()} noValidate>
            {FIELD_GROUPS.map((group) => (
              <fieldset key={group.title} className="field-group">
                <legend>{group.title}</legend>
                <div className="field-grid">
                  {group.fields.map((field) => (
                    <NumberField
                      key={field.key}
                      field={field}
                      value={raw[field.key]}
                      error={validation.errors[field.key]}
                      onChange={(value) => updateField(field.key, value)}
                    />
                  ))}
                </div>
              </fieldset>
            ))}
          </form>
        </section>

        <section className="panel results-panel" aria-labelledby="results-heading" aria-live="polite">
          <div className="panel-header">
            <h2 id="results-heading">Deal analysis</h2>
            {isExample && <span className="tag">Example property</span>}
          </div>

          {analysis ? (
            <Results analysis={analysis} />
          ) : (
            <p className="results-empty">
              {errorCount > 0
                ? `Fix the ${errorCount === 1 ? "highlighted field" : `${errorCount} highlighted fields`} to see the analysis.`
                : `Fill in the remaining ${validation.missing.length === 1 ? "field" : `${validation.missing.length} fields`} to see the analysis.`}
            </p>
          )}

          <p className="disclaimer-inline">
            For informational purposes only. This analysis is not financial or investment advice.
          </p>
        </section>
      </div>

      <AiAnalysis inputs={validation.inputs} />

      <section className="intel-intro" aria-labelledby="intel-heading">
        <div className="intel-title">
          <h2 id="intel-heading">Deal intelligence</h2>
          <span className="tag">Rule-based · not AI-generated</span>
        </div>
        <p>
          These panels apply fixed, published rules to your numbers. Nothing is predicted, and nothing here says a deal is
          objectively good or bad. It shows how the numbers compare with simple benchmarks and how sensitive they are to
          change.
        </p>
      </section>

      {validation.inputs && analysis ? (
        <>
          <div className="intel-grid">
            <DealAssessment analysis={analysis} />
            <RiskAnalysis inputs={validation.inputs} analysis={analysis} />
          </div>
          <WhatIfSimulator raw={raw} onApply={applyScenario} canUndo={beforeApply !== null} onUndo={undoApply} />
          <WhatMustChange inputs={validation.inputs} />
        </>
      ) : (
        <p className="panel results-empty intel-empty">
          Complete the property details above to see the deal assessment, risk analysis, what-if simulator, and
          break-even targets.
        </p>
      )}
    </>
  );
}

function Results({ analysis }: { analysis: DealAnalysis }) {
  const { monthly } = analysis;

  const rows: { label: string; value: number; kind?: "deduction" | "subtotal" | "total" }[] = [
    { label: "Gross rent", value: monthly.grossRent },
    { label: "Vacancy loss", value: monthly.vacancyLoss, kind: "deduction" },
    { label: "Effective rental income", value: monthly.effectiveIncome, kind: "subtotal" },
    { label: "Property taxes", value: monthly.taxes, kind: "deduction" },
    { label: "Insurance", value: monthly.insurance, kind: "deduction" },
    { label: "Maintenance", value: monthly.maintenance, kind: "deduction" },
    { label: "Property management", value: monthly.management, kind: "deduction" },
    { label: "Other operating expenses", value: monthly.other, kind: "deduction" },
    { label: "Net operating income (NOI)", value: monthly.noi, kind: "subtotal" },
    { label: "Mortgage principal & interest", value: monthly.principalAndInterest, kind: "deduction" },
    { label: "Cash flow", value: monthly.cashFlow, kind: "total" },
  ];

  return (
    <>
      <div className="kpi-grid">
        <Kpi label="Monthly cash flow" value={formatCurrency(monthly.cashFlow)} tone={tone(monthly.cashFlow)} />
        <Kpi label="Annual cash flow" value={formatCurrency(analysis.annualCashFlow)} tone={tone(analysis.annualCashFlow)} />
        <Kpi
          label="Cash-on-cash return"
          value={analysis.cashOnCash === null ? "N/A" : formatPercent(analysis.cashOnCash)}
          tone={tone(analysis.cashOnCash)}
          note={analysis.cashOnCash === null ? "No cash invested" : undefined}
        />
        <Kpi label="Cap rate" value={analysis.capRate === null ? "N/A" : formatPercent(analysis.capRate)} />
        <Kpi label="Net operating income" value={`${formatCurrency(analysis.annualNoi)}/yr`} />
        <Kpi label="Operating expenses" value={`${formatCurrency(monthly.operatingExpenses)}/mo`} />
      </div>

      <h3 className="section-title">Income &amp; expense breakdown</h3>
      <div className="table-scroll">
        <table className="breakdown">
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Monthly</th>
              <th scope="col">Annual</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const sign = row.kind === "deduction" ? -1 : 1;
              return (
                <tr key={row.label} className={row.kind ? `row-${row.kind}` : undefined}>
                  <th scope="row">{row.kind === "deduction" ? `Less: ${row.label}` : row.label}</th>
                  <td>{formatCurrency(sign * row.value)}</td>
                  <td>{formatCurrency(sign * row.value * 12)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h3 className="section-title">Financing &amp; cash invested</h3>
      <dl className="summary-list">
        <div>
          <dt>Loan amount</dt>
          <dd>{formatCurrency(analysis.loanAmount)}</dd>
        </div>
        <div>
          <dt>Monthly principal &amp; interest</dt>
          <dd>{formatCurrency(monthly.principalAndInterest)}</dd>
        </div>
        <div>
          <dt>Down payment</dt>
          <dd>{formatCurrency(analysis.downPayment)}</dd>
        </div>
        <div>
          <dt>Total cash invested</dt>
          <dd>{formatCurrency(analysis.cashInvested)}</dd>
        </div>
      </dl>
    </>
  );
}

function Kpi({
  label,
  value,
  tone = "neutral",
  note,
}: {
  label: string;
  value: string;
  tone?: "positive" | "negative" | "neutral";
  note?: string;
}) {
  return (
    <div className={`kpi kpi-${tone}`}>
      <p className="kpi-label">{label}</p>
      <p className="kpi-value">{value}</p>
      {note && <p className="kpi-note">{note}</p>}
    </div>
  );
}
