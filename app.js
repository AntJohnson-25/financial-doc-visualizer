const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const docChipsEl = document.getElementById("doc-chips");
const contentEl = document.getElementById("content");
const composerWrapEl = document.getElementById("composer-wrap");
const composerBackdropEl = document.getElementById("composer-backdrop");
const reopenUploadBtn = document.getElementById("reopen-upload-btn");
const addMoreDocsBtn = document.getElementById("add-more-docs-btn");

// The backdrop only dims for chat mode — asking a question is a focused
// task competing with a busy widget grid behind it; reopening the upload
// bar isn't, so it stays out of the way there.
function syncComposerBackdrop() {
  const visible = composerWrapEl.classList.contains("force-visible") && composerWrapEl.classList.contains("mode-chat");
  composerBackdropEl.classList.toggle("visible", visible);
}

function closeComposer() {
  composerWrapEl.classList.remove("force-visible");
  syncComposerBackdrop();
}

// Once documents are loaded, the "+" FAB stops being a second way to open
// the upload bar — that moved to the small + next to "Loaded documents" —
// and instead opens the "ask about your data" bar. Same composer-wrap
// element either way, just switched between its drop-zone and chat-bar
// contents via the mode-chat class (see style.css).
function toggleComposer(mode) {
  const alreadyOpenInMode =
    composerWrapEl.classList.contains("force-visible") && composerWrapEl.classList.contains("mode-chat") === (mode === "chat");
  if (alreadyOpenInMode) {
    closeComposer();
    return;
  }
  composerWrapEl.classList.toggle("mode-chat", mode === "chat");
  composerWrapEl.classList.add("force-visible");
  syncComposerBackdrop();
  if (mode === "chat") {
    const input = document.getElementById("chat-input");
    if (input) input.focus();
  }
}

reopenUploadBtn.addEventListener("click", () => toggleComposer("chat"));
addMoreDocsBtn.addEventListener("click", () => toggleComposer("upload"));
composerBackdropEl.addEventListener("click", closeComposer);

document.addEventListener("click", (e) => {
  if (
    composerWrapEl.classList.contains("force-visible") &&
    !composerWrapEl.contains(e.target) &&
    e.target !== reopenUploadBtn &&
    e.target !== addMoreDocsBtn
  ) {
    closeComposer();
  }
});

// Each entry: { key, name, records }. Keyed by name+size so re-dropping the
// same file refreshes it in place instead of duplicating it.
let loadedDocs = [];

document.addEventListener("fdv:filterchange", () => {
  if (loadedDocs.length > 0) rerenderDashboard();
});

window.handleFiles = async function handleFiles(files) {
  for (const file of files) {
    await handleSingleFile(file);
  }
  rerenderDashboard();
};

async function handleSingleFile(file) {
  setStatus("Reading " + file.name + "…", false);

  try {
    const ext = file.name.split(".").pop().toLowerCase();
    const ai = window.getAiSettings();

    let parsed;
    if (ai.enabled) {
      if (!ai.apiKey) {
        setStatus("AI extraction is enabled but no API key is set for " + ai.provider + ". Add one in Settings.", true);
        return;
      }
      const rawText = await extractRawText(file, ext);
      setStatus("Sending " + file.name + " to " + ai.provider + " for extraction…", false);
      parsed = await window.extractWithAI(rawText, ai.provider, ai.apiKey);
    } else if (ext === "csv" || ext === "xlsx" || ext === "xls") {
      parsed = await window.parseCsvExcel(file);
    } else if (ext === "pdf") {
      parsed = await window.parsePdf(file);
    } else {
      setStatus("Unsupported file type: ." + ext, true);
      return;
    }

    if (!parsed.rows || parsed.rows.length === 0) {
      setStatus("Couldn't find any line items in " + file.name + ". Try AI extraction in Settings for messier documents.", true);
      return;
    }

    const records = window.withDerivedCashFlow(window.normalizeRows(parsed, file.name));
    const key = file.name + ":" + file.size;
    loadedDocs = loadedDocs.filter((d) => d.key !== key);
    loadedDocs.push({ key, name: file.name, records });

    setStatus("Loaded " + parsed.rows.length + " line items from " + file.name + ".", false);
  } catch (err) {
    console.error(err);
    setStatus("Failed to process " + file.name + ": " + err.message, true);
  }
}

function rerenderDashboard() {
  renderDocChips();

  if (loadedDocs.length === 0) {
    resultsEl.hidden = true;
    contentEl.classList.remove("has-results");
    addMoreDocsBtn.hidden = true;
    composerWrapEl.classList.remove("force-visible", "mode-chat");
    syncComposerBackdrop();
    if (window.clearCurrentByCategory) window.clearCurrentByCategory();
    if (window.refreshInsightsAvailability) window.refreshInsightsAvailability();
    return;
  }

  const combinedRecords = [];
  loadedDocs.forEach((doc) => {
    doc.records.forEach((r) => combinedRecords.push(Object.assign({}, r, { sourceDoc: doc.name })));
  });

  const docKey = loadedDocs
    .map((d) => d.key)
    .sort()
    .join("|");

  window.renderDashboard(combinedRecords, docKey);
  resultsEl.hidden = false;
  contentEl.classList.add("has-results");
  addMoreDocsBtn.hidden = false;
  if (window.refreshInsightsAvailability) window.refreshInsightsAvailability();
}

function renderDocChips() {
  if (loadedDocs.length === 0) {
    docChipsEl.hidden = true;
    docChipsEl.innerHTML = "";
    return;
  }
  docChipsEl.hidden = false;
  docChipsEl.innerHTML = loadedDocs
    .map(
      (doc) =>
        '<span class="doc-chip">' +
        escapeHtml(doc.name) +
        ' <button type="button" data-key="' +
        escapeHtml(doc.key) +
        '" aria-label="Remove ' +
        escapeHtml(doc.name) +
        '">×</button></span>'
    )
    .join("");

  docChipsEl.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      loadedDocs = loadedDocs.filter((d) => d.key !== btn.dataset.key);
      rerenderDashboard();
      if (loadedDocs.length === 0) setStatus("", false);
    });
  });
}

async function extractRawText(file, ext) {
  if (ext === "pdf") {
    if (window.pdfjsLib && !window.pdfjsLib.__workerConfigured) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      window.pdfjsLib.__workerConfigured = true;
    }
    const buffer = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: buffer }).promise;
    let text = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map((it) => it.str).join(" ") + "\n";
    }
    return text;
  }

  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_csv(sheet);
}

function setStatus(message, isError) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", !!isError);
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}
