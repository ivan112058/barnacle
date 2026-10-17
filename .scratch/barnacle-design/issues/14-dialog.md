# 14: Dialog

**What to build:** 原生 `dialog` 呈现 Neubrutalism 外观：厚边框、硬阴影、遮罩层有足够的明暗对比，入场动画受动效守卫。

**Blocked by:** 09

**Status:** resolved

- [x] 原生 `dialog` 呈正确外观，`::backdrop` 用 `--bn-overlay` 或等价的令牌表达
- [x] 入场动画写在 `prefers-reduced-motion: no-preference` 块内
- [x] `showModal()` 下焦点行为正常：打开时焦点进入对话框，关闭后回到触发元素
- [x] 硬阴影与边框在遮罩之上仍然成立，不被遮罩吞掉
- [x] 无脚本时 `<dialog open>` 仍以正确外观呈现
- [x] 文档站出现「Dialog」页，含可打开与关闭的示例

**验证方式**

1. 打开与关闭对话框，确认焦点去而复返。
2. 打开「减少动态效果」，确认入场动画消失。
3. 在暗色下确认遮罩与对话框本体的对比足够。
4. 禁用 JavaScript，确认带 `open` 属性的对话框外观正确。

## Answer

分支 `ticket/14-dialog`，基于 `feat/barnacle-v1`（合并时对方 tip 已到 `7e6e1d1`）。实现提交 `ac3b7f6`，合并提交 `de09e78`。

### 交付物

- `src/css/dialog.css`（4 条规则）：`dialog` 的框（`box-sizing: border-box` + `--bn-background` 面 + `var(--bn-border-width)` 结构边框 + `var(--bn-shadow-lg)` 浮层档 + `min(32rem, 100vw-2rem)` / `max-block-size: 100dvh-2rem` / `overflow: auto`）、`dialog:not(:modal)` 的回流、操作行、`:last-child` 的外边距归零。
- `src/css/animations.css`（本票拥有的共享文件）：`bn-fade-in-up` 原样复用（未复制第二份），新增 `@keyframes bn-fade-in`；`dialog[open]` 与 `dialog[open]::backdrop` 两条入场规则，连同既有 dropdown 规则一起全部在 `@media (prefers-reduced-motion: no-preference)` 内；`dialog::backdrop { background-color: var(--bn-overlay) }` 在每个媒体查询之外（遮罩不是动效，reduce 下也必须存在）。
- `content/components/dialog.md`：两个 html 围栏（可打开/关闭的原生示例 + `<dialog open>` 无脚本示例）+ 「聚焦去而复返」「遮罩」「reduce」「覆盖」四节，含实测对比度读数表。
- `scripts/verify-dialog.mjs` + `package.json` 的 `verify:dialog`：9 项静态 + 6 项真 Chrome，共 15/15。

### 声明式打开的实测结论（可用的那条路）

- `'command' in HTMLButtonElement.prototype` → **true**；`commandfor` 作为 HTML 属性可解析（`HTMLButtonElement.prototype.commandFor` 这个 IDL 拼写是 false，属性本身工作）。`CSS.supports('selector(:modal)')` → true。系统 Chrome 155.0.8059.82。
- 因此文档示例用**零 JS**：`<button commandfor="dlg-invite" command="show-modal">` 打开，`<form method="dialog">` 的 submit 或 `command="close"` 关闭。
- 这条路线在文档站的预览面板里也成立：`verify:dialog` 的最后一项把 `dialog.md` 里的围栏原文用 `template.innerHTML` 注入空 `#panel`（与 `static/site.js` 同一条路径）后点击，`open: true, modal: true`；围栏里的 `<script>` 惰性这件事因此不影响示例。
- 退化路径写进文档：不支持 `command` 的浏览器里触发器只是惰性，同一个对话框用 `dialog.showModal()` 打开。

### 焦点去而复返（方式与读数）

方式：真 Chrome，点击声明式触发器 → 读 `document.activeElement`；再分别用①`<form method="dialog">` 的 submit、②`command="close"` 按钮、③`Escape` 三条路关闭，每次都读回焦点。

- 打开后：`activeElement = #confirm`（"Got it"）。对话框里 **"Cancel" 在文档顺序上更靠前**，所以这条读数同时证明 `autofocus` 胜过文档顺序，而不只是「焦点落在了第一个可聚焦元素上」。
- 三条关闭路径的 `activeElement` 都是 `#trigger`（"Invite someone"）。
- 静态断言兜住约定：`dialog.md` 的示例必须含 `autofocus` 的按钮，否则 `verify:dialog` 直接红。

### `::backdrop` 的令牌来源

- 静态：`::backdrop` 只有一条 `background-color` 声明，值是 `var(--bn-overlay)`，位于 `animations.css`，且 `conditions.length === 0`（不在任何媒体查询内）。
- 真 Chrome：`getComputedStyle(dialog, '::backdrop').backgroundColor` = `rgba(0, 0, 0, 0.8)`；在 `:root` 上把 `--bn-overlay` 改成 `rgb(12 34 56 / 0.5)` 后同一读数变成 `rgba(12, 34, 56, 0.5)` —— 证明它来自令牌而不是恰好同值的字面量。暗色主题下读数是 `rgba(0, 0, 0, 0.8)` 不变（spec §6.2 没有重设 `--bn-overlay`）。

### 硬阴影与边框在遮罩之上

- 计算值：打开状态下 `box-shadow = rgb(0, 0, 0) 6px 6px 0px 0px`（四个长度齐全、模糊 0、扩展 0、两轴等值 6px = 1.5 × 4px）、`border-top: 3px solid rgb(0, 0, 0)`、`background-color = rgb(255, 253, 245)`（= `--bn-background`，**没有被遮罩压暗**）、`position: fixed`。
- 像素级（开发期人工，Pillow 采样，未进 CI）：亮色下，对话框右/下偏移 6px 的阴影带像素是 `(0,0,0)`，同屏被遮罩压过的页面是 `(51,51,49)`；暗色下同两个点是 `(255,253,245)`，被遮罩压过的页面是 `(5,5,5)`。遮罩之上仍然成立，且暗色下阴影翻白。

### 无脚本 `<dialog open>` 的外观证据

- 上下文 `javaScriptEnabled: false`，服务端直出 `<dialog open>`：`display: block`、`position: relative`（回流，不是 UA 的 `absolute`）、`box-shadow = rgb(0, 0, 0) 6px 6px 0px 0px`、`border-top: 3px`、`background = rgb(255, 253, 245)`。
- 布局断言：对话框 box `(65, 188, 384, 896)`，紧随其后的段落 `top = 204`（> 188），**不重叠** —— 这正是 `dialog:not(:modal)` 存在的理由：UA 把非模态的 `open` 对话框绝对定位，后面的文字会钻到它下面。
- 构建产物里也验了：`dist/components/dialog.html` 的第二个预览面板里那个 `<dialog open>` 是 `open: true, modal: false, box-shadow: … 6px 6px 0px 0px`。

### 暗色对比度读数（对"被遮罩压过的页面"算 WCAG 比）

| 主题 | 对话框面 对 压过的页面 | 边框/墨色 对 压过的页面 |
|---|---|---|
| 亮 | 12.48 : 1 | 1.65 : 1 |
| 暗 | 1.17 : 1 | 19.99 : 1 |

结论：亮色靠"面"分离、暗色靠"边框与白影"分离，两套模式下承担分离的那一对都远高于 3:1 的非文本下限（断言 `max(两个比) >= 3`，两个读数都打印在 PASS 行里，不只是布尔）。

### 测试清单与全绿证据（合并 `7e6e1d1` 之后重跑）

| 命令 | 结果 |
|---|---|
| `npm test` | 78 pass / 0 fail，exit 0 |
| `npm run test:browser` | tests 11 / pass 11 / fail 0，exit 0 |
| `node scripts/verify.mjs` | 21/21，exit 0 |
| `verify:theme` | 16/16 |
| `verify:site` | 24/24 |
| `verify:base` | 35/35 |
| `verify:demo` | 19/19 |
| `verify:deploy` | 12/12 |
| `verify:button` | 21/21 |
| `verify:tabs` | 19/19 |
| `verify:toast` | 19/19 |
| `verify:dropdown` | 17/17 |
| `verify:interaction` | 15/15（本票的文件没有新增位移/状态规则，审计仍绿） |
| `verify:static` | 26/26 |
| `verify:table` | 34/34 |
| `verify:progress` | 17/17 |
| `verify:layout` | 22/22 |
| `verify:dialog`（本票新增） | **15/15** |
| `verify:site-shell`（合并进来的新票） | 9/9 |
| `npm run test:browser:mutations` | 11 mutants + 1 未变异对照，全部按设计变红，artifact sha256 未变 |
| `seite build --strict` | exit 0（`Built 15 components, 2 pages`） |
| `seite check --strict` | exit 0（`No problems found`） |

`npm run build`：4 份产物 0 warning，合并后重建与提交产物**零 diff**。

### 与设计笔记不同的两处（记录）

1. **浮层内按钮不归零 lift**。`component-style-recipes.md` §13 建议给 `dialog :is(button, .bn-button)` 把 `--_lift-*` 归零（"抬升像在抖"）。本票**不采纳**：那会让同一个 `.bn-button` 在浮层里和页面上的手感不同，等于给"单一交互契约"开一个只有实现者才知道的例外；而且归零 lift 却保留 hover 阴影档位会让影子独自长大，"位移与阴影同源"就破了。对话框里的按钮就是按钮。
2. **操作行收窄成"没有字段的 form"**：`dialog > form:not(:has(:is(input, select, textarea)))`。recipe 原文是 `dialog > form`，但那会把这个浮层里唯一体量的**表单型对话框**（登录、设置）的 fieldset 压成一行按钮 —— 那是布局事故，不是风格差异。`:has()` 不被支持时规则整条失效，退化结果是按钮按普通行内流排，可接受。

另外两处实测修正写进了 CSS 注释与文档：`box-sizing: border-box`（content-box 下 `max-block-size: calc(100dvh - 2rem)` 只约束内容盒，实测 800px 视口的对话框高 822px、上下各丢 11px）；入场规则用简写 `animation: bn-fade-in-up var(--_motion) both` 而**不是** longhand —— `--_motion` 展开成 `150ms ease` 两个分量，`animation-duration: var(--_motion)` 是 computed-value 时间无效、回落 `0s`（实测），简写才解析得开（实测 name/duration/fill = `bn-fade-in-up` / `0.15s` / `both`）。`verify:dialog` 把这条固化成断言：两个文件里出现 `animation-duration: var(...)` 即红。

### 仍未验证

- 只测了本机 system Chrome 155.0.8059.82。Firefox / Safari 未测：`command`/`commandfor`（文档已写明退化路径）、`:has()`（操作行，退化只是排版）、`dialog:not(:modal)` 依赖的 `:modal`（断言里有 `CSS.supports('selector(:modal)')` 前置检查，不支持时该检查直接红而不是静默走错分支）。
- 像素采样（阴影带、遮罩合成色）是开发期用 Pillow 人工测的，没有进 CI —— 仓库没有图像解码依赖，`verify:dialog` 只断言计算值。
- `tests/browser/` 没有为本票新增 fixture / 用例：本票的 6 项真 Chrome 断言放在自己的 `verify:dialog` 里（与 10/13/16 的惯例一致），`mutation-sweep` 因此还没有针对 dialog 的 mutant。
- 站点侧无需修复：`static/style.css` 没有作用于 `dialog` 的裸元素规则，预览面板里显示的就是库外观；`verify:site-shell` 的 20 页实测里 `components/dialog.html` 的页壳也被正确复位（shadow none / border 0 / padding 0）。

## Resolution

Resolved on the integration branch `feat/barnacle-v1` at commit b8d230f.
Closing convention: this tracker has no "done" label, so `Status: resolved` plus the ticked checklist above records closure (see `docs/agents/issue-tracker.md`).
Verify with: `npm run verify:dialog`
