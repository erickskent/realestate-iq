"use client";

import { useEffect, useRef, useState } from "react";
import type { DealInputs } from "@/lib/calculations";
import type { FactSheet } from "@/lib/aiAnalysis";
import type { AnalyzeResponse, AnalyzeSuccess } from "@/lib/analyzeHandler";
import { formatCurrency } from "@/lib/format";

type Availability = "checking" | "available" | "missing_key" | "limits_unavailable" | "unknown";

type RequestState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string; missingKey: boolean }
  | { status: "done"; result: AnalyzeSuccess; inputsKey: string };

/** Slightly longer than the server's own timeout, so the server's clearer message usually arrives first. */
const CLIENT_TIMEOUT_MS = 35_000;

function factRows(facts: FactSheet): [string, string][] {
  const m = facts.calculatedMetrics;
  const percent = (value: number | null) => (value === null ? "N/A" : `${value.toFixed(2)}%`);
  return [
    ["Monthly cash flow", `${formatCurrency(m.monthlyCashFlow_usd)}/mo`],
    ["Annual cash flow", formatCurrency(m.annualCashFlow_usd)],
    ["Net operating income", `${formatCurrency(m.annualNetOperatingIncome_usd)}/yr`],
    ["Cap rate", percent(m.capRate_pct)],
    ["Cash-on-cash return", percent(m.cashOnCashReturn_pct)],
    ["Mortgage principal & interest", `${formatCurrency(m.monthlyMortgagePrincipalAndInterest_usd)}/mo`],
    ["Total cash invested", formatCurrency(m.totalCashInvested_usd)],
    ["Rule-based score", `${facts.ruleBasedAssessment.illustrativeScore_outOf100}/100 (${facts.ruleBasedAssessment.scoreCategory})`],
  ];
}

export default function AiAnalysis({ inputs }: { inputs: DealInputs | null }) {
  const [availability, setAvailability] = useState<Availability>("checking");
  const [state, setState] = useState<RequestState>({ status: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  const inputsKey = inputs ? JSON.stringify(inputs) : "";

  useEffect(() => {
    let cancelled = false;
    fetch("/api/analyze", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { configured?: boolean; reason?: string | null } | null) => {
        if (cancelled) return;
        if (!data) setAvailability("unknown");
        else if (data.configured) setAvailability("available");
        else setAvailability(data.reason === "rate_limit_unavailable" ? "limits_unavailable" : "missing_key");
      })
      .catch(() => !cancelled && setAvailability("unknown"));
    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, []);

  async function analyze() {
    if (!inputs) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
    const requestKey = inputsKey;
    setState({ status: "loading" });

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inputs }),
        signal: controller.signal,
      });
      const data = (await response.json().catch(() => null)) as AnalyzeResponse | null;

      if (data?.ok) {
        setState({ status: "done", result: data, inputsKey: requestKey });
      } else if (data && !data.ok) {
        const wait = data.retryAfterSeconds ? ` (about ${Math.ceil(data.retryAfterSeconds / 60)} min)` : "";
        if (data.error === "missing_api_key") setAvailability("missing_key");
        if (data.error === "rate_limit_unavailable") setAvailability("limits_unavailable");
        setState({ status: "error", message: `${data.message}${wait}`, missingKey: data.error === "missing_api_key" || data.error === "rate_limit_unavailable" });
      } else {
        setState({ status: "error", message: `The server returned an unexpected response (${response.status}).`, missingKey: false });
      }
    } catch {
      if (abortRef.current !== controller) return; // A newer request replaced this one.
      setState({
        status: "error",
        message: controller.signal.aborted ? "The AI analysis took too long. Please try again." : "Couldn't reach the server. Check your connection and try again.",
        missingKey: false,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  const loading = state.status === "loading";
  const missingKey = availability === "missing_key";
  const limitsUnavailable = availability === "limits_unavailable";
  const stale = state.status === "done" && state.inputsKey !== inputsKey;

  return (
    <section className="panel ai-panel" aria-labelledby="ai-heading" aria-busy={loading}>
      <div className="panel-header">
        <h2 id="ai-heading">AI analysis</h2>
        <span className="tag tag-ai">AI-generated · Claude</span>
      </div>

      <p className="explainer">
        Claude reads the numbers this calculator produced and explains them in plain English. It only sees the figures
        listed under <strong>Calculated facts</strong>. It doesn&apos;t know the property&apos;s location, condition, or
        local market, and it isn&apos;t asked to guess them.
      </p>

      {limitsUnavailable ? (
        <div className="ai-notice" role="status">
          <strong>AI analysis is turned off on this server for now.</strong> Its request limits haven&apos;t been
          configured yet. Everything else on this page works without it.
        </div>
      ) : missingKey ? (
        <div className="ai-notice" role="status">
          <strong>AI analysis isn&apos;t set up yet.</strong> The site owner needs to add an <code>ANTHROPIC_API_KEY</code>{" "}
          on the server. Everything else on this page works without it.
        </div>
      ) : (
        <div className="form-actions ai-actions">
          <button
            type="button"
            className="button button-secondary"
            onClick={analyze}
            disabled={!inputs || loading || availability === "checking"}
          >
            {loading ? "Analyzing…" : state.status === "done" ? "Analyze again with AI" : "Analyze with AI"}
          </button>
          <span className="field-hint">
            {!inputs
              ? "Complete the property details to enable AI analysis."
              : "Sends only the numbers above to Anthropic's Claude API. Usually takes 10–30 seconds."}
          </span>
        </div>
      )}

      <div role="status" aria-live="polite">
        {loading && (
          <p className="ai-loading">
            <span className="spinner" aria-hidden="true" /> Claude is reviewing the calculated numbers…
          </p>
        )}
        {state.status === "error" && !state.missingKey && (
          <div className="ai-error">
            <p>
              <strong>AI analysis didn&apos;t complete.</strong> {state.message}
            </p>
            <p className="field-hint">The calculator, rule-based assessment, and simulator above still work normally.</p>
          </div>
        )}
      </div>

      {state.status === "done" && (
        <div className="ai-result">
          {stale && (
            <p className="ai-stale" role="status">
              Your inputs changed after this analysis was created. Run it again to analyze the current numbers.
            </p>
          )}

          <div className="ai-columns">
            <div className="ai-facts">
              <h3 className="section-title">Calculated facts</h3>
              <p className="field-hint">From RealEstateIQ&apos;s formulas. These are the numbers Claude was given.</p>
              <dl className="summary-list ai-fact-list">
                {factRows(state.result.factSheet).map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className="ai-interpretation">
              <h3 className="section-title">
                AI interpretation <span className="tag tag-ai">Generated by Claude</span>
              </h3>
              <p className="ai-summary">{state.result.assessment.summary}</p>

              <h4>Three major risks</h4>
              <ol className="ai-list">
                {state.result.assessment.risks.map((item) => (
                  <li key={item.title}>
                    <strong>{item.title}.</strong> {item.explanation}
                  </li>
                ))}
              </ol>

              <h4>Ideas to explore</h4>
              <ul className="ai-list">
                {state.result.assessment.improvements.map((item) => (
                  <li key={item.title}>
                    <strong>{item.title}.</strong> {item.explanation}
                  </li>
                ))}
              </ul>

              <h4>Assumptions to verify</h4>
              <ul className="ai-list">
                {state.result.assessment.assumptionsToVerify.map((item) => (
                  <li key={item.assumption}>
                    <strong>{item.assumption}.</strong> {item.howToVerify}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <p className="disclaimer-inline">
            AI-generated interpretation can be incomplete or wrong. It is informational only, not financial or
            investment advice, and not a prediction of results. Check every figure against the calculated facts.
            Generated {new Date(state.result.generatedAt).toLocaleString()} by {state.result.model}.
          </p>
        </div>
      )}
    </section>
  );
}
