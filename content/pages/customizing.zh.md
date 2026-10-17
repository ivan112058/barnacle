---
# 本文件由 scripts/i18n-zh.mjs 从 pages/customizing.md 生成，请勿手改；要改译文请改那边。
title: "自定义主题"
description: "设计令牌、级联层与暗色主题。"
---

> **占位。** 令牌文档会随主题工作一起落地（05、06 与 09 号票）。

Barnacle 用 CSS 换皮，不靠构建步骤：

- **公开令牌是 `--bn-*`。** 在 `:root` 上设一次，所有组件都跟随。
- **内部变量是 `--_*`**，不属于公开 API。
- **级联层的顺序是固定的**——`theme, base, components, animations, utilities`——所以你写的不分层
  CSS 永远赢过库，不需要 `!important`。
- **暗色模式是显式的**，通过 `[data-theme="dark"]`；Barnacle 从不自作主张跟随系统偏好。
