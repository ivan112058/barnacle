---
# 本文件由 scripts/i18n-zh.mjs 从 components/accordion.md 生成，请勿手改；要改译文请改那边。
title: "手风琴"
description: "原生的 details 与 summary 组合，默认就被装扮好：不写一行脚本就能展开的折叠面板，以及一个位移与硬阴影共用同一套刻度的标记。"
---

Barnacle 装扮 `details` 与 `summary` 元素，所以一个折叠面板不需要类、不需要属性、也不需要脚本：
浏览器本来就知道怎么开关它，库来决定它长什么样。收起与展开刻意是两个不同的物体——头部原地不动，
面板在一条分隔线下面到来。

```html
<details>
  <summary>Shipping and delivery</summary>
  <p>Orders leave the warehouse within one working day, and tracking arrives by email.</p>
</details>
```

### 一摞面板

排成一列的面板就是一列 `details` 元素。库给它们的间距比硬阴影还宽，所以没有任何一项会画到邻居身上，
展开一项也从不会把其它项挤到一边：

```html
<details>
  <summary>Shipping and delivery</summary>
  <p>Orders leave the warehouse within one working day.</p>
</details>
<details>
  <summary>Returns</summary>
  <p>Send anything back within thirty days, in the condition it arrived.</p>
</details>
<details>
  <summary>Warranty</summary>
  <p>Every part is covered for two years against manufacturing faults.</p>
</details>
```

### 面板可以嵌套

一个 `details` 里的 `details` 仍然是 `details`，而每一层保留自己的外框。直接坐在面板里的嵌套面板会被
外层面板的内容内边距缩进；像这里这样包在一个 `div` 里的嵌套面板，则四周保留外层的内边距：

```html
<details>
  <summary>Billing</summary>
  <div>
    <p>Invoices are issued on the first working day of the month.</p>
    <details>
      <summary>Invoice archive</summary>
      <p>The last twenty-four invoices are kept in the account.</p>
    </details>
  </div>
</details>
```

### 标记与阴影刻度

头部带一个标记：一个正方形，边长是三个边框宽，用强调色填满。展开面板时它旋转 45° 变成菱形，并按库的
位移量向左上挪动，所以在读到内容之前，方块就代表收起、菱形就代表展开。

那段位移不是这个组件自己挑的数字。它是 `--_lift-x` 与 `--_lift-y`，为整个库声明一次，并从
`--bn-shadow-lift` 派生，而后者是 `--bn-shadow-x` 的一半。给这一项硬阴影的正是同一个令牌，所以改基础
偏移会同步缩放阴影与标记位移——一个数字，一种味道：

```css
:root {
  --bn-shadow-x: 8px;
  --bn-shadow-y: 8px;
}
```

只在 `:root` 上覆盖它，别处都不行：派生令牌在它被声明的地方就已经替换完毕，所以写在某个包裹元素上的
同样声明什么也不会改变。从脚本里覆盖时，出于同样的原因，必须落在 `document.documentElement` 上。

### 键盘与焦点

`summary` 是真正的交互元素，所以什么都不用接：Tab 能到达它，Enter 与空格都能切换它，而焦点环是库唯一
的那一个环——三像素的 `outline`，偏移三像素，画在外框之外，粗边框吞不掉它。同样因为这个原因，关掉脚本
之后面板照样展开：开关是浏览器的，不是库的。

### 覆盖它

写不分层的 CSS 就直接赢，因为库发布的每条规则都在级联层里（ADR-0006）——见[自定义主题](/zh/customizing)。
或者在 `:root` 上改一个令牌：`--bn-border-width` 连同标记一起加粗外框，`--bn-border-color` 给两者重新
上色，`--bn-main` 与 `--bn-danger` 重绘标记，而 `--bn-shadow-x` 同时缩放阴影与标记位移。
