# 03: 上线骨架并验证子路径

**What to build:** 一个真实的公开 URL。项目站点部署在 `/barnacle/` 子路径下，这是最易 404 的一处，所以把它放到组件之前验证，而不是留到最后。本票只验证发布机制，站点内容仍为空壳，完整内容交付见 24 号票。

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] `.github/workflows/deploy.yml` 采用 seite 自带的 GitHub Pages 工作流（`upload-pages-artifact@v3` + `deploy-pages@v4`）
- [ ] workflow 在 CI 中先跑构建链产出 `static/` 产物，再跑 `seite build`，最后上传 `dist/`
- [ ] `seite` 在 CI 中按固定版本（0.20.1）获取，与本地版本一致
- [ ] GitHub Pages 的 Source 设为 "GitHub Actions"
- [ ] `https://ivan112058.github.io/barnacle/` 可访问，首页正常渲染
- [ ] 页面引用的 CSS 与 JS 全部返回 200，无一 404
- [ ] 部署链路不依赖 `gh` CLI（本机未安装）

**验证方式**

1. 在已发布的页面上逐个打开 DevTools Network 面板，确认无 404 且无指向站点根以外的绝对路径引用。
2. 记录 Pages Source 的实际设置值。
3. 在 CI 日志里确认 seite 版本恰好是 0.20.1。
