# 10: Card / Badge / Alert / Spinner / Skeleton

**What to build:** 五个静态组件一次落地，覆盖三种锚点形态：有语义元素的（`article`、`[role="alert"]`）、无语义元素只能靠类名的（`.bn-badge`）、以及同锚点不同职责的（`[role="status"]` 分给加载指示与占位）。强调色卡片要求边框与阴影同色，这是 `--bn-shadow-color` 单列出来的第一个真实用例。

**Blocked by:** 09

**Status:** ready-for-agent

- [ ] **Card**：裸 `article` 呈卡片外观；含强调色变体，该变体下边框色与阴影色同步，不脱节
- [ ] **Badge**：`.bn-badge` 就位；无语义元素可用的场合才用类名（ADR-0001）
- [ ] **Alert**：`[role="alert"]` 就位；语义变体走 `data-variant`，外观不硬编码颜色名
- [ ] **Spinner**：`[role="status"]` 就位；纯 CSS 动画，且入场动画写在 `no-preference` 块内
- [ ] **Skeleton**：`[role="status"]` 就位；加载占位在不支持动效的环境下仍然表达「正在加载」
- [ ] 五个组件**各自一页**，每页一句引导语点名所用语义锚点 + 可运行示例，正文不出现 H2

**验证方式**

1. 逐页目视确认五个组件在亮色与暗色下都成立。
2. 在强调色卡片上覆盖 `--bn-shadow-color`，确认边框与阴影同步变化。
3. 打开「减少动态效果」，确认 Spinner 与 Skeleton 的动画被守卫，且骨架仍然可辨。
