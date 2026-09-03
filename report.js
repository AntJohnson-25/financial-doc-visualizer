// Deterministic (no-AI) report builder. Pure function of byCategory via
// financialMetrics — same numbers charts.js's cards already show, just
// written out as prose instead of tiles. No DOM/network dependency, so it
// works identically whether or not the user has an API key configured.
(function () {
  window.buildTemplatedReport = function buildTemplatedReport(byCategory) {
    const fm = window.financialMetrics;
    const data = fm.computeReportData(byCategory);
    const { kpis, periodMetrics, ratios } = data;

    const latest = periodMetrics.length ? periodMetrics[periodMetrics.length - 1] : null;
    const prior = periodMetrics.length > 1 ? periodMetrics[periodMetrics.length - 2] : null;

    const title = "Financial Report — " + new Date().toLocaleString();
    const sections = [];
    const lines = [];

    let summary;
    if (latest) {
      summary = "For " + latest.period + ", revenue was " + fmt(latest.revenue, "currency") + ".";
      if (latest.grossMarginPct !== null) summary += " Gross margin was " + fmt(latest.grossMarginPct, "percent") + ".";
      if (latest.netIncome !== null && latest.netIncome !== undefined) {
        summary += " Net income was " + fmt(latest.netIncome, "currency") + ".";
      }
      if (prior) {
        const revDelta = pctDelta(latest.revenue, prior.revenue);
        if (revDelta !== null) {
          summary += " Revenue " + trendWord(revDelta) + " " + Math.abs(revDelta).toFixed(1) + "% versus " + prior.period + ".";
        }
        const niDelta = pctDelta(latest.netIncome, prior.netIncome);
        if (niDelta !== null) {
          summary += " Net income " + trendWord(niDelta) + " " + Math.abs(niDelta).toFixed(1) + "% over the same period.";
        }
      }
    } else {
      summary = "Not enough revenue/expense data was found to build a P&L summary — this report covers only the metrics below.";
    }
    sections.push({ heading: "Executive summary", html: "<p>" + escapeHtml(summary) + "</p>" });
    lines.push("EXECUTIVE SUMMARY", summary, "");

    if (kpis.length) {
      const items = kpis.map((k) => {
        const val = fmt(k.latest, k.format);
        const delta = k.deltaPct === null ? "" : " (" + (k.deltaPct >= 0 ? "+" : "") + k.deltaPct.toFixed(1) + "% vs prior period)";
        return k.label + ": " + val + delta;
      });
      sections.push({ heading: "Key metrics", html: bulletList(items) });
      lines.push("KEY METRICS", ...items.map((i) => "- " + i), "");
    }

    const notable = kpis.filter((k) => k.deltaPct !== null && Math.abs(k.deltaPct) >= 25);
    if (notable.length) {
      const items = notable.map(
        (k) =>
          k.label + " moved " + (k.deltaPct >= 0 ? "up" : "down") + " " + Math.abs(k.deltaPct).toFixed(1) +
          "% period-over-period — worth a closer look."
      );
      sections.push({ heading: "Notable movements", html: bulletList(items, "flag") });
      lines.push("NOTABLE MOVEMENTS", ...items.map((i) => "- " + i), "");
    }

    if (ratios.length) {
      const items = ratios.map((r) => {
        const val = fmt(r.value, r.format);
        let note = "";
        if (r.label === "Current Ratio" && r.value < 1) note = " — below 1 suggests short-term liquidity risk.";
        if (r.label === "Debt-to-Equity" && r.value > 2) note = " — elevated leverage relative to equity.";
        return r.label + ": " + val + note;
      });
      sections.push({ heading: "Balance sheet ratios", html: bulletList(items) });
      lines.push("BALANCE SHEET RATIOS", ...items.map((i) => "- " + i), "");
    }

    const html = "<h2>" + escapeHtml(title) + "</h2>" + sections.map((s) => "<h3>" + escapeHtml(s.heading) + "</h3>" + s.html).join("");

    return { title, html, text: lines.join("\n") };
  };

  function bulletList(items, cls) {
    return "<ul>" + items.map((i) => '<li class="' + (cls || "") + '">' + escapeHtml(i) + "</li>").join("") + "</ul>";
  }

  function fmt(v, format) {
    return window.financialMetrics.formatMetricValue(v, format);
  }

  function pctDelta(latest, prior) {
    if (latest === null || latest === undefined || prior === null || prior === undefined || prior === 0) return null;
    return ((latest - prior) / Math.abs(prior)) * 100;
  }

  function trendWord(delta) {
    return delta >= 0 ? "increased" : "decreased";
  }

  function escapeHtml(s) {
    const div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
  }
})();
