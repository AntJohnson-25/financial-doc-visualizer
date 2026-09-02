(function () {
  if (window.Chart && window.ChartAnnotation) {
    Chart.register(window.ChartAnnotation);
  }

  const dashboard = document.getElementById("dashboard");
  const noteEditor = document.getElementById("note-editor");
  const noteEditorLabel = document.getElementById("note-editor-label");
  const noteEditorInput = document.getElementById("note-editor-input");
  const noteEditorSave = document.getElementById("note-editor-save");
  const noteEditorClear = document.getElementById("note-editor-clear");
  const noteEditorCancel = document.getElementById("note-editor-cancel");
  const resetLayoutBtn = document.getElementById("reset-layout-btn");

  // Rough display order — categories not in this list (shouldn't happen,
  // normalize.js always falls back to "Other") are appended at the end.
  const CATEGORY_ORDER = ["Revenue", "Expenses", "Net Result", "Assets", "Liabilities", "Equity", "Cash Flow", "Other"];

  let chartInstances = [];
  let currentDocKey = "";
  let editingPointKey = null;
  let lastRenderArgs = null;

  noteEditorSave.addEventListener("click", () => {
    if (editingPointKey === null) return;
    window.setNote(currentDocKey, editingPointKey, noteEditorInput.value.trim());
    closeNoteEditor();
    if (lastRenderArgs) renderDashboard(lastRenderArgs.records, lastRenderArgs.docKey);
  });
  noteEditorClear.addEventListener("click", () => {
    if (editingPointKey === null) return;
    window.setNote(currentDocKey, editingPointKey, "");
    closeNoteEditor();
    if (lastRenderArgs) renderDashboard(lastRenderArgs.records, lastRenderArgs.docKey);
  });
  noteEditorCancel.addEventListener("click", closeNoteEditor);
  resetLayoutBtn.addEventListener("click", () => {
    if (!lastRenderArgs) return;
    window.clearWidgetLayout(currentDocKey);
    renderDashboard(lastRenderArgs.records, lastRenderArgs.docKey);
  });

  function closeNoteEditor() {
    noteEditor.hidden = true;
    editingPointKey = null;
  }

  function renderDashboard(records, docKey) {
    lastRenderArgs = { records, docKey };
    currentDocKey = docKey;
    closeNoteEditor();

    chartInstances.forEach((c) => c.destroy());
    chartInstances = [];
    window.resetWidgetCanvas(dashboard);

    const byCategory = groupByCategory(records);
    let orderedCategories = CATEGORY_ORDER.filter((c) => byCategory[c]).concat(
      Object.keys(byCategory).filter((c) => !CATEGORY_ORDER.includes(c))
    );

    const filter = window.getCategoryFilter ? window.getCategoryFilter() : null;
    if (filter) {
      orderedCategories = orderedCategories.filter((c) => filter.includes(c));
    }

    if (orderedCategories.length === 0) {
      dashboard.innerHTML = '<p class="sidebar-hint">No line items match this filter in the loaded document(s).</p>';
      return;
    }

    // These four are cross-category dashboard summaries (Executive Overview
    // spans Revenue/Expenses/Assets/Liabilities/Equity, the waterfall bridges
    // Revenue to Net Income, etc.) — only meaningful in the unfiltered "All"
    // view. Showing them under a single-statement filter just repeats
    // figures (e.g. Net Income) that don't belong to that statement type.
    if (!filter) {
      if (window.financialMetrics && (byCategory["Revenue"] || byCategory["Net Result"])) {
        buildExecutiveKpiCard(byCategory);
      }

      if (window.buildWaterfallSteps && byCategory["Revenue"] && byCategory["Expenses"]) {
        buildWaterfallCard(byCategory);
      }

      if (window.financialMetrics && byCategory["Revenue"] && byCategory["Expenses"]) {
        buildMarginAnalysisCard(byCategory);
      }

      if (window.financialMetrics && byCategory["Assets"]) {
        buildBalanceSheetCard(byCategory);
      }
    }

    orderedCategories.forEach((category) => {
      const categoryRecords = byCategory[category];
      const period = mostRecentPeriod(categoryRecords);
      const rows = categoryRecords.filter((r) => r.period === period);

      // A category built entirely by derive-cashflow.js is calculated, not
      // reported — say so on the card rather than passing it off as a figure
      // that appeared in the document.
      const isDerived = categoryRecords.every((r) => r.derived);
      const card = buildCard(category, period);

      // Summing a cash flow category would count every line twice, once as a
      // component and again inside its subtotal — the bottom line is the
      // single figure that actually answers "so what happened to cash?".
      const summaryTerms = category === "Cash Flow" ? ["change in cash", "increase in cash", "decrease in cash"] : [];
      const kpiRow =
        rows.find((r) => /^total\b/i.test(r.lineItem)) ||
        rows.find((r) => summaryTerms.some((term) => window.labelMatchesTerm(r.lineItem, term))) ||
        null;
      const kpiValue = numberFormat.format(kpiRow ? kpiRow.value : rows.reduce((s, r) => s + r.value, 0));
      const kpiLabel = kpiRow ? kpiRow.lineItem : category;

      const revenueTotal =
        category === "Expenses" && window.financialMetrics && byCategory["Revenue"]
          ? window.financialMetrics.getCategoryTotal(byCategory["Revenue"].filter((r) => r.period === period))
          : null;

      // Charts are only ever drawn once a slide is first shown —
      // Chart.js can't size a canvas correctly while its container is
      // display:none, so building it while the widget is still a collapsed
      // KPI face (or an unshown stack slide) would produce a blank/zero-size
      // chart.
      const slides = [
        {
          label: "Overview",
          bodyEl: card.el,
          onShow: () => initCategoryCharts(card, category, categoryRecords, rows, revenueTotal),
        },
      ];

      // Trend rides along as a second slide in the same widget rather than
      // spawning its own widget on the canvas or getting crammed under the
      // category's bar/composition chart — see buildTrendCard.
      const trend = buildTrendSeries(categoryRecords);
      let trendCard = null;
      if (trend.periods.length > 1) {
        trendCard = buildTrendCard();
        slides.push({
          label: "Trend across periods",
          bodyEl: trendCard.el,
          onShow: () => chartInstances.push(drawTrendChart(trendCard.canvas, trend, trendCard.detailsEl)),
        });
      }

      window.createStackedWidget(dashboard, {
        id: "cat::" + category,
        docKey: currentDocKey,
        title: category + (isDerived ? " · derived" : "") + " (" + period + ")",
        kpiValue,
        kpiLabel,
        slides,
        expandedSize: trendCard ? { w: 560, h: 460 } : undefined,
      });
    });
  }

  function initCategoryCharts(card, category, categoryRecords, rows, revenueTotal) {
    // Expenses read better ranked largest→smallest with % of revenue than
    // as a document-order vertical bar — see Master Prompt's "Expense
    // Breakdown" section.
    const isExpenseBreakdown = category === "Expenses";
    const orderedRows = isExpenseBreakdown ? rows.slice().sort((a, b) => Math.abs(b.value) - Math.abs(a.value)) : rows;

    const items = orderedRows.map((r) => ({ key: category + "::" + r.lineItem, value: r.value }));
    const outlierKeys = window.findOutliers(items);

    const chartOpts = {
      labels: orderedRows.map((r) => r.lineItem),
      values: orderedRows.map((r) => r.value),
      pointKeys: items.map((i) => i.key),
      outlierKeys,
      onBarClick: (pointKey, label) => promptForNote(pointKey, label),
    };
    const chart = isExpenseBreakdown
      ? drawExpenseBreakdownChart(card.canvas, Object.assign({ revenueTotal }, chartOpts))
      : drawBarChart(card.canvas, chartOpts);
    chartInstances.push(chart);

    renderCardOutlierSummary(card.outlierEl, orderedRows.map((r) => r.lineItem), items.map((i) => i.key), outlierKeys);

    // A share-of-total view only makes sense once there's more than one
    // part to compare, and only when every part points the same
    // direction — a pie mixing positive and negative slices lies about
    // proportions (e.g. a net-negative category would make one slice
    // look like it's "over 100%" of the whole). Skipped for expenses —
    // the ranked breakdown above already covers that ground without a pie.
    const allSameSign = orderedRows.every((r) => r.value >= 0) || orderedRows.every((r) => r.value <= 0);
    if (!isExpenseBreakdown && orderedRows.length > 1 && allSameSign) {
      card.compositionWrapEl.hidden = false;
      const compositionChart = drawCompositionChart(card.compositionCanvas, {
        labels: orderedRows.map((r) => r.lineItem),
        values: orderedRows.map((r) => Math.abs(r.value)),
      });
      chartInstances.push(compositionChart);
    }

  }

  window.renderDashboard = renderDashboard;

  if (window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (lastRenderArgs) renderDashboard(lastRenderArgs.records, lastRenderArgs.docKey);
    });
  }

  function buildWaterfallCard(byCategory) {
    const revenueRows = byCategory["Revenue"].filter((r) => r.period === mostRecentPeriod(byCategory["Revenue"]));
    const expenseRows = byCategory["Expenses"].filter((r) => r.period === mostRecentPeriod(byCategory["Expenses"]));
    const netRows = byCategory["Net Result"]
      ? byCategory["Net Result"].filter((r) => r.period === mostRecentPeriod(byCategory["Net Result"]))
      : [];

    const steps = window.buildWaterfallSteps(revenueRows, expenseRows, netRows);
    const netIncome = steps[steps.length - 1].end;

    const card = document.createElement("div");
    card.className = "chart-card";
    card.innerHTML = '<div class="waterfall-canvas-wrap"></div>';
    const wrap = card.querySelector(".waterfall-canvas-wrap");

    let initialized = false;
    let resizeTimer = null;

    window.createWidget(dashboard, {
      id: "waterfall",
      docKey: currentDocKey,
      title: "Revenue to Net Income Bridge",
      kpiValue: numberFormat.format(netIncome),
      kpiLabel: "Net Income",
      bodyEl: card,
      onToggle: (expanded) => {
        if (!expanded || initialized) return;
        initialized = true;
        window.renderWaterfall(wrap, steps);
      },
      onResize: () => {
        if (!initialized) return;
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => window.renderWaterfall(wrap, steps), 100);
      },
    });
  }

  function buildExecutiveKpiCard(byCategory) {
    const kpis = window.financialMetrics.computeExecutiveKpis(byCategory);
    if (kpis.length === 0) return;

    const netIncomeKpi = kpis.find((k) => k.label === "Net Income") || kpis[0];

    const card = document.createElement("div");
    card.className = "chart-card";
    card.innerHTML = '<div class="kpi-grid"></div>';
    const grid = card.querySelector(".kpi-grid");

    const sparklineTargets = [];
    kpis.forEach((kpi) => {
      const tile = document.createElement("div");
      tile.className = "kpi-tile";
      const deltaHtml =
        kpi.deltaPct === null
          ? ""
          : '<span class="kpi-tile-delta ' +
            (kpi.deltaPct >= 0 ? "up" : "down") +
            '">' +
            (kpi.deltaPct >= 0 ? "▲ " : "▼ ") +
            Math.abs(kpi.deltaPct).toFixed(1) +
            "%</span>";
      tile.innerHTML =
        '<div class="kpi-tile-label"></div>' +
        '<div class="kpi-tile-value"></div>' +
        deltaHtml +
        '<div class="kpi-tile-sparkline-wrap"><canvas></canvas></div>';
      tile.querySelector(".kpi-tile-label").textContent = kpi.label;
      tile.querySelector(".kpi-tile-value").textContent = formatKpiValue(kpi.latest, kpi.format);
      grid.appendChild(tile);
      sparklineTargets.push({ canvas: tile.querySelector(".kpi-tile-sparkline-wrap canvas"), kpi });
    });

    let initialized = false;
    window.createWidget(dashboard, {
      id: "executive-kpi",
      docKey: currentDocKey,
      title: "Executive Overview",
      kpiValue: formatKpiValue(netIncomeKpi.latest, netIncomeKpi.format),
      kpiLabel: netIncomeKpi.label,
      bodyEl: card,
      expandedSize: { w: 920, h: 380 },
      onToggle: (expanded) => {
        if (!expanded || initialized) return;
        initialized = true;
        sparklineTargets.forEach(({ canvas, kpi }) => {
          if (kpi.series.length < 2) return;
          const positive = kpi.deltaPct === null ? true : kpi.deltaPct >= 0;
          chartInstances.push(drawSparkline(canvas, kpi.series, positive));
        });
      },
    });
  }

  function buildMarginAnalysisCard(byCategory) {
    const periodMetrics = window.financialMetrics.computePeriodMetrics(byCategory);
    if (periodMetrics.length < 2) return;

    const card = document.createElement("div");
    card.className = "chart-card";
    card.innerHTML = '<div class="chart-card-canvas-wrap"><canvas></canvas></div>';
    const canvas = card.querySelector("canvas");
    const latest = periodMetrics[periodMetrics.length - 1];

    let initialized = false;
    window.createWidget(dashboard, {
      id: "margin-analysis",
      docKey: currentDocKey,
      title: "Margin Analysis",
      kpiValue: latest.netMarginPct === null ? "—" : latest.netMarginPct.toFixed(1) + "%",
      kpiLabel: "Net Margin",
      bodyEl: card,
      onToggle: (expanded) => {
        if (!expanded || initialized) return;
        initialized = true;
        chartInstances.push(drawMarginTrendChart(canvas, periodMetrics));
      },
    });
  }

  function buildBalanceSheetCard(byCategory) {
    const assetsRows = byCategory["Assets"] || [];
    if (assetsRows.length === 0) return;

    const period = mostRecentPeriod(assetsRows);
    // Total/subtotal rows are excluded from the stack segments themselves —
    // they'd otherwise double-count alongside the line items they sum.
    const assetsForPeriod = assetsRows.filter((r) => r.period === period && !/^total\b/i.test(r.lineItem));
    const liabilitiesForPeriod = (byCategory["Liabilities"] || []).filter(
      (r) => r.period === period && !/^total\b/i.test(r.lineItem)
    );
    const equityForPeriod = (byCategory["Equity"] || []).filter(
      (r) => r.period === period && !/^total\b/i.test(r.lineItem)
    );

    const totalAssets = window.financialMetrics.getCategoryTotal(assetsRows.filter((r) => r.period === period));
    const ratios = window.financialMetrics.computeBalanceSheetRatios(byCategory);

    const card = document.createElement("div");
    card.className = "chart-card";
    card.innerHTML =
      '<div class="balance-stack-wrap"><canvas></canvas></div>' +
      '<div class="ratio-tile-row"></div>' +
      '<div class="chart-trend-wrap"><h3 class="chart-trend-title">Structure over time</h3>' +
      '<div class="chart-trend-canvas-wrap"><canvas></canvas></div></div>';
    const stackCanvas = card.querySelector(".balance-stack-wrap canvas");
    const ratioRow = card.querySelector(".ratio-tile-row");
    const trendWrapEl = card.querySelector(".chart-trend-wrap");
    const trendCanvas = card.querySelector(".chart-trend-canvas-wrap canvas");

    if (ratios.length === 0) {
      ratioRow.remove();
    } else {
      ratios.forEach((r) => {
        const tile = document.createElement("div");
        tile.className = "ratio-tile";
        tile.innerHTML = '<div class="ratio-tile-label"></div><div class="ratio-tile-value"></div>';
        tile.querySelector(".ratio-tile-label").textContent = r.label;
        tile.querySelector(".ratio-tile-value").textContent = formatKpiValue(r.value, r.format);
        ratioRow.appendChild(tile);
      });
    }

    const structureTrend = buildStructureTrend(byCategory);
    if (structureTrend.periods.length <= 1) trendWrapEl.remove();

    let initialized = false;
    window.createWidget(dashboard, {
      id: "balance-sheet-structure",
      docKey: currentDocKey,
      title: "Balance Sheet Structure",
      kpiValue: numberFormat.format(totalAssets),
      kpiLabel: "Total Assets",
      bodyEl: card,
      expandedSize: { w: 640, h: 480 },
      onToggle: (expanded) => {
        if (!expanded || initialized) return;
        initialized = true;
        chartInstances.push(drawBalanceStackChart(stackCanvas, { assetsForPeriod, liabilitiesForPeriod, equityForPeriod }));
        if (structureTrend.periods.length > 1) {
          chartInstances.push(drawTrendChart(trendCanvas, structureTrend));
        }
      },
    });
  }

  // Total Assets / Total Liabilities / Equity across every period seen in
  // any of the three categories, for the balance sheet widget's historical
  // view. Same {periods, series} shape drawTrendChart already expects.
  function buildStructureTrend(byCategory) {
    const categories = [
      { key: "Assets", label: "Total Assets" },
      { key: "Liabilities", label: "Total Liabilities" },
      { key: "Equity", label: "Equity" },
    ];
    const periods = [];
    categories.forEach(({ key }) => {
      (byCategory[key] || []).forEach((r) => {
        if (!periods.includes(r.period)) periods.push(r.period);
      });
    });
    const series = categories
      .filter(({ key }) => byCategory[key] && byCategory[key].length)
      .map(({ key, label }) => ({
        label,
        data: periods.map((p) =>
          window.financialMetrics.getCategoryTotal((byCategory[key] || []).filter((r) => r.period === p))
        ),
      }));
    return { periods, series };
  }

  function formatKpiValue(value, format) {
    if (value === null || value === undefined || Number.isNaN(value)) return "—";
    if (format === "percent") return value.toFixed(1) + "%";
    if (format === "ratio") return value.toFixed(2);
    return numberFormat.format(value);
  }

  function groupByCategory(records) {
    const byCategory = {};
    records.forEach((r) => {
      if (!byCategory[r.category]) byCategory[r.category] = [];
      byCategory[r.category].push(r);
    });
    return byCategory;
  }

  // The "current" period for a category is the last distinct period label
  // encountered in that category's records, in the order documents were
  // loaded — so re-dropping a newer statement naturally becomes "latest"
  // without needing real date parsing across mixed document sets.
  // normalize.js emits records oldest period first, so the last one seen is
  // the most recent.
  function mostRecentPeriod(categoryRecords) {
    let last = null;
    categoryRecords.forEach((r) => {
      last = r.period;
    });
    return last;
  }

  function buildCard(category, period) {
    const el = document.createElement("div");
    el.className = "chart-card";
    el.innerHTML =
      '<div class="chart-card-header"><h2></h2></div>' +
      '<div class="chart-card-body">' +
      '<div class="chart-card-canvas-wrap"><canvas></canvas></div>' +
      '<div class="chart-composition-wrap" hidden>' +
      '<h3 class="chart-trend-title">Share of total</h3>' +
      '<div class="chart-composition-canvas-wrap"><canvas></canvas></div>' +
      "</div>" +
      "</div>" +
      '<div class="outlier-summary"></div>';
    el.querySelector("h2").textContent = category + " (" + period + ")";
    return {
      el,
      canvas: el.querySelector(".chart-card-canvas-wrap canvas"),
      outlierEl: el.querySelector(".outlier-summary"),
      compositionWrapEl: el.querySelector(".chart-composition-wrap"),
      compositionCanvas: el.querySelector(".chart-composition-canvas-wrap canvas"),
    };
  }

  // Standalone card for the per-category "trend across periods" widget —
  // split out from the main category card because cramming a multi-line
  // trend chart plus a bar/composition chart into one widget forced too
  // much into a single face, especially for categories like Cash Flow with
  // a dozen+ line items.
  function buildTrendCard() {
    const el = document.createElement("div");
    el.className = "chart-card chart-trend-card";
    el.innerHTML =
      '<div class="chart-trend-canvas-wrap"><canvas></canvas></div>' +
      '<div class="chart-trend-details" hidden></div>';
    return {
      el,
      canvas: el.querySelector(".chart-trend-canvas-wrap canvas"),
      detailsEl: el.querySelector(".chart-trend-details"),
    };
  }

  // Builds one line-series per line item across every distinct period seen
  // in this category, in the order periods were first encountered (i.e.
  // the column order from the source document, which is assumed chronological).
  function buildTrendSeries(categoryRecords) {
    const periods = [];
    const byLineItem = {};
    categoryRecords.forEach((r) => {
      if (!periods.includes(r.period)) periods.push(r.period);
      if (!byLineItem[r.lineItem]) byLineItem[r.lineItem] = {};
      byLineItem[r.lineItem][r.period] = r.value;
    });
    const series = Object.keys(byLineItem).map((lineItem) => ({
      label: lineItem,
      data: periods.map((p) => (byLineItem[lineItem].hasOwnProperty(p) ? byLineItem[lineItem][p] : null)),
    }));
    return { periods, series };
  }

  function themeColor(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function hexToRgba(hex, alpha) {
    const clean = hex.replace("#", "");
    const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
    const num = parseInt(full, 16);
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return "rgba(" + r + "," + g + "," + b + "," + alpha + ")";
  }

  const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
  const compactFormat = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

  function drawBarChart(canvas, { labels, values, pointKeys, outlierKeys, onBarClick }) {
    const primary = themeColor("--primary-light") || "#4a9eff";
    const danger = themeColor("--danger") || "#c0392b";
    const border = themeColor("--border") || "#d9e0e8";
    const textMuted = themeColor("--text-muted") || "#5a6472";
    const bgMuted = themeColor("--bg-muted") || "#f4f6f9";
    const text = themeColor("--text") || "#1a202c";

    const ctx = canvas.getContext("2d");
    const chartHeight = canvas.parentElement.clientHeight || 220;

    function gradientFor(hex) {
      const g = ctx.createLinearGradient(0, 0, 0, chartHeight);
      g.addColorStop(0, hexToRgba(hex, 0.85));
      g.addColorStop(1, hexToRgba(hex, 0.35));
      return g;
    }

    const normalFill = gradientFor(primary);
    const outlierFill = gradientFor(danger);
    const colors = pointKeys.map((key) => (outlierKeys.has(key) ? outlierFill : normalFill));
    const hoverColors = pointKeys.map((key) => hexToRgba(outlierKeys.has(key) ? danger : primary, 0.95));

    return new Chart(canvas, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            data: values,
            backgroundColor: colors,
            hoverBackgroundColor: hoverColors,
            borderRadius: 6,
            borderSkipped: false,
            maxBarThickness: 56,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 400, easing: "easeOutQuart" },
        onClick: (evt, elements) => {
          if (!elements.length) return;
          const idx = elements[0].index;
          onBarClick(pointKeys[idx], labels[idx]);
        },
        onHover: (evt, elements) => {
          evt.native.target.style.cursor = elements.length ? "pointer" : "default";
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: bgMuted,
            titleColor: text,
            bodyColor: text,
            borderColor: border,
            borderWidth: 1,
            padding: 10,
            cornerRadius: 8,
            displayColors: false,
            callbacks: {
              label: (item) => numberFormat.format(item.parsed.y),
            },
          },
          annotation: { annotations: window.buildAnnotationConfig(pointKeys, outlierKeys, currentDocKey) },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { autoSkip: false, maxRotation: 45, minRotation: 0, font: { size: 10 }, color: textMuted },
          },
          y: {
            grid: { color: hexToRgba(border, 0.6) },
            ticks: { color: textMuted, callback: (v) => compactFormat.format(v) },
          },
        },
      },
    });
  }

  function drawExpenseBreakdownChart(canvas, { labels, values, pointKeys, outlierKeys, revenueTotal, onBarClick }) {
    const primary = themeColor("--primary-light") || "#4a9eff";
    const danger = themeColor("--danger") || "#c0392b";
    const border = themeColor("--border") || "#d9e0e8";
    const textMuted = themeColor("--text-muted") || "#5a6472";
    const bgMuted = themeColor("--bg-muted") || "#f4f6f9";
    const text = themeColor("--text") || "#1a202c";

    const colors = pointKeys.map((key) => hexToRgba(outlierKeys.has(key) ? danger : primary, 0.75));
    const hoverColors = pointKeys.map((key) => hexToRgba(outlierKeys.has(key) ? danger : primary, 0.95));

    return new Chart(canvas, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            data: values,
            backgroundColor: colors,
            hoverBackgroundColor: hoverColors,
            borderRadius: 6,
            borderSkipped: false,
            maxBarThickness: 28,
          },
        ],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 400, easing: "easeOutQuart" },
        onClick: (evt, elements) => {
          if (!elements.length) return;
          const idx = elements[0].index;
          onBarClick(pointKeys[idx], labels[idx]);
        },
        onHover: (evt, elements) => {
          evt.native.target.style.cursor = elements.length ? "pointer" : "default";
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: bgMuted,
            titleColor: text,
            bodyColor: text,
            borderColor: border,
            borderWidth: 1,
            padding: 10,
            cornerRadius: 8,
            displayColors: false,
            callbacks: {
              label: (item) => {
                const value = item.parsed.x;
                const pct = revenueTotal ? " (" + ((Math.abs(value) / Math.abs(revenueTotal)) * 100).toFixed(1) + "% of revenue)" : "";
                return numberFormat.format(value) + pct;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { color: hexToRgba(border, 0.6) },
            ticks: { color: textMuted, callback: (v) => compactFormat.format(v) },
          },
          y: {
            grid: { display: false },
            ticks: { color: textMuted, font: { size: 10 } },
          },
        },
      },
    });
  }

  function drawSparkline(canvas, series, positive) {
    const color = (positive ? themeColor("--success") : themeColor("--danger")) || (positive ? "#1f8a4c" : "#c0392b");
    return new Chart(canvas, {
      type: "line",
      data: {
        labels: series.map((_, i) => i),
        datasets: [
          {
            data: series,
            borderColor: color,
            backgroundColor: hexToRgba(color, 0.15),
            fill: true,
            pointRadius: 0,
            borderWidth: 2,
            tension: 0.3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: { x: { display: false }, y: { display: false } },
      },
    });
  }

  function drawMarginTrendChart(canvas, periodMetrics) {
    const border = themeColor("--border") || "#d9e0e8";
    const textMuted = themeColor("--text-muted") || "#5a6472";
    const bgMuted = themeColor("--bg-muted") || "#f4f6f9";
    const text = themeColor("--text") || "#1a202c";

    const series = [
      { label: "Gross Margin", key: "grossMarginPct" },
      { label: "Operating Margin", key: "operatingMarginPct" },
      { label: "Net Margin", key: "netMarginPct" },
    ];

    const datasets = series.map((s, i) => {
      const color = paletteColor(i);
      return {
        label: s.label,
        data: periodMetrics.map((m) => m[s.key]),
        borderColor: color,
        backgroundColor: color,
        pointRadius: 3,
        pointHoverRadius: 5,
        tension: 0.25,
        spanGaps: true,
      };
    });

    return new Chart(canvas, {
      type: "line",
      data: { labels: periodMetrics.map((m) => m.period), datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 400, easing: "easeOutQuart" },
        plugins: {
          legend: { display: true, position: "bottom", labels: { color: textMuted, boxWidth: 10, font: { size: 10 } } },
          tooltip: {
            backgroundColor: bgMuted,
            titleColor: text,
            bodyColor: text,
            borderColor: border,
            borderWidth: 1,
            padding: 10,
            cornerRadius: 8,
            callbacks: {
              label: (item) => item.dataset.label + ": " + (item.parsed.y === null ? "—" : item.parsed.y.toFixed(1) + "%"),
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: textMuted, font: { size: 10 } },
          },
          y: {
            grid: { color: hexToRgba(border, 0.6) },
            ticks: { color: textMuted, callback: (v) => v + "%" },
          },
        },
      },
    });
  }

  function drawBalanceStackChart(canvas, { assetsForPeriod, liabilitiesForPeriod, equityForPeriod }) {
    const border = themeColor("--border") || "#d9e0e8";
    const textMuted = themeColor("--text-muted") || "#5a6472";
    const bgMuted = themeColor("--bg-muted") || "#f4f6f9";
    const text = themeColor("--text") || "#1a202c";

    let colorIdx = 0;
    const datasets = [];
    assetsForPeriod.forEach((r) => {
      datasets.push({
        label: r.lineItem,
        data: [Math.abs(r.value), null],
        backgroundColor: paletteColor(colorIdx++),
        stack: "balance",
      });
    });
    liabilitiesForPeriod.forEach((r) => {
      datasets.push({
        label: r.lineItem,
        data: [null, Math.abs(r.value)],
        backgroundColor: paletteColor(colorIdx++),
        stack: "balance",
      });
    });
    equityForPeriod.forEach((r) => {
      datasets.push({
        label: r.lineItem,
        data: [null, Math.abs(r.value)],
        backgroundColor: paletteColor(colorIdx++),
        stack: "balance",
      });
    });

    return new Chart(canvas, {
      type: "bar",
      data: { labels: ["Assets", "Liabilities + Equity"], datasets },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 400, easing: "easeOutQuart" },
        plugins: {
          legend: { display: true, position: "bottom", labels: { color: textMuted, boxWidth: 10, font: { size: 10 } } },
          tooltip: {
            backgroundColor: bgMuted,
            titleColor: text,
            bodyColor: text,
            borderColor: border,
            borderWidth: 1,
            padding: 10,
            cornerRadius: 8,
            callbacks: { label: (item) => item.dataset.label + ": " + numberFormat.format(item.parsed.x) },
          },
        },
        scales: {
          x: {
            stacked: true,
            grid: { color: hexToRgba(border, 0.6) },
            ticks: { color: textMuted, callback: (v) => compactFormat.format(v) },
          },
          y: {
            stacked: true,
            grid: { display: false },
            ticks: { color: textMuted },
          },
        },
      },
    });
  }

  function paletteColor(i) {
    const hue = (i * 47) % 360;
    return "hsl(" + hue + ", 65%, 60%)";
  }

  function drawCompositionChart(canvas, { labels, values }) {
    const bgMuted = themeColor("--bg-muted") || "#f4f6f9";
    const text = themeColor("--text") || "#1a202c";
    const textMuted = themeColor("--text-muted") || "#5a6472";
    const border = themeColor("--border") || "#d9e0e8";
    const total = values.reduce((s, v) => s + v, 0);

    return new Chart(canvas, {
      type: "doughnut",
      data: {
        labels,
        datasets: [
          {
            data: values,
            backgroundColor: labels.map((_, i) => paletteColor(i)),
            borderColor: bgMuted,
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "62%",
        animation: { duration: 400, easing: "easeOutQuart" },
        plugins: {
          legend: {
            position: "right",
            labels: { color: textMuted, boxWidth: 10, font: { size: 10 } },
          },
          tooltip: {
            backgroundColor: bgMuted,
            titleColor: text,
            bodyColor: text,
            borderColor: border,
            borderWidth: 1,
            padding: 10,
            cornerRadius: 8,
            callbacks: {
              label: (item) => {
                const pct = total ? ((item.parsed / total) * 100).toFixed(1) : "0.0";
                return item.label + ": " + numberFormat.format(item.parsed) + " (" + pct + "%)";
              },
            },
          },
        },
      },
    });
  }

  // detailsEl is optional — when given, clicking a legend entry also
  // renders a per-period value breakdown for the selected line into it
  // (the "Structure over time" trend inside the Balance Sheet widget
  // doesn't pass one and just gets the highlight behavior).
  function drawTrendChart(canvas, { periods, series }, detailsEl) {
    const border = themeColor("--border") || "#d9e0e8";
    const textMuted = themeColor("--text-muted") || "#5a6472";
    const bgMuted = themeColor("--bg-muted") || "#f4f6f9";
    const text = themeColor("--text") || "#1a202c";

    const baseColors = series.map((s, i) => paletteColor(i));
    let selectedIndex = null;

    const datasets = series.map((s, i) => ({
      label: s.label,
      data: s.data,
      borderColor: baseColors[i],
      backgroundColor: baseColors[i],
      borderWidth: 2,
      pointRadius: 3,
      pointHoverRadius: 5,
      tension: 0.25,
      spanGaps: true,
      order: 0,
    }));

    function applyHighlight(chart) {
      chart.data.datasets.forEach((ds, i) => {
        if (selectedIndex === null) {
          ds.borderColor = baseColors[i];
          ds.backgroundColor = baseColors[i];
          ds.borderWidth = 2;
          ds.pointRadius = 3;
          ds.order = 0;
        } else if (i === selectedIndex) {
          ds.borderColor = baseColors[i];
          ds.backgroundColor = baseColors[i];
          ds.borderWidth = 4;
          ds.pointRadius = 4;
          ds.order = -1;
        } else {
          ds.borderColor = hexToRgba(baseColors[i], 0.15);
          ds.backgroundColor = hexToRgba(baseColors[i], 0.15);
          ds.borderWidth = 1;
          ds.pointRadius = 0;
          ds.order = 1;
        }
      });
    }

    function updateDetails() {
      if (!detailsEl) return;
      if (selectedIndex === null) {
        detailsEl.hidden = true;
        detailsEl.innerHTML = "";
        return;
      }
      const s = series[selectedIndex];
      detailsEl.hidden = false;
      detailsEl.innerHTML =
        "<h4>" + escapeHtml(s.label) + "</h4>" +
        '<div class="chart-trend-details-grid">' +
        periods
          .map((p, i) => {
            const v = s.data[i];
            const shown = v === null || v === undefined ? "—" : numberFormat.format(v);
            return (
              '<div class="chart-trend-details-row"><span>' +
              escapeHtml(p) +
              "</span><span>" +
              shown +
              "</span></div>"
            );
          })
          .join("") +
        "</div>";
    }

    return new Chart(canvas, {
      type: "line",
      data: { labels: periods, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 400, easing: "easeOutQuart" },
        plugins: {
          legend: {
            display: series.length > 1,
            position: "bottom",
            labels: { color: textMuted, boxWidth: 10, font: { size: 10 } },
            onClick: (evt, item, legend) => {
              const idx = item.datasetIndex;
              selectedIndex = selectedIndex === idx ? null : idx;
              applyHighlight(legend.chart);
              updateDetails();
              legend.chart.update();
            },
          },
          tooltip: {
            backgroundColor: bgMuted,
            titleColor: text,
            bodyColor: text,
            borderColor: border,
            borderWidth: 1,
            padding: 10,
            cornerRadius: 8,
            callbacks: {
              label: (item) => item.dataset.label + ": " + numberFormat.format(item.parsed.y),
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: textMuted, font: { size: 10 } },
          },
          y: {
            grid: { color: hexToRgba(border, 0.6) },
            ticks: { color: textMuted, callback: (v) => compactFormat.format(v) },
          },
        },
      },
    });
  }

  function renderCardOutlierSummary(el, labels, pointKeys, outlierKeys) {
    if (outlierKeys.size === 0) {
      el.innerHTML = "";
      return;
    }
    const flagged = labels.filter((_, i) => outlierKeys.has(pointKeys[i]));
    el.innerHTML =
      "<p><strong>Outliers:</strong></p>" +
      flagged.map((k) => '<div class="outlier-item">' + escapeHtml(k) + "</div>").join("");
  }

  function promptForNote(pointKey, label) {
    editingPointKey = pointKey;
    noteEditorLabel.textContent = "Note for “" + label + "”";
    noteEditorInput.value = window.getNote(currentDocKey, pointKey);
    noteEditor.hidden = false;
    noteEditorInput.focus();
    noteEditor.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function escapeHtml(s) {
    const div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
  }
})();
