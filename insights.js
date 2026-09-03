(function () {
  const emptyHint = document.getElementById("insights-empty-hint");
  const body = document.getElementById("insights-body");

  const reportBtn = document.getElementById("report-generate-btn");
  const enhanceRow = document.getElementById("report-enhance-row");
  const enhanceCheckbox = document.getElementById("report-enhance-ai");
  const dashboardEl = document.getElementById("dashboard");

  const chatModeHint = document.getElementById("chat-mode-hint");
  const chatLog = document.getElementById("chat-log");
  const chatForm = document.getElementById("chat-form");
  const chatInput = document.getElementById("chat-input");

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
    printBtn.textContent = "Print / Save as PDF";
    printBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openPrintWindow(report.title, scroll.innerHTML);
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

  function openPrintWindow(title, html) {
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(
      "<!DOCTYPE html><html><head><title>" +
        escapeHtml(title) +
        "</title><style>" +
        "body{font-family:Arial,Helvetica,sans-serif;max-width:720px;margin:2rem auto;color:#1a202c;line-height:1.5;}" +
        "h2{font-size:1.3rem;} h3{font-size:1rem;margin-top:1.5rem;} h4{margin:0 0 0.3rem;}" +
        "ul{padding-left:1.2rem;} li.flag{color:#c0392b;}" +
        "</style></head><body>" +
        html +
        "</body></html>"
    );
    win.document.close();
    win.focus();
    win.print();
  }

  chatForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const question = chatInput.value.trim();
    if (!question) return;
    const byCategory = window.getCurrentByCategory();
    if (!byCategory) return;

    const historyBefore = chatHistory.slice();
    appendChatMessage("user", question);
    chatInput.value = "";
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
  });

  function appendChatMessage(role, text) {
    chatHistory.push({ role, text });
    const el = document.createElement("div");
    el.className = "chat-msg chat-msg-" + role;
    el.textContent = text;
    chatLog.appendChild(el);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  function escapeHtml(s) {
    const div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
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
