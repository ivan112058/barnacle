---
title: "Usage"
description: "How to add Barnacle to a page, and what the four published artifacts are."
---

> **Placeholder.** The step-by-step usage guide lands together with the first components
> (tickets 04–07). The links below are real, though: they are the files this repository
> publishes today.

## Add Barnacle to a page

Barnacle is one stylesheet plus one optional script. Take the minified pair:

- [barnacle.min.css](/static/barnacle.min.css)
- [barnacle.min.js](/static/barnacle.min.js)

or the readable pair, which is what this documentation site itself loads:

- [barnacle.css](/static/barnacle.css)
- [barnacle.js](/static/barnacle.js)

Both pairs are byte-identical to the build output committed under `static/`, so any of these
also works:

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/ivan112058/barnacle@main/static/barnacle.min.css">
<script src="https://cdn.jsdelivr.net/gh/ivan112058/barnacle@main/static/barnacle.min.js" defer></script>
```

## Build and preview locally

```powershell
npm install
npm run build                       # src/ → static/barnacle{,.min}.{css,js}
node scripts/verify.mjs             # build-chain checks
node scripts/verify-site.mjs        # this site's checks, including the preview server
& "D:\sdk\seite\seite.exe" serve --port 4377
```

`seite` is not on `PATH` on this machine — always call it by its absolute path.
