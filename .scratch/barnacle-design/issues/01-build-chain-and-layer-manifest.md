# 01: 构建链与层清单

**What to build:** 开发者用一条命令即可从 `src/` 产出全部四份发布产物，并知道拼接顺序由显式的层清单决定。这是「构建产物提交进仓库」这条路的地基：没有它，后面每一个组件都无法被验证。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] `scripts/build.mjs` 用显式清单声明 `src/css/*.css` 的拼接顺序，顺序即层顺序，并作为公共契约（ADR-0006）记录在案
- [ ] 拼接产物写入 `static/barnacle.css`，再由 esbuild `--minify` 产出 `static/barnacle.min.css`
- [ ] `src/js/index.js` 经 esbuild `--bundle --format=iife` 产出 `static/barnacle.js`，再由 `--minify` 产出 `static/barnacle.min.js`
- [ ] 未压缩 CSS 的第 1 行是 `@layer` 声明；清单里的层顺序与声明一致
- [ ] 清单中某个文件缺失、或层声明不在第 1 行时，**构建立刻失败**（不能默默产出坏样式）
- [ ] `package.json` 的 **dependencies 为空**（零运行时依赖）；esbuild 与浏览器验收台的工具一律放 devDependencies，且不进 `static/` 产物
- [ ] `.gitignore` 忽略 `dist/` 与 `node_modules/`
- [ ] esbuild 对 CSS 与 JS 均无 warning 输出
- [ ] IIFE 产物不出现 ES module 语法（无顶层 `import`/`export`）

**验证方式**

1. 连续跑两次构建，产物字节一致。
2. 临时删掉清单里的一个文件，构建必须以非零码退出并指名该文件。
3. 打开 `static/barnacle.min.css`，确认第 1 行仍是 `@layer` 声明。
