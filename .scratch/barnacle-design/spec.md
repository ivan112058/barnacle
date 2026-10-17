# barnacle 设计规格

> 由一轮完整的 grilling 会话产出。所有决策均已由作者拍板，未决项单列在 §14。
> 事实依据见 `.scratch/barnacle-design/` 下的四份调研（seite / neubrutalism / neobrutalism 令牌 / oat）。

## 1. 定位

barnacle 是一个**语义优先**的 Neubrutalism 风格 UI 库。使用者引入一个 CSS 文件（加一个可选的极小 JS 文件），写标准语义 HTML，就得到正确的、风格鲜明的界面。

- **对外发布的库**，但 v1 刻意克制：少而锐利，不铺开组件数量。
- **零依赖**，对使用者无构建步骤。
- **全局样式**：引入即接管整页，无法部分采用（见 §3）。
- MIT。

## 2. 决策索引

| ADR | 决策 |
|---|---|
| [0001](../../docs/adr/0001-semantic-first.md) | 语义优先：样式作用于裸元素，类名只用于无语义锚点的场合 |
| [0002](../../docs/adr/0002-no-shadow-dom.md) | 自定义元素用浅 DOM，不用 Shadow DOM |
| [0003](../../docs/adr/0003-layered-hard-shadows.md) | 硬阴影分三档，由单一偏移派生 |
| [0004](../../docs/adr/0004-explicit-dark-mode.md) | 暗色模式用显式开关，不跟随系统 |
| [0005](../../docs/adr/0005-prefixed-public-tokens.md) | 公共令牌加 `bn-` 前缀，内部变量用 `--_` |
| [0006](../../docs/adr/0006-cascade-layer-contract.md) | `@layer` 层顺序是公共契约 |

## 3. 不变量

违反这些即视为设计错误，而非风格分歧：

1. **`@layer` 声明永远是拼接产物的第一行**，新层只能追加在末尾。
2. **硬阴影的模糊半径与扩展半径永远为 `0`**，偏移永远等值且为正。
3. **位移距离与阴影偏移同源**——两者都由 `--bn-shadow-x/y` 派生，不允许各写各的。
4. **语义与外观分离**：含义走 `data-variant`，形态走 `bn-` 类名，不混用。
5. **公共令牌只有 `--bn-*`，内部变量只有 `--_*`**，没有第三种。
6. **样式不得依赖 JS**——无脚本时外观完整正确，只是失去交互。
7. **`hover` 改变边框颜色可以，绝不改变边框宽度**（否则栅格重排）。

## 4. 仓库布局

根目录即 seite 站点，库源码在 `src/`（借 oat 的分工：库与文档站分离但同仓）。

```
barnacle/
├── seite.toml                  seite 配置（base_url 指向 Pages 子路径）
├── AGENTS.md                   保留（setup 技能产物 + seite 的 agent 指引需合并）
├── GLOSSARY.md
├── LICENSE
├── README.md
├── package.json                仅构建脚本，无运行时依赖
├── .gitignore                  忽略 dist/ 与 node_modules/
├── docs/
│   ├── adr/                    决策记录
│   └── agents/                 保留（issue-tracker / triage-labels / domain）
├── src/
│   ├── css/                    库的 CSS 源码（按固定顺序拼接）
│   └── js/                     库的 JS 源码（esbuild 打包）
├── scripts/
│   └── build.mjs               esbuild 驱动
├── content/                    seite 内容（Markdown + YAML frontmatter）
│   ├── _index.md
│   ├── usage.md / usage.zh.md
│   ├── customizing.md / customizing.zh.md
│   └── components/             _index.md + 每组件一页
├── templates/                  seite 的 Tera 模板
│   ├── base.html
│   ├── index.html
│   ├── page.html
│   └── components/             section.html / page.html
├── static/                     seite 原样复制进 dist/
│   ├── barnacle.css            构建产物，提交进仓库
│   ├── barnacle.min.css        构建产物，提交进仓库
│   ├── barnacle.js
│   ├── barnacle.min.js
│   └── style.css               文档站自身样式（不属于库）
├── public/                     seite：复制到 dist/ 根，不加前缀
└── .github/workflows/deploy.yml
```

**构建产物提交在 `static/`，不是 `dist/`**：seite 生成的 `.gitignore` 忽略 `/dist`，而 `static/` 会被 seite 原样复制进 `dist/static/`。因此一份产物同时满足三件事——文档站可用、随仓库提交、jsDelivr 可按 `main` 分支路径引用。

## 5. `src/css/` 结构

按固定顺序拼接，文件名前缀即顺序。无预处理器，用原生 CSS 嵌套 + `@layer`。

| 文件 | 职责 |
|---|---|
| `00-base.css` | **层声明（第一行）** + 裸元素基础样式与排版 |
| `01-theme.css` | 全部公共令牌 + `data-variant` → `--_variant-color` 映射 |
| `animations.css` | 关键帧、`prefers-reduced-motion` 守卫、`::backdrop` |
| `button.css` | `button`、`a.button`、按钮组 |
| `card.css` | `article` |
| `badge.css` | 徽章 |
| `alert.css` | `[role="alert"]` |
| `form.css` | `input`/`select`/`textarea`/`checkbox`/`radio`/`fieldset`/`label` + `[role="switch"]` |
| `table.css` | `table`/`thead`/`tbody`/`th`/`td` |
| `dialog.css` | 原生 `dialog` |
| `accordion.css` | 原生 `details`/`summary` |
| `progress.css` | `progress` 与 `meter` 共用 |
| `spinner.css` | `[role="status"]` |
| `skeleton.css` | 加载占位 |
| `dropdown.css` | `<bn-dropdown>` |
| `tabs.css` | `<bn-tabs>` |
| `taginput.css` | `<bn-taginput>` |
| `toast.css` | 通知 |
| `layout.css` | 容器 + 12 栅格 |
| `utilities.css` | 工具类 |

**文档粒度 ≠ 文件粒度**（借自 oat 的观察）：`progress.css` 同时承担 `progress` 与 `meter`；`switch` 寄居 `form.css`；`typography` 由 `00-base.css` 承担。不要为了 1:1 而拆文件。

## 6. 设计令牌

### 6.1 亮色（`:root`）

```css
:root {
  /* 结构 */
  --bn-border-width: 3px;
  --bn-border-color: #000000;
  --bn-radius: 0;

  /* 阴影偏移：承重结构，一个数字控制整套体系 */
  --bn-shadow-x: 4px;
  --bn-shadow-y: 4px;
  --bn-shadow-reverse-x: -4px;
  --bn-shadow-reverse-y: -4px;
  --bn-shadow-color: var(--bn-border-color);

  /* 阴影层级：由偏移派生，改基准即等比缩放 */
  --bn-shadow-lift: calc(var(--bn-shadow-x) / 2);          /* 2px */
  --bn-shadow-sm: calc(var(--bn-shadow-x) / 2) calc(var(--bn-shadow-y) / 2) 0 0 var(--bn-shadow-color);
  --bn-shadow-md: var(--bn-shadow-x) var(--bn-shadow-y) 0 0 var(--bn-shadow-color);
  --bn-shadow-lg: calc(var(--bn-shadow-x) * 1.5) calc(var(--bn-shadow-y) * 1.5) 0 0 var(--bn-shadow-color);
  --bn-shadow: var(--bn-shadow-md);

  /* 交互位移 */
  --bn-press: 3px;

  /* 颜色 */
  --bn-background: #FFFDF5;
  --bn-secondary-background: #FFFFFF;
  --bn-foreground: #000000;
  --bn-main: #FFD23F;
  --bn-main-foreground: #000000;
  --bn-ring: #74B9FF;
  --bn-overlay: rgb(0 0 0 / 0.8);

  /* 强调色与语义映射 */
  --bn-pink: #FF6B6B;
  --bn-blue: #74B9FF;
  --bn-green: #88D498;
  --bn-orange: #FFA552;
  --bn-lavender: #B8A9FA;
  --bn-success: var(--bn-green);
  --bn-warning: var(--bn-orange);
  --bn-danger: var(--bn-pink);

  /* 字体 */
  --bn-font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
  --bn-font-display: var(--bn-font-family);
  --bn-font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --bn-font-weight-base: 500;
  --bn-font-weight-heading: 700;

  /* 动效 */
  --bn-transition: 150ms ease;
}
```

**为什么分三档而非一个 `--bn-shadow`**：见 ADR-0003，单一阴影会系统性导致层级坍缩。
**为什么用 `calc()` 派生**：保住「改令牌就换一种风味」——一个 `--bn-shadow-x` 整体缩放层次感。
**为什么拆 `--bn-border-color` 与 `--bn-border-width`**：参考源里 `--border` 一个当简写、一个当颜色，同名不同义极易误用。
**为什么单列 `--bn-shadow-color`**：默认等于边框色（保住「边框与阴影同色」的招牌观感），但暗色模式与「强调色卡片」需要独立覆盖它。

### 6.2 暗色（`[data-theme="dark"]`）

只用 `data-theme` 显式开关，不用 `prefers-color-scheme`（ADR-0004）。

```css
[data-theme="dark"] {
  --bn-background: #1A1A1A;
  --bn-secondary-background: #262626;
  --bn-foreground: #FFFDF5;
  --bn-border-color: #FFFDF5;
  --bn-shadow-color: #FFFDF5;   /* 硬阴影翻白，保住错位印刷的观感 */
  --bn-ring: #74B9FF;
}
```

`--bn-main` 与强调色在暗色下保持不变——它们是高饱和亮色，本来就与深底高对比；需要重调的是中性色与阴影色，不是强调色。

### 6.3 字体

**默认走系统字体栈，库内不打包任何 webfont**。`--bn-font-family` 与 `--bn-font-display` 是一等令牌，文档给出推荐的显示字体（如 Archivo Black / Syne）与加载方法，由使用者自选。这保住了「轻量」，同时不牺牲表现力的可能性。

## 7. 交互契约

所有可交互组件共用同一套几何，`hover` 上浮、`active` 按下：

```css
/* 静止 */
box-shadow: var(--bn-shadow-md);

/* 悬停：上移量与阴影增大量相等，物体"抬离"阴影 */
:hover {
  transform: translate(calc(var(--bn-shadow-lift) * -1), calc(var(--bn-shadow-lift) * -1));
  box-shadow: var(--bn-shadow-lg);
}

/* 按下：朝阴影方向落下，阴影收拢 */
:active {
  transform: translate(var(--bn-press), var(--bn-press));
  box-shadow: none;
}

/* 焦点：outline 画在 box-shadow 之外，两者不互相吞没 */
:focus-visible {
  outline: 3px solid var(--bn-ring);
  outline-offset: 3px;
}
```

`--bn-shadow-lift` 恰为 `--bn-shadow-md` 与 `--bn-shadow-lg` 之差（4px → 6px，增 2px，上移 2px），**这个等式是硬阴影观感成立的关键**，改动偏移基准时自动保持。

**`outline` 而非 `box-shadow` 实现焦点环**：`outline` 绘制在 `box-shadow` 之外，不会覆盖硬阴影；且 `outline-offset` 保证厚边框不吞掉焦点指示。绝不允许 `outline: none` 而无替代。

**`prefers-reduced-motion` 守卫**必须包含，且入场动画写在 `no-preference` 块内，而非事后禁用。

## 8. 组件清单（v1，19 个）

### 基础层（8 个）——语义优先的必然产物

给裸元素写样式是基础层本来就要做的事，这 8 个几乎是顺带的。

| 组件 | 语义锚点 |
|---|---|
| Typography | 裸 `h1`–`h6`、`p`、`ul`/`ol`、`blockquote`、`code`、`pre`、`hr`、`mark` |
| Button | 裸 `button`、`a` |
| Form | 裸 `input`/`select`/`textarea`/`checkbox`/`radio`/`fieldset`/`label` |
| Switch | `input[role="switch"]` |
| Table | 裸 `table`/`thead`/`tbody`/`th`/`td` |
| Dialog | 原生 `dialog` |
| Accordion | 原生 `details`/`summary` |
| Progress / Meter | 裸 `progress`、`meter` |

### 独立设计（7 个）

| 组件 | 锚点 | 备注 |
|---|---|---|
| Card | `article` | 含强调色变体（边框与阴影同色） |
| Badge | `.bn-badge` | 无语义元素可用，需类名 |
| Alert | `[role="alert"]` | 语义变体走 `data-variant` |
| Spinner | `[role="status"]` | |
| Skeleton | `[role="status"]` | |
| Layout | `.bn-container` / `.bn-row` / `.bn-col-*` | 无语义元素可用 |
| Utilities | `.bn-*` | |

### 含 JS（4 个）

| 组件 | 元素 | 全局 API |
|---|---|---|
| Dropdown | `<bn-dropdown>` | — |
| Tabs | `<bn-tabs>` | — |
| TagInput | `<bn-taginput>` | — |
| Toast | — | `bn.toast()` |

### 延后到 v1.1

Avatar、Breadcrumb、Pagination、Tooltip、Upload、Sidebar。

理由：Sidebar 面向后台布局，与 Neubrutalism 的应用场景（营销页、作品集）错位；Tooltip 与 Upload 交互复杂度高、收益低。

## 9. JS 架构

```js
// index.js 的产物形态（esbuild --format=iife）
window.bn = { toast };
```

| 文件 | 职责 |
|---|---|
| `index.js` | 打包入口，注册自定义元素，挂载 `window.bn` |
| `base.js` | `BnBase` 基类：生命周期、`handleEvent`、`on<event>` 分发、键盘导航、事件派发、id 生成 |
| `dropdown.js` | `<bn-dropdown>`，基于原生 popover API |
| `tabs.js` | `<bn-tabs>`，`role=tablist`/`role=tab`/`role=tabpanel` 语义 |
| `taginput.js` | `<bn-taginput>`，唯一有复杂内部状态的组件 |
| `toast.js` | `toast()` / `toast.el()` / `toast.clear()` |

约定：

- **只用浅 DOM**（ADR-0002）。
- 事件一律 `CustomEvent` 且 `bubbles: true, composed: true`。
- 只用自定义元素封装**有内部状态与生命周期**的组件；无状态能力用普通模块。
- `window.bn` 面越窄越好——IIFE 下无法具名导出，全局命名空间是唯一出口。
- 组件初始化在 DOM ready 后一次性完成，可重复调用不重复绑定。

## 10. 文档站（seite）

- **生成器**：seite 0.20.1，内容为 Markdown + YAML frontmatter，模板为 Tera。
- **组件文档页形态**：**每组件一页** + `/components/` 索引页（列出并链接）。
  > 不用 oat 那种「单页内联渲染全部组件」的方案，因为 seite 是否支持在单个模板页内循环渲染整个集合**尚未验证**（见 §14）。索引页 + 单页的组合拿到了可浏览性与永久链接，且只依赖 seite 的原生集合能力。
- **组件页统一写法**（借自 oat，可维护性最好的一套）：一句引导语点名用哪个语义元素或属性 → 若干可运行示例 → 可选 H3 子节承载子能力。页面内**不出现 H2**（H2 由渲染层供给）。
- **示例的能力下沉到渲染层**：Markdown 里只写代码围栏，由模板与站点 JS 把它们改造成「预览 / 代码」双标签界面。这样内容文件保持干净。

## 11. 双语

- **英文在 `/`，中文在 `/zh/`**。seite 默认语言为 `en`，这是零配置路径。
- **英文主稿，中文完整翻译**。每篇文档维护两份（`usage.md` / `usage.zh.md`），这是双语的必然成本。
- **不翻译**：代码块、类名、属性名、令牌名。中文页与英文页共用同一份示例 HTML。
- 语言切换器放在导航栏。`sitemap.xml` 的 `hreflang` 是否自动生成待验证（§14）。

**注意**：本仓库的 `AGENTS.md` 规定「与作者沟通用中文」，那是**开发协作语言**；站点内容语言由本节决定，两者互不冲突。

## 12. 构建与部署

### 环境前提（新会话必须先读）

- **`seite` 不在 PATH 上。** 本机可执行文件位于 `D:\sdk\seite\seite.exe`（v0.20.1）。所有 seite 命令必须用**绝对路径**调用，例如 `& "D:\sdk\seite\seite.exe" build`；或者先修 PATH 再工作。直接写 `seite build` 会报 `CommandNotFoundException`。
- **`gh` CLI 未安装。** 部署链路不得依赖它——§12 选用的 seite 自带工作流正好不需要。
- 本机 PATH 不含 `~/.local/bin`，而 seite 官方安装脚本装到那里，因此**本机不要走 `curl | sh` 安装路径**（CI 里可以）。
- Node/npm 由 Volta 管理，位于 `C:\Program Files\Volta\`。

### 构建链（esbuild）

选 esbuild 而非 Lightning CSS / Sass / PostCSS，决定性理由是 §9 已经需要 JS 打包器——一个二进制同时管 CSS minify 与 JS 打包，工具数从 2 降到 1，且这正是 oat 验证过的路径。seite 明确没有 Sass/PostCSS（刻意设计），所以 CSS 必须外部编译。

```
scripts/build.mjs
  css: 按序拼接 src/css/*.css → static/barnacle.css → esbuild --minify → static/barnacle.min.css
  js:  esbuild src/js/index.js --bundle --format=iife → static/barnacle.js → --minify → static/barnacle.min.js
```

`static/barnacle.css` 与 `barnacle.min.css` 都提交进仓库。**jsDelivr 按 `main` 分支路径服务**，不需要 `gh-pages` 分支——这是相对 oat 的简化（oat 的产物被 gitignore，只能从 `gh-pages` 分支 raw 下载）。

### 消费方式（v1）

1. **CDN**：jsDelivr 指向 `main` 分支的 `static/` 路径
2. **原始下载**：GitHub raw
3. **按需组合**：逐文件引用 `src/css/`（必须包含 `00-base.css` 与 `01-theme.css`）

**v1 不发布 npm**，等 API 冻结再考虑。

### 部署

用 **seite 自带的 GitHub Pages 工作流**（`upload-pages-artifact@v3` + `deploy-pages@v4`，Pages 源设为 "GitHub Actions"），不手写、也不需要 `gh` CLI（本机未安装）。

- `base_url` = `https://ivan112058.github.io/barnacle`——**项目站点的子路径 `/barnacle/`，资源引用必须相对化**，这是最易 404 的一处，上线前专门验证。
- `seite init` 会在根目录写入它自己的 `AGENTS.md`、`CLAUDE.md` 与 `.claude/rules/*`，与现有文件冲突。**处理方式**：先把 seite 脚手架生成到临时目录，只择优拷入 `seite.toml`、`.github/workflows/deploy.yml`、`.seite/`，其余手写。**不允许覆盖现有 `AGENTS.md`。**

## 13. 实施顺序

1. 仓库骨架：seite 配置（按 §12 的临时目录方案）、`.gitignore`、`package.json`、`scripts/build.mjs`
2. `01-theme.css`：全部令牌 + 暗色块（所有组件的依赖）
3. `00-base.css`：层声明 + 裸元素排版与基础
4. 构建链跑通，确认 seite 能正确引用 `static/barnacle.css`
5. 第一组组件：Button（含完整交互契约）→ Card → Badge → Alert —— **到这一步风格是否成立即可见分晓**
6. 文档站骨架：seite 内容 + 模板 + 示例渲染
7. 剩余纯 CSS 组件（Form、Table、Dialog、Accordion、Progress、Switch、Spinner、Skeleton、Layout、Utilities）
8. JS：`base.js` → dropdown → tabs → taginput → toast
9. 双语内容
10. CI + 首次 Pages 上线验证

## 14. 待验证事项

实施时必须实测，不得假设：

1. **seite 能否在单个模板页内循环渲染一个集合**——影响索引页是「列出链接」还是「内联全部」。
2. **`base_url` 子路径 `/barnacle/` 下资源引用是否相对化**——项目站点最常见的 404 来源。
3. **seite 是否为双语自动生成 `hreflang`**。
4. **seite 的 `minify = true` 是否会二次压缩已压缩的 `static/*.min.css`**——若会，需确认幂等或调整产物命名。
5. **seite 的短代码语法**（oat 用的是 Zola 0.23 的 component 特性，seite 同为 Tera 但版本与实现不同，语法需实测）。
6. `seite init` 实际写入哪些文件，用于确认 §12 的「择优拷入」清单。

> **状态（v1 收尾回填，只追加）**：以上六条已全部实测，结论见 `## 16 实施记录（v1 实测偏差）`。

## 15. 明确不做

- **Shadow DOM**（ADR-0002）
- **类名 API 作为唯一入口**（ADR-0001——这是本库的核心立场）
- **Sass / PostCSS / Tailwind**（seite 无此管线，且我们只面向现代浏览器，不需要语法降级）
- **跟随系统的暗色模式**（ADR-0004）
- **库内打包字体**（§6.3）
- **npm 发布**（v1 阶段，§12）
- **`gh-pages` 分支部署**（§12）

## 16. 实施记录（v1 实测偏差）

本节是 v1 收尾时的实测回填，只追加结论，不改动上文任何既有判断。标题原定 `## 15`，但 §15 已被「明确不做」占用，故顺延为 §16，避免同一份 spec 里出现两个 §15。

### §14 六个待验证事项的结论

1. **能，但只能在索引模板里循环集合**：集合索引由 `templates/components-index.html` 渲染，模板里可直接用的是扁平的 `items`；首页（`templates/index.html`）用的是 `collections[].items`。模板名必须是 `templates/<collection>-index.html`，写错就退回通用 `templates/index.html`。依据：ticket 02 + `npm run verify:site` 的「templates/components-index.html won over templates/index.html」。
2. **模板必须自己拼 `{{ site.base_url }}` + `lang_prefix`**：`page.url` / `item.url` 已带语言前缀、但不带子路径，所以模板写 `{{ site.base_url }}{{ item.url }}`；Markdown 正文里的站内链接可写无前缀的 `/...`，seite 会补。依据：ticket 02/23 + `templates/component.html` 的双前缀注释，实测 `verify:release` 抓到的 46 页全部 200、0 个越界引用、0 个非 canonical 链接。
3. **`hreflang` 只在 sitemap 里自动生成**：页面 `<head>` 一条都不生成；sitemap 会为每条有译文的 URL 写 en/zh 交替，但 `x-default` 只出现在首页那一对条目上。所以 `<head>` 的三条交替在 `templates/_i18n_hreflang.html` 里手写。依据：ticket 23 实测 + `npm run verify:i18n`（16/16，含「非首页条目 x-default 计数」）。
4. **`minify = true` 会二次压缩**：`verify:site --minify-experiment` 实测 `barnacle.min.css` 34057B → 33840B、`barnacle.min.js` 15811B → 15810B（尾换行被吃掉），四个产物全部 REWRITTEN；`minify = false` 时四个产物 IDENTICAL。故定案 `minify = false`。依据：ticket 02 实测。
5. **围栏不需要短代码**：seite 的短代码拿不到页面正文与 `data/`，而 Tera 在正文里不展开（`{% include %}` 原样输出）。所以「围栏 → Preview/Code」由客户端站点脚本 `static/site.js` 完成，`.md` 里的围栏原样保留、中英逐字节相同。依据：ticket 04/23 + `npm run verify:demo`（19/19）、`verify:i18n` 的围栏一致性检查。
6. **`seite init` 写 24 个文件，只采纳 `.seite/config.json`**：9 个 `.claude/rules/*`、4 个 `.claude/skills/*`、`AGENTS.md`、`CLAUDE.md`、`.mcp.json`、`.gitignore`、`templates/{base,index,page}.html`、`seite.toml`、`.github/workflows/deploy.yml` 一律不采纳；其中 `seite.toml` 与 `deploy.yml` 按本仓需要手写。依据：ticket 02 + `verify:site` 打印的 24 文件清单与 `.seite/config.json` 版本比对。

### 其他实测偏差

- **§4 目录布局**：`content/` 下多了 `pages/` 子目录（`/`、`/usage`、`/customizing`）；组件集合的索引模板是 `templates/components-index.html`、组件页模板是 `templates/component.html`，并没有 `templates/components/{section,page}.html`。依据：ticket 02 实测。
- **§5 关键帧归属**：`animations.css` 只承担 `::backdrop` 与 dialog/toast 共享的入场；`bn-spin`、`bn-shimmer`、`bn-progress-crawl` 等散在 `spinner/skeleton/progress/toast/dialog` 各自的文件里。依据：ticket 10/14/16/22 实测。
- **§7「所有可交互组件共用同一套几何」的实际收窄**：表单控件的 hover 只升阴影档（sm → md）、**不位移**——「正在输入却在光标下移动的文本框」是可用性错误；徽标、卡片、提示条则完全不参与位移。依据：ticket 12 的结论 + `verify:form` / `verify:static` 的状态规则断言。
- **§12「资源引用必须相对化」的实际做法**：不是相对化，而是模板统一拼 `{{ site.base_url }}` 的绝对 URL（子路径在构建期就固定为 `/barnacle/`），实测子路径下每个引用 200、无越界。依据：ticket 03 + `npm run verify:deploy`（12/12，`/barnacle/` 挂载下的全量抓取）。
- **`progress.css` 的层归属**：在 `CSS_MANIFEST` 里是 `components` 而不是 `base`——它按组件实现，不是基础层的元素默认样式。依据：ticket 16 + `scripts/build.mjs` 的 `CSS_MANIFEST`。
