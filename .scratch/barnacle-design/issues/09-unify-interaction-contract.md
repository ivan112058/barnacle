# 09: 交互契约统一落地

**What to build:** 把 07 号票定义并验证过的交互几何从 Button 里抽出来，成为全库共用的一份声明。此后每个可交互组件只声明自己的形状，位移与阴影不再各写各的——这是 §3 不变量 3（位移距离与阴影偏移同源）在代码结构上的落点。

**Blocked by:** 08

**Status:** ready-for-agent

- [ ] 交互几何（静止阴影、悬停上移与阴影放大、按下落下、焦点环、动效守卫）收敛为单一来源
- [ ] Button 改用该来源，外观与交互不变
- [ ] 触发位移与阴影的全部数值都由 `--bn-shadow-x/y` 与 `--bn-press` 派生，无组件内硬编码位移
- [ ] 组件的悬停规则不再重复书写 translate 与 box-shadow 数值

**验证方式**

1. 重构后在 08 号票的验收台上重跑全部交互不变量断言，逐条保持绿色。
2. 覆盖 `--bn-shadow-x` 与 `--bn-press`，确认所有已接入组件同步响应。
3. 全文检索 CSS，确认位移数值没有散落在各组件文件里。

## Answer

**结论：交互几何的取值来源没有搬家（06 已经把 10 个 `--_` 槽位收敛在 `00-base.css` 的 `:root`），09 做的是把这件事实写成可执行断言，并补上「谁来写状态规则」这一层的判断。**

### 单一来源最终落在哪里

`src/css/00-base.css` 的 `:root`（section 1），共 16 个槽位，全库唯一声明点，值全部由 `--bn-*` 派生（或显式 `0` / `none`）：

| 槽位 | 冻结值 |
|---|---|
| `--_lift-x` / `--_lift-y` | `calc(var(--bn-shadow-lift) * -1)` |
| `--_press-x` / `--_press-y` | `var(--bn-press)` |
| `--_shadow-rest` / `--_shadow-hover` / `--_shadow-press` | `var(--bn-shadow-md)` / `var(--bn-shadow-lg)` / `none` |
| `--_focus-ring` / `--_focus-ring-offset` | `3px solid var(--bn-ring)` / `3px` |
| `--_motion` | `var(--bn-transition)` |
| `--_border-rest/hover/press`、`--_surface(-hover/-press)` | `var(--bn-border-color)` / `var(--bn-secondary-background)` |

`--_focus-ring*` 与 `--_motion` 的**消费点**是 `00-base.css`（`:focus-visible` 规则 + `a` 的过渡）；`--_lift-*` / `--_press-*` / `--_shadow-*` 的**消费点**是各组件自己的 hover/press 规则，写成 `translate(var(--_lift-x), var(--_lift-y))`、`box-shadow: var(--_shadow-hover)` —— 只引用、不含任何数值。组件对槽位的**再指向**（`.bn-outline` 降档、`.bn-ghost`/选中 tab/`.bn-attached`/菜单项归零）也全部由 `var(--bn-*)` 或 `0` 派生。

### 一个被否掉的方案（重要，记在这里免得后人重走）

先做的版本是「把 hover/active/disabled 三条规则本身提到 `00-base.css`，用共享锚点 `:is(button, .bn-button, bn-tabs [role="tab"])` 一次覆盖全库」。静态断言全绿，**但浏览器实测不成立**：按钮 hover 时 `transform` 变成了 `-2px`（说明规则命中了），`box-shadow` 却停在 4px 的静止档。原因是我把「规则搬走了」当成了「计算值等价」，实际是共享规则与组件静止规则在层叠里分了家（`:data` 里 CDP 的 `CSS.getMatchedStylesForNode` 显示两条规则同特异性、静止规则在前，hover 规则的两个属性只有一个生效）。**症状极隐蔽**：物体动了、影子没动，而「影子保持不动」的断言恰好两端都错、一起错，照样绿。

因此最终形态是：**数值在 `00-base.css`，状态规则留在拥有该状态的组件里**（这正是 `component-style-recipes.md` §4.2 的推荐方案 B），由 `verify-interaction.mjs` 逐条钉死规则形状。已把这个结论写进 `00-base.css` section 3 的注释。

### 改动清单

| 文件 | 改动 |
|---|---|
| `src/css/00-base.css` | 只新增 section 3 注释（contract 说明 + 被否方案的实测结论），并把后续 section 序号 3→4 … 10→11。**无任何选择器/声明改动** |
| `scripts/verify-interaction.mjs` | 新增，`npm run verify:interaction`，15 项断言（12 静态 + 3 浏览器） |
| `scripts/build.mjs` | 新增导出 `layerBlock(source)`，`concatenateLayerBlocks` 改用它；审计用构建链自己的 helper 拼产物，不复制一份布局逻辑 |
| `package.json` | 只加 `verify:interaction` 一行 |
| `static/*` | 重新 `npm run build`（只有 `barnacle.css` 因注释增加而变；`barnacle.min.css` 注释被压掉，**字节不变**） |

**未改**：`button.css`、`tabs.css`、`dropdown.css`、`toast.css`、`animations.css`、其它组件文件、`tests/browser/*`、既有 `scripts/verify*.mjs`、`src/js/*`。Button 的外观与交互因此**逐字节/逐计算值不变**（见下方证据）。

### 审计脚本的断言清单（15 项，`npm run verify:interaction`）

静态（12）：
1. 20 个 `src/css/*.css` 均无 BOM，且除 `00-base.css` 第 1 行的层声明外不写 `@layer`
2. 全库自定义属性只有 `--bn-*` / `--_*`（ADR-0005）
3. 16 个槽位在 `00-base.css` `:root` 各声明一次；10 个几何槽位的每次写入必须派生自 `--bn-*` 或为 `0`/`none`（**咬住组件内硬编码位移**）
4. 16 个槽位值与 `orchestrator-decisions.md` §4 逐字一致
5. 每个 `translate()` 都必须是 `translate(var(--_lift-x|y|press-x|y), …)` 且两个都引用（`animations.css` 的入场关键帧除外，那是 14 号票的文件、且不是交互位移）；并逐一核对 button/tabs 的 hover 规则确实写了 `translate(var(--_lift-x), var(--_lift-y))`
6. 组件文件里不得出现字面量 `box-shadow`（只允许 `var(--_shadow-*)` 或 `none` 等关键字）
7. 每条组件 hover 规则只许读槽位（`transform` 必须是双槽位 `translate()`，`box-shadow` 必须是 `var(--_shadow-*)`），且不得含数字；button/tabs 两条契约规则逐槽位核对选择器、`(hover: hover)` 守卫、两个属性
8. 每条组件 press 规则必须 `translate(var(--_press-x), var(--_press-y))` + `var(--_shadow-press)`
9. 三处 `:focus-visible` 的 `outline` 必须读 `--_focus-ring`、offset 不得超过冻结值；不得有 `outline: none`
10. 凡是过渡 `transform`/`box-shadow` 的规则必须在 `@media (prefers-reduced-motion: no-preference)` 内，时长必须读 `--_motion`（不得写死），全库无 `reduce` 关闭块
11. 四个已落地组件文件都从冻结槽位读值，不得读无人声明的槽位
12. `static/barnacle.css` 必须与「用 `build.mjs` 的 helper 现拼一遍 `src/css/`」逐字节相同（行号可信）

浏览器（3，真实 Chrome 155.0.8059.82，冻结过渡后读数）：
13. **验证方式 2**：在 `<html>` 上覆盖 `--bn-shadow-x/y: 8px` 与 `--bn-press: 5px` 后，裸 `<button>`、`.bn-button`、`bn-tabs [role="tab"]` 三者**同步**响应（lift 2→4px、press 3→5px、静止档 4→8px，shadow 位移增量恒等于 lift），同时裸 `<a>` 全程无阴影无位移（决策 A 的负向对照）
14. 选中 tab 与 `.bn-ghost` 是把槽位归零（矩阵保持单位阵、无阴影），**没有任何规则 `transform: none` 取消位移**
15. 禁用控件 hover 时无位移，结构（边框 + 阴影）保留

### 证伪实验（脚本确实会红）

| 注入 | 审计输出 |
|---|---|
| `button.css` hover 写死 `transform: translate(2px, 2px)` | `FAIL ... button.css:116 — :is(button, .bn-button):not(:disabled):not([aria-disabled="true"]):hover { transform: translate(2px, 2px) }`（断言 5 与 7 同时红）；12/15 |
| `button.css` hover 写死 `box-shadow: 6px 6px 0 0 #000` | `FAIL ... button.css:117 — ... { box-shadow: 6px 6px 0 0 #000 }`（断言 6 与 7 同时红）；12/15 |
| `button.css` 往槽位写死 `--_lift-x: -2px`（ghost 与 attached 两处） | `FAIL ... button.css:100 / button.css:177 — { --_lift-x: -2px }`；13/15 |

三次都指名文件与行号，实验后已 `git checkout` 撤回（最终工作树干净，见 commit `d1e41d0`）。

### Button 外观不变的证据

`button.css` / `static/barnacle.css` / `static/barnacle.min.css` 的按钮相关字节**未被我改动**；`static/barnacle.min.css` 重构建后与 HEAD 逐字节相同（注释被压掉）。回归读数：

- `npm run test:browser`：**11/11**（含 `box-shadow` 完整计算串 `rgb(0, 0, 0) 4px 4px 0px 0px`、hover `6px 6px`、press `none`、过渡列表 4 属性 / 0.15s、`data-theme` 落点、令牌覆盖只在 `:root`）
- `node scripts/verify-button.mjs`：**21/21**（含 4px→6px = +2px = `--bn-shadow-lift`、按下 3px、`matrix(1,0,0,1,-2,-2)`、`ghost` 单位阵、`.bn-outline` 降档同源、禁用不可抬起）
- `npm run verify:interaction`：**15/15**
- `npm test`：78/78；`verify.mjs` 21/21；`verify-theme` 16/16；`verify-site` 24/24；`verify-base` 35/35；`verify-demo` 19/19；`verify-deploy` 12/12；`verify-tabs` 19/19；`verify-toast` 19/19；`verify-dropdown` 17/17
- `seite build --strict` / `seite check --strict`：EXIT=0

### 偏离与未验证项

- **偏离**：`00-base.css` 的**注释**里不写 `translate(var(--_lift-x), var(--_lift-y))` 这一整行字面文本。原因：`tests/browser/mutation-sweep.mjs` 用精确文本匹配来注入变异，要求模式在产物里只出现一次；注释里再写一份会让它变成 3 处并直接抛错而不是变异。
- **未验证 / 与 09 无关的既有红项**：`node tests/browser/mutation-sweep.mjs` 在本票开工**之前就已经是红的**（在 `52a9d2e` 的干净产物上同样报 `mutation "hover-changes-a-border-width": the pattern occurs 2 times in the artifact, expected exactly 1: transform: translate(var(--_lift-x), var(--_lift-y));`）。这是 20 号票把 tabs 的 hover 规则写成与 button 逐字相同的文本造成的，规则要求「不许删改既有断言」，故未动。不在本 ticket 要求的回归清单内；建议单独开一张小票把该变异改成按 `@layer` 块定位。
- 未跑 `verify-site` 之外的浏览器交互现场（`tests/browser/mutation-sweep.mjs` 之外的变异测试不在本票范围）。

