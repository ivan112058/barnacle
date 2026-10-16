# 16: Progress / Meter

**What to build:** `progress` 与 `meter` 共用一套槽与填充。两者文档粒度不同、样式实现同源——这是「文档粒度 ≠ 文件粒度」的第一个例子，故意不为 1:1 拆文件。

**Blocked by:** 09

**Status:** ready-for-agent

- [ ] 裸 `progress` 与 `meter` 共用同一套槽与填充样式，不各写一份
- [ ] `progress` 的不确定态（无 `value`）有可辨的呈现
- [ ] 语义变体走 `data-variant`，与强调色令牌挂钩
- [ ] 填充的动画受 `prefers-reduced-motion` 守卫
- [ ] 无脚本时两者均以正确外观呈现
- [ ] 文档站出现「Progress / Meter」页，同页覆盖两个元素与各自变体

**验证方式**

1. 逐档设置 `value`，确认填充比例正确且槽宽不变。
2. 移除 `value` 触发不确定态，确认外观合理。
3. 覆盖 `data-variant`，确认填充色跟随语义变体。
