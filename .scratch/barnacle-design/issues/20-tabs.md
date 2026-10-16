# 20: Tabs

**What to build:** `<bn-tabs>` 可用。标签页的语义完全交给 `role=tablist` / `role=tab` / `role=tabpanel`——与其说这是一个自定义元素，不如说是给正确 ARIA 结构加行为。

**Blocked by:** 18

**Status:** ready-for-agent

- [ ] `<bn-tabs>` 用 `role=tablist` / `role=tab` / `role=tabpanel` 语义工作
- [ ] 键盘导航完整：方向键在标签间移动、Home / End 到首尾，选中态与焦点态可辨（roving tabindex）
- [ ] 切换标签派发 `CustomEvent`，detail 至少含索引与被选中的标签，且 `bubbles: true, composed: true`
- [ ] 无脚本时全部面板可见或全部可读，不出现内容丢失（§3 不变量 6）
- [ ] 不使用 Shadow DOM
- [ ] 文档站出现「Tabs」页，含可运行示例与选项说明

**测试要求**

用 `node --test` 覆盖：`detail` 的内容形状、roving tabindex 的转移、方向键与 Home / End 的索引计算。无脚本可读性靠浏览器验收台断言。

**验证方式**

1. 只用键盘操作一遍标签切换，确认焦点环与选中态都清楚。
2. 在无脚本模式下装载该页，确认每个面板的内容都能读到。
3. 监听事件，确认派发对象的 detail 内容与冒泡标志。
