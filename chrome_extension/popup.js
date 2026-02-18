const DEFAULT_DELAY_MS = 1200;

const delayInput = document.getElementById('imageDelay');
const exportBtn = document.getElementById('exportBtn');
const statusEl = document.getElementById('status');

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? '#b00020' : '#0f1419';
}

function getActiveTab() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }

      const tab = tabs && tabs[0];
      if (!tab || typeof tab.id !== 'number') {
        reject(new Error('No active tab found.'));
        return;
      }

      resolve(tab);
    });
  });
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve(response);
    });
  });
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve(response);
    });
  });
}

async function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ imageDelayMs: DEFAULT_DELAY_MS }, (result) => {
      const value = Number(result.imageDelayMs);
      const delayMs = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : DEFAULT_DELAY_MS;
      resolve(delayMs);
    });
  });
}

async function saveSettings(delayMs) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ imageDelayMs: delayMs }, () => resolve());
  });
}

function parseDelay() {
  const value = Number(delayInput.value);
  if (!Number.isFinite(value)) return DEFAULT_DELAY_MS;
  return Math.max(0, Math.floor(value));
}

function isSupportedUrl(url) {
  return /^https:\/\/(x|twitter)\.com\//i.test(url || '');
}

async function handleExport() {
  exportBtn.disabled = true;

  try {
    const delayMs = parseDelay();
    await saveSettings(delayMs);

    const tab = await getActiveTab();
    if (!isSupportedUrl(tab.url)) {
      throw new Error('Open an article on x.com first.');
    }

    setStatus('Extracting article from page...');
    const extraction = await sendTabMessage(tab.id, { type: 'EXTRACT_ARTICLE' });
    if (!extraction || !extraction.ok) {
      throw new Error(extraction && extraction.error ? extraction.error : 'Extraction failed.');
    }

    const imageCount = Array.isArray(extraction.payload.images) ? extraction.payload.images.length : 0;
    setStatus(`Starting downloads (${imageCount} images)...`);

    const result = await sendRuntimeMessage({
      type: 'DOWNLOAD_EXPORT',
      payload: extraction.payload,
      options: { delayMs }
    });

    if (!result || !result.ok) {
      throw new Error(result && result.error ? result.error : 'Download failed.');
    }

    setStatus(`Done. Saved under Downloads/${result.result.baseDir}`);
  } catch (error) {
    setStatus(error.message || String(error), true);
  } finally {
    exportBtn.disabled = false;
  }
}

async function init() {
  const delayMs = await loadSettings();
  delayInput.value = String(delayMs);

  exportBtn.addEventListener('click', handleExport);
}

init();
