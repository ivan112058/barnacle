# 16: Progress / Meter

**What to build:** `progress` 与 `meter` 共用一套槽与填充。两者文档粒度不同、样式实现同源——这是「文档粒度 ≠ 文件粒度」的第一个例子，故意不为 1:1 拆文件。

**Blocked by:** 09

**Status:** ready-for-agent

- [ ] 裸 `progress` 与 `meter` 共用同一套槽与填充样式，不各写一份
- [ ] `progress` 的不确定态（无 `value`）有可辨的呈现
- [ ] 语义变体走 `data-variant`，与强调色令牌挂钩
- [ ] 填充的动画受 `prefers-reduced-motion` 守卫
- [ ] 无脚本时两者均以正确外观呈现
- [ ] 文档站出现「Progress / Meter」页，同页覆盖两个元素与各自变体

**验证方式**

1. 逐档设置 `value`，确认填充比例正确且槽宽不变。
2. 移除 `value` 触发不确定态，确认外观合理。
3. 覆盖 `data-variant`，确认填充色跟随语义变体。

## Answer

**分支** `ticket/16-progress-meter`，commit `b3df63d`（父提交 `52a9d2e` = `feat/barnacle-v1` tip，`git merge feat/barnacle-v1` 报 Already up to date）。

### 实现摘要

一个文件两个元素，且**共用一套槽与填充**：`src/css/progress.css` 里 13 条规则全部写作 `:is(progress, meter)…`，文件里没有任何一条规则单独点名 `progress` 或 `meter`（由 `verify-progress` 断言：两个锚点各自的出现次数 === `:is(progress, meter)` 出现次数）。盒子（`appearance/display/inline-size/block-size/box-sizing/overflow/border-*/background-color/box-shadow/vertical-align`）只在**一条**规则里声明一次，填充色只在**一条**规则里读 `var(--_variant-color, var(--bn-main))` 并同时挂到 `::-webkit-progress-value`、`::-moz-progress-bar`、`::-moz-meter-bar`。

**填充几何不由我们重算**：`value`/`max`（以及 meter 的 `min/low/high/optimum`）是语义输入，比例由引擎自己布局（`::-webkit-progress-value`、`::-webkit-meter-*-value`），CSS 只决定颜色——比例因而永远不可能和 `value` 不一致。实测 25/50/100 三档分别为 25.2%/50.0%/100.0%。

**不确定态的实测结论（Chrome 155.0.8059.82，两条都是实测而非假设）：**

1. `progress:indeterminate` 命中无 `value` 的 `progress`（`progress:not([value])` 同样命中；最终写的是语义伪类 `:indeterminate`）。**无值的 `<meter>` 只被 `:not([value])` 命中，`:indeterminate` 不命中**——所以这一节实际上只服务 `progress`，节内注释已如实写明（原配方里「也覆盖无值 meter」的说法是错的）。
2. `appearance: none` 会连同 UA 自己的不确定态扫描动画一起拿掉，于是无值 `progress` **在没有任何额外规则时就是一整条空槽**——「长度未知的任务」和「0% 的任务」长得一模一样。这是本节存在的理由：给主色描边 + 135° 斜向 hatch（`repeating-linear-gradient` + `background-size: 0.5em 0.5em`，尺寸从元素自身字号派生，不是幻数像素），静止也读得出「比例未知」。

**`data-variant` 挂法**：映射仍只在 `01-theme.css`（本文件 0 条 `[data-variant]` 映射）。消费点有两处，因为两者画填充的位置不同：

- `progress` 的填充在 `::-webkit-progress-value` → `:is(progress, meter)::-webkit-progress-value { background: var(--_variant-color, var(--bn-main)); }`（+ 两个 `-moz-` 伪元素）。
- **`meter` 的填充在引擎选中的 `::-webkit-meter-*-value` 波段里，实测该波段胜过元素自身背景与 `::-webkit-meter-bar`**——只写第一条时 `meter[data-variant]` 会静默失效（红/绿/黄全都不动）。因此追加一条规则把三个波段伪元素都刷成 `var(--_variant-color)`；任一时刻只有一个波段被绘制，所以一条规则即可、也不会互相冲突。语义变体**优先于** meter 波段（作者说「这条是状态条」时以此为准），无变体时三段波段保持原样。

**动画守卫与一个 Chrome 陷阱（写进注释）**：不确定态的斜纹爬行写在 `@media (prefers-reduced-motion: no-preference)` 里（`reduce` 下只是不动，不是事后关掉）。这里**不能用 `animation` 简写**：`animation: bn-progress-crawl var(--_motion) linear infinite` 在 Chrome 155 下整条声明计算为空（`animation-name`/`-duration` 全部回落到初始值），因为 `--_motion` → `var(--bn-transition)` 展开是多组分的 `150ms ease`，简写在替换后才重新解析、`ease` 不再符合 `<time>`，invalid-at-computed-value-time 的简写整体回落到初始值而不是回落到级联。改用四个 longhand 后正常工作（实测 `bn-progress-crawl 0.75s ×infinite`，`getAnimations()` = 1）。爬行时长放在 `--_crawl: 750ms`（一个 hatch 周期），紧挨它绑定的 `0.5em` 栅格周期。

**与规格的一处必要偏离**：spec §5/配方把 `progress.css` 列在 `base` 层，实际构建链 `CSS_MANIFEST`（ticket 01 的既成事实）把它放在 `components` 层。本 ticket 无权改 `scripts/build.mjs`，因此**保持 `components`**。这比 spec 更合适：`base` 层的裸元素默认外观本意是「可被组件覆盖」，而进度条是完整组件；`verify-progress` 断言的层归属即 `components`。

### 验证方式与实测读数

**`npm run verify:progress`（新增，17/17 PASS，EXIT=0）**

静态 10 项：UTF-8 无 BOM / 无 `@layer`；命名只用 `--bn-*` 与 `--_*`（不新造几何槽、不改写 00-base 的冻结槽、不声明 `--_variant-color`）；无颜色字面量与 `!important`；几何属性（`transform/translate/box-shadow/outline*/transition*`）全部读 `--_` 或影子档令牌（本文件用 `var(--bn-shadow-sm)`）；两个锚点零独立规则；不确定态有本体（非伪元素）可绘制规则且含 hatch；变体规则挂在共用选择器上且覆盖 meter 波段；语义通道只读不写；动画全在 `no-preference` 守卫内、无 `reduce` 块、`@keyframes bn-progress-crawl` 带 `bn-` 前缀；产物里这段规则位于 `@layer components` 且无几何字面量；文档页覆盖两个元素、3 个变体、0 个作者 H2、围栏只带语言标记、无尾斜杠链接。

浏览器 7 项（真 Chrome，冻结 `transition`/`animation`；填充比例是**逐像素读元素截图**算出来的，不读 CSS）：

| value | 实测填充占比 | 槽外框 | 槽内宽 | 填充像素 |
|---|---|---|---|---|
| 0 | 0.0% | 320×20px | 314px | 0 |
| 25 | 25.2% | 320×20px | 314px | 79 |
| 50 | 50.0% | 320×20px | 314px | 157 |
| 100 | 100.0% | 320×20px | 314px | 314 |

**槽宽不变的实测值**：四档 + 无值 + 全部变体 + 全部 meter，框宽集合 = `{320}`、框高集合 = `{20}`、`inline-start` 集合 = `{8}`（唯一值，即整页没有一个槽随 `value` 移动）。

- 不确定态：`p50` 移除 `value` 后 `:indeterminate` 命中，填充行是 **79 条等宽 4px 条纹**、严格交替 `rgb(255, 210, 63)` / `rgb(255, 255, 255)`，边框 = `--bn-main`；标记即无值的 `progress` 渲染同形；无值 `meter` 保持 320px 槽。
- `data-variant`（progress 与 meter 各一遍，取色值来自浏览器实际解析的 `--_variant-color`）：`success → rgb(136, 212, 152)`、`warning → rgb(255, 165, 82)`、`danger → rgb(255, 107, 107)`、`error → rgb(255, 107, 107)`（= danger 别名）、无变体 → `rgb(255, 210, 63)`；每个都是 50% 填充。meter 三段：`m-opt 90.1%` 绿、`m-sub 50.0%` 橙、`m-bad 9.9%` 红，无 `low/high/optimum` 的 meter = optimum。
- motion：`no-preference` → `animationName=bn-progress-crawl`、`0.75s ×infinite`、`getAnimations()=1`；`reduce` → `animationName=none`、`0s`、`0` 个动画，**hatch 与主色边框仍在**，100% 条仍实测 100%。
- 无脚本（`javaScriptEnabled: false`）：`progress`/`meter` 均 320×20px、`appearance: none`、3px 边框、硬阴影仍在。

**回归（全部 EXIT=0，未删改任何既有断言）**

`npm test` 78/78；`npm run test:browser` 11/11；`verify` 21/21；`verify:theme` 16/16；`verify:site` 24/24；`verify:base` 35/35；`verify:demo` 19/19；`verify:deploy` 12/12；`verify:button` 21/21；`verify:tabs` 19/19；`verify:toast` 19/19；`verify:dropdown` 17/17；`seite build --strict` EXIT=0；`seite check --strict` EXIT=0（No problems found）。产物已重建并提交（`barnacle.css`/`barnacle.min.css`）。

### 未验证项（如实列出）

1. **Firefox**：配方 §15 要求「Chromium 与 Firefox 各看一次 5 个状态」。本机只有系统 Chrome，`playwright-core` 不下载浏览器，**Firefox 侧完全未验证**——`::-moz-progress-bar` / `::-moz-meter-bar` 的写法按规范书写但未经运行时确认。需要 Firefox 的验收动作留给有此环境的人。
2. **不确定态斜纹爬行的实际视觉位移**未逐帧比对；已断言的是动画确实被声明并在运行（`getAnimations()`=1、`animation-name` 非 `none`），以及在 `reduce` 下为 0。
3. **`meter` 在无值时的呈现**：实测为空白轨道（Chrome 155 的 `meter` 不匹配 `:indeterminate`），本 ticket 未给它额外外观——若验收要求「无值 meter 也要可辨」，需另开一条并先确认浏览器行为。
4. 文档页的预览/代码双标签（`static/site.js`）在浏览器里的实际改造结果未逐页目视，只断言了构建产物「0 个作者 H2 + 原始围栏 + 两个元素齐备」，以及 `verify:demo` 的既有断言全绿。
