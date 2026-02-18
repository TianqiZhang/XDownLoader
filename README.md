# X Long Article -> Markdown Export

This folder now includes a working converter for X long-article HTML fragments.

## What We Observed in Your HTML

- The article body is reliably under `data-testid="twitterArticleRichTextView"`.
- Content blocks are under `div[data-contents="true"]`.
- Main block types are stable:
  - Paragraphs: `.longform-unstyled`
  - Headings: `h2.longform-header-two`
  - Quotes: `blockquote.longform-blockquote`
  - Images: `section ... img[src]`
- Inline formats are represented mainly with span styles:
  - Bold: `font-weight: bold`
  - Italic: `font-style: italic`
  - Links: `<a href="...">`

This is enough to parse reliably without full-page HTML.

## Script

- Converter: `/Users/tianqi/code/XDownLoader/convert_x_article.js`

## Install

```bash
cd /Users/tianqi/code/XDownLoader
npm install
```

## Run

```bash
node /Users/tianqi/code/XDownLoader/convert_x_article.js /Users/tianqi/code/XDownLoader/whole_article.html /Users/tianqi/code/XDownLoader/output
```

Optional throttle for image downloads:

```bash
node /Users/tianqi/code/XDownLoader/convert_x_article.js /Users/tianqi/code/XDownLoader/whole_article.html /Users/tianqi/code/XDownLoader/output --image-delay-ms=1500
```

## Output

- Markdown: `/Users/tianqi/code/XDownLoader/output/article.md`
- Images: `/Users/tianqi/code/XDownLoader/output/images/`

## Capture Tip (from browser console)

If you want to capture fresh article HTML directly from X page:

```js
copy(document.querySelector('[data-testid="twitterArticleRichTextView"]').outerHTML)
```

Then paste that into a `.html` file and run the converter.

## Why this is viable

- Uses structural attributes (`data-testid`, longform classes), not fragile CSS class hashes.
- Works on copied fragment HTML, not only complete pages.
- Image URLs are normalized to request higher quality (`name=orig`) and downloaded locally.
