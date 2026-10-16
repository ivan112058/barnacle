# 18: 浅 DOM 基类与 `window.bn`

**What to build:** 三个自定义元素的共同底座：生命周期、`handleEvent` 分发、键盘导航、事件派发、id 生成。同时把 `window.bn` 这个全局面钉死——IIFE 下无法具名导出，全局命名空间是唯一出口，所以它必须窄且被验证过。

**Blocked by:** 06

**Status:** ready-for-agent

- [ ] `BnBase` 提供生命周期、`handleEvent` 分发、键盘导航、事件派发与 id 生成
- [ ] 事件一律 `CustomEvent` 且 `bubbles: true, composed: true`（spec §9）
- [ ] **只用浅 DOM**，不用 Shadow DOM（ADR-0002）；组件是对内部原生元素的增强而非替代
- [ ] 初始化在 DOM ready 后一次性完成，**可重复调用不重复绑定**
- [ ] `window.bn` 面窄且被测试钉死，内部实现不泄漏到全局
- [ ] 只有「有内部状态与生命周期」的能力才做成自定义元素；无状态能力留作普通模块
- [ ] 禁止跟随系统的暗色模式等库级约定不被 JS 绕过
- [ ] `src/js/index.js` 完成自定义元素注册与 `window.bn` 挂载

**测试要求**

本票起 JS 逻辑开始存在，**必须用 `node --test` 写真实测试**（Node 内置，零额外依赖）：`BnBase` 的生命周期与分发、重复初始化不重复绑定、`CustomEvent` 的 `bubbles`/`composed`、id 生成的唯一性。JS 票是这套票里唯一「测试先行」真正成立的部分。

**验证方式**

1. `node --test` 全绿。
2. 连续两次触发初始化，确认监听器数量不变、行为不重复。
3. 断开并重连一个自定义元素，确认无残留监听。
4. 在页面上枚举 `window` 上被新增的可枚举属性，确认只有 `bn`。
5. 确认产物中没有 `attachShadow` 调用。
