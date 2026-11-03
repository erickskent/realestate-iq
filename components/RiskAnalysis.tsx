import type { DealAnalysis, DealInputs } from "@/lib/calculations";
import { analyzeRisks, type RiskSeverity } from "@/lib/risks";

const SEVERITY_LABEL: Record<RiskSeverity, string> = { high: "High", medium: "Watch", low: "Note" };

export default function RiskAnalysis({ inputs, analysis }: { inputs: DealInputs; analysis: DealAnalysis }) {
  const findings = analyzeRisks(inputs, analysis);

  return (
    <section className="panel" aria-labelledby="risk-heading">
      <div className="panel-header">
        <h2 id="risk-heading">Risk analysis</h2>
        <span className="tag tag-muted">Rule-based</span>
      </div>

      <p className="explainer">
        These checks flag numbers that could make the deal harder to hold. Each warning uses this property&apos;s own
        figures. They&apos;re simple rules, not a full risk review.
      </p>

      {findings.length === 0 ? (
        <p className="results-empty">
          None of the rule-based checks were triggered by these numbers. That doesn&apos;t mean the deal has no risk.
          Repairs, market changes, and tenant issues aren&apos;t captured here.
        </p>
      ) : (
        <ul className="risk-list">
          {findings.map((finding) => (
            <li key={finding.id} className={`risk-item risk-${finding.severity}`}>
              <div className="risk-heading">
                <span className={`severity severity-${finding.severity}`}>{SEVERITY_LABEL[finding.severity]}</span>
                <h3>{finding.title}</h3>
              </div>
              <p>{finding.explanation}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
