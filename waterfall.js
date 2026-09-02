// Revenue -> Expenses -> Net Income "bridge" chart, built with D3 instead of
// Chart.js because it needs floating/cumulative bars that Chart.js's bar
// chart type can't express (each bar starts where the previous one ended,
// rather than from zero).
(function () {
  function themeColor(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
  const compactFormat = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

  // Builds the bridge from Revenue down through each expense line item to
  // Net Income. Falls back to a running total if no explicit Net Result
  // record exists, so the chart still reconciles even for partial documents.
  function buildWaterfallSteps(revenueRows, expenseRows, netRows) {
    const revenueTotal = revenueRows.reduce((sum, r) => sum + r.value, 0);
    const steps = [{ label: "Revenue", start: 0, end: revenueTotal, type: "total" }];

    let running = revenueTotal;
    expenseRows.forEach((r) => {
      const start = running;
      running -= r.value;
      steps.push({ label: r.lineItem, start, end: running, type: running <= start ? "decrease" : "increase" });
    });

    const netIncome = netRows.length ? netRows.reduce((sum, r) => sum + r.value, 0) : running;
    steps.push({ label: "Net Income", start: 0, end: netIncome, type: "total" });
    return steps;
  }

  function renderWaterfall(container, steps) {
    container.innerHTML = "";
    const width = container.clientWidth || 600;
    const height = container.clientHeight || 260;
    const margin = { top: 20, right: 16, bottom: 60, left: 56 };

    const colors = {
      total: themeColor("--primary-light") || "#4a9eff",
      increase: "#2ecc71",
      decrease: themeColor("--danger") || "#c0392b",
    };
    const textMuted = themeColor("--text-muted") || "#5a6472";
    const border = themeColor("--border") || "#d9e0e8";
    const text = themeColor("--text") || "#1a202c";
    const bgMuted = themeColor("--bg-muted") || "#f4f6f9";

    const svg = d3
      .select(container)
      .append("svg")
      .attr("width", width)
      .attr("height", height)
      .attr("viewBox", [0, 0, width, height]);

    const x = d3
      .scaleBand()
      .domain(steps.map((s) => s.label))
      .range([margin.left, width - margin.right])
      .padding(0.35);

    const values = steps.flatMap((s) => [s.start, s.end]);
    const y = d3
      .scaleLinear()
      .domain([Math.min(0, d3.min(values)), Math.max(0, d3.max(values))])
      .nice()
      .range([height - margin.bottom, margin.top]);

    svg
      .append("g")
      .attr("transform", "translate(" + margin.left + ",0)")
      .call(d3.axisLeft(y).ticks(5).tickFormat((v) => compactFormat.format(v)))
      .call((g) => g.select(".domain").remove())
      .call((g) => g.selectAll("line").attr("stroke", border))
      .call((g) => g.selectAll("text").attr("fill", textMuted).attr("font-size", 10));

    svg
      .append("g")
      .attr("transform", "translate(0," + y(0) + ")")
      .call(d3.axisBottom(x).tickSize(0))
      .call((g) => g.select(".domain").attr("stroke", border))
      .call((g) =>
        g
          .selectAll("text")
          .attr("fill", textMuted)
          .attr("font-size", 10)
          .attr("transform", "rotate(-30)")
          .style("text-anchor", "end")
      );

    // Connector lines linking each bar's end to the next bar's start, the
    // visual thread that makes a waterfall read as a flow rather than
    // disconnected bars.
    svg
      .selectAll(".connector")
      .data(steps.slice(0, -1))
      .join("line")
      .attr("class", "connector")
      .attr("x1", (d) => x(d.label) + x.bandwidth())
      .attr("x2", (d, i) => x(steps[i + 1].label))
      .attr("y1", (d) => y(d.end))
      .attr("y2", (d) => y(d.end))
      .attr("stroke", border)
      .attr("stroke-dasharray", "3,3");

    const bars = svg
      .selectAll(".bar")
      .data(steps)
      .join("rect")
      .attr("class", "bar")
      .attr("x", (d) => x(d.label))
      .attr("width", x.bandwidth())
      .attr("fill", (d) => colors[d.type])
      .attr("rx", 4)
      .attr("y", y(0))
      .attr("height", 0);

    bars
      .transition()
      .duration(600)
      .ease(d3.easeCubicOut)
      .attr("y", (d) => y(Math.max(d.start, d.end)))
      .attr("height", (d) => Math.max(1, Math.abs(y(d.start) - y(d.end))));

    svg
      .selectAll(".value-label")
      .data(steps)
      .join("text")
      .attr("class", "value-label")
      .attr("x", (d) => x(d.label) + x.bandwidth() / 2)
      .attr("y", (d) => y(Math.max(d.start, d.end)) - 6)
      .attr("text-anchor", "middle")
      .attr("fill", text)
      .attr("font-size", 11)
      .attr("opacity", 0)
      .text((d) => numberFormat.format(d.type === "total" ? d.end : d.end - d.start))
      .transition()
      .delay(400)
      .duration(300)
      .attr("opacity", 1);

    const tooltip = d3
      .select(container)
      .append("div")
      .attr("class", "waterfall-tooltip")
      .style("position", "absolute")
      .style("pointer-events", "none")
      .style("opacity", 0)
      .style("background", bgMuted)
      .style("border", "1px solid " + border)
      .style("border-radius", "8px")
      .style("padding", "6px 10px")
      .style("font-size", "12px")
      .style("color", text);

    bars
      .on("mousemove", (event, d) => {
        const [mx, my] = d3.pointer(event, container);
        const delta = d.type === "total" ? d.end : d.end - d.start;
        tooltip
          .style("opacity", 1)
          .style("left", mx + 12 + "px")
          .style("top", my - 10 + "px")
          .html("<strong>" + d.label + "</strong><br>" + numberFormat.format(delta));
      })
      .on("mouseleave", () => tooltip.style("opacity", 0));

    container.style.position = "relative";
  }

  window.buildWaterfallSteps = buildWaterfallSteps;
  window.renderWaterfall = renderWaterfall;
})();
