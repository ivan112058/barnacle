# 03: 上线骨架并验证子路径

**What to build:** 一个真实的公开 URL。项目站点部署在 `/barnacle/` 子路径下，这是最易 404 的一处，所以把它放到组件之前验证，而不是留到最后。本票只验证发布机制，站点内容仍为空壳，完整内容交付见 24 号票。

**Blocked by:** 02

**Status:** resolved

- [x] `.github/workflows/deploy.yml` 采用 seite 自带的 GitHub Pages 工作流（`upload-pages-artifact@v3` + `deploy-pages@v4`）
- [x] workflow 在 CI 中先跑构建链产出 `static/` 产物，再跑 `seite build`，最后上传 `dist/`
- [x] `seite` 在 CI 中按固定版本（0.20.1）获取，与本地版本一致
- [x] GitHub Pages 的 Source 设为 "GitHub Actions"
- [x] `https://ivan112058.github.io/barnacle/` 可访问，首页正常渲染
- [x] 页面引用的 CSS 与 JS 全部返回 200，无一 404
- [x] 部署链路不依赖 `gh` CLI（本机未安装）

**验证方式**

1. 在已发布的页面上逐个打开 DevTools Network 面板，确认无 404 且无指向站点根以外的绝对路径引用。
2. 记录 Pages Source 的实际设置值。
3. 在 CI 日志里确认 seite 版本恰好是 0.20.1。

## Answer

### 实现摘要（提交 `af8184c`）

- **`.github/workflows/deploy.yml`**（新增，95 行）：以 seite 0.20.1 `seite init --deploy-target
  github-pages` 生成的 801 字节工作流为骨架（name / `on` / permissions / concurrency / deploy job
  原样保留，已与 `seite init` 实测生成物逐行比对），只在 build job 里插入本仓库的构建链。
  - `on: push: branches: [main]` + `workflow_dispatch`；`permissions: contents: read / pages: write /
    id-token: write`；`concurrency: group: pages / cancel-in-progress: false`。
  - build job 步骤顺序：
    `actions/checkout@v4` → `actions/setup-node@v4`（`node-version: '26'`, `cache: npm`）→
    **Install seite**：`curl -fsSL https://seite.sh/install.sh | VERSION=v0.20.1 sh` +
    `echo "$HOME/.local/bin" >> "$GITHUB_PATH"` → **Assert the seite version**
    （`test "$(seite --version)" = "seite 0.20.1"`）→ `npm ci` → `npm run build` →
    `git diff --exit-code -- static/` → `node scripts/verify.mjs` → `node scripts/verify-theme.mjs` →
    `node scripts/verify-site.mjs` → `seite build --strict` → `seite check --strict` →
    `actions/upload-pages-artifact@v3`（`path: dist`）。
  - deploy job：`environment: name: github-pages` + `needs: build` + `actions/deploy-pages@v4`。
  - **不依赖 `gh` CLI**（全文无 `gh` 调用），**不跑 `seite upgrade --check`**。
  - 三处对 seite 原始工作流的必要修正：① 原工作流的 `Install seite` 不改 PATH，本仓库补了
    `$GITHUB_PATH`（seite-findings §9.1 实测 install.sh 只 warn 不改 PATH）；② 原工作流没有
    checkout Node / esbuild / 校验脚本，本仓库插入；③ 原工作流 `seite build` 不带 `--strict`，
    本仓库用 `--strict`。
  - `seite --version` 之所以单列一步：`$GITHUB_PATH` 只对**后续**步骤生效，同一步里 seite 还不在
    PATH 上；同时把「版本恰好 0.20.1」从「日志里看一眼」升级成硬断言（安装脚本漂移即失败）。
  - `git diff --exit-code -- static/` 紧跟 `npm run build`，这样「产物不过期」（ticket 24）被 CI 守住：
    提交进仓库的 `static/` 必须与 CI 重新构建的字节一致，否则 jsDelivr 与 raw 链接服务的就不是这个 commit。
  - **Node 版本最终选择 `node-version: '26'`**，理由：本机 `node --version` = `v26.10.0`，CI 与本地同一
    major 才能让产物字节、`scripts/*.mjs` 行为一致；esbuild 0.28.2 的输出本身与 Node 版本无关，但
    「Node 26 上验证过的构建链」是可陈述的事实，其它 major 没有。**回退备选：`node-version: 'lts/*'`**
    （或写死 `'24'`）——若 runner 镜像取不到 26.x，改这一行即可，但换 major 后需要重跑一次 CI 才能重新声称
    `static/` 字节一致。工作流注释里记了这条。
- **`scripts/verify-deploy.mjs`**（新增，503 行）：= 本票验证方式 1 的本地可执行部分 + 工作流自身的
  文本断言。**没有删改 02 号票 `scripts/verify-site.mjs` 的任何断言**（新增脚本，`verify-site.mjs`
  仍为 24 项全绿）。
- `package.json` 增加 `"verify:deploy": "node scripts/verify-deploy.mjs"`；README 增补「Verifying the
  sub-path deploy」与「Deployment」两节（含 Pages Source 必须为 GitHub Actions 的一次性设置）。

### 逐条验证方式的确切命令与实测输出要点

**A. 本票验证方式 1（本地可行的子路径部分）— `npm run verify:deploy`，12/12 PASS，EXIT=0**

- `npm run build` → `[barnacle] build ok: 4 artifacts from 20 css files, 0 warnings, 0 errors`。
- `seite build --strict`（`D:\sdk\seite\seite.exe`，`seite --version` = `seite 0.20.1`）→
  `✓ Built 0 components, 2 pages in 0.0s`。
- 脚本用 Node 内置 `http` 起服务，**把 `dist/` 挂在 `/barnacle/` 下**（随机端口，例如
  `http://127.0.0.1:12533/barnacle/`）——这是 `seite serve` 做不到的（dev server 永远从根提供，
  `/barnacle/` 实测 404，orchestrator-decisions §7）。
- 扫 `dist/` 下**每个 HTML**（5 个）的 `href`/`src`：**53 处站内引用全部带 `/barnacle` 前缀**，
  无相对路径引用，站外绝对 URL 只有 `github.com`（Source 链接）。
- 逐个请求（含 `static/barnacle.css`、`static/barnacle.min.css`、`static/barnacle.js`、`static/style.css`、
  `favicon.svg`）**11/11 = 200，0 × 404**：
  `/barnacle/` 2190B、`/barnacle/404` 1627B、`/barnacle/components/` 1965B、`/barnacle/customizing` 2464B、
  `/barnacle/favicon.svg` 309B、`/barnacle/static/barnacle.css` 6124B、`/barnacle/static/barnacle.js` 54B、
  `/barnacle/static/barnacle.min.css` 2037B、`/barnacle/static/barnacle.min.js` 25B、
  `/barnacle/static/style.css` 5982B、`/barnacle/usage` 5895B。
- `/barnacle/` 首页 200 且含组件索引链接 `href="https://ivan112058.github.io/barnacle/components/"`。
- `GET /`（站点根）= **404**，证明服务确实只挂在子路径上，测试没有假通过。
- 四份产物经 HTTP 取回的字节与仓库里 `static/` 的字节**逐字节相同**（内容与 `verify-site.mjs` 的
  `dist/static/` 校验互补：这里是「真的从子路径 HTTP 拿到」）。
- 另把 `.github/workflows/deploy.yml` 的 **23 条必须命中 + 2 条禁止命中**文本断言、以及 11 步构建链的
  **先后顺序**（`checkout → setup-node → npm ci → npm run build → git diff -- static/ → verify×3 →
  seite build --strict → seite check --strict → upload-pages-artifact`）固化成脚本断言。
  **未引入任何新依赖**（纯文本/正则），真正的 YAML 有效性由协调代理 push 后的 CI run 裁决。
- 附带（非脚本依赖）：`python -c "import yaml..."` 解析本工作流成功，
  `on = {'push': {'branches': ['main']}, 'workflow_dispatch': None}`、`jobs = ['build','deploy']`、
  `permissions = {contents:read, pages:write, id-token:write}`、`concurrency = {group: pages,
  cancel-in-progress: False}`（仅供本代理确认，脚本不依赖 PyYAML）。

**B. 未回归（本票新增文件不触碰既有断言）**

- `node scripts/verify.mjs` → **21/21 checks passed**（EXIT=0）
- `node scripts/verify-theme.mjs` → **16/16 checks passed**（EXIT=0）
- `node scripts/verify-site.mjs` → **24/24 checks passed**（EXIT=0，含 `seite init` 探针与 `seite serve` 预览）
- `git status --short` 在跑完全部脚本后只剩本票新增/修改的文件，**`static/` 无改动** ——
  也就是 CI 里 `git diff --exit-code -- static/` 这条守卫在本地成立（这正是 ticket 24 的「产物不过期」）。

**C. 本票验证方式 2（Pages Source）— 需协调代理在仓库设置侧确认**

- 实测事实（orchestrator-decisions §10）：仓库 public、凭据有 admin、**`has_pages: false`（Pages 尚未启用）**。
- **GitHub Pages 的 Source 必须是 "GitHub Actions"**（Settings → Pages → Build and deployment → Source）。
  这不是文件，无法随 commit 交付；若保持默认的 "Deploy from a branch"，`actions/deploy-pages@v4` 会直接失败。
- 本代理**无法也不应**修改仓库设置（分工上真实上线由协调代理执行）。协调代理要执行的调用：
  ```powershell
  & D:\code\barnacle-notes\gh-api.ps1 -Method POST -Path /repos/ivan112058/barnacle/pages `
      -Body '{"build_type":"workflow"}'
  # 之后校验：
  & D:\code\barnacle-notes\gh-api.ps1 -Method GET -Path /repos/ivan112058/barnacle/pages
  #   期望 "build_type": "workflow"
  ```
  （`gh-api.ps1` 自动从 git credential store 取 token，不要打印 token。若 Pages 已启用且 source 是分支，
  同一端点用 `PUT /repos/ivan112058/barnacle/pages` 改 `{"build_type":"workflow"}`。）
- 对应的 ticket 勾选项：**「GitHub Pages 的 Source 设为 "GitHub Actions"」**（本文件第 12 行那一项），
  以及验证方式 2「记录 Pages Source 的实际设置值」——两者都只能由协调代理在 push 之后勾选/记录。

### 仍未验证项（不得当成已验证）

1. **真实 CI run 从未跑过。** 工作流的 YAML 有效性、`actions/setup-node@v4` 能否取到 Node 26、
   `curl -fsSL https://seite.sh/install.sh | VERSION=v0.20.1 sh` 在 ubuntu-latest 上的实际产物名/退出码、
   `$GITHUB_PATH` 生效、`seite init`/`seite serve` 在 CI 容器内的可运行性（`verify-site.mjs` 会临时调用两者），
   全部**未在 GitHub Actions 上验证**。第一次 push `main` 的 CI run 是唯一权威。
2. **`git diff --exit-code -- static/` 在 Linux 上是否零差异未验证。** 本地（Windows）构建后无差异；
   esbuild 输出按设计跨平台确定性，但「Linux CI 重新构建的字节 == Windows 提交的字节」只能由真实 CI run 证明。
   若失败，说明产物不可跨平台复现，需要改为在 CI 里生成产物再提交（那是另一个决策，不是本票范围）。
3. **Pages Source 的实际值未确认**（见 C），`https://ivan112058.github.io/barnacle/` 目前**不存在**：
   本票只交付发布机制并做了本地子路径实测，真实 URL 上的 DevTools 逐条 404 检查必须等 push 之后。
4. **`/zh/` 子路径未覆盖**：双语内容属后续 ticket，当前 `dist/` 里没有 `zh/`，脚本的逐 URL 断言覆盖不到
   中文路径（脚本是无状态爬取，多语言内容落地后自动纳入，无需改动）。
5. **`no-serve` 以外的分支**：`--no-serve` / `--no-build` 两个选项只做了代码路径审阅，未实测。
6. CI 里**没有**跑 `npm run verify:deploy`（本票只要求把工作流与本地实测交付出来，构建链清单由协调代理给定）。
   若希望子路径爬取也进 CI，加一行 `npm run verify:deploy` 即可；代价是 CI 多起一个 HTTP 服务，
   且它需要一个 seite 能跑的容器环境——建议等第一次真实 CI run 站稳后再加。

## Resolution

Resolved on the integration branch `feat/barnacle-v1` at commit b8d230f.
Closing convention: this tracker has no "done" label, so `Status: resolved` plus the ticked checklist above records closure (see `docs/agents/issue-tracker.md`).
Verify with: `npm run verify:deploy` (and, once the site is live, `npm run verify:release -- --live`)

**Previously unticked, now closed**: the three live-deploy items — GitHub Pages' Source set to "GitHub Actions", `https://ivan112058.github.io/barnacle/` reachable, and every CSS/JS the page references answering 200 — are ticked above. Pages is enabled with `build_type: workflow`, the push carrying `.github/workflows/deploy.yml` succeeded, `GET https://ivan112058.github.io/barnacle/` answers 200, and `npm run verify:release -- --live` reports 23/23 PASS with 0 SKIP. The dated readings are in `## Live verification` below.

## Live verification

Measured after the site went live, at `main` = `20858ad400ac2a4f8df9b836f4a47b068d85bf61` (the same commit as `feat/barnacle-v1`), i.e. before this tracker-only closeout commit. Every reading below is measured, not inferred.

- **Verification step 2 — the actual Pages Source value**: `GET /repos/ivan112058/barnacle/pages` returns `"build_type": "workflow"` and `"html_url": "https://ivan112058.github.io/barnacle/"`. The user set Settings → Pages → Build and deployment → Source to **GitHub Actions** in the UI.
- **Homepage reachable**: `GET https://ivan112058.github.io/barnacle/` → **200**, 12352 B.
- **Every CSS / JS asset 200, no 404**: BFS crawl from the homepage reached **46 pages (23 en + 23 zh) + 2 alias URL forms + 4 artifact links, with 0 × 404**. All assets answer 200 with the correct Content-Type: `barnacle.css` 162694 B, `barnacle.js` 45930 B, `site.js` 12189 B, `style.css` 18365 B, `favicon.svg` 309 B. The six `static/` files fetched back over HTTP are **byte-identical** to the repository copies.
- **Run #5 green**: Actions run #5 on head `20858ad` — **build = success, deploy = success**.
- **Why runs #1–#4 were red — the two-cause chain**:
  1. *Pages not enabled.* On the first runs the repository had no Pages site (`has_pages: false`), so `actions/deploy-pages@v4` had nothing to deploy into. This is the setting-side half of the chain, fixed both by the user's UI switch and — for future clones — by the `configure-pages` step recorded below.
  2. *The cross-platform spawn bug — run #4's failure.* `scripts/verify-release.mjs` and `scripts/verify-deploy.mjs` called `spawnSync('npm run build', { shell: platform === 'win32' })`. With `shell: false` on the Linux runner that looks for an executable literally named `npm run build` → **ENOENT**. Fixed in **`20858ad`** ("Spawn npm with an argument list so the release gate runs on the Linux runner") by passing an argument list instead: `spawnSync('npm', ['run', script], …)`.
- **Self-sufficiency fix**: **`1d7c136`** ("Let the Pages workflow create the site on its first run") adds `actions/configure-pages@v5` with `enablement: true`, so a fresh clone can create its own Pages site on the first run. This repository's site ended up being enabled through the UI by the user, but the step now makes the workflow self-sufficient.
- **The full gate on the real deployment**: `npm run verify:release -- --live` → **23/23 PASS, 0 SKIP**. Per-check readings (crawl counts, asset sizes, byte-identity, language switching, `hreflang`, per-page dark mode in real Chrome, README's three consumption routes including jsDelivr 4/4 and raw.githubusercontent 4/4) are recorded in ticket 24's `## Live verification`.

