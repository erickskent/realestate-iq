import type { DealAnalysis } from "@/lib/calculations";
import { formatCurrency, formatPercent } from "@/lib/format";
import { CATEGORY_THRESHOLDS, scoreDeal, type ScoreCategory, type ScoreFactor } from "@/lib/scoring";

const CATEGORY_TEXT: Record<ScoreCategory, string> = {
  Strong: "These numbers meet most of this tool's illustrative benchmarks.",
  Moderate: "These numbers meet some benchmarks and fall short on others.",
  "High Risk": "Several of these numbers fall short of the benchmarks, so small surprises could have a big effect.",
};

const CATEGORY_CLASS: Record<ScoreCategory, string> = {
  Strong: "category-strong",
  Moderate: "category-moderate",
  "High Risk": "category-high-risk",
};

function formatFactorValue(factor: ScoreFactor): string {
  if (factor.value === null) return "N/A";
  if (factor.id === "cashFlow") return `${formatCurrency(factor.value)}/mo`;
  if (factor.id === "debtCoverage") return `${factor.value.toFixed(2)}×`;
  return formatPercent(factor.value);
}

export default function DealAssessment({ analysis }: { analysis: DealAnalysis }) {
  const { score, category, factors, scaled } = scoreDeal(analysis);

  return (
    <section className="panel" aria-labelledby="assessment-heading">
      <div className="panel-header">
        <h2 id="assessment-heading">Deal assessment</h2>
        <span className="tag tag-muted">Rule-based</span>
      </div>

      <div className="score-summary">
        <div className={`score-value ${CATEGORY_CLASS[category]}`}>
          <span className="score-number">{score}</span>
          <span className="score-out-of">/ 100</span>
        </div>
        <div className="score-detail">
          <p className={`category-badge ${CATEGORY_CLASS[category]}`}>{category}</p>
          <p className="score-text">{CATEGORY_TEXT[category]}</p>
        </div>
      </div>

      <div
        className="score-meter"
        role="meter"
        aria-label="Illustrative deal score"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={score}
        aria-valuetext={`${score} out of 100, ${category}`}
      >
        <div className={`score-meter-fill ${CATEGORY_CLASS[category]}`} style={{ width: `${score}%` }} />
      </div>
      <p className="score-scale">
        0–{CATEGORY_THRESHOLDS.moderate - 1} High Risk · {CATEGORY_THRESHOLDS.moderate}–{CATEGORY_THRESHOLDS.strong - 1} Moderate ·{" "}
        {CATEGORY_THRESHOLDS.strong}–100 Strong
      </p>

      <p className="explainer">
        <strong>What this score is:</strong> an illustrative, rule-based summary of how these numbers compare with five
        fixed benchmarks. It is not a prediction or guarantee of how an investment will perform, and it can&apos;t see
        the property&apos;s condition, location, or market.
      </p>

      <h3 className="section-title">How the points were earned</h3>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Factor</th>
              <th scope="col">This deal</th>
              <th scope="col">Points</th>
              <th scope="col" className="rule-header">Benchmark rule</th>
            </tr>
          </thead>
          <tbody>
            {factors.map((factor) => (
              <tr key={factor.id}>
                <th scope="row">{factor.label}</th>
                <td>{formatFactorValue(factor)}</td>
                <td>{factor.points === null ? "Not scored" : `${factor.points.toFixed(1)} / ${factor.maxPoints}`}</td>
                <td className="rule-cell">
                  {factor.rule}
                  {factor.note && <span className="rule-note">{factor.note}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {scaled && (
        <p className="field-hint">
          One factor couldn&apos;t be measured, so the points from the remaining factors were scaled to a 100-point
          total.
        </p>
      )}
    </section>
  );
}
