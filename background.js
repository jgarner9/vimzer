async function sendActivate(tabId, newTab) {
  const msg = { type: "ACTIVATE_HINTS", newTab };
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
      console.warn("[Vimzer] Could not activate hints in tab", tabId, err);
    }
  }
}

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  if (command === "activate-hints") {
    sendActivate(tab.id, false);
  } else if (command === "activate-hints-new-tab") {
    sendActivate(tab.id, true);
  }
});
