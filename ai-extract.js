// Optional BYOK extraction path. Only used when the user explicitly enables
// it in Settings. Sends raw extracted text directly from the browser to the
// selected provider's API using the user's own key — no intermediary server.
const AI_KEY_STORAGE_PREFIX = "fdv.aiKey.";

window.getStoredAiKey = function getStoredAiKey(provider) {
  try {
    return localStorage.getItem(AI_KEY_STORAGE_PREFIX + provider) || "";
  } catch (e) {
    return "";
  }
};

window.setStoredAiKey = function setStoredAiKey(provider, key) {
  try {
    if (key) {
      localStorage.setItem(AI_KEY_STORAGE_PREFIX + provider, key);
    } else {
      localStorage.removeItem(AI_KEY_STORAGE_PREFIX + provider);
    }
  } catch (e) {
    // ignore — storage unavailable
  }
};

const EXTRACTION_PROMPT = `You are extracting structured data from a financial document (balance sheet, P&L, or similar). Given the raw text below, return ONLY a JSON object of the shape:
{"periods": ["<period label>", ...], "rows": [{"label": "<line item>", "values": [<number or null>, ...]}, ...]}
Each row's "values" array must have exactly one entry per period, in the same order as "periods". Use null where a value is missing. Do not include totals unless they appear as their own labeled line in the source. Do not include any commentary, only the JSON object.

Document text:
`;

window.extractWithAI = async function extractWithAI(rawText, provider, apiKey) {
  if (provider === "anthropic") return extractWithAnthropic(rawText, apiKey);
  if (provider === "openai") return extractWithOpenAI(rawText, apiKey);
  throw new Error("Unknown AI provider: " + provider);
};

async function extractWithAnthropic(rawText, apiKey) {
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
      max_tokens: 4096,
      messages: [{ role: "user", content: EXTRACTION_PROMPT + rawText }],
    }),
  });

  if (!res.ok) {
    throw new Error("Anthropic API error " + res.status + ": " + (await safeText(res)));
  }
  const data = await res.json();
  const text = (data.content || []).map((b) => b.text || "").join("");
  return parseAiJson(text);
}

async function extractWithOpenAI(rawText, apiKey) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + apiKey,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: EXTRACTION_PROMPT + rawText }],
    }),
  });

  if (!res.ok) {
    throw new Error("OpenAI API error " + res.status + ": " + (await safeText(res)));
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || "";
  return parseAiJson(text);
}

async function safeText(res) {
  try {
    return await res.text();
  } catch (e) {
    return "";
  }
}

function parseAiJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("AI response did not contain JSON");
  const parsed = JSON.parse(match[0]);
  if (!Array.isArray(parsed.periods) || !Array.isArray(parsed.rows)) {
    throw new Error("AI response JSON missing periods/rows");
  }
  return parsed;
}
