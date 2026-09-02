// Flags outliers within a set of records using a median/MAD-based modified
// z-score (0.6745 * (x - median) / MAD). Unlike a plain mean/stddev z-score,
// this doesn't let one extreme value inflate the spread and mask itself —
// important here since charts often have only 4-6 line items, where a
// single huge outlier can otherwise hide from a standard z-score.
// Works on whatever numeric grouping you hand it (line items across
// periods, or category totals across periods) — pass an array of
// { key, value } and get back a Set of keys whose |modified z| exceeds the
// threshold.
window.findOutliers = function findOutliers(items, threshold) {
  threshold = threshold || 3.5;
  if (items.length < 3) return new Set();

  const values = items.map((i) => i.value).sort((a, b) => a - b);
  const median = percentileSorted(values, 0.5);
  const absDeviations = values.map((v) => Math.abs(v - median)).sort((a, b) => a - b);
  const mad = percentileSorted(absDeviations, 0.5);

  const outliers = new Set();

  if (mad === 0) {
    // Degenerate spread (e.g. all-but-one identical values) — fall back to
    // flagging anything that differs from the median at all, so a genuine
    // spike still surfaces instead of silently passing through.
    items.forEach((item) => {
      if (item.value !== median) outliers.add(item.key);
    });
    return outliers;
  }

  items.forEach((item) => {
    const modifiedZ = (0.6745 * (item.value - median)) / mad;
    if (Math.abs(modifiedZ) >= threshold) outliers.add(item.key);
  });

  return outliers;
};

function percentileSorted(sortedValues, p) {
  const mid = (sortedValues.length - 1) * p;
  const lo = Math.floor(mid);
  const hi = Math.ceil(mid);
  if (lo === hi) return sortedValues[lo];
  return sortedValues[lo] + (sortedValues[hi] - sortedValues[lo]) * (mid - lo);
}
