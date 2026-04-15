(function () {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== 'EXTRACT_ARTICLE') {
      return;
    }

    try {
      const payload = XConverter.extractArticleFromDoc(document, location.href);
      sendResponse({ ok: true, payload });
    } catch (error) {
      sendResponse({ ok: false, error: error.message || String(error) });
    }
  });
})();
