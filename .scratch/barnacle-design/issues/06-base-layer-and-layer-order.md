# 06: 基础层与层顺序契约

**What to build:** 裸语义 HTML 一进来就是 Neubrutalism 的样子。不写任何类名，`h1`–`h6`、段落、列表、引用、代码、分隔线、高亮就各自站对了位置。这是「语义优先」的第一次真实验证。

**Blocked by:** 05

**Status:** resolved

- [x] `00-base.css` 第 1 行是 `@layer` 声明，层顺序与 01 号票的层清单一致（ADR-0006）
- [x] 裸 `h1`–`h6`、`p`、`ul`/`ol`、`blockquote`、`code`、`pre`、`hr`、`mark` 直接呈现正确排版与外观
- [x] `body` 拿到背景色、前景色、字体族与字重
- [x] 样式不依赖 JS：无脚本时外观完整正确（§3 不变量 6）
- [x] 未压缩产物中无 `!important`
- [x] 文档站出现「Typography」页，用一个代码围栏展示全部裸元素

**验证方式**

1. 在禁用 JavaScript 的浏览器里装载该页，确认外观完整。
2. 确认未压缩 CSS 的第 1 行仍是 `@layer` 声明，且层顺序与 01 号票记录的清单逐项一致。
3. 在页面里覆盖一个颜色令牌，确认无需 `!important` 即可生效（层顺序可被使用者覆盖）。

## Answer

分支 `ticket/06-base-layer`（基于 `feat/barnacle-v1` 的 `da2e9ba`）。改写 `src/css/00-base.css`（2 行占位 → 252 行），新增 `content/components/typography.md` 与 `scripts/verify-base.mjs`（35 项断言），`package.json` 加一条 `verify:base`，重建并提交四份产物中的两份 CSS（`static/barnacle.js` / `.min.js` 未变，未改动）。

### `00-base.css` 结构概要

第 1 行仍是 `@layer theme, base, components, animations, utilities;`（构建链要求声明落在这份源文件的第 1 行；本文件不写任何其它 `@layer`）。正文分 10 节：

| 节 | 内容 |
|---|---|
| 1 | `:root` 的交互几何单一来源（原文见下） |
| 2 | `:focus-visible { outline: var(--_focus-ring); outline-offset: var(--_focus-ring-offset) }` —— 全局一条，因此裸 `a` 天然被覆盖，没有 `a:focus-visible` 这类重复规则 |
| 3 | `body`：`background` / `color` / `font-family` / `font-weight` / `font-size: 1rem` / `line-height: 1.6` + `-webkit-text-size-adjust` |
| 4 | `:is(h1,…,h6)` 共享 display 字体、`--bn-font-weight-heading`、`line-height: 1.15`、`letter-spacing: -0.02em`、`text-wrap: balance`；逐级 `font-size` = 2.5 / 2 / 1.625 / 1.25 / 1.125 / 1rem（严格递减） |
| 5 | `p`：`margin-block: 0 1em`、`max-inline-size: 68ch` |
| 6 | `ul, ol` 的 `padding-inline-start: 1.5em` 与下边距；`ul { list-style-type: square }`；`:is(ul, ol) :is(ul, ol)` 嵌套收紧；`li + li` 间距 |
| 7 | `blockquote`：`border-inline-start: calc(var(--bn-border-width) * 2) solid var(--bn-main)`（逻辑属性）+ `--bn-secondary-background` + italic |
| 8 | `code`（`--bn-font-mono`、`0.9em`、`--bn-secondary-background`、1px 发丝边）与 `pre`（`--bn-border-width` 边、`--bn-radius`、`--bn-shadow-sm`、`overflow-x: auto`）+ `pre code` 复位 |
| 9 | `hr`（`border-block-start: var(--bn-border-width) solid var(--bn-border-color)`）、`mark`（`--bn-main` / `--bn-main-foreground`） |
| 10 | 裸 `a`：`color: var(--bn-foreground)`、`text-decoration-line: underline`、2px 下划线、`transition … var(--_motion)`；`@media (hover: hover)` 内 `background-color: var(--bn-main)` + `color: var(--bn-main-foreground)` |

**§4 的 10 个几何变量实际声明原文**（`:root`，逐字来自 orchestrator-decisions §4）：

```css
--_lift-x: calc(var(--bn-shadow-lift) * -1);
--_lift-y: calc(var(--bn-shadow-lift) * -1);
--_press-x: var(--bn-press);
--_press-y: var(--bn-press);
--_shadow-rest: var(--bn-shadow-md);
--_shadow-hover: var(--bn-shadow-lg);
--_shadow-press: none;
--_focus-ring: 3px solid var(--bn-ring);
--_focus-ring-offset: 3px;
--_motion: var(--bn-transition);
```

同一个 `:root` 里还按 recipes §2.3 与 **05 号票 Answer 第 34 行的登记**（「这 11 个共享几何变量由 06 号票在 `00-base.css` 的 `:root` 建立」）声明了边框/表面默认槽位，使 07 号票可直接粘贴 recipes §4.2 的模板（那 4 行里的 `var(--_border-hover)` 没有兜底值）：

```css
--_border-rest: var(--bn-border-color);
--_border-hover: var(--bn-border-color);
--_border-press: var(--bn-border-color);
--_surface: var(--bn-secondary-background);
--_surface-hover: var(--bn-secondary-background);
--_surface-press: var(--bn-secondary-background);
```

`base` 层除这 16 个之外不声明任何 `--_` 变量（断言锁定），也没有任何一处 `transform` / `box-shadow` / `outline` / `transition` 的值里出现数字。

### 验证方式 1–3 的实测结论

命令与读数（全部在本 worktree 内、每次 `workdir` 显式指定）：

1. **产物与层顺序**：`npm run build` → `build ok: 4 artifacts from 20 css files, 0 warnings, 0 errors`；`static/barnacle.css` = 15509 B（sha256 前缀 `18C634470053`）、`barnacle.min.css` = 4562 B（`0F1CCBB98FAF`）。`node scripts/verify-base.mjs` **35/35 PASS**，其中：
   - 未压缩/压缩产物第 1 行都是 `@layer theme, base, components, animations, utilities;`，声明里的层序列逐项等于 ADR-0006 清单；
   - 产物里 20 个 `/* src/css/<file> (@layer <layer>) */` 块与 `CSS_MANIFEST` 的顺序、层归属逐条一致，5 个层全部被使用；
   - **把全部 `@layer <name> { … }` 块从产物里剥离后，剩余文本里没有 `{`** —— 即本库不贡献任何未分层规则，这是「未分层使用者 CSS 天然赢」的前提；
   - 两份产物 + `00-base.css` 源码里都没有 `!important`；
   - 10 个几何槽位的**值逐字等于**决策文件；脚本再把 `var()` 链完整展开成算术求值（不是照抄源码）：基线 `--_lift-x = -2px`、`--_press-x = 3px`；把 `--bn-shadow-x/-y` 覆盖成 `8px` 后 `--_lift-x = -4px`、`--_press-x` 仍是 `3px`、`--_shadow-rest = 8px 8px 0 0 <色>`、`--_shadow-hover = 12px 12px 0 0 <色>`、`--_shadow-press = none`；把 `--bn-transition` 改成 `400ms linear` 后 `--_motion` 跟着变；
   - `:focus-visible` 的 `outline` / `outline-offset` 分别读 `--_focus-ring` / `--_focus-ring-offset`，且存在一条全局 `:focus-visible` 覆盖裸 `a`；全库无 `outline: none`。
2. **无脚本完整性 + 覆盖生效（浏览器，临时探针）**：见下节，13/13。
3. **未分层覆盖**（浏览器实测）：`--bn-main: #FF3EA5` 写在**未分层**的 `<style>` 里，`mark` 的 computed `background-color` 从 `rgb(255,210,63)` 变成 `rgb(255,62,165)`；另一条未分层的 `h1 { font-size: 12px }` 把 h1 从 40px 压到 12px，而 h2 仍是 32px。两条都没有 `!important`。

### 站点实测（Typography 页）

- 内容文件：`content/components/typography.md`（UTF-8 无 BOM，frontmatter 只有 `title: "Typography"` + `description`），正文 = 一句引导语 + **一个** 标准 ```html 围栏（全程无 `class=` 属性），**无 H2**，**无尾斜杠链接**。
- `& "D:\sdk\seite\seite.exe" build --dir . --strict` → **EXIT=0**，`✓ Built 1 components, 2 pages in 0.0s (5 static files copied, 1 public files copied)`，输出无 broken / missing / warning 字样（已作为断言固化）。
- `& "D:\sdk\seite\seite.exe" check --dir . --strict` → **EXIT=0**，`✓ No problems found`。
- 索引页：`dist/components/index.html` 里出现 `href="https://ivan112058.github.io/barnacle/components/typography"`（**无尾斜杠**，符合决策 §7），条目名 `Typography`；落地页 `dist/components/typography.html` 有 `<h1…>Typography`、有 `<pre>`，围栏内容以实体转义（49 个 `&lt;`）且**没有任何 `<h2>`–`<h6>` 标签泄漏到页面**（即当前渲染层不会把围栏当活标记注入；04 号票换成预览/代码双标签后这条断言仍然成立）。

### 浏览器抽查（临时，未写进 `package.json`）

在 worktree 之外（`%TEMP%\bn-06-browser-check.mjs` + `%TEMP%\bn-06-uhaiin\`）用临时安装的 `playwright-core@1.64.1`（`npm i --no-save --no-package-lock`，package.json / package-lock.json 未被改动）+ 本机 Chrome（`channel: 'chrome'`）跑一次性探针，页面只加载 `static/barnacle.css`。**13/13 通过**，读数：

| 检查 | 读数 |
|---|---|
| **`javaScriptEnabled: false`** 下装载 | h1 有真实盒 `1264×46`，截图正常（重标题、方点列表、黄引用条、硬阴影代码块、黑 hr、黄 mark） |
| body | `rgb(255,253,245)` / `rgb(0,0,0)` / `system-ui…` / weight `500` / `line-height 25.6px` |
| 标题尺度 | h1 `40px` `letter-spacing -0.8px` weight `700`，h2 `32px`，h6 `16px` |
| 嵌套列表标记 | `ul ul > li` 的 `list-style-type` = **`square`**（UA 表的 circle 被作者来源压过） |
| `code` / `pre` | `ui-monospace…`；`pre` 底 `rgb(255,255,255)` ≠ 页面底；边框 `3px`（`code` 1px）；`box-shadow: rgb(0,0,0) 2px 2px 0px 0px`；`overflow-x: auto` |
| `blockquote` / `hr` / `mark` | 引用条 `6px` + 白底 italic；hr `3px rgb(0,0,0)`、`margin 32px`；mark `rgb(255,210,63)` 上的 `rgb(0,0,0)` |
| 裸 `a` | `text-decoration-line: underline`、`box-shadow: none`、`transform: none` |
| 键盘 Tab | `outline: 3px solid rgb(116,185,255)`、`outline-offset: 3px` |
| `<html data-theme="dark">` | body `rgb(26,26,26)`、`pre` `rgb(38,38,38)`、hr `rgb(255,253,245)`、`pre` 阴影翻白 |
| 未分层覆盖 | `--bn-main` 覆盖 → mark `rgb(255,62,165)`；未分层 `h1 { font-size: 12px }` → h1 12px，h2 不受影响 |
| 几何槽位 | `<html>` 上 `--_lift-x` = `calc(calc(4px / 2) * -1)`，`document.documentElement.style.setProperty('--bn-shadow-x','8px')` 后 = `calc(calc(8px / 2) * -1)`；而 `--bn-shadow-x: 8px` 写在包裹 `div` 上时槽位仍是 `calc(calc(4px / 2) * -1)`（复现 05 号票记录的替换语义，见决策 §8） |

### 证伪性自查（确认新断言不是同义反复）

在临时探针里把 `00-base.css` 逐条改坏、`npm run build` 后跑 `verify:base`，**7/7 全部被捕获（每次 exit 1）**：把 `--_lift-x` 冻结成 `-2px`；给 `mark` 写死 `#FFD23F`；删掉 `:focus-visible` 规则；把 `list-style-type` 改成 `circle`；给 `hr` 加一个 `!important`；把 heading 的 `font-weight` 内联成 `700`；给 `body` 加 `box-shadow: 4px 4px 0 0 black`。恢复源码重建后四份产物与基线 **byte-identical**。

### 与既有文档/决策的偏离与说明（给 07/09 与协调代理）

1. **裸 `a` 不做按钮形态**（决策 §3 决策 A）：base 层只给它链接外观 + 焦点环，无 `box-shadow` / `transform`（已由断言锁死）。按钮形态走 `.bn-button`（07 号票）。
2. **基础层不承载裸 `button` 的悬停-按下几何**：决策 §4 定案「06 声明变量、07 消费、09 审计」，recipes §4.2 方案 B 也要求组件在自己的文件里写四态。因此本票只交付 **16 个槽位 + 一条全局焦点环**，`translate()` 与四态阴影规则留给 07。**07 号票直接引用这 16 个名字即可，不要重写数值**；`--_border-*` / `--_surface*` 已有默认值，需要换档时只需在自己的选择器上覆盖。
3. `:root` 里是 **16 个** `--_` 槽位而不是决策 §4 列出的 10 个：§4 的 10 个是「交互几何」，另 6 个是同一份单一来源里的边框/表面默认档位，来源是 recipes §2.3 与附录 A，并且 05 号票的 Answer 已明确登记为 06 的交付物。§4 的 10 个值逐字未改。
4. **排版尺度与 `code` 的 1px 发丝边是刻意保留的字面量**：spec §6 只给了字体族/字重令牌，没有字号令牌（recipes §9.2 明说），所以 `verify:base` 只禁止「颜色字面量」与「几何属性里的数字」，不禁止排版尺度里的 rem/em。1px 发丝边让内联代码不读成一个组件；外层代码块才用 `--bn-border-width`。
5. **未重置 `body` 的外边距、也未加全局 `box-sizing` 重置**：本票清单只列了背景/前景/字体族/字重/行高（recipes §9.2 的 `body` 块同样没有）。使用者的未分层 CSS 可以随意接管这两项，且天然赢过 base 层。
6. **未改 README**：05 号票新增 `verify:theme` 时也没有改（`scripts/` 行至今只列了三个脚本），为降低并行 worktree 的冲突面，本票同样不动；`npm run verify:base` 可从 package.json 发现。
7. **注释里刻意不出现 `!important` / `esbuild` / `node_modules` / `prefers-color-scheme` 这些字样**：01 与 05 的断言扫的是**原始产物文本（含注释）**。第一版注释里写了 "No `!important`"，被 05 号票的断言抓到（`verify-theme` 当时 15/16，失败项 `the theme layer defines no colours outside 01-theme.css`），改掉注释后 16/16。这是本票真实踩到的坑，后续「不许删改已有断言」的票请注意。

### 未验证项 / 留给后续票

- 「未压缩 CSS 可被未分层使用者规则覆盖」在**真实整页**上的验证是 08 号票的验收台职责；本票只做了临时探针（上表两行）与产物级的「零未分层规则」断言。
- 04 号票交付预览/代码双标签后，`content/components/typography.md` 的围栏会从「高亮 `<pre>`」变成双标签界面；本票的断言刻意写成「围栏内容被转义且没有标题标签泄漏」，所以两边都能过。
- 07 号票落地后需要复核：`--_lift-*` / `--_shadow-*` / `--_focus-ring` 在真实组件上的 computed 值（本票只验证了 `:root` 槽位本身的派生与浏览器读取值）。
- 09 号票的收敛审计应把「base 层是唯一声明 `--_` 数值的地方」作为回归依据；本票的 `the geometry block is the only --_ declaration site in the base layer` 与 `no geometry property in the base layer carries a numeric literal` 两条断言就是这条不变量的现成检查。

## Resolution

Resolved on the integration branch `feat/barnacle-v1` at commit b8d230f.
Closing convention: this tracker has no "done" label, so `Status: resolved` plus the ticked checklist above records closure (see `docs/agents/issue-tracker.md`).
Verify with: `npm run verify:base`
