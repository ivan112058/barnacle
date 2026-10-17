---
# 本文件由 scripts/i18n-zh.mjs 从 components/progress-meter.md 生成，请勿手改；要改译文请改那边。
title: "进度与计量"
description: "两个裸元素共用一套槽与填充：progress 表示正在进行的工作，meter 表示已知范围内的一个测量值。"
---

`progress` 与 `meter` 是两个元素、一个组件。Barnacle 给它们同一套槽——同样的边框、同样的圆角、同样的
轨道、同样的填充——因为它们本来就是这样：一条带边框的横条，里面装着东西。不同的是填充从哪里来，而那个
差别是浏览器的事，不是你的。写上元素，把数字放进它本来为之发明的那个属性里。

```html
<!-- work in flight: how far along a job is -->
<progress value="72" max="100">72%</progress>

<!-- a measurement in a range: how full a tank is, given what full means -->
<meter value="0.72" min="0" max="1" low="0.25" high="0.75" optimum="1">72%</meter>
```

两行里都没有出现类名（ADR-0001）。`value` 与 `max` 是 `progress` 的全部 API；`min`、`max`、`low`、
`high` 与 `optimum` 是 `meter` 的全部 API。槽保持自己的宽度，里面那截填充在长，所以一条从 3% 走到 97%
的横条，永远不会让它所在的栅格重排。

### 不知道何时结束的工作

没有 `value` 属性的 `progress` 元素不是「在零」——而是一件没人知道有多大的工作。Barnacle 不让那个状态
读成一个空槽：横条换成主色并长出一层斜向排线，而当访客接受动效时，排线在爬。

```html
<progress>Working…</progress>
```

爬动声明在 `@media (prefers-reduced-motion: no-preference)` 里，所以要求减少动效的访客看到的是同一条
排线横条静静地停着，而不是一条消失的横条、或者一件看起来卡死的工作。外观别的地方都不变：这里的去除是规则
的缺席，而不是事后把动效关掉的规则。

### 状态颜色

`progress` 通过 `data-variant` 承担含义，和提示条、按钮完全一样：`success`、`warning` 与 `danger` 重绘
填充，而 `error` 是 `danger` 的可用别名。

```html
<progress value="100" max="100" data-variant="success">Uploaded</progress>
<progress value="64" max="100" data-variant="warning">Retrying</progress>
<progress value="18" max="100" data-variant="danger">Failed</progress>
```

变体只花在填充上，别处都不花——不在边框上、不在高度上、也不在宽度上——所以切换它永远不会挪动周围任何
东西。没有变体，或者名字是库不认识的，填充就是 `--bn-main`。

### 计量条的三档

`meter` 不需要变体，因为它的含义已经在标记里了。`low`、`high` 与 `optimum` 告诉浏览器范围内哪一段是
好的，引擎再按解析出的值挑档：最优是绿，次优是警告橙，更差是危险红。三者都来自 `data-variant` 用的同一套
语义令牌，所以两个轴永远不会在「危险长什么样」上打架。

```html
<meter value="90" min="0" max="100" low="30" high="60" optimum="100">Battery: 90%</meter>
<meter value="45" min="0" max="100" low="30" high="60" optimum="100">Battery: 45%</meter>
<meter value="12" min="0" max="100" low="30" high="60" optimum="100">Battery: 12%</meter>
```

有 `data-variant` 参与时，变体赢过档位，而这正是你想要的——当这条横条讲的是状态而不是测量值时：一条 12%
的队列被涂上 `data-variant="warning"`，读作「留意这里」，而不是「这个范围本来会挑的那一档」。

### 覆盖它

两个元素的结构都来自与库其它部分相同的令牌，所以常规的那些旋钮都适用，而且一个都不需要 `!important`。
写不分层的 CSS 就直接赢，因为库发布的每条规则都在级联层里（ADR-0006）——[使用方式页](/zh/usage)展示了
两种覆盖方式。或者在 `:root` 上改一个令牌：`--bn-border-width` 加粗外框，`--bn-main` 给默认填充和不确定
态的排线重新上色，而 `--bn-radius` 打破库在其他地方坚持的方角。令牌必须改在 `:root` 上：派生令牌在它被
声明的地方就已经替换完毕，所以写在页面中段某个包裹元素上的同样声明什么也不会改变。
