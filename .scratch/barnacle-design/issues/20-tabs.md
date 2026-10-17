# 20: Tabs

**What to build:** `<bn-tabs>` 可用。标签页的语义完全交给 `role=tablist` / `role=tab` / `role=tabpanel`——与其说这是一个自定义元素，不如说是给正确 ARIA 结构加行为。

**Blocked by:** 18

**Status:** ready-for-agent

- [ ] `<bn-tabs>` 用 `role=tablist` / `role=tab` / `role=tabpanel` 语义工作
- [ ] 键盘导航完整：方向键在标签间移动、Home / End 到首尾，选中态与焦点态可辨（roving tabindex）
- [ ] 切换标签派发 `CustomEvent`，detail 至少含索引与被选中的标签，且 `bubbles: true, composed: true`
- [ ] 无脚本时全部面板可见或全部可读，不出现内容丢失（§3 不变量 6）
- [ ] 不使用 Shadow DOM
- [ ] 文档站出现「Tabs」页，含可运行示例与选项说明

**测试要求**

用 `node --test` 覆盖：`detail` 的内容形状、roving tabindex 的转移、方向键与 Home / End 的索引计算。无脚本可读性靠浏览器验收台断言。

**验证方式**

1. 只用键盘操作一遍标签切换，确认焦点环与选中态都清楚。
2. 在无脚本模式下装载该页，确认每个面板的内容都能读到。
3. 监听事件，确认派发对象的 detail 内容与冒泡标志。

## Answer

实现落在 `ticket/20-tabs`（基线 `65a7f50`，已含 01–07、18）：实现提交 `0080f3a`，随后 `git merge feat/barnacle-v1` 报告 already up to date，本 `## Answer` 落在下一个提交。
`Status:` 行按纪律未动（由协调代理收尾统一翻转）。

### 交付物

| 文件 | 内容 |
|---|---|
| `src/js/tabs.js` | `BnTabs`（224 行）：`events/init/teardown/keydown/onClick` + `tabs()/panels()/panelFor()/tabFrom()/activate()/link()` |
| `src/css/tabs.css` | 12 条规则，全部锚定在 `bn-tabs` 上；几何全部读 06 的 `--_` 槽位 |
| `src/js/index.js` | 新增 `bn.register('bn-tabs', BnTabs)` |
| `content/components/tabs.md` | 文档页（3 个围栏：1 个 html 主示例、1 个 js 事件示例、1 个 html 无脚本示例） |
| `tests/js/tabs.test.mjs` | 16 个 `node --test` 用例（最小 DOM stub + 动态 import） |
| `scripts/verify-tabs.mjs` | 19 项验证（14 静态 + 5 真浏览器），`--no-browser` 可跳过浏览器项；`npm run verify:tabs` |
| `package.json` | `test` 显式列出两个文件：`node --test tests/js/base.test.mjs tests/js/tabs.test.mjs`；新增 `verify:tabs` |
| `static/barnacle{,.min}.{css,js}` | 重建产物：35862/10739 B、16698/5136 B |

### 作者写法（HTML 片段）

```html
<bn-tabs>
  <div role="tablist" aria-label="Account settings">
    <button type="button" role="tab" id="tab-profile" aria-controls="panel-profile" aria-selected="true">Profile</button>
    <button type="button" role="tab" id="tab-billing" aria-controls="panel-billing">Billing</button>
  </div>
  <div role="tabpanel" id="panel-profile" aria-labelledby="tab-profile"><p>…</p></div>
  <div role="tabpanel" id="panel-billing" aria-labelledby="tab-billing"><p>…</p></div>
</bn-tabs>
```

**初始 HTML 里没有任何 `hidden`**——隐藏面板是 `init()` 的事，这是无脚本不变量的实现方式。作者只写 ARIA；元素补的只有四类属性：`aria-selected`、roving `tabindex`、`hidden`、以及缺失的 id/`aria-controls`/`aria-labelledby`（生成用 `this.uid('bn-tab-')` / `this.uid('bn-tabpanel-')`，作者写过的 id 一律不重写，所以 `aria-controls` 决定配对而不是文档顺序）。

### `BnBase` / `keys.js` 的用法（照 18 号票实现，没有另造一套）

- `class BnTabs extends BnBase`，`events() → ['click', 'keydown']`，基类据此绑 `onClick` / `onKeydown`；`onKeydown` 只接管 `NAVIGATION_KEYS`，其余键（`Tab`/`Enter`/`Escape`）保持原生语义，`preventDefault` 由基类在 `keydown()` 返回 `true` 时执行。
- 索引算术是纯函数：`const next = keydownIndex(key, this.activeIndex(tabs, tab), tabs.length)`，两端**夹紧不环绕**（`role=tablist` 要的行为）；`Home`/`End` → 0/last。
- **roving tabindex 全部交给基类**：`this.focusOnly(tabs, index)` 由基类把选中项设 `tabIndex = 0`、其余 `-1` 并返回实际落点（越界夹紧、空表返回 `-1`）；`tabs.js` 里不存在任何 `.tabIndex =` 赋值（`verify-tabs.mjs` 用正则钉死这一点）。
- 激活模型是**自动激活**（focus 跟随选择）：方向键一次完成「移动焦点 + 切换选中」，键盘用户站着的 tab 永远就是可见的面板；点击只切选中，不点焦点环（浏览器给按钮焦点，`:focus-visible` 不亮，符合「鼠标不点亮焦点环」）。
- 键盘只处理**发在 tab 上**的键：`keydown` 先 `tabFrom(event.target)`，返回 `null`（键来自面板内部，比如 `<textarea>` 的方向键）就直接 `false` 交还给面板。
- 事件走 `this.emit(...)`（恒 `bubbles: true, composed: true`）。
- `teardown()` 把面板恢复成 `init()` 看到的样子（用 `Map<panel, getAttribute('hidden')>` 快照，作者自己写的 `hidden` 也原样恢复），并清掉 `_active`，因此断开重连后能再次派发事件。

### 事件名与 detail 形状

```js
bn:change  →  detail = { index, tab, panel }
```

- `index`：被选中 tab 的 0 基下标；`tab`：**被选中的标签元素本身**；`panel`：该 tab 控制的面板（`aria-controls` 解析失败时为 `null`，形状恒定）。
- `bubbles: true, composed: true`（spec §9），在 `<bn-tabs>` 上派发，所以 `document` 上的监听者能收到。
- **只在选择真的改变时派发**：重选当前 tab、`init()` 装载、两端夹紧的空按键都不派发（实测见下）。

### roving tabindex 的实现方式

选中 tab `tabindex="0"`、其余 `tabindex="-1"`，由 `focusOnly` 单点写；`aria-selected` 与面板 `hidden` 在同一次 `activate()` 里同步。选中态与焦点态可辨：选中 = `--bn-main` 填充 + 阴影收拢（`--_shadow-rest/hover/press: none`）且位移槽位归零（**不是** `transform: none`——全库唯一合法的「几何归零」方式，与 `.bn-ghost` 同一招）；焦点 = `outline: var(--_focus-ring)` + `outline-offset: var(--_focus-ring-offset)`。视觉实测（`.scratch/ticket-20-visual-probe.mjs`，未提交，截图 `.scratch/ticket-20-tabs-light.png` / `-dark.png`）：

```
selected: bg rgb(255,210,63), shadow none,          outline 3px solid rgb(116,185,255) offset 3px
hovered : bg rgb(255,255,255), shadow 4px 4px,      transform matrix(1,0,0,1,-2,-2)   ← 抬起一个档位
resting : bg rgb(255,255,255), shadow 2px 2px,      transform none
dark    : selected 黄底黑字/无阴影；resting #262626 底 + 白影 rgb(255,253,245) 2px；面板白框
```

### 无脚本可读性的实测方式与结论

两种模式各实测一次（`verify-tabs.mjs` 的「verification 2」项）：

1. `javaScriptEnabled: false` 装载组件夹具页：3/3 面板 `hidden === false`、`display !== none`、有 offset 且文本可读（`Panel profile.` / `Panel billing.` / `Panel danger.` 都在 `textContent` 里），标签条仍有 3px 边框 + 面板 4px 硬阴影（样式不依赖 JS），并且**交付的标记里没有 `tabindex`**（roving 是脚本写的）。
2. JS 打开但**不加载库**：同样 3/3 面板可见；随后 `addScriptTag` 加载 `static/barnacle.js`，面板立刻变成只剩 1 个可见、`tabindex` 变成 `0,-1,-1`——证明「藏面板的是脚本，不是标记」。
3. 文档页（`dist/components/tabs.html`）在无脚本下：0 个 `bn-tabs`（演示层没跑，符合 ticket 04 的设计），3 个围栏都作为可读文本存在（含 `<bn-tabs>` 源码）、正文 5027 字节 → 内容不丢失。

> 结论：无脚本时**所有面板可见且可读**（不变 6 满足），标签条外观完整，只是失去交互。文档站上无脚本读者看到的是代码围栏而不是渲染后的标签页——这是 04 号票渲染层的既定行为，不是本票的丢失。

### 测试清单与全绿证据

`npm test` = `node --test tests/js/base.test.mjs tests/js/tabs.test.mjs` → `tests 38 / pass 38 / fail 0`（`EXIT=0`，约 100 ms）。其中 tabs 16 例：

1. `init selects the tab marked aria-selected in the markup and hides every other panel`
2. `init falls back to the first tab when the markup names no selection`
3. `an <bn-tabs> with no tabs is a quiet no-op`
4. `clicking a tab selects it and announces bn:change with the index, the tab and its panel` ← **detail 形状**（键集合 `index,panel,tab` + `bubbles/composed` + 元素同一性）
5. `re-selecting the tab that is already selected announces nothing`
6. `the event bubbles out of the element, so a listener on an ancestor hears it`
7. `ArrowRight moves focus and selection to the next tab (automatic activation)` ← **roving 转移**
8. `the arrow keys clamp at both ends instead of wrapping, and still stop the page scrolling` ← **索引算术**
9. `Home and End jump to the first and the last tab` ← **Home/End 索引**
10. `a key pressed inside a panel is left to the panel`
11. `a non-navigation key reaches no handler at all`
12. `aria-controls and aria-labelledby are generated when the author left them out`
13. `an authored aria-controls decides which panel a tab owns, not the document order`
14. `teardown puts the panels back the way init found them, and a reconnect re-initialises`
15. `init runs once per connect and binds click and keydown through the base class`
16. `the package entry registers <bn-tabs>`

DOM stub 沿用 18 号票手法：文件顶部装 `HTMLElement`/`CustomEvent`/`customElements`/`document`（`hidden`/`id` 做成反射属性的访问器，`focus()` 写 `document.activeElement`），再动态 `import('../../src/js/tabs.js')`；`event.target` 用 `Object.defineProperty` 注入（Node 的 `EventTarget` 不建树，不冒泡——这一点在 18 号票的 stub 上已确认）。**未加 `--test-force-exit`**：无悬挂句柄，进程自行退出。

### 浏览器验收（`npm run verify:tabs` = `node scripts/verify-tabs.mjs` → **19/19**，`EXIT=0`）

`npm i --no-save playwright-core@1.64.1`（未写进 `package.json`，`package-lock.json` 哈希前后一致：`EDFF4C0F…`），system Chrome `155.0.8059.82`，`channel: 'chrome'`，断言前冻结 transition/animation，焦点一律真 `Tab`。5 个浏览器项：

- **验证方式 1**：`Tab` 落到唯一 tab stop 且 `:focus-visible` 亮（3px 实线 `rgb(116,185,255)`、offset 3px）；`ArrowRight/ArrowLeft/Home/End` 逐键断言 `document.activeElement`、`aria-selected`、`tabindex` 落点、面板可见性；方向键移动后仍保持 `:focus-visible`；两端夹紧不围绕；点击切换选中但不点亮焦点环；悬停未选中项 = `translate(-2,-2)` + 4px 阴影（与按钮同源）；任何状态边框宽度都是 3px。
- **验证方式 3**：`document` 上的监听者收到 `bn:change`：`isCustomEvent === true`、`bubbles/composed === true`、`detail` 键集合 `index,panel,tab`、`detail.index === 1`、`detail.tab`/`detail.panel` 是元素本身、`event.target === <bn-tabs>`；键盘切换同样派发；末端夹紧的那次不派发（计数 2）。
- **验证方式 2**：见上一节。
- **作用域项**：夹具里放一个「外来」标签条（`<span role="tab">` + `[role=tabpanel]` + `[role=tablist]`，在 `<bn-tabs>` 之外），同一快照里 `<bn-tabs>` 内是 3px 边框 + 4px 面板阴影、外来侧 display/border/shadow/margin/padding 全部未变。
- **文档页（JS 打开）**：2 个示例各自初始化成功、各只有 1 个可见面板、`aria-controls` 都能解析到面板、roving 各 1 个 0；`End` 键切到最后一个 tab；0 console error / 0 page error。

### 回归（全绿，未删改任何既有断言）

| 命令 | 结果 |
|---|---|
| `npm test` | `tests 38 / pass 38 / fail 0`，`EXIT=0` |
| `node scripts/verify.mjs` | 21/21，`EXIT=0` |
| `node scripts/verify-theme.mjs` | 16/16，`EXIT=0` |
| `node scripts/verify-site.mjs` | 24/24，`EXIT=0` |
| `node scripts/verify-base.mjs` | 35/35，`EXIT=0` |
| `node scripts/verify-demo.mjs` | 19/19，`EXIT=0`（playwright-core 已装，6 条浏览器断言真跑） |
| `node scripts/verify-deploy.mjs` | 12/12，`EXIT=0` |
| `node scripts/verify-button.mjs` | 21/21，`EXIT=0`（12 条浏览器断言真跑） |
| `npm run verify:tabs`（`node scripts/verify-tabs.mjs`） | 19/19，`EXIT=0`（14 静态 + 5 浏览器，Chrome 155.0.8059.82） |
| `seite build --strict` | `✓ Built 3 components, 2 pages`，`EXIT=0` |
| `seite check --strict` | `✓ No problems found`，`EXIT=0` |
| `npm run build` | 4 产物，`0 warnings, 0 errors`；`barnacle.css 35862 B` / `barnacle.min.css 10739 B` / `barnacle.js 16698 B` / `barnacle.min.js 5136 B` |

新文件均为 UTF-8 无 BOM、LF（逐字节检查过）；`static/*` 产物里 `site-`、`attachShadow`、`esbuild`、`node_modules` 均零命中。本票装了 `npm ci`（`node_modules` 原本不存在），esbuild 的 postinstall 被 npm 拦下但 `@esbuild/win32-x64` 可用，构建与全部 verify 通过。

### 偏离与决定（供协调代理核对）

1. **CSS 选择器一律加 `bn-tabs` 前缀作用域，而不是直接用裸 ARIA 角色**（偏离 `component-style-recipes.md` §24 的「样式挂在 ARIA 属性上」）。理由：`role="tab"` / `role="tabpanel"` 在本仓库里**已被文档站自己占用**——`static/site.js` 的 Preview / Code 双标签用的正是这两个角色，规则写在裸角色上会伸进别人的组件。用同一份夹具做的**反事实实测**（一次性探针，跑完已删除、未提交）：

   | 探针 | 本票产物（加作用域） | 去掉 `bn-tabs ` 后的同一份规则 |
   |---|---|---|
   | 外来 `<span role="tab">` | `display: inline`，无边框/阴影，背景透明 | `display: flex`，`border 3px`，选中项背景 `rgb(255,210,63)`，未选中 `2px 2px` 硬阴影 |
   | 外来 `[role="tabpanel"]` | `margin-top: 0`，无阴影，`padding: 0` | `margin-top: 12px`，`4px 4px` 硬阴影，`padding: 16px` |
   | 外来 `[role="tablist"]` | `display: block`，`gap: normal` | `display: flex`，`gap: 8px` |

   `<bn-tabs>` 无论脚本跑不跑都在作者标记里，所以「无脚本时外观完整」不受影响（上面第 1、2 条实测都验证过）。`verify-tabs.mjs` 把这条固化成两项断言：所有规则必须锚定 `bn-tabs`，且外来标签条在该快照里逐项未变。

2. **tab 的静止阴影是 sm 档、悬停升到 md 档**（按钮是 md→lg）。配方 §24 写的是静态 `--bn-shadow-sm`；如果只降静止档而不动悬停档，升幅就变成 4px ≠ `--bn-shadow-lift`（2px），「影子留在原地」的等式会被破坏。因此按 `.bn-outline` 的先例成对覆写：`--_shadow-rest: var(--bn-shadow-sm); --_shadow-hover: var(--bn-shadow-md);`——tab 窝在面板上方，整体比按钮低一档，但等式仍然成立（实测 `resting 2px → hover 4px`，位移 `-2px`）。

3. **选中态不引入第二套位移**：配方 §24 的首选写法是给选中项 `translate: var(--_press-x) var(--_press-y)`，它的注释也推荐「改为把 `--_lift-*`/`--_press-*` 归零」。本票采用后者（推荐项）：选中项位移槽位归零 + 阴影收拢 + `--bn-main` 填充，全库因此仍然没有任何规则去 `transform: none`，「位移只有一个来源」这条不变量无例外（`verify-tabs.mjs` 断言全文件只有 slot 形式的 `translate()`，且 `box-shadow`/`outline-offset` 全部读槽位）。

4. **键盘接受全部四个方向键**（`ArrowUp/Down/Left/Right`）：`keydownIndex` 把它们都当作移动；本票不实现 `aria-orientation="vertical"` 的方向分工（垂直 tablist 里左右键也会移动）。spec/ticket 只要求「方向键在标签间移动」，垂直布局留待 v1.1。

5. **事件名 `bn:change`**（18 号票给的建议集合 `bn:change`/`bn:select`/`bn:open`/`bn:close` 中取「选中改变」最贴切的一个），detail 固定为 `{index, tab, panel}`。

6. `activate(index, {focus, silent})` / `tabs()` / `panels()` / `panelFor()` / `tabFrom()` / `link()` 是本元素暴露的方法面（浅 DOM 组件的正常接缝），**不在 `window.bn` 上**；`window.bn` 仍然只有 `{version, register}`。

### 仍未验证项

1. **屏幕阅读器（NVDA/JAWS/VoiceOver）实机朗读**未测——只按 WAI-ARIA APG 的 tabs 模式写了 ARIA，未做 AT 实测。
2. **垂直 tablist / `aria-orientation`** 未实现（见偏离 4）。
3. **手写 tab 之外的锚点形式**（`<a role="tab">`）未实测：测试与夹具都用 `<button role="tab">`；CSS 不依赖元素类型，但未逐项跑过 `<a>` 的键盘行为。
4. **`<bn-tabs>` 嵌套 `<bn-tabs>`** 未定义也未测（`querySelectorAll` 会跨层取到内层的 tab）。
5. **动态增删 tab/panel**（初始化之后作者再插入标签）未实现监听：需要重新 `init()` 才能纳管新节点。
6. 面板 `tabindex` 由作者决定（文档页示例照 APG 建议自己写 `tabindex="0"`）；元素本身不写，未测「面板内无可聚焦元素时键盘能否滚动面板」。
7. 视觉/反事实探针都是**一次性脚本与截图，跑完已删除、未提交**（结论已抄进本 Answer 与 `verify-tabs.mjs` 的断言）；常驻验收台是本票的 `scripts/verify-tabs.mjs`（`npm run verify:tabs`）。

