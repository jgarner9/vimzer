chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  if (command === "activate-hints") {
    chrome.tabs.sendMessage(tab.id, { type: "ACTIVATE_HINTS", newTab: false });
  } else if (command === "activate-hints-new-tab") {
    chrome.tabs.sendMessage(tab.id, { type: "ACTIVATE_HINTS", newTab: true });
  }
});
