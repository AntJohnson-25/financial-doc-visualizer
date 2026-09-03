// Shared derivations built on top of the normalized { lineItem, period, value,
// category } records — Gross Profit / Operating Income / margins / KPI deltas
// / balance-sheet ratios. Kept separate from charts.js so that file stays
// focused on rendering; this file has no DOM/Chart.js/D3 dependency.
(function () {
  const COGS_PATTERN = /cost of (goods|sales|revenue)|^cogs\b/i;
  const CASH_PATTERN = /\bcash\b/i;
  const CURRENT_ASSETS_PATTERN = /^total current assets/i;
  const CURRENT_LIABILITIES_PATTERN = /^total current liabilities/i;

  // Same "a total-labeled row wins, otherwise sum every row" rule charts.js
  // already used inline for per-category KPI faces.
  function getCategoryTotal(rows) {
    if (!rows || rows.length === 0) return 0;
    const totalRow = rows.find((r) => /^total\b/i.test(r.lineItem));
    return totalRow ? totalRow.value : rows.reduce((s, r) => s + r.value, 0);
  }

  function splitExpenses(expenseRows) {
    const cogsRows = [];
    const opexRows = [];
    (expenseRows || []).forEach((r) => {
      if (COGS_PATTERN.test(r.lineItem)) cogsRows.push(r);
      else opexRows.push(r);
    });
    return { cogsRows, opexRows };
  }

  // Ordered [{period, value}], summing every row that falls in that period —
  // generalizes the per-line-item grouping charts.js's buildTrendSeries does,
  // but for a single flattened total per period.
  function sumByPeriod(rows) {
    const periods = [];
    const totals = {};
    (rows || []).forEach((r) => {
      if (!periods.includes(r.period)) periods.push(r.period);
      totals[r.period] = (totals[r.period] || 0) + r.value;
    });
    return periods.map((period) => ({ period, value: totals[period] }));
  }

  function rowsForPeriod(rows, period) {
    return (rows || []).filter((r) => r.period === period);
  }

  // Per-period Revenue/COGS/Opex/GrossProfit/OperatingIncome/NetIncome and
  // margin percentages. Net income falls back through Net Result rows, then
  // to the computed operating income, same fallback style as
  // waterfall.js's buildWaterfallSteps.
  function computePeriodMetrics(byCategory) {
    const revenueRows = byCategory["Revenue"] || [];
    const expenseRows = byCategory["Expenses"] || [];
    const netRows = byCategory["Net Result"] || [];
    const { cogsRows, opexRows } = splitExpenses(expenseRows);

    const periods = [];
    [revenueRows, expenseRows, netRows].forEach((rows) =>
      rows.forEach((r) => {
        if (!periods.includes(r.period)) periods.push(r.period);
      })
    );

    return periods.map((period) => {
      const revenue = getCategoryTotal(rowsForPeriod(revenueRows, period));
      const cogs = getCategoryTotal(rowsForPeriod(cogsRows, period));
      const opex = getCategoryTotal(rowsForPeriod(opexRows, period));
      const grossProfit = revenue - cogs;
      const operatingIncome = grossProfit - opex;
      const netRowsForPeriod = rowsForPeriod(netRows, period);
      const netIncome = netRowsForPeriod.length ? getCategoryTotal(netRowsForPeriod) : operatingIncome;

      return {
        period,
        revenue,
        cogs,
        opex,
        grossProfit,
        operatingIncome,
        netIncome,
        grossMarginPct: revenue ? (grossProfit / revenue) * 100 : null,
        operatingMarginPct: revenue ? (operatingIncome / revenue) * 100 : null,
        netMarginPct: revenue ? (netIncome / revenue) * 100 : null,
      };
    });
  }

  // Latest value, prior-period value, % delta, and the full series (for a
  // sparkline) for each executive KPI. Metrics with no data simply don't
  // appear in the returned array — callers should skip missing ones.
  function computeExecutiveKpis(byCategory) {
    const periodMetrics = computePeriodMetrics(byCategory);
    const assetsRows = byCategory["Assets"] || [];
    const liabilitiesRows = byCategory["Liabilities"] || [];
    const equityRows = byCategory["Equity"] || [];
    const cashRows = assetsRows.filter((r) => CASH_PATTERN.test(r.lineItem));

    const kpis = [];

    function pushFromPeriodMetrics(key, label, format) {
      const series = periodMetrics.map((m) => m[key]).filter((v) => v !== null && v !== undefined);
      if (series.length === 0) return;
      const latest = periodMetrics[periodMetrics.length - 1][key];
      const prior = periodMetrics.length > 1 ? periodMetrics[periodMetrics.length - 2][key] : null;
      kpis.push(buildKpi(label, latest, prior, periodMetrics.map((m) => m[key]), format));
    }

    pushFromPeriodMetrics("revenue", "Revenue", "currency");
    pushFromPeriodMetrics("grossProfit", "Gross Profit", "currency");
    pushFromPeriodMetrics("grossMarginPct", "Gross Margin", "percent");
    pushFromPeriodMetrics("opex", "Operating Expenses", "currency");
    pushFromPeriodMetrics("operatingIncome", "Operating Income", "currency");
    pushFromPeriodMetrics("netIncome", "Net Income", "currency");

    // Per-period total, preferring a "Total ..." subtotal row over summing
    // every row when one exists — same rule getCategoryTotal already applies
    // elsewhere, needed here too so a document that includes both a
    // subtotal and its components doesn't get double-counted.
    function pushFromRows(rows, label) {
      const rowPeriods = [];
      (rows || []).forEach((r) => {
        if (!rowPeriods.includes(r.period)) rowPeriods.push(r.period);
      });
      if (rowPeriods.length === 0) return;
      const totals = rowPeriods.map((period) => getCategoryTotal(rowsForPeriod(rows, period)));
      const latest = totals[totals.length - 1];
      const prior = totals.length > 1 ? totals[totals.length - 2] : null;
      kpis.push(buildKpi(label, latest, prior, totals, "currency"));
    }

    pushFromRows(cashRows, "Cash");
    pushFromRows(assetsRows, "Total Assets");
    pushFromRows(liabilitiesRows, "Total Liabilities");
    pushFromRows(equityRows, "Equity");

    return kpis;
  }

  function buildKpi(label, latest, prior, series, format) {
    const deltaPct = prior !== null && prior !== undefined && prior !== 0 ? ((latest - prior) / Math.abs(prior)) * 100 : null;
    return { label, latest, prior, deltaPct, series, format };
  }

  // The "current" period for a category is the last distinct period label
  // encountered in its records — same convention charts.js's
  // mostRecentPeriod uses, so a newly re-dropped statement's rows (appended
  // last) naturally become "latest" without real date parsing.
  function latestPeriodOf(rows) {
    let last = null;
    (rows || []).forEach((r) => {
      last = r.period;
    });
    return last;
  }

  // Debt-to-Equity is always derivable when both categories exist. Current
  // Ratio / Working Capital need a current/non-current split the data model
  // doesn't otherwise carry — only surfaced when the source document happens
  // to include an explicit "Total Current Assets"/"Total Current Liabilities"
  // subtotal row. All figures are for the most recent period only — mixing
  // periods together would silently corrupt every ratio.
  function computeBalanceSheetRatios(byCategory) {
    const allLiabilitiesRows = byCategory["Liabilities"] || [];
    const allEquityRows = byCategory["Equity"] || [];
    const allAssetsRows = byCategory["Assets"] || [];

    const period = latestPeriodOf(allAssetsRows) || latestPeriodOf(allLiabilitiesRows) || latestPeriodOf(allEquityRows);
    const liabilitiesRows = rowsForPeriod(allLiabilitiesRows, period);
    const equityRows = rowsForPeriod(allEquityRows, period);
    const assetsRows = rowsForPeriod(allAssetsRows, period);

    const ratios = [];

    const totalLiabilities = getCategoryTotal(liabilitiesRows);
    const totalEquity = getCategoryTotal(equityRows);
    if (liabilitiesRows.length && equityRows.length && totalEquity !== 0) {
      ratios.push({ label: "Debt-to-Equity", value: totalLiabilities / totalEquity, format: "ratio" });
    }

    const currentAssetsRow = assetsRows.find((r) => CURRENT_ASSETS_PATTERN.test(r.lineItem));
    const currentLiabilitiesRow = liabilitiesRows.find((r) => CURRENT_LIABILITIES_PATTERN.test(r.lineItem));
    if (currentAssetsRow && currentLiabilitiesRow && currentLiabilitiesRow.value !== 0) {
      ratios.push({
        label: "Current Ratio",
        value: currentAssetsRow.value / currentLiabilitiesRow.value,
        format: "ratio",
      });
      ratios.push({
        label: "Working Capital",
        value: currentAssetsRow.value - currentLiabilitiesRow.value,
        format: "currency",
      });
    }

    return ratios;
  }

  // Single bundle of everything report.js/chat.js/chat-fallback.js need,
  // so they all read the same numbers charts.js's cards already show
  // instead of each re-deriving byCategory independently.
  function computeReportData(byCategory) {
    return {
      kpis: computeExecutiveKpis(byCategory),
      periodMetrics: computePeriodMetrics(byCategory),
      ratios: computeBalanceSheetRatios(byCategory),
    };
  }

  // Same formatting rule charts.js's formatKpiValue uses for KPI tiles —
  // duplicated here (rather than exported from charts.js) since this file
  // is the DOM-free layer and report/chat consumers shouldn't have to pull
  // in charts.js just for a number formatter.
  const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
  function formatMetricValue(value, format) {
    if (value === null || value === undefined || Number.isNaN(value)) return "—";
    if (format === "percent") return value.toFixed(1) + "%";
    if (format === "ratio") return value.toFixed(2);
    return numberFormat.format(value);
  }

  window.financialMetrics = {
    getCategoryTotal,
    splitExpenses,
    sumByPeriod,
    computePeriodMetrics,
    computeExecutiveKpis,
    computeBalanceSheetRatios,
    computeReportData,
    formatMetricValue,
  };
})();
