async function sendToTab(tabId, msg) {
  try {
    await chrome.tabs.sendMessage(tabId, msg);
  } catch {
    // No content script in this tab (e.g. it was open before the extension
    // was installed/reloaded). Inject on demand, then retry.
    try {
      await chrome.scripting.insertCSS({ target: { tabId }, files: ["hints.css"] });
      await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
      await chrome.tabs.sendMessage(tabId, msg);
    } catch (err) {
      // Injection is impossible on chrome://, Web Store, and similar pages.
      console.warn("[Vimzer] Could not reach tab", tabId, err);
    }
  }
}

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  if (command === "enter-leader") {
    sendToTab(tab.id, { type: "ENTER_LEADER" });
  } else if (command === "activate-hints") {
    sendToTab(tab.id, { type: "ACTIVATE_HINTS", newTab: false });
  } else if (command === "activate-hints-new-tab") {
    sendToTab(tab.id, { type: "ACTIVATE_HINTS", newTab: true });
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "GET_TABS") {
    chrome.tabs.query({ currentWindow: true }).then((tabs) =>
      sendResponse(
        tabs.map((t) => ({
          id: t.id,
          title: t.title || t.url || "untitled",
          url: t.url || "",
          active: t.active,
        }))
      )
    );
    return true; // async sendResponse
  }
  if (msg.type === "SWITCH_TAB" && msg.tabId != null) {
    chrome.tabs.update(msg.tabId, { active: true });
  }
});
