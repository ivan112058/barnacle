---
# 本文件由 scripts/i18n-zh.mjs 从 components/switch.md 生成，请勿手改；要改译文请改那边。
title: "开关"
description: "一个自称开关的 checkbox：滑块滑动的距离与它的阴影由同一个令牌驱动，而状态是浏览器自己的——不需要脚本，也没有 aria-checked 要维护。"
---

Barnacle 装扮 `input[role="switch"]`——一个自称开关的 checkbox——所以这个控件不加类就是开关，而它的
状态是浏览器自己的。在你已经写的标记里加上 `type="checkbox"` 与 `role="switch"`，这个 checkbox 就变成
一条带滑块的槽，打开时滑块滑到另一边：

```html
<p>
  <label for="wifi">Wi-Fi</label>
  <input id="wifi" type="checkbox" role="switch">
</p>
```

按一下。开关用键盘能切换、用点击能切换、点它的标签也能切换——因为它显示的状态就是原生 checkbox 的
`:checked` 状态，而不是存在别处的副本。没有脚本，没有需要跟着画面同步的 `aria-checked` 属性，页面变化
之后也没有东西需要重新初始化。

### 开与关

两个状态就是元素自己的两个状态。关时，槽显示页面自己的底色，滑块停在这边的沿上；开时，槽用 `--bn-main`
填满，滑块花掉那段行程，落在离那边沿同样间隙的位置，而且换成强调色的墨，因为它现在坐在一块饱和的填充上。
两个状态之间没有任何规则改变边框宽度、内边距或尺寸，所以开关永远不会让它所在的行重排——和悬停按钮遵守的是
同一条不变量。

### 滑动与阴影是同一个数字

滑块行进的是一段三倍阴影偏移的距离，而它自己的阴影是最小的一档——半个偏移。两者都读 `--bn-shadow-x`，
所以这段移动和画它用的阴影，是同一个事实的两种表达，而槽的尺寸是从行程算出来的，不是一个固定宽度：

```css
input[role="switch"] {
  --_switch-travel: calc(var(--bn-shadow-x) * 3);
  inline-size: calc(var(--_switch-h) + var(--_switch-travel));
}
```

这就是为什么缩放阴影系统也会缩放开关。在 `:root` 上覆盖偏移，滑块就走得更远，它的阴影随之变大，槽也变宽，
于是滑块落点离末端的距离仍然一样：

```css
:root {
  --bn-shadow-x: 8px;
  --bn-shadow-y: 8px;
}
```

### 键盘与焦点

`Tab` 用其它每个控件都得到的顺序焦点到达开关，`Space` 切换它，而焦点环是库的 `outline`——画在粗边框
之外，所以边框吞不掉它；也画在滑块的阴影之外，所以两者永远不会互相盖住。焦点环没有任何一处是开关专属的，
而这正是重点：每一个可聚焦元素共用一个指示器。

### 禁用

禁用的开关保留它的结构与可读的对比度，并停止回应指针：

```html
<p>
  <label for="lan">LAN</label>
  <input id="lan" type="checkbox" role="switch" checked disabled>
</p>
```

### 覆盖它

两个旋钮，两个都不需要逃生舱。写不分层的 CSS 就直接赢，因为库发布的每条规则都在级联层里（ADR-0006）
——见[自定义主题](/zh/customizing)。或者在 `:root` 上改一个令牌：`--bn-main` 重绘打开时的槽，
`--bn-border-width` 连同外框与滑块之间的间隙一起加粗，`--bn-shadow-x` 如上所述地重新缩放滑动与滑块的
阴影，而 `--bn-foreground` 设定静止时滑块的颜色。令牌必须改在 `:root` 上——派生令牌在它被声明的地方就
已经替换完毕，所以写在页面中段某个包裹元素上的同样声明什么也不会改变。
