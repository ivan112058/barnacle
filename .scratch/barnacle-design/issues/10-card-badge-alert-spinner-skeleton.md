# 10: Card / Badge / Alert / Spinner / Skeleton

**What to build:** 五个静态组件一次落地，覆盖三种锚点形态：有语义元素的（`article`、`[role="alert"]`）、无语义元素只能靠类名的（`.bn-badge`）、以及同锚点不同职责的（`[role="status"]` 分给加载指示与占位）。强调色卡片要求边框与阴影同色，这是 `--bn-shadow-color` 单列出来的第一个真实用例。

**Blocked by:** 09

**Status:** ready-for-agent

- [ ] **Card**：裸 `article` 呈卡片外观；含强调色变体，该变体下边框色与阴影色同步，不脱节
- [ ] **Badge**：`.bn-badge` 就位；无语义元素可用的场合才用类名（ADR-0001）
- [ ] **Alert**：`[role="alert"]` 就位；语义变体走 `data-variant`，外观不硬编码颜色名
- [ ] **Spinner**：`[role="status"]` 就位；纯 CSS 动画，且入场动画写在 `no-preference` 块内
- [ ] **Skeleton**：`[role="status"]` 就位；加载占位在不支持动效的环境下仍然表达「正在加载」
- [ ] 五个组件**各自一页**，每页一句引导语点名所用语义锚点 + 可运行示例，正文不出现 H2

**验证方式**

1. 逐页目视确认五个组件在亮色与暗色下都成立。
2. 在强调色卡片上覆盖 `--bn-shadow-color`，确认边框与阴影同步变化。
3. 打开「减少动态效果」，确认 Spinner 与 Skeleton 的动画被守卫，且骨架仍然可辨。

## Answer

### 实现摘要

- 分支 `ticket/10-static-components`，基于 `feat/barnacle-v1`（`52a9d2e`），实现提交见文末。
- 交付：`src/css/{card,badge,alert,spinner,skeleton}.css`、`content/components/{card,badge,alert,spinner,skeleton}.md`、`scripts/verify-static.mjs`（`npm run verify:static`，26 项 = 14 静态 + 12 真实 Chrome），`package.json` 只新增一条 script（`dependencies: {}` 保留）。

**锚点与命名（ADR-0001 / ADR-0005 / 决策 §1）**

| 组件 | 语义锚点 | `bn-` 外观类名 |
|---|---|---|
| Card | 裸 `article` | `.bn-pink` `.bn-blue` `.bn-green` `.bn-orange` `.bn-lavender`（强调色轴，在 `card.css` 声明一次，全库共用） |
| Badge | `.bn-badge`（无语义元素可用） | `.bn-solid` `.bn-outline` `.bn-sm` `.bn-lg` |
| Alert | `[role="alert"]` | `.bn-solid` |
| Spinner | `[role="status"]`（默认外观，决策 §3C） | `.bn-spinner`（显式别名，同一规则列表） |
| Skeleton | `.bn-skeleton`（决策 §3C 的覆盖物；文档示例同时写 `role="status"`） | — |

语义轴一律只消费 `--_variant-color`：五个文件里 **0 处** `--bn-success/-warning/-danger` 字面引用（脚本断言）。`--_variant-color` 只被 `.bn-pink`…`.bn-lavender` 这五个外观类声明——它们只匹配显式点名颜色的元素，因此不会像「裸元素规则」那样在 components 层压过 theme 层的 `data-variant` 映射（toast.css 头部记录的那个坑）。

**强调色卡片的边框与阴影同色（关键 CSS，实测驱动）**

```css
article {                                  /* 中性卡：原封不动的 md 档 */
  border-color: var(--_variant-color, var(--bn-border-color));
  box-shadow: var(--bn-shadow-md);
}

article:is([data-variant="success"], [data-variant="warning"], [data-variant="danger"],
           [data-variant="error"], .bn-pink, .bn-blue, .bn-green, .bn-orange, .bn-lavender) {
  --bn-shadow-color: var(--_variant-color);   /* 颜色重新发布到公共通道 */
  box-shadow: var(--bn-shadow-x) var(--bn-shadow-y) 0 0 var(--bn-shadow-color);  /* md 形状就地重derive */
}
```

为什么必须重写形状：`--bn-shadow-md` 在 `:root` 上就把 `--bn-shadow-color` 替换进字符串了，后代再改 `--bn-shadow-color` 对 `box-shadow` **无效**（决策 §8，ticket 05 实测；ticket 22 的 `toast.css` 头部与 `toast.md` 结尾也记了同一事实）。本题把「边框与阴影同色」当作要保证的**结果**：
- 偏移仍取 `--bn-shadow-x/y`，模糊/扩展仍是 spec §3 不变量 2 的 0，颜色取公共 `--bn-shadow-color`；中性元素一个字节不改地读 `--bn-shadow-md`/`--bn-shadow-sm`（脚本断言中性卡/徽章/告警的计算阴影与 `rgb(0,0,0) 4px 4px 0px 0px` / `2px 2px 0px 0px` 逐字相同，防止重derive 漂移）。
- 阴影**写在 `box-shadow` 属性上，不覆盖 `--_shadow-rest` 槽位**：槽位会被后代继承，强调色卡里放一个 `<button>` 会让按钮的阴影跟着变粉、悬停再跳回黑（这是实测出来的真实缺陷）。脚本对这一点有专门断言与夹具（`#card-with-button`）。
- 实测：`--bn-pink` 卡 `borderTopColor: rgb(255, 107, 107)` + `boxShadow: rgb(255, 107, 107) 4px 4px 0px 0px`；在卡上覆盖 `--bn-shadow-color: rgb(116,185,255)` → 阴影变蓝（这是 `--bn-shadow-color` 单列出来的第一个真实用例）。Badge / Alert 用同一机制，档位 sm（`calc(var(--bn-shadow-x) / 2) …`）。

**Spinner / Skeleton 的区分与动效守卫**

- 区分：`[role="status"]` 默认 = 转圈（规则写成 `:is([role="status"], .bn-spinner):not(.bn-skeleton)`，覆盖关系写在选择器里，**不依赖文件顺序**）；`.bn-skeleton` 是加载占位。同一页面上两者同时存在时，环是圆的（`border-radius: 50%`）、骨架是方的（`--bn-radius: 0`），各自动画 `bn-spin` / `bn-shimmer`。
- 动效守卫：五个文件里 **0 个** `prefers-reduced-motion: reduce` 块；`animation`/`transition` 只有 3 条，全部在 `@media (prefers-reduced-motion: no-preference)` 内；关键帧 `@keyframes bn-spin`（spinner.css）与 `@keyframes bn-shimmer`（skeleton.css）写在自己的文件里，`animations.css` 未被改动（决策 §11）。
- `reduce` 下仍能表达「正在加载」：环的边框与高亮弧**无条件绘制**（不在任何媒体查询内），所以停走的是一个缺口的环 —— 缺口弧即加载字形，且 `aria-label` 是可读的名字；骨架同样无条件带边框与固定的高光渐变，停走时仍是一块可辨的占位。实测 reduce 下：`animationName: none`，但 `borderTopColor: rgb(255,210,63)`、`borderBottomColor: color(srgb 0 0 0 / 0.2)`、24×24 的环仍在。
- 无障碍：环 24px，无可读文本，所以文档与夹具都用 `aria-label` 给可访问名（`.bn-visually-hidden` 属 Utilities 号票，尚未落地，未依赖它）。

### 逐条验证方式：确切命令与实测读数

1. **逐页目视确认（亮/暗）** — `node .scratch/shots.mjs`（临时脚本，未提交）从 `dist/` 出图，用生产 origin 拦截请求，不改产物。10 张全页图在 `.scratch/shots/`（`components-{card,badge,alert,spinner,skeleton}-{light,dark}.png`）。结论：五个组件在亮/暗两套模式都成立；徽章的 success/warning/danger/实心/描边/尺寸、告警的 6px 侧条 + sm 阴影 + `.bn-solid` 实心、旋转环的轨道与弧、骨架的固定高光都正常。
2. **强调色卡片覆盖 `--bn-shadow-color`** — `npm run verify:static` 的 `verification 2: overriding --bn-shadow-color on an accent card moves the shadow`：`--bn-shadow-color override → rgb(116, 185, 255) 4px 4px 0px 0px`（在卡上覆盖有效；这正是 `:root` 替换语义下唯一能生效的落点）。
3. **减少动态效果** — 同脚本 `verification 3: reduced motion stops the spin, and the ring still says "loading"`：reduce 下 `animationName: none / animationDuration: 0s`，环几何完整、骨架仍是带边框 + 高光的 160×48 方块；`no-preference` 下骨架 `bn-shimmer`、环 `0.7s`。

### 五个文档页实测

- `seite build --strict` → EXIT=0，`✓ Built 10 components, 2 pages`；`seite check --strict` → EXIT=0，`✓ No problems found`。
- 索引页列出五个新页：`dist/components/index.html` 命中 `components/{card,badge,alert,spinner,skeleton}"` 五条链接。
- 每页：frontmatter 有 `title`/`description`；首句点名锚点（`article` / `.bn-badge` / `[role="alert"]` / `[role="status"]` / `.bn-skeleton`+`[role="status"]`）；正文无 H1/H2（渲染后每页恰好 1 个模板注入的 H2，`verify-demo` 19/19 覆盖全部组件页）；链接无尾斜杠；围栏只有 `html`/`css` 标准语言标记（card 3 / badge 3 / alert 3 / spinner 3 / skeleton 2）。

### `scripts/verify-static.mjs` 断言清单（26 项，全绿）

静态 14 项：五文件无 BOM / 不写 `@layer` / 非空；命名只有 `--bn-*`（spec §6.1 全表）与 `--_*`，新增内部槽位仅 `--_size`/`--_stroke`/`--_shimmer`，`--_variant-color` 只许被五个 accent 类声明；0 颜色字面量、0 `!important`；`box-shadow` 只能是 `--bn-shadow-sm/md` 或那两种重derive 形状、且不含 px/rem 数值；所有 `border-width` 派生自 `--bn-border-width`（环为 `calc(var(--bn-border-width) * 2 / 3)`）；`[data-variant]` 规则只承载颜色；accent 轴与形状轴的类名齐备；彩色卡的 `--bn-shadow-color` 发布 + 重derive + **0 个 `--_shadow-*` 槽位覆盖**；动效只在 `no-preference` 内且 0 个 reduce 块；关键帧归属正确且环/高光无条件；决策 §3C 的覆盖关系；产物里五个 `@layer components` 块与 5 条关键声明；文档站标记无 `role="status"/"alert"` 且库文件不出现 `site-`；五页的锚点/结构/围栏/链接规矩。
浏览器 12 项（真实 Chrome 155.0.8059.82，`channel: 'chrome'`，过渡与动画冻结后再读）：裸 `article` 卡片几何；强调色卡边框=阴影同色；覆盖 `--bn-shadow-color` 移动阴影；暗色翻白且强调色不变；`data-variant="danger"` 经 theme 映射生效（证明未压过映射）；强调色卡里的按钮阴影不被染色；徽章 sm 档 / 悬停不位移 / 变体同色 / secondary 保持结构色 / `.bn-solid` / `.bn-outline` / 尺寸只改字；告警 6px 侧条 + sm + warning 变体 + 实心；`[role="status"]` 环 24px（含描边，border-box）/ 2px 描边 / `--bn-main` 弧 / `bn-spin infinite` / 有可访问名；reduce 与 no-preference 双向；骨架≠环；无 JS 全部成立。

### 回归结论（全绿，未删改任何既有断言）

`npm test` EXIT=0 ｜ `npm run test:browser` **11/11 pass, 0 fail** ｜ `verify.mjs` 21/21 ｜ `verify-theme` 16/16 ｜ `verify-site` 24/24 ｜ `verify-base` 35/35 ｜ `verify-demo` 19/19 ｜ `verify-deploy` 12/12 ｜ `verify-button` 21/21 ｜ `verify-tabs` 19/19 ｜ `verify-toast` 19/19 ｜ `verify-dropdown` 17/17 ｜ `verify-static` 26/26 ｜ 全部 EXIT=0。原始日志：`.scratch/regression.log`。

### 偏离说明与未验证项

1. **决策 §4 的有意偏离（色彩阴影重derive）**：三处组件文件里出现 `var(--bn-shadow-x) var(--bn-shadow-y) 0 0 var(--bn-shadow-color)`（card 用 md；badge/alert 用 `calc(… / 2)` 的 sm），即「形状在 01-theme.css 之外被复述一次」。理由：本 ticket 的验收要求边框与阴影同色，而只覆盖 `--bn-shadow-color` 在 CSS 替换语义下无法实现（实测 + 决策 §8 + toast.css 先例）。偏移仍来自几何令牌、模糊/扩展仍是不变量 2 的 0，且验证脚本把「中性元素与 `--bn-shadow-*` 逐字节相同」与「不覆盖 `--_shadow-*` 槽位」都固化成断言，故不会与 01-theme 漂移。ticket 22 在此处选择了「阴影保持结构色」，两者取舍不同源于验收口径不同——已向协调代理汇报，若要求全库统一为「阴影不跟色」，改动只需删掉三条彩色规则里的 `box-shadow` 行。
2. **卡片不做交互抬升**（recipe 提议的 `.bn-interactive` 未实现）：强调色卡的悬停档（lg）同样需要就地重derive 一次 `calc(var(--bn-shadow-x) * 1.5)`，那才是真正的「第二份几何声明」；且 spec §8 的 Card 行只要求颜色变体。已在 `card.css` 头部与 `card.md` 写明「卡片不位移」。
3. **文档站 `article` 碰撞（需别的票一行修复，我未改不属于本票的文件）**：`templates/{component,page}.html` 用 `<article class="site-component">` / `site-page` 包整页，`static/style.css` 里没有对应规则，于是整页被当作卡片上框。按决策 §11，裸元素不受「ARIA 角色需加作用域前缀」约束（那正是语义优先的本意），而修复应落在 02 号票的 `static/style.css`：`.site-component, .site-page { border: 0; box-shadow: none; padding: 0 }`。证据截图 `.scratch/shots/components-card-light.png`。
4. **未验证**：真机触屏（`@media (hover: hover)` 的触屏分支只靠 Playwright 桌面 Chrome 默认匹配验证）；Firefox / Safari（本仓只装 `playwright-core` + 系统 Chrome 155）；`.bn-visually-hidden`（尚未落地，故 spinner 的可访问名走 `aria-label`）；`spinner.md` 里「reduce 下停走但仍可辨」只有脚本断言 + 截图，未做读屏实测。

### 提交

- `b906979` Add Card, Badge, Alert, Spinner and Skeleton with their pages (ticket 10) —— 五个 CSS 文件、五个文档页、`scripts/verify-static.mjs`、`package.json`（`verify:static`）、重建后的四份 `static/` 产物。
- `1b7c31e` Record ticket 10 verification evidence in the issue (ticket 10) —— 本 `## Answer`。
