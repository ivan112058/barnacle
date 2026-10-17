---
# 本文件由 scripts/i18n-zh.mjs 从 components/typography.md 生成，请勿手改；要改译文请改那边。
title: "排版"
description: "每一个裸文本元素都自带装扮，不需要类名。"
---

Barnacle 直接装扮你已经在写的文字元素——`h1`–`h6`、`p`、`ul`、`ol`、`blockquote`、`code`、
`pre`、`hr`、`mark` 与链接——所以「标对了就默认好看」而不是「要选择加入」（ADR-0001）。下面这一块
就是整套词汇表：纯 HTML，一个类名都不出现，颜色、间距与阴影的决定一个也不留给页面。

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
