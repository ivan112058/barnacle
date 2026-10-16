# 08: 浏览器不变量验收台

**What to build:** 一套能在浏览器里**实测计算样式**的验收台，让设计不变量变成可重复执行的断言，而不是靠肉眼。这是「必须实测，不得假设」（spec §14）在工程上的落点，也是 09 号票敢在重构后宣告「不变」的依据。

**Blocked by:** 07

**Status:** ready-for-agent

- [ ] 验收台能启动本机已安装的 Chrome（`channel: 'chrome'`）——**不下载浏览器二进制**，本机已有 Chrome 与 `ms-playwright` 缓存
- [ ] 测试在 `http://127.0.0.1:<port>` 上服务页面，**不使用 `file://`**（`file://` 下会有加载假失败）
- [ ] 覆盖页面与库产物来自真实的构建产物，不手写 CSS 字面量
- [ ] 断言用 `getComputedStyle` 读取计算值，**不做像素级截图比对**
- [ ] 断言零 console error、零 page error
- [ ] 三条防 flaky 约束写进验收台的公共前置步骤并在注释里说明原因：
  - **断言前冻结 `transition` 与 `animation`**——否则读到过渡中间值（实测曾读到 `4.04917px` 而非 `4px`）
  - **焦点断言必须用键盘 Tab 到达，且断言对象必须真可聚焦**——`element.focus()` 不触发 `:focus-visible`；对 `<div>` 断言焦点环是无效测试
  - **`:hover` 后所有读取合并进一次 evaluate**——穿插的 `$eval` 会打断 hover 状态
- [ ] 验收台在 09 号票的交互契约抽取后**逐条重跑并全部通过**（含真实的 `:hover`，不是只测类名模拟）
- [ ] 用它复现一次真实失败（临时破坏一条不变量，确认测试变红），证明它不是空跑

**已实测可断言的不变量**（探针 27/27 通过，可直接照搬）

| 不变量 | 断言读法 | 实测值 |
|---|---|---|
| §3.2 模糊与扩展半径为 0 | `getComputedStyle().boxShadow` | `rgb(0, 0, 0) 4px 4px 0px 0px` |
| §3.3 位移距离与阴影偏移同源 | 真实 `:hover` 后比对 `transform` 与阴影增量 | `matrix(1,0,0,1,-2,-2)` ↔ `4px→6px` |
| §3.7 hover 不改边框宽度 | hover 前后的 `borderTopWidth` / `borderLeftWidth` | 稳定在 `3px` |
| §7 焦点环用 outline 且不被吞 | 键盘 Tab 到 `<button>` | `solid 3px` + `offset 3px`，且硬阴影同时存在 |
| ADR-0006 层顺序是契约 | 未分层的使用者规则覆盖已分层规则 | 读到 `rgb(0, 128, 0)` |
| ADR-0004 不跟随系统暗色 | `newPage({ colorScheme: 'dark' })` 且无 `data-theme` | 仍读亮色 `#FFFDF5` |
| §6 一个令牌缩放三档 | 覆盖 `--bn-shadow-x: 8px` | md → `8px`、sm → `4px` |
| §7 动效守卫可模拟 | `newPage({ reducedMotion: 'reduce' })` | `animationName: none` |

**验证方式**

1. 逐条过一遍上表，确认全部从红转绿。
2. 故意把 `--bn-shadow-md` 的模糊半径改成 `1px`，确认验收台报错并指名该不变量。
3. 记录浏览器标识（`channel: 'chrome'` 的实际版本），作为后续票的回归基线。
