# 14: Dialog

**What to build:** 原生 `dialog` 呈现 Neubrutalism 外观：厚边框、硬阴影、遮罩层有足够的明暗对比，入场动画受动效守卫。

**Blocked by:** 09

**Status:** ready-for-agent

- [ ] 原生 `dialog` 呈正确外观，`::backdrop` 用 `--bn-overlay` 或等价的令牌表达
- [ ] 入场动画写在 `prefers-reduced-motion: no-preference` 块内
- [ ] `showModal()` 下焦点行为正常：打开时焦点进入对话框，关闭后回到触发元素
- [ ] 硬阴影与边框在遮罩之上仍然成立，不被遮罩吞掉
- [ ] 无脚本时 `<dialog open>` 仍以正确外观呈现
- [ ] 文档站出现「Dialog」页，含可打开与关闭的示例

**验证方式**

1. 打开与关闭对话框，确认焦点去而复返。
2. 打开「减少动态效果」，确认入场动画消失。
3. 在暗色下确认遮罩与对话框本体的对比足够。
4. 禁用 JavaScript，确认带 `open` 属性的对话框外观正确。
