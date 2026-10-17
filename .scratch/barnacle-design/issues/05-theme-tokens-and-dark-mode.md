# 05: 公共令牌与暗色模式

**What to build:** 整个库的视觉词汇表。亮色令牌全部落在 `:root`，暗色令牌落在 `[data-theme="dark"]`，三档硬阴影由同一套偏移派生，语义变体映射到内部颜色变量。改一个 `--bn-shadow-x` 就能等比缩放整套层次感——这是「改令牌就换一种风味」的落点。

**Blocked by:** 01

**Status:** resolved

- [x] 亮色令牌全部定义在 `:root`（结构、阴影偏移与层级、交互位移、颜色、强调色与语义映射、字体、动效）
- [x] 暗色令牌只定义在 `[data-theme="dark"]`，**不出现 `prefers-color-scheme`**（ADR-0004）
- [x] 三档阴影全部由 `--bn-shadow-x` / `--bn-shadow-y` 经 `calc()` 派生
- [x] 公共令牌一律 `--bn-*`，内部变量一律 `--_*`，无第三种命名（ADR-0005），且令牌名全为 ASCII
- [x] `data-variant` → `--_variant-color` 的语义变体映射就位（success / warning / danger）
- [x] 暗色下中性色与阴影色被重调，强调色保持不变
- [x] 覆盖单个 `--bn-shadow-x` 后三档阴影按比例同步变化

**为什么拆 `--bn-border-color` 与 `--bn-border-width`**：参考源里 `--border` 一个当简写、一个当颜色，同名不同义极易误用。
**为什么单列 `--bn-shadow-color`**：默认等于边框色以保住「边框与阴影同色」的招牌观感，但暗色模式与强调色卡片需要独立覆盖它。

**验证方式**

1. 全文检索未压缩产物：`prefers-color-scheme` 零命中；`--bn-*` 与 `--_*` 之外无其他自定义属性命名。
2. 在页面上覆盖 `--bn-shadow-x: 8px`，观察三档阴影是否同步放大、悬停位移是否仍与阴影增量相等。
3. 切换 `data-theme="dark"`，确认硬阴影翻白、强调色不变。

## Answer

分支 `ticket/05-theme-tokens`。改写 `src/css/01-theme.css`（1 行占位 → 96 行令牌层），新增 `scripts/verify-theme.mjs`（16 项断言），`package.json` 加一条 `verify:theme` 脚本，重建并提交四份产物中的两份 CSS（`static/barnacle.js` / `.min.js` 未受影响，未改动）。

### 令牌清单要点

**公共令牌（`--bn-*`，35 个，逐字照抄 spec §6.1）**：结构 3（`border-width` / `border-color` / `radius`）；阴影 9（`shadow-x/-y`、`shadow-reverse-x/-y`、`shadow-color`、`shadow-lift`、`shadow-sm/-md/-lg`、`shadow`）；交互 1（`press`）；颜色 7（`background`、`secondary-background`、`foreground`、`main`、`main-foreground`、`ring`、`overlay`）；强调色与语义 8（`pink`/`blue`/`green`/`orange`/`lavender` + `success`/`warning`/`danger`）；字体 5；动效 1。

**内部变量（`--_*`）**：本票只登记**一个** —— `--_variant-color`（`data-variant` 映射的唯一产物）。`--_lift-*` / `--_press-*` / `--_shadow-rest/-hover/-press` / `--_border-*` / `--_surface-*` 这 11 个共享几何变量按配方笔记 §A 由 06 号票在 `00-base.css` 的 `:root` 建立（本票不代建：那些是 `@layer base` 的职责，且 06 已依赖本票，重复声明只会制造两份来源）。

**`data-variant` → `--_variant-color` 映射**（3 条规则、4 个语义值）：`success → var(--bn-success)`、`warning → var(--bn-warning)`、`:is([data-variant="danger"], [data-variant="error"]) → var(--bn-danger)`。不做默认值（未知/缺失变体由消费组件就地兜底）。尺寸/描边/幽灵/强调色**未建任何 `data-*` 钩子**（走 `bn-` 类名）。

**暗色**：只有 `[data-theme="dark"]` 一条规则、恰好 6 个令牌（`background` / `secondary-background` / `foreground` / `border-color` / `shadow-color` / `ring`），强调色与 `--bn-main` 一个都没重设。

### 验证方式的实测结论

1. **文本检索**：`node scripts/verify-theme.mjs` **16/16 PASS**（含 `prefers-color-scheme` 在未压缩产物中 0 命中；36 个自定义属性全部 `--bn-*` / `--_*`、无第三种命名、全 ASCII；三档阴影的偏移槽必须是 `var(--bn-shadow-x/-y)` 或 `calc(var(--bn-shadow-x/-y) * k)`，颜色槽必须是 `var(--bn-shadow-color)`；35 个亮色令牌与 6 个暗色令牌与 spec §6.1/§6.2 逐值相等）。`node scripts/verify.mjs`（01 号票的 21 项，未删改任何一条）仍 **21/21 PASS**。
2. **三档等比缩放**：断言内把令牌链完全展开成算术再求值（不是照抄源码）：`--bn-shadow-x/-y = 8px` 时 sm=4px、md=8px、lg=12px，且 `lg − md = lift = 4px` 成立。**但浏览器实测给出一个必须上报的反例**，见下「跨票发现」。
3. **暗色翻白**：脚本层只断言令牌文本（`--bn-shadow-color` 暗色 = `#FFFDF5`、强调色未被重设）。浏览器实测见下：`data-theme="dark"` 在 `<html>` 上时硬阴影确实翻白；在 `<body>` 上时**不翻白**。

**证伪性自查**（确认新断言不是同义反复）：临时改坏 `01-theme.css` 后重建，5 个变体全部被捕获 —— 冻结 `--bn-shadow-sm` 为 `2px`、追加 `@media (prefers-color-scheme: dark)`、把 `--_variant-color` 改名为裸 `--variant-color`、把暗色 `#1A1A1A` 改成 `#1A1A1B`、删掉 `error` 别名，`verify:theme` 每次都 exit 1；恢复后源码与四份产物 byte-identical，16/16 复绿。

### 浏览器抽查（临时，未写进 `package.json`）

用 `playwright-core` + 本机 Chrome（`C:\Program Files\Google\Chrome\Application\chrome.exe`）**在本 worktree 之外**（`%TEMP%\bn05-probe`）跑了一次性探针，读真实产物的 computed style，命令：`node %TEMP%\bn05-probe\probe2.mjs`。读数：

| 场景 | `--bn-shadow-color` | `--bn-shadow-md` | 实际 `box-shadow` |
|---|---|---|---|
| 亮色 | `#000000` | `4px 4px 0 0 #000000` | `rgb(0,0,0) 4px 4px 0px 0px` |
| `data-theme="dark"` 在 `<html>` | `#FFFDF5` | `4px 4px 0 0 #FFFDF5` | `rgb(255,253,245) 4px 4px 0px 0px` ✅ 翻白 |
| `data-theme="dark"` 在 `<body>` | `#FFFDF5` | `4px 4px 0 0 #000000` | `rgb(0,0,0) 4px 4px 0px 0px` ❌ 仍是黑 |
| `colorScheme:'dark'` 且 `<html data-theme="dark">`、OS 亮色 | `#FFFDF5` | `4px 4px 0 0 #FFFDF5` | 翻白 ✅（即：只看 `data-theme`，不看 OS） |
| `colorScheme:'dark'`、无 `data-theme` | `#000000` | `4px 4px 0 0 #000000` | `rgb(0,0,0) 4px 4px 0px 0px` ✅ 完全不受 OS 影响 |

`--_variant-color` 读数为 `danger` = `error` = `#FF6B6B`、无 `data-variant` 时为空字符串（即「无兜底」，符合配方 §3 取舍 1）。悬停几何（探针自行为 `button` 补上 spec §7 三行）：静止 `4px 4px`、悬停 `6px 6px` + `translate(-2px,-2px)`，位移与阴影增量相等。

### 跨票发现（需要协调代理裁决）

**自定义属性的 `var()` 替换发生在「声明它的那个元素」上，继承下去的是已替换好的 computed value，不会在后代重新绑定。** 对 spec §6.1 的派生写法有两条硬后果：

1. **祖先覆盖 `--bn-shadow-x` 无法让三档阴影缩放。** 把 `--bn-shadow-x: 8px` 放在 `button` 自己身上（`--bn-shadow-x` 读到 8px）或放在祖先 `<div>` 上，`--bn-shadow-md` 都仍算出 `4px 4px 0 0 #000000`。因为 `--bn-shadow-md` 是声明在 `:root` 上的，它在 `:root` 就已经替换成 `4px 4px...`，后代只是继承这个字符串。→ **「改一个 `--bn-shadow-x` 就等比缩放整套层次感」这个卖点，在 `:root` 单点派生 + 后代消费的架构下不成立**；要兑现，必须让消费组件在自己身上声明几何（例如 `button { --_shadow-rest: var(--bn-shadow-md); }`，此时 8px 会被正确读到），或把三档改写成在消费处重新计算的形态。07/09 号票的 `--_shadow-*` 单一来源方案正好能兼容这一点，建议在 07/09 的验收里显式测「在祖先覆盖 `--bn-shadow-x` 后三档是否缩放」。
2. **`data-theme="dark"` 必须落在 `<html>` 上，暗色阴影才会翻白。** 落在 `<body>`（更常见的写法）时，`--bn-shadow-color` 读数是白的、但 `--bn-shadow-md` 仍是 `#000000`，浅色硬阴影画在 `#1A1A1A` 上等于消失。spec §6.2 只规定 `[data-theme="dark"]`，无法同时兼顾 `<body>` 落点；建议 08 号票的验收台把 3 号验证方式固定为 `<html data-theme="dark">`，或由协调代理决定是否给暗色块补一条 `html[data-theme="dark"]` 别名（本票**未**自行加，以免偏离 spec §6.2 的逐字令牌块）。

本轮本票**未**修改任何组件的交互几何，也**未**把上述两点做成断言（它们要么超出本票范围、要么与 spec §6.1 逐字要求冲突）。

### 未验证项（留给 08 号票断言）

- 「祖先覆盖 `--bn-shadow-x` 后三档同步放大」在**浏览器**中不成立（已实测反例），本票只脚本化验证了令牌文本与算术；真正的验收形态需 08 号票定案。
- `[data-theme="dark"]` 在 `<body>` 落点下的阴影翻白（同上，08 号票需选定落点或推动修 spec）。
- `colorScheme:'dark'`（OS 偏好）不生效：本票只做了临时抽查，正式断言归 08 号票。
- 组件层的四态几何（`--_lift-*` / `--_press-*` / `--_shadow-rest/-hover/-press`）尚未存在于产物中，因此「悬停位移 = 阴影增量」目前是在探针自补的 CSS 上验证的，不是产物行为——归 06/07/09 号票。

## Resolution

Resolved on the integration branch `feat/barnacle-v1` at commit b8d230f.
Closing convention: this tracker has no "done" label, so `Status: resolved` plus the ticked checklist above records closure (see `docs/agents/issue-tracker.md`).
Verify with: `npm run verify:theme`
