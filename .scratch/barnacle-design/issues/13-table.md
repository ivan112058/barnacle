# 13: Table

**What to build:** 裸表格呈 Neubrutalism 外观：硬边框、表头分隔清晰、斑马或分隔线二选一、窄屏不撑破布局。

**Blocked by:** 09

**Status:** ready-for-agent

- [ ] 裸 `table` / `thead` / `tbody` / `th` / `td` 呈正确外观，边框不重叠双线
- [ ] 表头与表体视觉层级可辨，不靠降低对比度实现
- [ ] 窄屏下表格整体可横向滚动，不撑破页面布局
- [ ] 数字与文本列的对齐规则明确且可预期
- [ ] 焦点与选中态（若实现）不改变边框宽度
- [ ] 文档站出现「Table」页

**验证方式**

1. 把窗口缩到手机宽度，确认页面不出现横向溢出滚动，而表格自身可滚。
2. 确认相邻单元格边框不出现双线或错位。
3. 在暗色下确认表头分隔仍清晰。

## Answer

**分支**：`ticket/13-table`（基于 `feat/barnacle-v1` tip `52a9d2e`；完成前 `git merge feat/barnacle-v1` = Already up to date）
**提交**：`7dd6eb5` — "Dress the bare table element and keep the site stylesheet out of demo previews (ticket 13)"
**交付物**：`src/css/table.css`、`content/components/table.md`、`scripts/verify-table.mjs`（`npm run verify:table`，34 项）、`package.json`（+1 script）、`static/style.css`（站点侧系统性收敛，见 §8）

### 1. 边框方案：`border-collapse: separate` + `border-spacing: 0` + 单元格单向边框

选 **separate**，不选 collapse。理由（`src/css/table.css` 文件头有完整版）：

- **双线在结构上不可能**：只画每格的 `border-block-start` / `border-inline-start`，所以每条内部缝**只有一个拥有者**（后一格画、前一格 `0`）；`border-spacing: 0` 让两个 border box 精确相接 → 缝宽恒为 `--bn-border-width`。collapse 模式下的单线是 UA 的「边框冲突解决算法」给的（取最宽者、且把获胜边框盒对半分给两格），缝宽与归属不由我们掌控，文件层面无法阻止后续规则在同一缝上再画一条。
- collapse 还会裁掉单元格自身的 `box-shadow`，并让 sticky 表头的边框在 Chrome 里随内容滚走。
- 外框由 `table` 自己的 `border` 独占：第一行 / 第一列显式放弃起始边（否则外框会画两遍）。这里有一个**实现细节值得记住**：`table > :is(thead,tbody,tfoot):first-of-type > tr:first-child` 会按 *每种类型* 各命中一次，于是 thead 和 tbody 的第一行都被抑制，表头/表体分隔线消失；改用「先全抑制，再把有前置行组的行组恢复」的两条规则，并且恢复规则多带一个类型选择器才在**同一层内**胜出（`:first-of-type` 会在伪类列上反超，见下方案例）。
  实测（`verify:table` 浏览器断言）：`#table` 共 20 条纵向 + 20 条横向内部缝，**每条恰好 1 个拥有者、gap 0、宽度 3px**；四周外框各 3px；表格盒宽 1262px = 2×3px + 首行 1256px。
- 表头/表体缝：thead 单元格 block-end = 0px，tbody 首行 block-start = 3px solid `rgb(0,0,0)`，gap 0（5 列全部如此）。
- 暗色：缝 = 3px `rgb(255,253,245)`，对暗底 `rgb(38,38,38)` 对比 **14.86:1**。

### 2. 表头层级：靠「加」不靠「减」

`thead` 的单元格填 `--bn-main`（黄）+ `--bn-main-foreground`（黑）+ display 字体 + heading 字重 + nowrap；表体保持页面本色（`--bn-foreground` 在 `--bn-secondary-background` 上）。实测：表体墨色对比 **21:1**（亮）/ **14.86:1**（暗），表头墨色对比 **14.54:1**；字重 700 > 500；表头带 vs 表体面的**饱和度差 0.753**（这正是「不靠降低对比度」的度量方式——黄带与白面在亮度比上天然只有 1.4:1，用亮度阈值去量它会量错东西，所以断言换成「表体文字保持 AAA + 色带是饱和色带 + 缝线对表体面 ≥3:1」）。表体 `th`（行表头）保留 heading 字重、留在表体面上，不形成第二条色带。

### 3. 窄屏滚动方案（约定怎么写）

`<table>` 不是 block container，`overflow` 对 `display: table` 不生效——**裸表格无法自己滚**，这是 CSS 的硬边界，不是可以「再努力一下」的地方。约定写在 `table.css` §6 与文档页「Wide tables」：

- **语义写法**：`figure` 直接包含表格（带标题的表格本来就是 figure）→ `figure:has(> table)` 拿到滚动行为；
- **无语义包装可用时**：`<div class="bn-table-scroll">`（`bn-` 类名，符合 ADR-0001/0005）。
- 两者都有 `overflow-x: auto`，并且尾部留 `padding-inline-end/block-end: var(--bn-shadow-lift)` —— 不是装饰：`overflow: auto` 在 padding 边界裁切，而表格的硬阴影画在 border box 之外，2px 的尾部 padding 正好等于 sm 档阴影偏移（两者同源于 `--bn-shadow-x`），阴影因此不会被切掉。实测 1280px：`scrollWidth === clientWidth`（不出现滚动条）且右/下各余 2px 阴影空间；375px：两个 wrapper 都是 `523 > 359`，而 `documentElement.scrollWidth = 375 ≤ innerWidth 375`。
- **负对照（断言而不是假设）**：`/bare.html` 里同样宽、但没有任何包装的表格 → `documentElement.scrollWidth 515 > innerWidth 375`。这条把「约定不是可选项」写进了脚本。
- 文档页实测：375px 下 `documentElement.scrollWidth 375 ≤ 375`，预览面板里的 wrapper `523 > 305`（页面不横向溢出，表格自身可滚）。

### 4. 数字列对齐方案

- 文本列：`table { text-align: start }` 继承给所有单元格，**永远**左（start）对齐，行表头同样 start。
- 数字列：`.bn-num` → `text-align: end` + `font-variant-numeric: tabular-nums`。
- **不用 `data-*` 属性、不用 `:has()`**：HTML 里没有任何属性表达「这列是数字」，正是 ADR-0001/0005 留给 `bn-` 类名的场合（与决策 §1 的「语义轴 / 外观轴」一致）。
- **`<col class="bn-num">` 不行（实测）**：Chrome 不会把列盒上的 `text-align` 传给该列单元格，实测 `#r1-revenue`（类在 `<col>` 上）仍是 `start`；所以类写在表头格与每一格上。这条负对照留在 fixture 与断言里，文件注释与文档页都写明了。
- 不只断言属性：用 `Range.getBoundingClientRect()` 量文本盒，断言文本紧贴内容边（扣掉 border 与 padding）——数字列贴 end 边、文本列贴 start 边，误差 ≤0.51px。

### 5. 焦点 / 选中态

- 焦点：不加新规则，00-base 的 `:focus-visible`（outline，非 box-shadow）自然生效。实测：真键盘 `Tab` 命中 `td[tabindex=0]` 且 `:focus-visible` 为真，`outline: 3px solid rgb(116,185,255)`，offset 3px，四边边框宽度不变。
- 选中：`tr.bn-selected`（背景 tint；`aria-selected` 在普通 table 的 row 上不是合法语义，所以用外观类名，页面持有状态）。实测选中行 `rgb(255,237,178)`、hover 行 `rgb(255,247,220)`、暗色选中行 `rgb(125,107,48)`（由 `color-mix` 与 `--bn-secondary-background` 自动翻转），**5 列 × 4 边在 hover / focus / selected 三种状态下与静止完全一致**；静态断言同时禁止任何状态规则出现 border/box metric 属性。
- 斑马 vs 分隔线：**选分隔线**（网格线本身），不加斑马；行态只有 hover 与 `.bn-selected` 两种背景重绘。

### 6. verify:table 断言清单（34 项，全绿）

静态 16 项：无 BOM / 无 `@layer`；只用 `--bn-*`（限定在 spec §6.1 词汇表内）与 `--_*`（限定在 00-base 冻结槽位内，0 个自造）；无 `!important`；无颜色字面量且 `color-mix()` 只混令牌；**全文件 0 个 px 字面量**；几何属性只读槽位、`box-shadow` 必须是槽位；`border-collapse: separate` + `border-spacing: 0` 且产物里也在；单元格只画 start 边、无四边简写；首行/首列抑制规则存在；状态规则不得改任何 box metric；`table/thead/tbody/caption/th/td/figure/.bn-table-scroll/.bn-num/.bn-selected` 全在；transition 只在 `no-preference` 块内、无 reduce 块、无 animation；产物 `@layer components` 块存在。文档页静态 4 项：组件页形态（frontmatter / 无 H1H2 / 纯语言围栏）、示例是 figure 包装的裸锚点 + 数值列类在单元格上、正文点名全部语义锚点并说明包装约定、无尾斜杠链接。构建页 3 项：`seite build` exit 0 且索引链接 `/components/table`、产物页保留原始围栏与唯一注入 H2。浏览器 11 项：见 §1–§5、§7、§8 的读数。

### 7. 文档页实测

`content/components/table.md`：一句引导语点名 `table`/`thead`/`tbody`/`tfoot`/`th`/`td` → 可运行示例（figure + caption + thead/tbody/tfoot + `.bn-num`）→ H3 小节讲宽表、单线缝、表头与行态、数字列、覆盖方式，正文无 H2、无尾斜杠链接、只有标准围栏。真 Chrome 实测：预览面板里 `border-collapse: separate`、外框 3px、单元格 3px/3px/0px/0px、`.bn-num` 为 `end`（tabular-nums）；页面在 375px 不横向溢出；`seite build`/`check --strict` EXIT=0。目视复核（截图为本地临时文件，未入库）确认亮色/暗色/375px 与文档页预览均符合预期。

### 8. 站点侧系统性修复（父代理授权）：未分层站点 CSS 会盖掉预览面板里的库样式

**机制**：`static/style.css` 全部是**未分层**作者规则，而库的产物全在 `@layer` 内；未分层永远胜过分层（与特异性无关，ADR-0006）。组件页的预览面板是 `.site-prose` 的后代（`site.js` 把 `.site-demo` 插在 `.site-prose` 内），所以站点自己的表格/代码/引用/链接样式会把库的渲染整个盖掉。**修法**：统一用 `:not(.site-demo__panel--preview *)` 把「库渲染的那一格」从站点规则里排除，站点自身观感零改动。

| 原选择器 | 新选择器 | 为什么 |
|---|---|---|
| `a` | `a:not(.site-demo__panel--preview *)` | 预览里的 `<a class="bn-button">` 曾被站点的 `text-decoration: underline` 盖过（库的 `text-decoration: none` 在分层里，赢不了） |
| `a:hover` | `a:hover:not(…)` | 同上，悬停黄底属站点 chrome，不该出现在库预览里 |
| `:focus-visible` | `:focus-visible:not(…)` | 站点焦点环（黑 3px/offset 2px）曾是预览里唯一可见的环；现在预览显示库的蓝色环，站点 chrome 与面板自身仍是站点环 |
| `.site-prose h2` / `h3` | 各加 `:not(…)` | Typography 类预览里的标题应是库的排版 |
| `.site-prose code` | `code:not(…)` | 行内代码是嵌套元素，直接子元素手法无法表达 |
| `.site-prose pre` | `pre:not(…)` | 预览里的代码块应是库的 |
| `.site-prose pre code` | `pre code:not(…)` | 同上 |
| `.site-prose blockquote` | `blockquote:not(…)` | 引用预览应是库的 |
| `.site-prose table` | `table:not(…)` | 本票的原始发现 |
| `.site-prose th, td` / `.site-prose th` | 各加 `:not(…)` | 四边 2px 边框与左对齐曾盖掉库的单向边框与 `.bn-num` |

**为什么不是父代理建议的直接子元素写法（`.site-prose > table`）**：直接子元素手法对表格够用，但它把「散文表格」定义成了「散文顶层表格」，而散文不是平的（列在 `li`、`blockquote` 里的表格同样是散文）——那会*改变站点自身观感*，与「只收敛范围」冲突；对 `code`/`a` 这类嵌套元素则完全无法表达。`:not(.site-demo__panel--preview *)` 精确排除预览子树、保留任意深度的散文、并且**不排除代码面板**（代码面板里是 seite 的 `<pre>`，必须继续用站点代码块外观）。断言里加了嵌套散文表格探针来锁住这一条：`li > table` 实测仍是 `collapse` + cell 2px + 8px（站点样式）。**此处对父代理的指定做法有一处方法偏离，理由如上；若要求回到 `> table`，改动只在三行。**

**新增断言（`verify:table` 内，双向）**：① 预览面板内表格**计算样式来自库产物**：`separate` + 外框 3px + 单元格 3px/3px/0px/0px + padding 10px + `.bn-num` = `end`(tabular-nums) + `box-shadow: rgb(0,0,0) 2px 2px 0 0`；② 对照：`.site-prose` 直接子表仍是站点的 `collapse` + 四边 2px + padding 8px + `left` + accent 表头，嵌套散文表格同样是站点样式。
**咬合验证（mutation）**：把三条表格规则临时改回 `.site-prose table` / `.site-prose th, .site-prose td` / `.site-prose th` 后重跑 → **新断言变红，该轮 33/34**：`the preview table must compute the library's border model (separate), read collapse`，恢复选择器后 34/34。命令与读数已在此记录。

**没有站点规则、因而无需收敛的裸元素**（逐条查过 `static/style.css`）：`h1`、`h4`–`h6`、`p`、`ul`/`ol`/`li`、`hr`、`mark`、`article`、`[role="alert"]`、`[role="status"]`、`progress`、`meter`、`dialog`、`details`/`summary`、`input`/`label`/`select`/`textarea`（站点只用 `site-` 类名，或根本没有规则）。**「无法安全收敛、只能保留原样」的桶是空的**——12 条全部收敛。
**顺带发现（未改，仅报告）**：① 散文表格与行内 code 的外框/阴影其实一直来自库的分层规则（站点规则没声明 `border`/`box-shadow`），实测散文表格 `border-top: 3px` + `box-shadow: rgb(0,0,0) 2px 2px` 是库的、单元格 2px 与 collapse 是站点的；这是本票之前就存在的混合，属站点设计决定，我按「不改变站点观感」没动。② 反向泄漏：`.site-demo__tab` 是裸 `<button>`，库的 button 分层规则会给它加上 `box-shadow`/`border-width`/`min-block-size` 等默认（站点规则只覆盖它声明的属性）——04 号票既有形态，不在本票范围。

### 9. 对后续票的意义（父代理第 6 项）

坑的形态是：**站点样式表里任何作用于「库也会样式化的裸元素」的未分层规则，都会穿透进 `.site-demo__panel--preview`，让预览显示站点的样子而不是库的样子**；而它永远不会让任何现有断言变红（预览外观没有断言），只能靠 `verify-table.mjs` 这类「读预览面板计算样式」的检查咬住。
逐项判断：**10 号票（Card/Badge/Alert/Spinner/Skeleton）与 16 号票（Progress/Meter）的预览不会被盖**——站点样式表对 `article`、`[role="alert"]`、`[role="status"]`、`progress`、`meter`、`.bn-badge`/`.bn-spinner`/`.bn-skeleton`（类名）**没有任何规则**。真正会失真的是 **Typography 类预览**（`h2`/`h3`/`code`/`pre`/`blockquote`/`a`/`:focus-visible`），以及任何将来新增的 `.site-prose <裸元素>` 规则。我在 `static/style.css` 顶部写下了这条契约：**新增站点规则时必须带上 `:not(.site-demo__panel--preview *)`**；同时建议后续纯 CSS 组件票照抄 `verify-table.mjs` 的做法：至少有一条「真 Chrome 读预览面板计算样式」的正向断言 + 一条「散文/站点自身不变」的对照断言。

### 10. 回归（全绿，未删改任何既有断言）

`npm test` 78/78 pass；`npm run test:browser` 11/11；`verify.mjs` 21/21；`verify-theme` 16/16；`verify-site` 24/24；`verify-base` 35/35；`verify-demo` 19/19；`verify-deploy` 12/12；`verify-button` 21/21；`verify-tabs` 19/19；`verify-toast` 19/19；`verify-dropdown` 17/17；`verify-table` 34/34；`seite build --strict` EXIT=0；`seite check --strict` EXIT=0。
过程中撞红过两次，**都是我自己违反既有断言，已在我的文件里改正，没有削弱断言**：① `verify-theme` 的 `!/!important/.test(artifact)` 命中了 `table.css` 注释里的字面量 `!important` → 改写注释措辞；② `verify-site` 的「style.css 不得出现 `.bn-`」命中了站点注释里 `.bn-num` 一词 → 改成不含库类名的措辞。

### 11. 未验证项

- 只测了本机系统 Chrome 155（`channel: 'chrome'`）：`:has()`、`:not(选择器列表 *)`、`color-mix()`、逻辑属性在 Firefox/Safari 上未实测。
- `npm run test:browser:mutations`（08 的变异扫描）未跑（不在本票回归清单内）；本票自己的 mutation 验证是手工做的一次（见 §8）。
- `tfoot` 写在 `tbody` **之前**（树序在前、渲染在后）的表格未测；`rowspan`/`colspan` 的表格未测（单向边框在跨行/跨列的缝上未验证）。
- RTL 未实测（边框与对齐都用了逻辑属性，但只跑了 `lang="en"`）。
