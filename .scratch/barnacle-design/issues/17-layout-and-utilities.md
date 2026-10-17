# 17: Layout 与 Utilities

**What to build:** 容器、12 栅格与工具类。文档站自己先吃这套栅格——索引页与组件页的排版用它搭，用真实压力验证它，而不是只在一页示例里成立。

**Blocked by:** 09

**Status:** ready-for-agent

- [ ] `.bn-container` / `.bn-row` / `.bn-col-*` 就位，栅格为 12 列且断点行为明确
- [ ] 工具类集合有界且被记录（间距、对齐、显隐等），不做大而全
- [ ] 工具类与视觉修饰类名**不冲突**，命名分层清晰
- [ ] 文档站自身的 `/components/` 索引页与至少一个组件页改用这套栅格排版，并保持外观不退化
- [ ] 窄屏下栅格折行行为正确，无横向溢出
- [ ] 文档站出现「Layout」与「Utilities」页

**验证方式**

1. 从最窄到最宽逐档缩放窗口，确认栅格折行无溢出、无错位。
2. 检索类名，确认工具类没有和 `.button.outline` 之类的视觉修饰撞名。
3. 确认索引页改造前后视觉无退化。

## Answer

### 交付物与实现选择

**分支** `ticket/17-layout-utilities`（基于 `feat/barnacle-v1` tip `52a9d2e`，merge 时 Already up to date）。

**栅格实现方式：CSS grid + 「一个列类只写一个自定义属性」**

```css
.bn-row {
  --_span: var(--_grid-columns);
  display: grid;
  grid-template-columns: repeat(var(--_grid-columns), minmax(0, 1fr));
  gap: var(--_grid-gap);
}
:is(.bn-col-1, … .bn-col-12) {
  --_span: var(--_grid-columns);
  grid-column: span min(var(--_span), var(--_grid-columns));
  max-inline-size: var(--_col-max, none);
  min-inline-size: 0;
  contain: paint;
}
.bn-col-6 { --_span: 6; }
```

选 grid 而不是 flex + 百分比宽度的理由（写进了 `content/components/layout.md`）：间隙是单一 `gap`，列不必从百分比里再减去自己那一份间隙，行与行之间不会因为小数点漂移；列可以被强制压到内容宽度以下（`minmax(0,1fr)` + `min-inline-size: 0`），这是长 token 的文档页需要的；整个响应式行为是一条媒体查询改一个声明，不是十二个类再写一遍。

**断点清单（一条）**：`@media (max-width: 768px)`（= 48rem，媒体查询里的 rem 按初始 16px 计算）。768px 及以下**所有** `.bn-col-*` 塌成整行；768px 以上按类名给的道数排。刻意不提供 `bn-col-md-6` 这类响应式前缀（组合爆炸，与「有界」相悖）。

**工具类清单（20 个，五组，全部列在 `content/components/utilities.md`）**：
- 文本对齐 3：`bn-text-start` / `bn-text-center` / `bn-text-end`
- 无障碍 1：`bn-visually-hidden`
- 布局组合 4：`bn-stack` / `bn-cluster` / `bn-center` / `bn-between`
- 间距 8：`bn-mt-2|4|8|16`、`bn-mb-2|4|8|16` → `0.5/1/2/4rem`（2/4/8/16 是缩放梯，不是像素表）
- 尺寸与文本 4：`bn-w-full` / `bn-truncate` / `bn-list-none` / `bn-text-muted`

边界：没有任何 `!important`（`utilities` 是 ADR-0006 的最后一层，层本身就赢，再写一个就是第二套机制）；没有响应式前缀；不碰颜色/边框/阴影（那是 `.bn-outline`/`.bn-ghost`/`.bn-sm`/`.bn-lg`/`.bn-attached`/`.bn-icon` 的地盘）。

**撞名检索结果（ticket 验证方式 2）**：`scripts/verify-layout.mjs` 对 `bn-outline`、`bn-ghost`、`bn-sm`、`bn-lg`、`bn-attached`、`bn-icon`、`bn-button`、`bn-button-group` 八个视觉修饰名逐个做 `.name(?![\\w-])` 检索 `src/css/utilities.css`，零命中；另有一条把 20 个工具类名在除 `utilities.css` 之外的全部 CSS 文件里检索一次，确认没有第二个文件声明同名工具类。剔除注释后 `static/style.css` 里也不再出现任何 `.bn-` 类名。

### 文档站自己吃栅格（范围与「不退化」证据）

改了 `templates/{base,index,page,component,components-index}.html` 与 `static/style.css`：
- `base.html` 的 `<main class="site-main">` 增加 `.bn-container`；`.site-main` 通过**容器自己的内部槽位** `--_container-max: var(--site-width)`、`--_container-pad: var(--site-pad)` 把站点宽度与边距交进去，而不是另写一套；
- `components-index.html`：`/components/` 索引页每张卡是 `.bn-col-4`；
- `component.html`：面包屑 / 标题 / 模板注入的 H2 / 正文 / 翻页各占一个 `.bn-col-12`；
- `page.html`、`index.html` 同样改成 `.bn-row` + `.bn-col-*`。

**改造前 → 改造后（同一台系统 Chrome 155.0.8059.82，逐档 320/375/768/1024/1440；before 读数在改造前采集，见提交历史的 `.scratch` 证据文件）**

| 视图 | 文档 scrollWidth | 每行卡片数 | 卡片宽 | 容器宽 | 正文宽 |
|---|---|---|---|---|---|
| `/components/` @320 | 320→320 | 1→1 | 288→288 | 320→320 | — |
| `/components/` @375 | 375→375 | 1→1 | 343→343 | 375→375 | — |
| `/components/` @768 | 768→768 | 1→1 | 341→707 | 768→768 | — |
| `/components/` @1024 | 1024→1024 | **3**→**3** | 287→293 | 992→992 | — |
| `/components/` @1440 | 1440→1440 | **3**→**3** | 283→293 | 992→992 | — |
| `/components/button` @320 | **377→320** | — | — | 320→320 | 288→288 |
| `/components/button` @375 | **377→375** | — | — | 375→375 | 343→343 |
| `/components/button` @768 | 768→768 | — | — | 768→768 | 707→707 |
| `/components/button` @1024 | 1024→1024 | — | — | 992→992 | 736→736 |
| `/components/button` @1440 | 1440→1440 | — | — | 992→992 | 736→736 |

- 关键读数**一致**：1024/1440 仍是每行 3 张、卡片宽 287/283→293（多出的 6–10px 来自间隙由 24px 均匀化 + 栅格取整，视觉同级）；容器宽 992 与正文可读宽度 736 逐档不变。新的索引页比改造前更规整：不再有「1.25 张卡/行」的残行（旧 `auto-fill` 在 768px 后的行为），1024px 起稳定 3 张。
- **真正的退化修复**：`/components/button` 在 320px / 375px 本来就有 377px 的横向溢出（fence 内不可断行的注释行 + `.bn-button` 的 `white-space: nowrap`），改造后 320/375 都等于视口宽。这属于「无横向溢出」这条硬要求，见下节。

### 逐档缩放的溢出读数（ticket 验证方式 1）

`scripts/verify-layout.mjs` 的浏览器断言对 **`components/`、`components/button`、`components/layout`、`components/utilities`、`usage`、`/`（首页）** 六个页面 × 320/375/768/1024/1440 五档，断言 `document.documentElement.scrollWidth <= window.innerWidth`，全部 30 组读数等于视口宽（例如 `components/button@320=320/320`）。栅格 fixture（`tests/browser/fixtures/layout.html`）另在 320/375/768/769/1440 五档断言折行：`320px→full 264 vs 264`、`375px→full 311 vs 311`、`768px→full 704 vs 704`、`769px→half 341 (12 列单格 705 − 间隙 24)/2=340.5`、`1440px→half 556 vs 1136`。

### 浏览器断言里发现的三个真问题（都在库里修掉了，不是改断言）

1. **`.bn-container` 是 `content-box`**：库没有全局 `* { box-sizing }` 重置，`inline-size:100%` + `padding-inline` 会让容器比父级宽两个 padding，顶层用容器必出横向滚动条。已显式声明 `box-sizing: border-box`（fixture 实测：1200px 视口下容器 1264px → 1200px）。
2. **栅格项的 automatic minimum size 不会被 `min-inline-size: 0` 消掉**：列里放一个不可断行的 token（URL、40 字符串），列仍把该 token 的宽度当最小值，把整个文档撑宽。实测 320px 视口下：无 containment → 文档 666px；`overflow: clip` 或 `contain: paint` → 320px。选了 **`contain: paint`**，因为 `overflow: clip` 会被嵌套 `.bn-row` 继承，而**被 clip 的 grid 无法给自己排布子元素**（嵌套列塌成一格）。代价写在 `layout.css` 注释里：列会裁掉自己盒子外画出的内容，需要换行请自己写 `overflow-wrap`。
3. **未分层 CSS 会盖掉分层 CSS（ADR-0006 的反面）**：站点自己的 `.site-grid { grid-template-columns: repeat(auto-fill, …) }` 与库的 `.bn-row` 若写在**同一个元素**上，站点那条（未分层）赢，12 轨栅格被静默换掉。模板因此把两者**嵌套**而不是叠在同一个元素上；`static/style.css` 里 `.site-grid` 保留为站点自己的 hook，注释写明了这个坑。

### 验证脚本断言清单（`npm run verify:layout`，22 项，静态 16 + 浏览器 6）

静态：layout.css 存在且被 `scripts/build.mjs` 收录 / `--_grid-columns: 12` + `.bn-row` 的 `repeat(var(--_grid-columns), minmax(0,1fr))` + gap / 12 个列类逐个 `--_span: n` / 家族规则消费 `--_span` 且含 `min-inline-size: 0` / 断点在 768px 且媒体查询体把全部列塌成整行 / 两个文件无 `@layer`、无 `!important`、只用 `--bn-*` 与 `--_*`、无位移与阴影字面量 / 工具类集合与文档清单**双向**一致且 ≤28 / 间距是 2-4-8-16 且映射到 0.5-1-2-4rem / 工具类与 8 个视觉修饰名不撞名且没有第二个文件声明同名工具类 / 四份产物含全部类名且 `static/style.css` 不读 `--bn-*`、不定义 `bn-` 类 / 两个内容页无 H2、无尾斜杠链接、只有标准围栏 / layout 页写明 12 列、768px、48rem、320/375/768/1024/1440、实现选择、间隙与硬阴影的约束 / utilities 页列出全部 20 个类并写明层与未分层覆盖 / `base.html` 的 `<main>` 带容器 + 四个页面模板都出现 `.bn-row` 与 `.bn-col-*` / `--site-width` 仍是 62rem 且 `.site-main` 交出了 `--_container-max`/`--_container-pad` / `seite build` EXIT=0 / 构建产物页面都带栅格类。
浏览器（真 Chrome 155，冻结 transition/animation）：fixture 12 等轨 + `.bn-col-6` 两个等宽相邻且间隔等于 `gap` + `.bn-col-12` 等于整行 + 嵌套 `.bn-row` 重置了 span 并把子元素排成两半 + 容器不超视口 + `.bn-list-none` 赢过 `base` 的 `ul { list-style: square }` + `.bn-visually-hidden` 尺寸 ≤1px + 各工具类计算值 + 列对一个不可断行 token 的 containment / 断点两侧折行（阈值取自浏览器 `matchMedia`，不是脚本里的常数）/ 六个页面 × 五档无溢出 / 索引页每档 12 轨 + 每行卡片数与契约一致 + 同行卡片等高 / 组件页 3 个 fence 与 2 个 Preview/Code demo 未变 + 正文不超可读宽度。

### 回归结论（全绿，未删改任何既有断言）

`npm test` 78/78；`npm run test:browser` 11/11；`verify` 21/21；`verify:theme` 16/16；`verify:site` 24/24；`verify:base` 35/35；`verify:demo` 19/19；`verify:deploy` 12/12；`verify:button` 21/21；`verify:tabs` 19/19；`verify:toast` 19/19；`verify:dropdown` 17/17；`verify:layout` 22/22；`seite build --strict` EXIT=0；`seite check --strict` EXIT=0（`No problems found`）。

两处「看起来像红但不是断言过时」的处理，都**没有削弱断言意图**：
1. `verify:theme` 的「产物里不许出现 `!important`」是**原始文本**扫描，而我在 `utilities.css` 的注释里写了这个词。改的是注释措辞（不写这个词），不是断言——全库依然没有任何一条 `!important` 规则。
2. `verify:site` 的「`static/style.css` 不得出现 `.bn-`」也是原始文本扫描。站点确实需要对 Button 页 demo 里的库按钮放宽 `white-space`，于是改写成属性选择器 `[class~="bn-button"]`：语义完全一样，站点样式表里不再出现库的类名，命名分工（ADR-0005 / 决策 §7）从「靠约定」变成「靠脚本保证」。
另外 `verify:site` 还有一条断言 `.site-header/.site-footer/.site-main` 的 `max-width: var(--site-width)`，其间三个选择器共用一条规则，`.site-main` 另加栅格槽位——原断言照旧通过。

### 未验证项 / 需要协调代理知道的事

- 改造前后读数的采集脚本与两份 JSON 读数（`.scratch/baseline-measure.mjs`、`baseline-before.json`、`baseline-after.json`、`compare.mjs`、`shots.mjs`）已随本提交保留下来，可复跑。截图（`.scratch/shots/*.png`）**未提交**——上文的逐档对照表与 `verify:layout` 的计算样式读数就是证据。
- 工具类的「读屏可读且可被焦点命中」只断言了尺寸/裁剪（`.bn-visually-hidden` 的 1px 盒），没有用真键盘 Tab 去命中它——本 ticket 不新增焦点用例（08 号票的 `focus.test.mjs` 覆盖焦点契约）。
- `--site-pad` 由 `clamp(1rem, 4vw, 3rem)` 收紧为 `clamp(1rem, 4vw, 2rem)`：只为让栅格容器与页头/页脚在 62rem 的站点宽度下共用同一个边距值。1024/1440 档容器仍是 992px；768px 附近边距由约 31px 变成 32px（±1px）。
- `templates/*` 与 `static/style.css` 的另一半改动权归 23 号票；我这边改动是完整的、可读的，未留半成品。
- 卡片的元素从 `<ul>/<li>` 换成 `<div>`（栅格项 + `.site-card` 内层），`verify-site` 没有对这些标签做断言；若 23 号票需要列表语义，`.site-card` 的样式与 `.bn-col-4` 都不依赖标签名。

