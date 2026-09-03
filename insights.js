(function () {
  const emptyHint = document.getElementById("insights-empty-hint");
  const body = document.getElementById("insights-body");

  const reportBtn = document.getElementById("report-generate-btn");
  const enhanceRow = document.getElementById("report-enhance-row");
  const enhanceCheckbox = document.getElementById("report-enhance-ai");
  const dashboardEl = document.getElementById("dashboard");

  const chatModeHint = document.getElementById("chat-mode-hint");
  const chatSuggestions = document.getElementById("chat-suggestions");
  const chatLog = document.getElementById("chat-log");
  const chatForm = document.getElementById("chat-form");
  const chatInput = document.getElementById("chat-input");

  // Same suggested-question list works for the no-key fallback matcher and
  // full AI chat — clicking one just submits it like the user typed it.
  (window.SUGGESTED_QUESTIONS || []).forEach((question) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chat-suggestion-chip";
    chip.textContent = question;
    chip.addEventListener("click", () => submitQuestion(question));
    chatSuggestions.appendChild(chip);
  });

  // The report renders as a widget on the canvas (same drag/resize/print
  // chrome as the chart widgets) rather than an inline sidebar panel, so
  // it gets torn down whenever renderDashboard() wipes the canvas — a doc
  // add/remove or filter change. Track our own reference so a re-click of
  // Generate report replaces the old one instead of stacking duplicates.
  let reportWidget = null;
  const chatHistory = [];

  // Called by app.js after every load/remove and by settings.js's provider
  // toggle (via the change listeners below) — anything that could change
  // whether there's data to report on or whether AI is available.
  window.refreshInsightsAvailability = function refreshInsightsAvailability() {
    const hasData = !!(window.getCurrentByCategory && window.getCurrentByCategory());
    emptyHint.hidden = hasData;
    body.hidden = !hasData;
    if (!hasData) reportWidget = null;
    if (hasData) updateChatModeHint();
  };

  function updateChatModeHint() {
    const ai = window.getAiSettings ? window.getAiSettings() : { enabled: false };
    enhanceRow.hidden = !ai.enabled;
    if (ai.enabled && ai.apiKey) {
      chatModeHint.textContent = "Answering with " + providerLabel(ai.provider) + " using your API key.";
    } else if (ai.enabled && !ai.apiKey) {
      chatModeHint.textContent = "AI is enabled but no API key is set — add one in Settings, or just ask and I'll answer directly from your data.";
    } else {
      chatModeHint.textContent = "Answering directly from your loaded data. Enable AI in Settings for open-ended questions.";
    }
  }

  function providerLabel(p) {
    return p === "anthropic" ? "Anthropic" : p === "openai" ? "OpenAI" : p;
  }

  reportBtn.addEventListener("click", async () => {
    const byCategory = window.getCurrentByCategory();
    if (!byCategory) return;

    reportBtn.disabled = true;
    reportBtn.textContent = "Generating…";

    const templated = window.buildTemplatedReport(byCategory);
    let finalReport = templated;

    const ai = window.getAiSettings();
    if (ai.enabled && ai.apiKey && enhanceCheckbox.checked) {
      reportBtn.textContent = "Enhancing with AI…";
      try {
        const narrative = await window.enhanceReportWithAI(templated, ai.provider, ai.apiKey);
        finalReport = Object.assign({}, templated, { narrative });
      } catch (err) {
        console.error(err);
        finalReport = Object.assign({}, templated, { narrativeError: err.message });
      }
    }

    mountReportWidget(finalReport);
    reportBtn.disabled = false;
    reportBtn.textContent = "Generate report";
  });

  function mountReportWidget(report) {
    if (reportWidget && window.removeWidget) window.removeWidget(reportWidget);

    const scroll = document.createElement("div");
    scroll.className = "report-widget-scroll";

    if (report.narrative) {
      // AI narrative replaces the templated report entirely — it's meant
      // to read as the finished report, not a preface to the bullet-point
      // version underneath it.
      const div = document.createElement("div");
      div.className = "report-ai-narrative";

      report.narrative.paragraphs.forEach((text) => {
        const p = document.createElement("p");
        p.textContent = text;
        div.appendChild(p);
      });

      if (report.narrative.actionSteps.length) {
        const stepsHeading = document.createElement("h4");
        stepsHeading.textContent = "Action steps";
        div.appendChild(stepsHeading);
        const ul = document.createElement("ul");
        report.narrative.actionSteps.forEach((step) => {
          const li = document.createElement("li");
          li.textContent = step;
          ul.appendChild(li);
        });
        div.appendChild(ul);
      }

      scroll.appendChild(div);
    } else if (report.narrativeError) {
      const p = document.createElement("p");
      p.className = "status error";
      p.textContent = "AI enhancement failed: " + report.narrativeError + " — showing the standard report instead.";
      scroll.appendChild(p);
      scroll.insertAdjacentHTML("beforeend", report.html);
    } else {
      scroll.innerHTML = report.html;
    }

    const printBtn = document.createElement("button");
    printBtn.type = "button";
    printBtn.className = "btn-secondary report-widget-print";
    printBtn.textContent = "Download report (.md)";
    printBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      downloadReportMarkdown(report);
    });

    const bodyWrap = document.createElement("div");
    bodyWrap.className = "report-widget-body";
    bodyWrap.appendChild(scroll);
    bodyWrap.appendChild(printBtn);

    reportWidget = window.createWidget(dashboardEl, {
      id: "insights-report",
      docKey: window.getCurrentDocKey ? window.getCurrentDocKey() : "",
      title: "Financial Report",
      kpiValue: "Report",
      kpiLabel: "Generated " + new Date().toLocaleTimeString(),
      bodyEl: bodyWrap,
      expandedSize: { w: 520, h: 460 },
    });

    reportWidget.toggleBtn.click();
    reportWidget.el.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // One-click plain-text export: builds markdown from the same data the
  // widget renders (report.text for the templated report, report.narrative
  // for the AI version) and saves it via a throwaway <a download> link —
  // no dialog, no external library, no print step.
  function downloadReportMarkdown(report) {
    const md = buildReportMarkdown(report);
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = safeFilename(report.title) + ".md";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function buildReportMarkdown(report) {
    const lines = ["# " + report.title, ""];

    if (report.narrative) {
      report.narrative.paragraphs.forEach((p) => lines.push(p, ""));
      if (report.narrative.actionSteps.length) {
        lines.push("## Action steps", "");
        report.narrative.actionSteps.forEach((s) => lines.push("- " + s));
        lines.push("");
      }
    } else {
      if (report.narrativeError) {
        lines.push("_AI enhancement failed: " + report.narrativeError + " — showing the standard report instead._", "");
      }
      lines.push(templatedTextToMarkdown(report.text));
    }

    return lines.join("\n").trim() + "\n";
  }

  // report.text uses ALL-CAPS lines as section headings (see report.js) —
  // turn those into "## Title Case" markdown headings, pass everything else through.
  function templatedTextToMarkdown(text) {
    return (text || "")
      .split("\n")
      .map((line) => (/^[A-Z][A-Z \-]+$/.test(line) ? "## " + toTitleCase(line) : line))
      .join("\n");
  }

  function toTitleCase(s) {
    return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function safeFilename(title) {
    return (title || "report").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "report";
  }

  chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const question = chatInput.value.trim();
    if (!question) return;
    chatInput.value = "";
    submitQuestion(question);
  });

  async function submitQuestion(question) {
    const byCategory = window.getCurrentByCategory();
    if (!byCategory) return;

    const historyBefore = chatHistory.slice();
    appendChatMessage("user", question);
    chatInput.disabled = true;

    const ai = window.getAiSettings();
    try {
      let answer;
      if (ai.enabled && ai.apiKey) {
        answer = await window.chatWithAI(historyBefore, byCategory, question, ai.provider, ai.apiKey);
      } else {
        answer = window.answerFallback(question, byCategory);
      }
      appendChatMessage("assistant", answer);
    } catch (err) {
      console.error(err);
      const fallbackAnswer = window.answerFallback(question, byCategory);
      appendChatMessage(
        "assistant",
        "Something went wrong asking " + providerLabel(ai.provider) + ": " + err.message + ". Answering directly from your data instead:\n\n" + fallbackAnswer
      );
    } finally {
      chatInput.disabled = false;
      chatInput.focus();
    }
  }

  function appendChatMessage(role, text) {
    chatHistory.push({ role, text });
    const el = document.createElement("div");
    el.className = "chat-msg chat-msg-" + role;
    el.textContent = text;
    chatLog.appendChild(el);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  document.getElementById("ai-enabled").addEventListener("change", () => {
    if (window.getCurrentByCategory && window.getCurrentByCategory()) updateChatModeHint();
  });
  document.getElementById("ai-provider").addEventListener("change", () => {
    if (window.getCurrentByCategory && window.getCurrentByCategory()) updateChatModeHint();
  });
  document.getElementById("ai-key").addEventListener("change", () => {
    if (window.getCurrentByCategory && window.getCurrentByCategory()) updateChatModeHint();
  });

  window.refreshInsightsAvailability();
})();
