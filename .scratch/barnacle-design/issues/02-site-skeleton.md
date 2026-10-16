# 02: seite 站点骨架

**What to build:** 一个能跑起来的文档站：本地一条命令起预览，首页可浏览，`/components/` 有索引占位页，页面以相对路径引用 01 号票产出的库产物。**并且证明 seite 不会改写或二次压缩已交付的产物。**

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] `seite.toml` 就位，`base_url` 指向 `https://ivan112058.github.io/barnacle`
- [ ] 目录骨架：`content/`（Markdown + YAML frontmatter）、`templates/`（Tera）、`static/`、`public/`
- [ ] `content/_index.md` → `/` 首页，链向 `/components/`
- [ ] `content/components/_index.md` 作为索引占位页
- [ ] `templates/base.html` / `index.html` / `page.html`，`templates/components/` 下的 `section.html` 与 `page.html`
- [ ] 页面以相对路径加载 `static/barnacle.css` 与 `static/barnacle.js`（子路径部署不做绝对根引用）
- [ ] `static/style.css` 承载文档站自身样式，与库产物严格分开
- [ ] 本地预览命令写进 README

**脚手架处理**

`seite init` 会在仓库根写入它自己的 `AGENTS.md`、`CLAUDE.md`、`.claude/rules/*`。**先把脚手架生成到临时目录，只择优拷入 `seite.toml`、`static/` 的必要项与 `.seite/`**，其余手写。**不允许覆盖已有 `AGENTS.md`。**

**验证方式**

1. `seite build` 通过，`seite check` 无 broken-link / missing-asset 报错。
2. 构建前后对 `static/barnacle.min.css` 与 `static/barnacle.min.js` 做逐字节比对，确认 seite 没有二次处理它们（对应 spec §14 待验证事项 4）。
3. 逐字确认仓库根的 `AGENTS.md` 与构建前一致。
4. 记录 `seite init` 实际写入了哪些文件（对应 spec §14 待验证事项 6）。

## Answer

**分支** `ticket/02-site-skeleton` · **实现提交** `f07219f` · 基线 = `d4b5ff1`（`feat/barnacle-v1` tip；`git merge feat/barnacle-v1` → `Already up to date`）。

站点可以用一条命令预览：`& "D:\sdk\seite\seite.exe" serve --port 4377` → `http://127.0.0.1:4377/`（**没有 `/barnacle/` 前缀**，dev server 从根提供服务）。四条验证方式全部脚本化在 `scripts/verify-site.mjs`（24 项，`24/24 checks passed`），不需要手敲。

### 改动文件（16 个新增 + 1 个修改）

| 类别 | 文件 |
|---|---|
| seite 配置 | `seite.toml`（`base_url` = 项目站点子路径、`minify = false`、`pages` + `components` 两个集合，四字段齐全）、`.seite/config.json`（**唯一从 `seite init` 脚手架拷入的文件**） |
| 内容 | `content/pages/index.md`（→ `/`，链向 `/components/`）、`content/pages/usage.md`、`content/pages/customizing.md`、`content/components/index.md`（→ `/components/` 索引占位页） |
| 模板 | `templates/base.html`、`index.html`（首页，循环 `collections`）、`page.html`、`components-index.html`（集合索引）、`component.html`（集合条目，04 号票接管正文渲染） |
| 站点样式 | `static/style.css`（5982 B，`site-` 前缀，与库产物零耦合） |
| 站点资源 | `public/favicon.svg`（309 B，实测被原样复制到 `dist/favicon.svg`） |
| 文档/工具 | `README.md`（新增，含绝对路径预览命令与端口）、`scripts/verify-site.mjs`（24 项）、`package.json`（+`verify:site`） |

**四份库产物一字未改**（`git status` 里没有 `static/barnacle*`）：本票没有碰 `src/`，`npm run build` 重新产出的四份文件与提交版本一致（`node scripts/verify.mjs` `21/21 checks passed` 回归通过）。

### 对 spec §4 目录布局的必要偏离（四处，均为 seite 0.20.1 实测限制）

1. **集合索引模板 = `templates/components-index.html`**，不是 `templates/components/section.html`。seite 的模板解析不参与分层：`templates/components/index.html`、`templates/components/page.html` 会被静默忽略（MCP `list_templates` 里 `overrides_default=false`），集合索引只认 `<collection>-index.html`。已在 `verify-site.mjs` 里做成回归守卫：**`templates/` 下不允许出现子目录模板**。
2. **集合索引内容 = `content/components/index.md`**，不是 `_index.md`。`_index.md` 在 seite 里没有 Zola 语义，会被当成普通条目产出 `/components/_index`。
3. **普通页面放在 `content/pages/`，不是 `content/` 根目录**（spec §4 与 ticket 写的是 `content/_index.md` / `content/usage.md`）。实测：`[[collections]] directory = "pages"` 时，**内容根目录的文件被 seite 静默丢弃**（probe B：`✓ Built 1 components, 0 pages`，无任何 warning，`content/index.md` / `content/usage.md` 既不产出也不报错）。想放到根目录只能 `directory = ""`，而它会把 `content/components/` 一并吞掉：probe A/D（两种集合声明顺序都试过）报
   ```
   content\index.md: error[url-collision]: URL collision: '/index' is claimed by both 'content\components\index.md' and 'content\index.md'
   ```
   probe H（删掉根 `index.md` 后）更直接：`content/components/button.md` 被 `pages` 集合收走，产出 `dist/button.html`（`PAGE_URL=/button COLL=pages`），同时 `components` 集合又产出 `dist/components/button.html` —— 同一份内容被两个集合构建两次。`directory = "."` 与 `directory = ""` 行为相同（probe E）。
   → 结论：**`content/pages/` 是 seite 唯一可用布局**，索引页特例（`pages/index.md` → `/`）由 seite 自己处理。
4. **集合条目模板 = `templates/component.html`**，代替 spec §4 的 `templates/components/page.html`（同第 1 条理由：子目录里的条目模板会被静默忽略，条目会退回 `templates/page.html`）。本票只交付最小骨架（面包屑 + 标题 + `page.content` + 上下页），正文渲染留给 04 号票。

### 验证方式 2 的落地：minify 两档逐字节对比（spec §14 事项 4）

命令：`node scripts/verify-site.mjs --minify-experiment`（脚本会临时改写 `seite.toml` 的 `minify`，跑两轮 build，再用 `finally` 恢复原文并重建）。

```
      minify experiment (source bytes → dist bytes, sha256[:12]):
        minify=false barnacle.css        2615B/ae297901825d →  2615B/ae297901825d  IDENTICAL
        minify=false barnacle.min.css     404B/d08fda3ae5b9 →   404B/d08fda3ae5b9  IDENTICAL
        minify=false barnacle.js           54B/8ef1eda25911 →    54B/8ef1eda25911  IDENTICAL
        minify=false barnacle.min.js       25B/3e7c8fffb53f →    25B/3e7c8fffb53f  IDENTICAL
        minify=true  barnacle.css        2615B/ae297901825d →   418B/f87d45efd445  REWRITTEN
        minify=true  barnacle.min.css     404B/d08fda3ae5b9 →   398B/3c05abd0bd65  REWRITTEN
        minify=true  barnacle.js           54B/8ef1eda25911 →    32B/6924f332e110  REWRITTEN
        minify=true  barnacle.min.js       25B/3e7c8fffb53f →    24B/88a009d27e35  REWRITTEN
```

**定案：`minify = false`**（写进 `seite.toml`，并附注释说明理由）。`minify = true` 会把四份产物**全部**改写，`dist/static/` 就与仓库里提交的 `static/` 不再逐字节一致 —— 而 `static/` 是随仓库发布、jsDelivr 按 `main` 分支路径取用的那一份，两份不一致会让「发布产物」与「站点资源」对不上。代价只有一处：文档站自己的 `static/style.css` 也不再被压缩（5982 B）。

**对探索笔记的一处修正**：`minify = true` 对 `.js` 并非「基本不动」—— 那只对**已压缩**输入成立（`barnacle.min.js` 25 → 24，只掉末尾换行）；**未压缩**的 `barnacle.js` 会被真的压缩（54 → 32）。所以「四份产物都字节不变」这件事只有 `minify = false` 能做到。

`verify-site.mjs` 里同时保留了恒常断言：`seite.toml` 必须是 `minify = false`，且四份产物在 `static/` 与 `dist/static/` 之间 SHA256 逐一相等（另有 `style.css` 与 `public/favicon.svg` 的字节相等断言）。附带证据：静态资源用**绝对 URL** 引用（`{{ site.base_url }}/static/...`），`seite check` 只把裸 `/static/...` 当站点内路径校验，所以这条字节断言是真在守产物，而不是在守 seite 的复制行为。

### 验证方式 4 的落地：`seite init` 实际写入的文件（spec §14 事项 6）

命令（脚本每次都重跑一遍到 `%TEMP%`，因为 `seite init` 拒绝已存在的目录）：

```
& "D:\sdk\seite\seite.exe" init <tmp>\site --title "Barnacle" --description "..." `
  --deploy-target github-pages --collections pages --agents claude --yes
```

**实测写入 24 个文件**（+ 空目录 `content/pages/`、`data/`、`public/`、`static/`）：

```
seite.toml  templates/base.html(27632B)  templates/index.html  templates/page.html  .gitignore
AGENTS.md(12550B)  CLAUDE.md(11B)  .mcp.json  .seite/config.json
.claude/settings.json  .claude/rules/*.md(10 个)  .claude/skills/{seite,theme-builder,landing-page,brand-identity}/SKILL.md
.github/workflows/deploy.yml(801B)
```

**本票只拷入了 `.seite/config.json`**：`seite.toml` 手写（1814 B、2 个集合、`base_url` 指向项目子路径；脚手架那份是 661 B、`base_url = http://localhost:3000`），`AGENTS.md` / `CLAUDE.md` / `.mcp.json` / `.claude/**` 一律没有进仓库。`.github/workflows/deploy.yml` **本票没有写**（03 号票负责）。`verify-site.mjs` 里有断言：`CLAUDE.md`、`.mcp.json`、`.claude/`、`.cursor/`、`.codex/`、`opencode.json`、`.agents/` 必须不存在，且仓库 `AGENTS.md` ≠ init 生成的那份。

`.seite/config.json` 的作用（实测）：放进仓库后 `seite build` 不再打印 `ℹ Project config is from seite pre-tracking…`（已断言 build 输出里没有这行）。**但它不能消除 `seite upgrade --check`**：`agents: []` 时报 9 项待升级（`.agents/rules/*.md`），`agents: ["claude"]` 时报 15 项（`.claude/**`）—— 它永远想要那套 agent 脚手架，而我们刻意不装。故 `upgrade --check` **不能进 CI**，CI 用 `seite check --strict`（见 03 号票注意事项）。

### 验证方式 3 的落地：`AGENTS.md` 逐字未变

```
PASS  the repository AGENTS.md is byte-identical to the pre-ticket blob
      — feat/barnacle-v1:343d6018f8ff (487B) matches the working tree
PASS  the repo AGENTS.md is still ours, not the seite scaffold one — 487B, keeps the repo's own sections
PASS  no seite agent scaffolding was copied into the repository
      — absent: CLAUDE.md, .mcp.json, .claude, .cursor, .codex, opencode.json, .agents
```

对照 `git diff`：本票的 17 个改动文件里没有任何一个碰过 `AGENTS.md`、`GLOSSARY.md`、`docs/`、`src/`、`scripts/build.mjs`、`scripts/verify.mjs` 或四份库产物。

### 验证方式 1 的落地 + 其它实测结论

```
PASS  seite build exits 0 — ✓ Built 0 components, 2 pages in 0.0s (5 static files copied, 1 public files copied)
PASS  seite check --strict exits 0 with no warnings — ✓ No problems found
PASS  every page asset URL is sub-path safe and resolves inside dist/ — 53 internal URLs across 5 pages resolve under /barnacle
PASS  the homepage renders content/pages/index.md and links to /components/ — homepage prose + link to /barnacle/components/
PASS  the components collection index resolves through the -index template rule
      — templates/components-index.html won over templates/index.html
PASS  seite serve previews the homepage and /components/ on a sub-path-free origin
      — http://127.0.0.1:<free port>/ and /components/ both served
```

1. **`seite` 会给 Markdown 里的站内链接自动补 `base_path`，模板里不会**。实测 `content/pages/index.md` 写 `[Components](/components/)` → 产物里是 `href="/barnacle/components/"`；写 `/static/barnacle.min.css` → `/barnacle/static/barnacle.min.css`，且 `seite check` 认它是站点内资源（不报 missing-asset）。所以**内容文件里可以放心用无前缀的 `/...` 路径**，而**模板必须自己拼 `{{ site.base_url }}`**（`items[*].url`、`page.url`、`nav[*].url`、`translations[*].url` 全都不含 base_path）。
2. **页面链接千万别写尾斜杠**：`/usage/` 会被 `check --strict` 判成 broken-link（页面 URL 是 `/usage`），只有集合索引 `/components/` 带尾斜杠。这是 10–23 号票写内容时最容易踩的一脚。
3. **`seite serve` 会把 dev origin 写进 `dist/`**（预览用的是同一个 `dist/`，产物里的 `canonical` / 资源 URL 会变成 `http://127.0.0.1:<port>/...`）。`dist/` 被 gitignore，CI 会重建，但**手工部署时不要用「刚预览过」的 dist**。`verify-site.mjs` 已在 serve 检查结束后自动重跑一次 `seite build`，把 `dist/` 留在生产态（已在产物里核对 `canonical` = `https://ivan112058.github.io/barnacle/`）。
4. `public/` 语义实测：`public/favicon.svg`（309 B）→ `dist/favicon.svg`，**逐字节一致**，不加 `static/` 前缀；`base.html` 用 `{{ site.base_url }}/favicon.svg` 引用它。非 CSS/JS 资源确实不动。
5. `content/components/index.md` 的索引模板里 `items` 为空时的空态分支有效；用临时条目 `content/components/probe-entry.md` 试过完整链路（试完已删）：`✓ Built 1 components` → `dist/components/probe-entry.html` 由 `templates/component.html` 渲染（`<!-- template: templates/component.html -->` + 标题 + 正文），并出现在 `/components/` 索引卡片里（`href="https://ivan112058.github.io/barnacle/components/probe-entry"`），`check --strict` 仍然干净。**10–22 号票加组件页时不需要再动骨架。**
6. 站点样式的命名分工（供 04/23 号票沿用）：库用 `bn-` 类名 / `--bn-*` 令牌，**文档站用 `site-` 类名 / `--site-*` 变量**，两者互不出现（已断言）。
7. 所有本票作者的文件均已断言**无 BOM**（15 个），因为 BOM 会让 seite 直接报 `frontmatter-missing`。

### 仍未验证 / 需要后续 ticket 注意

1. **`base_url` 子路径在真实 GitHub Pages 上的表现没验证**（属 03 / 24 号票）。本机能证明的只是：产物里每个站内 URL 都带 `/barnacle` 前缀且能在 `dist/` 里解析成文件（53/53），以及 `seite serve` 下会被换成 dev origin。
2. **`[languages.zh]` / 双语未配置**（23 号票）。`translations` 变量在单语言下为单元素数组，`base.html` 里**没有**写 `hreflang`（spec §14 事项 3 由 23 号票落地）；语言切换器也留空。
3. **`page.toc`、短代码、`data/` 未使用**（04 号票的渲染层再决定）。本票的 `page.html` 只渲染 `page.description` + `page.content`。
4. **暗色模式 / 令牌未接**：文档站目前是自带的固定配色，没有主题切换器；等 05/06 号票的 `--bn-*` 令牌落地后，文档站是否改用库令牌、是否加主题切换器需要拍板（本票刻意不让站点样式依赖库产物，所以库 CSS 现在几乎为空也不影响站点外观）。
5. **`seite upgrade --check` 永远非 0**（理由见上），不要把它挂进 CI 或 hook。
6. **minify 决策锁定了 `static/style.css` 也不压缩**。如果 04 号票往 `style.css` 里加很多样式后想压它，需要重新评估：可以改用「seite 之外预先压好 `static/style.min.css`」的路子，而不是打开 `minify = true`。
7. `verify-site.mjs` 里 `seite init` 的那一项会真在 `%TEMP%` 建一个目录并写 24 个文件（脚本结束会打印路径，可安全删除）；如果以后要跑在无网络/无 temp 权限的环境，加 `--no-init-probe` 之类的开关。

