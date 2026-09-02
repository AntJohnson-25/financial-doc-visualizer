// Maps parser output ({ periods, rows: { label, values } }) into a flat,
// categorized schema the rest of the app works with:
// { lineItem, period, value, category }[]
window.normalizeRows = function normalizeRows(parsed, fileName) {
  const { periods, rows } = parsed;
  const records = [];

  // A cash flow statement's line items look like balance sheet / P&L items
  // when judged one at a time ("Change in Accounts Payable" reads as a
  // liability, "Purchase of Equipment" as an asset, anything with "cash" in
  // it as an asset), which scattered every row across the other categories
  // and left the Cash Flow filter empty. Decide the statement type from the
  // whole document first, and keep the whole statement together.
  const isCashFlow = looksLikeCashFlowStatement(rows, fileName);

  // Statements are usually printed current-year-first. Everything downstream
  // treats the last period it sees as the latest one (KPI deltas, the
  // "(FY2026)" heading on each card, trend lines), so put the columns in
  // chronological order here rather than teaching each consumer to sort.
  const order = chronologicalOrder(periods);

  rows.forEach((row) => {
    const category = isCashFlow ? "Cash Flow" : categorize(row.label);
    order.forEach((i) => {
      const value = row.values[i];
      if (value === null || value === undefined) return;
      records.push({
        lineItem: row.label,
        period: periods[i] || "Period " + (i + 1),
        value,
        category,
      });
    });
  });

  return records;
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

// Sortable key for a column header: year, then quarter or month within it.
// Returns null for anything undated ("Amount", "Period 1"), which leaves the
// document's own column order untouched.
function periodSortKey(label) {
  const text = String(label || "");
  const year = text.match(/(?:^|\D)((?:19|20)\d{2})(?:\D|$)/);
  if (!year) return null;
  let within = 0;
  const quarter = text.match(/\bQ([1-4])\b/i);
  if (quarter) {
    within = Number(quarter[1]) * 3;
  } else {
    const month = MONTHS.findIndex((m) => new RegExp("\\b" + m, "i").test(text));
    if (month >= 0) within = month + 1;
  }
  return Number(year[1]) * 100 + within;
}

function chronologicalOrder(periods) {
  const indexes = (periods || []).map((_, i) => i);
  const keys = (periods || []).map(periodSortKey);
  if (keys.length < 2 || keys.some((k) => k === null)) return indexes;
  if (new Set(keys).size !== keys.length) return indexes;
  return indexes.slice().sort((a, b) => keys[a] - keys[b]);
}

// ---------------------------------------------------------------------------
// Categorisation
//
// Labels are matched against a per-category vocabulary rather than a list of
// literal substrings, because real exports never agree on wording: British vs
// American spelling ("amortisation"), plurals, snake_case headers, filler
// words ("net cash provided by operating activities"), and outright typos.
// Terms are scored, not short-circuited, so a specific multi-word phrase can
// outrank a generic single word — that's what stops "cash" pulling every
// cash-flow line into Assets.
// ---------------------------------------------------------------------------

const CATEGORY_TERMS = {
  "Cash Flow": [
    "operating activities",
    "investing activities",
    "financing activities",
    "cash flow",
    "net cash",
    "cash generated",
    "cash used",
    "cash provided",
    "increase in cash",
    "decrease in cash",
    "change in cash",
    "cash beginning period",
    "cash end period",
    "beginning cash balance",
    "ending cash balance",
    "free cash flow",
    "proceeds from",
    "repayment of",
    "working capital changes",
  ],
  Revenue: [
    "revenue",
    "sales",
    "net sales",
    "turnover",
    "billings",
    "bookings",
    "income from",
    "operating income",
    "other income",
    "interest income",
    "gross receipts",
    "fees earned",
    "service income",
    "commission",
    "royalties",
  ],
  Expenses: [
    "expense",
    "expenditure",
    "cost of goods sold",
    "cost of sales",
    "cost of revenue",
    "cogs",
    "operating cost",
    "overhead",
    "depreciation",
    "amortization",
    "amortisation",
    "impairment",
    "payroll",
    "salaries",
    "wages",
    "benefits",
    "rent",
    "utilities",
    "insurance",
    "marketing",
    "advertising",
    "research development",
    "professional fees",
    "selling general administrative",
    "interest expense",
    "income tax",
    "tax expense",
    "bad debt expense",
  ],
  Assets: [
    "asset",
    "cash",
    "cash equivalents",
    "receivable",
    "inventory",
    "stock on hand",
    "equipment",
    "property",
    "plant",
    "prepaid",
    // Two words so it outranks the single word "expense" under Expenses.
    "prepaid expenses",
    "goodwill",
    "intangible",
    "investment",
    "securities",
    "deposits",
    "capital expenditure",
    "capex",
    "fixed assets",
    "current assets",
    "vehicles",
    "furniture",
    "land",
    "buildings",
    "accumulated depreciation",
  ],
  Liabilities: [
    "liability",
    "payable",
    "debt",
    "borrowing",
    "loan",
    "note payable",
    "accrued",
    "deferred revenue",
    "unearned revenue",
    "lease obligation",
    "provision",
    "overdraft",
    "credit facility",
    "line of credit",
    "taxes payable",
  ],
  Equity: [
    "equity",
    "retained earnings",
    "capital stock",
    "common stock",
    "preferred stock",
    "share capital",
    "reserves",
    "paid in capital",
    "treasury stock",
    "members capital",
    "owners capital",
    "accumulated deficit",
    "distributions",
    "dividends",
  ],
  "Net Result": [
    "net income",
    "net profit",
    "net loss",
    "net earnings",
    "net result",
    "profit for the",
    "loss for the",
    "gross profit",
    "operating profit",
    "ebitda",
    "ebit",
    "earnings before",
    "bottom line",
  ],
};

// Dropped before matching so "cash at the end of the period" and
// "cash end period" score the same. Deliberately excludes words that carry
// meaning in this domain — "net", "total", "change", "gross".
const FILLER = new Set(["a", "an", "the", "of", "in", "on", "at", "to", "for", "by", "and", "or", "from", "with"]);

// Crude plural stemmer. Enough to fold "inventories"/"inventory",
// "expenses"/"expense", "activities"/"activity" onto one form without
// pulling in a real stemming library.
function stem(word) {
  if (word.length > 4 && /ies$/.test(word)) return word.slice(0, -3) + "y";
  if (word.length > 4 && /(ses|xes|ches|shes)$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && /s$/.test(word) && !/ss$/.test(word)) return word.slice(0, -1);
  return word;
}

// Applied to both labels and vocabulary terms, so the two are always
// compared in the same normalised form.
function tokenize(label) {
  return String(label)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word && !FILLER.has(word))
    .map(stem);
}

const PRECOMPILED_TERMS = Object.keys(CATEGORY_TERMS).map((category) => ({
  category,
  terms: CATEGORY_TERMS[category].map(tokenize),
}));

function levenshtein(a, b) {
  const prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let diagonal = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const next = Math.min(prev[j] + 1, prev[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = prev[j];
      prev[j] = next;
    }
  }
  return prev[b.length];
}

// Tolerates plurals and inflections by prefix ("expenditure"/"expenditures"),
// and spelling variants or typos by edit distance. Short words must match
// exactly — at three characters a single edit is a different word.
function wordsMatch(word, term) {
  if (word === term) return true;
  const [shorter, longer] = word.length <= term.length ? [word, term] : [term, word];
  if (shorter.length >= 4 && longer.startsWith(shorter) && longer.length - shorter.length <= 3) return true;
  if (shorter.length < 5) return false;
  return levenshtein(word, term) <= (longer.length >= 8 ? 2 : 1);
}

// A term matches when its words appear in order within the label, allowing a
// couple of unmatched words in between ("net cash provided by operating
// activities" still matches the term "net cash").
function termMatches(words, termWords) {
  let cursor = 0;
  let start = -1;
  for (const termWord of termWords) {
    let found = -1;
    for (let i = cursor; i < words.length; i++) {
      if (wordsMatch(words[i], termWord)) {
        found = i;
        break;
      }
    }
    if (found === -1) return false;
    if (start === -1) start = found;
    cursor = found + 1;
  }
  return cursor - start <= termWords.length + 2;
}

// Longer phrases score higher (squared), so a three-word cash-flow phrase
// always beats the single word "cash" under Assets.
function scoreCategory(words, terms) {
  let best = 0;
  for (const termWords of terms) {
    if (termMatches(words, termWords)) best = Math.max(best, termWords.length * termWords.length);
  }
  return best;
}

// Exposed so other modules can ask "is this line item a receivable?" with the
// same tolerance for wording that categorisation uses, instead of writing
// their own substring checks.
window.labelMatchesTerm = function labelMatchesTerm(label, term) {
  return termMatches(tokenize(label), tokenize(term));
};

function categorize(label) {
  const words = tokenize(label);
  if (words.length === 0) return "Other";

  let bestCategory = "Other";
  let bestScore = 0;
  for (const { category, terms } of PRECOMPILED_TERMS) {
    const score = scoreCategory(words, terms);
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }
  return bestCategory;
}

// A cash flow statement is recognised by its structure — the operating /
// investing / financing sections and their subtotals — rather than by any one
// line. Two independent hits is enough; the filename is only a shortcut.
function looksLikeCashFlowStatement(rows, fileName) {
  if (fileName && termMatches(tokenize(fileName.replace(/\.[^.]+$/, "")), ["cash", "flow"])) return true;

  const labelWords = rows.map((r) => tokenize(r.label));
  const distinctHits = CATEGORY_TERMS["Cash Flow"].filter((term) => {
    const termWords = tokenize(term);
    return labelWords.some((words) => termMatches(words, termWords));
  });
  return distinctHits.length >= 2;
}
