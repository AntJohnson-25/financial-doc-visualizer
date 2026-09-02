// User-addable notes pinned to a chart data point, persisted per document
// in localStorage. Also builds the chartjs-plugin-annotation config for
// outlier flags + user notes so charts.js can just merge it into a chart's
// options.
const NOTES_STORAGE_KEY = "fdv.notes";

function loadAllNotes() {
  try {
    return JSON.parse(localStorage.getItem(NOTES_STORAGE_KEY) || "{}");
  } catch (e) {
    return {};
  }
}

function saveAllNotes(all) {
  try {
    localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(all));
  } catch (e) {
    // localStorage unavailable (private mode, quota, etc.) — notes just
    // won't persist across reloads.
  }
}

window.getNote = function getNote(docKey, pointKey) {
  const all = loadAllNotes();
  return (all[docKey] && all[docKey][pointKey]) || "";
};

window.setNote = function setNote(docKey, pointKey, text) {
  const all = loadAllNotes();
  if (!all[docKey]) all[docKey] = {};
  if (text) {
    all[docKey][pointKey] = text;
  } else {
    delete all[docKey][pointKey];
  }
  saveAllNotes(all);
};

// labels: array of point keys in chart order. outlierKeys: Set of keys
// flagged as outliers. docKey: identifies the current document so notes
// don't bleed across unrelated files.
window.buildAnnotationConfig = function buildAnnotationConfig(labels, outlierKeys, docKey) {
  const config = {};

  labels.forEach((key, i) => {
    const note = window.getNote(docKey, key);
    const isOutlier = outlierKeys.has(key);
    if (!isOutlier && !note) return;

    config["point-" + i] = {
      type: "label",
      xValue: i,
      yValue: 0,
      yAdjust: -18,
      content: isOutlier && note ? ["⚠ outlier", note] : isOutlier ? ["⚠ outlier"] : [note],
      color: isOutlier ? "#c0392b" : "#2b6cb0",
      font: { size: 10, weight: "600" },
      backgroundColor: isOutlier ? "rgba(192,57,43,0.1)" : "rgba(43,108,176,0.1)",
      padding: 4,
      borderRadius: 4,
    };
  });

  return config;
};
