# oat —— 结构与信息架构参考

> 目的：本文是给**另一个项目**做设计参考用的 oat 结构档案。关注点是**结构与信息架构**（目录切分、分层顺序、文档站 IA、命名约定、构建链路），**不是视觉风格**。因此正文里只列选择器名称与文件组织，几乎不抄 oat 的 CSS 声明体。

## 0. 事实基线与核查方法

| 项目 | 值 | 来源 |
| --- | --- | --- |
| 上游仓库 | `https://github.com/knadh/oat` | clone remote |
| 本地浅克隆 | `C:\Users\hugh\AppData\Local\Temp\oat-research` | 任务给定路径，已确认存在 |
| 克隆类型 | shallow（`--depth 1`），分支 `master` | `git branch -a` |
| 被审阅 commit | `f84f69429d135418b7877827b43868fb2c6bccbd` | `git log -1` |
| 该 commit 时间 | `Sat Oct 10 15:28:31 2026 +0530` | `git log -1` |
| 该 commit 标题 | `Add a strong left-border to alert.` | `git log -1` |
| 最近 tag | `v0.8.3` | `git describe --tags --abbrev=0` |
| 工作树文件数 / 字节数 | 90 个文件 / 200,993 字节（不含 `.git`） | `Get-ChildItem -Recurse -File` 统计 |
| License | MIT，`Copyright (c) 2026 Kailash Nadh. https://nadh.in` | `LICENSE` |
| npm 包名 | `@knadh/oat` | `package.json` |

标注约定：下文凡不能从仓库直接核实的事实，一律标注 **[未验证]**。

---

## 1. 定位与设计哲学

### 1.1 README（`README.md`，1031 字节，17 行）

README 第 3 行的标语，逐字引用：

> Semantic, minimal, zero dependencies. ~10KB CSS and JS.

README 第 5、7、9 行正文，逐字引用：

> Oat is an ultra-lightweight HTML + CSS, semantic UI component library with zero dependencies. No framework, build, or dev complexity. Just include the tiny CSS and JS files and you are good to go building decent looking web applications with most commonly needed components and elements.
>
> Semantic tags and attributes are styled contextually out of the box without classes, forcing best practices, and reducing markup class pollution. A few dynamic components are WebComponents and use minimal JavaScript.
>
> I wrote this to use in my own projects after getting sick of the ridiculous bloat, dependencies, and rug-pulls in Javascript UI/component libraries.

README 第 11 行给出线上地址，第 13 行的状态声明（逐字引用）：

> **IMPORTANT:** The lib is currently sub v1 and is likely to have breaking changes until it hits v1.

### 1.2 首页 “Why?” 小节（`docs/templates/index.html`，3262 字节）

首页由 `docs/content/_index.md`（`template = "index.html"`）驱动。其 `<h1>` 为 `Ultra-lightweight UI library`，`<h3 class="slogan text-light">`（第 12 行）逐字引用：

> Semantic, minimal, zero dependencies. ~10KB CSS and JS.

首页导语两段（`index.html` 第 14–22 行）与 README 第 5、7 行**实质逐字相同**（仅换行与缩进不同）——也就是说 oat 把 README 正文当成官网 slogan 区复用了。

`index.html` 第 74–85 行的 `<h2>Why?</h2>` 小节，逐字引用：

> This was made after the unending frustration with the over-engineered bloat, complexity, and dependency-hell of pretty much every Javascript UI library and framework out there. Done with the continuous PTSD of rug-pulls and lockins of the Node.js ecosystem trash. <sup><a href="https://nadh.in/blog/javascript-ecosystem-software-development-are-a-hot-mess/">[1]</a></sup> I've published this, in case other Node.js ecosystem trauma victims find it useful.
>
> My goal is a simple, minimal, vanilla, standards-based UI library that I can use in my own projects for the long term without having to worry about Javascript ecosystem trash. Long term because it's just simple vanilla CSS and JS. The look and feel are influenced by the shadcn aesthetic.

（上文 `<sup>…</sup>` 是原文中的脚注链接，指向作者的博客文章 `javascript-ecosystem-software-development-are-a-hot-mess`。）

### 1.3 首页五张特性卡（`index.html` 第 30–70 行）

`<section class="features">` 里是 5 个 `<article class="card">`，标题分别是：

1. `Light like an oat flake` — 文案称 “**7KB** CSS, **2.9KB** JS, minified + gzipped.”
2. `Zero dependencies`
3. `Semantic HTML`
4. `Accessibility`
5. `Easy customization`

注意数字口径差异：README 说 “~10KB CSS and JS”，首页卡片说 7KB + 2.9KB（≈10KB），两者自洽。**实际 dist 产物大小本次未能测量**——`dist/` 被 `.gitignore` 忽略，浅克隆中不存在。**[未验证]**

### 1.4 声明的范围（stated scope）

从 README 与首页可归纳出的**明确包含**：

- 纯 HTML + CSS 的语义化组件库，**零依赖**（不依赖任何 JS/CSS 框架，`package.json` 无 `dependencies` / `devDependencies` 字段）。
- 覆盖 “most commonly needed components and elements”（常用组件与元素）。
- 少量动态组件用 **Web Components** 实现，JS 体量极小。
- 消费者侧 **不需要框架、不需要构建**：直接引入 CSS + JS 即可（`docs/content/usage.md` 的 Basic usage 示例只有 `<link>` + `<script defer>`）。
- 原生元素与语义属性优先：`<button>`、`<input>`、`<dialog>`、`<progress>`、`<meter>`、`<details>/<summary>`、`role="alert"`、`role="switch"`、`popover` / `popovertarget`、`command` / `commandfor`。

**明确排除**：框架绑定、Node.js 工具链依赖、构建步骤（对消费者而言）。

### 1.5 状态（pre-v1）

- README 第 13 行、`docs/content/usage.md` 第 5 行都重复了同一条 sub-v1 警告。
- `package.json` 的 `version` 是**占位符**字符串 `"version-0.0.0"`，由 Makefile 的 `publish` 目标在打包时用 `git describe` 的结果替换（见 `Makefile` 第 67–68 行）。因此仓库里的 `package.json` 版本号**不代表已发布版本**。
- 最近 tag 为 `v0.8.3`，与 “sub v1” 的声明一致。

### 1.6 License

`LICENSE`（1090 字节）为标准 MIT 全文，首行 `The MIT License`，版权行 `Copyright (c) 2026 Kailash Nadh. https://nadh.in`。`package.json` 的 `"license": "MIT"` 与之一致。

---

## 2. 仓库目录布局

下面是完整目录树（不含 `.git`），行尾标注字节数。缩进层级对应真实目录层级。

```
oat-research/                                        200,993 字节 / 90 文件（总计）
├── .github/
│   └── workflows/
│       └── publish-website.yml                            762   CI：构建 dist 并把 docs 部署到 gh-pages
├── .gitignore                                              26   dist、docs/static/oat.min.*
├── LICENSE                                               1090   MIT
├── Makefile                                              2450   唯一构建入口：css / js / dist / size / clean / publish
├── README.md                                             1031   标语 + 定位 + sub-v1 警告（无 API 文档）
├── package.json                                           557   npm 元数据 + files 白名单 + unpkg/jsdelivr 入口
├── src/                                                        库本体（源码，发布时原样复制进 dist）
│   ├── css/                                   43,708 字节 / 24 文件
│   │   ├── 00-base.css                                   3405   @layer 顺序声明 + @layer base（元素默认样式）
│   │   ├── 01-theme.css                                  2847   @layer theme：:root 全部 token + [data-variant] 色映射
│   │   ├── animations.css                                 647   @layer animations：reduced-motion、dialog::backdrop、keyframes
│   │   ├── accordion.css                                 1500   @layer components
│   │   ├── alert.css                                      895   @layer components
│   │   ├── avatar.css                                    1444   @layer components
│   │   ├── badge.css                                     1647   @layer components
│   │   ├── button.css                                    3657   @layer base + @layer components（两段）
│   │   ├── card.css                                       250   @layer components（最小的组件文件）
│   │   ├── dialog.css                                    1859   @layer components
│   │   ├── dropdown.css                                  1079   @layer components
│   │   ├── form.css                                      7081   @layer base + @layer components（最大的 CSS 文件）
│   │   ├── grid.css                                      1526   @layer components（含 :root 网格 token）
│   │   ├── progress.css                                  1499   @layer base（同时服务 <progress> 与 <meter>）
│   │   ├── sidebar.css                                   4186   @layer components（含 :root --sidebar-width）
│   │   ├── skeleton.css                                   794   @layer components
│   │   ├── spinner.css                                    916   @layer components
│   │   ├── table.css                                      869   @layer base
│   │   ├── tabs.css                                      1065   @layer components
│   │   ├── taginput.css                                   992   @layer components
│   │   ├── toast.css                                     2233   @layer components
│   │   ├── tooltip.css                                   1428   @layer components
│   │   ├── upload.css                                     327   @layer components（第二小）
│   │   └── utilities.css                                 1562   @layer utilities
│   └── js/                                    22,914 字节 / 9 文件
│       ├── index.js                                       367   入口：import 全部模块 + 注册 window.ot
│       ├── base.js                                       2872   OtBase 基类 + 两个 DOM 级 polyfill/shim（无自定义元素）
│       ├── dropdown.js                                   2210   ot-dropdown（Web Component）
│       ├── sidebar.js                                     835   纯行为模块（document 级事件委托）
│       ├── tabs.js                                       3691   ot-tabs（Web Component）
│       ├── taginput.js                                   5150   ot-taginput（Web Component，最大 JS 文件）
│       ├── toast.js                                      3490   纯模块，导出 toast / toastEl / toastClear
│       ├── tooltip.js                                    1498   纯模块，IIFE 风格，受特性检测保护
│       └── upload.js                                     2801   ot-upload（Web Component）
└── docs/                                                       Zola 静态站点（既是文档也是 demo）
    ├── config.toml                                        236   base_url/title/highlighting/description
    ├── content/                                15,700 字节 / 7 文件（顶层非组件页）
    │   ├── _index.md                                        46   首页（template = index.html）
    │   ├── demo.md                                          72   kitchensink（template = demo.html）
    │   ├── usage.md                                       1981   安装与用法
    │   ├── customizing.md                                 3203   选择性子集 + 主题变量覆盖 + 暗色模式
    │   ├── recipes.md                                     8289   组合配方（9 个 H2）
    │   ├── extensions.md                                  1097   社区扩展清单
    │   ├── other-libs.md                                  1012   作者其他零依赖库清单
    │   └── components/                          34,950 字节 / 27 文件
    │       ├── _index.md                                   124   组件 section（sort_by = weight）
    │       └── *.md                                 26 个   每个组件一个文档页（见第 6、7 节）
    ├── templates/                               31,381 字节 / 4 文件（不含子目录）
    │   ├── base.html                                      5323   全站骨架：topnav + sidebar + main
    │   ├── index.html                                     3262   首页
    │   ├── page.html                                       183   普通页默认模板
    │   ├── demo.html                                     22613   kitchensink dashboard（最大文件）
    │   ├── components/
    │   │   ├── section.html                                862   /components/ 聚合页（循环所有组件页）
    │   │   └── page.html                                   184   单个组件页的独立 permalink 模板
    │   └── shortcodes/
    │       └── demo.html                                   105   demo 组件定义（唯一的短代码/组件）
    └── static/                                  45,037 字节 / 9 文件（同目录共 9 文件）
        ├── CNAME                                             8   oat.ink（GitHub Pages 自定义域名）
        ├── demo.css                                        6953   demo 专用主题（[data-demo-theme="slate"] 等）
        ├── style.css                                       4948   文档站外壳样式（topnav/sidebar/home/.ot-demo 布局）
        ├── main.js                                         5938   文档站脚本：代码块预览/编辑 tabs、导航高亮、主题切换
        ├── logo.svg                                        3689
        ├── favicon.svg                                     1788
        ├── github.svg                                       984
        ├── avatar.svg                                       269
        └── thumb.png                                      20460   OG 缩略图（二进制）
```

关键观察：

- **库本体（`src/`）只占 66,622 字节 / 33 文件**，其余 134,371 字节全是文档站（`docs/`）与工程脚手架。也就是说 **docs 站点的体量约为库本体的 2 倍**。
- `src/css/` 与 `src/js/` 是**唯一**发布内容来源；`Makefile` 把二者原样 `cp` 到 `dist/`（见 `Makefile` 第 63–64 行）。
- 没有 `test/`、没有 `tsconfig`、没有 lint 配置、没有 `devDependencies`——工程质量控制口径是“极小 + 手工核查”。

---

## 3. `src/css/` 的组织方式

### 3.1 拼接顺序（唯一权威来源：`Makefile` 第 5–28 行）

`Makefile` 变量 `CSS_FILES` 明确列出 24 个文件，顺序即 `cat` 的拼接顺序：

```
src/css/00-base.css
src/css/01-theme.css
src/css/animations.css
src/css/avatar.css
src/css/button.css
src/css/form.css
src/css/table.css
src/css/progress.css
src/css/spinner.css
src/css/grid.css
src/css/card.css
src/css/alert.css
src/css/badge.css
src/css/accordion.css
src/css/tabs.css
src/css/dialog.css
src/css/dropdown.css
src/css/toast.css
src/css/sidebar.css
src/css/taginput.css
src/css/skeleton.css
src/css/tooltip.css
src/css/upload.css
src/css/utilities.css
```

构建命令是裸 `cat`（`Makefile` 第 34 行）：`cat $(CSS_FILES) > dist/oat.css`，随后 esbuild `--minify`。**没有 `@import`、没有 bundler 的依赖解析**——文件顺序完全由 Makefile 决定，任何新增 CSS 文件都必须手工登记进 `CSS_FILES`，否则不会被打包。

本次校验：`src/css/` 恰好 24 个 `.css` 文件，与 `CSS_FILES` 一一对应，**没有漏登记的孤儿文件**。

### 3.2 `@layer` 声明与层序

层序声明只有一处，位于拼接结果的**第 1 行**——`src/css/00-base.css` 第 1 行：

```css
@layer theme, base, components, animations, utilities;
```

因为 `00-base.css` 是 `CSS_FILES` 的第一个文件，这条语句出现在最终 bundle 的最前面，先于任何 `@layer xxx { }` 块，因此层序被确定性地钉死为：

```
theme  <  base  <  components  <  animations  <  utilities
```

（左侧优先级低。CSS 层叠层的规则是：先比层序，**未分层的样式优先级高于所有分层样式**。）

各文件归属的层（逐文件核实）：

| 层 | 文件 |
| --- | --- |
| `theme` | `01-theme.css` |
| `base` | `00-base.css`、`table.css`、`progress.css`，以及 `button.css` 与 `form.css` 的**前半段** |
| `components` | `accordion.css`、`alert.css`、`avatar.css`、`badge.css`、`card.css`、`dialog.css`、`dropdown.css`、`grid.css`、`sidebar.css`、`skeleton.css`、`spinner.css`、`tabs.css`、`taginput.css`、`toast.css`、`tooltip.css`、`upload.css`，以及 `button.css`（第 117 行起）与 `form.css`（第 195 行起）的**后半段** |
| `animations` | `animations.css` |
| `utilities` | `utilities.css` |

值得注意的两处**单文件跨层**：

- `button.css`：第 1 行 `@layer base {`（原生 `<button>`、`[type=submit]`、`::file-selector-button` 的基础样式），第 117 行 `@layer components {`（`menu.buttons` 按钮组）。
- `form.css`：第 1 行 `@layer base {`（`label`、`input`、`textarea`、`select`、checkbox/radio/range、`fieldset`），第 195 行 `@layer components {`（`fieldset.group`、`[data-field]`）。

跨层拆分的意义是结构性的：**同一文件里，“原生元素默认样式”与“需要类/属性才生效的组合件样式”被分到不同层**，前者可被后者覆盖，后者可被 utilities 覆盖。

### 3.3 每个文件负责什么（选择器清单）

下列清单只列选择器，不含声明体。加粗的是文件的主选择器。

| 文件 | 顶层选择器（层内） |
| --- | --- |
| `00-base.css` | `html`、`body, dialog, [popover]`、`body`、`main`、`img, picture, video, canvas, svg`、`p, h1..h6`、`h1`…`h6`、`p`、`a`、`:is(p, blockquote, figcaption) a`、`strong, b`、`em, i`、`small`、`code`、`pre`、`blockquote`、`hr`、`ul, ol`、`ul`、`ol`、`li`、`mark`、`[hidden]`、`:focus-visible`、`:disabled, [aria-disabled="true"]`（另含全局 `*, *::before, *::after { box-sizing }`） |
| `01-theme.css` | **`:root`**（全部 token）、`[data-variant="success"]`、`[data-variant="warning"]`、`:is([data-variant="danger"], [data-variant="error"])`（三者只做 `--_variant-color` 映射） |
| `animations.css` | `@media (prefers-reduced-motion: reduce)` 全局降级、`dialog::backdrop`、`@keyframes fade-in-up` |
| `avatar.css` | `figure[data-variant="avatar"]:not([role="group"])`、`figure[data-variant="avatar"][role="group"]`（及组内子项） |
| `button.css` | base 段：`:is(button, [type=submit], [type=reset], [type=button], a.button), ::file-selector-button`、`::file-selector-button`；components 段：`menu.buttons` |
| `form.css` | base 段：`label`、`:where(input:not([type=checkbox], [type=radio], …), textarea, select)`、`textarea`、`select`、`input:where([type=checkbox], [type=radio])`、`input[type=checkbox]`（内含 `&[role=switch]`）、`input[type=radio]`、`input[type=range]`、`fieldset`、`legend`；components 段：`fieldset.group`、`[data-field]` |
| `table.css` | `.table`、`table`、`thead`、`tfoot`、`th, td`、`th`、`td`、`tbody tr` |
| `progress.css` | `progress, meter`（共享基础）、`progress`、`meter`（含 `::-webkit-meter-*`、`::-moz-meter-bar`） |
| `spinner.css` | `[aria-busy="true"]`、`@keyframes spin` |
| `grid.css` | `:root`（`--grid-cols` / `--grid-gap` / `--container-max` / `--container-pad`）、`.container`、`.row`、`.col, [class*="col-"]`、`.col-1`…`.col-12`、`.offset-1`…`.offset-6`、`[class*="offset-"]`、`.col-end` |
| `card.css` | `.card` |
| `alert.css` | `[role="alert"]` |
| `badge.css` | `.badge`、`a.badge:hover, a:hover .badge` |
| `accordion.css` | `details`、`summary`、`details > *:not(summary)`、`details[open] > *:not(summary)` |
| `tabs.css` | `[role="tablist"]`、`[role="tab"]`、`[role="tabpanel"]` |
| `dialog.css` | `dialog` |
| `dropdown.css` | `ot-dropdown` |
| `toast.css` | `.toast-container`、`.toast` |
| `sidebar.css` | `:root`（`--sidebar-width`）、`[data-sidebar-layout]`、`:is(nav, header)[data-topnav]`、`:is([data-sidebar-toggle], [data-sidebar-header])`、`[data-sidebar-toggle]`，以及 `@media (min-width: 769px)` / `@media (max-width: 768px)` 两段 |
| `taginput.css` | `ot-taginput` |
| `skeleton.css` | `[role="status"].skeleton`、`[role="status"].skeleton:last-child`、`@keyframes anim` |
| `tooltip.css` | `.ot-tooltip`、`@keyframes ot-tooltip` |
| `upload.css` | `ot-upload` |
| `utilities.css` | `.align-left/-center/-right`、`.text-light`、`.text-lighter`、`.flex`、`.flex-col`、`.items-center`、`.justify-center`、`.justify-between`、`.justify-end`、`.hstack`、`.vstack`、`.gap-1/2/4/6`、`.mt-2/4/6/8`、`.mb-2/4/6/8`、`.p-4`、`.w-100`、`:is(ul, ol).unstyled`、`a.unstyled` |

结构性规律（对借鉴者最有价值）：

1. **组件 CSS 的主选择器优先用语义元素/属性，而不是类**：`[role="alert"]`、`[role="tablist"]`、`[role="tab"]`、`[role="tabpanel"]`、`[aria-busy="true"]`、`[data-sidebar-layout]`、`[data-topnav]`、`details`/`summary`、`dialog`、`progress`、`meter`、`table`。
2. **只有“无处可挂语义”的组件才用类**：`.card`（因为要用 `<article>`）、`.badge`（用 `<span>`）、`.table`（可选增强）、`.toast`。全局只用 4 个组件类。
3. **Web Component 的样式挂在自定义元素标签本身**：`ot-dropdown`、`ot-taginput`、`ot-upload`（`ot-tabs` 反而挂在 ARIA 属性上，因为它在内部找 `role="tab"`）。
4. **响应式断点硬编码为 768px**，且在两处重复：`sidebar.css` 的 media query 与 `src/js/sidebar.js` 第 18 行的 `matchMedia('(max-width: 768px)')`；`grid.css` 也有 `@media (max-width: 768px)`。`sidebar.js` 的注释明确承认这是硬编码妥协（“no way to use a CSS variable in the @media{} query”）。

### 3.4 文档页与 CSS 文件 **不是** 1:1

这是 oat 结构上最需要被注意的一点：`docs/content/components/` 有 **26 个组件文档页**，而 `src/css/` 只有 **24 个 CSS 文件**，两边的边界完全不同。

**有文档页但没有专属 CSS 文件的组件：**

| 文档页 | 实际由谁实现 | 证据 |
| --- | --- | --- |
| `meter.md` | **共享 `progress.css`** | `progress.css` 第 2 行 `progress, meter { … }`，第 30 行起为 `meter { &::-webkit-meter-bar … }` 与 `::-moz-meter-bar` |
| `pagination.md` | **复用 `button.css` 与 `utilities.css`** | 全仓 `src/css/` 中检索 `pagination` **零命中**；文档页正文自述 “Pagination does not use any special markup or classes and re-uses the existing buttons `<menu>`”，示例用 `<menu class="buttons">` + `.button.outline.small` |
| `switch.md` | **寄居在 `form.css`** | `form.css` 第 101 行 `&[role=switch]`（在 `input[type=checkbox]` 块内），并定义局部变量 `--switch-height` / `--switch-inset` / `--switch-thumb`；全仓无 `switch.css` |
| `typography.md` | **`00-base.css`** | 无 `typography.css`；`00-base.css` 覆盖 `h1..h6`、`p`、`a`、`code`、`pre`、`blockquote`、`hr`、`ul/ol/li`、`small`、`mark`、`strong/em` |
| `breadcrumb.md` | **没有任何 oat CSS** | 全仓 `src/css/` 中检索 `breadcrumb` **零命中**；文档页纯用 `class="unstyled hstack"` + 内联 `style="font-size: var(--text-7)"` 组合 |
| `utilities.md` | `utilities.css`（1:1，但文档页正文只有一句指向 GitHub 链接，225 字节，是**最短**的组件页） | `utilities.md` 全文 7 行 |

**有 CSS 文件但没有组件文档页的：**

| 文件 | 情况 |
| --- | --- |
| `00-base.css` | 其“元素默认样式”部分被 `typography.md` 部分覆盖；但 `main`、`[hidden]`、`:focus-visible`、`:disabled`、`::file-selector-button` 等没有文档页 |
| `01-theme.css` | 由顶层页 `docs/content/customizing.md` 覆盖（不是组件页） |
| `animations.css` | **完全没有任何文档页**（既无组件页也无顶层页专门讲它）——它是一份“横切关注点”文件 |

**反向结论**：oat 的 CSS 文件切分粒度 = **实现粒度**，文档页切分粒度 = **用户心智粒度**。两者刻意的松耦合：`meter` 与 `progress` 是同一个控件家族（都是区间条），`switch` 是 checkbox 的一种角色，`pagination` 是按钮的组合，`breadcrumb` 是 utility 的组合。**借鉴时应复制这种“文档可以合并、实现可以复用”的宽容度**，而不是强行 1:1。

---

## 4. `src/js/` 的组织方式

### 4.1 模块清单（9 文件，22,914 字节）

| 文件 | 字节 | 类型 | 职责 | 是否 `customElements.define` |
| --- | --- | --- | --- | --- |
| `index.js` | 367 | 入口 / barrel | `import` 全部模块以触发副作用注册，然后挂载 `window.ot` | 否 |
| `base.js` | 2872 | 基础设施 | 导出 `OtBase` 基类；另有 2 个 DOM 级补丁在 import 时立即执行 | 否 |
| `dropdown.js` | 2210 | **Web Component** | `class OtDropdown extends OtBase` | 是 → `ot-dropdown` |
| `tabs.js` | 3691 | **Web Component** | `class OtTabs extends OtBase` | 是 → `ot-tabs` |
| `taginput.js` | 5150 | **Web Component** | `class OtTaginput extends OtBase` | 是 → `ot-taginput` |
| `upload.js` | 2801 | **Web Component** | `class OtUpload extends OtBase` | 是 → `ot-upload` |
| `toast.js` | 3490 | 纯行为模块 | 导出 `toast` / `toastEl` / `toastClear` 三个函数 | 否 |
| `tooltip.js` | 1498 | 纯行为模块 | IIFE 式，`document`/`window` 级事件委托，把 `title` 属性转成 popover tooltip | 否 |
| `sidebar.js` | 835 | 纯行为模块 | `document` 级 click 委托，切换 `[data-sidebar-open]` | 否 |

**Web Component 共 4 个**（`customElements.define` 的 4 处命中，逐文件核实）。其余 5 个是“plain behaviour module”，即：**不注册元素，靠事件委托或全局函数暴露能力的模块**。

一个值得借鉴的分工模式：**Web Component 只给“需要内部状态 + 生命周期”的组件**（dropdown 要管理焦点与定位、tabs 要管理选中态与 hash 同步、taginput 要维护 tag 数组、upload 要包装 file input）；而 **toast / tooltip / sidebar 这类“无元素状态、只作用于全局或已有 DOM”的能力，一律做成纯模块**，不做成 Web Component。

### 4.2 `index.js`（入口）—— 全文只有 14 行

结构上分两段：

1. 第 1–8 行：8 条 `import`，其中 6 条是**纯副作用导入**（`import './base.js'` 等），2 条带具名导入（`tooltip.js` 无具名导出；`toast.js` 导入 `{ toast, toastEl, toastClear }`）。
2. 第 10–14 行：注册全局 API。

关键点：**Web Components 没有集中注册表**，每个模块在自己的文件底部调用 `customElements.define(...)` 完成自注册；入口只负责“让这些模块被执行到”。

### 4.3 `OtBase` 基类（`base.js` 第 4–78 行）

`export class OtBase extends HTMLElement`，是 4 个 Web Component 的共同基类。它提供的契约：

| 成员 | 可见性 | 语义 |
| --- | --- | --- |
| `#initialized` | 私有字段 | 幂等保护 |
| `connectedCallback()` | 生命周期 | 若 `document.readyState === 'loading'`，挂一次性 `DOMContentLoaded` 再调 `#setup()`；否则直接调 `#setup()`。保证**只初始化一次** |
| `#setup()` | 私有 | 幂等检查后调用子类必须实现的 `init()` |
| `disconnectedCallback()` | 生命周期 | 调用 `cleanup()` |
| `cleanup()` | 可覆盖，默认空 | 子类在此解绑 `window`/元素级监听 |
| `handleEvent(event)` | 实现 `EventListener` | 按事件类型分发到 `this['on' + event.type]`。用法是 `el.addEventListener('click', this)`——**这是 oat 清理监听的统一机制**（见 `dropdown.js` 第 29–30 行、`tabs.js` 第 50–51 行） |
| `keyNav(event, idx, len, prevKey, nextKey, homeEnd = false)` | 工具 | 罗盘式键盘导航：算下一个索引，支持 `Home`/`End`；命中时自动 `preventDefault()`；未命中返回 `-1` |
| `emit(name, detail = null)` | 工具 | 派发 `CustomEvent`，`bubbles: true, composed: true, cancelable: true`；返回 `dispatchEvent` 的布尔结果 |
| `uid()` | 工具 | `Math.random().toString(36).slice(2, 10)`，8 字符 id 生成器 |

`base.js` 里**不在类内**的两段全局副作用（import 时立即执行）：

1. **Safari 的 `command` / `commandfor` polyfill**（第 80–97 行）：特性检测 `'commandForElement' in HTMLButtonElement.prototype`；缺失时用 `document` 级 click 委托模拟对 `<dialog>` 的 `show-modal` / `close` / 默认 toggle。
2. **对话框 backdrop 触摸穿透 shim**（第 99–105 行）：`document` 级 `touchstart`，命中 `HTMLDialogElement` 时 `preventDefault()` 并 `close()`，`{ passive: false }`。

也就是说 `base.js` 承担了**双重角色**：既是类库（`OtBase`），又是“浏览器缺陷补丁区”。这是它没有被拆成两个文件的原因（保持 import graph 极简）。

### 4.4 全局 `window.ot` API 面（`index.js` 第 10–14 行）

`index.js` 是全文，因此可以确认：**`window.ot` 的全部内容只有 3 个入口**：

```js
const ot = window.ot || (window.ot = {});
ot.toast = toast;
ot.toast.el = toastEl;
ot.toast.clear = toastClear;
```

| API | 签名 | 说明 |
| --- | --- | --- |
| `ot.toast(message, title?, options?)` | 函数 | `options`: `variant`（默认 `'info'`，取值 `'success' \| 'danger' \| 'warning'`）、`placement`（默认 `'top-right'`）、`duration`（默认 `4000` ms，`0` 表示常驻） |
| `ot.toast.el(element, options?)` | 函数 | 接受 `HTMLTemplateElement`（取 `content.firstElementChild` 克隆）或普通元素（`cloneNode(true)`）；会移除 `id`，因此模板可复用 |
| `ot.toast.clear(placement?)` | 函数 | 不传参数清空全部；传 placement 只清该位置 |

注意 `ot.toast` 是**函数对象上挂属性**（`ot.toast.el` / `ot.toast.clear`），不是命名空间对象。这是唯一的全局命名空间——没有 `window.Oat`、没有版本号导出、没有组件注册表。

### 4.5 各 Web Component 的对外契约（结构要点）

| 元素 | 观察属性 | 公开属性/方法 | 派发事件 |
| --- | --- | --- | --- |
| `<ot-dropdown>` | 无 `observedAttributes` | 无 | 无自定义事件（只做定位 + ARIA `ariaExpanded` + 键盘导航） |
| `<ot-tabs>` | 无 | `get/set activeIndex` | `ot-tab-change`，`detail = { index, tab }`；可用 `data-anchor="<key>"` 把选中 tab 的 id 同步进 URL hash |
| `<ot-taginput>` | `['disabled']` | `get/set value`（字符串或对象数组）、`get/set disabled` | `input`（冒泡），`detail` = 当前 tag 数组 |
| `<ot-upload>` | 无 | 无（依赖内部 `<input type="file">`） | 透传原生 `change`（冒泡） |

结构上的一个模式：**每个 Web Component 的 `init()` 第一件事是 `this.querySelector(...)` 找内部原生元素，找不到就直接 `return`**（`dropdown.js` 第 24–27 行、`upload.js` 第 26–27 行、`taginput.js` 第 37–38 行、`tabs.js` 第 31–34 行）。即**组件是“对内部原生元素/ARIA 结构的增强”，而不是替代**——标记仍由用户写，JS 只加行为。

另一个模式：**组件之间互相消费**。`taginput.js` 与 `upload.js` 都会生成 `class="badge"` + `data-variant="secondary"` 的 `<span>`（`taginput.js` 第 126–129 行、`upload.js` 第 75–78 行）；`upload.js` 的 `init()` 会给自己加 `card vstack align-center` 类、给 `[data-files]` 加 `hstack justify-center`（第 32–33 行）。也就是说 **JS 组件直接在 utility 类与组件类之上组装 UI**，依赖关系是 JS → CSS，而不是 CSS → JS。

---

## 5. 文档站的信息架构

### 5.1 站点生成器与配置

- 静态站生成器：**Zola**。`docs/config.toml`（236 字节）：
  - `base_url = "/"`、`title = "Oat UI"`
  - `compile_sass = false`、`build_search_index = false`
  - `[markdown] highlighting = { theme = "one-dark-pro" }`
  - `[extra] description = "Oat - Ultra-lightweight, semantic, zero-dependency HTML UI component library"`
- 站点根目录是 `docs/`（CI 里 `BUILD_DIR: docs`）。
- 站点样式**分三层**：库本体 `oat.min.css`（构建时 `cp` 到 `docs/static/`）+ 文档外壳 `docs/static/style.css` + demo 主题 `docs/static/demo.css`。
- `docs/static/CNAME` 内容为 `oat.ink`，对应 README 里的线上地址。

### 5.2 顶部导航（`docs/templates/base.html` 第 29–64 行）

`<nav data-topnav>` 内右侧 `col-8 justify-end hstack`，顺序为：

1. `Home` → `/`
2. `Demo` → `/demo`
3. `GitHub` → `https://github.com/knadh/oat`（外链）
4. 一个 `<ot-dropdown>` 包住的 **“More” 下拉菜单**（`popovertarget="nav-menu"`，`<menu popover id="nav-menu">`），条目顺序：
   1. `Usage` → `/usage`
   2. `Customizing` → `/customizing`
   3. `Other libs` → `/other-libs`
   4. `<hr>`
   5. `Recipes` → `/recipes`
   6. `Extensions` → `/extensions`

左侧 `col-4 branding` 里有一个 `[data-sidebar-toggle]` 按钮 + favicon/logo 两个链接（哪个显示由 `docs/static/style.css` 按 `body.home` / `body:not(.home)` 切换）。

**注意 topnav 里没有 “Components” 入口**——组件列表只存在于左侧栏，这是刻意的层级分离。

### 5.3 左侧边栏顺序（`base.html` 第 66–117 行）

`<aside data-sidebar class="main-sidebar">` 里一个 `<nav><ul>`，条目顺序：

1. `GitHub`（外链，带 `<img src="/github.svg">`）
2. `Home` → `/`
3. `Demo` → `/demo/`
4. `Usage` → `/usage/`
5. `Recipes` → `/recipes/`
6. `Customizing` → `/customizing/`
7. `Other tiny libs` → `/other-libs/`
8. `Extensions` → `/extensions/`
9. 一个 `<details open>` 折叠组，`<summary>` 为 `Components`：
   1. `All components` → `/components`
   2. 然后 **Tera 循环** `get_section(path="components/_index.md").pages`，按 weight 顺序为每个组件页生成 `<li><a href="/components/#{{ component.slug }}">{{ component.title }} …`

第 93 行有一个关键机制：**侧栏用 frontmatter 的 `extra.webcomponent` 给 Web Component 打标**：

```
{% if component.extra.webcomponent | default(value=false) %}<sup title="WebComponent">WC</sup>{% endif %}
```

即 **“是否 Web Component”是文档元数据的一等公民**，直接呈现在导航里。

侧栏底部 `<footer>` 有一个 `Switch theme` 按钮（`onclick="toggleTheme()"`，含 light/dark 两个 SVG 图标）。主题切换依赖 `base.html` 第 13–22 行的**内联 FOUC 防护脚本**（读 `localStorage.theme`，设置 `document.documentElement.style.colorScheme` 与 `data-theme`）以及 `docs/static/main.js` 第 147–154 行的 `toggleTheme()`。

### 5.4 页面清单（URL → 源文件 → 覆盖内容）

| URL | 内容源文件 | 模板 | 覆盖内容 |
| --- | --- | --- | --- |
| `/` | `docs/content/_index.md`（46 B） | `docs/templates/index.html` | 首页：intro + 5 张特性卡 + “Why?” |
| `/demo/` | `docs/content/demo.md`（72 B） | `docs/templates/demo.html`（22,613 B） | Kitchensink dashboard。含 “Demo” 面板、Recent Activity、Server Status、Recent Orders、Confirm Deletion、System Notifications、FAQ、Account Settings 等 7 个 `<section class="section">` 区块 |
| `/usage/` | `docs/content/usage.md`（1981 B） | `page.html` | 安装与用法：CDN / npm / Download 三条路径 + Basic usage + Local dev setup（Requirements: zola + esbuild；Running） |
| `/customizing/` | `docs/content/customizing.md`（3203 B） | `page.html` | “Picking and choosing”（必需文件清单）、Theming（22 个颜色变量 + 注释）、Example themes（Default Oat brown）、Dark mode |
| `/recipes/` | `docs/content/recipes.md`（8289 B） | `page.html` | 组合配方，9 个 H2：Split button、Radio cards、Form card、Empty state、Stats cards、Download button、Copy-to-clipboard、Loading button、Confirm-before-delete dialog |
| `/other-libs/` | `docs/content/other-libs.md`（1012 B） | `page.html` | 作者其他零依赖库清单（tinyrouter.js、highlighted-input.js、floatype.js、dragmove.js、indexed-cache.js） |
| `/extensions/` | `docs/content/extensions.md`（1097 B） | `page.html` | 社区扩展清单（oat-chips、oat-animate、oat-table、oat-upload）+ 提 PR 邀请 |
| `/components/` | `docs/content/components/_index.md`（124 B） | `docs/templates/components/section.html` | **组件文档的聚合长页**：`<h1>Components</h1>` + 引言 + `<hr>` + 对 `section.pages` 循环，每个组件渲染为 `<section id="{{ page.slug }}" class="demo-section"><h2># {{ page.title }}</h2>{{ page.content }}<a class="section-permalink">Link</a></section>` |
| `/components/<slug>/` | `docs/content/components/<name>.md` | `docs/templates/components/page.html` | 单个组件的独立 permalink 页（`<h1>{{ page.title }}</h1>` + 正文） |

关于 `/components/` 的两点结构性事实：

1. **它是全站唯一承载组件正文的页面**。侧栏链接指向 `/components/#<slug>`（锚点），`docs/static/main.js` 第 111–124 行用 `IntersectionObserver` 在滚动时高亮对应侧栏项。独立 `/components/<slug>/` 页虽然由 `page_template` 生成，但侧栏并不直接链向它们——只由聚合页里的 “Link” permalink 图标触达。
2. 聚合页模板由 `components/_index.md` 的 `sort_by = "weight"` + `page_template = "components/page.html"` 控制排序与子页模板。

`demo.md` 与 `_index.md` 都**没有正文**（分别是 4 行和 4 行 frontmatter），内容全在模板里——即 oat 把“大型纯 HTML 页面”也放在 `content/` 里占一个 URL，而不是放在 `static/`。

---

## 6. 组件清单（按 `weight` 升序）

共 **26 个组件文档页**，`weight` 唯一决定 `/components/` 聚合页与左侧栏顺序。`WC` 列取自各页 frontmatter 的 `extra.webcomponent`，并与 `src/js/` 中 `customElements.define` 的实际注册逐一对齐（**完全一致，无错标**）。

| # | weight | 标题 | `description`（frontmatter 原文） | WC |
| --- | --- | --- | --- | --- |
| 1 | 10 | Typography | Headings, paragraphs, lists, code blocks, and other text elements. All styled by default. | 否 |
| 2 | 20 | Accordion | Collapsible sections using native `<details>` and `<summary>` elements. No JS required. | 否 |
| 3 | 30 | Alert | Alert messages using role="alert". | 否 |
| 4 | 31 | Avatar | Avatars are used to represent users or entities visually. They can be images, icons, or text initials. | 否 |
| 5 | 40 | Badge | Inline badge / tag / pill labels. | 否 |
| 6 | 45 | Breadcrumb | Simple navigation hierarchy using nav and ordered lists | 否 |
| 7 | 50 | Button | Button variants and sizes | 否 |
| 8 | 60 | Card | Card containers using the semantic `<article>` tag. | 否 |
| 9 | 70 | Dialog | Modal dialogs using native `<dialog>` with command/commandfor. | 否 |
| 10 | 80 | Dropdown | Dropdown menus and popover using the native popover API. Supports keyboard navigation. | **是** |
| 11 | 85 | TagInput | Type words and press Enter or comma to turn them into a tags collection. Supports autocomplete. | **是** |
| 12 | 90 | Form elements | Inputs, selects, textareas, checkboxes, radios, and fieldsets | 否 |
| 13 | 95 | Upload | Tiny click and drag/drop file uploader. | **是** |
| 14 | 100 | Meter | Measurements using the semantic `<meter>` element. | 否 |
| 15 | 105 | Pagination | Pagination nav bars. | 否 |
| 16 | 110 | Progress | Progress bars using the native `<progress>` element. | 否 |
| 17 | 115 | Spinner | Loading indicators with role="status". | 否 |
| 18 | 117 | Skeleton | Loading placeholders with shimmer animation. | 否 |
| 19 | 120 | Sidebar | Responsive admin dashboard layout with sticky sidebar, optional topnav, and collapsible sections. | 否 |
| 20 | 130 | Switch | Toggle switches using checkbox with role="switch". Native HTML, no JS required. | 否 |
| 21 | 140 | Table | Data tables with thead, tbody. Styled automatically. | 否 |
| 22 | 150 | Tabs | Tabbed interface using a custom WebComponent and semantic behaviour. | **是** |
| 23 | 155 | Tooltip | Smooth tooltips using the native title attribute. | 否 |
| 24 | 160 | Toast | Notification toasts with placement and stacking. | 否 |
| 25 | 170 | Grid | 12-column responsive grid using container queries and CSS grid. | 否 |
| 26 | 1000 | Utils and helpers | Utility and helper classes. | 否 |

**关于 weight 分段的结构性观察**：

- 权重是**稀疏整数**（10, 20, 30, **31**, 40, 45, 50, 60, 70, 80, **85**, 90, **95**, 100, **105**, 110, **115**, **117**, 120, 130, 140, 150, 155, 160, 170, **1000**）——留出插空余量，允许后续插入而不改其他页。
- `weight = 31`（Avatar，紧跟 Alert 之后）、`weight = 117`（Skeleton，紧跟 Spinner 之后）说明这两个组件是**后期补插**的。
- `weight = 1000`（Utils and helpers）是**哨兵值**，显式把它钉在最后，永远不参与常规排序。
- `weight = 170`（Grid）比 `160`（Toast）大，但 Grid 在概念上属于布局层——**排序是“先文字/展示，后布局/工具”，不是字母序也不是复杂度序**。

**一处不一致（需注意）**：顶层页 `docs/content/recipes.md` 的 frontmatter 也带有 `[extra] webcomponent = true`（第 6–7 行），但它**不在 components section 里**（不在 `sort_by = weight` 的循环范围内，因此不会在侧栏出现 “WC” 角标）。从上下文看这是**复制粘贴遗留**，而非有意声明——`recipes.md` 讲的是组件组合，本身不定义任何自定义元素。**[未验证：无法确认作者是否有意为之，因为该字段对顶层页目前无任何可见效果。]**

---

## 7. 组件文档页的统一写法

26 个组件页遵循同一套模板。以下逐项说明。

### 7.1 Frontmatter 字段

Zola 使用 `+++` 分隔的 TOML frontmatter。两种形态：

**非 Web Component（5 行）：**

```toml
+++
title = "Meter"
weight = 100
description = "Measurements using the semantic <meter> element."
+++
```

**Web Component（8 行，多一个空行 + `[extra]` 块）：**

```toml
+++
title = "TagInput"
weight = 85
description = "Type words and press Enter or comma to turn them into a tags collection. Supports autocomplete."

[extra]
webcomponent = true
+++
```

字段清单：

| 字段 | 是否必需 | 说明 |
| --- | --- | --- |
| `title` | 是 | 页面标题、`/components/` 里的 `<h2># {{ title }}</h2>`、侧栏文本、独立页的 `<h1>` |
| `weight` | 是（26/26 都有） | 排序键，见第 6 节 |
| `description` | 是（26/26 都有） | 一句话描述。**注意：页面级的 `description` 在模板中从未被渲染。**全仓模板检索 `description` 只有 1 处命中：`templates/index.html` 第 3 行的 `{{ config.extra.description }}`——那是**站点级** description（`config.toml` 的 `[extra]`），与页面 frontmatter 无关。`base.html` / `components/section.html` / `components/page.html` 只用到 `title` / `slug` / `content` / `extra.webcomponent`。因此这 26 个 `description` 目前是**纯人工元数据**（可能供作者检索或未来使用）。**[未验证：不排除被 Zola 默认 meta 输出消费，但本仓库模板中确实无使用点。]** |
| `[extra] webcomponent` | 可选，布尔 | 唯一被模板消费的 extra 字段（`base.html` 第 93 行） |

26 个页面**全部有 `title` + `weight` + `description`**，无一例外。4 个页面额外有 `extra.webcomponent = true`。

### 7.2 正文的重复模式

除 `utilities.md` 外，组件页正文遵循固定三段结构：

**① lead sentence（一句引导语）**——说明用什么标记、什么属性。例如：

- `meter.md`：`Use <meter> for values within a known range. Browser shows colors based on low/high/optimum attributes.`
- `switch.md`：``Add `role="switch"` to a checkbox for toggle switch styling.``
- `pagination.md`：``Pagination does not use any special markup or classes and re-uses the existing buttons `<menu>`.``
- `taginput.md`：``Use `<ot-taginput>`. Type a word and press <kbd>Enter</kbd> or <kbd>,</kbd> (comma) to add.``

多数页面只有这一句，**不加小标题，直接进 demo**。

**② demo 组件包裹的 html 代码围栏**：

````markdown
{% <demo> %}
```html
<meter value="0.8" min="0" max="1" low="0.3" high="0.7" optimum="1"></meter>
```
{% </demo> %}
````

注意调用写法是 `{% <demo> %}` … `{% </demo> %}`（带尖括号、斜杠的成对形式）。这是 Zola 0.23 起 Tera2 的 **component** 语法（`{{<name … />}}` 的近亲）。仓库自身的证据是 `.github/workflows/publish-website.yml` 第 26 行把文档构建固定在 `shalzz/zola-deploy-action@v0.23.1`。**[未验证：本次未实际运行 `zola build`，无法确认 Zola 对 version 的精确下界。]**

**③ 可选的 H3 子小节**——每个子小节也是“一句说明 + 一个 demo 围栏”，有时附一段纯 JS 或纯 HTML 的补充围栏（不含 demo 包裹）。例如 `taginput.md` 的 `### Programmatic read and write` 后面跟一个纯 `<script>` 围栏（不进 demo）；`sidebar.md` 的 `### With top sticky nav` 后面也是纯 HTML 围栏（因为示例需要整页结构，无法内联演示）。

**④ 表格型小节**——见 7.4。

### 7.3 `demo` 组件渲染成什么

**定义**（`docs/templates/shortcodes/demo.html`，105 字节，全文 5 行）：

```
{% component demo() %}
<div class="ot-demo">
{{ body | markdown | safe }}
</div>
{% endcomponent demo %}
```

即：**把 body 当 Markdown 渲染（`| markdown | safe`），塞进一个 `<div class="ot-demo">`**。所以 `.ot-demo` 里最终是一个 Zola 语法高亮过的 `<pre><code>` 代码块。

**运行时增强**（`docs/static/main.js` 第 1–91 行，文档站脚本，**不属于库本体**）：`DOMContentLoaded` 后遍历所有 `<pre>`，对 `.ot-demo` 内的块做以下替换（第 34–45 行）：

```
.ot-demo
└── <ot-tabs>
    ├── <div role="tablist">
    │   ├── <button role="tab">⧉ Preview</button>
    │   └── <button role="tab">{} Code</button>
    ├── <div role="tabpanel">          ← .demo-box > .demo-content，注入源码作为实时预览
    └── <div role="tabpanel">          ← 原 <pre> 被移入这里，并设为 contenteditable="plaintext-only"
```

并额外挂三个按钮（`.actions.buttons` 菜单）：`Copy`（写剪贴板）、`Reset`（还原高亮与预览）、`Edit`（切换 `.ot-demo.fullscreen` 全屏并排编辑）。`Code` 面板的 `<code>` 是 `contenteditable`，`input` 时把 `textContent` 直接写进 `.demo-content` 的 `innerHTML`——**所以文档里的每个 demo 都是一个可编辑的 live playground，且用的是 oat 自己的 `<ot-tabs>` 组件**（吃自己的狗粮）。

结构含义：**`demo` 组件本身只负责“标记这是一段可演示代码”，可演示性由站点的 JS 事后接管**。这让 Markdown 内容保持极简（一个围栏 + 三行包裹），把复杂度全部推给渲染层。

### 7.4 组件页没有 H2；H3 的分布

**经全文检索确认：26 个组件页中没有任何一个包含 `## ` 级别的标题（H2）。** 这是刻意设计，因为 `/components/` 聚合页模板自己插入 `<h2># {{ page.title }}</h2>`（`components/section.html` 第 20 行）——如果正文里也有 H2，聚合后层级会冲突。

H3（`### `）的分布（11 个页面有 H3，15 个没有）：

| 页面 | H3 / H4 小节 |
| --- | --- |
| `button.md` | `### Sizes`、`### Button group` |
| `form.md` | `### Input group`、`### Validation error` |
| `switch.md` | `### Disabled` |
| `avatar.md` | `### Avatar group` |
| `dropdown.md` | `### Popover` |
| `spinner.md` | `### Overlay` |
| `skeleton.md` | `### Skeleton card ` |
| `dialog.md` | `### With form fields`、`### Handling return value` |
| `sidebar.md` | `### Always-collapsible`、`### With top sticky nav`、**`#### Structure`（唯一 H4）** |
| `toast.md` | `### Placement`、`### Options`、`### Custom markup`、`### Clearing toasts` |
| `taginput.md` | `### Autocomplete`、`### Programmatic read and write`、`### Options` |

**无任何 H2/H3 的 15 个页面**（就是“一句引导语 + 一个 demo”的极简形态）：`typography`、`accordion`、`alert`、`badge`、`breadcrumb`、`card`、`grid`、`meter`、`pagination`、`progress`、`table`、`tabs`、`tooltip`、`upload`、`utilities`。

### 7.5 `### Options` 与 `#### Structure` 表格

全库只有 **3 处** 表格型小节：

| 位置 | 标题 | 表格列 |
| --- | --- | --- |
| `toast.md` 第 29 行 | `### Options` | `Option` \| `Default` \| `Description`（3 行数据：`variant` / `placement` / `duration`） |
| `taginput.md` 第 89 行 | `### Options` | `Property` \| `Description`（7 行：`<input>` / `value` / `disabled` / `.value` / `.disabled` / `option.data` / `input` 事件——**属性、property、事件混在同一张表里**） |
| `sidebar.md` 第 77 行 | `#### Structure` | `Attribute` \| `Element` \| （第三列无表头）（6 行：`data-sidebar-layout` / `data-sidebar-layout="always"` / `data-topnav` / `data-sidebar` / `data-sidebar-toggle` / `data-sidebar-open`） |

结构性观察：

1. `/### Options` 只出现在**有 JS API 的组件**页——但 `dropdown`、`tabs`、`upload` 三个 Web Component **没有** `### Options` 表（它们的 API 靠正文说明），而 `toast`（非 Web Component，纯 JS API）有。也就是说 **`### Options` 不是按“是否 Web Component”划分，而是按“是否有需要枚举的配置项”划分**，执行得并不严格。
2. `#### Structure` 用 H4 而非 H3，说明它被作者视为 `### With top sticky nav` 的**从属细节**（虽然它描述的是整页布局契约）。
3. 表格列名不统一（`Option` / `Property` / `Attribute`），第三列在 `sidebar.md` 里干脆没有表头。**这是可改进点，借鉴时应收敛为统一 schema。**

---

## 8. 构建与发布

### 8.1 `Makefile` 目标（2450 字节，71 行）

包管理器探测（第 1 行）：按 `bun` → `pnpm` → `npm` 顺序取第一个存在的命令，存入 `PKG_MGR`。

`.PHONY: dist css js clean size publish`

| 目标 | 依赖 | 行为 |
| --- | --- | --- |
| `dist` | `css js size` | 一次性构建全部产物并打印体积 |
| `css` | — | `mkdir -p dist` → `cat $(CSS_FILES) > dist/oat.css`（24 文件拼接，未压缩）→ `esbuild dist/oat.css --minify --outfile=dist/oat.min.css` → `gzip -9 -k -f dist/oat.min.css` → `cp dist/oat.min.css docs/static/oat.min.css` → 打印 minified 字节数 |
| `js` | — | `mkdir -p dist` → `esbuild src/js/index.js --bundle --format=iife --outfile=dist/oat.js`（未压缩）→ 同参数加 `--minify` 输出 `dist/oat.min.js` → `gzip -9 -k -f` → `cp dist/oat.min.js docs/static/oat.min.js` → 打印 minified 字节数 |
| `size` | — | 纯打印：CSS 的 src / min / gzip 三段与 JS 的 src / min / gzip 三段字节数 |
| `clean` | — | `rm -rf dist` |
| `publish` | `clean dist` | 见 8.5 |

**esbuild 的用法有两个不对称之处，值得注意**：

1. **CSS 路径没有 `--bundle`，JS 路径有 `--bundle`。** 因为 CSS 已经被 Makefile 手工 `cat` 成一个文件，bundler 对 CSS 无事可做；而 JS 用 ESM `import` 组织，必须靠 esbuild 汇成单文件。
2. **JS 输出固定为 `--format=iife`。** 这决定了产物是**全局脚本**（挂 `window.ot`）而不是 ESM 模块，从而支持 `<script defer>` 直接引入。代价是消费者无法 `import` 具名导出——只能走 `window.ot.toast`。**这也解释了为什么 `window.ot` 是唯一的 API 面**：它是 IIFE 格式下的必然选择。

**一次构建同时更新两处**：`css` 与 `js` 目标末尾都把产物 `cp` 进 `docs/static/`，所以文档站永远用最新构建的库，不需要额外同步步骤。`.gitignore` 同时忽略 `dist` 与 `docs/static/oat.min.*`，保证产物不入库。

### 8.2 Zola 文档构建

- 构建目录 `docs/`，本地预览：`cd docs && zola serve`（默认 http://localhost:1111），见 `docs/content/usage.md` 第 83 行。
- 本地依赖两项：`zola`（预览文档站）与 `esbuild`（打包压缩 CSS/JS），见 `usage.md` 第 78–79 行。
- `usage.md` 第 84 行明确工作流：**改完 CSS/JS → `make dist` → demo 站自动更新**。
- 文档站不启用搜索索引（`build_search_index = false`）也不编译 Sass。

### 8.3 GitHub Actions（`.github/workflows/publish-website.yml`，762 字节）

- 触发：`workflow_dispatch`（手动）+ `push` 到 `master`。
- Job 名 `build`，`runs-on: ubuntu-latest`，步骤依次为：
  1. `actions/checkout@v4`
  2. `actions/setup-node@v6`，`node-version: '24'`
  3. `npm install -g esbuild`
  4. `make dist`
  5. `shalzz/zola-deploy-action@v0.23.1`，`env`：`BUILD_DIR: docs`、`PAGES_BRANCH: gh-pages`、`TOKEN: ${{ secrets.GITHUB_TOKEN }}`
- 静态文件 `docs/static/CNAME`（内容 `oat.ink`）会被 Zola 一并发布到 gh-pages，从而绑定自定义域名。

**关键结构点**：**发布站点的 workflow 与发布 npm 包完全解耦**。CI 只负责「构建 dist → 把 docs 推到 `gh-pages` 分支」，**CI 里没有任何 npm publish 步骤**。也正因为 gh-pages 分支上带着 `oat.min.css` / `oat.min.js`，`usage.md` 的 Download 路径才能直接 `wget` 那两条 raw 链接。

### 8.4 产物布局

| 产物 | 来源 | 是否入库 |
| --- | --- | --- |
| `dist/oat.css` | `cat` 24 个 CSS 文件 | 否（`.gitignore: dist`） |
| `dist/oat.min.css` | esbuild `--minify` | 否 |
| `dist/oat.min.css.gz` | `gzip -9 -k -f` | 否 |
| `dist/oat.js` | esbuild bundle IIFE | 否 |
| `dist/oat.min.js` | esbuild bundle IIFE `--minify` | 否 |
| `dist/oat.min.js.gz` | `gzip -9 -k -f` | 否 |
| `docs/static/oat.min.css` / `.js` | `cp` 自 dist | 否（`.gitignore` 第二条） |
| `gh-pages` 分支根目录 | Zola 产物 | 是（在另一分支） |

`gzip -k` 保留原文件，所以 min 与 min.gz 并存——**发布包同时提供未压缩与 gzip 版本**。

### 8.5 npm 发布流程（`Makefile` 第 62–71 行，`publish` 目标）

`publish: clean dist`，即在全新构建之后：

1. `cp -r src/css dist/css`、`cp -r src/js dist/js` —— **把源 CSS / JS 目录也一并放进包**（对应 `package.json` 的 `files` 白名单里的 `"css"` 与 `"js"`，支持“只取单个组件文件”的消费方式）。
2. `cp README.md dist/README.md`、`cp LICENSE dist/LICENSE`。
3. `VERSION=$(git describe --tags --abbrev=0 | sed 's/^v//')`，再用 `sed` 把 `package.json` 里的占位符 `"version-0.0.0"` 替换成该版本号，输出到 `dist/package.json`。**这一步解释了为什么仓库里的 `package.json` 版本是占位符**——版本号的真源是 **git tag**。
4. 校验 `PKG_MGR` 非空，否则报错退出。
5. `cd dist && $(PKG_MGR) publish --access public`。

因此在 `dist/` 里形成的发布包内容为：`oat.min.css`、`oat.min.js`、`oat.min.css.gz`、`oat.min.js.gz`、`oat.css`、`oat.js`、`css/`、`js/`、`README.md`、`LICENSE`、`package.json`。

`package.json` 的关键字段（557 字节）：

```
name: "@knadh/oat"        main: "oat.min.js"       style: "oat.min.css"
version: "version-0.0.0"  unpkg: "oat.min.js"      jsdelivr: "oat.min.js"
license: "MIT"            homepage: "https://oat.ink"
files: ["oat.min.css", "oat.min.js", "css", "js"]
keywords: ["ui", "components", "component-library"]
```

无 `dependencies`、无 `devDependencies`、无 `scripts` 字段——**`Makefile` 就是全部的构建脚本**（这也是 esbuild / zola 需要全局安装的原因）。

### 8.6 文档化的四条消费路径（`docs/content/usage.md`）

| # | 路径 | 文档给出的写法 |
| --- | --- | --- |
| 1 | **CDN（unpkg）** | `<link rel="stylesheet" href="https://unpkg.com/@knadh/oat/oat.min.css">` + `<script src="https://unpkg.com/@knadh/oat/oat.min.js" defer></script>` |
| 2 | **npm 整包** | `npm install @knadh/oat`，然后 `import '@knadh/oat/oat.min.css';` 与 `import '@knadh/oat/oat.min.js';` |
| 3 | **npm 单文件（按组件取用）** | 文档原句：“Or import individual files from `@knadh/oat/css` and `@knadh/oat/js`.”（对应 `files` 白名单里的 `css` / `js`，由 `publish` 目标 `cp -r` 而来） |
| 4 | **直接下载** | `wget https://raw.githubusercontent.com/knadh/oat/refs/heads/gh-pages/oat.min.css`（同样 `oat.min.js`），然后本地 `<link href="./oat.min.css">` + `<script src="./oat.min.js" defer>` |

第 4 条路径依赖 gh-pages 分支上存在构建产物——这正是 8.3 里”CI 把 `make dist` 的结果连同文档一起发布”的副产物，两条路径互为因果。

`customizing.md` 第 8–18 行另给出**第 5 种粒度的指引**（选择性子集），明确”必须包含”的最小集：

> ##### Must include
> - `00-base.css`
> - `01-theme.css`
> - `base.js`
> - `your files after this`

即 **2 个 CSS + 1 个 JS** 是所有可选组件的最小底座。因为 `00-base.css` 携带 `@layer` 顺序声明，**它无法被跳过**——这是把它排在 `CSS_FILES` 第一位的硬性理由。

### 8.7 权威的状态警告

`docs/content/usage.md` 第 5 行（与 README 第 13 行一致）：

> **IMPORTANT:** The lib is currently sub v1 and is likely to have breaking changes until it hits v1.

---

## 9. 命名与 API 约定

### 9.1 CSS 类：**无前缀**

对外暴露的组件类与工具类**一律不带命名空间前缀**：`.card`、`.badge`、`.table`、`.button`、`.toast`、`.toast-container`、`.toast-title`、`.toast-message`、`.skeleton`、`.container`、`.row`、`.col-1`…`.col-12`、`.col-end`、`.offset-1`…`.offset-6`、`.hstack`、`.vstack`、`.unstyled`、`.text-light`、`.text-lighter`、`.align-*`、`.flex`、`.flex-col`、`.items-center`、`.justify-*`、`.gap-*`、`.mt-*`、`.mb-*`、`.p-4`、`.w-100`，以及按钮的视觉修饰类 `.outline`、`.ghost`、`.small`、`.large` 和容器类 `.buttons`、`.group`。

**唯一的例外**：`.ot-tooltip`（`src/css/tooltip.css` 第 2 行）——带前缀，因为它是 **tooltip.js 运行时动态创建的内部元素**（`tooltip.js` 第 6–7 行 `tip.className = 'ot-tooltip'`），属于实现细节而非给用户写的标记，用前缀把它与用户可写的类区分开。这说明前缀在这里的语义是「**内部**」而不是「**命名空间**」。

（另有 `.ot-demo`，但它只定义在 `docs/static/style.css` 第 160 行，是**文档站外壳样式**，不进库产物。）

### 9.2 自定义元素：`ot-` 前缀

4 个 Web Component 全部使用 `ot-` 前缀，且 `customElements.define` 就写在各自模块底部：

| 元素名 | 定义位置 |
| --- | --- |
| `ot-dropdown` | `src/js/dropdown.js` 第 74 行 |
| `ot-tabs` | `src/js/tabs.js` 第 127 行 |
| `ot-taginput` | `src/js/taginput.js` 第 178 行 |
| `ot-upload` | `src/js/upload.js` 第 100 行 |

前缀在此是**强制的**——自定义元素名必须含连字符，而 `ot-` 同时承担了防冲突的命名空间职责。对应地，CSS 里针对这些元素的规则直接用标签选择器：`ot-dropdown {`、`ot-taginput {`、`ot-upload {`（`ot-tabs` 例外，样式挂在 `[role="tablist"]` / `[role="tab"]` / `[role="tabpanel"]` 上）。

**注意类前缀与元素前缀的语义分裂**：类不加前缀（对用户友好），元素必须加前缀（平台要求 + 防冲突），内部专用类加前缀（标记内部）。**三者动机不同，不是同一套规则的三种表现。**

### 9.3 内部 CSS 变量：`--_` 前缀

用户可覆盖的 token 用**不带下划线**的名字（`--primary`、`--space-4`、`--radius-medium`）；**仅供组件内部使用、明确不属于公共 API** 的变量统一加 `--_` 前缀：

| 变量 | 定义位置 | 用途 |
| --- | --- | --- |
| `--_variant-color` | `01-theme.css` 第 82/86/90 行 | `[data-variant="…"]` 到语义色的映射；被 `badge.css`、`alert.css`、`toast.css` 消费 |
| `--_hov` | `button.css` 第 3/36/43/49/54/59 行 | 每个按钮变体各自的 hover 背景色（用 `color-mix()` 现算） |
| `--_x` / `--_y` | `tooltip.css` 第 4–8 行 | 箭头/浮层方向单位向量（`-1`/`0`/`1`），由 `[data-tooltip-placement]` 改写 |
| `--_c` | `skeleton.css` 第 3 行 | shimmer 渐变基色（`light-dark()` 包装） |

**还有一类既不带 `--_` 也不在 `:root` 上的局部变量**，它们由类或元素设置，作用域即组件：

| 变量 | 设置者 |
| --- | --- |
| `--switch-height` / `--switch-inset` / `--switch-thumb` | `form.css` 第 102–104 行，`input[type=checkbox][role=switch]` 内部 |
| `--span` / `--offset` | `grid.css`，由 `.col-N` / `.offset-N` 类写入 |
| `--sidebar-width` | `sidebar.css` 第 3 行（**在 `:root` 上**，但文件归属在组件文件里） |
| `--grid-cols` / `--grid-gap` / `--container-max` / `--container-pad` | `grid.css` 第 2–7 行（同上，在 `:root` 但声明于组件文件） |
| `--bar-height` | `01-theme.css` 第 47 行（在主题文件里，但只被 `progress.css` 的 `progress, meter` 使用） |
| `--transition` / `--transition-fast` | `01-theme.css` 第 73–74 行；`--transition` 还被 `toast.js` 第 84 行**用 `getComputedStyle` 读出来**当作退出动画时长 |

**对借鉴者最重要的一条**：`--_` 前缀建立了一条**可执行的 API 边界**——凡是不带 `--_` 的 `:root` 变量都是契约（`customizing.md` 明确列出 22 个颜色变量的注释），带 `--_` 的随时可以改名或删除。这个约定不需要文档或 lint 就能自我说明。

### 9.4 `data-variant`（语义）vs class（视觉）双轴约定

这是 oat 最核心的 API 设计约定。`docs/content/components/button.md` 第 7 行给出了最明确的表述（逐字引用）：

> The `<button>` element is styled by default. Use `data-variant="secondary|danger"` for semantic variants and classes for visual styles.

两条轴：

**轴 A —— `data-variant`：语义/颜色轴。** 取值 `secondary`、`danger`、`error`、`success`、`warning`（`info` 只在 toast 的 JS 默认值中出现）。

- 共享映射在 `01-theme.css` 第 80–91 行统一完成，只做一件事：把语义值映射到 `--_variant-color`：
  - `[data-variant="success"]` → `--success`
  - `[data-variant="warning"]` → `--warning`
  - `:is([data-variant="danger"], [data-variant="error"])` → `--danger`（**`danger` 与 `error` 是别名**）
- 消费方：`alert.css` 第 14/18 行、`badge.css` 第 27 行、`toast.css` 第 54/63 行（`var(--_variant-color, var(--border))` 带兜底值）。
- 例外：`secondary` 不走 `--_variant-color`，而是在各组件里就地处理（`button.css` 第 35 行、`badge.css` 第 22 行）——因为「次要」不是颜色语义而是**层级语义**。
- `avatar` 也用了 `data-variant="avatar"`（`avatar.css` 第 2/28 行），但它是**标识性的**（说明「这是头像」），不参与颜色映射。这与 `data-variant` 的「语义」定位略有偏移。**[未验证：是否为有意设计。]**

**轴 B —— class：视觉/形态轴。** `.outline`（描边）、`.ghost`（无背景）、`.small` / `.large`（尺寸）、`.buttons`（组容器）、`.group`、`.unstyled`、`.text-light` 等。

**两轴正交**，可以任意组合，且 oat 的示例与 recipes 大量这么做：

```html
<button data-variant="danger" class="outline">Danger</button>
<button data-variant="danger" class="ghost">…</button>
<button data-variant="secondary" class="small">…</button>
```

（`button.md` 第 15 行、`dropdown.md` 第 26 行、`toast.md` 第 47 行等。）

**为什么这个约定值得借鉴**：它把「这个控件是成功/危险/次要」（业务语义，通常由模板引擎或后端状态决定）与「这个控件是描边还是幽灵」（视觉形态，通常由设计稿决定）分成两个互不干扰的开关。`data-*` 属性天然适合前者（可以整体覆写而不担心与样式类名冲突），class 天然适合后者（可叠加、可被 utility 覆盖）。

### 9.5 层叠层（cascade layers）

已在 3.2 详述，此处只列约定本身与其设计后果：

```
@layer theme, base, components, animations, utilities;
```

- `theme`：只有变量定义。放最前 → **任何组件都可以覆盖 token**。
- `base`：原生元素默认样式 + 少数无类增强（`table`、`progress`/`meter`、`fieldset.group` 之外的 form 基础）。
- `components`：需要类或属性才生效的组合件。
- `animations`：`dialog::backdrop` 与 keyframes，独立成层以便整体关闭/覆盖。
- `utilities`：最后 → **工具类永远赢过组件类**（`.text-light` 能覆盖组件设的 color，`.unstyled` 能覆盖 `ul`/`a` 的 base 样式）。这正是 utility-first 的优先级需求。

配合 `customizing.md` 第 6 行的消费指引（“redefine them in a CSS file in your project and include it after the lib's CSS files”）——**消费者未分层的 CSS 会自动胜过所有分层 CSS**，所以覆盖主题变量甚至不需要理解 layer。

### 9.6 `:root` 上的完整 token 清单

**主清单：`src/css/01-theme.css` 第 2–78 行**（全部位于 `@layer theme { :root { … } }`）。

**颜色（22 个，全部用 `light-dark(浅色, 深色)` 双值）**：

| token | token | token |
| --- | --- | --- |
| `--background` | `--foreground` | `--card` |
| `--card-foreground` | `--primary` | `--primary-foreground` |
| `--secondary` | `--secondary-foreground` | `--muted` |
| `--muted-foreground` | `--faint` | `--faint-foreground` |
| `--accent` | `--danger` | `--danger-foreground` |
| `--success` | `--success-foreground` | `--warning` |
| `--warning-foreground` | `--border` | `--input` |
| `--ring` | | |

注意：`--warning-foreground` 是**唯一没有 `light-dark()` 的颜色**（硬编码 `#09090b`，第 23 行）——这是深浅两模式共用同一前景色的特例。

**间距（12 个，`rem`）**：`--space-1`(.25) `--space-2`(.5) `--space-3`(.75) `--space-4`(1) `--space-5`(1.25) `--space-6`(1.5) `--space-8`(2) `--space-10`(2.5) `--space-12`(3) `--space-14`(3.5) `--space-16`(4) `--space-18`(4.5)。
**缺号**：没有 `--space-7` / `-9` / `-11` / `-13` / `-15` / `-17`——间距刻度是**非连续的精选集合**，不是线性生成。

**圆角（4 个）**：`--radius-small`(0.125rem) `--radius-medium`(0.375rem) `--radius-large`(0.75rem) `--radius-full`(9999px)。

**度量（1 个）**：`--bar-height`(0.5rem)——被 `progress.css` 的 `progress, meter` 与 `form.css` 的 switch 共同使用（switch 用 `calc(var(--bar-height) * 3)`）。

**字体（2 个）**：`--font-sans`(system-ui 栈) `--font-mono`(ui-monospace, Consolas, monospace)。

**字号（9 个）**：`--text-1` … `--text-8`，外加 `--text-regular: var(--text-6)`。
其中 `--text-1` 到 `--text-4` 用 `clamp()` 做流体排版，`--text-5` 起为固定值：

| token | 值 |
| --- | --- |
| `--text-1` | `clamp(1.75rem, 1.5rem + 1.1vw, 2.25rem)` |
| `--text-2` | `clamp(1.5rem, 1.3rem + 0.8vw, 1.875rem)` |
| `--text-3` | `clamp(1.25rem, 1.1rem + 0.5vw, 1.5rem)` |
| `--text-4` | `clamp(1.125rem, 1.05rem + 0.3vw, 1.25rem)` |
| `--text-5` | `1.125rem` |
| `--text-6` | `1rem` |
| `--text-7` | `0.875rem` |
| `--text-8` | `0.75rem` |
| `--text-regular` | `var(--text-6)` |

**行高（1 个）**：`--leading-normal`(1.5)。

**字重（4 个）**：`--font-normal`(400) `--font-medium`(500) `--font-semibold`(600) `--font-bold`(600)。
**注意 `--font-bold` 与 `--font-semibold` 值相同（都是 600）**——即 oat 有意不提供 700。

**阴影（3 个）**：`--shadow-small` `--shadow-medium` `--shadow-large`（Tailwind-ish 的 `rgb(0 0 0 / α)` 组合值）。

**过渡（2 个）**：`--transition-fast`(120ms) `--transition`(200ms)，均为 `cubic-bezier(0.4, 0, 0.2, 1)`。

**z-index（2 个）**：`--z-dropdown`(50) `--z-modal`(200)。

**另外声明在 `:root` 但位于组件文件的 token（6 个）**：

| token | 值 | 声明文件 |
| --- | --- | --- |
| `--grid-cols` | `12` | `grid.css` 第 3 行 |
| `--grid-gap` | `1.5rem` | `grid.css` 第 4 行 |
| `--container-max` | `1280px` | `grid.css` 第 5 行 |
| `--container-pad` | `1rem` | `grid.css` 第 6 行 |
| `--sidebar-width` | `15rem` | `sidebar.css` 第 3 行 |

（`grid.css` 的 4 个 + `sidebar.css` 的 1 个 = 5 个。`--bar-height` 虽只被组件消费，但声明在 `01-theme.css`，已计入主清单。）

**不含在 `:root` 的三个模式级声明**：

- `:root { color-scheme: light dark; }`（`01-theme.css` 第 3 行）——这是暗色模式能自动工作的机制本体。
- `customizing.md` 第 130 行指引消费者把暗色覆盖写成 `[data-theme="dark"]` 作用域；`base.html` 第 19 行与 `docs/static/main.js` 第 152 行确实设置 `data-theme` 属性。
- 但**库本体（`src/css/`）里没有任何 `[data-theme="dark"]` 规则**——`data-theme` 只出现在文档站脚本与文档说明中。也就是说：**oat 库本体完全依赖 `light-dark()` + `color-scheme`，`data-theme` 是留给消费者的钩子（并且被 oat 官网自己使用）。** 这是一个值得借鉴的边界划分：库提供机制，站点提供存储与偏好持久化。

---

## 10. 借鉴要点小结（面向信息架构）

1. **CSS 文件切分 = 实现粒度，文档页切分 = 用户心智粒度，二者刻意不 1:1。** oat 允许 `meter` 与 `progress` 共用文件、`switch` 寄居 `form.css`、`breadcrumb` 干脆没有 CSS（纯 utility 组合）。强行让文档与文件一一对应会同时伤害两边。
2. **层序声明放在拼接产物的第一行，且被列为「必须包含」的最小集之一。** 这让 CSS 的拼接顺序从「构建细节」升格为「公共契约」。
3. **`@layer` 顺序（theme < base < components < animations < utilities）+ 未分层 CSS 最高优先级**，组合出一个消费者不需要理解 layer 就能覆盖主题的模型。
4. **两种轴分离**：`data-variant`（语义色，共享一份 `--_variant-color` 映射）+ class（视觉形态）。`danger`/`error` 做别名。
5. **三种前缀，三种动机**：`.class` 无前缀（用户友好）、`ot-` 元素前缀（平台要求 + 防冲突）、`--_` 变量前缀（标记内部）。另有 `.ot-tooltip` 用前缀标记「JS 生成的内部元素」。
6. **Web Component 只用于有内部状态与生命周期的组件（4 个）**；无状态能力（toast / tooltip / sidebar）一律做纯模块 + 事件委托。`window.ot` 是唯一全局面，且只有 3 个函数。
7. **`OtBase` 把生命周期、事件分发（`handleEvent` + `on<event>` 命名）、键盘导航、事件派发、id 生成五件事固化成基类契约**，子类只需实现 `init()` 与可选 `cleanup()`。
8. **`demo` 组件只是 `<div class="ot-demo">{{ body | markdown }}</div>`**，全部可演示能力由站点 JS 事后把 `.ot-demo` 改造成 `<ot-tabs>` 三键 playground。Markdown 保持极简，复杂度集中在渲染层——这是文档可维护性的关键。
9. **文档页零 H2**（避免与聚合页注入的 `<h2># 组件名</h2>` 冲突），H3 承载子能力，H4 只出现一次。
10. **构建与发布解耦**：CI 只发站点（`make dist` → gh-pages），npm 发布是纯手工 `make publish`；版本号真源是 git tag，仓库 `package.json` 里放占位符。
