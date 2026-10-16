# 05: 公共令牌与暗色模式

**What to build:** 整个库的视觉词汇表。亮色令牌全部落在 `:root`，暗色令牌落在 `[data-theme="dark"]`，三档硬阴影由同一套偏移派生，语义变体映射到内部颜色变量。改一个 `--bn-shadow-x` 就能等比缩放整套层次感——这是「改令牌就换一种风味」的落点。

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] 亮色令牌全部定义在 `:root`（结构、阴影偏移与层级、交互位移、颜色、强调色与语义映射、字体、动效）
- [ ] 暗色令牌只定义在 `[data-theme="dark"]`，**不出现 `prefers-color-scheme`**（ADR-0004）
- [ ] 三档阴影全部由 `--bn-shadow-x` / `--bn-shadow-y` 经 `calc()` 派生
- [ ] 公共令牌一律 `--bn-*`，内部变量一律 `--_*`，无第三种命名（ADR-0005），且令牌名全为 ASCII
- [ ] `data-variant` → `--_variant-color` 的语义变体映射就位（success / warning / danger）
- [ ] 暗色下中性色与阴影色被重调，强调色保持不变
- [ ] 覆盖单个 `--bn-shadow-x` 后三档阴影按比例同步变化

**为什么拆 `--bn-border-color` 与 `--bn-border-width`**：参考源里 `--border` 一个当简写、一个当颜色，同名不同义极易误用。
**为什么单列 `--bn-shadow-color`**：默认等于边框色以保住「边框与阴影同色」的招牌观感，但暗色模式与强调色卡片需要独立覆盖它。

**验证方式**

1. 全文检索未压缩产物：`prefers-color-scheme` 零命中；`--bn-*` 与 `--_*` 之外无其他自定义属性命名。
2. 在页面上覆盖 `--bn-shadow-x: 8px`，观察三档阴影是否同步放大、悬停位移是否仍与阴影增量相等。
3. 切换 `data-theme="dark"`，确认硬阴影翻白、强调色不变。
