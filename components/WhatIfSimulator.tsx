"use client";

import { useMemo, useState } from "react";
import { ALL_FIELDS, parseNumber, validateInputs, type RawInputs } from "@/lib/dealInputs";
import { formatCurrency, formatCurrencyChange, formatPercent, formatPointsChange } from "@/lib/format";
import { compareScenario, SCENARIO_FIELDS, type MetricComparison, type ScenarioField } from "@/lib/scenario";
import NumberField from "./NumberField";

const SCENARIO_FIELD_CONFIGS = SCENARIO_FIELDS.map((key) => ALL_FIELDS.find((field) => field.key === key)!);

function formatMetric(metric: MetricComparison, value: number | null): string {
  if (value === null) return "N/A";
  if (metric.format === "percent") return formatPercent(value);
  if (metric.format === "score") return String(value);
  return formatCurrency(value);
}

function formatChange(metric: MetricComparison): string {
  if (metric.change === null) return "N/A";
  if (metric.format === "percent") return formatPointsChange(metric.change);
  if (metric.format === "score") return `${metric.change > 0 ? "+" : ""}${metric.change}`;
  return formatCurrencyChange(metric.change);
}

function changeTone(metric: MetricComparison): string {
  if (metric.change === null || metric.better === "neutral") return "";
  const threshold = metric.format === "percent" ? 0.00005 : 0.5;
  if (Math.abs(metric.change) < threshold) return "";
  const favorable = metric.better === "higher" ? metric.change > 0 : metric.change < 0;
  return favorable ? "change-up" : "change-down";
}

export default function WhatIfSimulator({
  raw,
  onApply,
  canUndo,
  onUndo,
}: {
  raw: RawInputs;
  onApply: (changes: Partial<RawInputs>) => void;
  canUndo: boolean;
  onUndo: () => void;
}) {
  // Only the fields the user has edited are stored, so untouched fields keep following the original deal.
  const [overrides, setOverrides] = useState<Partial<Record<ScenarioField, string>>>({});

  const scenarioRaw: RawInputs = { ...raw, ...overrides };
  const baseValidation = useMemo(() => validateInputs(raw), [raw]);
  const scenarioValidation = validateInputs(scenarioRaw);

  const changedFields = SCENARIO_FIELDS.filter((key) => parseNumber(scenarioRaw[key]) !== parseNumber(raw[key]));
  const scenarioErrorCount = SCENARIO_FIELDS.filter((key) => scenarioValidation.errors[key]).length;
  const scenarioMissing = SCENARIO_FIELDS.filter((key) => scenarioValidation.missing.includes(key)).length;
  const comparison =
    baseValidation.inputs && scenarioValidation.inputs ? compareScenario(baseValidation.inputs, scenarioValidation.inputs) : null;

  function apply() {
    const changes: Partial<RawInputs> = {};
    for (const key of changedFields) changes[key] = scenarioRaw[key];
    onApply(changes);
    setOverrides({});
  }

  return (
    <section className="panel" aria-labelledby="whatif-heading">
      <div className="panel-header">
        <h2 id="whatif-heading">What-if simulator</h2>
        <span className="tag tag-muted">Rule-based</span>
      </div>

      <p className="explainer">
        Try different numbers and compare them with your original deal. Your property details stay the same unless you
        click <strong>Apply scenario</strong>. All other inputs (down payment %, term, taxes, and expenses) are kept the
        same. Taxes and insurance don&apos;t change with price.
      </p>

      <div className="field-grid whatif-fields">
        {SCENARIO_FIELD_CONFIGS.map((field) => {
          const changed = changedFields.includes(field.key as ScenarioField);
          return (
            <NumberField
              key={field.key}
              idPrefix="whatif"
              field={field}
              value={scenarioRaw[field.key]}
              error={scenarioValidation.errors[field.key]}
              highlighted={changed}
              hint={changed ? `Original: ${raw[field.key] || "blank"}` : "Same as original"}
              onChange={(value) => setOverrides((current) => ({ ...current, [field.key]: value }))}
            />
          );
        })}
      </div>

      <div className="form-actions whatif-actions">
        <button type="button" className="button button-secondary" onClick={apply} disabled={!comparison || changedFields.length === 0}>
          Apply scenario to my deal
        </button>
        <button type="button" className="button button-ghost" onClick={() => setOverrides({})} disabled={Object.keys(overrides).length === 0}>
          Reset scenario
        </button>
        {canUndo && (
          <button type="button" className="button button-ghost" onClick={onUndo}>
            Undo last apply
          </button>
        )}
      </div>
      <p className="field-hint" role="status">
        {changedFields.length > 0
          ? `${changedFields.length} ${changedFields.length === 1 ? "change" : "changes"} from your original deal.`
          : canUndo
            ? "Scenario applied. Your property details above now use these numbers."
            : "Change a value above to see how the deal responds."}
      </p>

      {comparison ? (
        <div className="table-scroll">
          <table className="data-table comparison-table">
            <caption className="visually-hidden">Original deal compared with the what-if scenario</caption>
            <thead>
              <tr>
                <th scope="col">Metric</th>
                <th scope="col">Original</th>
                <th scope="col">Scenario</th>
                <th scope="col">Change</th>
              </tr>
            </thead>
            <tbody>
              {comparison.metrics.map((metric) => (
                <tr key={metric.key}>
                  <th scope="row">{metric.label}</th>
                  <td>{formatMetric(metric, metric.original)}</td>
                  <td>{formatMetric(metric, metric.scenario)}</td>
                  <td className={changeTone(metric)}>{formatChange(metric)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="results-empty">
          {scenarioErrorCount > 0
            ? "Fix the highlighted scenario fields to see the comparison."
            : scenarioMissing > 0
              ? "Fill in the blank scenario fields to see the comparison."
              : "Complete the property details above to compare scenarios."}
        </p>
      )}
    </section>
  );
}
