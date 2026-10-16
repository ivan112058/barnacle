---
title: "Typography"
description: "Every bare text element, dressed without a class name."
---

Barnacle dresses the text elements you already write — `h1`–`h6`, `p`, `ul`, `ol`,
`blockquote`, `code`, `pre`, `hr`, `mark` and links — so correct markup is the default instead
of something you opt into (ADR-0001). The block below is the whole vocabulary: plain HTML, no
class name anywhere, and no colour, spacing or shadow decision left to the page.

```html
<h1>Barnacle typography</h1>
<h2>Heading level two</h2>
<h3>Heading level three</h3>
<h4>Heading level four</h4>
<h5>Heading level five</h5>
<h6>Heading level six</h6>

<p>
  Body copy runs at a generous line height, with a line of <code>inline code</code> in the
  middle and a <a href="https://example.com/example">link that stays a link</a>: underlined,
  highlighted on hover, and never raised like a button.
</p>

<ul>
  <li>Unordered lists keep square markers, at every depth.</li>
  <li>
    Nested lists tighten their rhythm instead of repeating the outer spacing:
    <ul>
      <li>A nested item, still square.</li>
      <li>Another nested item.</li>
    </ul>
  </li>
</ul>

<ol>
  <li>Ordered lists keep their numbers.</li>
  <li>And the same spacing rules as unordered ones.</li>
</ol>

<blockquote>
  <p>A quotation gets a thick main-colour bar on its inline start edge, so a right-to-left
  page needs no extra rule.</p>
</blockquote>

<pre><code>const barnacle = "no class names, no build step";</code></pre>

<hr>

<p>Highlighted text is a <mark>mark element</mark> — accent background, ink on top.</p>
```
