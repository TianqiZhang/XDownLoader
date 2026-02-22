const DEFAULT_IMAGE_DELAY_MS = 1200;

function sanitizeFilename(input) {
  const cleaned = (input || 'x-article')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

  return (cleaned || 'x-article').slice(0, 120);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dataUrlForText(text) {
  return `data:text/markdown;charset=utf-8,${encodeURIComponent(text || '')}`;
}

function downloadFile(options) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(options, (downloadId) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve(downloadId);
    });
  });
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

function buildFolderName(payload) {
  const datePrefix = formatDatePrefix(payload && payload.publishedAt);
  const title = sanitizeFilename((payload && payload.title) || 'x-article');
  return `${datePrefix}-${title}`;
}

function parseDelay(options) {
  const value = Number(options && options.delayMs);
  if (!Number.isFinite(value)) return DEFAULT_IMAGE_DELAY_MS;
  return Math.max(0, Math.floor(value));
}

async function downloadExport(payload, options) {
  if (!payload || typeof payload.markdown !== 'string') {
    throw new Error('Invalid payload: markdown is required.');
  }

  const delayMs = parseDelay(options);
  const folderName = buildFolderName(payload);
  const baseDir = folderName;

  await downloadFile({
    url: dataUrlForText(payload.markdown),
    filename: `${baseDir}/article.md`,
    saveAs: false,
    conflictAction: 'uniquify'
  });

  const images = Array.isArray(payload.images) ? payload.images : [];

  for (let i = 0; i < images.length; i += 1) {
    const image = images[i] || {};
    const filename = sanitizeFilename(image.filename || `image-${String(i + 1).padStart(2, '0')}.jpg`);
    const primaryUrl = image.url;
    const fallbackUrl = image.fallbackUrl;

    let downloaded = false;
    if (primaryUrl) {
      try {
        await downloadFile({
          url: primaryUrl,
          filename: `${baseDir}/images/${filename}`,
          saveAs: false,
          conflictAction: 'uniquify'
        });
        downloaded = true;
      } catch {
        // fallback below
      }
    }

    if (!downloaded && fallbackUrl) {
      await downloadFile({
        url: fallbackUrl,
        filename: `${baseDir}/images/${filename}`,
        saveAs: false,
        conflictAction: 'uniquify'
      });
      downloaded = true;
    }

    if (!downloaded) {
      throw new Error(`Missing image URL for ${filename}`);
    }

    if (i < images.length - 1 && delayMs > 0) {
      const jitter = Math.floor(Math.random() * 250);
      await sleep(delayMs + jitter);
    }
  }

  return {
    baseDir,
    imageCount: images.length,
    delayMs
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== 'DOWNLOAD_EXPORT') {
    return;
  }

  downloadExport(message.payload, message.options)
    .then((result) => {
      sendResponse({ ok: true, result });
    })
    .catch((error) => {
      sendResponse({ ok: false, error: error.message || String(error) });
    });

  return true;
});
