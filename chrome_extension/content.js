(function () {
  const DEFAULT_TITLE = 'Untitled X Article';

  function cleanText(value) {
    if (!value) return '';
    return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function resolveXUrl(href) {
    if (!href) return '';
    if (/^https?:\/\//i.test(href)) return href;
    if (href.startsWith('/')) return `https://x.com${href}`;
    return href;
  }

  function canonicalizeImageUrl(rawUrl) {
    try {
      const url = new URL(resolveXUrl(rawUrl));
      if (url.hostname.includes('pbs.twimg.com') && url.searchParams.has('name')) {
        url.searchParams.set('name', 'orig');
      }
      return url.toString();
    } catch {
      return rawUrl;
    }
  }

  function inferExt(url) {
    try {
      const parsed = new URL(url);
      const format = parsed.searchParams.get('format');
      if (format && /^[a-z0-9]+$/i.test(format)) return format.toLowerCase();

      const pathname = parsed.pathname || '';
      const match = pathname.match(/\.([a-z0-9]+)$/i);
      if (match && match[1]) return match[1].toLowerCase();
    } catch {
      // ignore
    }
    return 'jpg';
  }

  function applyInlineStyle(text, styleValue) {
    if (!text) return '';
    const style = (styleValue || '').toLowerCase();
    const isBold = /font-weight\s*:\s*(bold|[6-9]00)/.test(style);
    const isItalic = /font-style\s*:\s*italic/.test(style);

    if (isBold && isItalic) return `***${text}***`;
    if (isBold) return `**${text}**`;
    if (isItalic) return `*${text}*`;
    return text;
  }

  function registerImage(rawUrl, state) {
    const originalUrl = resolveXUrl(rawUrl);
    const canonicalUrl = canonicalizeImageUrl(originalUrl);

    if (state.imageByUrl.has(canonicalUrl)) {
      return state.imageByUrl.get(canonicalUrl);
    }

    const index = state.images.length + 1;
    const filename = `image-${String(index).padStart(2, '0')}.${inferExt(canonicalUrl)}`;

    state.images.push({
      url: canonicalUrl,
      fallbackUrl: originalUrl,
      filename
    });
    state.imageByUrl.set(canonicalUrl, filename);
    return filename;
  }

  function parseInlineChildren(node, state) {
    let out = '';
    for (const child of node.childNodes || []) {
      out += parseInlineNode(child, state);
    }
    return out;
  }

  function parseInlineNode(node, state) {
    if (!node) return '';

    if (node.nodeType === Node.TEXT_NODE) {
      return node.nodeValue || '';
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return '';
    }

    const tag = node.tagName.toLowerCase();

    if (tag === 'br') {
      return '\n';
    }

    if (tag === 'img') {
      const src = node.getAttribute('src');
      if (!src) return '';
      const alt = cleanText(node.getAttribute('alt')) || 'Image';
      const filename = registerImage(src, state);
      return `![${alt}](images/${filename})`;
    }

    if (tag === 'a') {
      const href = resolveXUrl(node.getAttribute('href'));
      const label = cleanText(parseInlineChildren(node, state));
      if (!label) return href || '';
      if (!href) return label;
      return `[${label}](${href})`;
    }

    const childText = parseInlineChildren(node, state);

    if (tag === 'span') {
      return applyInlineStyle(childText, node.getAttribute('style'));
    }

    return childText;
  }

  function parseParagraph(el, state) {
    return cleanText(parseInlineChildren(el, state));
  }

  function parseHeading(el) {
    const h2 = el.matches('h2.longform-header-two') ? el : el.querySelector('h2.longform-header-two');
    if (!h2) return '';
    const heading = cleanText(h2.textContent || '');
    if (!heading) return '';
    return `## ${heading}`;
  }

  function parseBlockQuote(el, state) {
    const lines = [];
    const directBlocks = Array.from(el.children || []).filter((child) => child.tagName && child.tagName.toLowerCase() === 'div');

    if (directBlocks.length) {
      for (const block of directBlocks) {
        const text = cleanText(parseInlineChildren(block, state));
        if (text) lines.push(`> ${text}`);
      }
    } else {
      const text = cleanText(parseInlineChildren(el, state));
      if (text) lines.push(`> ${text}`);
    }

    return lines.join('\n');
  }

  function parseImageSection(el, state) {
    const parts = [];
    const seenInBlock = new Set();

    for (const img of el.querySelectorAll('img[src]')) {
      const src = img.getAttribute('src');
      if (!src) continue;

      const canonical = canonicalizeImageUrl(resolveXUrl(src));
      if (seenInBlock.has(canonical)) continue;
      seenInBlock.add(canonical);

      const alt = cleanText(img.getAttribute('alt')) || 'Image';
      const filename = registerImage(src, state);
      parts.push(`![${alt}](images/${filename})`);
    }

    return parts.join('\n\n');
  }

  function parseContentBlocks(contentRoot, state) {
    const blocks = [];

    for (const child of contentRoot.children || []) {
      if (child.classList && child.classList.contains('longform-unstyled')) {
        const paragraph = parseParagraph(child, state);
        if (paragraph) blocks.push(paragraph);
        continue;
      }

      if (child.matches && child.matches('blockquote.longform-blockquote')) {
        const quote = parseBlockQuote(child, state);
        if (quote) blocks.push(quote);
        continue;
      }

      if (child.tagName && child.tagName.toLowerCase() === 'section') {
        const imageMarkdown = parseImageSection(child, state);
        if (imageMarkdown) blocks.push(imageMarkdown);
        continue;
      }

      if (child.querySelector && child.querySelector('h2.longform-header-two')) {
        const heading = parseHeading(child);
        if (heading) blocks.push(heading);
      }
    }

    return blocks;
  }

  function extractMetadata() {
    const title = cleanText(document.querySelector('[data-testid="twitter-article-title"]')?.textContent || '');

    const user = document.querySelector('[data-testid="User-Name"]');
    const userSpans = user
      ? Array.from(user.querySelectorAll('span')).map((el) => cleanText(el.textContent || '')).filter(Boolean)
      : [];

    let author = '';
    let handle = '';
    for (const value of userSpans) {
      if (!handle && value.startsWith('@')) {
        handle = value;
        continue;
      }

      if (!author && !value.startsWith('@') && value.toLowerCase() !== 'verified account') {
        author = value;
      }
    }

    const datetime = document.querySelector('time[datetime]')?.getAttribute('datetime') || '';
    const statusHrefs = Array.from(document.querySelectorAll('a[href*="/status/"]'))
      .map((el) => el.getAttribute('href') || '')
      .filter(Boolean);
    const statusHref = statusHrefs.find((href) => href.includes('/status/') && !href.includes('/analytics')) || statusHrefs[0] || '';
    const articleHref = document.querySelector('a[href*="/article/"]')?.getAttribute('href') || '';
    const sourceUrl = resolveXUrl(statusHref || articleHref || location.href);

    return {
      title,
      author,
      handle,
      datetime,
      sourceUrl
    };
  }

  function buildMarkdown(metadata, blocks) {
    const sections = [`# ${metadata.title || DEFAULT_TITLE}`];

    if (metadata.author || metadata.handle || metadata.datetime || metadata.sourceUrl) {
      const metadataLines = [];
      if (metadata.author) metadataLines.push(`- Author: ${metadata.author}`);
      if (metadata.handle) metadataLines.push(`- Handle: ${metadata.handle}`);
      if (metadata.datetime) metadataLines.push(`- Published: ${metadata.datetime}`);
      if (metadata.sourceUrl) metadataLines.push(`- Source: ${metadata.sourceUrl}`);
      sections.push(metadataLines.join('\n'));
    }

    sections.push(...blocks);
    return `${sections.join('\n\n').trimEnd()}\n`;
  }

  function extractArticleFromPage() {
    const richRoot = document.querySelector('[data-testid="twitterArticleRichTextView"]');
    if (!richRoot) {
      throw new Error('Could not find article content. Open an X article page first.');
    }

    const contentRoot = richRoot.querySelector('div[data-contents="true"]');
    if (!contentRoot) {
      throw new Error('Found article container but missing rich text contents.');
    }

    const state = {
      images: [],
      imageByUrl: new Map()
    };

    const metadata = extractMetadata();
    const blocks = parseContentBlocks(contentRoot, state);
    const markdown = buildMarkdown(metadata, blocks);

    return {
      title: metadata.title || DEFAULT_TITLE,
      publishedAt: metadata.datetime || '',
      sourceUrl: metadata.sourceUrl,
      markdown,
      images: state.images
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== 'EXTRACT_ARTICLE') {
      return;
    }

    try {
      const payload = extractArticleFromPage();
      sendResponse({ ok: true, payload });
    } catch (error) {
      sendResponse({ ok: false, error: error.message || String(error) });
    }
  });
})();
