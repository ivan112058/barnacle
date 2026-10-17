# 01: 构建链与层清单

**What to build:** 开发者用一条命令即可从 `src/` 产出全部四份发布产物，并知道拼接顺序由显式的层清单决定。这是「构建产物提交进仓库」这条路的地基：没有它，后面每一个组件都无法被验证。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] `scripts/build.mjs` 用显式清单声明 `src/css/*.css` 的拼接顺序，顺序即层顺序，并作为公共契约（ADR-0006）记录在案
- [x] 拼接产物写入 `static/barnacle.css`，再由 esbuild `--minify` 产出 `static/barnacle.min.css`
- [x] `src/js/index.js` 经 esbuild `--bundle --format=iife` 产出 `static/barnacle.js`，再由 `--minify` 产出 `static/barnacle.min.js`
- [x] 未压缩 CSS 的第 1 行是 `@layer` 声明；清单里的层顺序与声明一致
- [x] 清单中某个文件缺失、或层声明不在第 1 行时，**构建立刻失败**（不能默默产出坏样式）
- [x] `package.json` 的 **dependencies 为空**（零运行时依赖）；esbuild 与浏览器验收台的工具一律放 devDependencies，且不进 `static/` 产物
- [x] `.gitignore` 忽略 `dist/` 与 `node_modules/`
- [x] esbuild 对 CSS 与 JS 均无 warning 输出
- [x] IIFE 产物不出现 ES module 语法（无顶层 `import`/`export`）

**验证方式**

1. 连续跑两次构建，产物字节一致。
2. 临时删掉清单里的一个文件，构建必须以非零码退出并指名该文件。
3. 打开 `static/barnacle.min.css`，确认第 1 行仍是 `@layer` 声明。

## Answer

**分支** `ticket/01-build-chain` · **实现提交** `24ab8ed` · 基线 = `f72a10c`（`feat/barnacle-v1` tip，`git merge-base HEAD feat/barnacle-v1` 与 HEAD 同点）。

### 改动文件（30 个）

| 类别 | 文件 |
|---|---|
| 构建链 | `scripts/build.mjs`（清单 + 层校验 + 拼接 + esbuild 两段压缩）、`scripts/verify.mjs`（21 项脚本化检查） |
| 清单 | `package.json`（`dependencies: {}`、`devDependencies.esbuild: "0.28.2"` 精确锁定、`type: module`、`build`/`verify` 两个 script）、`package-lock.json`（lockfileVersion 3，已提交）、`.gitignore`（`/dist`、`/node_modules`） |
| 源码占位 | `src/css/` 全部 20 个文件（每个一行注释；`00-base.css` 第 1 行是层声明）、`src/js/index.js`（`window.bn = {}` 空壳） |
| 产物 | `static/barnacle.css` 2615 B、`static/barnacle.min.css` 404 B、`static/barnacle.js` 54 B、`static/barnacle.min.js` 25 B |

### 关键设计决策（后续 ticket 请照此行事）

1. **层归属写在清单里，源文件不许自己写 `@layer`。** `build.mjs` 把每个源文件包进 `CSS_MANIFEST` 里为它指定的 `@layer <layer> { … }`。理由：某个文件漏写 `@layer` 时它就成了「未分层样式」，而未分层样式胜过任何分层样式，会静默推翻 ADR-0006 的核心承诺——所以构建直接拒绝：源文件（除 `00-base.css` 第 1 行外）出现顶格 `@layer` 即失败并给出文件:行号。
2. **`CSS_MANIFEST` 是顺序与层归属的唯一来源**，20 个文件一次列全（spec §5 顺序），后续每张 CSS ticket 只改自己的文件，不碰清单（因此也不会互相争抢同一个文件）。
3. **`@layer` 声明逐字取自 `00-base.css` 第 1 行**，构建断言它等于 `LAYER_ORDER` 拼出的声明，并断言产物第 1 行等于该行原文。
4. **压缩产物 = 声明行 + 压缩后的层块**，所以 `barnacle.min.css` 与 `barnacle.css` 的第 1 行**逐字节相同**（验证方式 3 是字面成立的，而不是「前缀恰好匹配」）。若按常规把整份 CSS 丢给 esbuild `--minify`，产物会坍缩成单行，第 1 行就只剩一个前缀了。
5. **minify 阶段显式带 `format: 'iife'`**：实测不带时 esbuild 会把 IIFE 外壳内联掉，`barnacle.min.js` 变成 `window.bn={};`——顶层声明会泄漏到全局。
6. **esbuild warning = 构建失败**（不是打印后继续）。ticket 要求 0 warning，与其让它静默通过不如让构建炸掉。
7. **失败即零写入**：所有源文件先全部读入校验，四份产物在最后一步才落盘，所以失败的构建不会留下半个产物。
8. 源文件行尾统一归一为 LF，产物不受编辑器行尾影响。

### 验证证据

**验证方式 1 —— 连续两次构建字节一致（`Get-FileHash` SHA256 前 16 位）**

```
barnacle.css           AE297901825DEC3A  IDENTICAL
barnacle.min.css       D08FDA3AE5B9BE83  IDENTICAL
barnacle.js            8EF1EDA2591163A4  IDENTICAL
barnacle.min.js        3E7C8FFFB53F3EAA  IDENTICAL
```

**验证方式 2 —— 临时删掉清单里的一个文件**

```
$ Remove-Item src\css\dialog.css ; node scripts/build.mjs
[barnacle] build failed: src/css/dialog.css: listed in CSS_MANIFEST but missing on disk — restore it or remove it from the manifest.
exit=1
$ (恢复文件) node scripts/build.mjs
restored, rebuild exit=0
```

非零退出 ✅、指名文件 ✅。另外断言了：失败的构建不改写已有产物（四个哈希与失败前一致），所以「不能默默产出坏样式」成立。

**验证方式 3 —— min.css 第 1 行**

```
barnacle.css     line1: @layer theme, base, components, animations, utilities;
barnacle.min.css line1: @layer theme, base, components, animations, utilities;
barnacle.min.css raw line count: 2
```

两行逐字节相同 ✅（min.css 第 2 行是压缩后的层块）。

**`npm install`**：成功，`added 2 packages in 836ms`，exit 0。注意 npm 12.1.0 默认拦截 install script，esbuild 的 `postinstall` 被拦下（`npm warn install-scripts ... esbuild@0.28.2 (postinstall: node install.js)`）；实测**不影响构建**——Windows 二进制由 optional dependency `@esbuild/win32-x64` 提供，esbuild 的 JS API 直接定位到它。

**`npm run build` 输出**

```
[barnacle] static/barnacle.css          2615 B
[barnacle] static/barnacle.min.css       404 B
[barnacle] static/barnacle.js             54 B
[barnacle] static/barnacle.min.js         25 B
[barnacle] build ok: 4 artifacts from 20 css files, 0 warnings, 0 errors
```

**`node scripts/verify.mjs`（本 ticket 的测试就是这三条验证方式，已脚本化）**：`21/21 checks passed`（exit 0）。覆盖：dependencies 为空对象、esbuild 在 devDependencies、`.gitignore` 两项、产物未被 gitignore、清单 20 文件与 spec §5 逐项同序、每文件的层都在 `LAYER_ORDER` 内且五个层都被用到、构建退出码 0 且 0 warning、构建工具不泄漏进产物、四个产物非空、两次构建字节一致、压缩产物更小、两份产物的第 1 行、声明在产物里只出现一次、IIFE 无顶层 import/export、删文件失败并指名、层声明不在第 1 行时失败、源文件自带 `@layer` 时失败、破坏性探针后产物与基线哈希一致。

### 仍未验证 / 需要后续 ticket 注意

1. **`static/` 产物能否被 seite 正确复制并在浏览器加载**完全没验证（属 ticket 02/04/24）。本 ticket 只保证文件存在且未被 gitignore（已断言），以及 seite 的 `static/` 约定（spec §4）未被破坏。
2. **层顺序的浏览器行为**（使用者不写 `@layer` 即可覆盖、未分层样式获胜）没有在真实浏览器里跑过。本 ticket 只保证声明在产物第 1 行且顺序与 ADR-0006 一致；真正的行为验收在 ticket 06 的验证方式 3 与 ticket 08 的验收台。
3. 当前 20 个源文件几乎都是空层块，产物里出现的是 `@layer components;` 这类**空层声明**（esbuild 把空块压成了这种形式）。层结构要到 05/06 落地真实规则后才真正有意义——压缩产物因此目前只有 404 B，这是预期，不是 bug。
4. **`LAYER_ORDER` 与清单顺序不是同一件事**：ADR-0006 要求 `theme` 在 `base` 之前，而 `00-base.css` 必须是清单第 1 个文件（它承载声明）。二者只能靠第 1 行的显式声明调和；build.mjs 里已写明。若后来有人「按文件顺序推断层顺序」，结论会是错的。
5. esbuild 固定为精确版本 `0.28.2`（无 `^`），未实测其他版本。升级后产物哈希必然变化（属预期），但 `verify.mjs` 必须保持 21/21。
6. **npm 12 的 `allowScripts` 默认拦截安装脚本**：ticket 08 若要引入 playwright / puppeteer 这类带 `postinstall` 的浏览器验收工具，`npm install` 会拦下它们的安装脚本，需要显式 approve（`npm install-scripts approve <pkg>`）或加 `.npmrc` 放行；本 ticket 的 esbuild 不受影响。
7. `animations.css` 的占位注释没有指名 owner（ticket 09 的动效守卫、14 的 `::backdrop`、10 的 spinner keyframes 都可能写它）；其余占位的 owner 标注来自各 ticket 标题（`form.css` 标了 11+12，因为 switch 寄居 form.css）。若与实际分工不符，只需改那一行注释，不影响构建。

## Resolution

Resolved on the integration branch `feat/barnacle-v1` at commit b8d230f.
Closing convention: this tracker has no "done" label, so `Status: resolved` plus the ticked checklist above records closure (see `docs/agents/issue-tracker.md`).
Verify with: `npm run verify`
