# 15: Accordion

**What to build:** 用原生 `details` / `summary` 折叠面板。展开指示器的位移与阴影偏移同源，所以换一种阴影风味时它的动作也自动跟着变。

**Blocked by:** 09

**Status:** resolved

- [x] 原生 `details` / `summary` 呈正确外观，收起与展开两态都可辨
- [x] 展开指示器的旋转或位移与 `--bn-shadow-x/y` 同源派生（§3 不变量 3）
- [x] 无需脚本即可开合；键盘（Enter / Space）与焦点环均可用
- [x] 开合**不改变边框宽度**，不引起栅格重排
- [x] 文档站出现「Accordion」页，含多面板与嵌套示例中的至少一种

**验证方式**

1. 覆盖 `--bn-shadow-x`，确认指示器动作同步变化。
2. 开合面板前后读取容器尺寸，确认无非预期跳动。
3. 禁用 JavaScript，确认开合仍可用。

## Answer

### 0. 交付物与提交

| 文件 | 说明 |
|---|---|
| `src/css/accordion.css` | 162 行，`@layer components`（层由 `CSS_MANIFEST` 指定，文件内无 `@layer`） |
| `content/components/accordion.md` | 组件页：单面板 → 多面板（3 个）→ 嵌套（2 层）→ 指示器与阴影尺度 → 键盘与焦点 → 覆盖方式；正文无 H2、无尾斜杠链接、只有标准围栏 |
| `scripts/verify-accordion.mjs` | 20 项静态/构建页断言 + 9 项真 Chrome 断言 = 29 项；`npm run verify:accordion` |
| `static/barnacle.css`、`static/barnacle.min.css` | `npm run build` 重建（`barnacle.js/.min.js` 无改动，本票无 JS） |

提交：实现 `fd540d6`（`Dress the bare details/summary accordion with a shadow-scaled mark (ticket 15)`），随后 `git merge feat/barnacle-v1`（并入 `7e6e1d1`，合并后重新 `npm run build`，产物无冲突），本文档单独提交。分支 `ticket/15-accordion`。

### 1. 外观：收起与展开两态都可辨（bullet 1）

`details` 只在静止处声明一次框与阴影（`border: var(--bn-border-width) solid var(--bn-border-color)`、`border-radius: var(--bn-radius)`、`background: var(--bn-secondary-background)`、`box-shadow: var(--bn-shadow-sm)`），`summary` 是 flex 行、显示字重、无自己的边框；状态轴只有 `details[open]`。

指示器是 `summary::after` 的方角方块（内容盒 = 3 个结构边框宽，整体随 `--bn-border-width` 缩放）：**收起 = 静止的方形**（`--bn-main` 填充），**展开 = 旋转 45° 的菱形 + 位移 + `--bn-danger` 填充**。实测（真 Chrome 155，`static/barnacle.css`）：

- 收起：外框 `3px solid rgb(0, 0, 0)`、`box-shadow: rgb(0, 0, 0) 2px 2px 0px 0px`、`summary` `display: flex` / `font-weight: 700` / 边框 `0px/0px/0px/0px` / `padding 12px/12px/16px/16px`；指示器内容盒 `9px×9px`、边框 `3px solid rgb(0, 0, 0)`、填充 `rgb(255, 210, 63)`、`translate` 无、`rotate` 无。
- 展开：指示器 `translate: -2px -2px`、`rotate: 45deg`、填充 `rgb(255, 107, 107)`；面板分隔线 `border-block-start: 3px solid rgb(0, 0, 0)`，并贴着外框（无缝隙，不会读成双线）。

### 2. 指示器动作与 `--bn-shadow-x/y` 同源（bullet 2，验证方式 1）

```css
summary::after {                                  /* 收起：静止的方形 */
  inline-size: calc(var(--bn-border-width) * 3);
  block-size: calc(var(--bn-border-width) * 3);
  background-color: var(--bn-main);
}

details[open] > summary::after {                  /* 展开：位移 + 旋转 + 变色 */
  translate: var(--_lift-x) var(--_lift-y);       /* 唯一一处位移，两个槽位 */
  rotate: 45deg;                                  /* 角度不是位移 */
  background-color: var(--bn-danger);
}
```

链条是既有的单一来源，`verify-accordion` 把它当成断言而不是注释：
`--bn-shadow-x: 4px` →（01-theme）`--bn-shadow-lift: calc(var(--bn-shadow-x) / 2)` = 2px →（00-base 冻结槽位）`--_lift-x/-y: calc(var(--bn-shadow-lift) * -1)` = −2px → 指示器 `translate`。

`document.documentElement.style.setProperty('--bn-shadow-x', '8px')`（同时设 y）后实测：

| 读数 | 覆盖前 | 覆盖后 |
|---|---|---|
| 指示器 `getComputedStyle(summary, '::after').translate` | `-2px -2px` | `-4px -4px` |
| `details` 的 `box-shadow` 偏移 | `rgb(0, 0, 0) 2px 2px 0px 0px` | `rgb(0, 0, 0) 4px 4px 0px 0px` |
| 指示器 `rotate` | `45deg` | `45deg`（旋转是状态，不随尺度变） |
| `summary` 盒 | — | 宽高不变（位移不参与布局） |
| 收起态指示器 | `translate` 为 0 | 仍为 0（只是一次令牌覆盖，不是开合的副作用） |

一个令牌同时拉动「阴影偏移」与「指示器行程」，且文件内 0 个位移字面量（静态断言：所有 `translate` 声明必须恰好是 `var(--_lift-x) var(--_lift-y)`，无 `transform` 声明，`rotate` 只能是角度）。

### 3. 开合不改边框宽度、无栅格重排（bullet 4，验证方式 2）

状态规则只允许重绘与位移：`details[open] > summary::after` 只有 `translate` / `rotate` / `background-color`，`summary` 不拥有任何边框（静态断言禁止 summary 上出现 `border*`），分隔线挂在**面板的第一个内容元素**上（`details > summary + :not(details)`，全文件只有一条规则画它），因此它是「随内容出现」，而不是把表头加粗。真 Chrome 开合前后读数：

- `details` 边框 `3px/3px/3px/3px`、`summary` 边框 `0px/0px/0px/0px` —— 前后一致；
- `summary` 盒 `1258 × 49.59px`（x/y/width/height 全部 Δ < 0.01px）；
- `details` 的 x/y/width 不变（宽 `1264px`），只有高度增加（内容出现）；
- 后一个面板的下移量 `+52.6px` **恰好等于**本条增加的高度 `+52.6px`（容差 0.51px）——即「唯一的变化是出现的那块面板」；
- `main.clientWidth` 与 `documentElement.scrollWidth ≤ innerWidth` 在开合前后都成立。

### 4. 无脚本可开合、键盘与焦点环（bullet 3，验证方式 3）

- **零 JS**：`javaScriptEnabled: false` 的上下文里（页面无 `<script>`）`page.click('#summary-one')` 后 `details.open === true`，指示器 `rotate 45deg` / `translate -2px -2px`，外框 `3px/3px/3px/3px` 全部由产物渲染。
- **键盘**：真键盘 `Tab` 第一个命中 `summary`（`:focus-visible` 为真），实测 `outline: 3px solid rgb(116, 185, 255)` + `outline-offset: 3px`，开合后焦点环仍在；`Enter` → open、`Enter` → closed、`Space` → open、`Space` → closed。
- **焦点环不重复声明**：3px/offset 3px 就是 00-base 的单一 `:focus-visible` 规则（`--_focus-ring` / `--_focus-ring-offset`）。**偏离**：配方 §14 建议给 `summary:focus-visible` 写 `outline-offset: calc(var(--bn-border-width) * -1)`（内收），本票的验收明确要求 offset 3px，所以不覆盖；反过来加了一条静态断言「accordion.css 不得重述焦点环」，防止第二个不同的 offset 出现。

### 5. 文档页（bullet 5）

`content/components/accordion.md`：引导语点名 `details`/`summary`，然后是 1 个单面板示例、3 个面板的堆叠、2 层嵌套（`div` 包裹 + 直接子 `details` 两种都在正文里说明），再用 H3 讲指示器与阴影尺度（含 `--bn-shadow-x` 覆盖示例，并写明必须落在 `:root` / `document.documentElement`）、键盘与焦点、覆盖方式。构建页实测：`seite build` exit 0、索引链接 `/components/accordion`、产物页保留原始围栏（转义文本）与唯一注入 H2；真 Chrome 里预览面板确实渲染库的 `details`（外框 3px、`box-shadow: rgb(0,0,0) 2px 2px`、`summary` flex、指示器 9px），点击后 `45deg @ -2px -2px`，375px 下 `scrollWidth 375 ≤ innerWidth 375`、无 console/page error、正文 0 个作者 H2。

### 6. verify:accordion 断言清单（29 项，全绿）

- 静态 11 项：无 BOM / 无 `@layer`；只用 `--bn-*`（限定 spec §6.1 词汇表）与 `--_*`（限定 00-base 冻结槽位，**0 个自造、0 个槽位声明**）；无 `!important`、无颜色字面量、`color-mix()` 只混令牌；**全文件 0 个 px 字面量**；几何只读令牌（`box-shadow` 必须是 tier 令牌、`translate` 必须是两个 lift 槽位、无 `transform`、`rotate` 必须是角度）；同源链条逐环存在；状态规则不得改任何 box metric；summary 不得拥有边框且分隔线只有一条规则（挂在 `summary + …`）；必需选择器齐全；transition 只在 `no-preference` 块内、无 reduce 块、无 animation；焦点环不得重述；产物 `@layer components` 块与 min 产物都带关键声明。
- 文档页静态 5 项：组件页形态（frontmatter / 无 H1H2 / 纯语言围栏 / 无短代码 / 正文无裸 HTML）、**多面板示例（≥2 个同级 `details`）与嵌套示例（深度 2）都在**、示例是裸锚点且无 class 无 script、正文点名两个锚点并覆盖 Enter/Space/焦点/`--bn-shadow-x`、无尾斜杠链接。
- 构建页 3 项：`seite build` exit 0、索引列出页面、产物页保留围栏与唯一 H2。
- 浏览器 9 项：收起外观、展开可辨、开合无跳动、真 Tab + 焦点环 + Enter/Space、`--bn-shadow-x` 覆盖同步、动效守卫（`no-preference` 下 `rotate, translate, background-color` @ `0.15s`；`reduce` 下 `0s` 且外观不变）、无 JS 点击开合、暗色（表面 `rgb(38,38,38)`、框 `rgb(255,253,245)`、影 `rgb(255, 253, 245) 2px 2px 0px 0px`、正文对比度 `14.86:1`、指示器仍是 danger）、文档页真 Chrome 运行（见 §5）。

### 7. 实现期决策与偏离（供评审）

1. **指示器用 `translate` 属性而不是 `transform`**：`translate: var(--_lift-x) var(--_lift-y)` 与 `rotate: 45deg` 是两个独立属性，位移与旋转不会互相覆盖，且 `verify-interaction` 的 `translate()` 校验能把它读成「两个槽位」；`transform: translate(...) rotate(45deg)` 会是一条带角度的列表，无法被机械判成「只读槽位」。
2. **`details` 的阴影直接读 `var(--bn-shadow-sm)`**，而不是把 `--_shadow-rest` 重新指向 sm：本组件没有任何状态会升档，且 `  box-shadow: var(--_shadow-rest);` 这一行与 `table.css` 逐字相同（决策 §13：mutation-sweep 的注入模式需要唯一）。合并后的 mutation sweep 改为按「层 + 规则前奏」定位，本文件的规则前奏全部唯一。
3. **面板内容的 `max-inline-size: none`**：`p` 继承基础排版的 68ch 阅读宽度，会让「summary + 内容」的分隔线在半空中断掉（截图实测）；面板自己就是尺度，所以内容铺满条目。这是本文件唯一一处覆盖基础排版的地方，已在文件注释里写明理由。
4. **嵌套的直接子 `details` 被排除在 padding/分隔线之外**，改成 `margin-block: 0.75rem`：它自带外框，再加 padding 会形成「框里套框」；`div` 包裹的嵌套照常吃外层 padding。
5. **没有面板入场动画**：`@keyframes` 归 `animations.css`（决策 §11），而 `animation: … var(--_motion) …` 是已知会整条失效的形状（决策 §13），且没有单独的「只有时长」的令牌。本票的动效只有指示器的 transition（在 `no-preference` 内）。
6. **没有 hover 抬升**：手风琴在页面流里，抬升会带着下面所有内容一起动（配方 §14）。hover 只做色调（`color-mix(in srgb, var(--bn-main) 30%, var(--bn-secondary-background))`，两套主题自动翻转），仍在 `(hover: hover)` 守卫内。
7. **没有把 accordion.css 加进 `verify-interaction.mjs` 的 `CONTRACT_FILES`**：那份清单是 09 票的资产、且只针对「hover 抬升 / 按下」几何；本组件按上一条刻意不参与抬升。本票自己的静态断言已覆盖同一批约束（槽位唯一来源、无字面量位移、无字面量阴影、动效守卫、状态不改 box metric）。

### 8. 回归（合并 `feat/barnacle-v1` 之后，全部 EXIT=0）

`npm test` 78 pass / 0 fail；`npm run test:browser` 11/11；`node scripts/verify.mjs` 21/21；`verify-theme` 16/16；`verify-site` 24/24；`verify-base` 35/35；`verify-demo` 19/19；`verify-deploy` 12/12；`verify-button` 21/21；`verify-tabs` 19/19；`verify-toast` 19/19；`verify-dropdown` 17/17；`verify-interaction` 15/15；`verify-static` 26/26；`verify-table` 34/34；`verify-progress` 17/17；`verify-layout` 22/22；`verify:accordion` 29/29；合并进来的 `verify:site-shell` 9/9；`seite build --dir . --strict` EXIT=0；`seite check --dir . --strict` EXIT=0（`✓ No problems found`）。未删改任何既有断言。
**额外非空证据**（不在本票清单内，但合并刚刚改过它）：`node tests/browser/mutation-sweep.mjs` → 11 个变异体 **11/11 captured as designed**，未变异的产物仍全绿、`static/barnacle.css` 的 sha256 未被改写。

### 9. 未验证项

- 只测了本机系统 Chrome 155（`channel: 'chrome'`）：独立 `translate`/`rotate` 属性、`summary::-webkit-details-marker`、`color-mix()` 在 Firefox/Safari 上未实测；Safari 里 `summary { display: flex }` 与 marker 的交互未验证。
- 「无 JS + 保留动画」的组合没有直接测：JS 关闭时注入冻结样式表的 init script 也无法运行，所以那条检查用 `reducedMotion: 'reduce'`（无 transition）读终态；动画本身由另一条 `no-preference` 检查覆盖。
- 面板内含宽 `table` / 长代码块时的横向行为未测（外层仍可用 `figure` / `.bn-table-scroll`，但没有针对面板内的实测）。
- RTL 未实测（用的是逻辑属性 `border-block-start` / `padding-inline`）。
- `details[open]` 的开合动画在 `prefers-reduced-motion: reduce` 下是「无过渡」而不是「更快的过渡」——这是设计选择，没有做视觉回归截图对比。

## Resolution

Resolved on the integration branch `feat/barnacle-v1` at commit b8d230f.
Closing convention: this tracker has no "done" label, so `Status: resolved` plus the ticked checklist above records closure (see `docs/agents/issue-tracker.md`).
Verify with: `npm run verify:accordion`
