# 18: 浅 DOM 基类与 `window.bn`

**What to build:** 三个自定义元素的共同底座：生命周期、`handleEvent` 分发、键盘导航、事件派发、id 生成。同时把 `window.bn` 这个全局面钉死——IIFE 下无法具名导出，全局命名空间是唯一出口，所以它必须窄且被验证过。

**Blocked by:** 06

**Status:** ready-for-agent

- [ ] `BnBase` 提供生命周期、`handleEvent` 分发、键盘导航、事件派发与 id 生成
- [ ] 事件一律 `CustomEvent` 且 `bubbles: true, composed: true`（spec §9）
- [ ] **只用浅 DOM**，不用 Shadow DOM（ADR-0002）；组件是对内部原生元素的增强而非替代
- [ ] 初始化在 DOM ready 后一次性完成，**可重复调用不重复绑定**
- [ ] `window.bn` 面窄且被测试钉死，内部实现不泄漏到全局
- [ ] 只有「有内部状态与生命周期」的能力才做成自定义元素；无状态能力留作普通模块
- [ ] 禁止跟随系统的暗色模式等库级约定不被 JS 绕过
- [ ] `src/js/index.js` 完成自定义元素注册与 `window.bn` 挂载

**测试要求**

本票起 JS 逻辑开始存在，**必须用 `node --test` 写真实测试**（Node 内置，零额外依赖）：`BnBase` 的生命周期与分发、重复初始化不重复绑定、`CustomEvent` 的 `bubbles`/`composed`、id 生成的唯一性。JS 票是这套票里唯一「测试先行」真正成立的部分。

**验证方式**

1. `node --test` 全绿。
2. 连续两次触发初始化，确认监听器数量不变、行为不重复。
3. 断开并重连一个自定义元素，确认无残留监听。
4. 在页面上枚举 `window` 上被新增的可枚举属性，确认只有 `bn`。
5. 确认产物中没有 `attachShadow` 调用。

## Answer

实现落在 `ticket/18-base-class`，基线 `327178b`（已含 01–06），收尾时 `git merge feat/barnacle-v1` 快进到 `de4d983`（拿到 08 号票未合并前的那处 `verify-base.mjs` 过期断言修复），最终 commit `1402bbc`。

### 交付物

| 文件 | 内容 |
|---|---|
| `src/js/base.js` | `BnBase`（浅 DOM 基类，234 行） |
| `src/js/keys.js` | 纯函数：`NAVIGATION_KEYS`、`resolveHandlerName`、`keydownIndex`（不依赖 DOM，可直接测） |
| `src/js/uid.js` | 纯函数 `uid(prefix = 'bn-')`：模块级计数器 → 页面内唯一 |
| `src/js/namespace.js` | `createNamespace(globalObject = globalThis)`：挂载唯一全局并把面收窄 |
| `src/js/index.js` | 打包入口：挂 `window.bn`，19–22 在此 `bn.register('<bn-…>', X)` |
| `tests/js/base.test.mjs` | 22 个 `node --test` 用例（DOM stub + 动态 import） |
| `static/barnacle{,.min}.js` | 重建产物：1126 B / 596 B |

### `BnBase` 的 API 面（19/20/21/22 照此实现）

生命周期：
- `connectedCallback()` / `disconnectedCallback()`：不要覆写（要覆写必须 `super`）。DOM 未 ready 时把初始化推到 `DOMContentLoaded` 之后；已 ready（`defer` 部署的常态）时在 `connectedCallback` 内同步完成。重复连接、重复断开都安全。
- `init()`：子类覆写。增强**已存在**的浅子树；找不到内部结构就安静退出，**不得抛错**（19 号票的显式要求）。
- `teardown()`：子类覆写。撤销 `init()`，包括用 `this.a(...)` 挂的监听。

事件分发约定：
- `events()` → `string[]`：要绑的事件类型。基类在这条列表里**去重**，且只绑「确实存在同名 `on<event>` 方法」的类型（声明了但没实现不报错）。
- 每个事件类型对应方法 `on<EventName>`；`resolveHandlerName` 的规则是 `on` + 事件类型 PascalCase，`-` 与 `:` 都作分词符：`click→onClick`、`keydown→onKeydown`、`bn:select→onBnSelect`、`bn:before-open→onBnBeforeOpen`。
- `handleEvent(event)`：基类作为监听器注册到元素上（`addEventListener(type, this)`），按 `resolveHandlerName(event.type)` 分发。事件类型没有对应方法时是 no-op。
- `a(type, handler)` → 运行时挂额外监听并纳入记账，`teardown()` 一并解绑（重复挂同一个 handler 只算一次）。

事件派发：
- `emit(type, detail = {})` → `CustomEvent`，恒为 `bubbles: true, composed: true`（spec §9），在自身 `dispatchEvent`，返回该事件。这是组件对外通告的唯一方式（建议命名 `bn:change` / `bn:select` / `bn:open` / `bn:close`）。

键盘导航入口：
- `onKeydown(event)`（由 `events()` 里写 `'keydown'` 启用）只接管 `NAVIGATION_KEYS`：`ArrowUp/Down/Left/Right`、`Home`、`End`、`PageUp/PageDown`。其他键一律不碰（`Escape`/`Enter`/`Tab` 保持原生语义）。
- 子类只实现 `keydown(key, event)` → `boolean`（`true` = 已处理 → 基类 `preventDefault()`）。**`BnBase` 故意不提供 `keydown` 的默认实现**：基类一旦拥有这个名字，运行期赋值 `el.keydown = …` 会被原型方法永久遮蔽（实现过程中正是踩到这个坑才发现）。
- 索引计算是纯函数 `keydownIndex(key, activeIndex, count, { wrap = false })` → 下一个索引，`-1` = 这个键不归我们管（含空集合）。两端默认**夹紧**不环绕（`role=tablist`/`role=listbox` 都要这个行为）。用法：
  ```js
  import { keydownIndex } from './keys.js';
  keydown(key) { const next = keydownIndex(key, this.active, this.items().length);
                 if (next < 0) return false; this.activate(next); return true; }
  ```
- `static isNavigationKey(key)`、`focusOnly(items, activeIndex)`（roving tabindex：只有 active 的 `tabIndex = 0`，越界夹紧到首项，空表返回 `-1`）、`activeIndex(items, node)`。

id 生成：
- 模块级 `uid(prefix = 'bn-')`，自增计数器 → `bn-1`、`bn-2`……**页面生命周期内唯一**；实例上 `this.uid(prefix)` 直接委托它，所以两个元素、以及模块自身永不相撞。用途：`aria-controls` / `aria-labelledby` / popover target。

### `window.bn` 的最终形状

```js
window.bn = { version: '0.1.0', register(name, ctor) }
```

- 只有这一个可枚举全局属性（`enumerable/writable/configurable` 全为 `true`，就是一个普通属性，不是锁定对象）。
- `register()` 只做一件事：`customElements.define`。同一个构造器重复注册是 no-op（bundle 可能被求值两次），换一个构造器注册同名元素则报错并点名该元素名——否则已构造的实例会被永久留在旧类上。
- `installed` 标记用 `Object.defineProperty(..., { enumerable: false })`，因此**不出现在 `Object.keys`/`for…in` 里**，但它确实存在于该对象上（`'installed' in window.bn === true`）。这是有意的内部标记，用于幂等挂载；如果 22 号票要「零多余出口」，可以改成 `WeakSet` 记账。`BnBase`、`keys.js`、`uid.js`、`namespace.js` 都**不在**全局面上。
- `src/js/index.js` 目前不注册任何自定义元素（19–22 才有），因此当前产物的 IIFE 里只有命名空间那一段；`base.js` 因为无人 import 被 esbuild 摇掉了（所以产物 1126 B）。19 号票一 import，它就会进产物。
- 只有「有内部状态与生命周期」的能力才做元素：当前注册数为 0；22 号票的 `toast` 是纯模块反例。

### 测试与证据

`npm run test` = `node --test tests/js/base.test.mjs`（**显式路径**；裸 `node --test` 会递归发现 cwd 下所有 `*.test.*`，将来会把 08 号票 `tests/browser/` 下需要 Chrome 的测试也拉进来）。**没有加 `--test-force-exit`**：本文件用 `node:test` 的默认行为，不打开任何超时句柄，用例结束后事件循环自然排空、进程自行退出（实测 `node --test tests/js/base.test.mjs` → `EXIT=0`，无挂起）。

`class extends HTMLElement` 在裸 Node 不存在，所以测试文件顶部先装最小 stub（`globalThis.HTMLElement` 一个 `EventTarget` 子类、`globalThis.CustomEvent` 一个 `Event` 子类、`globalThis.customElements`、`globalThis.document`），**再动态 `await import(...)`**（静态 import 会被提升到 stub 之上）；同时把不依赖 DOM 的算术拆进 `keys.js` / `uid.js` 逐个直测。

22 个用例（`✔` 全绿，`tests 22 / pass 22 / fail 0`，约 74 ms）：
1. `uid()` never repeats itself and carries the requested prefix — 200 次唯一 + `/^bn-\d+$/`
2. `resolveHandlerName maps an event in any spelling onto its on<Event> method` — 5 组映射
3. `handleEvent dispatches to the on<event> method for the event type`
4. `connectedCallback with a complete document initialises the element exactly once`
5. `a second connect() binds no duplicate listener and does not double-handle` ← 验证方式 2
6. `disconnectedCallback tears down, and a reconnect re-initialises without residue` ← 验证方式 3
7. `events() declares the types whose on<event> method exists, and only those`（去重 + 无实现不绑）
8. `when DOM ready is deferred, connectedCallback initialises after the event fires`（只注册 1 个 `DOMContentLoaded`）
9. `a listener added with a() is tracked and removed by teardown()`
10. `emit() dispatches a bubbling, composed CustomEvent on the element` ← 验证方式 3 的 `bubbles`/`composed` 断言
11. `emit() defaults to an empty detail object`
12. `keydownIndex maps navigation keys onto the next index`（12 组键→索引）
13. `keydownIndex clamps instead of wrapping, and survives degenerate input`
14. `onKeydown calls keydown() and prevents default only for a navigation key`
15. `onKeydown handles every press and leaves auto-repeat to the component`
16. `onKeydown does not preventDefault when keydown() declines the key`
17. `focusOnly makes exactly one element focusable (roving tabindex)`
18. `uid() on the element and the id helper stay unique on the same page` ← 验证方式 1 的 id 唯一性
19. `createNamespace adds exactly one enumerable global and returns it`
20. `register() defines a custom element once and is idempotent for the same constructor`
21. `register() reports a missing registry instead of throwing something opaque`
22. `the package entry registers the elements and mounts window.bn`（import 入口后全局只多 `bn`）

**验证方式 4（真浏览器，已用 `playwright-core@1.64.1` 实测，`npm i --no-save`，未写进 `package.json`；`package-lock.json` 无漂移）**：`file://` 下列举 `for…in window` 不可靠（Node 26 / Electron 的 `file://` 行为与文档站不同），改用一次性探针：`http://127.0.0.1:<随机端口>/` 送一个空页 + `/static/barnacle.js`（用 `page.addScriptTag` 以经典脚本方式加载），Node 侧先 `page.evaluate` 取基线名字再加载库，最后求差集。实测（system Chrome 155.0.8059.82）：

```json
{ "after": ["bn"], "initialNames": 243,
  "bnKeys": ["register","version"], "bnEnumeration": ["register","version"],
  "descriptor": { "enumerable": true, "writable": true, "configurable": true },
  "bnVersion": "0.1.0", "bnRegister": "function", "errors": [] }
```

→ 新增的可枚举全局属性**只有 `bn`**，且 `bn` 的可枚举属性只有 `register` / `version`。探针是一次性脚本（`.scratch/ticket-18-global-check.mjs`），跑完已删除、未提交：常驻的浏览器验收台是 08 号票的交付物，18 号票不重复造。**局限**：当前产物不注册任何元素，「注册了元素之后全局面是否仍然只有 `bn`」要等 19–22 收尾时重跑——而 `register()` 只写 `customElements`、不碰 `window`，源码级用例 22 已钉死这一点。

**验证方式 5**：`Select-String -Path static/barnacle.js,static/barnacle.min.js -Pattern attachShadow` → 无匹配（两份产物都没有这个字符串）。`src/js/*.js` 里只有 `base.js` 的文档注释提到 `attachShadow` 一词（「本库不碰它」），无任何调用。
另外 `src/js/*.js` 里 `prefers-color-scheme` 无匹配 → JS 没有绕过「不跟随系统暗色」这条库级约定（该约定归 CSS/`data-theme`）。

### 逐条验证命令与实测结果（均在最终代码上重跑）

| 命令 | 结果 |
|---|---|
| `node --test tests/js/base.test.mjs` | `tests 22 / pass 22 / fail 0`，`EXIT=0` |
| `node scripts/verify.mjs` | 21/21，`EXIT=0` |
| `node scripts/verify-theme.mjs` | 16/16，`EXIT=0` |
| `node scripts/verify-site.mjs` | 24/24，`EXIT=0` |
| `node scripts/verify-base.mjs` | 35/35，`EXIT=0`（merge 前确为 34/35，缺的正是 `feat/barnacle-v1` 上那处修复） |
| `node scripts/verify-demo.mjs` | 19/19，`EXIT=0`（装了 `playwright-core`，6 条浏览器断言真的跑了，含「阻断 `static/barnacle.js` 后演示层与主题开关仍工作」） |
| `node scripts/verify-deploy.mjs` | 12/12，`EXIT=0`（子路径下四份产物 HTTP 200 且与 `static/` 逐字节一致） |
| `npm run build` | 4 产物，`0 warnings, 0 errors`；`barnacle.js 1126 B`、`barnacle.min.js 596 B`（min < full 成立） |

`npm i` 在本 worktree 上首次执行时 esbuild 的 postinstall 被 npm 拦下（`install-scripts` 未批准），但 `@esbuild/win32-x64` 已装、构建链与全部 verify 脚本均通过，未影响任何断言。

### 偏离与决定（供 19–22 与协调代理核对）

1. **索引算术放在 `keys.js` 而不是实例方法上**（`keydownIndex` 需 `import`）。理由：它是纯函数，放实例上就只能靠 DOM stub 测；ticket 原文只要求「键盘导航」有底座，两种放法都满足。
2. **`BnBase` 不提供 `keydown()` 默认实现**（见上「键盘导航入口」），故 19–22 若要用键盘必须自己声明 `keydown`，否则 `onKeydown` 静默不做事。
3. **`onKeydown` 不吞自动重复**：长按方向键必须继续移动，`event.repeat` 原样交给组件自行判断（初版写成「同一个键第二次不再处理」，被长按场景否决）。
4. `--test-force-exit` 未加，理由见上（纯 Node 测试，无悬挂句柄）。
5. `window.bn` 上保留了不可枚举的 `installed` 标记；若 22 号票要求零多余属性，改用模块私有 `WeakSet` 即可，不改变对外行为。
6. `verify-base.mjs` 与本票无关（06 号票的脚本），本票未改；35/35 是靠 merge `feat/barnacle-v1` 拿到的。

