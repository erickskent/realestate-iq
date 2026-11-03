import type { DealInputs } from "@/lib/calculations";
import { formatCurrency, formatCurrencyChange, formatPercentShort } from "@/lib/format";
import { breakEvenVacancy, maxPriceForCashFlow, RENT_TARGETS, rentForCashFlow, rentKeepShare, type TargetResult } from "@/lib/targets";

type TargetCard = {
  title: string;
  result: TargetResult;
  format: (value: number) => string;
  describe: (value: number, current: number) => string;
};

const STATUS_LABEL: Record<Exclude<TargetResult["status"], "ok">, string> = {
  impossible: "Not reachable",
  undefined: "Not applicable",
  always: "Always met",
};

function rentGap(target: number, current: number): string {
  const gap = Math.ceil(target) - current;
  if (Math.abs(gap) < 1) return "Your rent is right at this level.";
  if (gap > 0) {
    const pct = current > 0 ? ` (${formatPercentShort(gap / current)} more)` : "";
    return `${formatCurrencyChange(gap)}/mo above your current rent of ${formatCurrency(current)}${pct}.`;
  }
  return `Your current rent of ${formatCurrency(current)} is ${formatCurrency(-gap)}/mo above this.`;
}

export default function WhatMustChange({ inputs }: { inputs: DealInputs }) {
  const keepShare = rentKeepShare(inputs);
  const rentPctTotal = inputs.vacancyPct + inputs.maintenancePct + inputs.managementPct;

  const cards: TargetCard[] = [
    ...RENT_TARGETS.map(
      (target): TargetCard => ({
        title: `Rent for ${formatCurrency(target)}/mo cash flow`,
        result: rentForCashFlow(inputs, target),
        format: (value) => `${formatCurrency(Math.ceil(value))}/mo`,
        describe: rentGap,
      }),
    ),
    {
      title: "Highest price for $0/mo cash flow",
      result: maxPriceForCashFlow(inputs, 0),
      format: (value) => formatCurrency(Math.floor(value)),
      describe: (value, current) => {
        const gap = Math.floor(value) - current;
        return gap >= 0
          ? `${formatCurrency(gap)} above your purchase price of ${formatCurrency(current)}, at the same down payment %, rate, and term.`
          : `${formatCurrency(-gap)} below your purchase price of ${formatCurrency(current)}, at the same down payment %, rate, and term.`;
      },
    },
    {
      title: "Highest vacancy before cash flow hits $0",
      result: breakEvenVacancy(inputs),
      format: (value) => formatPercentShort(value),
      describe: (value) => `About ${Math.round(value * 12 * 10) / 10} months empty per year. You assumed ${formatPercentShort(inputs.vacancyPct / 100)}.`,
    },
  ];

  return (
    <section className="panel" aria-labelledby="targets-heading">
      <div className="panel-header">
        <h2 id="targets-heading">What must change</h2>
        <span className="tag tag-muted">Rule-based</span>
      </div>

      <p className="explainer">
        Break-even targets show roughly how far one number would need to move, with everything else held the same.
        {keepShare > 0 && (
          <>
            {" "}
            Vacancy, maintenance, and management are a share of rent ({formatPercentShort(rentPctTotal / 100)} in
            total), so each extra $1 of rent adds only about <strong>${keepShare.toFixed(2)}</strong> to cash flow.
          </>
        )}
      </p>

      <div className="target-grid">
        {cards.map((card) => (
          <div key={card.title} className={`target-card${card.result.status === "ok" ? "" : " target-unavailable"}`}>
            <p className="target-title">{card.title}</p>
            {card.result.status === "ok" ? (
              <>
                <p className="target-value">≈ {card.format(card.result.value)}</p>
                <p className="target-note">{card.describe(card.result.value, card.result.current)}</p>
              </>
            ) : (
              <>
                <p className="target-value target-status">{STATUS_LABEL[card.result.status]}</p>
                <p className="target-note">{card.result.reason}</p>
              </>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
