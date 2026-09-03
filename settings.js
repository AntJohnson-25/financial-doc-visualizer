(function () {
  const aiEnabled = document.getElementById("ai-enabled");
  const aiConfig = document.getElementById("ai-config");
  const providerSelect = document.getElementById("ai-provider");
  const keyInput = document.getElementById("ai-key");
  const keyLabel = document.getElementById("ai-key-label");
  const forgetBtn = document.getElementById("ai-key-forget");

  const PROVIDER_LABELS = {
    anthropic: "Anthropic API key",
    openai: "OpenAI API key",
  };

  const ENABLED_STORAGE_KEY = "fdv.aiEnabled";
  const PROVIDER_STORAGE_KEY = "fdv.aiProvider";

  function loadKeyForProvider() {
    keyInput.value = window.getStoredAiKey(providerSelect.value);
    keyLabel.textContent = PROVIDER_LABELS[providerSelect.value];
    forgetBtn.hidden = !keyInput.value;
  }

  aiEnabled.addEventListener("change", () => {
    aiConfig.hidden = !aiEnabled.checked;
    try {
      localStorage.setItem(ENABLED_STORAGE_KEY, aiEnabled.checked ? "1" : "");
    } catch (e) {}
  });

  providerSelect.addEventListener("change", () => {
    try {
      localStorage.setItem(PROVIDER_STORAGE_KEY, providerSelect.value);
    } catch (e) {}
    loadKeyForProvider();
  });

  keyInput.addEventListener("change", () => {
    window.setStoredAiKey(providerSelect.value, keyInput.value.trim());
    forgetBtn.hidden = !keyInput.value;
  });

  // Clears this browser's saved key for the selected provider — e.g. after
  // testing on a machine you don't want the key left on. Dispatches the
  // same "change" event the input itself fires so insights.js's chat-mode
  // hint (and anything else listening for it) updates immediately.
  forgetBtn.addEventListener("click", () => {
    keyInput.value = "";
    window.setStoredAiKey(providerSelect.value, "");
    forgetBtn.hidden = true;
    keyInput.dispatchEvent(new Event("change", { bubbles: true }));
  });

  // Restore prior state on load.
  try {
    const wasEnabled = localStorage.getItem(ENABLED_STORAGE_KEY) === "1";
    const savedProvider = localStorage.getItem(PROVIDER_STORAGE_KEY);
    if (savedProvider) providerSelect.value = savedProvider;
    aiEnabled.checked = wasEnabled;
    aiConfig.hidden = !wasEnabled;
  } catch (e) {}
  loadKeyForProvider();

  window.getAiSettings = function getAiSettings() {
    return {
      enabled: aiEnabled.checked,
      provider: providerSelect.value,
      apiKey: window.getStoredAiKey(providerSelect.value),
    };
  };
})();
