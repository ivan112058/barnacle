# 22: Toast 与全局面收窄

**What to build:** `bn.toast()` 可用，并同时收紧全局面：Toast 是纯模块而非自定义元素（它没有元素级状态），所以它是「只给有状态能力做自定义元素」这条约定的反例验证。收尾时对照 spec §9 逐项检查 `window.bn` 的最终形状。

**Blocked by:** 18

**Status:** ready-for-agent

- [ ] `bn.toast()` / `bn.toast.el()` / `bn.toast.clear()` 三个入口就位
- [ ] Toast 是普通模块，**不做成自定义元素**（spec §9 约定）
- [ ] 自动消失时长可配置；被动消失不阻断用户输入
- [ ] 容器层级与定位不遮挡页面上其他可交互元素
- [ ] 入场与退场动画写在 `prefers-reduced-motion: no-preference` 块内
- [ ] 文档站出现「Toast」页，示例里可手动触发
- [ ] 对照 spec §9 逐项核对 `window.bn` 的最终形状——只暴露声明过的能力，无多余出口

**测试要求**

用 `node --test` 覆盖：三个入口的存在与签名、`clear()` 的幂等、自动消失时长的配置生效。堆叠与遮挡靠浏览器验收台断言。

**验证方式**

1. `node --test` 全绿。
2. 连续触发多条 Toast，确认堆叠不互相遮挡、clear 能一次清空。
3. 打开「减少动态效果」，确认动画消失而 Toast 仍出现与消失。
4. 在页面上枚举全局面并与 spec §9 的表格逐项比对，确认无多无少。

## Answer

实现落在 `ticket/22-toast`，基线 `65a7f50`；`git merge feat/barnacle-v1` → `Already up to date`（集成分支未前进）。**代码提交 `c62f9db`**（本 Answer 紧随其后单独提交）。下列证据全部在本 worktree 的最终代码上实跑。

### 交付物

| 文件 | 内容 |
|---|---|
| `src/js/toast.js` | 普通模块：`createToast(environment)` 工厂 + 页面级单例 `toast`；三个入口都在这里 |
| `src/css/toast.css` | `.bn-toast-container` / `.bn-toast`、`--_` 槽位、`data-variant` 消费、`prefers-reduced-motion: no-preference` 内的入场与退场动画 |
| `src/js/namespace.js` | `createNamespace(global, capabilities = {})`；不可枚举的 `installed` 标记换成模块私有 `WeakSet` |
| `src/js/index.js` | `createNamespace(isBrowser ? window : {}, { toast })` —— 只挂载声明过的能力 |
| `tests/js/toast.test.mjs` | 21 个 `node --test` 用例（局部 DOM stub + 注入式假时钟） |
| `scripts/verify-toast.mjs` | 本票验收脚本：11 项静态断言 + 8 项真 Chrome 断言（`--no-browser` 可跳） |
| `content/components/toast.md` | Toast 文档页（英文，与既有页一致；中文留 ticket 23） |
| `package.json` | `test` 显式列出两个测试文件；新增 `verify:toast` |
| `static/barnacle{,.min}.{css,js}` | 重建产物：css 34595 B / min.css 9448 B；js 5345 B / min.js 2575 B |

### 三个入口的最终签名与默认时长

```js
bn.toast(message, options?)  → Element   // 显示一条，并给它装上自动消失定时器
bn.toast.el(message, options?) → Element // 显示一条，不装定时器：生命周期归调用方；clear() 仍会关掉它
bn.toast.clear()             → number    // 关掉所有存活 toast，返回本次开始关闭的条数；幂等
```

- `message`: string | number | Node。字符串按**文本**插入（`textContent`，绝不 `innerHTML`）；Node 直接 append。
- `options.variant`: `success` / `warning` / `danger` / `error`（`error` 是 `danger` 的别名）→ 落到 `data-variant`；未知值与未写等价（组件就地兜底）。
- `options.duration`: 毫秒，**默认 `5000`**（导出常量 `DEFAULT_DURATION`）；`0` = 不自动消失；负数 / `NaN` / `Infinity` / 非数字 → 在**创建任何 DOM 之前**抛 `TypeError`。
- 退出等待时长不在 JS 里写死：关闭时先给元素打 `data-closing`，再读它的 computed `animation-duration`；`reduce` 下该值是 `0s`，于是同 tick 移除。

### `window.bn` 的最终形状（逐项对照 spec §9 表格）

| spec §9 表格行 | 在全局面？ | 实测 |
|---|---|---|
| `index.js`（打包入口、注册元素、挂 `window.bn`） | 否（它就是入口） | 产物 IIFE 里唯一一处 `window.bn=…` |
| `base.js`（`BnBase` 基类） | 否 | `Object.keys(window.bn)` 里没有 `BnBase` / `base` |
| `dropdown.js`（`<bn-dropdown>`） | 否（§8 的全局 API 列是 `—`；19 号票未并入） | 产物里没有 `customElements.define` |
| `tabs.js`（`<bn-tabs>`） | 否（同上；20 号票未并入） | 同上 |
| `taginput.js`（`<bn-taginput>`） | 否（同上；21 号票未并入） | 同上 |
| `toast.js`（`toast()` / `toast.el()` / `toast.clear()`） | **是**：`bn.toast`，并带 `bn.toast.el` / `bn.toast.clear` | `Object.keys(bn.toast)` = `['clear','el']`，arity `[1,1,0]` |

最终形状：

```js
window.bn = { version: '0.1.0', register(name, ctor), toast(message, options) }
```

- 浏览器实测（空页 `Object.keys(window)` 前后差集）：新增可枚举全局**只有 `bn`**。
- `Object.keys(bn)` = `Object.getOwnPropertyNames(bn)` = `['register','toast','version']` —— **无多**（`BnBase` / `uid` / `keys` / `namespace` 都不在），**无少**（`toast` 在，且它带着 `el` / `clear`）。
- §9 的 `window.bn = { toast }` 是那一节的最小示意；18 号票已把 `version` / `register` 放上去并在自己的 Answer 里记过，本票**只增 `toast`，不删既有出口**。
- **18 号票的 `installed` 标记已收起为模块私有 `WeakSet`。** 可枚举面本来就不变（它不可枚举），收进 WeakSet 后连 `getOwnPropertyNames(bn)` 也严格变窄 —— 现在面上**没有任何未声明属性**。18 号票的 22 条用例（含 `Object.keys(bn).sort() === ['register','version']`）**一行未改、全部通过**。
- 「只暴露声明过的能力」现在是**结构性**的：`createNamespace(global, capabilities)` 只合并调用方点名的名字（默认 `{}`）。不传 capabilities 时形状与 18 号票完全一致；没点名的能力无法出现在面上。

### 文档页示例的触发方式与预览面板实测结论

**最终做法（如实记录）**：`content/components/toast.md` 的 html 围栏里放 5 个真实 `.bn-button`，用**内联事件属性**触发 —— `onclick="bn.toast('Saved.')"`、`{ variant: 'success' | 'warning' | 'danger' }`、`{ duration: 0 }`。

为什么是它：04 的渲染层用 `innerHTML` 注入围栏，围栏里的 `<script>` **不执行**；而内联事件属性不是 `<script>`，在 `innerHTML` 插入的元素上**是可用的**。`static/site.js` 被 verify-demo 钉死「不许碰库的 `bn-` 名字」，所以**没有**让站点脚本代管触发；库侧也**没有**为演示加声明式钩子（那会往全局监听/能力面里塞未声明的东西，与「面越窄越好」冲突）。页面正文写明这段 handler 只是为了绕过 `innerHTML`、真实代码用 `addEventListener`，并给了兜底：控制台执行 `bn.toast('hi')`。

**预览面板实测结论：真的可点。** `scripts/verify-toast.mjs` 在真 Chrome 用 Playwright `locator.click()`（带 actionability 检查：可见、未被遮挡、可命中）点预览面板里的按钮 → 产生 **1 条** toast，文本 `Saved.`，`position: fixed`、`z-index: 100`、右下 inset 各 16px，且 `!previewPanel.contains(toast)`（浮层不属于预览面板），控制台与页面**零报错**。即 `04 渲染层 + barnacle.js(defer) + 内联 handler` 这个组合在预览面板里成立。

### 测试清单与全绿证据

`npm test` = `node --test tests/js/base.test.mjs tests/js/toast.test.mjs`（**显式两个路径**，不用裸 `node --test`）。结果 `tests 43 / pass 43 / fail 0`，EXIT=0（base 22 + toast 21；base 的 22 条一字未改）。

`tests/js/toast.test.mjs` 的 21 条：

1. `the module exports the three entries with the documented arity`（`[toast.length, el.length, clear.length] === [1,1,0]`、`DEFAULT_DURATION === 5000`）
2. `importing the module needs no DOM at all`（静态 import 时全局无 `document` / `window`）
3. `toast(message) shows the message in a single shared container`
4. `the message is text, never markup`
5. `a message may be an element instead of a string`
6. `variant rides data-variant, and its absence means no attribute`
7. `toast.el() hands over the element and leaves the lifetime to the caller`
8. `the auto-dismiss fires at the default duration, not before`
9. `duration is configurable per toast`
10. `duration 0 keeps the toast until it is cleared`
11. `a duration that is not a finite number of milliseconds throws and shows nothing`
12. `the exit animation is awaited before the element is removed`
13. `without an animation the toast leaves on the spot`
14. `clear() empties the stack, removes the container and is idempotent`
15. `clear() cancels the auto-dismiss timers it replaces`
16. `clear() with nothing to clear is a no-op that touches no DOM`
17. `a second clear() does not re-close a toast that is already animating out`
18. `a toast whose container a framework detached is put back in the document`
19. `createNamespace mounts exactly the declared capabilities`
20. `createNamespace with no capabilities stays as narrow as ticket 18 left it`
21. `createNamespace mounts once per global object`

**「时长可配置」是怎么测的（无 sleep）**：`createToast` 的**每一个环境依赖都可注入** —— `document`、`window`（供 `getComputedStyle`）、`setTimeout`、`clearTimeout`。用例注入一个假时钟：它记录每次 `setTimeout(fn, ms)` 的 `ms`，并按累计虚拟时间在 `advance(ms)` 时按到期顺序触发。于是断言 = 「调度器收到的延迟就是配置值」+「边界前后状态翻转」：

- `toast('Default')` → `clock.delays === [5000]`；`advance(4999)` 仍在，再 `advance(1)` 后消失；
- `toast('Quick', {duration: 1200})` + `toast('Slow', {duration: 9000})` → `[1200, 9000]`；`advance(1200)` 后只剩 Slow；
- `duration: 0` → `clock.delays === []`，`advance(3_600_000)` 后仍在；
- 退出等待：注入 `window.getComputedStyle → '0.15s'`，`advance(1000)` 后断言元素已带 `data-closing` 且 `clock.delays === [150]`，再 `advance(150)` 才消失；不注入时按 `0s` 立即移除。
- 假时钟第一版按「相对延迟 ≤ 本次步长」触发，被 `advance(4999)` + `advance(1)` 用例打成红灯 → 改成累计虚拟时间（这正是「红→绿」抓到的东西）。

真实浏览器侧的时长断言在 `verify-toast.mjs` 里（400ms 的 toast 在 150ms 仍在、其后消失；60s 的仍在），同样不靠长 sleep。

### 逐条验证命令与实测结果

| 命令 | 结果 |
|---|---|
| `npm test` | `tests 43 / pass 43 / fail 0`，EXIT=0 |
| `node scripts/verify.mjs` | 21/21，EXIT=0 |
| `node scripts/verify-theme.mjs` | 16/16，EXIT=0 |
| `node scripts/verify-site.mjs` | 24/24，EXIT=0 |
| `node scripts/verify-base.mjs` | 35/35，EXIT=0 |
| `node scripts/verify-demo.mjs` | 19/19，EXIT=0（`3/3 component pages`、`toast.html=1` H2） |
| `node scripts/verify-deploy.mjs` | 12/12，EXIT=0 |
| `node scripts/verify-button.mjs` | 21/21，EXIT=0 |
| `node scripts/verify-toast.mjs`（新） | 19/19，EXIT=0（system Chrome 155.0.8059.82） |
| `seite build --strict --dir .` | EXIT=0：`Built 3 components, 2 pages` |
| `seite check --strict --dir .` | `No problems found`，EXIT=0 |
| `npm run build` | 4 产物，`0 warnings, 0 errors`；css 34595 B / min.css 9448 B / js 5345 B / min.js 2575 B；两份 JS 产物均无 `attachShadow` |

**浏览器证据（playwright-core 1.64.1，`npm i --no-save`，未写进 `package.json`、`package-lock.json` 无漂移）**：

- **预览面板可点**：Playwright `click()`（带 actionability）→ 1 条 fixed toast，inset 16/16，文本 `Saved.`，零 console/page error。
- **堆叠与遮挡（本票硬要求，双向实测）**：3 条 toast，相邻 gap **12px**、两两不重叠；容器右下 inset 16px、宽 288–352px、面积 < 视口 25%。在「toast 之间的缝隙」处 `elementFromPoint` 命中注入的**全屏可点 `<button id="toast-probe">`**（而不是容器），在 toast 本体处命中 `.bn-toast`；随后**真实鼠标点击这两点** → probe 计数器 = **1**（缝隙的点击穿透到页面，toast 上的没穿透）。即容器**不遮挡页面其余可点区域**，同时单条 toast 仍是点击目标。
- **`clear()`**：立刻仍剩 2 条（已带 `[data-closing]`，即真的在等退场动画），随后 0 条且容器被移除；第一次返回 2，第二、三次返回 0（幂等）。`reduce` 下同 tick 清空。
- **窄视口安全区**：320×640 下容器宽 **288px**（`min(22rem, 100vw - 2rem)`）、inset 16/16、无横向溢出、缝隙仍可穿透。
- **reduced motion**：`getAnimations().length === 0`、`animation-duration: 0s`、`animation-name: none`、`opacity: 1`、rect 60×352（**仍可见**），`clear()` 同 tick 移除（不等待不会播的动画）。
- **暗色**：`prefers-color-scheme: dark` 被**忽略**（surface 仍是 `rgb(255,255,255)`，ADR-0004）；`html[data-theme="dark"]` → surface `rgb(38,38,38)`、边框与硬阴影 `rgb(255,253,245)`。
- **全局面**：空页差集只有 `bn`；`Object.keys(bn)` = `getOwnPropertyNames(bn)` = `['register','toast','version']`；`'installed' in bn === false`；`Object.keys(bn.toast)` = `['clear','el']`；arity `[1,1,0]`。
- 一次性机制探针（跑完已删、未提交）：`data-variant="danger"` 的 toast → `borderTopColor: rgb(255,107,107)`，`boxShadow: rgb(0, 0, 0) 4px 4px 0px 0px` —— 即「变体改边框、不改阴影色」，见偏离 2。

### 偏离与决定（请协调代理核对）

1. **recipes §26 的 `[data-variant="info"]` 不实现**：orchestrator §1 把 `data-variant` 的语义集合定为 `success` / `warning` / `danger`（+ `error` 别名），01-theme.css 里也没有 `info`。文档页写了「任何其他值等价于无变体」。
2. **recipes §26 的「边框与阴影同色」不实现**：`--bn-shadow-md` 在 `:root` 完成替换，后代上改 `--bn-shadow-color` 对它无效（orchestrator §8 + 05 号票实测）。要同色只能把 blur/spread/offset 结构重写在组件文件里，正是 §4 禁止的事。变体表现为**边框色**（与 `.bn-outline` 在按钮上的表现一致），机制与理由写在 `toast.css` 头部注释；实测值见上。
3. **recipes §26 的 `reduce` 块里 `--bn-transition: 0ms` 不实现**（recipes 自己也警告它会污染公共令牌语义）：改由 JS 读 computed `animation-duration` 决定等待，CSS 只负责外观 —— 也正是本票要求的「入场/退场动画写在 `no-preference` 块内」。
4. **动画与 `@keyframes` 放在 `src/css/toast.css`**（本票交付物清单如此要求），没有放进 `animations.css`（recipes 的建议）；关键帧命名 `bn-toast-in` / `bn-toast-out`，不与 recipes 的 `bn-fade-in-up` 撞名。**合并提示**：若 ticket 10 把 `.bn-toast` 也纳入 `animations.css` 的 `bn-fade-in-up`，animations 层会压掉 components 层的入场动画 —— 是重复而非破坏，但合并时要看一眼。
5. **`--_press-y` 复用为入/退场的纵向位移量**（toast 没有 press 状态，该槽位空闲）：因此 `toast.css` 里**没有任何位移/阴影数值字面量**，也没有新增 `--_` 槽位（新增按 recipes §A 必须登记，而那是 notes 文件，不归本票改）。
6. **动效用 `translate` 属性而非 `transform`**：避免 `animation … both` 把 `transform` 钉住、吃掉界面几何（recipes §6.1 的陷阱）。`transform` 槽位在 toast 子树上不受影响。
7. **Toast 不使用 `role="status"` 也不使用 `role="alert"`**：`[role="status"]` 是 spinner/skeleton 的语义锚点（orchestrator 3C）、`[role="alert"]` 是 10 号票 `alert.css` 的锚点，两者都会把 toast 重新装扮。容器用 `aria-live="polite"`（新增节点会被读屏播报）。
8. **`.bn-toast` 显式 `box-sizing: border-box`**：不写的话 padding + 边框会把 flex 子项撑出 22rem 列（320px 视口上会溢出，已由窄视口断言钉住）。
9. **`duration` 非法值抛 `TypeError`**（而非静默回落默认值）：与 `namespace.register()` 的立场一致（程序员错误要响）。文档与测试都钉死了这一条。
10. **新增 `scripts/verify-toast.mjs` 与 `verify:toast` 脚本**；`package.json` 的 `test` 改成显式两文件（不含裸 `node --test`）。未新增任何运行时/开发依赖。
11. **`createNamespace` 增加可选第二参数 `capabilities`（默认 `{}`）**：这是「只暴露声明过的能力」的落地方式，对 18 号票的既有断言无影响（不传时形状不变）。19/20/21 若要挂能力走同一参数；`index.js` 的 `createNamespace(...)` 调用与注册注释是并行票的冲突面，合并时留意。

### 未验证项

1. toast 与原生 `dialog`（top layer）的叠加：`z-index: 100` 的设计假设（dialog 永远在最上）**未实测** —— 本票没有 dialog 用例；由 14 号票 / 24 号票覆盖。
2. 读屏软件实际播报（NVDA/VoiceOver）未实测，只断言了 `aria-live="polite"` 与容器结构。
3. 触屏真机的点击穿透未测（仅桌面 Chrome）；真机仍归 24 号票。
4. 若 19/20/21 先合并并改动 `createNamespace` 调用签名，本票 `index.js` 需要一次合并解冲突（预期，非缺陷）。
5. 「改 `:root` 的 `--bn-press` 后 toast 位移随之缩放」只有代码层推理，没有覆盖令牌后的位移实测。
6. 无关闭按钮 / 无 `info` 变体 / 无动作按钮：spec 未要求，未实现（见偏离 1，不是遗漏）。

