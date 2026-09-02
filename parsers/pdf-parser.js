// Extracts text from a PDF entirely in-browser via pdf.js, then applies
// heuristics to pull out "label ... number(s)" lines typical of balance
// sheets and P&L statements. Layouts vary a lot, so this is best-effort.
window.parsePdf = async function parsePdf(file) {
  if (window.pdfjsLib && !window.pdfjsLib.__workerConfigured) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    window.pdfjsLib.__workerConfigured = true;
  }

  const buffer = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: buffer }).promise;

  const lines = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    lines.push(...groupIntoLines(content.items));
  }

  return linesToRows(lines);
};

function groupIntoLines(items) {
  const byY = new Map();
  items.forEach((item) => {
    const y = Math.round(item.transform[5]);
    if (!byY.has(y)) byY.set(y, []);
    byY.get(y).push(item);
  });

  return Array.from(byY.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([, rowItems]) =>
      rowItems
        .sort((a, b) => a.transform[4] - b.transform[4])
        .map((i) => i.str)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter((line) => line.length > 0);
}

const NUMBER_RE = /\(?-?\$?[\d][\d,]*(?:\.\d+)?\)?/g;

const MONTH = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\.?";
// The forms a column header takes: "FY2026", "Q3 FY26", "Dec 31, 2025",
// "December 2025", or a bare year.
const PERIOD_TOKEN_RE = new RegExp(
  "(?:FY\\s?\\d{2,4}|Q[1-4]\\s?(?:FY)?\\s?\\d{2,4}|" +
    MONTH +
    "\\s+\\d{1,2},?\\s+\\d{4}|" +
    MONTH +
    "\\s+\\d{4}|\\d{4})",
  "gi"
);

// A period-header row is one made up entirely of period labels — anything
// left over once they're removed (beyond punctuation) means it's prose, e.g.
// "For the Fiscal Year Ended June 30, 2026", which must NOT be mistaken for
// a header or, worse, parsed as a data row worth 30 and 2026.
function readPeriodHeader(line) {
  const matches = line.match(PERIOD_TOKEN_RE);
  if (!matches || matches.length === 0) return null;
  const residue = line.replace(PERIOD_TOKEN_RE, "").replace(/[\s,.:$()\-–—|]/g, "");
  if (residue !== "") return null;
  return matches.map((m) => m.replace(/\s+/g, " ").trim());
}

function linesToRows(lines) {
  let periods = null;
  const rows = [];

  // Everything above the column headers is title/date preamble, not data.
  let start = 0;
  for (let i = 0; i < lines.length; i++) {
    const header = readPeriodHeader(lines[i]);
    if (header) {
      periods = header;
      start = i + 1;
      break;
    }
  }

  for (const line of lines.slice(start)) {
    // With no header row to anchor on, drop the statement's date line by
    // hand so its numbers don't become a line item.
    if (!periods && /\b(for the|year ended|period ended|as of|as at)\b/i.test(line)) continue;

    const numberMatches = line.match(NUMBER_RE);
    if (!numberMatches || numberMatches.length === 0) continue;

    const label = line.replace(NUMBER_RE, "").replace(/\s{2,}/g, " ").trim();
    if (!label || label.length < 2) continue;

    const values = numberMatches.map(parsePdfNumber).filter((v) => v !== null);
    if (values.length === 0) continue;

    if (!periods) {
      periods = values.map((_, i) => "Period " + (i + 1));
    }
    // Pad/truncate to match the first data row's column count so the chart
    // has a consistent shape even if a later line has fewer numbers.
    const padded = periods.map((_, i) => (i < values.length ? values[i] : null));
    rows.push({ label, values: padded });
  }

  return { periods: periods || [], rows };
}

function parsePdfNumber(token) {
  const negative = /^\(.*\)$/.test(token);
  const cleaned = token.replace(/[()$,]/g, "");
  const n = parseFloat(cleaned);
  if (Number.isNaN(n)) return null;
  return negative ? -n : n;
}
