# 11: Switch

**What to build:** 开关。锚点是 `input[role="switch"]`——用角色而不是类名表达「这是个开关」，语义优先的立场在表单控件上的第一次实践。

**Blocked by:** 09

**Status:** ready-for-agent

- [ ] `input[role="switch"]` 呈开关外观，开与关状态视觉上可区分
- [ ] 无需脚本即可切换（原生控件行为），样式不依赖 JS
- [ ] 若含滑动部件，其位移与阴影偏移同源派生（§3 不变量 3）
- [ ] 状态切换**不改变边框宽度**
- [ ] 键盘操作（Tab 聚焦、Space 切换）与焦点环均可见可用
- [ ] 文档站出现「Switch」页，示例里开关真的可切

**验证方式**

1. 在页面上用键盘完全操作一遍开关，确认焦点环与状态都正确。
2. 切换前后读取计算样式，确认边框宽度一致。
3. 禁用 JavaScript 后确认开关仍可切换。

## Answer

### 分支与提交

- 分支 `ticket/11-switch`，基于 `feat/barnacle-v1`（开工时 tip `54aedca`，合入时 tip 已前进到 `7e6e1d1`，已 `git merge`，merge commit `c59bc4c`）。
- 实现提交 `b644ffe`（`src/css/form.css`、`content/components/switch.md`、`scripts/verify-switch.mjs`、`package.json` 的 `verify:switch`、重建后的 `static/` 四份产物）。
- 本文件末尾的 Answer 由收尾提交带上。

### 标记写法

CSS 的锚点就是角色属性，不发明类名（ADR-0001 / ADR-0005）：

```css
input[role="switch"] { … }
input[role="switch"]::before { … }          /* thumb */
input[role="switch"]:checked { … }
input[role="switch"]:checked::before { … }
```

`input[type="checkbox"][role="switch"]` 被 `input[role="switch"]` 完全覆盖（同是 input），所以只写一条，不再列第二个选择器。使用者的标记：

```html
<p>
  <label for="wifi">Wi-Fi</label>
  <input id="wifi" type="checkbox" role="switch">
</p>
```

状态全部来自原生 `:checked`，没有 `aria-checked`、没有 `data-*`、没有脚本（spec §3 不变量 6）。

### thumb 位移与阴影偏移同源（关键 CSS）

```css
input[role="switch"] {
  --_switch-h: 1.75rem;                                  /* 28px：控件比例，唯一非派生数 */
  --_switch-gap: var(--bn-border-width);                 /* 3px：缝 = 边框厚 */
  --_switch-travel: calc(var(--bn-shadow-x) * 3);        /* 12px：滑动 = 3 个阴影偏移 */
  --_switch-thumb: calc(var(--_switch-h) - var(--_switch-gap) * 2 - var(--bn-border-width) * 2); /* 16px */
  inline-size: calc(var(--_switch-h) + var(--_switch-travel));   /* 40px：盒子由 travel 决定 */
  block-size: var(--_switch-h);
}
input[role="switch"]::before {
  box-shadow: var(--bn-shadow-sm);        /* 2px 2px 0 0 = shadow-x / 2，与 travel 同源 */
  translate: 0;                            /* 过渡的起点 */
}
input[role="switch"]:checked::before {
  translate: var(--_switch-travel);        /* 位移无字面量：一个 calc() over --bn-shadow-x */
}
```

- 位移声明 `translate` 的值里没有长度字面量；`translate: 0` 只是为了给过渡一个起点。
- 位移的「源」是 `--bn-shadow-x`：travel = 3 个偏移，thumb 阴影 = `--bn-shadow-sm` = 半个偏移。在 `<html>` 上把 `--bn-shadow-x/y` 改成 8px，实测 travel 12→24px、thumb 阴影 2px→4px、盒子 40→52px 同时变（见下），说明两者不能各自漂移。
- 盒子宽度也由 travel 派生，所以缩放令牌时 thumb 不会被甩出轨道：content 34px = 3 + 16 + 12 + 3，两个缝（3/15）在 `:checked` 时正好互换。
- 状态规则只改 `background` / `translate`（+ disabled 的 `cursor`/`opacity`），**没有任何规则写边框宽度**，所以不变量 7 在文件层面不可违反。
- 动效：`transition: translate var(--_motion), background-color var(--_motion)` 与轨道的 `background-color` 全部写在 `@media (prefers-reduced-motion: no-preference)` 内；无 `reduce` 块、无 `animation`（spec §7）。
- 焦点环不重述：`00-base.css` 的 `:focus-visible { outline: var(--_focus-ring); outline-offset: var(--_focus-ring-offset) }` 已经覆盖它（07 是在自己文件里重述的，本票选择不重复声明，实测生效）。

### 实测读数（真 Chrome 155.0.8059.82，测的是提交的 `static/barnacle.css`）

| 项 | 关 | 开 |
|---|---|---|
| 通道盒子 | 40×28px | 40×28px |
| 边框（上/左/右/下） | 3px / 3px / 3px / 3px | **3px / 3px / 3px / 3px（一致）** |
| 圆角 | 0px | 0px |
| 通道底色 | `rgb(255, 253, 245)` | `rgb(255, 210, 63)` |
| thumb | 16×16，`rgb(0, 0, 0)` | 16×16，`rgb(0, 0, 0)`（在饱和填充上用 `--bn-main-foreground`） |
| thumb 位移 | `translate: 0px`，左缝 3 / 右缝 15 | `translate: 12px`，左缝 15 / 右缝 3 |
| thumb 阴影 | `rgb(0, 0, 0) 2px 2px 0px 0px` | 同 |
| 内容盒 | 34px | 34px |

- 键盘：真 `Tab`（先 `blur`）命中 `#switch`，`:focus-visible` 为真，`outline: solid 3px rgb(116, 185, 255)`、`outline-offset: 3px`；`Space` 让 `:checked` false→true→false，thumb 位移跟着 12px↔0。
- 令牌缩放：`<html>` 上 `--bn-shadow-x: 8px; --bn-shadow-y: 8px` → thumb 阴影 `rgb(0, 0, 0) 4px 4px 0px 0px`、travel 24px、盒子 52px、开态 `translate: 24px`、左右缝仍是 3/3。
- 暗色（`html[data-theme="dark"]`）：通道 `rgb(26, 26, 26)`、thumb `rgb(255, 253, 245)`、边框翻白；开态通道 `rgb(255, 210, 63)` + thumb `rgb(0, 0, 0)`；几何不变。
- 无脚本：`javaScriptEnabled: false` 下点击 `#switch-bare`，`:checked` false→true→false，底色 paper→main→paper，thumb 0→12→0，边框全程 3px（无 init script 可冻结，故用轮询等过渡结束，而不是用 sleep 猜）。
- 动效：默认上下文 thumb `transition-property: translate, background-color`、`duration 0.15s / 0.15s`；`reducedMotion: 'reduce'` 下 `0s`，且照样能切、照样位移。
- 文档页：`dist/components/switch.html` 的 Preview 里真的有 1 个 `input[role="switch"]`，点击后 `:checked` 与视觉状态都变（文档站自己的脚本只负责搭 Preview/Code 面板，开关本身零脚本）。
- 非开关控件不受影响：同一个 fixture 里的裸 `<input type="checkbox">` 仍是 UA 原生 `appearance: auto`（负向对照）。

### 新增的验证脚本

`scripts/verify-switch.mjs`（`npm run verify:switch`，21 项）：

- 静态断言（12 项）：文件无 BOM / 不写 `@layer` / 保留给 12 号票的分节注释；锚点是角色而非类名且 `00-base.css` 里没有 switch 状态规则（决策 §13）；只出现 `--bn-*` / `--_*`（四个 `--_switch-*` 为本组件局部）；无 `!important`、无颜色字面量、无 `outline: none`；几何派生六条逐字比对（含 `translate`/`box-shadow` 无长度字面量、`--bn-shadow-sm` 确实从 `--bn-shadow-x` 派生）；状态规则不得碰任何盒子度量；动效全部在 `no-preference` 内且由 `--_motion` 计时；产物里有 form.css 块与四条关键声明（min 产物也保留锚点）；文档页 frontmatter / 无 H2 / 围栏纯净 / 无尾斜杠链接 / 正文点名锚点与 Tab、Space；`seite build` 后 `dist/components/switch.html` 与索引链接。
- 真 Chrome 断言（9 项）：上表每一行读数；切换前后边框宽度与盒子尺寸逐项相等；键盘 Tab + 焦点环 + Space 三连；无 JS 点击切换；令牌缩放联动；暗色；动效守卫（含 reduce）；文档页 Preview 真能切。

### 回归（全绿，全部在合入 `feat/barnacle-v1` 之后、最终产物上跑）

| 命令 | 结果 |
|---|---|
| `npm test` | exit 0，78 pass / 0 fail |
| `npm run test:browser` | exit 0，11 pass / 0 fail |
| `node scripts/verify.mjs` | 21/21 |
| `verify-theme` | 16/16 |
| `verify-site` | 24/24 |
| `verify-site-shell`（合并带来的新脚本，本票顺带跑） | 9/9 |
| `verify-base` | 35/35 |
| `verify-button` | 21/21 |
| `verify-tabs` | 19/19 |
| `verify-toast` | 19/19 |
| `verify-dropdown` | 17/17 |
| `verify-interaction` | 15/15 |
| `verify-static` | 26/26 |
| `verify-table` | 34/34 |
| `verify-progress` | 17/17 |
| `verify-layout` | 22/22 |
| `verify-demo` | 19/19 |
| `verify-deploy` | 12/12 |
| `verify-switch` | 21/21 |
| `seite build --strict` / `seite check --strict` | 均 EXIT=0（`✓ Built 15 components, 2 pages` / `✓ No problems found`） |
| `test:browser:mutations` | 11 个 mutant + 未变异对照，全部 as designed（合并后 7e6e1d1 把注入按 layer+规则定位，本票新增的 11 个 `no-preference` 块不影响定位） |

**关于 mutation-sweep 的一个历史事实（已由合并修好，仅记录）**：本票开工时那一版 `tests/browser/mutation-sweep.mjs` 用整篇字符串定位，`static/barnacle.css` 里 `transform: translate(var(--_lift-x), var(--_lift-y));` 出现 2 次、`background: var(--_surface);` 3 次、`box-shadow: var(--_shadow-rest);` 6 次、`@media (prefers-reduced-motion: no-preference) {` 10 次，四处注入模式都不唯一，所以那一版是红的（与本票无关，是 07/20/13/16 之后累积的）。合入 `7e6e1d1` 后它按 layer + 规则 prelude 定位，已绿。

### 未验证项

- 只在系统 Chrome 155 上测过；Firefox / Safari / 真 iOS 与 Android 触屏未测（`@media (hover: hover)` 的触屏粘滞只在桌面验证过匹配语义）。
- 读屏软件对 `role="switch"` 的播报（「switch, on/off」）只是按 ARIA/HTML 语义推断，没有在 NVDA/VoiceOver 里实测。
- `forced-colors`（Windows 高对比度）下 thumb 与通道的可见性未测。
- RTL 页面：thumb 用逻辑属性（`inset-inline-start`）与 `translate`（x 轴物理方向），理论上 `direction: rtl` 时 thumb 会从左端出发向右滑动而不是镜像到左滑；未实测，若将来支持 RTL 需要复查这一处。
- 键盘只用 `Tab` / `Space` 测过；`Enter` 在 checkbox 上不切换（原生行为），文档没有承诺。

### 给 12 号票（Form）的交接

`src/css/form.css` 里已经留好 5 节带标题的注释，switch 只占第 1 节：

1. `1. Switch — input[role="switch"]`（本票完成，**不要再改**；尤其不要在这里加移动/悬停位移，几何只在 `00-base.css :root` 与 `--_switch-*` 里）。
2. `2. Text-like controls — input（文本类）/ textarea / select`：空节，等你写。
3. `3. checkbox / radio`：空节，等你写。
4. `4. fieldset / legend / label`：空节，等你写。
5. `5. Validation — [aria-invalid="true"] / :user-invalid`：空节，等你写。

必须知道的三件事：

- **switch 在 DOM 里就是 `input[type="checkbox"]`**，所以第 3 节的 checkbox/radio 规则一定要带 `:not([role="switch"])`（推荐写法：`:is(input[type="checkbox"], input[type="radio"]):not([role="switch"])`）。不排除的话，`appearance: none` 之后你那边的 `inline-size`/`border`/`::before` 会和第 1 节逐条打架，且特异性更高。
- 第 2 节的文本类选择器天然安全（`input:not([type="checkbox"], [type="radio"], …)` 已经把 switch 排除），但如果你写 `input` 裸选择器就会污染第 1 节。
- 本票不写 `label` 样式，文档示例里的 `<label for>` 现在只有 UA 的 inline 文字；第 4 节补上后示例会自动变好，不需要回改 switch。
- 令牌/槽位：switch 只读 `--bn-border-width`、`--bn-border-color`、`--bn-radius`、`--bn-background`、`--bn-foreground`、`--bn-main`、`--bn-main-foreground`、`--bn-shadow-x`、`--bn-shadow-sm`、`--bn-transition`（经 `--_motion`），并声明了四个局部变量 `--_switch-h` / `--_switch-gap` / `--_switch-travel` / `--_switch-thumb`；第 2–5 节别复用这四个名字。

## Comments

- **12 号票（Form）落地后，本票 `verify-switch.mjs` 的一条负向对照被改写**（经协调代理授权，原始意图保留、未删除、未弱化为恒真）。它原本断言裸 `<input type="checkbox">` 仍是 UA 控件（`appearance: auto|checkbox`），用来证明「switch 的样式没有外泄」。spec §8 要求裸 checkbox/radio 成体系可用，form.css 第 3 节因此重绘它（`appearance: none`），该断言的**前提**过时，实测转红（`read appearance none`）。
- 新断言仍以「角色才是锚点、第 1 节的几何不外泄」为准：裸 checkbox 是 form.css 第 3 节画的 20×20 方框，宽度/高度不等于 switch 的 40×28，其 `::before` 是静态（`position: static`）、无阴影的 mark，而不是 switch 那个绝对定位、带 sm 档阴影的 16px thumb。
- 证伪（红/绿都跑过）：把第 1 节的 `input[role="switch"]::before` 临时改成也命中 `input[type="checkbox"]`，该断言转红（`mark position absolute`）；撤回并重建产物后恢复绿（21/21）。


