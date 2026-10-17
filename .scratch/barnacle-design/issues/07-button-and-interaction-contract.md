# 07: Button 与交互契约

**What to build:** 库的第一个组件，也是整套交互几何的定义处。裸 `button` 与 `a` 呈按钮外观，悬停上浮、按下落回、焦点环可见且不吞掉硬阴影。**到这一步 Neubrutalism 风格是否成立即可见分晓。**

**Blocked by:** 06

**Status:** resolved

- [x] 裸 `button` 与 `a` 呈按钮外观；`.button` 类名保留给无语义锚点的场合（ADR-0001）
- [x] 交互几何完整：静止用中档阴影、悬停按 `--bn-shadow-lift` 上移并放大阴影、按下朝阴影方向落下且阴影收拢
- [x] 焦点用 `outline` + `outline-offset` 实现，画在硬阴影之外（ADR-0003）；**绝不出现 `outline: none` 而无替代**
- [x] `prefers-reduced-motion: no-preference` 块内限定动效，事后禁用不算
- [x] 语义变体走 `data-variant`，视觉修饰走 `bn-` 类名（描边 / 幽灵 / 尺寸 / 禁用），两者不混用
- [x] 悬停只改边框颜色，**绝不改边框宽度**
- [x] 按钮组就位
- [x] 无脚本时外观完整，仅失去交互
- [x] 文档站出现「Button」页，含可运行示例与 `data-variant` 选项说明

**验证方式**

1. 在页面上悬停与按下，确认位移距离与阴影增量相等（物体真的「抬离」阴影）。
2. 键盘 Tab 到按钮，确认焦点环完整可见、且没有被厚边框或阴影吞掉。
3. 把系统动效设为「减少动态效果」，确认动效消失而外观不变。
4. 逐项确认悬停前后边框宽度计算值一致。
5. 08 号票的浏览器验收台会把这些不变量固化成断言，本票先手工确认一遍。

## Answer

分支 `ticket/07-button`（基于 `feat/barnacle-v1` 的 `327178b`，收尾前 `git merge feat/barnacle-v1` 拿到 `de4d983`）。改动：`src/css/button.css`（1 行占位 → 20 条规则，产物里 272 行）、整页替换 `content/components/button.md`、新增 `scripts/verify-button.mjs`（21 项断言）+ `package.json` 一条 `verify:button`。四份产物重建后只有两份 CSS 变化（`static/barnacle.js` / `.min.js` 与基线 byte-identical）。`playwright-core@1.64.1` 用 `npm i --no-save` 临时装，**未写进 `package.json`**（08 号票的事）。

### `button.css` 结构与命名（后续组件票请照抄）

| 节 | 内容 |
|---|---|
| 1 | `:is(button, .bn-button)` 一条形状规则：表面槽位、`display: inline-flex`、`min-block-size: 2.5rem`、`padding: 0.625rem 1.25rem`、`border-width: var(--bn-border-width)`、`border-color: var(--_border-rest)`、`border-radius: var(--bn-radius)`、`box-shadow: var(--_shadow-rest)`、字体/`text-decoration: none`/`user-select: none` |
| 2 | 尺寸轴（外观=类名，决策 B）：`.bn-sm` / `.bn-lg`（中档无类）、`.bn-icon`（正方形 + `> svg` 跟随字号） |
| 3 | 语义轴（只有 `data-variant`）：`success`/`warning`/`danger`/`error` 把 `--_variant-color` 落到 `--_surface*`；`secondary` 就地取 `--bn-secondary-background` + `--bn-foreground`（不碰 `--_variant-color`） |
| 4 | 外观修饰：`.bn-outline`（透明底 + 当前语义色边框/文字 + 阴影降一档）、`.bn-ghost`（阴影/边框/位移全部归零：覆写 `--_shadow-*: none`、`--_lift-*`/`--_press-*: 0`、`--_border-*: transparent`） |
| 5 | 四态：`@media (hover: hover)` 内 `:hover`、`:active`、`:focus-visible`，以及 `@media (prefers-reduced-motion: no-preference)` 内的 `transition` |
| 6 | 按钮组：`.bn-button-group`（`flex`、`gap: 0.75rem`）与附加形态 `.bn-attached`（`gap: 0` + 相邻 `margin-inline-start: calc(var(--bn-border-width) * -1)`） |
| 7 | 禁用：`:is(:disabled, [aria-disabled="true"])`，换中性表面 + `--bn-foreground` + `cursor: not-allowed` + `opacity: 0.6`（结构、边框、阴影都留着，不是只降对比度） |

**为后续组件票引入的 `bn-` 类名约定（最终名）**：`.bn-button`（无语义锚点取按钮形态）、`.bn-outline`（描边）、`.bn-ghost`（幽灵）、`.bn-sm` / `.bn-lg`（尺寸，中档无类）、`.bn-icon`（方形图标按钮）、`.bn-button-group` + `.bn-attached`（按钮组 / 贴合形态）。全部 `bn-` 前缀，全部只表形态；`success`/`warning`/`danger`/`error`/`secondary` 只走 `data-variant`。

几何与不变量：只读 06 在 `:root` 声明的 16 个 `--_` 槽位（覆写 13 个、读 17 个，含 `--_variant-color`），组件文件里 **0 个位移/阴影数值**；`translate()` 只出现 2 次且都以 `var(--_` 开头；5 条状态规则只允许改颜色与几何（由脚本白名单锁死）；**全文件没有一条 `transform: none`** —— 禁用态不是"取消"位移，而是状态规则一律 `:not(:disabled):not([aria-disabled="true"])` 守门，位移根本不施加（顺带把 09 号票的「没有任何规则取消 transform」变成可 grep 的事实）。

### 四条验证方式（`npm run verify:button`，21/21，exit 0）

系统 Chrome 155.0.8059.82（`channel: 'chrome'`, `headless: true`）、随机端口本地 HTTP、只服务产物 `static/barnacle.css`（`src/` 不可达），断言前用 `addInitScript` 冻结 `transition`/`animation`；焦点一律真键盘 `Tab`。

1. **几何（悬停/按下）**：静止 `box-shadow: rgb(0, 0, 0) 4px 4px 0px 0px`（模糊与扩展半径读数为 0）、`transform: none`、四边 `3px`、`display: inline-flex`；悬停 `transform: matrix(1, 0, 0, 1, -2, -2)` + `box-shadow: rgb(0, 0, 0) 6px 6px 0px 0px`，**增量 2px = `--bn-shadow-lift`**（用探针元素 `inline-size: var(--bn-shadow-lift)` 解析出 `2px`，不是照抄源码），并额外断言**阴影留在原地**：`4 + 0 === 6 + (-2)`；按下 `matrix(1, 0, 0, 1, 3, 3)` + `box-shadow: none`（朝阴影方向、阴影收拢，且 3px ≠ 4px 是决策 E 的有意差值）。同一等式在 `.bn-outline` 上以低一档复现：`2px → 4px`，`2 + 0 === 4 + (-2)`。
2. **键盘焦点**：真键盘 Tab 命中 `:focus-visible`，`outline-style: solid` / `outline-width: 3px` / `outline-offset: 3px` / `outline-color: rgb(116, 185, 255)`，**同时** `box-shadow` 仍是 `rgb(0, 0, 0) 4px 4px 0px 0px`（硬阴影没被吞掉）。
3. **reduced motion**：`reducedMotion: 'reduce'` 的页面 `transition-duration: 0s`（且 `matchMedia` 自证为 reduce），而外观不变——悬停后仍读到 `matrix(1, 0, 0, 1, -2, -2)` + `6px 6px`；默认页面读到 `transition-property: transform, box-shadow, background-color, border-color`、`transition-duration: 0.15s ×4`。
4. **边框宽度**：静止 / 悬停 / 按下 / 键盘焦点 / `.bn-outline` / `.bn-ghost` / `data-variant="danger"` / `.bn-sm` / `.bn-lg` / `:disabled` / `[aria-disabled]` 共 **11 个状态 × 4 边全部 `3px`**，悬停前后逐项相等。

额外覆盖（都属于 ticket 勾选项）：静止值来自**裸 `<button>`**（无类名）；`.bn-button` 用在 `<a>` 上拿到同一形状且 `text-decoration: none`，而**裸 `a`** 是 `box-shadow: none` + `transform: none` + `underline`（决策 A 实测）；`data-variant="danger"` 表面 `rgb(255, 107, 107)`、`secondary` `rgb(255, 255, 255)`，边框/阴影/盒模型不动；`.bn-sm`/`.bn-lg` 14px/18px 且边框不变；`.bn-icon` 40×40；禁用态悬停不抬起；按钮组 `gap 12px`，`.bn-attached` 接缝为 `-3px`（重叠成单线，**这里发现并修掉了配方的一处遗漏：附加形态必须 `gap: 0`**，否则负 margin 只把 12px 吃到 9px，接缝并不重叠）；`javaScriptEnabled: false` 下（页面零 `<script>`）静止几何、变体、幽灵、按钮组、禁用态与 Tab 焦点环全部成立。

### 证伪自查（4 组，逐条指名不变量，全部已撤回）

撤回后 `npm run build` 重建的 `static/barnacle.css` / `.min.css` 与提交的产物 **byte-identical**（`git status` 只剩脚本本身的改动）。

| 破坏 | 结果 |
|---|---|
| 悬停加 `border-width: 5px` | **19/21，exit 1**：`the border box is declared once and no state rule can change it (spec §3 invariant 7) — … :hover { border-width: 5px }` + `verification 4 … (spec §3 invariant 7): hover.borderTopWidth = 5px …`（静态与浏览器两层同时红） |
| 组件里写死 `--_lift-x: -1px` | **17/21，exit 1**：`a slot may only be pointed at a token or zeroed on purpose: :is(button, .bn-button) { --_lift-x: -1px }` + `hover transform must be … read matrix(1, 0, 0, 1, -1, -2)` + `the outline shadow must stay planted: 2 + 0 vs 4 + -1` |
| `.bn-outline` 悬停改到 lg 档 | **20/21，exit 1**：`a hovered .bn-outline rises to the md tier, read rgb(0, 0, 0) 6px 6px 0px 0px`（这条正是"阴影增量 = 位移量"的等式断言） |
| 把 `transition` 挪进 `@media (prefers-reduced-motion: reduce)` | **19/21，exit 1**：`transition declared outside the no-preference block` + `with reduced motion no transition may be declared, read transition-duration: 0.15s, 0.15s, 0.15s, 0.15s`（"事后禁用不算"被两层锁死） |

过程中脚本自身也真的抓到过红：第一版把 `--_variant-color` 误判成"自造内部变量"、`readGeometry` 用 `Number('4px')` 得到 `NaN` 让增量等式失效、`transition` 块一度漏写、`tabTo` 在鼠标点击后从按钮位置继续 Tab。四处都是修脚本/修实现后转绿，读数即上表。

### 回归（合并 `feat/barnacle-v1` 后）

`verify` 21/21、`verify:theme` 16/16、`verify:site` 24/24、`verify:base` **35/35**（合并前是 34/35，失败项是集成分支正在修的过期断言 `the built Typography page carries the fence as escaped code` —— 该断言的 `/<h[2-6][\s>]/` 会命中模板自己注入的 `<h2 class="site-component__section">`，与本票无关；`git merge feat/barnacle-v1` 拿到 `de4d983` 后 35/35）、`verify:demo` 19/19、`verify:deploy` 12/12，全部 exit 0。

### 文档站「Button」页

`content/components/button.md`（UTF-8 无 BOM）：**3 个标准围栏**（2 个 `html` → 预览/代码双标签，1 个 `css` → 保持普通代码块，维持 04 号票渲染层的既有断言 `demos === 2` / `plainFence === 1`）、**正文无 H1/H2**（只有 H3：Variants / Appearance / Interaction / Overriding it）、**无尾斜杠链接**、无短代码、围栏外无原始 HTML。围栏 1 = 形状（裸 `<button>` + `.bn-button` 的 button 与 anchor）；围栏 2 = 变体与外观修饰 + 按钮组；围栏 3 = `button.css` 的契约摘录（明说是 trimmed，避免把文档写成谎话）。旧页里那段演示用 `<style>` 已删除：`verify-demo` 的浏览器断言现在读到的是**库产物**提供的 `4px 4px 0 0 rgb(0,0,0)` + `3px` 边框。`seite build --strict` / `seite check --strict` 均 EXIT=0。

### 与既有决策/配方的偏离

1. **`.bn-button` 而不是 ticket 字面写的 `.button`**（ADR-0005 的 `bn-` 前缀要求，决策 §1 已明说以 ADR-0005 为准）。
2. **裸 `a` 不做按钮形态**（决策 A）：裸 `a` 保持链接，`.bn-button` 用在 `<a>`/`<span>`。理由与可用性事故同决策 A；已用计算样式断言锁死。
3. **尺寸走 `bn-` 类名**（决策 B：`.bn-sm`/`.bn-lg`，中档无类），不用 `[data-size]`。
4. **`.bn-outline` 的悬停档位修正**：recipes §10 让 outline 静止 sm、悬停直接跳 lg（+4px），会破坏"阴影增量 = 位移量"的硬等式；改为悬停 md（+2px = lift），阴影仍然留在原地。"阴影增量 = 位移量"这条等式已作为断言，09 号票收敛时请一并保住。
5. **`.bn-attached` 补 `gap: 0`**（同上，recipes 遗漏）。
6. **`input[type="submit"|"reset"|"button"]` 不纳入本票**：spec §8 的 Button 锚点是"裸 `button`、`a`"；若纳入，本文件每条规则都要重复一个五分支 `:is()` 列表，否则 input 会以更高特异性压掉自己的变体与尺寸规则。留给 Form 号票（recipes §10 的这段推断不在本票清单里）。
7. 本票**没有新增 `--_` 槽位**，只覆写 06 的 16 个；`--_variant-color` 只读不写（脚本禁止组件声明它）。

### 未验证项

- 只在 headless 系统 Chrome 155 上验证；**没有真触屏设备**验证 `@media (hover: hover)` 不匹配时的粘滞规避（决策 D），也没有做屏幕阅读器 / axe 检查。禁用态只是粗算（60% 不透明度黑字落在白表面上对比约 5.7:1），没有正式跑对比度工具。
- **暗色主题下没有跑按钮断言**：本票的验收焦点是几何；`--bn-shadow-color` 翻白链已在 05/06 实测（`html[data-theme="dark"]`），08 号票的验收台会覆盖暗色。
- 没有视觉/像素级截图回归（只有计算样式与 `.bn-icon`、按钮组的 bounding box 读数）；没有断言 `.bn-icon` 内 `svg` 的实际渲染尺寸。
- `tests/browser/` 验收台与 `playwright-core` 入 `package.json` 仍是 08 号票职责；本票的脚本在未安装 `playwright-core` 时会把这 11 项标 SKIP 并让静态断言继续把守 exit code（本次运行 **0 skipped**，浏览器 11 项全部真跑）。

## Resolution

Resolved on the integration branch `feat/barnacle-v1` at commit b8d230f.
Closing convention: this tracker has no "done" label, so `Status: resolved` plus the ticked checklist above records closure (see `docs/agents/issue-tracker.md`).
Verify with: `npm run verify:button`
