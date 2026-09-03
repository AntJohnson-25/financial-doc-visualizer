// BYOK chat + report-narrative path. Same trust model as ai-extract.js:
// only used when the user has enabled AI in Settings with their own key,
// calls the provider directly from the browser. Sends the *computed*
// metrics text (report.js's `text` field) as context, never the raw
// uploaded document — keeps the payload small and means a wrong/partial
// parse can't leak more of the source document than the dashboard already
// shows.
(function () {
  window.enhanceReportWithAI = async function enhanceReportWithAI(report, provider, apiKey) {
    const prompt =
      "You are a senior business finance data analyst writing the narrative section of a report for " +
      "company leadership. Based only on the metrics below (already computed — do not invent numbers " +
      "not shown here), write in plain prose: confident, specific, grounded in the numbers, the way an " +
      "experienced analyst would brief a stakeholder.\n\n" +
      "Respond in exactly this structure:\n" +
      "1. One or two paragraphs of narrative analysis, separated by a blank line.\n" +
      "2. A blank line, then the exact heading ACTION STEPS on its own line.\n" +
      "3. Three to five concrete, specific action steps to implement moving forward based on this data, " +
      "one per line, each starting with a dash (-).\n\n" +
      "Formatting rules: plain text only. Do not use markdown — no asterisks, no bold, no headers other " +
      "than the literal ACTION STEPS line, no bullet symbols besides the leading dash on action step " +
      "lines.\n\nMetrics:\n" + report.text;
    const raw = await callAiText([{ role: "user", content: prompt }], provider, apiKey);
    return window.parseAiNarrative(raw);
  };

  // Defensive parsing on top of the prompt's requested structure — strips
  // any markdown asterisks that slip through regardless of instructions,
  // and splits the ACTION STEPS section out so insights.js can render it
  // as a real list instead of one run-on paragraph.
  window.parseAiNarrative = function parseAiNarrative(raw) {
    const cleaned = (raw || "").replace(/\*+/g, "").replace(/\r\n/g, "\n").trim();
    const marker = /action steps:?/i;
    const match = cleaned.match(marker);

    let narrativePart = cleaned;
    let stepsPart = "";
    if (match) {
      narrativePart = cleaned.slice(0, match.index).trim();
      stepsPart = cleaned.slice(match.index + match[0].length).trim();
    }

    const paragraphs = narrativePart
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean);
    const actionSteps = stepsPart
      .split("\n")
      .map((line) => line.replace(/^[-•\d.\s]+/, "").trim())
      .filter(Boolean);

    return { paragraphs, actionSteps };
  };

  window.chatWithAI = async function chatWithAI(history, byCategory, question, provider, apiKey) {
    const report = window.buildTemplatedReport(byCategory);
    const context =
      "You are answering questions about a user's financial data. Use ONLY the metrics below — do not " +
      "invent figures. If the answer isn't in the data, say so plainly. Respond in plain text only — " +
      "no markdown, no asterisks, no bold, no headers, no bullet symbols.\n\nMetrics:\n" + report.text;

    const messages = [
      { role: "user", content: context },
      { role: "assistant", content: "Understood — I'll answer using only those figures, in plain text." },
    ];
    history.forEach((m) => messages.push({ role: m.role === "assistant" ? "assistant" : "user", content: m.text }));
    messages.push({ role: "user", content: question });

    const raw = await callAiText(messages, provider, apiKey);
    return stripMarkdown(raw);
  };

  // Defensive: strips markdown emphasis/heading/bullet syntax that slips
  // through despite the prompt's plain-text instruction, so chat answers
  // don't read as visibly AI-generated.
  function stripMarkdown(text) {
    return (text || "")
      .replace(/\*\*?/g, "")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/^[-•]\s+/gm, "")
      .trim();
  }

  async function callAiText(messages, provider, apiKey) {
    if (provider === "anthropic") return chatAnthropic(messages, apiKey);
    if (provider === "openai") return chatOpenAI(messages, apiKey);
    throw new Error("Unknown AI provider: " + provider);
  }

  async function chatAnthropic(messages, apiKey) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 1024,
        messages,
      }),
    });
    if (!res.ok) throw new Error("Anthropic API error " + res.status + ": " + (await safeText(res)));
    const data = await res.json();
    return (data.content || []).map((b) => b.text || "").join("").trim();
  }

  async function chatOpenAI(messages, apiKey) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + apiKey,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages,
      }),
    });
    if (!res.ok) throw new Error("OpenAI API error " + res.status + ": " + (await safeText(res)));
    const data = await res.json();
    return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || "").trim();
  }

  async function safeText(res) {
    try {
      return await res.text();
    } catch (e) {
      return "";
    }
  }
})();
