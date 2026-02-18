# Chrome Extension: X Article Markdown Exporter

## Load the extension

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select `/Users/tianqi/code/XDownLoader/chrome_extension`.

## Use

1. Open a long article page on `https://x.com/...`.
2. Click the extension icon.
3. Set image delay (ms), e.g. `1200`.
4. Click **Export Markdown + Images**.

Output is downloaded to your Downloads folder under:

- `XArticleExports/<article-title>-<timestamp>/article.md`
- `XArticleExports/<article-title>-<timestamp>/images/*`

## Notes

- The extension extracts content from the live DOM (`twitterArticleRichTextView`).
- It includes a delay plus random jitter (0-249ms) between image downloads.
- If page structure changes, update `content.js` selectors.
