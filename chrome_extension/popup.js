const DEFAULT_DELAY_MS = 1200;

const delayInput = document.getElementById('imageDelay');
const exportBtn = document.getElementById('exportBtn');
const statusEl = document.getElementById('status');

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? '#b00020' : '#0f1419';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeFilename(input) {
  const cleaned = (input || 'x-article')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

  return (cleaned || 'x-article').slice(0, 120);
}

function formatDatePrefix(isoDatetime) {
  if (isoDatetime) {
    const parsed = new Date(isoDatetime);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
  }
  return new Date().toISOString().slice(0, 10);
}

function folderNameForPayload(payload) {
  const datePrefix = formatDatePrefix(payload && payload.publishedAt);
  const title = sanitizeFilename((payload && payload.title) || 'x-article');
  return `${datePrefix}-${title}`;
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

function injectContentScript(tabId) {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript(
      {
        target: { tabId },
        files: ['content.js']
      },
      () => {
        const err = chrome.runtime.lastError;
        if (err) {
          reject(new Error(err.message));
          return;
        }
        resolve();
      }
    );
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

async function writeTextFile(dirHandle, filename, text) {
  const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(text);
  await writable.close();
}

async function writeBlobFile(dirHandle, filename, blob) {
  const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

async function fetchImageBlob(image) {
  const primaryUrl = image && image.url;
  const fallbackUrl = image && image.fallbackUrl;

  if (primaryUrl) {
    try {
      const response = await fetch(primaryUrl, { credentials: 'omit' });
      if (response.ok) {
        return response.blob();
      }
    } catch {
      // fallback below
    }
  }

  if (fallbackUrl) {
    const response = await fetch(fallbackUrl, { credentials: 'omit' });
    if (response.ok) {
      return response.blob();
    }
    throw new Error(`Failed to fetch image: HTTP ${response.status}`);
  }

  throw new Error('Image is missing both primary and fallback URLs.');
}

async function exportToPickedFolder(payload, parentHandle, delayMs) {
  if (!payload || typeof payload.markdown !== 'string') {
    throw new Error('Invalid payload: markdown is required.');
  }

  const folderName = folderNameForPayload(payload);
  const articleDir = await parentHandle.getDirectoryHandle(folderName, { create: true });
  const imagesDir = await articleDir.getDirectoryHandle('images', { create: true });

  await writeTextFile(articleDir, 'article.md', payload.markdown);

  const images = Array.isArray(payload.images) ? payload.images : [];

  for (let i = 0; i < images.length; i += 1) {
    const image = images[i] || {};
    const filename = sanitizeFilename(image.filename || `image-${String(i + 1).padStart(2, '0')}.jpg`);
    const blob = await fetchImageBlob(image);
    await writeBlobFile(imagesDir, filename, blob);

    if (i < images.length - 1 && delayMs > 0) {
      const jitter = Math.floor(Math.random() * 250);
      await sleep(delayMs + jitter);
    }
  }

  return {
    folderName,
    imageCount: images.length,
    delayMs
  };
}

async function pickParentDirectory() {
  if (typeof window.showDirectoryPicker !== 'function') {
    return null;
  }

  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    return handle;
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw new Error('Folder selection canceled.');
    }
    throw error;
  }
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

    setStatus('Choose the parent folder for export...');
    const parentHandle = await pickParentDirectory();

    setStatus('Extracting article from page...');
    let extraction;
    try {
      extraction = await sendTabMessage(tab.id, { type: 'EXTRACT_ARTICLE' });
    } catch (error) {
      const message = error && error.message ? error.message : '';
      if (!message.includes('Receiving end does not exist')) {
        throw error;
      }

      setStatus('Page script not ready. Injecting extractor and retrying...');
      await injectContentScript(tab.id);
      extraction = await sendTabMessage(tab.id, { type: 'EXTRACT_ARTICLE' });
    }

    if (!extraction || !extraction.ok) {
      throw new Error(extraction && extraction.error ? extraction.error : 'Extraction failed.');
    }

    const imageCount = Array.isArray(extraction.payload.images) ? extraction.payload.images.length : 0;

    if (parentHandle) {
      setStatus(`Saving markdown + ${imageCount} images...`);
      const result = await exportToPickedFolder(extraction.payload, parentHandle, delayMs);
      setStatus(`Done. Saved to selected folder: ${result.folderName}`);
      return;
    }

    setStatus(`Directory picker unavailable. Falling back to Downloads/${imageCount ? ' with images' : ''}...`);
    const fallback = await sendRuntimeMessage({
      type: 'DOWNLOAD_EXPORT',
      payload: extraction.payload,
      options: { delayMs }
    });

    if (!fallback || !fallback.ok) {
      throw new Error(fallback && fallback.error ? fallback.error : 'Fallback download failed.');
    }

    setStatus(`Done. Saved under Downloads/${fallback.result.baseDir}`);
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
