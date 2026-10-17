---
# 本文件由 scripts/i18n-zh.mjs 从 components/badge.md 生成，请勿手改；要改译文请改那边。
title: "徽标"
description: "没有专属元素的小标签：.bn-badge 是 HTML 无法提供的那个锚点。"
---

`.bn-badge` 就是锚点，而它是类，因为除此之外它不可能是别的（ADR-0001）。一个状态片、一个计数、
一个分类标签——HTML 对它们都没有元素，而最接近的候选元素都另有所指，所以徽标正是类名被留给的那种
场合。它住在 `span` 上。

```html
<p>
  Status: <span class="bn-badge">Draft</span>
  <span class="bn-badge" data-variant="success">Passing</span>
  <span class="bn-badge" data-variant="warning">Needs review</span>
  <span class="bn-badge" data-variant="danger">Failing</span>
</p>
```

徽标是标签，不是控件。它比按钮低一档阴影（ADR-0003：不是每个物体的分量都一样），而且它不动——悬停
什么也不会发生，边框宽度也从不变化，所以一排徽标不会在指针下面重排。

### 含义与外观

`data-variant` 承担含义，和它在别处完全一样：`success`、`warning` 与 `danger`（`error` 是别名），
再加上 `secondary`——用于那种属于层级关系而不是颜色的场合：草稿徽标比通过徽标安静，但它并不是「灰色
表示某种含义」。形态是类：`.bn-solid` 用当前颜色填满徽标，`.bn-outline` 把填充换成同色墨与同色边框，
而 `.bn-sm` / `.bn-lg` 改变尺寸却不动边框盒。

```html
<p>
  <span class="bn-badge">Default</span>
  <span class="bn-badge" data-variant="secondary">Draft</span>
  <span class="bn-badge bn-solid" data-variant="success">Solid</span>
  <span class="bn-badge bn-outline" data-variant="danger">Outline</span>
  <span class="bn-badge bn-sm">Small</span>
  <span class="bn-badge bn-lg">Large</span>
</p>
```

卡片页上的五个强调色类在这里同样可用——`.bn-pink`、`.bn-blue`、`.bn-green`、`.bn-orange` 与
`.bn-lavender`——因为强调色属于外观，而外观不归徽标管。

### 边框与阴影同色

自带颜色的徽标会把边框与硬阴影画成那个颜色，比卡片低一档，机制相同：颜色被重新发布为
`--bn-shadow-color`，sm 档的形状则由 `--bn-shadow-x` 与 `--bn-shadow-y` 重新述说。没有自带颜色的徽标
逐字节保留 `--bn-shadow-sm`，而 `secondary` 刻意保持结构性——它是层级关系，不是颜色。

### 在链接里

链接里的徽标在悬停时取页面的强调色，于是一列标签读起来是一个整体，而不是一排漂在高亮里的碎片。链接
徽标正是这条规则存在的理由；悬停时别的什么都不会变。

```html
<p>
  <a href="/components/card">Cards <span class="bn-badge" data-variant="success">Ready</span></a>
</p>
```

### 覆盖它

写不分层的 CSS，它就赢过库里每一条分层规则（ADR-0006）——任何地方都不需要 `!important`。或者挪一个
`:root` 上的令牌：`--bn-secondary-background` 是表面，`--bn-border-color` 是没有变体参与时的边框与
阴影颜色，`--bn-radius` 是圆角。令牌必须改在 `:root` 上，因为派生令牌在它被声明的地方、而不是在被使用
的地方就完成了替换。
