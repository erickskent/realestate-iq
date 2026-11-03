import DealAnalyzer from "@/components/DealAnalyzer";
import { formatCurrency, formatPercentShort } from "@/lib/format";
import { RISK_RULES } from "@/lib/risks";
import { CATEGORY_THRESHOLDS, SCORING_RULE_TEXT, SCORING_RULES } from "@/lib/scoring";

type Assumption = { term: string; detail: string };

const KEY_TERMS: Assumption[] = [
  {
    term: "Cash flow",
    detail: "The money left each month after collecting rent and paying every expense, including the mortgage. Negative cash flow means you pay the difference.",
  },
  {
    term: "Net operating income (NOI)",
    detail: "What the property earns after operating expenses but before the mortgage. It describes the property itself, regardless of how it's financed.",
  },
  {
    term: "Cap rate",
    detail: "Annual NOI as a percentage of the price. It's a quick way to compare properties as if they were bought with cash.",
  },
  {
    term: "Cash-on-cash return",
    detail: "Annual cash flow as a percentage of the cash you put in. It answers: for each dollar I invest, how much comes back each year?",
  },
  {
    term: "Expense ratio",
    detail: "Operating expenses as a share of the rent you collect. A higher ratio leaves less rent to cover the mortgage.",
  },
  {
    term: "Debt coverage",
    detail: "NOI divided by the mortgage payment. 1.00× means the property earns just enough to pay the loan. Higher gives more cushion.",
  },
];

const CALCULATIONS: Assumption[] = [
  {
    term: "Mortgage payment",
    detail:
      "Uses the standard fixed-rate formula: payment = L × r ÷ (1 − (1 + r)^−n), where L is the loan amount (purchase price minus down payment), r is the annual rate ÷ 12, and n is the term in years × 12. At 0% interest, the loan is split evenly across the payments. Only principal and interest are included. Taxes and insurance are counted as operating expenses, and PMI is not included.",
  },
  {
    term: "Vacancy",
    detail: "Treated as lost income, not an expense. Effective rental income = monthly rent × (1 − vacancy %).",
  },
  {
    term: "Operating expenses",
    detail:
      "Property taxes ÷ 12 + insurance ÷ 12 + maintenance + property management + other expenses. Maintenance and management are calculated as a percentage of the full monthly rent, which is slightly conservative. The mortgage payment is not an operating expense.",
  },
  {
    term: "Net operating income (NOI)",
    detail: "Effective rental income − operating expenses. NOI is measured before the mortgage payment and before income taxes.",
  },
  {
    term: "Cap rate",
    detail: "Annual NOI ÷ purchase price. The renovation budget is not added to the price.",
  },
  {
    term: "Cash flow",
    detail: "Monthly NOI − monthly mortgage principal and interest. Annual cash flow is the monthly figure × 12.",
  },
  {
    term: "Cash-on-cash return",
    detail:
      "Annual cash flow ÷ total cash invested, where cash invested = down payment + renovation budget. Closing costs and cash reserves aren't included, so your real cash invested will usually be higher. Shows N/A if no cash is invested.",
  },
  {
    term: "What's not modeled",
    detail:
      "Rent and expenses are held constant. The analysis ignores rent growth, appreciation, loan paydown, depreciation, tax benefits, and selling costs.",
  },
];

const DEAL_INTELLIGENCE: Assumption[] = [
  {
    term: "Illustrative deal score",
    detail: `Five factors add up to 100 points: ${Object.values(SCORING_RULES)
      .map((rule) => `${rule.label.toLowerCase()} (${rule.maxPoints})`)
      .join(", ")}. Each factor earns points on a straight line between two benchmarks. Cash flow: ${SCORING_RULE_TEXT.cashFlow}. Cash-on-cash: ${SCORING_RULE_TEXT.cashOnCash}. Cap rate: ${SCORING_RULE_TEXT.capRate}. Expense ratio: ${SCORING_RULE_TEXT.expenseRatio}. Debt coverage: ${SCORING_RULE_TEXT.debtCoverage}.`,
  },
  {
    term: "Score categories",
    detail: `${CATEGORY_THRESHOLDS.strong}–100 is Strong, ${CATEGORY_THRESHOLDS.moderate}–${CATEGORY_THRESHOLDS.strong - 1} is Moderate, and below ${CATEGORY_THRESHOLDS.moderate} is High Risk. The benchmarks are simple teaching thresholds chosen for this tool, not industry standards. A deal with no mortgage gets full debt-coverage points. If cash-on-cash can't be calculated, the other factors are scaled to 100.`,
  },
  {
    term: "Risk checks",
    detail: `Flags negative cash flow, cash flow under ${formatCurrency(RISK_RULES.thinCashFlowBelow)}/mo, cash-on-cash under ${formatPercentShort(RISK_RULES.lowCashOnCashBelow)}, a year where one extra vacant month would erase annual cash flow, vacancy assumptions under ${formatPercentShort(RISK_RULES.lowVacancyAssumptionBelow)}, expense ratios over ${formatPercentShort(RISK_RULES.highExpenseRatioAbove)}, and cases where a ${formatCurrency(RISK_RULES.repairShock)} repair would take more than ${RISK_RULES.repairRecoveryMonthsAbove} months of cash flow to cover or ${formatPercentShort(RISK_RULES.expenseShock)} higher expenses would make cash flow negative.`,
  },
  {
    term: "What-if simulator",
    detail:
      "Changes only the fields you edit. Everything else stays the same, including the down payment percentage, so a higher price also means a bigger down payment. Taxes and insurance don't change with price. Your inputs change only when you click Apply scenario.",
  },
  {
    term: "Break-even targets",
    detail:
      "Each target changes one input and holds everything else steady. Because vacancy, maintenance, and management are a percentage of rent, they rise with rent, which the rent targets account for. A target shows as not reachable or not applicable when no value would work. Rent targets are rounded up and price targets down.",
  },
];

const ASSUMPTION_GROUPS: { title: string; items: Assumption[] }[] = [
  { title: "Key terms in plain English", items: KEY_TERMS },
  { title: "Financial calculations", items: CALCULATIONS },
  { title: "Deal intelligence rules", items: DEAL_INTELLIGENCE },
];

export default function Home() {
  return (
    <>
      <header className="site-header">
        <div className="container header-inner">
          <p className="logo">
            RealEstate<span>IQ</span>
          </p>
          <p className="header-tagline">AI-powered real estate deal analysis for first-time investors.</p>
        </div>
      </header>

      <main className="container">
        <section className="intro">
          <h1>Rental property deal analyzer</h1>
          <p>
            Enter a property&apos;s numbers to see its mortgage payment, operating costs, net operating income, and
            returns, plus a rule-based assessment, risk checks, what-if scenarios, and break-even targets. Results update
            as you type.
          </p>
        </section>

        <DealAnalyzer />

        <section className="panel assumptions" aria-labelledby="assumptions-heading">
          <h2 id="assumptions-heading">How the numbers are calculated</h2>
          {ASSUMPTION_GROUPS.map((group) => (
            <div key={group.title} className="assumption-group">
              <h3>{group.title}</h3>
              <dl>
                {group.items.map((item) => (
                  <div key={item.term}>
                    <dt>{item.term}</dt>
                    <dd>{item.detail}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </section>
      </main>

      <footer className="site-footer">
        <div className="container">
          <p>
            <strong>Disclaimer:</strong> RealEstateIQ is for informational and educational purposes only and does not
            provide financial, investment, tax, or legal advice. The deal score, risk checks, and targets are rule-based
            illustrations, not AI-generated, and are not predictions or guarantees of investment results. Results depend
            entirely on the numbers you enter. Verify all figures and consult a qualified professional before making any
            investment decision.
          </p>
        </div>
      </footer>
    </>
  );
}
