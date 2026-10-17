---
# 本文件由 scripts/i18n-zh.mjs 从 pages/usage.md 生成，请勿手改；要改译文请改那边。
title: "使用方式"
description: "如何把 Barnacle 放进一个页面，以及发布的四份产物分别是什么。"
---

> **占位。** 逐步的使用指南会和第一批组件一起落地（04–22 号票）。不过下面的链接是真的：
> 它们就是本仓库今天发布的文件。

## 把 Barnacle 加到页面里

Barnacle 是一份样式表加一个可选的脚本。先取压缩版这一对：

- [barnacle.min.css](/static/barnacle.min.css)
- [barnacle.min.js](/static/barnacle.min.js)

或者取可读的那一对，本文件站自己加载的就是它们：

- [barnacle.css](/static/barnacle.css)
- [barnacle.js](/static/barnacle.js)

两对都与提交在 `static/` 下的构建产物逐字节一致，所以下面这种写法同样有效：

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/ivan112058/barnacle@main/static/barnacle.min.css">
<script src="https://cdn.jsdelivr.net/gh/ivan112058/barnacle@main/static/barnacle.min.js" defer></script>
```

## 本地构建与预览

```powershell
npm install
npm run build                       # src/ → static/barnacle{,.min}.{css,js}
node scripts/verify.mjs             # build-chain checks
node scripts/verify-site.mjs        # this site's checks, including the preview server
& "D:\sdk\seite\seite.exe" serve --port 4377
```

`seite` 在这台机器上不在 `PATH` 上——永远用它的绝对路径调用。
