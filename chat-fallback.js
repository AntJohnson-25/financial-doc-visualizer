// Keyword-matched answers over the same computed metrics report.js uses.
// This is the no-API-key chat path — works for every user, not just ones
// who've enabled AI in Settings. Deliberately narrow: it only ever states
// numbers that came out of financialMetrics, and says so plainly when a
// question doesn't match anything it knows how to answer, rather than
// guessing.
(function () {
  const KPI_KEYWORDS = [
    { keywords: ["net income", "profit", "bottom line"], label: "Net Income" },
    { keywords: ["revenue", "sales", "top line"], label: "Revenue" },
    { keywords: ["gross margin", "gross profit"], label: "Gross Profit" },
    { keywords: ["operating income", "operating margin"], label: "Operating Income" },
    { keywords: ["opex", "operating expense"], label: "Operating Expenses" },
    { keywords: ["cash"], label: "Cash" },
    { keywords: ["asset"], label: "Total Assets" },
    { keywords: ["liabilit", "debt load"], label: "Total Liabilities" },
    { keywords: ["equity"], label: "Equity" },
  ];

  window.answerFallback = function answerFallback(question, byCategory) {
    const fm = window.financialMetrics;
    const data = fm.computeReportData(byCategory);
    const q = question.toLowerCase();

    for (const entry of KPI_KEYWORDS) {
      if (entry.keywords.some((k) => q.includes(k))) {
        const kpi = data.kpis.find((k) => k.label === entry.label);
        if (kpi) return describeKpi(kpi);
      }
    }

    if (q.includes("current ratio") || q.includes("liquidity")) {
      return describeRatio(data.ratios, "Current Ratio");
    }
    if ((q.includes("debt") && q.includes("equity")) || q.includes("leverage")) {
      return describeRatio(data.ratios, "Debt-to-Equity");
    }
    if (q.includes("margin") && (q.includes("trend") || q.includes("over time"))) {
      return describeMarginTrend(data.periodMetrics);
    }
    if (q.includes("trend") || q.includes("over time") || q.includes("growing") || q.includes("declining")) {
      return describeRevenueTrend(data.periodMetrics);
    }

    return (
      "I can answer direct questions about revenue, net income, gross/operating margin, cash, assets, " +
      "liabilities, equity, and balance-sheet ratios from your loaded data — try one of those, or enable " +
      "AI in Settings with your own API key for open-ended questions."
    );
  };

  function describeKpi(kpi) {
    const fm = window.financialMetrics;
    const val = fm.formatMetricValue(kpi.latest, kpi.format);
    if (kpi.deltaPct === null) return kpi.label + " is " + val + " for the most recent period.";
    const dir = kpi.deltaPct >= 0 ? "up" : "down";
    return kpi.label + " is " + val + " for the most recent period, " + dir + " " + Math.abs(kpi.deltaPct).toFixed(1) + "% from the prior period.";
  }

  function describeRatio(ratios, label) {
    const fm = window.financialMetrics;
    const r = ratios.find((r) => r.label === label);
    if (!r) {
      return "I don't have enough data to calculate " + label + " — it needs a Total Current Assets/Total Current Liabilities or full Liabilities/Equity breakdown in the loaded document(s).";
    }
    return label + " is " + fm.formatMetricValue(r.value, r.format) + ".";
  }

  function describeMarginTrend(periodMetrics) {
    if (periodMetrics.length < 2) return "I need at least two periods of data to describe a trend.";
    const first = periodMetrics[0];
    const last = periodMetrics[periodMetrics.length - 1];
    if (first.grossMarginPct === null || last.grossMarginPct === null) return "Gross margin isn't available for this data.";
    const diff = last.grossMarginPct - first.grossMarginPct;
    const dir = diff >= 0 ? "improved" : "declined";
    return "Gross margin " + dir + " from " + first.grossMarginPct.toFixed(1) + "% (" + first.period + ") to " + last.grossMarginPct.toFixed(1) + "% (" + last.period + ").";
  }

  function describeRevenueTrend(periodMetrics) {
    if (periodMetrics.length < 2) return "I need at least two periods of data to describe a trend.";
    const first = periodMetrics[0];
    const last = periodMetrics[periodMetrics.length - 1];
    if (!first.revenue) return "Revenue trend isn't available for this data.";
    const diff = ((last.revenue - first.revenue) / Math.abs(first.revenue)) * 100;
    const dir = diff >= 0 ? "grown" : "declined";
    return "Revenue has " + dir + " " + Math.abs(diff).toFixed(1) + "% from " + first.period + " to " + last.period + ".";
  }
})();
