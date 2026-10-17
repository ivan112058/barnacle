# 12: Form

**What to build:** 全部裸表单元素成体系可用：输入框、下拉、多行文本、复选、单选、字段集、标签。校验状态只在**用户真的交互过之后**才出现——一进页面满屏红框是最常见的表单设计错误。

**Blocked by:** 11

**Status:** resolved

- [x] 裸 `input` / `select` / `textarea` / `checkbox` / `radio` 呈正确外观，尺寸与排版成体系
- [x] `fieldset` / `label` 就位，字段组有可辨的边界与标题层级
- [x] 校验状态用 `:user-invalid` 触发（交互后），**不出现**:invalid 导致的初始红框
- [x] 校验语义走 `data-variant`，与外观修饰不混用
- [x] 校验态**不改变边框宽度**，避免栅格重排
- [x] 焦点环对所有控件可见
- [x] 实测 `:user-invalid` 在目标浏览器可用；不可用则记录兜底方案并落地
- [x] 文档站出现「Form」页，含各类控件与校验态示例

**验证方式**

1. 直接打开 Form 页，确认没有任何控件在未交互前呈现错误态。
2. 逐个控件输入非法值后再失焦，确认错误态出现。
3. 逐一读取校验前后与聚焦前后的边框宽度，确认全部一致。
4. 记录 `:user-invalid` 的实测结果（对应 spec §14 的实测要求）。

## Answer

### 分支与提交

- 分支 `ticket/12-form`，基线 `9165b78`（11 号票 tip，含 switch 与集成分支到 `7e6e1d1` 的全部内容）。
- `17d60f8` 实现（`src/css/form.css` 第 2–5 节 + `content/components/form.md` + `scripts/verify-form.mjs` + `package.json` 新增 `verify:form` + 重建产物）。
- `1a31a7d` 合并 `feat/barnacle-v1`（带入 11/14/15；`package.json` 与 `static/barnacle.min.css` 有冲突：前者手工并集，后者按决策 §11 直接 `npm run build` 重建，不手工调和产物）。
- 其后两个提交：`verify-switch.mjs` 一条负向对照的改写（见下文「跨票改写」）与本文档。

### `form.css` 五节的最终结构（第 1 节 11 号票的 switch 逐字未改）

1. **switch（ticket 11）**：`input[role="switch"]` 一节原样保留，一个字都没动；本票的所有规则都不命中它（文本类按 `type` 排除，盒子类带 `:not(input[role="switch"])`）。
2. **文本类 `input`/`select`/`textarea`**：一个盒子规则（`input:not(` 十个类型 `)` + `select` + `textarea`）——`border-width: var(--bn-border-width)`、`--bn-radius` 方角、次要表面、`--_shadow-rest: var(--bn-shadow-sm)`、`min-block-size: 2.5rem`（按钮同一档地板）、`1rem/1.5`、`box-sizing: border-box`；`textarea` 只加 6rem 起高与纵向 resize；`select` 去掉平台 chrome 并用 `currentColor` 双渐变画雪佛龙；`::placeholder` 用 `color-mix` 取 55% 墨色；hover 只把阴影档位从 sm 升到 md（字段不在光标下移动）；disabled 把表面退回页面底色 + 0.6 不透明度 + `not-allowed`；错误边框的过渡写在 `prefers-reduced-motion: no-preference` 内、由 `--_motion` 计时。
3. **checkbox / radio**：`:is(input[type="checkbox"], input[type="radio"]):not(input[role="switch"])` 一条盒子规则（`appearance: none`、`inline-grid` + `place-content: center`、1.25rem 方块、`box-sizing: border-box`、结构边框），radio 用 `border-radius: 50%`；标记是 `::before`（65% 尺寸、`transform: scale(0)` 隐藏），勾用 `clip-path: polygon(…)` 画、点用 50% 圆角，`:checked` 只改 `background` 与 `transform`，勾点不做动效。
4. **fieldset / legend / label**：`fieldset` = 结构边框 + `--bn-shadow-sm` + 次要表面 + `min-inline-size: 0`（平台默认 `min-content` 会在窄列里拒绝收缩并溢出）；`legend` 取显示字体 + 标题字重 + 正文字号；`label` 取标题字重、`margin-block: 0.75rem 0.375rem` 的节奏、`legend + label` 复位首行；紧跟 checkbox/radio 的 label 回到 inline 且去掉块外边距。
5. **校验**：只用 `:is(:user-invalid, [aria-invalid="true"], [data-variant="danger"], [data-variant="error"])`，只画 `border-color` 与 `background-color`（10% `--bn-danger` 洗色）；盒子类与 switch 各自一条只画边框的规则。没有任何 `:invalid`、没有任何 `bn-` 错误类、不改边框宽度、不重写阴影。

### `:user-invalid` 实测（目标浏览器）

- 系统 Chrome **155.0.8059.82**，`CSS.supports('selector(:user-invalid)') === true`（顺带读到 `:user-valid` 也 `true`）。**可用，无需兜底**。
- 平台语义读数（本票 fixture，7 个不合规控件）：加载时 `:invalid === true`、`:user-invalid === false`（这正是「裸 `:invalid` 会满屏红框」的来源）；`#f-email` 输入 `not-an-email` 并真实 `Tab` 离开后 `:user-invalid` 变 `true`、边框变 `rgb(255, 107, 107)`；改回合法地址再离开又回到 `false`、边框回 `rgb(0, 0, 0)`。
- 兜底已落地并与主路径同规则：`[aria-invalid="true"]`（服务端判定，无需任何交互）与 `[data-variant="danger"]`/`"error"`（语义轴）。实测 `#f-aria`、`#f-variant` 在加载时就是红框 + 红洗色。
- 一处平台事实：必填 radio 组的 `:user-invalid` 用户侧**不可达**（radio 无法被用户反选），因此该分支只能走 `aria-invalid`——脚本里就是用 `#f-radio-ok` + `aria-invalid="true"` 覆盖的。

### 初始无红框的实测证据（验证方式 1）

每个「不合规」控件都与**同类型的合法孪生**逐一比对 8 个绘制属性（四边 `border-*-color`、`background`、`color`、`box-shadow`、`outline-color`）：7 组全部相等，且等于令牌基线（边框墨色 `rgb(0, 0, 0)`、表面 `rgb(255, 255, 255)`、文字墨色、sm 档阴影 `rgb(0, 0, 0) 2px 2px 0px 0px`）。同时校验了加载时确实有 7 个控件 `:invalid === true`（证明这条检查在咬真问题，而不是 fixture 根本不 invalid）。

### 边框宽度不变的读数（验证方式 3）

16 个可聚焦控件 × 四边：静止与**真实 Tab 聚焦**时逐项相等；再把 6 个控件推进错误态后第三次读取仍全等（例如 `#f-email` 全程 `3px/3px/3px/3px`，`#f-accept`、`#f-switch`、`#f-plan`、`#f-note`、`#f-name` 同）。静态侧也断言了「校验规则只出现 `border-color` / `background-color`」与「校验规则不含任何 width/padding/size」。

### 焦点环（验证方式 4）

16 个控件按编写顺序被**真实 Tab** 逐个命中，每个都读到 `outline-style: solid`、`outline-width: 3px`、`outline-color: rgb(116, 185, 255)`、`outline-offset: 3px`；disabled 控件与 `hidden` 输入不可达（Tab 越过后落在空处）。form.css 里**不重复写焦点环**（base 层的 `:focus-visible` 已覆盖所有可聚焦元素，本文件 0 条 `outline` 声明）。

### 其它实测的行（错误态、暗色、无脚本、文档页）

- 错误态：边框 `rgb(255, 107, 107)`；浅色洗色 `rgb(255, 240, 240)`（10% danger over `#FFFFFF`）；暗色洗色 `color(srgb 0.234118 0.176078 0.176078)`（10% danger over `#262626`）；`box-shadow` 始终保持 sm 档（错误态不重写阴影）。
- 暗色：字段表面 `rgb(38, 38, 38)`、文字/边框浅墨 `rgb(255, 253, 245)`、阴影翻白 `rgb(255, 253, 245) 2px 2px 0px 0px`；组框表面同为暗次要面；错误边框仍是 `--bn-danger`。
- 无脚本（`javaScriptEnabled: false`）：键盘输入 + Tab 离开后仍能上色（`rgb(255, 107, 107)`），外观与校验都不依赖 JS（不变量 6）；这一项用轮询等过渡结束，不靠 `sleep` 猜。
- 文档页：`content/components/form.md` → 6 个 H3、6 个围栏（5 × html + 1 × css），无 H2、无尾斜杠链接、围栏 info 纯净；`seite build` 后 `dist/components/form.html` 的 Preview 里真有 1 个 fieldset / 4 个 label / 2 个 input，对它真实输入非法值 + 真实失焦后边框变红；`dist/components/index.html` 链接 `/components/form`。

### 新增的验证脚本

`scripts/verify-form.mjs`（`npm run verify:form`，**21 项**）：

- 静态断言（11 项）：无 BOM / 不写 `@layer` / 五节标题与第 1 节 switch 几何未被改动；没有任何规则给裸 `input` 上盒子（只按 subject 判定，逐条列出）；0 条裸 `:invalid`、≥3 条 `:user-invalid`、`aria-invalid` 与 `data-variant` 都在；错误态只用语义轴且 0 个 `bn-` 类；校验规则只画不排版；只出现 `--bn-*`/`--_*` 且**不新增 `--_` 槽位**（16 个共享槽 + 4 个 switch 局部之外一律不认）；无颜色字面量、原始文本无那个禁用关键字、`outline` 一条不写且 base 层的环仍读槽位；字段/盒子/组框的几何逐条等于令牌或既定尺寸、位移与阴影 0 字面量；产物里有 form.css 块与关键声明（min 产物保留 `:user-invalid`）；文档页结构与内容；`seite build` + 索引链接。
- 真 Chrome 断言（10 项）：上面每一条读数逐条对应（初始无红框、`:user-invalid` 支持与三段状态、逐类控件的错误态、边框宽度三态四边、Tab 顺序与焦点环、尺寸与排版体系、暗色、文档页预览、无脚本）。全部在冻结 `transition`/`animation` 的上下文里读（无脚本那项用轮询等过渡结束）。

### 偏离与取舍（逐条）

1. **不读 `--_variant-color`**：11 号票的断言把 `form.css` 的 `--_` 词汇冻结为 16 个共享槽 + 4 个 `--_switch-*` 局部，`var(--_variant-color)` 会让 `verify-switch` 的「no invented name」变红且我无权改它的断言。因此第 5 节**就地**把 `data-variant="danger"/"error"` 映射到 `--bn-danger`。语义轴本身没变（仍然只用 `data-variant` / `aria-invalid`，零 `bn-` 类，不变量 4 成立）；差别只是少了 theme 层的那一次间接。
2. **没有 `:active`**：`verify-switch` 的「state rule 只许 paint/translate/`--_` 槽，不许写 `box-shadow`」与 `verify-interaction` 的「press 规则必须写 `box-shadow`」在 `form.css` 里无法同时满足。字段是输入靶，本身也不该按下位移——所以文本类 hover 只升阴影档位不位移、无 press；按钮的 press 留在 `button.css`。
3. **`input[type=submit|reset|button|image]` 保持原生外观**（第 2b 节注释写明理由）：它们要「hover 抬升 + press 塌影」，而这两条在 `form.css` 无法声明（同上）；一个只会抬不会落的按钮比原生按钮更糟，受支持的提交控件是 `<button>`（button.css）与 `.bn-button`。它们被显式排除在文本类之外，不会误吃字段的盒子。
4. **错误态不重写阴影**：派生令牌在 `:root` 已替换（决策 §8），在字段上重设 `--bn-shadow-color` 无效；重写成字面量又会造出第二个几何来源。因此错误只用边框 + 洗色表达。
5. **`[type="hidden"]` 必须排除**：否则 `display: block` 会让隐藏输入现身（实测过这个坑）。
6. **不加尺寸轴（`.bn-sm`/`.bn-lg`）**：尺寸体系由默认档表达（2.5rem 地板、1rem/1.5、8/12 padding、16px 组内边距、12/6 的标签节奏），避免与 `button.css` 的尺寸档逐字重复。
7. **`form.css` 不写焦点环**：base 层一条 `:focus-visible` 已覆盖所有控件，重复写只会多一处会漂移的数值（也顺便满足「状态规则不得碰 `outline`」的既有审计）。
8. **`::before` 尺寸的一条 Chrome 事实**：checkbox/radio 的 `::before` 是 grid 子项，`getComputedStyle(el,'::before').inlineSize` 返回 `0px`（即使它确实按 65% 画出来了）。所以脚本用 `transform` 的 `matrix(0,…)`→`none`、`clip-path`、`position` 与填充色来断言标记的显示/隐藏，不拿这个读不到的尺寸做断言。

### 跨票改写（经协调代理授权）

`scripts/verify-switch.mjs`「verification 2」里那条负向对照原本断言裸 `<input type="checkbox">` 保持 UA 外观。spec §8 要求裸 checkbox/radio 成体系可用，`form.css` 第 3 节落地后该断言前提过时（实测 `read appearance none`）。改写保留原意（角色才是锚点、第 1 节的几何不外泄），**未删除、未改成恒真**：裸 checkbox 是 20×20 方框、尺寸不等于 switch 的 40×28、`::before` 是 `position: static` 且无阴影的 mark（不是 switch 那个绝对定位、带 sm 档的 16px thumb）。证伪跑过：把第 1 节的 `input[role="switch"]::before` 临时改成也命中 `input[type="checkbox"]` → 该断言转红（`mark position absolute`）；撤回并重建产物 → 恢复绿（21/21）。11 号票的 `## Comments` 已记这一笔。

### 回归（全绿，全部在合入 `feat/barnacle-v1` 之后、最终产物上跑）

| 命令 | 结果 |
|---|---|
| `npm test` | exit 0，78 pass / 0 fail |
| `npm run test:browser` | exit 0，11 pass / 0 fail |
| `npm run test:browser:mutations` | 11 个 mutant + 未变异对照，全部 as designed |
| `node scripts/verify.mjs` | 21/21 |
| `verify-theme` | 16/16 |
| `verify-site` | 24/24 |
| `verify-site-shell` | 9/9 |
| `verify-base` | 35/35 |
| `verify-demo` | 19/19 |
| `verify-deploy` | 12/12 |
| `verify-button` | 21/21 |
| `verify-tabs` | 19/19 |
| `verify-toast` | 19/19 |
| `verify-dropdown` | 17/17 |
| `verify-interaction` | 15/15 |
| `verify-static` | 26/26 |
| `verify-table` | 34/34 |
| `verify-progress` | 17/17 |
| `verify-layout` | 22/22 |
| `verify-switch` | 21/21（含本票改写的那条） |
| `verify-form` | 21/21 |
| `verify-dialog` | 15/15（合并带入） |
| `verify-accordion` | 29/29（合并带入） |
| `seite build --strict` / `check --strict` | 均 EXIT=0（`✓ Built 18 components, 2 pages` / `✓ No problems found`） |

`package.json` 只新增 `verify:form` 一行（与合并带入的 `verify:dialog`/`verify:accordion` 并存），`"dependencies": {}` 保留；`static/*` 四份产物在合并后统一 `npm run build` 重建并提交。

### 未验证项

- 只在系统 Chrome 155 上测过；Firefox / Safari 未测（`:user-invalid` 在它们的支持情况未实测，只保证规则同时接受 `aria-invalid` 兜底）。
- 真 iOS/Android 触屏未测（`@media (hover: hover)` 的触屏粘滞只在桌面验证过匹配语义）。
- 读屏软件对 fieldset/legend/label 组合与错误态的播报未在 NVDA/VoiceOver 实测（`aria-invalid` 是给它们的钩子，但没有听感证据）。
- `forced-colors`（Windows 高对比度）下重绘的 checkbox/radio 标记是否仍可见未测。
- RTL：字段用逻辑属性（`padding-inline-end`、`margin-inline`），但 `select` 的雪佛龙用物理 `background-position: right …`，`direction: rtl` 下箭头不会镜像；未实测。
- `input[type=file|range|color]` 保持原生（本票范围外，未样式化），`::file-selector-button` 未处理。
- 长文本在 `input` 里是浏览器自身的横向滚动（未自定义滚动条）；多行文本的自动增高（`field-sizing`）未启用。

## Resolution

Resolved on the integration branch `feat/barnacle-v1` at commit b8d230f.
Closing convention: this tracker has no "done" label, so `Status: resolved` plus the ticked checklist above records closure (see `docs/agents/issue-tracker.md`).
Verify with: `npm run verify:form`
