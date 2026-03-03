const DEFAULT_SETTINGS = {
  enabled: true,
  targetLanguage: "zh-CN",
  mode: "overlay",
};

const enabledToggle = document.getElementById("enabledToggle");
const languageSelect = document.getElementById("languageSelect");
const modeInputs = Array.from(document.querySelectorAll('input[name="mode"]'));
const statusText = document.getElementById("statusText");
const statusDot = document.getElementById("statusDot");

async function getStoredSettings() {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...stored };
}

async function saveSettings(partialSettings) {
  const nextSettings = {
    ...(await getStoredSettings()),
    ...partialSettings,
  };

  await chrome.storage.sync.set(nextSettings);
  await chrome.runtime.sendMessage({
    type: "SETTINGS_UPDATED",
    payload: nextSettings,
  });

  statusText.textContent = "设置已保存并同步到当前标签页";
  statusDot.classList.add("ready");
}

function render(settings) {
  enabledToggle.checked = settings.enabled;
  languageSelect.value = settings.targetLanguage;

  for (const input of modeInputs) {
    input.checked = input.value === settings.mode;
  }

  statusText.textContent = settings.enabled
    ? `翻译已启用，目标语言：${settings.targetLanguage}`
    : "翻译已关闭";
  statusDot.classList.toggle("ready", settings.enabled);
}

async function initialize() {
  const settings = await getStoredSettings();
  render(settings);
}

enabledToggle.addEventListener("change", async (event) => {
  await saveSettings({ enabled: event.target.checked });
  render(await getStoredSettings());
});

languageSelect.addEventListener("change", async (event) => {
  await saveSettings({ targetLanguage: event.target.value });
  render(await getStoredSettings());
});

for (const input of modeInputs) {
  input.addEventListener("change", async (event) => {
    if (!event.target.checked) {
      return;
    }

    await saveSettings({ mode: event.target.value });
    render(await getStoredSettings());
  });
}

initialize().catch((error) => {
  console.error("Failed to initialize popup:", error);
  statusText.textContent = "初始化失败，请刷新后重试";
  statusDot.classList.remove("ready");
});
