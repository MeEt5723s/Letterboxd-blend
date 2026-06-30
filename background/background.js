chrome.runtime.onMessage.addListener((message) => {
  if (message.action === "openBlend") {
    const url =
      chrome.runtime.getURL(
        `pages/blend.html?u1=${message.currentUser}&u2=${message.profileUser}`
      );

    chrome.tabs.create({ url });
  }
});