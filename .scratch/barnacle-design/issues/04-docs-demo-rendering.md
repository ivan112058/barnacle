# 04: 文档站示例渲染层

**What to build:** 组件文档页的写法定型：Markdown 里只写代码围栏，由模板与站点脚本把它改造成「预览 / 代码」双标签界面。内容文件因此保持干净，复杂度集中在渲染层——后面每一张组件票都直接吃这套机制。同时补上导航栏的显式主题开关。

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] Markdown 中的代码围栏被渲染层改造成双标签界面：预览面板注入真实 HTML 并在页面样式作用域内生效，代码面板显示原文且正确转义
- [ ] 内容文件里**不出现任何新语法**：作者只写标准代码围栏
- [ ] 组件页正文**不出现 H2**（H2 由组件索引模板供给）
- [ ] 导航栏有主题开关，切换时设置 `data-theme="dark"` / `data-theme="light"` 并在刷新后保持
- [ ] 主题开关不依赖库的 JS（无脚本时页面仍可读）

**验证方式**

1. 在 02 号票的占位内容里放一段纯 HTML + CSS 围栏，确认预览与代码双标签都工作，且代码面板的尖括号没有被当成标签解析。
2. 用无脚本模式装载页面，确认内容可读、主题开关的默认态合理。
3. 记录实测到的围栏拦截方式（seite 的自定义短代码语法、或构建后处理），以及它是否受 spec §14 待验证事项 5 的语法差异影响。

## Answer

### 改动文件

| 文件 | 变更 |
|---|---|
| `static/site.js` | 新增（站点脚本，9.3KB）：围栏→「预览 / 代码」双标签渲染层 + 主题开关接线。 |
| `templates/base.html` | `<head>` 内联防闪烁主题脚本；导航栏主题开关按钮；用 `{{ site.base_url }}/static/site.js` 引入站点脚本。 |
| `templates/component.html` | 模板注入组件页唯一 H2：`<h2 id="example" data-site-heading="example">Example</h2>`。 |
| `static/style.css` | `html[data-theme="dark"]` 下的 `--site-*` 暗色令牌、站点网格线改用 `--site-grid`、`.site-theme` 开关样式、`.site-demo*` 双标签样式。 |
| `content/components/button.md` | 新增（占位）：3 个围栏——HTML+内联 `<style>` 演示、纯 HTML 变体演示（都得到双标签）、纯 CSS 围栏（保持纯代码块）。**07 号票可整体替换正文**，frontmatter 之外无需保留。 |
| `scripts/verify-demo.mjs` | 新增：19 项校验（14 静态 + 5 浏览器）。 |
| `package.json` | 只加一行 `"verify:demo": "node scripts/verify-demo.mjs"`。 |
| `README.md` | 记录 `verify-demo.mjs`，以及「playwright-core 不进 package.json」的本地安装方式。 |

未改任何库文件（`src/`、`static/barnacle.*` 四份产物、`scripts/verify*.mjs` 既有三个脚本），未改其他 ticket、`spec.md`、`docs/adr/`。

### 验证方式 3 的最终结论：围栏拦截方式

**结论：既不是 seite 短代码，也不是构建后处理，而是站点脚本在浏览器里改 DOM（纯客户端）。**

- 实测产出的围栏是 seite 原样的 `<pre style="background-color:#2b303b;">` + 内联 `<span style="color:…">`，**没有 `<code>`、没有 `language-*` class**；`dist/` 里**不含任何** `role="tablist"` / `data-site-demo` / 站点标签结构（断言 `the built HTML still carries the raw fence: the layer is client-side` 实测：`raw <pre> in dist/, zero tablist markup in dist/`）。
- 因此围栏的**文本内容**是唯一可用信号。`static/site.js` 只在 `.site-prose` 正文作用域内查找 `pre`，并在**改 DOM 之前**先把文本读出来（读取时剥掉 seite 的 `.seite-copy-btn`，无论两者先后顺序都成立）。
- 形态判定：去空白后以 `<` 开头、且片段里存在**会渲染的元素** → 生成双标签；否则**原样保留 seite 的代码块**（Copy 按钮一并留着）。
- spec §14 事项 5 的语法差异**不影响本方案**：我们根本没用短代码。实测（seite-findings §5.2 A）body 短代码里紧贴围栏会被 markdown 当 raw HTML 块吞掉，这也是不走短代码路线的直接理由。也没有构建后处理：`minify = false` + 站点脚本的组合让「提交的产物 = 站点服务的产物」继续成立。
- **对协调代理字面规则的一处细化（记录在案）**：「以 `<` 开头且含标签」之外，我还要求片段里存在一个会渲染的元素（`script/link/meta/style/base/title/template/noscript` 不算）。理由：`content/pages/usage.md` 里已有一个 `<link>` + `<script>` 的 CDN 片段，按字面规则它也会拿到预览面板——那是个空面板，而且会真的去请求 jsDelivr 上的 CSS。实测：usage 页那个围栏保持纯代码块；button 页的 `<style>`+`<div>` 围栏照常得到双标签（`<style>` 本身不算渲染元素，但同片段里的 `<div>`/`<button>` 让它通过）。
- 预览注入的是**真实 HTML**（`innerHTML`，脚本因此天然不执行），所以库的全局样式与页面样式都直接作用于它——「在页面样式作用域内生效」；代码面板用的是**原封不动的 seite `<pre>`**（转义与高亮都是 seite 做的，尖括号不会被当标签解析）。
- 已知代价（记录给后续组件票）：预览里的 `<style>` 是**注入到整个页面**的（没有 shadow DOM，这正是预览能生效的原因）。因此示例自带的 CSS 必须自己限定作用域（本票占位内容用 `.site-demo-button button`，只命中演示容器内部）。将来演示 `:root` 级令牌覆盖的页面应当明确这是有意的全局效果。

### 验证方式 1：预览 / 代码双标签

命令：`node scripts/verify-demo.mjs`（浏览器部分需临时装 `playwright-core`，见下）。

关键实测输出（全部 PASS，19/19）：

```
PASS  the preview/code pair is built for HTML fences and not for plain code fences
      — 2 tab pairs + 1 untouched code fence, Preview selected in both
PASS  the preview panel injects real HTML and the page styles reach it
      — real <button> in preview, escaped source in code, seite Copy buttons intact
PASS  the tablist is keyboard operable with arrow keys, Home and End
      — ArrowRight/ArrowLeft/Home/End all move selection and visibility
```

具体断言（`/barnacle/components/button`，随机端口本地 HTTP 服务 + 真实系统 Chrome 155.0.8059.82，`channel:'chrome'`，断言前冻结 `transition`/`animation`）：

1. `[data-site-demo]` = 2、`[role="tablist"]` = 2、`[role="tab"]` = 4、`[role="tabpanel"]` = 4；留在 `.site-prose` 直属的 `<pre>`（即纯 CSS 围栏）= 1；两组的 `aria-selected` 序列 = `true,false,true,false`（**默认展示预览**）。
2. 预览面板里是**真实 `<button>` 元素**（`tagName === 'BUTTON'`、`className === 'bn-button'`、点击回调真的触发），且预览面板的 `innerHTML` 里**没有** `&lt;`；计算样式 `box-shadow: rgb(0, 0, 0) 4px 4px 0px 0px`、`border-top-width: 3px` —— 证明**围栏里的 `<style>` 作用到了注入的真实 HTML**。
3. 代码面板 = seite 的 `<pre>`（1 个），面板内 `button:not(.seite-copy-btn)` = 0（尖括号没有被解析成标签），`innerHTML` 含 `&lt;`，`textContent` 原样含 `<button class="bn-button"`；`[data-site-demo] .seite-copy-btn` = 2 —— **seite 的 Copy 结构未被破坏**。
4. 键盘：`ArrowRight` → 焦点与选中移到 Code、`tabindex` 变 `-1,0`、面板可见性互换；`ArrowLeft` 回到 Preview；再 `ArrowLeft` 环绕到 Code；`Home`/`End` 到首/末。`role="tablist"`/`role="tab"`/`role="tabpanel"` + `aria-controls`/`aria-labelledby`/`aria-selected` 齐备。
5. 内容文件「无新语法」由静态断言保证：`content/**/*.md` 里没有 `{{<` / `{{%` 短代码、围栏外没有裸 HTML 标签（行内 code span 已剔除）、围栏 info string 只是语言名（无 `{`、`=` 等指令形态）、正文里不出现 `site-demo` / `data-site-` 标记。

### 勾选项：组件页正文不出现 H2

- **实际做的是 `templates/component.html` 注入 H2**（`<h2 class="site-component__section" id="example" data-site-heading="example">Example</h2>`），而不是 ticket 里写的「组件索引模板」：spec §10 的原文是「H2 由**渲染层**供给」，而 `components-index.html` 渲染的是索引页本身、根本不渲染组件页正文。这是一处措辞偏离，按 spec 落。
- 保证方式（可复现的断言，两条互补）：
  1. 源码侧：`component page sources carry no H1 or H2 of their own` —— 每个 `content/components/<slug>.md` 的正文（非 frontmatter、非围栏）不得出现 `#`/`##` 标题。作者只能写 H3 及以下。
  2. 产物侧：`every component page renders exactly one H2, injected by the template` —— 每个 `dist/components/<slug>.html` 的 `<h2>` **恰好 1 个**，且这唯一一个带 `data-site-heading=`（= 模板注入的那个）。实测：`button.html=1`。
- **失败模式实测**（不是推断）：把整套站点复制到临时目录，只在 `content/components/button.md` 末尾追加一行 `## An authored H2` 后 `seite build`，实测产物 `<h2>` 计数从 1 变 **2**（1 个模板注入 + 1 个作者写的），断言 `an authored H2 really does produce a second H2` 通过。也就是说上面第 2 条断言真的会咬住 H2 回归，而不是恒真。

### 勾选项：导航栏主题开关

- 开关落在 **`<html>`**：`static/site.js` 通过 `document.documentElement.setAttribute('data-theme', …)` 设置。实测三条证据：
  1. 浏览器实测断言：点一下按钮后 `document.documentElement.getAttribute('data-theme') === 'dark'` **且** `document.body.getAttribute('data-theme') === null`（断言名：`the theme switch sets data-theme on <html>, persists, and never lands on <body>`）。
  2. 视觉随动：`getComputedStyle(document.body).backgroundColor` 从 `rgb(255, 253, 245)` 变 `rgb(26, 26, 26)`，`<html>` 上的 `--site-ink` 变 `#fffdf5`（站点自己的 `--site-*` 暗色令牌生效）；库的 `[data-theme="dark"]`（`01-theme.css`）也因此作用在 `<html>` 上——这正是协调代理 §8 要求的落点，落在 `<body>` 上硬阴影不会翻白。
  3. 刷新保持：`localStorage['barnacle-site-theme']` 写入后 reload，`data-theme` 仍为 `dark`，`aria-pressed` 仍为 `true`；再点一次回到 `data-theme="light"` 并存 `light`。
- **不依赖库的 JS**：防闪烁的半段是 `base.html` 的 `<head>` 内联脚本（首帧前从 `localStorage` 应用 `data-theme`），点击接线在站点脚本 `static/site.js`；`static/barnacle.js` 一行都没参与。实测断言 `the demo layer and the theme switch work with the library script blocked`：把 `**/static/barnacle.js` 直接 `route.abort()`（并确认它真的进了 `requestfailed` 列表）后，双标签照常生成 2 组、点击开关仍得到 `data-theme="dark"`。
- 视觉用 `site-` 类名（`.site-theme`，选中态走 `[aria-pressed="true"]`），不碰 `bn-`；`static/style.css` 里仍然 0 个 `.bn-`/`--bn-`（02 的既有断言继续通过）。
- 无脚本默认态：静态断言 `no built page ships a baked-in data-theme` —— 所有产物 HTML 都不带 `data-theme`（缺省即亮色，ADR-0004）；另外 `html:not([data-site-js]) [data-site-theme-toggle] { display: none }` 保证站点脚本缺席时不显示一个死按钮。

### 验证方式 2：无脚本模式可读性

- 用 `javaScriptEnabled: false` 的真实上下文装载 `/barnacle/components/button`（断言名 `with no site script the page stays readable and the toggle stays hidden`），实测：
  - `.site-prose` 可见、`innerText` 长度 > 200；
  - 正文里能读到围栏源码文本（含 `<button class="bn-button"` 字面量）；
  - `.site-prose pre` = **3**（三个围栏都以代码块形态存在）；
  - `[data-site-demo]` = **0**（双标签结构完全由 JS 生成，正文本身不由 JS 生成）；
  - 主题开关 `isVisible() === false`。
- 结论：JS 缺席时页面是「正文 + 代码块」，内容 100% 可读；库的暗色令牌不生效（无 `data-theme`），符合 ADR-0004 的亮色默认。

### 本票实际做的浏览器实测 / 依赖

- 真跑了浏览器：`playwright-core` + `channel: 'chrome'`（系统 Chrome 155.0.8059.82），站点挂在随机端口的 `/barnacle/` 子路径上（页面里指向 `https://ivan112058.github.io/barnacle/...` 的绝对资源 URL 用 `context.route` 回填 `dist/`，顺带验证了子路径资源引用）。
- **`playwright-core` 没有进 `package.json`**（那是 08 号票的事）：我用 `npm i --no-save playwright-core@1.64.1` 在本 worktree 临时安装，实测 `git status` 里 `package.json` 只有 `verify:demo` 一行改动、**`package-lock.json` 完全未改**。`verify-demo.mjs` 在模块缺席时把 5 项浏览器校验标成 `SKIP` 并仍然用静态校验决定退出码，所以干净检出上 `npm run verify:demo` 也能跑（退出码 0，带 SKIP 提示）。
- 除脚本外还做了人工视觉确认（临时截图探针，已删除、未提交）：亮色 / 代码标签 / 暗色三张整页截图，确认双标签外观、预览里的真实按钮、纯 CSS 围栏仍是代码块、暗色下纸面与硬阴影翻白、开关按下态可见。

### 回归

```
npm run build            → build ok: 4 artifacts from 20 css files, 0 warnings, 0 errors
node scripts/verify.mjs       → 21/21 checks passed
node scripts/verify-theme.mjs → 16/16 checks passed
node scripts/verify-site.mjs  → 24/24 checks passed
node scripts/verify-demo.mjs  → 19/19 checks passed
```

既有断言一条没删没改；`static/style.css` 与四份库产物仍然互不出现 `bn-`/`site-`。

### 未验证 / 已知问题（交给协调代理）

1. **seite 自带 Copy 按钮会多复制一个 "Copy" 字面量**（既存缺陷，非本票引入）。实测：在代码面板点 Copy，剪贴板内容 322 字符，结尾是 `…</div>\r\nCopy`。原因是 seite 注入的脚本拷贝 `pre.textContent`，而它自己把按钮 append 进了同一个 `<pre>`。**按指示没有碰这个结构**；若将来要修，最省事的是把围栏 token 包进 `<code>`（seite 脚本本身优先用 `pre.querySelector('code')`），但那是改 seite 产出的结构，需要协调代理拍板。
2. 双标签的可见文案（"Preview" / "Code"）目前是 `static/site.js` 里的英文常量，站点 chrome 也还没有 i18n 通道；`/zh/` 页面与语言切换器属于 23 号票，届时需要一个把文案传进来的入口（例如模板上的 `data-*`）。
3. 未在移动宽度/触屏下实测双标签（`@media (hover: hover)` 一类的取舍不在本票范围）。
4. 未在真实 GitHub Pages 上验证（子路径正确性在本地 `/barnacle/` 挂载 + 绝对 URL 回填下已验证，真机部署归 03/24 号票）。

