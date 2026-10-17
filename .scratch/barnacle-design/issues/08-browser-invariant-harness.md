# 08: 浏览器不变量验收台

**What to build:** 一套能在浏览器里**实测计算样式**的验收台，让设计不变量变成可重复执行的断言，而不是靠肉眼。这是「必须实测，不得假设」（spec §14）在工程上的落点，也是 09 号票敢在重构后宣告「不变」的依据。

**Blocked by:** 07

**Status:** resolved

- [x] 验收台能启动本机已安装的 Chrome（`channel: 'chrome'`）——**不下载浏览器二进制**，本机已有 Chrome 与 `ms-playwright` 缓存
- [x] 测试在 `http://127.0.0.1:<port>` 上服务页面，**不使用 `file://`**（`file://` 下会有加载假失败）
- [x] 覆盖页面与库产物来自真实的构建产物，不手写 CSS 字面量
- [x] 断言用 `getComputedStyle` 读取计算值，**不做像素级截图比对**
- [x] 断言零 console error、零 page error
- [x] 三条防 flaky 约束写进验收台的公共前置步骤并在注释里说明原因：
  - **断言前冻结 `transition` 与 `animation`**——否则读到过渡中间值（实测曾读到 `4.04917px` 而非 `4px`）
  - **焦点断言必须用键盘 Tab 到达，且断言对象必须真可聚焦**——`element.focus()` 不触发 `:focus-visible`；对 `<div>` 断言焦点环是无效测试
  - **`:hover` 后所有读取合并进一次 evaluate**——穿插的 `$eval` 会打断 hover 状态
- [x] 验收台在 09 号票的交互契约抽取后**逐条重跑并全部通过**（含真实的 `:hover`，不是只测类名模拟）
- [x] 用它复现一次真实失败（临时破坏一条不变量，确认测试变红），证明它不是空跑

**已实测可断言的不变量**（探针 27/27 通过，可直接照搬）

| 不变量 | 断言读法 | 实测值 |
|---|---|---|
| §3.2 模糊与扩展半径为 0 | `getComputedStyle().boxShadow` | `rgb(0, 0, 0) 4px 4px 0px 0px` |
| §3.3 位移距离与阴影偏移同源 | 真实 `:hover` 后比对 `transform` 与阴影增量 | `matrix(1,0,0,1,-2,-2)` ↔ `4px→6px` |
| §3.7 hover 不改边框宽度 | hover 前后的 `borderTopWidth` / `borderLeftWidth` | 稳定在 `3px` |
| §7 焦点环用 outline 且不被吞 | 键盘 Tab 到 `<button>` | `solid 3px` + `offset 3px`，且硬阴影同时存在 |
| ADR-0006 层顺序是契约 | 未分层的使用者规则覆盖已分层规则 | 读到 `rgb(0, 128, 0)` |
| ADR-0004 不跟随系统暗色 | `newPage({ colorScheme: 'dark' })` 且无 `data-theme` | 仍读亮色 `#FFFDF5` |
| §6 一个令牌缩放三档 | 覆盖 `--bn-shadow-x: 8px` | md → `8px`、sm → `4px` |
| §7 动效守卫可模拟 | `newPage({ reducedMotion: 'reduce' })` | `animationName: none` |

**验证方式**

1. 逐条过一遍上表，确认全部从红转绿。
2. 故意把 `--bn-shadow-md` 的模糊半径改成 `1px`，确认验收台报错并指名该不变量。
3. 记录浏览器标识（`channel: 'chrome'` 的实际版本），作为后续票的回归基线。

## Answer

### 摘要

浏览器验收台落在 **`tests/browser/`**（不动 `scripts/verify*.mjs`，一行既有断言都没改）。跑的是**真实构建产物**：fixture 只有 markup，样式与脚本都从 `/barnacle/static/barnacle.css` / `barnacle.js`（即 `npm run build` 写出的 `static/*`）加载，HTTP 服务用 Node 内置 `http`、`127.0.0.1` + `listen(0)`、站点挂在 `/barnacle/` 子路径下；断言全部读 `getComputedStyle`，无一张截图。

| 文件 | 内容 |
| --- | --- |
| `tests/browser/expectations.mjs` | 期望值 = 独立事实源（spec §3/§6/§7 + ADR-0003/0004/0006 + 决策 §4/§8），注释写明出处，**绝不从 CSS 反推** |
| `tests/browser/harness.mjs` | 静态服务器（多 root + 子路径 + 路径穿越防护）、`channel:'chrome'` 启动、冻结 CSS、console/pageerror/requestfailed 收集、可读断言、hover/Tab/令牌驱动 |
| `tests/browser/fixtures/*.html`（5 个） | `button.html`、`cascade.html`、`cascade-layered.html`、`theme-html-dark.html`、`theme-body-dark.html` |
| `tests/browser/shadow.test.mjs` | §3.2 / §3.3 / §3.7 |
| `tests/browser/focus.test.mjs` | §7 焦点环 |
| `tests/browser/motion.test.mjs` | §7 动效守卫（含默认上下文对照） |
| `tests/browser/theme.test.mjs` | ADR-0004 / §6+ADR-0003 / 决策 §8（`<html>` vs `<body>`） |
| `tests/browser/cascade.test.mjs` | ADR-0006（未分层 vs 分层对照）+ 产物来源自证 |
| `tests/browser/mutation-sweep.mjs` | 变异扫描：把产物复制到临时目录后打断一条不变量，用**同一批测试文件**跑，要求变红且指名不变量 |
| `tests/browser/README.md` | 基线、防 flaky 三条、计算值规范化表、坑、后票提醒 |

依赖：`playwright-core` **精确 `1.64.1`** 进 `devDependencies`（`npm i --save-dev --save-exact playwright-core@1.64.1`）；**不装 `playwright`**，**不下载任何浏览器二进制**（`npm ci` 前后 `%LOCALAPPDATA%\ms-playwright` 字节数均为 `716372975`，一字节未变）。npm scripts 新增：

```json
"test:browser": "node --test --test-force-exit --test-concurrency=2 tests/browser/",
"test:browser:mutations": "node tests/browser/mutation-sweep.mjs"
```

**浏览器基线：`chrome 155.0.8059.82`（`channel: 'chrome'`, `headless: true`）**，每次运行由 harness 打印 `[browser-harness] chrome 155.0.8059.82 (channel: chrome, headless)`；Node `v26.10.0`。默认 `chromium.launch()` 在本机缺 revision 1248 直接失败，`launchChrome()` 会给出可读提示并明确劝阻 `npx playwright install`。

`npm run test:browser` = **11 用例 / 5 文件，约 4.7 s，连跑 3 次全绿（EXIT 0）**，结束后 `Get-Process chrome` 计数 0（`after()` 里 `browser.close()` + `--test-force-exit` 双保险）。

### 三条防 flaky 约束（写进公共前置步骤并在注释里说明原因）

1. **冻结 `transition`/`animation`**（`addInitScript`，在 `goto` 之前）——不冻结实测 30/30 次读到过渡**前**的值（稳定地撒谎，不是抖动）；`sleep` 不能替代，因为 delay+duration 由被测 CSS 决定。例外只有一处：`motion.test.mjs` 用 `freeze:false`，因为 `transition:none !important` 会把 `transition-duration` 直接变成 `0s`，那条断言就会变成同义反复；它同时断言默认上下文为 `0.15s` 作为反向对照。
2. **焦点用真键盘 `Tab`**（`tabTo()`，先 `blur()` 再 `Tab`，并核对 `document.activeElement`）——`element.focus()` 会绕过 tab 顺序、元素不可达也照样通过；对 `<div>` 断言焦点环是无效测试（`<div>` 不可聚焦）。
3. **`:hover` 的所有读取合并进同一次 `evaluate`**，并把 `matches(':hover')` 一起读出来自证 hover 真生效——否则「读到静止值」会静默假绿。

### 8 条不变量（+2 条本仓特有）的红→绿

实现由 05–07 落地，所以「红」不能靠「先写测试」得到；这里用**更强的证据**替代：对每条不变量各造一个真实变异（`npm run test:browser:mutations`，把产物复制到临时目录后打断一处，再用同一批测试文件跑），要求 ① 变红 ② 错误块**指名该不变量** ③ 明确声明哪些**不相关**用例必须保持绿。

```console
$ npm run test:browser:mutations
PASS  blur-not-zero [spec §3.2] — RED as designed
      why        : the md tier grows a 1px blur — the hard shadow becomes a soft one
      went red   : ADR-0006 — an unlayered user rule beats every layer the library ships | spec §7 — a real Tab paints a 3px offset outline and the hard shadow survives it | spec §7 — the reduced-motion guard removes the motion and changes nothing else | spec §3.2 — the hard shadow keeps a zero blur and a zero spread | ADR-0004 — a system dark preference must not switch the theme | spec §6 — one token on <html> rescales every shadow tier, and only on <html> | orchestrator §8 — data-theme on <html> flips the hard shadow, on <body> it cannot
PASS  lift-written-as-a-literal [spec §3.3] — RED as designed          (went red: §7 motion, §3.3, §6)
PASS  hover-changes-a-border-width [spec §3.7] — RED as designed       (went red: §3.7 only)
PASS  focus-ring-removed [spec §7] — RED as designed                   (went red: §7 focus only)
PASS  important-in-a-layer [ADR-0006] — RED as designed                (went red: ADR-0006 unlayered only)
PASS  follows-the-system-dark-preference [ADR-0004] — RED as designed  (went red: ADR-0004 only)
PASS  tier-hardcoded [spec §6] — RED as designed                       (went red: §6 only)
PASS  motion-guard-inverted [spec §7] — RED as designed                (went red: §7 motion only)
PASS  dark-shadow-colour-not-repainted [orchestrator §8] — RED as designed
PASS  derivation-moved-onto-the-component [orchestrator §8] — RED as designed
PASS  layer-declaration-dropped [ADR-0006] — RED as designed
PASS  unmutated-artifact — the suite is green when nothing is broken
      went red   : <nothing>
PASS  static/barnacle.css untouched (sha256 654b758a2ce25524…)
11 mutants + 1 unmutated control, all as designed        # exit 0
```

逐条结论（绿态即 `npm run test:browser` 的 11/11）：

| 不变量 | 用例（绿） | 红态证据（变异） |
| --- | --- | --- |
| §3.2 模糊与扩展半径为 0 | `spec §3.2 — the hard shadow keeps a zero blur and a zero spread` | `--bn-shadow-md` 加 `1px` → 红并指名 `spec §3.2 — the hard shadow blur radius is 0`（实测 11 用例 pass 4 / fail 7） |
| §3.3 位移与阴影偏移同源 | `spec §3.3 — hover lifts the object by exactly the amount the shadow grows` | `--bn-shadow-lift: calc(var(--bn-shadow-x) / 2)` → `3px` → 红并指名 `spec §3.3 — the displacement distance is --bn-shadow-lift` |
| §3.7 hover 不改边框宽度 | `spec §3.7 — hover may change a colour but never a border width` | hover 规则加 `border-width: calc(var(--bn-border-width) + 1px)` → 只这一条红 |
| §7 焦点环用 outline 且不被吞 | `spec §7 — a real Tab paints a 3px offset outline and the hard shadow survives it` | `--_focus-ring: none` → 红并指名 `… outlineStyle`（见下「坑」） |
| ADR-0006 层顺序是契约 | `ADR-0006 — an unlayered user rule beats every layer the library ships` + `… inside one layer, specificity decides (the control …)` + `… the page really loaded the shipped artifact` | (a) 分层规则加 `!important` → 未分层断言红；(b) 删掉产物第 1 行 `@layer` 声明 → 只有 provenance 用例红 |
| ADR-0004 不跟随系统暗色 | `ADR-0004 — a system dark preference must not switch the theme` | 产物追加 `@media (prefers-color-scheme: dark){:root{--bn-background:#1A1A1A}}` → 红 |
| §6 一个令牌缩放三档 | `spec §6 — one token on <html> rescales every shadow tier, and only on <html>` | 把 `--bn-shadow-md` 写死成 `4px 4px …` → 红（同时 §3.2 保持绿，证明断言有针对性） |
| §7 动效守卫可模拟 | `spec §7 — the reduced-motion guard removes the motion and changes nothing else` | 把守卫的 `no-preference` 改成 `reduce` → 红 |
| 特有：`data-theme="dark"` 在 `<html>` 翻白、在 `<body>` 不翻白 | `orchestrator §8 — data-theme on <html> flips the hard shadow, on <body> it cannot` | (a) 暗色不重画 `--bn-shadow-color` → 红；(b) 把 `--bn-shadow-color` 的派生搬到组件元素上（body 上的主题就能翻白）→ 红 |
| 特有：真实产物里 `@layer` 与未分层规则的关系 | 同 ADR-0006 三条 + provenance | 见上 |

红→绿方向的实际读数（本机 Chrome 155）：静止 `rgb(0, 0, 0) 4px 4px 0px 0px`；hover `matrix(1, 0, 0, 1, -2, -2)` ↔ `rgb(0, 0, 0) 6px 6px 0px 0px`（增量 = `--bn-shadow-lift` = 2px，阴影落点不动）；四边 `border-width` 静止/悬停/按下/各外观类全部 `3px`；键盘 Tab 后 `outline solid 3px` + `offset 3px` + `rgb(116, 185, 255)`，`box-shadow` 仍为 md；`colorScheme:'dark'` 下无 `data-theme` 时 `body` 仍为 `rgb(255, 253, 245)`；`<html>` 上覆盖 `--bn-shadow-x:8px` → sm/md/lg 的 x 偏移 `4/8/12px`、lift `4px`，而同一覆盖写在包裹 `div` 上**不生效**（反向对照）；`html[data-theme="dark"]` 阴影翻成 `rgb(255, 253, 245) 4px 4px 0px 0px`，`body[data-theme="dark"]` 只翻页面颜色、阴影与边框仍是黑的；`reducedMotion:'reduce'` 下 `transition-duration: 0s`、`animation-name: none`，默认上下文 `0.15s, 0.15s, 0.15s, 0.15s` 覆盖 `transform, box-shadow, background-color, border-color`；未分层用户规则读到 `rgb(0, 128, 0)`（分层同一规则则输给 `:is(button,.bn-button)` 的 (0,1,0)，读到 `rgb(255, 210, 63)`）。

### 证伪实验（ticket 验证方式 2）原文

`src/css/01-theme.css` 的 `--bn-shadow-md` 模糊半径改 `0` → `1px`，`npm run build`（0 warnings）后 `npm run test:browser`：

```console
ℹ tests 11
ℹ pass 4
ℹ fail 7

test at tests\browser\shadow.test.mjs:50:3
✖ spec §3.2 — the hard shadow keeps a zero blur and a zero spread (273.2295ms)
  Error [ComputedStyleAssertionError]: ✗ invariant failed: spec §3.2 — the hard shadow blur radius is 0
      selector : #bare
      property : box-shadow blur
      expected : 0
      actual   : 1

test at tests\browser\theme.test.mjs:63:3
✖ ADR-0004 — a system dark preference must not switch the theme (434.8706ms)
  Error [ComputedStyleAssertionError]: ✗ invariant failed: ADR-0004 — the hard shadow stays the light theme shadow
      selector : #bare
      property : boxShadow
      expected : rgb(0, 0, 0) 4px 4px 0px 0px
      actual   : rgb(0, 0, 0) 4px 4px 1px 0px
```

变红的 7 条全是**读阴影字符串**的用例；`spec §3.3`（lg 档自带 `0` 模糊字面量）与 `spec §3.7`（只读边框宽度）**正确地保持绿**——证明断言是逐条针对性的，不是「一改 CSS 全红」。撤回（`git checkout -- src/css/01-theme.css` + 重新 `npm run build`）后四份产物 **byte-identical**：

```text
654B758A2CE25524F0859FDECC179D6138A9DA63CC897548F5693A4E4044CD33  static/barnacle.css
78104AD6EA28EC68A2C05B4AAE0D302DC36AAA1EFCC46A26FEEEDA8DB8483C5A  static/barnacle.min.css
1B65B5FFA8BAFCE7AAA0B49C32328A4CF6803ADC1FAB48F112EE30DB1B95C8DF  static/barnacle.js
01F35ACCE2E837AC56FE632C86F52DB4DF266A68217AA854DDBDFBDF1A00E8CC  static/barnacle.min.js
# 实验前/后 Get-FileHash 逐行一致；git status 无 src/ 改动
```

### 回归（全部 EXIT 0，未删改任何既有断言）

```text
npm test                 → 22/22 pass
npm run verify           → 21/21 checks passed
npm run verify:theme     → 16/16
npm run verify:base      → 35/35
npm run verify:button    → 21/21
npm run verify:demo      → 19/19
npm run verify:site      → 24/24
npm run verify:deploy    → 12/12
seite build  --strict    → EXIT 0  ✓ Built 2 components, 2 pages in 0.0s (6 static files copied, 1 public files copied)
seite check  --strict    → EXIT 0  ✓ No problems found
npm run test:browser     → 11/11，连跑 3 次 EXIT 0，残留 chrome 进程 0
npm ci                   → EXIT 0（playwright-core 1.64.1 / esbuild 0.28.2），ms-playwright 缓存字节数不变
```

**踩到并修掉的一个坑**：`npm install --save-dev` 重写 `package.json` 时删掉了空对象 `"dependencies": {}`，导致 `scripts/verify.mjs` 的第 1 项检查（`package.json exists with an empty dependencies object`）变红（20/21）。这是 **package.json 该有的内容**，已补回（未改该断言），补回后 21/21。

另外两点实测记录：`node --test <dir>` **只执行符合测试命名的文件**（用带副作用的探针实测确认），所以 `harness.mjs` / `mutation-sweep.mjs` / `expectations.mjs` 不会被当成测试跑；`outline: none` 的计算值仍是 `outline-width: 3px`（初始值 `medium`），只断言宽度是空跑。

### 未验证项 / 已知限制

- **CI（Linux/macOS）**：`channel: 'chrome'` 需要 runner 上预装 Chrome，未实测；`npx playwright install` 路线与本地结论不通用（本机就是缺 revision 才必须用系统 Chrome）。
- **Chrome 大版本升级**：计算值的规范化拼写可能变化（`box-shadow` 颜色顺序、`outline` 简写等），未做跨版本验证。基线已记在 `tests/browser/README.md` 与本题，升级 Chrome 后重跑即可。
- **`.min.css` / `.min.js` 产物没有被这套不变量覆盖**（探索笔记 §9 建议过：同一批期望值跑 min 产物是廉价的 minifier 回归网）。要落地需要给 harness 再挂一个产物目录并参数化 fixture 的 `<link>`。
- **并发上限只测到 `--test-concurrency=2`**（内存约束，不是端口约束）。
- **JS 只覆盖到「产物脚本能加载、无 console/pageerror、`window.bn.version` 与 package.json 一致」**；运行时样式切换（19–22 票的自定义元素）尚无断言。
- 无像素/截图比对（这是本票的既定形态，不是缺口）。

### 对后票的提醒（组件变动时最容易破的不变量）

1. **任何新增/改动的 `box-shadow`** 都会同时打红多条用例——所有阴影断言都是完整计算字符串（模糊/扩展必须为 `0`，`spec §3.2`）。
2. **`--bn-shadow-lift` 必须保持 `calc(var(--bn-shadow-x) / 2)`**：方程从矩阵、阴影字符串、令牌三处独立读并与 spec 值比对，写死成字面量即使数值巧合也会红。
3. **过渡列表是精确断言**（`transform, box-shadow, background-color, border-color`，0.15s，且必须声明在 `prefers-reduced-motion: no-preference` 内）——新增被过渡的属性是新决策，不是细节。
4. **焦点环不许 `outline: none`，也不许搬到 `box-shadow`**：环必须与硬阴影共存，这正是用 outline 的理由。注意 `outline: none` 的计算值仍是 `outline-width: 3px`，所以本台同时断言 `outlineStyle` 与 `outlineColor`。
5. **`data-theme="dark"` 必须落在 `<html>`**，且阴影色的派生必须留在 `:root`：把派生搬到组件元素上，`<body>` 上的主题就会把硬阴影翻白（`theme.test.mjs` 两半都钉死）。
6. **令牌覆盖只认 `:root`**：文档与示例都要写「在 `:root` 覆盖令牌」，包装元素上的覆盖有反向对照断言在盯着。
7. 改 `static/*` 后必须重新 `npm run build`：验收台测的是产物字节（provenance 用例会核对 CSS 路径、`@layer` 声明顺序与 `window.bn.version`）。

## Resolution

Resolved on the integration branch `feat/barnacle-v1` at commit b8d230f.
Closing convention: this tracker has no "done" label, so `Status: resolved` plus the ticked checklist above records closure (see `docs/agents/issue-tracker.md`).
Verify with: `npm run test:browser`
