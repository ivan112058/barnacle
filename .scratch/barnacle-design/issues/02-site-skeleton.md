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
