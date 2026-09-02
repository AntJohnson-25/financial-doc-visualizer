// Parses .csv/.xlsx/.xls files entirely in-browser via SheetJS.
// Returns { periods: string[], rows: { label: string, values: (number|null)[] }[] }
window.parseCsvExcel = async function parseCsvExcel(file) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  // cellDates (on read, not on sheet_to_json) keeps date cells as Date
  // objects — without it SheetJS hands back Excel serial numbers, and a date
  // column ends up labelled "45777.7916" instead of "2025-05-01".
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" });

  return gridToRows(grid);
};

function gridToRows(grid) {
  let cleaned = grid.filter((row) => row.some((cell) => String(cell).trim() !== ""));
  if (cleaned.length === 0) return { periods: [], rows: [] };

  // Statements put line items down the first column and periods across the
  // top. Exported time series do the opposite — a date column with one
  // metric per remaining column — so flip those round before parsing.
  if (looksTransposed(cleaned)) cleaned = transpose(cleaned);

  const headerRow = cleaned[0];
  const headerLooksNumeric = headerRow.slice(1).every((cell) => cell === "" || isNumericCell(cell));

  let periods;
  let dataRows;
  if (headerLooksNumeric) {
    periods = headerRow.slice(1).map((_, i) => "Period " + (i + 1));
    dataRows = cleaned;
  } else {
    periods = headerRow.slice(1).map((cell) => cellText(cell) || "Period");
    dataRows = cleaned.slice(1);
  }

  const rows = dataRows
    .map((row) => {
      const label = prettyLabel(cellText(row[0]));
      if (!label) return null;
      const values = periods.map((_, i) => {
        const cell = row[i + 1];
        return isNumericCell(cell) ? toNumber(cell) : null;
      });
      if (values.every((v) => v === null)) return null;
      return { label, values };
    })
    .filter(Boolean);

  return { periods, rows };
}

// A sheet is a time series laid on its side when the first column holds
// dates and the header names one metric per remaining column. Requiring more
// rows than columns keeps a normal statement with a date-ish first column
// (rare, but possible) from being flipped.
function looksTransposed(grid) {
  const header = grid[0];
  if (!header || header.length < 2 || grid.length < 3) return false;
  if (grid.length <= header.length) return false;

  const firstColumn = grid.slice(1).map((row) => row[0]);
  const dated = firstColumn.filter(isDateCell).length;
  if (dated < firstColumn.length * 0.8) return false;

  // Header cells must be names, not more dates or numbers.
  return header.slice(1).every((cell) => {
    const text = cellText(cell);
    return text !== "" && !isNumericCell(cell) && !isDateCell(cell);
  });
}

function transpose(grid) {
  const width = Math.max(...grid.map((row) => row.length));
  const out = [];
  for (let c = 0; c < width; c++) {
    out.push(grid.map((row) => (row[c] === undefined ? "" : row[c])));
  }
  return out;
}

function isDateCell(cell) {
  if (cell instanceof Date) return !Number.isNaN(cell.getTime());
  if (typeof cell !== "string") return false;
  const t = cell.trim();
  // ISO (2025-05-01), US/EU slash-or-dot dates, and "1 May 2025" / "May 2025".
  return (
    /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(t) ||
    /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/.test(t) ||
    /^\d{0,2}\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?,?\s+\d{4}$/i.test(t)
  );
}

// SheetJS builds date cells at midnight UTC, so the UTC fields hold the date
// the sheet actually says. Reading them locally shifts the day backwards for
// anyone west of Greenwich.
function cellText(cell) {
  if (cell instanceof Date && !Number.isNaN(cell.getTime())) {
    const pad = (n) => String(n).padStart(2, "0");
    return cell.getUTCFullYear() + "-" + pad(cell.getUTCMonth() + 1) + "-" + pad(cell.getUTCDate());
  }
  return String(cell === undefined || cell === null ? "" : cell).trim();
}

const LOWERCASE_WORDS = ["of", "and", "in", "on", "to", "for", "the", "from", "at"];

// Column headers arrive as identifiers ("cost_of_goods_sold", "revenue").
// Left alone they read badly next to line items pulled from a statement.
// Only touch labels that are unambiguously identifiers — anything already
// containing spaces or capitals is the document's own wording, and
// re-casing it would wreck headings like "CASH AT END OF PERIOD".
function prettyLabel(label) {
  if (!/^[a-z0-9]+(?:[_-][a-z0-9]+)*$/.test(label)) return label;
  return label
    .split(/[_-]+/)
    .filter(Boolean)
    .map((word, i) =>
      i > 0 && LOWERCASE_WORDS.includes(word.toLowerCase())
        ? word.toLowerCase()
        : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    )
    .join(" ");
}

function isNumericCell(cell) {
  if (typeof cell === "number") return true;
  if (typeof cell !== "string") return false;
  const t = cell.trim();
  if (t === "") return false;
  return /^\(?-?\$?[\d,]+(\.\d+)?\)?%?$/.test(t);
}

function toNumber(cell) {
  if (typeof cell === "number") return cell;
  let t = cell.trim();
  const negative = /^\(.*\)$/.test(t);
  t = t.replace(/[()$,%]/g, "");
  const n = parseFloat(t);
  if (Number.isNaN(n)) return null;
  return negative ? -n : n;
}
