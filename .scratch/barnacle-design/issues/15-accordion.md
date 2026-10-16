# 15: Accordion

**What to build:** 用原生 `details` / `summary` 折叠面板。展开指示器的位移与阴影偏移同源，所以换一种阴影风味时它的动作也自动跟着变。

**Blocked by:** 09

**Status:** ready-for-agent

- [ ] 原生 `details` / `summary` 呈正确外观，收起与展开两态都可辨
- [ ] 展开指示器的旋转或位移与 `--bn-shadow-x/y` 同源派生（§3 不变量 3）
- [ ] 无需脚本即可开合；键盘（Enter / Space）与焦点环均可用
- [ ] 开合**不改变边框宽度**，不引起栅格重排
- [ ] 文档站出现「Accordion」页，含多面板与嵌套示例中的至少一种

**验证方式**

1. 覆盖 `--bn-shadow-x`，确认指示器动作同步变化。
2. 开合面板前后读取容器尺寸，确认无非预期跳动。
3. 禁用 JavaScript，确认开合仍可用。
