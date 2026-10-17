# 24: 完整站点上线验证

**What to build:** v1 交付验收。完整站点（全部组件页、双语、示例渲染、索引页）在真实的 `/barnacle/` 子路径下逐链接走通。这一票不写新功能，只做「对外发布」这条路的最终确认。

**Blocked by:** 23

**Status:** resolved

- [x] 完整站点在 `https://ivan112058.github.io/barnacle/` 上可访问
- [x] 从首页出发，逐链接走通全部页面（中英各一遍），无死角 404
- [x] 全部资源（CSS、JS、字体、图片）在子路径下均返回 200
- [x] 中英文页面互相切换正确，`hreflang` 情况与 23 号票的实测结论一致
- [x] 暗色模式在完整站点上逐页成立
- [x] `static/` 下的四份产物与当前源码一致（不是过期产物）
- [x] README 的消费方式（CDN / 原始下载 / 按需组合）逐条实测可用，CDN 链路指向 `main` 分支的 `static/` 路径

**验证方式**

1. 用爬虫式遍历或逐页手点，把全部 URL 过一遍并记录 404 数量为零。
2. 打开 DevTools Network，确认全站无失败请求、无绝对根路径引用。
3. 在一张白纸上按 README 的三种消费方式各接一次，确认都能得到正确外观。
4. 确认 `static/` 产物与重新构建的结果逐字节一致。

## Answer

**基线**：`ticket/24-release`，从 23 号票 tip `e582ceb` 起；收尾时 `git merge feat/barnacle-v1` 快进到 `006b935`。
本机：Node 26.10.0、seite 0.20.1（`D:\sdk\seite\seite.exe`）、playwright-core 1.64.1、系统 Chrome 155.0.8059.82。

这一票不写功能，只把「上线验证」做成**一条可重复执行的命令**：`scripts/verify-release.mjs`
（`npm run verify:release`）。拆成两半：

- **离线模式（默认）**：`npm run verify:release` —— 20 项检查，退出码 0；
- **在线模式**：`npm run verify:release -- --live`（或 `BN_LIVE=1`）—— 同一道门，把 HTTP 那一半指向
  `https://ivan112058.github.io/barnacle/` 与 jsDelivr / raw 两个镜像。**站点还没上线，所以它现在如实报红**，
  证据见下。

其它开关：`--no-build`（复用现有 `dist/`/`static/`）、`--no-browser`（跳过真 Chrome 两项）、`--help`。

### 逐条对照 ticket 勾选项

| ticket 勾选项 | 结论 | 实测证据（命令 → 数字） |
|---|---|---|
| 完整站点在 `https://ivan112058.github.io/barnacle/` 上可访问 | **未验证（站点未上线）** | `--live`：`GET https://ivan112058.github.io/barnacle/` → **404**，`text/html; charset=utf-8`，9115 B |
| 从首页出发逐链接走通全部页面（中英各一遍），无死角 404 | 离线通过 | BFS 从 `/barnacle/` 跟随 `<a href>`：52 个 URL = **46 个不同页面（23 en + 23 zh）** + 2 个同一页面的非规范形式 URL（`/components/index`，见下文「发现的问题」）+ 4 个非页面 URL（Usage 页用 `<a>` 直链的产物）；0 × 404；爬到的页面集合 == `dist/` 的 HTML 集合（46 = 46；两个 404 页不参与，因为没有任何链接指向它们，但它们确实是文件） |
| 全部资源（CSS、JS、字体、图片）在子路径下均返回 200 | 离线通过 | HTML 里 5 个资源（`favicon.svg`、`barnacle.css`、`barnacle.js`、`style.css`、`site.js`）+ 4 个被 Usage 页以 `<a>` 直链的产物 = 全部 200，Content-Type 与扩展名族一致；CSS 里 `url()` 引用 **0 个**（库不带 webfont/位图，这一类将来出现时同一断言会覆盖）；六个 `static/` 文件经 HTTP 取回与仓库文件**逐字节相同** |
| 中英文页面互相切换正确，`hreflang` 与 23 号票结论一致 | 离线通过 | 46 页每页 1 个切换链接、指向**本页的对端**且对端确实在页面集合里（双向，不读硬编码清单）；`<html lang>` 与 URL 语言一致；每页 3 条 alternates（en / zh / x-default），x-default == en，三者都指向已发布页面 —— 与 23 号票的实测结论一致（sitemap 的 alternates 仍由 `verify:i18n` 负责，本脚本不重复） |
| 暗色模式在完整站点上逐页成立 | 离线通过 | 真 Chrome 155.0.8059.82，**全部 46 页**（含 19 个组件页 × 中英 = 38 页）：`html[data-theme="dark"]` 后 body 背景 `rgb(26, 26, 26)`、`--bn-foreground` → `rgb(255, 253, 245)`、`--bn-shadow-md` → `rgb(255, 253, 245) 4px 4px 0px 0px`；每页再切回 `light` 做对照（必须回到 `rgb(255, 253, 245)` / `rgb(0, 0, 0)`，否则就是「读了个常量」）；0 console error / 0 pageerror / 0 失败请求 |
| `static/` 四份产物与当前源码一致（不是过期产物） | 离线通过 | `npm run build` 退出 0（4 产物 / 20 个 css / 0 warning）后 `git diff --exit-code HEAD -- static/` 为空、无未跟踪文件；`barnacle.css` 与 `barnacle.min.css` 第 1 行都是 `@layer theme, base, components, animations, utilities;` |
| README 的消费方式逐条实测可用，CDN 指向 `main` 的 `static/` | **2/3 实测通过，CDN 与 raw 形式校验通过、在线未验证** | ① CDN：README 里 jsDelivr `@main` 的 4 个产物 URL 全部指向存在的文件 —— 在线请求 **4/4 → 404**（main 还没推）；② 原始下载：raw.githubusercontent `main` 的 4 个 URL 同形状校验通过 —— 在线 **4/4 → 404**；③ 按需组合：**离线实测**，按 `CSS_MANIFEST` 顺序拼 20 个 `<link>`（含必需的 `00-base.css`、`01-theme.css`）的真页面，在 Chrome 里与整份 `barnacle.css` 对比 **body 背景 / 按钮硬阴影 / 卡片边框 / `--bn-foreground`** 四项，明暗两套全部一致 |

另：`npm run i18n:check` 退出 0（`✓ every generated Chinese page matches its sidecar (23 checked)`）。

### 上线后要跑的确切命令

顺序只有三步（README 的「Going live」一节也写了）：

1. 启用 Pages：Settings → Pages → Source 选 **GitHub Actions**，或
   `POST /repos/ivan112058/barnacle/pages` + `{"build_type": "workflow"}`；
2. 推 `main`（推 `.github/workflows/deploy.yml` 需要带 `workflow` scope 的凭据，本机的没有，这正是被 GitHub 拒绝的原因）；
3. **一条命令收尾**：

```powershell
npm run verify:release -- --live
```

它会把上面「未验证」的两类全部变成实测：`PASS the site is published at https://ivan112058.github.io/barnacle/`、
逐页爬取与资源 200、六个 `static/` 文件经线上取回与仓库逐字节相同、线上逐页暗色、jsDelivr 与 raw 各 4 个产物
「200 且字节与仓库一致」。离线的那一半（build / 产物新鲜 / i18n / README 形式校验 / 按需组合）在 `--live`
里照旧跑，所以它是唯一一道需要记住的门。当前 `--live` 的失败清单就是这两条：站点 404、镜像 404 —— 其余 7 项
检查被标记为 `SKIP … the site is not published yet`，**不会伪装成通过**。

### 发现的问题（不在本票可改范围，交给后续）

`templates/component.html` 的上一页/下一页把集合索引写成 `/barnacle/components/index`（`card.html` 与
`dialog.html` 的 prev/next，中文 `form.html` / `tabs.html` 同理），而同一页的 `<link rel="canonical">` 与
`hreflang` 用的是 `/barnacle/components/`：**同一个页面有两个 URL**。它不是 404（本地挂载按 `.html` 回退能服务），
所以本票的爬虫不判红，只把它列在输出里：

```
2 link(s) do not use the page's canonical URL form:
  /barnacle/components/index → /barnacle/components/
  /barnacle/zh/components/index → /barnacle/zh/components/
```

来源是 seite 给 `prev`/`next` 的页面对象（`url = "/components/index"`）。上线后第一次 `--live` 会顺便回答
「GitHub Pages 是否也按 `.html` 回退」这个问题；若回退不存在，这两处就是真 404。规范做法是在模板里把集合索引的
pager URL 写成 `…/components/`，属 ticket 04 的文件，本票不动。

### 每个断言都能红（mutation 实测，跑完即还原）

| 注入的破坏 | 结果 |
|---|---|
| 删掉 `dist/components/toast.html` 与 `dist/zh/components/toast.html` | `FAIL every page reachable from the homepage answers 200` — `/barnacle/components/toast → 404`、`/barnacle/zh/components/toast → 404` |
| 把 button 页的 `hreflang="zh"` 指向 card | `FAIL hreflang agrees with ticket 23` |
| 把 button 页的语言切换链接指向 `/barnacle/zh/` | `FAIL the language switcher lands on the same page` — `points at …/zh/, expected …/zh/components/button` |
| 往 `static/barnacle.css` 追加一行注释 | `FAIL static/ is byte-identical to the build` + `FAIL the six published static/ files are served byte-identically` |
| 在 `dist/static/style.css` 里把暗色 body 背景压成白色 | `FAIL every page holds under html[data-theme="dark"]` — 46 页全红（`rgb(255, 255, 255)` vs `rgb(26, 26, 26)`） |
| 把 `src/css/card.css` 的 `border-width` 写死成 `2px` | `FAIL the per-file route computes the same styles` — 按需组合 2px vs 整份产物 3px（明暗两套各报一条漂移） |

### README 改了什么

- 顶部状态横幅改为「v1 feature-complete + 部署仍未完成」，并链到新增的「Going live」；
- 新增 **Verifying the release**：两个模式、每个模式覆盖什么、`--no-build` / `--no-browser`、
  以及「绿的离线运行只证明站点*会*工作，只有 `--live` 证明它真的在工作」的说明；
- 「Deployment」下新增 **Going live**：启用 Pages → 推 main → `npm run verify:release -- --live`，并写清
  `workflow` scope 这个已知阻塞；
- 「Consuming the library」重写成三条：① jsDelivr `@main`（4 个产物全部列出 + 建议按 sha 固定）；
  ② raw.githubusercontent（4 个 + 「raw 是 text/plain，别直接 `<link>`」）；③ 逐文件（20 个 `src/css/`
  文件按 `CSS_MANIFEST` 顺序全列，点明 `00-base.css` 与 `01-theme.css` 必需、层归属在 `build.mjs` 里所以
  顺序不是装饰）；
- 仓库布局里 `scripts/` 一行改成指向 `verify-release.mjs`。

`README.md`、`package.json`、`scripts/verify-release.mjs` 均 UTF-8 无 BOM，LF。

### 回归（全绿，逐条实跑）

```
npm test                        101/101 passed                  (exit 0)
npm run test:browser            11/11 passed                    (exit 0)
seite build --strict            EXIT=0  ✓ Built 38 components, 4 pages
seite check --strict            EXIT=0
npm run i18n:check              EXIT=0  ✓ every generated Chinese page matches its sidecar (23 checked)

verify 21/21            verify:theme 16/16       verify:i18n 16/16
verify:site 24/24       verify:site-shell 9/9    verify:deploy 12/12
verify:demo 19/19       verify:base 35/35        verify:button 21/21
verify:progress 17/17   verify:toast 19/19       verify:tabs 19/19
verify:dropdown 17/17   verify:taginput 21/21    verify:interaction 15/15
verify:static 26/26     verify:table 34/34       verify:switch 21/21
verify:form 21/21       verify:dialog 15/15      verify:accordion 29/29
verify:layout 22/22     verify:release 20/20（2 skip = 仅在线两项）
```

既有 `verify*` / `tests/**` 的断言一行未改，本票只新增 `scripts/verify-release.mjs` 与一个 npm script。

### 未验证 / 风险（诚实清单）

1. **真实 URL 未验证**：Pages 未启用 + 本机凭据缺 `workflow` scope，`https://ivan112058.github.io/barnacle/` 实测 404。
   本票交付的是「上线后可重复执行的验证」，不是「已经通过的验证」。
2. **CDN 与 raw 未验证**：8 个 URL 全部 404（`main` 尚无这些文件）。缓存的 `text/css` 响应头、jsDelivr 的
   `@main` 滞后也同样未验证。
3. **GitHub Pages 对无扩展路径的回退未知**（决定 `/components/index` 是否为真 404）。
4. **暗色只在桌面 Chrome 1280×900 上验证**：未测 Firefox/Safari、未测移动端；未测「真浏览器里点主题按钮 + 刷新后保持」
   —— 那条已由 `verify:demo` 与 `tests/browser/theme.test.mjs` 覆盖，本票不重复。
5. **`prefers-color-scheme` 有意不影响主题**（ADR-0004），本票只验证显式开关。
6. **线上 404 页（`dist/404.html`、`dist/zh/404.html`）**：文件存在，但中文 404 的正文仍是英文（23 号票已记录，
   seite 内置模板），本票只确认它们被构建出来。

## Resolution

Resolved on the integration branch `feat/barnacle-v1` at commit b8d230f.
Closing convention: this tracker has no "done" label, so `Status: resolved` plus the ticked checklist above records closure (see `docs/agents/issue-tracker.md`).
Verify with: `npm run verify:release` (offline) and `npm run verify:release -- --live` (once the site is live)

**Still unticked, and why**: the five live-site items — the complete site reachable at `https://ivan112058.github.io/barnacle/`, every link walked in both languages with no dead 404, every resource answering 200, dark mode per page on the real site, and README's CDN / raw-download links — stay `- [ ]`. Their offline equivalents pass and are recorded in the `## Answer` above (a 46-page crawl served under a local `/barnacle/` sub-path, 0 × 404, dark mode on all 46 pages, and the per-file composition route), but the real URL and the jsDelivr / raw mirrors are not verified yet: Pages is not enabled for this repository and this machine's git credential has no `workflow` scope, so the push of `.github/workflows/deploy.yml` was rejected by GitHub; the user will enable Pages and push `main` by hand. Once that is done, run `npm run verify:release -- --live` — its currently measured output is `GET https://ivan112058.github.io/barnacle/ → 404`.

## Live verification

上面 `## Answer` 与本节上方 `## Resolution` 的正文是**上线前**的快照，按约定原样保留；站已上线，本文所有「未验证」项均由本节关闭。测量点：`main` = `20858ad400ac2a4f8df9b836f4a47b068d85bf61`，即本次 tracker 收尾提交之前。

### 一条命令，23/23 PASS，0 SKIP

```powershell
npm run verify:release -- --live
```

**结果：23/23 PASS，0 SKIP。** 没有任何一项退化成 `SKIP … the site is not published yet`；原先报红的两类（站点 404、镜像 404）现在是实测通过。

### 逐项读数

| ticket 勾选项 | 线上实测（命令 → 读数） |
|---|---|
| 完整站点可访问 | `PASS the site is published at https://ivan112058.github.io/barnacle/`；`GET https://ivan112058.github.io/barnacle/` → **200**，12352 B |
| 逐链接走通（中英各一遍），无死角 404 | 从首页 BFS 爬取：**46 个页面（23 en + 23 zh）+ 2 个别名 URL 形式 + 4 个产物直链，0 × 404**；页面集合 46 == `dist/` 的 HTML 集合 |
| 全部资源返回 200 | `barnacle.css` **162694 B**、`barnacle.js` **45930 B**、`site.js` **12189 B**、`style.css` **18365 B**、`favicon.svg` **309 B** —— 全部 200 且 Content-Type 正确；六个 `static/` 文件经 HTTP 取回与仓库**逐字节相同** |
| 语言切换与 `hreflang` | 46 页每页 1 个切换链接指向**本页的对端**、双向可达；46 页各 **3 条** alternates（en / zh / x-default），全部指向已发布页面；`<html lang>` 与 URL 语言一致 —— 与 23 号票结论一致 |
| 暗色逐页成立 | 真 Chrome 155.0.8059.82，**46 页逐页**通过：body `rgb(26,26,26)`、`--bn-foreground` → `rgb(255,253,245)`、`--bn-shadow-md` → `rgb(255,253,245) 4px 4px 0px 0px`；**0 console / page error** |
| README 三种消费方式 | ① 按需组合：20 个 `<link>` 与整份产物在 Chrome 里计算样式一致（明暗各一遍）；② jsDelivr `@main` **4/4 → 200**；③ raw.githubusercontent `main` **4/4 → 200** —— 八个 URL 的字节均与仓库 `static/` 产物一致 |

上线过程本身修掉的两处真实缺陷记在 03 号票的 `## Live verification`（run #4 的 Linux `spawnSync` bug = `20858ad`；`configure-pages` 自举 = `1d7c136`）。

### 复验命令

```powershell
npm run verify:release -- --live
# 期望：23/23 PASS，0 SKIP。站点或镜像再次不可用时以 FAIL 报出，不会伪装成 SKIP。
```

离线那一半仍是 `npm run verify:release`（不需要网络）。
