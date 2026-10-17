# 23: 双语

**What to build:** 英文在 `/`，中文在 `/zh/`。英文主稿、中文完整翻译。代码块、类名、属性名、令牌名一律不翻译，且两种语言共用同一份示例源码——示例只有一份真相。

**Blocked by:** 02, 04, 10, 11, 12, 13, 14, 15, 16, 17, 19, 20, 21, 22

**Status:** resolved

- [x] 英文内容在 `/`，中文内容在 `/zh/`
- [x] 顶层页双语：首页、使用方式、自定义主题
- [x] `/components/` 索引与**全部组件页**双语
- [x] 代码块、类名、属性名、令牌名不翻译
- [x] 中文页与英文页**共用同一份示例源码**，不维护两份 HTML
- [x] 每一页顶部有语言切换器，且切换后停留在对应页面
- [x] 英文页的 `<html lang="en">` 与中文页的 `lang="zh"` 正确
- [x] 实测 seite 的双语文件命名约定与是否为双语自动生成 `hreflang`（spec §14 待验证事项 3），结果记入文档

**验证方式**

1. 抽查三个组件页，逐字比对中英两版示例源码是否完全一致。
2. 从任一组件页点击语言切换，确认落在对应语言的同一页而不是首页。
3. 查看构建产物中的 `hreflang` 情况并记录实测结论。
4. 确认中文页里没有出现被翻译的类名或令牌名。

## Answer

实现落在 `ticket/23-bilingual`，基线 `7442d87`。下列证据全部在本 worktree 的最终代码上实跑（seite 0.20.1 + 真实 Chrome 155.0.8059.82）。

### 机制：示例源码只有一份，中文页是生成物

| 层 | 路径 | 谁写 |
|---|---|---|
| 英文原稿（**示例源码唯一真相**） | `content/**/<name>.md` | 作者，标准 Markdown 围栏，一个字都不因为双语而改 |
| 中文侧稿（标题/描述/散文） | `i18n/zh/**/<name>.md` | 译者；围栏位置写 `<!-- fence:N -->` |
| 中文页（**生成物，提交进仓库**） | `content/**/<name>.zh.md` | `scripts/i18n-zh.mjs`，文件头带「请勿手改」的 YAML 注释 |

生成器把英文原稿的每个围栏**逐字节**复制到中文页，因此「共用同一份 HTML」是构造性成立的，不是靠断言兜住的。侧稿里出现真围栏、漏写占位符、占位符索引越界、或出现没有侧稿的手写 `*.zh.md`，生成器一律报错退出 —— 仓库里不可能长期存在第二份示例源码。

### 交付物

| 文件 | 内容 |
|---|---|
| `seite.toml` | 新增 `[languages.zh]`（`title`/`description`）。这是让 `.zh.md` 成为「翻译」而不是「另一页」的机制开关；缺了它中文页会被静默发布成 `/components/button.zh` |
| `scripts/i18n-zh.mjs` | 生成器 + `--check` 幂等模式（`exports` 出 `listMasters / renderPage / splitBody / splitFrontmatter / targetOf`，供验收脚本进程内复用） |
| `scripts/verify-i18n.mjs` | 本票验收：13 项静态 + 3 项真 Chrome（无 Chrome 时 SKIP，不改变退出码） |
| `i18n/zh/**` | **23 份中文侧稿，全部是逐页真译文**（见下节） |
| `content/**/*.zh.md` | 23 份生成物，与侧稿一起提交 |
| `data/i18n.yaml` | 站点 chrome / 客户端文案的中英对照表（22 个键 × 2 语言） |
| `templates/_i18n_switcher.html` | 语言切换器片段（当前语言是 `<span aria-current>`，对端是唯一 `<a>`） |
| `templates/_i18n_hreflang.html` | head 的 `en`/`zh`/`x-default` 三条 alternate |
| `templates/{base,component,index,components-index}.html` | `<html lang>` + `data-site-label-*`、文案表取词、两前缀分离（`lang_base` vs `page_base`）、切换器与 hreflang 的 include |
| `static/site.js` | Preview/Code/Copy 文案改为从 `<html data-site-label-*>` 读；seite 注入的 Copy 按钮客户端改名（`Copy`→`复制`、`Copied!`→`已复制`、aria-label 同步） |
| `static/style.css` | `.site-lang` / `.site-lang__item` / `.site-lang__item--current` 三条规则（纯 `site-` 命名，只选类不选裸元素，因此不需要 `:not(.site-demo__panel--preview *)` 排除） |
| `.github/workflows/deploy.yml` | `verify-site.mjs` 之后、`seite build` 之前插入 `npm run i18n:check` → `npm run i18n` → `git diff --exit-code -- content/`；`seite check --strict` 之后加 `npm run verify:i18n` |
| `package.json` | 新增 `i18n` / `i18n:check` / `verify:i18n` 三个 script；`"dependencies": {}` 保留；`test` script 未动 |

`src/**` 一字未改（本票只碰站点侧与生成器）。

### 页面计数与侧稿清单

```
23 英文页 = 19 组件页 + /components/ 索引 + 首页 + /usage + /customizing
23 中文页 = 同一批，'/' 的对端是 '/zh/'
48 个产物 HTML = 24 英文（含 404）+ 24 中文（含 404）
62 个围栏跨 23 对页面，中英逐字节相同
```

`i18n/zh/` 与 `content/` 同形：

```
i18n/zh/pages/{index,usage,customizing}.md
i18n/zh/components/index.md
i18n/zh/components/{accordion,alert,badge,button,card,dialog,dropdown,form,layout,
                    progress-meter,skeleton,spinner,switch,table,tabs,taginput,
                    toast,typography,utilities}.md
```

19 个组件页**全部**是逐页真译文（`### 变体` / `### 外观` / `### 交互` / `### 覆盖它`，术语按 `GLOSSARY.md`：语义优先、公共令牌、内部变量、硬阴影、阴影偏移、阴影层级、层顺序、语义变体、视觉修饰）。代码块、类名、属性名、令牌名一律原样保留。

### 验证方式 1：抽查三个组件页，逐字比对示例源码

脚本断言（构造性保证 + 双保险）`npm run verify:i18n`：

```
PASS  verification 1: every fence is byte-identical between the English and the Chinese source page
      23 page pairs, 62 fences, zero differences
PASS  verification 1: the built Chinese page carries the same <pre> markup as the English page
      21 page pairs compared in dist/, identical including seite's spans
```

手工抽查（button / dialog / form，取源文件围栏块直接比较）**实测**：

```
button     IDENTICAL  (1962 chars)
dialog     IDENTICAL  (618 chars)
form       IDENTICAL  (1475 chars)
```

第二项比的是 `dist/` 里含 seite 高亮 `<span>` 的 `<pre>` 原文 —— 它挡的是「模板或高亮把围栏改坏」。

### 验证方式 2：点击语言切换落在同一页，而不是首页

静态：46 个非 404 产物页，每页**恰好 1 个**切换链接，`href == base_url + 对端 URL`，且**对端文件存在于 dist/**。

真 Chrome（`npm run verify:i18n` 的三项浏览器检查，实测 URL 列表）：

| 起点 | 点击后落在 | 断言 |
|---|---|---|
| `/barnacle/components/button` | `/barnacle/zh/components/button` | `lang=zh`、`h1=按钮`、双标签读 `预览,代码,预览,代码`、示例对数不变、切换器读 `English\|中文` |
| `/barnacle/components/` | `/barnacle/zh/components/` | 同一页，中文 |
| `/barnacle/usage` | `/barnacle/zh/usage` | 同一页，中文 |
| `/barnacle/` | `/barnacle/zh/` | 同一页，中文 |
| `/barnacle/zh/components/button` | `/barnacle/components/button` | 切回英文，`lang=en`、`h1=Button` |
| `/barnacle/zh/components/` | `/barnacle/components/` | 切回英文，`h1=Components` |

集合索引的 `translations` 在 seite 里恒为 `[]`，切换目标用 `page.slug == page.collection` 算出 —— 「目标文件必须存在」这条断言就是它的安全网。

### 验证方式 3：`hreflang` 实测结论（spec §14 待验证事项 3，定案）

> **实测结论（seite 0.20.1）：`hreflang` 只自动出现在 `sitemap.xml` 里，页面 `<head>` 里完全没有。**
>
> - `sitemap.xml`：每个有翻译的 URL 自动获得 `<xhtml:link rel="alternate" hreflang="en|zh" …>`，无需配置。实测 `44` 个 `<url>`、`44` 条 `hreflang="en"`、`44` 条 `hreflang="zh"`。
> - `x-default` **只出现在首页那一对条目上**：实测全 sitemap 只有 `2` 条 `x-default`（`/` 与 `/zh/` 各一条），42 个非首页配对条目**一条都没有**。这是上游行为，文档没有承诺。
> - 页面 `<head>`：未改造前对全部产物页逐个 grep，`<link rel="alternate">` 命中 0。
> - 因此本站自己输出 head 的三条（`templates/_i18n_hreflang.html`）：实测 `dist/zh/components/button.html` 为
>   ```html
>   <link rel="alternate" hreflang="en" href="https://ivan112058.github.io/barnacle/components/button">
>   <link rel="alternate" hreflang="zh" href="https://ivan112058.github.io/barnacle/zh/components/button">
>   <link rel="alternate" hreflang="x-default" href="https://ivan112058.github.io/barnacle/components/button">
>   ```
>   `x-default` **永远指向英文（默认语言）URL**；没有对端的页面（今天的两个 404）一条都不输出 —— 指向 404 的 hreflang 比没有更糟。
> - 断言：`46 pages with en / zh / x-default, each pointing at a built page`（三条都在、`x-default == en`、三条都指向 `dist/` 里存在的文件）。`<html lang>` 在 48 个产物页上全对（英文 24 页 `en`，中文 24 页 `zh`）。

### 验证方式 4：中文页里没有被翻译的类名或令牌名

两道自动断言 + 一道手工检索：

- `no Chinese page names a class, attribute or token the library does not define` —— 中文散文里出现的每个 `--bn-*` / `--_*` / `bn-*` / `data-*` 都必须能在 `src/css/**`、`static/*.css` **或它翻译的那篇英文原稿**里找到；
- `no identifier in a Chinese page contains a translated (non-ASCII) character` —— `--bn-主色` 这种「前缀 + 汉字」直接命中；
- 手工：`Select-String -Pattern '(?:--_?|\bbn-)[\u3000-\u9fff\uff00-\uffef]'` 对全部 `*.zh.md` 扫描，**无输出**。

第一道断言比 handoff 副本多收了两处，原因都是「让它只咬真的」：

1. `knownTokens()` 现在把**整篇英文原稿**（含散文）当作已知词表，而不只是围栏。英文散文里刻意写着库里并不存在的名字 —— 卡片页解释它**没有**造 `.bn-card`、表单页说**没有** `.bn-error`、布局页拒绝提供 `bn-col-md-6` 家族、标签页的 `bn-tab-1`/`bn-tabpanel-2` 是运行时生成的 id。中文译文必须允许写同样的名字；超出它们的新名字仍然会被抓到。
2. 自定义属性正则改成 `--[A-Za-z_][A-Za-z0-9_-]*`：`--` 后面必须是名字字符才是令牌，于是 Markdown 表格的分隔行 `---` 不再被当成标识符（那是标点，不是谁翻译了令牌）。真正的检测器（标识符里夹非 ASCII 字符）一字未放松。

### 既有断言的调整（每处都说明「为什么是过时而非退化」）

| 文件 | 调整 | 为什么是过时 |
|---|---|---|
| `scripts/verify-demo.mjs` | 「作者写 H2 → 产物多一个 H2」的负向控制，把站点复制到临时目录时的清单补上 `data` | 模板自本票起要读 `data/i18n.yaml`，临时副本没有 `data/` 会让探针构建直接失败（`Variable data.i18n[lang].preview not found`）。断言本身（H2 计数）一字未改，仍然真跑 |
| `scripts/verify-site-shell.mjs` | `shellInventory()` 排除 `*.zh.md`，并为每一页补 `/zh/` 镜像 | 清单从 `content/**/*.md` 推导；不改会把 `button.zh` 当成新组件 slug，也不知道 `dist/zh/**` 的存在。断言意图（每个产物页都符合清单、seite 404 是唯一无类壳）完全保留，覆盖面从 24 页变成 48 页 |
| `scripts/verify-i18n.mjs` | 本票新增脚本：见上一节的两处收敛 + 两处加强（hreflang 目标必须存在于 dist、增加「中文切回英文」浏览器检查） | 它是本票自己的验收脚本，不在「既有断言」之列；改动都是为了更准，不放松 |

`verify-site.mjs`、`verify-layout.mjs`、`verify-static.mjs`、`verify-deploy.mjs`、`tests/**` 等**全部未改**且全绿。

### 回归（全绿，逐条实跑）

```
npm test                        101/101 passed                  (exit 0)
npm run test:browser            11/11 passed                    (exit 0)
npm run test:browser:mutations  11 mutants + 1 control, as designed (exit 0)
seite build --strict            EXIT=0  ✓ Built 38 components, 4 pages
seite check --strict            EXIT=0  ✓ No problems found
npm run i18n:check              EXIT=0  ✓ every generated Chinese page matches its sidecar (23 checked)
npm run i18n (×2 连续)          ✓ generated 0 Chinese page(s), 23 already up to date（零 diff）
```

全部 22 个 verify 脚本（`node scripts/verify.mjs` 与 `package.json` 里每一个 `verify:*`）：

```
verify 21/21            verify:theme 16/16       verify:site 24/24
verify:site-shell 9/9   verify:deploy 12/12      verify:demo 19/19
verify:base 35/35       verify:button 21/21      verify:progress 17/17
verify:toast 19/19      verify:tabs 19/19        verify:taginput 21/21
verify:interaction 15/15 verify:static 26/26     verify:table 34/34
verify:switch 21/21     verify:form 21/21        verify:dialog 15/15
verify:accordion 29/29  verify:layout 22/22      verify:i18n 16/16
verify:dropdown 17/17（见「未验证 / 风险」第 5 条：一次运行的随机端口撞上 Chrome 的 blocked-port 列表，重跑全绿；该脚本本票未改动）
```

视觉确认（1380×900，真实 Chrome，中文 `/zh/components/button`）：导航读作 `使用方式 自定义主题 组件 [English|中文] 深色模式`，`中文` 反白高亮，面包屑读 `组件 / 按钮`，注入 H2 读「示例」，双标签读「预览 / 代码」，散文是中文、示例源码仍是英文原样。

### 未验证 / 风险（诚实清单）

1. **示例里的英文文案不翻译**（`Save changes`、`One / Two / Three`、`Invite someone`…）。这是「中英共用同一份示例源码」的直接后果，也是**有意取舍**：要翻译示例内的文字就等于放弃共享。中文散文里引用示例按钮时保留其英文标签（如 **Cancel**），以免读者对不上号。
2. **中文页 pager 的顺序与英文不同**（seite 为中文集合排出的顺序不同）：英文 `/components/button` 是 `prev=Card / next=Badge`，中文是 `prev=排版 / next=手风琴`。URL 本身正确（`/zh/components/typography` 等真实存在，`check --strict` 干净），只是不镜像；要严格镜像需在模板里自己排序，超出本票范围。
3. **`dist/zh/404.html` 的正文仍是英文**（seite 内置模板 + 内置 `t` 表无中文）。页面 chrome（导航、页脚、跳过链接）已本地化。
4. **CI 里三条浏览器断言恒 SKIP**（装了 `playwright-core` 但没有 Chrome 二进制），静态断言决定退出码；「切换后停在对应页面」在 CI 里由「链接目标 == 对端且文件存在」保证。
5. **`verify:dropdown` 存在既有 flake**：它的 `listen(0)` 一次拿到端口 `6566`，撞上 Chrome 的 blocked-port 列表（`net::ERR_UNSAFE_PORT`），11/17 断言红；重跑 17/17。与本票无关（脚本未改动），建议后续在随机端口上加一段跳过 Chrome 禁用端口的重试。
6. 中文标题生成的 heading anchor id 含 CJK（seite 行为）。当前没有页内锚点链接，无影响。
7. 未在真实 GitHub Pages 上验证双语（ticket 24）；`seite serve` 下的双语路径未单独跑（`verify-site` 的 serve 检查仍是单语路径）。
8. 生成器只认 ≤3 空格缩进的围栏（与 CommonMark 一致），也不处理「围栏里套围栏」。当前 62 个围栏全是顶格 ```，无嵌套。

### 与 ticket 04 的冲突面（逐条核对）

| 04 的约束 | 本票是否违反 | 说明 |
|---|---|---|
| 内容文件里不出现任何新语法 | 否 | 英文 `.md` 一个字未改；侧稿在 `i18n/zh/**`，不是 seite 的内容目录，不参与渲染 |
| 组件页正文不出现 H3 | 否 | 中英沿用同一套「H2 由模板注入」，生成器只搬围栏 |
| 围栏是唯一信号 | 否 | 围栏逐字节相同，`site.js` 的判定与英文页完全一致（实测中文页同样 2 组双标签） |
| `static/*` 字节不变 | 否 | 生成器不碰 `static/`；`minify = false` 无需改动 |

## Resolution

Resolved on the integration branch `feat/barnacle-v1` at commit b8d230f.
Closing convention: this tracker has no "done" label, so `Status: resolved` plus the ticked checklist above records closure (see `docs/agents/issue-tracker.md`).
Verify with: `npm run verify:i18n` and `npm run i18n:check`
