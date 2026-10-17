# 21: TagInput

**What to build:** `<bn-taginput>` 可用。这是全库唯一一个有复杂内部状态的组件——标签数组的增删、输入解析、退格删除、以及对外读写接口。

**Blocked by:** 18, 12

**Status:** ready-for-agent

- [ ] `<bn-taginput>` 支持输入添加、逐项删除与退格删除
- [ ] 标签的视觉形态与 12 号票的 Form 样式同源，不另起一套
- [ ] 提供受控的读写接口（读当前标签、写标签集合）
- [ ] 变更派发 `CustomEvent`，`bubbles: true, composed: true`
- [ ] 键盘可完整操作，焦点环可见；删除标签不改变容器边框宽度
- [ ] 不使用 Shadow DOM（ADR-0002）
- [ ] 文档站出现「TagInput」页，含可运行示例与选项说明

**测试要求**

用 `node --test` 重点覆盖标签数组状态机：解析添加、逐项删除、退格删除、去重与空值处理、读写接口的双向一致。这是全库最值得测试先行的一块。

**验证方式**

1. `node --test` 全绿。
2. 仅用键盘完成添加、删除与清空。
3. 程序化写入标签后读取，确认双向一致。
4. 删除标签前后读取容器尺寸与边框宽度，确认无跳动。
5. 监听事件确认 detail 内容。

## Answer

实现落在 `ticket/21-taginput`（基线 `fb6c315`，即 `ticket/12-form` 的 tip，已含 01–12、14–20、22）：实现提交 `58d310f`，`git merge feat/barnacle-v1` 干净合并（`b12f1b9`，无文件改动），本 `## Answer` 与 CSS 收尾落在之后的提交。`Status:` 行按纪律未动（由协调代理收尾统一翻转）。

### 交付物

| 文件 | 内容 |
|---|---|
| `src/js/taginput.js` | `BnTagInput extends BnBase` + 导出的纯函数 `normaliseTags()` / `TAG_DELIMITER`；状态机只有 `_tags` 一处，DOM/属性/事件都是它的视图 |
| `src/css/taginput.css` | 12 条规则，全部锚定在 `bn-taginput` / 其内部部件上；字段盒与 Form 同源，芯片复用 `.bn-badge` |
| `src/js/index.js` | 新增 `bn.register('bn-taginput', BnTagInput)`（只加不减，`bn-dropdown`/`bn-tabs` 原样保留） |
| `content/components/taginput.md` | 文档页：2 个可运行 HTML 示例 + 2 个 js 围栏；正文无 H2、无尾斜杠链接、围栏只带裸语言标记 |
| `tests/js/taginput.test.mjs` | 23 个 `node --test` 用例（最小 DOM stub + 动态 import，沿用 18/20 号票手法） |
| `scripts/verify-taginput.mjs` | 21 项验证（13 静态 + 8 真 Chrome），`--no-browser` 可跳过浏览器项 |
| `package.json` | `test` 显式追加 `tests/js/taginput.test.mjs`；新增 `verify:taginput`；`"dependencies": {}` 保留 |
| `static/barnacle{,.min}.{css,js}` | 重建产物：162168 / 34018 / 45320 / 15808 B，`npm run build` 0 warnings 0 errors |

### 作者写法（HTML 片段）

```html
<bn-taginput value="Design, Code">
  <input type="text" placeholder="Add a tag…">
</bn-taginput>
```

- **入口输入框就是作者写的那一个 `<input>`**（元素内第一个 `<input>`），浅 DOM，不克隆、不替换、不生成（ADR-0002）。元素只在它前面插入芯片；没有 `<input>` 时 `init()` 直接 `return`：不抛错、不打日志、不创建任何节点，`_initialised` 仍为 `true`。
- **初始标签有两个来源，元素自身的 `value` 优先**：`<bn-taginput value="Design, Code">`；没有该属性时读输入框自己的 `value`（这一份无脚本也能看见、能编辑，所以文档推荐写在输入框上）。读完后输入框被清空，标签成为芯片。
- 之后**每次变更都把归一化后的集合写回元素的 `value` 属性**，所以 `getAttribute('value')` 恒等于 `tags().join(', ')`；元素不监听 `value`（写状态请用方法），只监听 `disabled`（`static observedAttributes = ['disabled']`，脚本 toggle 时输入框与每个删除按钮同步禁用/启用）。
- 芯片的 DOM：`<span class="bn-badge bn-tag" data-variant="secondary">Design<button type="button" class="bn-taginput-remove" aria-label="Remove Design">×</button></span>`。`.bn-badge` 提供全部视觉（`badge.css`），`.bn-tag` 供元素识别（决策 §8 给本票的内部类名），`.bn-taginput-remove` 是删除按钮。

### 读写接口（确切签名）

```js
tags()                        // → string[]              当前标签，按顺序，返回副本
setTags(value)                // (string[] | string) → string[]   整体替换，返回写入后实际持有的集合
addTag(value)                 // (string) → string[]     追加一个值（或逗号串）；重复/空值忽略
removeTagAt(index)            // (number) → string[]     按下标删除；越界是静默 no-op
clearTags()                   // () → string[]           清空
```

- 全部写操作走同一条 `_commit(next, source)` 路径：比较前后集合 → 渲染 → 反射 `value` → 派发事件；**集合没变就什么都不做**（幂等：不渲染、不派发，芯片节点对象保持不变，实测断言过）。
- `tags()` 返回 `[...]` 副本，调用方改它不会改状态（有用例）。
- 传入字符串按逗号解析，数组里含逗号的成员也拆开；`null`/`undefined` 丢弃，其它值 `String()` 后处理。
- 程序化写不移动焦点（`removeTagAt()` 同理）；用户触发（点 ×、Delete/Backspace、退格删除）在删除后把焦点还给输入框，便于继续输入。

### 去重 / 空值 / trim 策略（写死在代码与文档里）

1. **trim**：每个值先 `trim()`，`"  Design  "` → `"Design"`。
2. **空值忽略**：`""`、纯空白、`null`、`undefined` 都不是标签，静默丢弃。
3. **去重大小写敏感**：trim 后做**精确字符串比较**——`Design` 与 `design` 是两个标签，重复的 `Design` 只有一个；顺序保留（先到的拼写与位置胜出）。理由写进文档：标识符、文件名、大小写敏感的 token 不能被静默改形。
4. **逗号是唯一分隔符**：键入、粘贴、`setTags('a, b')`、数组里含逗号，含义一致。

### 事件（确切形状）

```js
bn:change  // CustomEvent，bubbles: true, composed: true，在 <bn-taginput> 自身上派发
detail = { tags: string[], added: string[], removed: string[], source: 'input' | 'remove' | 'backspace' | 'api' }
```

- `tags` 是变更后的完整集合；`added`/`removed` 是这次真正加上/去掉的值（顺序变更时两者都可能为空）。
- `source`：`'input'`（Enter / 逗号 / 粘贴）、`'remove'`（点 ×、聚焦删除按钮按 Delete/Backspace、按钮上的 Enter/Space 原生 click）、`'backspace'`（空输入框退格删最后一个）、`'api'`（五个方法中的任意一个）。
- **只有集合真的变了才派发**：幂等写入、空输入框 Enter、没有标签时的 Backspace、点到芯片文字的点击都不派发（各有用例/浏览器断言）；`init()` 装载时不派发。

### 键盘模型（仅键盘可完成全部操作，实测）

- 输入框内：`Enter` 提交并清空（空输入框时**不** `preventDefault`，保留表单提交语义）；`,` 提交且永不进入标签内容；`Backspace` 在输入框为空时删最后一个标签。
- 删除按钮聚焦时：`Delete`/`Backspace` 删掉所属芯片；`Enter`/`Space` 是按钮原生 click。
- 游走：DOM 顺序是「芯片（含 × 按钮）在前、输入框在后」，所以 `Tab` 先走各 × 再进输入框（视觉顺序 = 焦点顺序）；`ArrowLeft` 在**空输入框**时进入最后一个芯片、`ArrowRight` 在最后一个芯片时回到输入框，芯片之间 `ArrowLeft/Right/Home/End` 用 `keydownIndex()` 移动、两端夹紧不环绕；输入框有文字时方向键/Home/End 一律交还光标（返回 `false`）。
- 焦点环：输入框与删除按钮都用基础层的 `:focus-visible` outline（3px 实线 `rgb(116,185,255)`），输入框 `outline-offset: 2px`、按钮同样 2px；`bn-taginput:focus-within` 另把边框染成 `--bn-main` 作为整块字段的附加提示（只改颜色，见偏离 1）。
- **删除标签不改容器边框宽度**：尺寸与边框只在一条静止规则里声明一次，没有任何 `:hover`/`:focus`/`[disabled]` 规则写宽度或 padding（`verify-taginput.mjs` 静态断言 + 浏览器测量）。

### 测试清单（23 例，`npm test` 全绿：101/101）

标签数组状态机（本票主体）：

1. `normaliseTags trims, drops empty values and keeps the first spelling of a duplicate`（纯函数：trim / 空值 / 大小写敏感去重 / 逗号串 / null 与数字）
2. `init renders the authored value as one chip per tag, before the entry field`（初始解析 + 顺序 + 反射 `value` + 输入框清空）
3. `Enter commits what was typed, clears the field and announces one bn:change`（含 detail 键集合、`bubbles`/`composed`、`source`）
4. `the comma commits too, and a pasted list splits on it while the unfinished tail stays`（逗号 preventDefault + 粘贴拆分的尾部保留）
5. `an empty or whitespace-only value commits nothing and leaves the key to the browser`
6. `a duplicate typed twice lands once and announces nothing the second time`（大小写敏感 + 只派发一次）
7. `a click on a chip's remove button takes that tag and gives the field its focus back`（逐项删除 + detail `removed` + 焦点归还）
8. `a click on a chip's label is inert — the chip is a label, not a control`
9. `Delete on a focused remove button takes the chip it belongs to`
10. `Backspace on an empty field removes the last tag, one press per tag`（含删空后的第 4 次按键不接管）
11. `Backspace while the field holds text leaves the caret — and the tags — alone`
12. `writing a set and reading it back agree, after trimming, dropping empties and de-duplicating`（读写双向一致 + 属性反射 + 事件）
13. `writing the set the field already holds changes nothing and announces nothing`（幂等：无事件、芯片节点同一性不变）
14. `addTag, removeTagAt and clearTags write through the same path and report their source`（含越界 no-op、API 不移动焦点）
15. `tags() hands back a copy, so a caller cannot mutate the state machine`
16. `the entry field can seed the list too, so the page reads without a script`（输入框种子 + teardown 还原）
17. `ArrowLeft on an empty field steps back into the chips, and ArrowRight returns to the field`
18. `the arrows and Home/End walk the remove buttons and clamp at both ends`
19. `ArrowLeft in a field that holds text is the caret’s business, not the chips’`
20. `an element with no entry field is a quiet no-op`（容错）
21. `teardown removes the generated chips and the listeners, and a reconnect repaints the tags`（无残留 + 重复 connect 不重复绑定）
22. `a disabled element disables the field and every remove button, and can be switched back`
23. `the package entry registers <bn-taginput>`

`npm test`（显式列五个文件）：`tests 101 / pass 101 / fail 0`，`EXIT=0`（约 116 ms）。

### 浏览器验收（`npm run verify:taginput` = `node scripts/verify-taginput.mjs` → **21/21**，`EXIT=0`）

`npm i --no-save playwright-core@1.64.1`（未改 `package.json` 依赖与 lockfile），system Chrome `155.0.8059.82`，`channel: 'chrome'`，断言前冻结 `transition`/`animation`，焦点一律真 `Tab`。8 个浏览器项的实测要点：

- **验证方式 1+2（键盘）**：三次 `Tab` 进入输入框（先经两个芯片的 ×，证明 DOM 顺序=焦点顺序）；`:focus-visible` 为 3px 实线 `rgb(116, 185, 255)`、offset `2px`；`:focus-within` 把边框染成 `rgb(255, 210, 63)`。键入 `UI`+`Enter`、`Docs`+`,` 各得一个芯片（顺序 `Design,Code,UI,Docs`，输入框每次清空）；空输入框 `ArrowLeft` 进最后一个 ×、`Delete` 删除并**把焦点还给输入框**；连续 3 次 `Backspace` 清空（第 4 次不接管）；清空后再次键入 `Last`+`Enter` 仍可加。
- **验证方式 3（程序化读写）**：`setTags([' Design ','design','Design','','   ','Code'])` → 返回并读回 `Design|design|Code`，属性 `"Design, design, Code"`，3 个芯片，1 次事件；重复写同一集合 → 事件数不变、芯片数不变；`setTags(' one , TWO ,, one ')` → `one|TWO`；`clearTags()` → 空、0 芯片、属性 `""`；`tags()` 副本被改不影响状态。
- **验证方式 4（尺寸与边框）**：`#empty` 填 3 个芯片，点 ×、键盘 Backspace、API `removeTagAt` 三种删除各测一次：读数为 **`{"width":1264,"height":50}` → `{"width":1264,"height":50}`**，`top/right/bottom/left` 四条边框**全程 3px**；删到空仍是同一尺寸。
- **验证方式 5（事件 detail）**：document 上的监听者收到 4 次 `bn:change`：`isCustomEvent: true`、`bubbles: true`、`composed: true`、`target` 是元素本身、`detail` 键集合恰为 `added, removed, source, tags`，四种 `source` 依次为 `input` / `remove` / `backspace` / `api`。
- **与 Form 同源的实测**：tag 字段与相邻的裸 `<input type="text">` 逐项比对——边框 3px、圆角 0px、静止阴影 `rgb(0, 0, 0) 2px 2px 0px 0px`、`min-height: 40px`、表面 `rgb(255, 255, 255)` 全部相同；悬停时两者都只把阴影档位升到 `rgb(0, 0, 0) 4px 4px 0px 0px` 且 `transform: none`（字段不抬起）；内部输入框 `border-width: 0px`、无阴影（`box-shadow: none`）。
- **禁用**：`[disabled]` → 输入框与全部 × 按钮 `disabled`、标签保留、边框仍 3px；移除属性后双向恢复。
- **验证方式 6（`javaScriptEnabled: false`）**：0 芯片、0 删除按钮；作者写的 `<input>` 可见、墨色可读、自身边框 0px（看起来就是一个标签字段），键入 `Design, Code` 文字完整保留、容器仍是 3px 边框 + sm 阴影。降级说明写在文档页 `### Without JavaScript`。
- **预览面板可交互**：`dist/components/taginput.html` 里 2 个围栏各自成为 `[data-site-demo]`，2 个 `<bn-taginput>` 都被库产物增强（初始 2 芯片）；在预览里点输入框、键入 `Preview`、`Enter` → 3 个芯片；点第一个 × → 2 个芯片；第二个示例是 `disabled`（输入框与 × 全禁用）；0 console error / 0 page error。
- **视觉抽查（一次性探针，跑完已删、未提交）**：亮色 3 芯片字段 `640×50`，芯片 3px 边框 + 2px 阴影、0px 圆角；暗色字段 `#262626` 底 + 白框、静止白影 `rgb(255, 253, 245) 2px 2px`（悬停升到 4px）、芯片深底白框白影；`data-theme="dark"` 落在 `<html>` 上。截图看过亮/暗/聚焦/芯片聚焦四种状态。

### 回归（全绿，未删改任何既有断言）

| 命令 | 结果 |
|---|---|
| `npm test` | `tests 101 / pass 101 / fail 0`，`EXIT=0` |
| `npm run test:browser` | `tests 11 / pass 11 / fail 0`，`EXIT=0` |
| `npm run test:browser:mutations` | `11 mutants + 1 unmutated control, all as designed`，`static/barnacle.css` sha256 未变，`EXIT=0` |
| `node scripts/verify.mjs` | 21/21，`EXIT=0` |
| `node scripts/verify-theme.mjs` | 16/16，`EXIT=0` |
| `node scripts/verify-site.mjs` | 24/24，`EXIT=0` |
| `node scripts/verify-base.mjs` | 35/35，`EXIT=0` |
| `node scripts/verify-static.mjs` | 26/26，`EXIT=0` |
| `node scripts/verify-interaction.mjs` | 15/15，`EXIT=0` |
| `node scripts/verify-button.mjs` | 21/21，`EXIT=0` |
| `node scripts/verify-tabs.mjs` | 19/19，`EXIT=0` |
| `node scripts/verify-form.mjs` | 21/21，`EXIT=0` |
| `node scripts/verify-switch.mjs` | 21/21，`EXIT=0` |
| `node scripts/verify-dropdown.mjs` | 17/17，`EXIT=0` |
| `node scripts/verify-dialog.mjs` | 15/15，`EXIT=0` |
| `node scripts/verify-accordion.mjs` | 29/29，`EXIT=0` |
| `node scripts/verify-table.mjs` | 34/34，`EXIT=0` |
| `node scripts/verify-progress.mjs` | 17/17，`EXIT=0` |
| `node scripts/verify-layout.mjs` | 22/22，`EXIT=0` |
| `node scripts/verify-toast.mjs` | 19/19，`EXIT=0` |
| `npm run verify:taginput` | 21/21，`EXIT=0` |
| `node scripts/verify-demo.mjs` | 19/19，`EXIT=0` |
| `node scripts/verify-site-shell.mjs` | 9/9，`EXIT=0` |
| `node scripts/verify-deploy.mjs` | 12/12，`EXIT=0` |
| `seite build --strict` | `✓ Built 19 components, 2 pages`，`EXIT=0` |
| `seite check --strict` | `✓ No problems found`，`EXIT=0` |

新文件均为 UTF-8 无 BOM、LF（逐字节检查过）。`npm ci` 的 esbuild postinstall 被 npm 拦下（与 20/22 号票一致），`@esbuild/win32-x64` 可用，构建与全部验证通过。

### 偏离与决定（供协调代理核对）

1. **焦点指示：容器不画环，环留在被聚焦的控件上（偏离 `component-style-recipes.md` §25 的首选写法）。** 配方给的形状是 `bn-taginput:focus-within { outline: … }` + `bn-taginput:focus-within > input:focus-visible { outline: none }`，并声明那是 §5 禁令的唯一合法例外。**但本仓库的验证脚本按原文禁止 `outline: none` 出现在产物里**（`verify-base.mjs` 对整个产物做 `outline:\s*none` 断言；`verify-button/verify-form/verify-switch/verify-dropdown/verify-tabs` 同类），所以那条例外在本仓库不可实现。改为：输入框与 × 按钮各自保留基础层的 `:focus-visible` 环（3px 实线、offset 2px，比库默认更贴，因为字段内 padding 更小），容器在 `:focus-within` 时把边框染成 `--bn-main` 作为“整块字段已激活”的附加提示。WCAG F78 满足且没有删掉任何指示器；`verify-taginput.mjs` 静态断言“本文件不写 outline/outline-style/outline-color/outline-width，offset 只出现在 `:focus-visible` 上且只能是 `\d+px` 或 `--_focus-ring-offset`”。
2. **芯片复用 `.bn-badge`，另加识别类 `.bn-tag`。** 配方 §25 让芯片直接用 `.bn-badge`；决策 §8 的表里给了本票 `.bn-tag` 作为内部类名。两者都用：`class="bn-badge bn-tag"`，视觉全部来自 `badge.css`（`taginput.css` 对 `.bn-tag` 只写 `flex / max-inline-size / white-space / overflow-wrap` 四个布局属性，静态断言钉死“不许重绘”），`.bn-tag` 只用于元素自己识别芯片。删除按钮是 `.bn-taginput-remove`（`bn-` 前缀，JS 生成部件，同 `.bn-dropdown-item`）。
3. **字段盒与 Form 同源的具体口径**：`--_shadow-rest: var(--bn-shadow-sm)`、`--_surface: var(--bn-secondary-background)`、`border-width: var(--bn-border-width)`、`border-color: var(--_border-rest)`、`border-radius: var(--bn-radius)`、`min-block-size: 2.5rem` 六项**逐项等于 form.css 文本框**（静态断言从 `form.css` 原文取参照值，不重算本票文件）；唯一不同的是 padding（本票 `0.375rem 0.5rem`，Form 是 `0.5rem 0.75rem`），因为芯片自带 3px 框，需要更薄的槽位。padding 是比例不是令牌（form.css §2 的同一论证），且状态规则一律不许写 padding。
4. **初始标签的两个来源**：元素 `value` 属性优先，否则读输入框自己的 `value`（无脚本可读）。`teardown()` 把输入框的 `value` 还原成作者写的、删掉所有生成的芯片，但**保留 `_tags`**，所以元素在 DOM 里移动（disconnect→connect）不会丢标签，重连时从状态重绘。
5. **用户删除 vs 程序化删除的焦点策略**：用户触发（点 ×、Delete/Backspace、空框退格）删除后焦点回到输入框；`removeTagAt()`/`setTags()`/`clearTags()` 不动焦点（避免在页面别处的按钮里调用时抢走焦点）。
6. **`disabled` 被观察**：`static observedAttributes = ['disabled']` + `attributeChangedCallback` 同步输入框与所有 × 按钮；芯片在禁用期间创建时“出生即禁用”。`[disabled]` 的视觉沿用 form.css 禁用口径（表面回落到 `--bn-background`、`opacity: 0.6`），基础层对 `bn-taginput[disabled]` 的 `pointer-events: none` 一并生效。
7. **没有 `!important` 字样（连注释也不行）**：本票第一版 CSS 注释里写了 “no `!important`”，`verify-theme.mjs` 直接扫原始产物文本判红（决策 §13 已警告过）。改成 “no declaration marked as important” 后 16/16。以后新票注意。
8. **一次异常记录（诚实披露）**：CSS/JS 收尾改动的当次 `verify:taginput` 曾出现 2 个 browser 项失败（“禁用后标签丢失”“预览里添加后芯片数不符”，两者 `tags()` 都对、只有 `querySelectorAll('.bn-tag').length` 不符），此后连续 6 次 + 全部回归各 1 次均 21/21，无法复现；疑似该次运行与产物重建的时序有关，非状态机逻辑问题（同类断言在 node 测试与之后的浏览器运行里稳定通过）。若协调代理在合并后见到，可先重跑一次再判断。

### 仍未验证项

1. **屏幕阅读器实机朗读**（NVDA/JAWS/VoiceOver）未测：ARIA 只做了最小集（× 按钮的 `aria-label="Remove <tag>"`、输入框沿用作者自己的 label/placeholder），没有实现 WAI-ARIA combobox 模式（无建议列表，故未设 `role="combobox"`/`aria-expanded`）。
2. **输入法（IME）组合输入**未测：`keydown` 里没有检查 `event.isComposing`，中文/日文输入法在候选态按 `Enter` 理论上会被当作提交；这是真实风险，需要真机输入法验证（文档未承诺 IME 行为）。
3. **超长标签 / 大量标签换行**只做过一次性视觉抽查（`.bn-tag` 允许 `white-space: normal` + `overflow-wrap: anywhere` 以免撑破字段），没有固化成断言；换行导致的高度变化属于布局而非“跳动”（边框宽度始终不变）。
4. **表单参与**未实现：元素不是 form-associated custom element（无 `ElementInternals`/`name` 提交），`value` 只在 DOM 属性上反射；v1 未要求。
5. **标签重排 / 拖拽**未实现（不在 ticket 范围内）。
6. 连接前的 API 写入（`setTags` 在 `init()` 之前调用）在 node stub 里覆盖了“没有输入框”的分支，但没有在浏览器里测过“未连接元素先写、连接后渲染”。

