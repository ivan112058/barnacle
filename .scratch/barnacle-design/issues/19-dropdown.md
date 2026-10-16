# 19: Dropdown

**What to build:** `<bn-dropdown>` 可用。基于原生 popover API，标记仍由使用者手写，JS 只加行为。

**Blocked by:** 18

**Status:** ready-for-agent

- [ ] `<bn-dropdown>` 基于原生 popover API 打开与关闭
- [ ] 组件只增强内部已有元素：找不到内部结构时安静退出，不报错（spec §9 约定）
- [ ] 键盘导航与开关可达，焦点管理正确
- [ ] 打开与关闭派发 `CustomEvent`，`bubbles: true, composed: true`
- [ ] 不使用 Shadow DOM
- [ ] 文档站出现「Dropdown」页，含可运行示例与选项说明

**测试要求**

用 `node --test` 覆盖：内部结构缺失时安静退出、事件 `bubbles`/`composed` 为真、键盘导航的分发路径。视觉与 popover 行为仍靠浏览器验收台。

**验证方式**

1. 用键盘完整走一遍打开、移动、选择、关闭。
2. 放一个内部结构不完整的 `<bn-dropdown>` 到页面上，确认控制台无报错。
3. 监听事件，确认 `bubbles` 与 `composed` 均为真。
4. 实测 popover API 在目标浏览器可用；不可用则记录并落地兜底。
