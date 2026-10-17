# 19: Dropdown

**What to build:** `<bn-dropdown>` 可用。基于原生 popover API，标记仍由使用者手写，JS 只加行为。

**Blocked by:** 18

**Status:** ready-for-agent

- [ ] `<bn-dropdown>` 基于原生 popover API 打开与关闭
- [ ] 组件只增强内部已有元素：找不到内部结构时安静退出，不报错（spec §9 约定）
- [ ] 键盘导航与开关可达，焦点管理正确
- [ ] 打开与关闭派发 `CustomEvent`，`bubbles: true, composed: true`
- [ ] 不使用 Shadow DOM
- [ ] 文档站出现「Dropdown」页，含可运行示例与选项说明

**测试要求**

用 `node --test` 覆盖：内部结构缺失时安静退出、事件 `bubbles`/`composed` 为真、键盘导航的分发路径。视觉与 popover 行为仍靠浏览器验收台。

**验证方式**

1. 用键盘完整走一遍打开、移动、选择、关闭。
2. 放一个内部结构不完整的 `<bn-dropdown>` 到页面上，确认控制台无报错。
3. 监听事件，确认 `bubbles` 与 `composed` 均为真。
4. 实测 popover API 在目标浏览器可用；不可用则记录并落地兜底。

## Answer

分支 `ticket/19-dropdown`，提交 `d2c09a6`（实现；`git merge feat/barnacle-v1` → `Already up to date`，基仍是 `65a7f50`），Answer 提交见文件末尾更新。

### 交付物

| 文件 | 内容 |
|---|---|
| `src/js/dropdown.js` | `BnDropdown extends BnBase`：找 `[popovertarget]` + `[popover]`、面板 `toggle` 反应、键盘漫游、焦点管理、`aria-expanded`、锚点命名、三个事件 |
| `src/css/dropdown.css` | 6 条规则：宿主、面板（`position-area` 锚定）、条目（几何槽位归零 + 表面槽位指向 `--bn-main`）、选中态、`no-preference` 守卫下的条目过渡 |
| `src/css/animations.css` | `@keyframes bn-fade-in-up` + `bn-dropdown [popover]:popover-open` 入场动画（都在 `@media (prefers-reduced-motion: no-preference)` 内） |
| `src/js/index.js` | `bn.register('bn-dropdown', BnDropdown)`，用 `typeof customElements !== 'undefined'` 作闸门（裸 Node 下不抛） |
| `content/components/dropdown.md` | 「Dropdown」页：2 个可运行 HTML 围栏 + 1 个 js 围栏、事件表、选项说明；无 H1/H2、无围栏外裸 HTML、无尾斜杠链接 |
| `tests/js/dropdown.test.mjs` | 19 个 `node --test` 用例（最小 DOM stub + 动态 import，照 18 号票手法） |
| `scripts/verify-dropdown.mjs` | 7 静态 + 10 浏览器断言（`npm run verify:dropdown`） |
| `static/{barnacle,barnacle.min}.{css,js}` | 四份产物重建后一并提交 |

### 作者写法（浅 DOM、JS 只加行为）

```html
<bn-dropdown>
  <button type="button" popovertarget="menu-actions" aria-expanded="false">Actions</button>
  <menu popover id="menu-actions" aria-label="Actions">
    <li><button type="button" class="bn-dropdown-item" value="rename">Rename</button></li>
    <li><button type="button" class="bn-dropdown-item" value="duplicate">Duplicate</button></li>
    <li><button type="button" class="bn-dropdown-item" value="delete">Delete</button></li>
  </menu>
</bn-dropdown>
```

`init()` 只做三件事：`this.querySelector('[popovertarget]')` → `document.getElementById(trigger.getAttribute('popovertarget'))` → 能力检测（`hasAttribute('popover')` + `typeof panel.showPopover === 'function'`）。任一环不成立就 `return`，**无异常、无 console 调用**（`grep console. src/js/dropdown.js` 零命中）。不生成节点、不建 shadow root、不改结构。

### `BnBase` 用法（照 18 号票，未另造基类）

- `events()` 返回 `['click', 'focusout', 'keydown']` → 基类按 `resolveHandlerName` 绑到 `this`，分发到 `onClick` / `onFocusout` / `onKeydown`。
- `keydown(key)` 只用 `import { keydownIndex } from './keys.js'` 做算术：`keydownIndex(key, current, items.length, { wrap: true })`；焦点落位用基类的 `focusOnly(items, index)`（只留一个 `tabIndex = 0`）与 `activeIndex(items, node)`。
- **`Escape` 不走基类**：`BnBase.onKeydown` 只认 `NAVIGATION_KEYS`，所以子类 `onKeydown` 先拦 `Escape`（未打开时直接放行为 no-op），其余 `return super.onKeydown(event)` 交给基类——这正是 `base.js` 文档里写的扩展方式。
- 事件全部经 `this.emit(type, detail)`（`CustomEvent`，`bubbles: true, composed: true`）。
- 面板的 `toggle` 事件**冒泡为 false、composed 为 false**（实测），无法用 `this.a()`（只在 `this` 上挂载），因此在 `init()` 里对面板 `addEventListener('toggle', …)`，并在 `teardown()` 里显式 `removeEventListener`，与 `this.a()` 同一本账。

### 事件名与 detail

| 事件 | 时机 | detail |
|---|---|---|
| `bn:open` | 面板已打开（点触发器、键盘激活、`showPopover()` 任一来源） | `{ trigger, panel }`（真实元素） |
| `bn:close` | 面板已关闭（Esc、选项、点外部 light dismiss、触发器再点） | `{ trigger, panel }` |
| `bn:select` | 选项被点击/键盘激活 | `{ value, item }`；`value` 取 `value` 属性，缺省取 `item.textContent.trim()` |

开/关事件从面板的 `toggle` 事件里发出，所以**任何关闭路径都恰好一对**（浏览器实测计数：2 次关闭 = 2 个 `bn:close`）。`aria-expanded` 同步维护并在 `teardown()` 还原作者原值（原本没有该属性则删除）。

### popover API 实测结论（system Chrome 155.0.8059.82，headless，`playwright-core@1.64.1` 一次性 `npm i --no-save`，未写进 `package.json`）

**可用性（都在目标浏览器为真）**：`HTMLElement.prototype.showPopover/hidePopover/togglePopover` 存在；`:popover-open` 可解析；`popoverTargetElement` 反映 id；`CSS.supports('anchor-name: --x')` 与 `CSS.supports('position-area: bottom')` 均为 true。

**行为观察（决定了实现形态）**：

1. `showPopover()` **同步**变为 `:popover-open`，但 `toggle` 事件是**排队任务**（同一 task 内不触发）；该事件 `bubbles=false, composed=false`。
2. 打开后**焦点仍停在触发器上**（不会自动进菜单）→ 组件自己 `_activate(0)`。
3. `hidePopover()` 对已关闭的 popover 是 no-op，`showPopover()` 对已打开的是 no-op（都不抛 `InvalidStateError`）。
4. 打开的面板里持有焦点时关闭（`hidePopover()` 或 Esc），**浏览器会把焦点还给「先前聚焦的元素」**（= 触发器）→ 组件的焦点归还是安全网。
5. 点外部 light dismiss：焦点留在被点的元素上（`activeElement === #outside`）→ 组件**不许抢焦点**（用 `_wantsFocusReturn` 区分「我们的关闭」与「别人的关闭」）。
6. `keydown` 从面板内的选项**冒泡到 `<bn-dropdown>`** ✓（委托路径成立）。
7. 从最后一个选项按 **Tab 不会关闭** auto popover（平台不做失焦 light dismiss）→ 这是额外绑 `focusout`（焦点移到面板外的**可聚焦**元素时关闭、且不夺回焦点）的唯一理由。
8. 打开时面板**仍是 `<bn-dropdown>` 的后代**（top layer ≠ 另一棵树）→ `bn-dropdown [popover]` 后代选择器照常命中。
9. **`position: absolute` 不可用**：面板在 top layer 里按初始包含块解析，实测 `inset-block-start: 100%` 把面板放到视口底边（`0,900`），完全不在触发器下方。
10. **隐式锚点只在「调用者触发」时成立**：`popovertarget` 点击打开时 `position-area: bottom span-right` 正确贴在触发器下沿；但脚本 `showPopover()` 打开时隐式锚点为空，面板落到视口原点 `0,0`。→ 所以组件用 `uid('--bn-dropdown-')` 给触发器命名 `anchor-name`、给面板写 `position-anchor`（唯一名字，两个下拉不互相偷锚点），CSS 在无脚本时退回隐式锚点。
11. 用 `anchor()` 函数（`inset-block-start: anchor(end)` + 显式 `anchor-name`）在 155 上把面板放到 `0,0`（不走），而 `position-area` + 同一显式锚点正确 → **最终用 `position-area`**。
12. **兜底方案（已落地）**：`position-try-fallbacks: flip-block, flip-inline`。触发器在视口底部时，只有带该声明才会**翻到触发器上方**（实测：无声明时面板底 900 与触发器重叠；有声明时面板在触发器上方且横向对齐、完整在视口内）。不支持这些属性的引擎会整条声明被丢弃，退回 UA 默认行为。
13. 无脚本时（`javaScriptEnabled: false`）点击触发器：面板照样打开、贴在触发器下沿、硬阴影完整 → CSS 侧不依赖 JS 成立。

探测脚本为一次性（`.scratch/popover-probe*.mjs`），跑完已删除，未提交。

### 测试清单与全绿证据

**`npm test`（`node --test tests/js/base.test.mjs tests/js/dropdown.test.mjs`，显式两文件，不用裸 `node --test`）→ `tests 41 / pass 41 / fail 0`，EXIT=0**（18 号票 22 个用例一字未动）。

新增 19 个用例（`tests/js/dropdown.test.mjs`）：

1. `init() finds the trigger and the panel the author wrote, and never builds one`（不生成节点；`events()` 只绑三个已实现类型）
2. `a <bn-dropdown> with no [popovertarget] initialises quietly` →**验证方式 2**
3. `a trigger pointing at nothing, or at a non-popover, initialises quietly`（4 种残缺：id 不存在 / id 指别处 / 目标无 `popover` / 引擎无 popover API）→**验证方式 2**
4. `a quietly-exited dropdown still answers teardown()`
5. `opening and closing emit bubbling, composed CustomEvents with the parts` →**验证方式 3**
6. `the trigger reports the state, and teardown() restores what the author wrote`
7. `opening moves focus to the first item and leaves exactly one tabbable item`
8. `ArrowDown / ArrowUp move through the items and wrap at the ends` →**验证方式 1**
9. `Home and End jump to the ends, and a letter key is left alone` →**验证方式 1**
10. `navigation keys do nothing while the menu is closed`
11. `Escape closes an open menu and hands focus back to the trigger` →**验证方式 1**
12. `Escape on a closed menu is a no-op`
13. `picking an item announces bn:select, closes the menu and returns focus` →**验证方式 1**
14. `the value falls back to the item text, and a click elsewhere selects nothing`
15. `a click that lands on a child of an item still selects that item`
16. `a close that happened away from the menu leaves focus where the visitor put it`
17. `tabbing out of the menu closes it, without pulling focus back`
18. `the element names its own anchor, uniquely, and removes it again on teardown`
19. `the package entry registers <bn-dropdown>`

`node --test` 的 DOM stub 只能匹配复合选择器（标签 / `.class` / `[attr]` / `[attr="v"]` / `:popover-open`）；遇到别的形态会**抛错**而不是静默匹配不到，所以用例不会因为「选择器没命中」而假绿。`toggle` 由 stub 同步派发（真实是排队任务），`bubbles` 按属性断言（Node 的 `EventTarget` 不做祖先传播）——两点已在文件头注明。

**`npm run verify:dropdown`（`node scripts/verify-dropdown.mjs`）→ 17/17，EXIT=0**：

- 静态 7 项：复用 `BnBase`/`keys.js`/`keydownIndex` 且无 `attachShadow` 无 `console.`；产物注册元素且不含 `attachShadow`；CSS 不发明名字（`--bn-*` / `--_` 两命名空间）、无颜色字面量、几何属性无数字字面量、槽位只指向令牌或按约定归零；动效只在 `no-preference` 内且无 `reduce` 块；只用后代选择器（非 `:host`）；产物两块层归属正确；文档页无 H1/H2、无围栏外裸 HTML、id 与 `popovertarget` 一一对应、无尾斜杠链接。
- 浏览器 10 项：popover/锚点 API 可用性 →**验证方式 4**；点击触发器打开 + `bn:open` 冒泡/`composed`/detail 是元素 + 面板贴触发器下沿且 `anchor-name` 唯一 →**验证方式 3**；残缺结构零异常零 console →**验证方式 2**；方向键/Home/End 漫游 + Enter 选择 + Esc 关闭 + 焦点归还 →**验证方式 1**；`<a class="bn-dropdown-item">` 也可选且 `value` 回退为标签；同页两个下拉锚点互不相同且各自贴自己的触发器；视口底部触发器面板上翻且不出视口；点外部关闭且不抢焦点；无脚本兜底（隐式锚点）；reduce 下 `animation: none` 且 `transition-duration: 0s`、no-preference 下 `bn-fade-in-up` / `0.15s`。

**回归（全部在最终代码上重跑，一条断言未删改）**

| 命令 | 实测 |
|---|---|
| `npm test` | `tests 41 / pass 41 / fail 0`，EXIT=0 |
| `node scripts/verify.mjs` | 21/21，EXIT=0 |
| `node scripts/verify-theme.mjs` | 16/16，EXIT=0 |
| `node scripts/verify-site.mjs` | 24/24，EXIT=0 |
| `node scripts/verify-base.mjs` | 35/35，EXIT=0 |
| `node scripts/verify-demo.mjs` | 19/19，EXIT=0（含 5 条真 Chrome 断言） |
| `node scripts/verify-deploy.mjs` | 12/12，EXIT=0 |
| `node scripts/verify-button.mjs` | 21/21，EXIT=0 |
| `npm run verify:dropdown` | 17/17，EXIT=0 |
| `npm run build` | 4 产物，`0 warnings, 0 errors`，EXIT=0 |
| `seite build --strict` | `✓ Built 3 components, 2 pages`，EXIT=0 |
| `seite check --strict` | `✓ No problems found`，EXIT=0 |
| `Select-String -Path static/barnacle.js,static/barnacle.min.js -Pattern attachShadow` | 0 命中 |

**文档站示例的真实运行验证**（一次性脚本，跑完删除）：`dist/components/dropdown` 页 2 个 HTML 围栏都拿到 Preview/Code 双标签；预览里点触发器 → `:popover-open`、面板贴合触发器（`anchored: true`）、硬阴影 `rgb(0, 0, 0) 4px 4px 0px 0px`、条目 `box-shadow: none`；焦点进入菜单 → `Rename`，`ArrowDown` → `Duplicate`，`Esc` 关闭且焦点回到触发器；第二个示例的 `[aria-checked="true"]` 项为 `--bn-main` 底 + 黑字；`errors: []`。

### 决策与偏离（供协调代理核对）

1. **锚定用 `position-area` 而不是 `position: absolute`**：实测 top-layer 里的绝对定位按初始包含块解析（放到视口底边），必须走 CSS 锚点定位；`anchor()` 函数在 155 上表现不对（`0,0`），`position-area` 正确。
2. **JS 写了两条内联定位样式**（触发器的 `anchor-name`、面板的 `position-anchor`，`uid('--bn-dropdown-')` 保证唯一），`teardown()` 里移除。这不是结构、不是样式值，只是把「谁是锚点」告诉 CSS；无脚本时 CSS 退回隐式锚点仍然正确。「JS 只加行为」因此在定位上有一处显式例外，已写进文档页。
3. **入场动画落在 `src/css/animations.css`**（spec §5 把 `@keyframes` 划给该文件，recipes §6.1/§23 也这么示范）：新增 `@keyframes bn-fade-in-up` + `bn-dropdown [popover]:popover-open` 规则，都在 `no-preference` 守卫内；`dropdown.css` 只保留条目过渡。若 10–16 号票也要用该关键帧，直接复用同一名字，冲突面仅一行。
4. **额外绑 `focusout`**：平台不会在焦点离开 auto popover 时关闭它（实测 Tab 走后菜单仍开着），所以「焦点移到面板外的可聚焦元素 → 关闭且不夺回焦点」。移到「无（body/null）」时（点面板内边距、点不可聚焦区域）交给平台的 light dismiss，避免误关。
5. `package.json` 的 `test` 改成**显式两个文件**；新增 `verify:dropdown` 脚本。四份产物按规矩重建提交。
6. 命名：锚点名 `--bn-dropdown-<n>` 是 CSS 锚点命名空间的 dashed-ident（不是自定义属性），按 ADR-0005 用 `bn-` 前缀。

### 未验证项

- **只有 system Chrome 155.0.8059.82**（`channel: 'chrome'`，headless）实测。Firefox / Safari 未测：那里 `position-try-fallbacks`、`anchor-name` 支持度未知；JS 用 `CSS.supports` 检测后才写内联锚点，CSS 退回隐式锚点，若两者都无则面板退回 UA 的视口居中定位（可用但不好看）。
- **长按方向键的连续移动**（`event.repeat`）未在浏览器里实测，只有 18 号票的单测保证。
- **键盘焦点环与硬阴影在暗色下的目视核对**未做（`verify-theme` 与 `verify-button` 已覆盖同类断言）。
- 双语（`/zh/`）下拉页属 23 号票；截图级视觉回归属 08/24 号票。
- `dist/` 是构建产物（已 gitignore），本轮 `seite build` 的 dist 留在工作区未提交。

