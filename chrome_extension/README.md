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
4. Click **Choose Folder + Export**.
5. Pick the parent folder.

Output is created under the chosen parent folder:

- `<date>-<article-title>/article.md`
- `<date>-<article-title>/images/*`

## Notes

- The extension extracts content from the live DOM (`twitterArticleRichTextView`).
- It includes a delay plus random jitter (0-249ms) between image downloads.
- `date` comes from article publish timestamp when available, otherwise current date.
- If page structure changes, update `content.js` selectors.
