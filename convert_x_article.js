#!/usr/bin/env node

const fs = require('node:fs/promises');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { extractArticleFromDoc } = require('./chrome_extension/converter');

function usage() {
  console.log('Usage: node convert_x_article.js <input.html> [outputDir] [--image-delay-ms=1200]');
  console.log('Example: node convert_x_article.js whole_article.html output --image-delay-ms=1500');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeFilename(input) {
  return (input || 'image').replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').trim() || 'image';
}

async function downloadImages(images, imageDir, imageDelayMs = 1200) {
  await fs.mkdir(imageDir, { recursive: true });

  for (let i = 0; i < images.length; i += 1) {
    const image = images[i];
    const outputPath = path.join(imageDir, sanitizeFilename(image.filename));

    let response;
    try {
      response = await fetch(image.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch {
      response = await fetch(image.fallbackUrl);
      if (!response.ok) {
        throw new Error(`Failed to download ${image.fallbackUrl}: HTTP ${response.status}`);
      }
    }

    const arrayBuffer = await response.arrayBuffer();
    await fs.writeFile(outputPath, Buffer.from(arrayBuffer));

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
  const dom = new JSDOM(html);
  const doc = dom.window.document;

  const result = extractArticleFromDoc(doc);

  await fs.mkdir(outAbs, { recursive: true });

  const markdownPath = path.join(outAbs, 'article.md');
  await fs.writeFile(markdownPath, result.markdown, 'utf8');

  await downloadImages(result.images, imageDir, imageDelayMs);

  console.log(`Markdown written to: ${markdownPath}`);
  console.log(`Images downloaded: ${result.images.length}`);
  console.log(`Image directory: ${imageDir}`);
  console.log(`Image delay: ${imageDelayMs}ms (+ up to 249ms jitter)`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
