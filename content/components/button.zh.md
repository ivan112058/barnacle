---
# 本文件由 scripts/i18n-zh.mjs 从 components/button.md 生成，请勿手改；要改译文请改那边。
title: "按钮"
description: "裸 button 元素默认就被装扮好。.bn-button 类是给 a 与 span 用的显式形状，因为它们没有属性可以声明自己是按钮。"
---

Barnacle 直接装扮你已经在写的 `button` 元素，所以「标对了就默认好看」而不是「要选择加入」
（ADR-0001）。类负责另一个方向：`<a>` 或 `<span>` 没有任何属性可以声明「我是个按钮」，于是
`.bn-button` 是它们取到这个形状的方式。裸链接仍然是链接——有下划线、平的、永远不浮起——这正是
这道分界线的全部意义。

```html
<button type="button">Save changes</button>
<button class="bn-button" type="button">The same button, written with the class</button>
<a class="bn-button" href="#button-demo">An anchor wearing .bn-button</a>
```

这些都不是页面自己画的：形状、颜色与硬阴影全部来自库，而且关掉 JavaScript 之后整套外观照旧。

### 变体

含义由属性承担，永远不由类承担。`data-variant` 接受 `success`、`warning`、`danger`（`error` 是
`danger` 的别名），另外还有 `secondary`，它服务于层级关系而非颜色。变体只重绘表面与压在上面的墨色，
不碰任何别的东西——边框、硬阴影与全部盒模型尺寸都留在原处，所以变体永远不会让网格重排。

### 外观

凡是「形状」而非「含义」的东西都是类，而且这两个轴可以自由组合。`.bn-outline` 把填充换成边框与
当前语义色的墨，并把阴影降一档；`.bn-ghost` 彻底去掉填充、边框、阴影与位移；`.bn-sm` 与 `.bn-lg`
改变尺寸，默认则是「没有类」；`.bn-icon` 把按钮收成围绕单个字形的方块；`.bn-button-group` 把按钮排成
一行，其中 `.bn-attached` 把相邻边框叠在一起，让整组看起来是一根横条。禁用是元素自己的状态——
`disabled`，或者当控件用不了它时用 `aria-disabled="true"`——而不是第四个类。

```html
<button type="button" data-variant="success">Saved</button>
<button type="button" data-variant="warning">Careful</button>
<button type="button" data-variant="danger">Delete</button>
<button type="button" data-variant="secondary">Cancel</button>

<button type="button" class="bn-outline">Outline</button>
<button type="button" class="bn-outline" data-variant="danger">Outline, in danger</button>
<button type="button" class="bn-ghost">Ghost</button>

<button type="button" class="bn-sm">Small</button>
<button type="button" class="bn-lg">Large</button>
<button type="button" disabled>Disabled</button>

<menu class="bn-button-group">
  <button type="button">One</button>
  <button type="button">Two</button>
  <button type="button">Three</button>
</menu>
```

### 交互

悬停时按钮向左上浮起 `--bn-shadow-lift`，同时硬阴影恰好增大同样的量，于是阴影在页面上保持原位，
按钮看起来是从阴影上抬起来的。按下时下沉 `--bn-press`，阴影随之塌到下面。焦点环是一个 `outline`
而不是第二层阴影，所以它不会吞掉硬阴影，粗边框也吞不掉它。状态之间只有颜色变化——边框保持原宽度，
因为一悬停就变粗的边框会让整个网格重排。而且过渡只在访客没有要求「减少动效」时才声明。

```css
/* src/css/button.css, trimmed to the parts that matter. No number appears in the file: every
   displacement, shadow tier, ring and duration is a slot declared once in 00-base.css. */
:is(button, .bn-button) {
  border-width: var(--bn-border-width);
  border-color: var(--_border-rest);
  box-shadow: var(--_shadow-rest);
}

@media (hover: hover) {
  :is(button, .bn-button):hover {
    transform: translate(var(--_lift-x), var(--_lift-y));
    box-shadow: var(--_shadow-hover);
    border-color: var(--_border-hover);      /* colour only — never a width */
  }
}

:is(button, .bn-button):active {
  transform: translate(var(--_press-x), var(--_press-y));
  box-shadow: var(--_shadow-press);
}

:is(button, .bn-button):focus-visible {
  outline: var(--_focus-ring);
  outline-offset: var(--_focus-ring-offset);
}

@media (prefers-reduced-motion: no-preference) {
  :is(button, .bn-button) {
    transition: transform var(--_motion), box-shadow var(--_motion);
  }
}
```

### 覆盖它

两个旋钮，都不需要 `!important`。写不分层的 CSS 就直接赢，因为库发布的每条规则都在级联层里
（ADR-0006）。或者在 `:root` 上改一个令牌：`--bn-main` 重绘默认按钮，`--bn-shadow-x` 同时缩放
每一档阴影与悬停位移，`--bn-press` 设定按钮下沉的幅度。令牌必须改在 `:root` 上——派生令牌在它被声明
的地方就已经替换完毕，所以把同样的声明写在页面中间的某个包裹元素上什么也不会发生。
