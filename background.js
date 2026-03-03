const DEFAULT_SETTINGS = {
  enabled: true,
  targetLanguage: "zh-CN",
  mode: "overlay",
};

async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...stored };
}

async function broadcastSettings(tabId) {
  const settings = await getSettings();

  if (typeof tabId === "number") {
    try {
      await chrome.tabs.sendMessage(tabId, {
        type: "APPLY_SETTINGS",
        payload: settings,
      });
    } catch (error) {
      console.debug("Unable to message tab:", tabId, error);
    }
    return;
  }

  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs
      .filter((tab) => typeof tab.id === "number")
      .map((tab) =>
        chrome.tabs
          .sendMessage(tab.id, {
            type: "APPLY_SETTINGS",
            payload: settings,
          })
          .catch(() => undefined)
      )
  );
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.sync.set(DEFAULT_SETTINGS);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "SETTINGS_UPDATED") {
    broadcastSettings(sender.tab?.id).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message?.type === "GET_SETTINGS") {
    getSettings().then((settings) => sendResponse(settings));
    return true;
  }

  return false;
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await broadcastSettings(tabId);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status === "complete") {
    await broadcastSettings(tabId);
  }
});
