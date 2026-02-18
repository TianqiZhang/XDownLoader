#!/usr/bin/env node

const fs = require('node:fs/promises');
const path = require('node:path');
const cheerio = require('cheerio');

function usage() {
  console.log('Usage: node convert_x_article.js <input.html> [outputDir] [--image-delay-ms=1200]');
  console.log('Example: node convert_x_article.js whole_article.html output --image-delay-ms=1500');
}

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
      // Request the highest available variant.
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

    const ext = path.extname(parsed.pathname).replace('.', '').toLowerCase();
    if (ext && /^[a-z0-9]+$/i.test(ext)) return ext;
  } catch {
    // ignore
  }
  return 'jpg';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function applyInlineStyle(text, style) {
  if (!text) return '';
  const normalized = (style || '').toLowerCase();
  const isBold = /font-weight\s*:\s*(bold|[6-9]00)/.test(normalized);
  const isItalic = /font-style\s*:\s*italic/.test(normalized);

  if (isBold && isItalic) return `***${text}***`;
  if (isBold) return `**${text}**`;
  if (isItalic) return `*${text}*`;
  return text;
}

function parseInlineNode(node, $, state) {
  if (!node) return '';

  if (node.type === 'text') {
    return node.data || '';
  }

  if (node.type !== 'tag') {
    return '';
  }

  const tag = node.tagName.toLowerCase();

  if (tag === 'br') {
    return '\n';
  }

  if (tag === 'img') {
    const src = $(node).attr('src');
    if (!src) return '';
    const alt = cleanText($(node).attr('alt')) || 'Image';
    const filename = registerImage(src, state);
    return `![${alt}](images/${filename})`;
  }

  if (tag === 'a') {
    const href = resolveXUrl($(node).attr('href'));
    const label = cleanText(parseInlineChildren(node, $, state));
    if (!label) return href || '';
    if (!href) return label;
    return `[${label}](${href})`;
  }

  const childText = parseInlineChildren(node, $, state);

  if (tag === 'span') {
    return applyInlineStyle(childText, $(node).attr('style'));
  }

  return childText;
}

function parseInlineChildren(node, $, state) {
  let out = '';
  const children = node.children || [];
  for (const child of children) {
    out += parseInlineNode(child, $, state);
  }
  return out;
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
    canonicalUrl,
    originalUrl,
    filename,
  });
  state.imageByUrl.set(canonicalUrl, filename);
  return filename;
}

function parseParagraph($el, $, state) {
  const text = cleanText(parseInlineChildren($el[0], $, state));
  return text;
}

function parseHeading($el, $, state) {
  const h2 = $el.is('h2') ? $el : $el.find('h2.longform-header-two').first();
  if (!h2.length) return '';
  const heading = cleanText(h2.text());
  if (!heading) return '';
  return `## ${heading}`;
}

function parseBlockQuote($el, $, state) {
  const lines = [];
  const blocks = $el.find('> div');

  if (blocks.length) {
    blocks.each((_, block) => {
      const text = cleanText(parseInlineChildren(block, $, state));
      if (text) lines.push(`> ${text}`);
    });
  } else {
    const text = cleanText(parseInlineChildren($el[0], $, state));
    if (text) lines.push(`> ${text}`);
  }

  return lines.join('\n');
}

function parseImageSection($el, $, state) {
  const parts = [];
  const seenInBlock = new Set();

  $el.find('img[src]').each((_, img) => {
    const src = $(img).attr('src');
    if (!src) return;

    const canonical = canonicalizeImageUrl(resolveXUrl(src));
    if (seenInBlock.has(canonical)) return;
    seenInBlock.add(canonical);

    const alt = cleanText($(img).attr('alt')) || 'Image';
    const filename = registerImage(src, state);
    parts.push(`![${alt}](images/${filename})`);
  });

  return parts.join('\n\n');
}

function parseContentBlocks($contentRoot, $, state) {
  const blocks = [];

  $contentRoot.children().each((_, el) => {
    const $el = $(el);

    if ($el.hasClass('longform-unstyled')) {
      const paragraph = parseParagraph($el, $, state);
      if (paragraph) blocks.push(paragraph);
      return;
    }

    if ($el.is('blockquote.longform-blockquote')) {
      const quote = parseBlockQuote($el, $, state);
      if (quote) blocks.push(quote);
      return;
    }

    if ($el.is('section')) {
      const imageMarkdown = parseImageSection($el, $, state);
      if (imageMarkdown) blocks.push(imageMarkdown);
      return;
    }

    if ($el.find('h2.longform-header-two').length > 0) {
      const heading = parseHeading($el, $, state);
      if (heading) blocks.push(heading);
    }
  });

  return blocks;
}

function extractMetadata($) {
  const title = cleanText($('[data-testid="twitter-article-title"]').first().text());

  const user = $('[data-testid="User-Name"]').first();
  const userSpans = user
    .find('span')
    .map((_, el) => cleanText($(el).text()))
    .get()
    .filter(Boolean);

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

  const datetime = $('time[datetime]').first().attr('datetime') || '';
  const statusHrefs = $('a[href*="/status/"]')
    .map((_, el) => $(el).attr('href') || '')
    .get()
    .filter(Boolean);
  const statusHref =
    statusHrefs.find((href) => href.includes('/status/') && !href.includes('/analytics')) ||
    statusHrefs[0] ||
    '';
  const articleHref = $('a[href*="/article/"]').first().attr('href') || '';
  const sourceUrl = resolveXUrl(statusHref || articleHref);

  return {
    title,
    author,
    handle,
    datetime,
    sourceUrl,
  };
}

async function downloadImages(images, imageDir, imageDelayMs = 1200) {
  await fs.mkdir(imageDir, { recursive: true });

  for (let i = 0; i < images.length; i += 1) {
    const image = images[i];
    const outputPath = path.join(imageDir, image.filename);

    let response;
    try {
      response = await fetch(image.canonicalUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch {
      response = await fetch(image.originalUrl);
      if (!response.ok) {
        throw new Error(`Failed to download ${image.originalUrl}: HTTP ${response.status}`);
      }
    }

    const arrayBuffer = await response.arrayBuffer();
    await fs.writeFile(outputPath, Buffer.from(arrayBuffer));

    // Throttle requests so downloads look like normal user traffic.
    if (i < images.length - 1 && imageDelayMs > 0) {
      const jitter = Math.floor(Math.random() * 250);
      await sleep(imageDelayMs + jitter);
    }
  }
}

async function main() {
  const inputPath = process.argv[2];
  const outputDir = process.argv[3] || 'output';
  const imageDelayArg = process.argv.find((value) => value.startsWith('--image-delay-ms='));
  const parsedDelay = imageDelayArg ? Number(imageDelayArg.split('=')[1]) : NaN;
  const imageDelayMs = Number.isFinite(parsedDelay) ? Math.max(0, Math.floor(parsedDelay)) : 1200;

  if (!inputPath || inputPath === '--help' || inputPath === '-h') {
    usage();
    process.exit(inputPath ? 0 : 1);
  }

  const inputAbs = path.resolve(inputPath);
  const outAbs = path.resolve(outputDir);
  const imageDir = path.join(outAbs, 'images');

  const html = await fs.readFile(inputAbs, 'utf8');
  const $ = cheerio.load(html, { decodeEntities: true });

  const richRoot = $('[data-testid="twitterArticleRichTextView"]').first();
  if (!richRoot.length) {
    throw new Error('Could not find twitterArticleRichTextView. Confirm the article container HTML was copied.');
  }

  const contentRoot = richRoot.find('div[data-contents="true"]').first();
  if (!contentRoot.length) {
    throw new Error('Could not find div[data-contents="true"] inside article rich text container.');
  }

  const state = {
    images: [],
    imageByUrl: new Map(),
  };

  const metadata = extractMetadata($);
  const blocks = parseContentBlocks(contentRoot, $, state);

  await fs.mkdir(outAbs, { recursive: true });

  const sections = [];
  sections.push(`# ${metadata.title || 'Untitled X Article'}`);
  if (metadata.author || metadata.handle || metadata.datetime || metadata.sourceUrl) {
    const metadataLines = [];
    if (metadata.author) metadataLines.push(`- Author: ${metadata.author}`);
    if (metadata.handle) metadataLines.push(`- Handle: ${metadata.handle}`);
    if (metadata.datetime) metadataLines.push(`- Published: ${metadata.datetime}`);
    if (metadata.sourceUrl) metadataLines.push(`- Source: ${metadata.sourceUrl}`);
    sections.push(metadataLines.join('\n'));
  }
  sections.push(...blocks);

  const markdownPath = path.join(outAbs, 'article.md');
  await fs.writeFile(markdownPath, `${sections.join('\n\n')}\n`, 'utf8');

  await downloadImages(state.images, imageDir, imageDelayMs);

  console.log(`Markdown written to: ${markdownPath}`);
  console.log(`Images downloaded: ${state.images.length}`);
  console.log(`Image directory: ${imageDir}`);
  console.log(`Image delay: ${imageDelayMs}ms (+ up to 249ms jitter)`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
