// Builds an indirect cash flow statement out of a document that carries the
// ingredients but not the statement itself — the shape you get from an
// operational export: a row per date, with revenue/cost columns alongside
// working-capital balances, capex and debt.
//
// Only runs when the document has no cash flow lines of its own, and every
// row it produces is flagged `derived` so the dashboard can label it as
// calculated rather than reported.
(function () {
  // Balances (a level at each date) are differenced between periods; flows
  // (an amount spent during the period) are used as-is.
  const ROLES = [
    { key: "receivable", kind: "balance", terms: ["receivable"] },
    { key: "inventory", kind: "balance", terms: ["inventory"] },
    { key: "payable", kind: "balance", terms: ["payable"] },
    { key: "debt", kind: "balance", terms: ["debt", "borrowing", "loan", "note payable", "line of credit"] },
    { key: "capex", kind: "flow", terms: ["capital expenditure", "capex", "purchase of equipment", "purchases of equipment"] },
    { key: "depreciation", kind: "flow", terms: ["depreciation", "amortization", "amortisation"] },
  ];

  function periodsInOrder(records) {
    const seen = [];
    records.forEach((r) => {
      if (!seen.includes(r.period)) seen.push(r.period);
    });
    return seen;
  }

  function totalsByPeriod(records, periods, predicate) {
    const totals = {};
    periods.forEach((p) => (totals[p] = null));
    records.forEach((r) => {
      if (!predicate(r)) return;
      totals[r.period] = (totals[r.period] || 0) + r.value;
    });
    return totals;
  }

  function matchesAny(label, terms) {
    return terms.some((term) => window.labelMatchesTerm(label, term));
  }

  window.withDerivedCashFlow = function withDerivedCashFlow(records) {
    if (!records || records.length === 0) return records;
    if (records.some((r) => r.category === "Cash Flow")) return records;

    const periods = periodsInOrder(records);
    // Every balance movement is a difference against the previous period, so
    // a single-period document has nothing to derive from.
    if (periods.length < 2) return records;

    const series = {};
    ROLES.forEach((role) => {
      series[role.key] = totalsByPeriod(records, periods, (r) => matchesAny(r.lineItem, role.terms));
    });

    const netResult = totalsByPeriod(records, periods, (r) => r.category === "Net Result");
    const revenue = totalsByPeriod(records, periods, (r) => r.category === "Revenue");
    // Capex sits under Assets and depreciation under Expenses; neither belongs
    // in the operating result we start from, so exclude them here.
    const expenses = totalsByPeriod(
      records,
      periods,
      (r) => r.category === "Expenses" && !matchesAny(r.lineItem, ["depreciation", "amortization", "amortisation"])
    );

    const hasResult = periods.some((p) => netResult[p] !== null || revenue[p] !== null);
    const hasMovement = ["receivable", "inventory", "payable", "debt", "capex"].some((key) =>
      periods.some((p) => series[key][p] !== null)
    );
    if (!hasResult || !hasMovement) return records;

    const derived = [];
    const add = (period, lineItem, value) => {
      if (value === null || value === undefined || Number.isNaN(value)) return;
      derived.push({ lineItem, period, value, category: "Cash Flow", derived: true });
    };

    for (let i = 1; i < periods.length; i++) {
      const period = periods[i];
      const prior = periods[i - 1];
      const delta = (key) => {
        const now = series[key][period];
        const before = series[key][prior];
        return now === null || before === null ? null : now - before;
      };
      const sum = (parts) => parts.filter((v) => v !== null && v !== undefined).reduce((a, b) => a + b, 0);

      const result =
        netResult[period] !== null
          ? netResult[period]
          : revenue[period] !== null
          ? revenue[period] - (expenses[period] || 0)
          : null;
      if (result === null) continue;

      // Depreciation is non-cash, so it goes back on top of the result.
      const depreciation = series.depreciation[period];
      // A rise in receivables or inventory ties cash up; a rise in payables
      // releases it — hence the sign flip on the first two.
      const receivable = delta("receivable") === null ? null : -delta("receivable");
      const inventory = delta("inventory") === null ? null : -delta("inventory");
      const payable = delta("payable");
      const capex = series.capex[period] === null ? null : -Math.abs(series.capex[period]);
      const debt = delta("debt");

      const operating = sum([result, depreciation, receivable, inventory, payable]);
      const investing = sum([capex]);
      const financing = sum([debt]);

      add(period, "Operating Result", result);
      add(period, "Depreciation & Amortization", depreciation);
      add(period, "Change in Accounts Receivable", receivable);
      add(period, "Change in Inventory", inventory);
      add(period, "Change in Accounts Payable", payable);
      add(period, "Net Cash from Operating Activities", operating);
      if (capex !== null) {
        add(period, "Capital Expenditures", capex);
        add(period, "Net Cash used in Investing Activities", investing);
      }
      if (debt !== null) {
        add(period, "Change in Short-Term Debt", debt);
        add(period, "Net Cash from Financing Activities", financing);
      }
      add(period, "Net Change in Cash", operating + investing + financing);
    }

    return derived.length > 0 ? records.concat(derived) : records;
  };
})();
