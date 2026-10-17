---
# 本文件由 scripts/i18n-zh.mjs 从 components/dialog.md 生成，请勿手改；要改译文请改那边。
title: "对话框"
description: "原生的模态对话框，装扮好了：浏览器顶层里一块硬边外框，一层来自单个令牌的遮罩，而且开与关都不需要脚本。"
---

对话框就是原生 `dialog` 元素，被装扮过了。模态需要的一切平台里本来就有：`showModal()` 把元素挪进
浏览器的顶层，浏览器在 `::backdrop` 后面把页面其余部分压暗并挡住，把焦点移进去，在对话框打开期间把
焦点留在里面，关闭时再把它交回给打开对话框的那个东西。Barnacle 加上外框——页面自己的表面、承重边框，
以及最大的一档硬阴影——然后就停手了。

```html
<button type="button" class="bn-button" commandfor="dlg-invite" command="show-modal">Invite someone</button>

<dialog id="dlg-invite">
  <h3>Invite someone</h3>
  <p>They get an email with a link that expires in 24 hours.</p>
  <form method="dialog">
    <button type="button" class="bn-button" command="close" commandfor="dlg-invite">Cancel</button>
    <button type="submit" class="bn-button" autofocus>Got it</button>
  </form>
</dialog>
```

点 **Invite someone**：对话框接管视口，后面的页面变暗。有三样东西能关掉它，而且都不需要脚本。**Cancel**
按钮带着 `command="close"`，`commandfor` 指向这个对话框；**Got it** 按钮是 `<form method="dialog">` 里
的一个提交按钮，它关闭对话框并把按钮的 `value` 复制进 `dialog.returnValue`；而 Escape 是浏览器自己的。
表单里那个提交按钮是唯一一种还顺带把答案带回页面的关闭方式，这就是为什么即使没东西要提交，动作那一行也
是一个表单。

打开与关闭都是普通按钮上的声明式属性，所以这个示例在预览面板里也能用，那里 `script` 元素是惰性的。
`command` 与 `commandfor` 是这个模式的现代写法；在比它们更早的浏览器里，触发器按钮干脆没有作用，而同一个
对话框可以从代码里用 `dialog.showModal()` 打开。从代码打开，是打开那种没有面向作者的按钮的对话框的方式
——首次访问提示、由处理器决定的确认框。

### 焦点进去，再回来

打开模态会把焦点移进对话框。浏览器的默认是文档顺序里第一个可聚焦元素，而 `autofocus` 会盖过它：在上面的
示例里 **Cancel** 排在最前，但拿到焦点的仍然是 **Got it**。这条约定值得写下来——把 `autofocus` 放在你
希望获得焦点的那个按钮上，通常是安全的那个，而不是靠碰巧哪个元素排第一。

关闭——通过表单、通过 `command="close"`，或者通过 Escape——会把焦点还给它打开之前持有焦点的那个元素。
触发器通常就是那个元素，这才让这趟往返感觉像什么都没发生。对话框打开期间，焦点不能用 Tab 逃出去：模态把
键盘关在自己里面，直到它被关闭。

### 没有 JavaScript 时

```html
<dialog open>
  <h3>Open by default</h3>
  <p>An <code>open</code> dialog is in the document flow: no top layer, no overlay, no focus trap.</p>
</dialog>
```

`open` 属性是这个元素唯一的状态，所以页面可以在服务端渲染一个对话框，并在不写一行脚本的情况下把它显示
出来。它不是模态——没有遮罩、没有焦点陷阱——而且它和模态用同一副外框画出来：边框、页面表面、最大的一档
阴影。打开的对话框在文档流里占位，所以它后面的段落落在它下面，而不是滑到它底下。

没有 `open` 的 `<dialog>` 是 `display: none`。它的内容根本不会被渲染，所以标记里触发器与对话框是兄弟关系
而不是嵌套关系：写在打开它的那个块里的对话框，关闭时继承那个块的布局，打开时什么也不继承。

### 遮罩

`::backdrop` 由 `--bn-overlay` 画出来，80% 的黑，而且不随暗色主题重新调校。这是刻意的：在暗色页面上，
负责区分的是外框，不是那层幕布。在 Chrome 里对着合成后的遮罩实测，真正要紧的两个数字是对话框的表面与它
的墨色：

| 主题 | 表面 vs 被遮住的页面 | 墨色（边框与阴影）vs 被遮住的页面 |
|---|---|---|
| 亮色 | 12.5 : 1 | 1.7 : 1 |
| 暗色 | 1.2 : 1 | 20.0 : 1 |

于是亮色主题靠表面来做区分，暗色主题靠边框与硬阴影来做区分；在两套主题里，承担区分的那一对都过了 3:1 的
非文本下限。没有开关要拨，也没有东西要配置。

因为模态活在顶层，任何祖先的 `overflow` 或 `z-index` 都裁不到它，对话框自己也就不需要 `z-index`。这也意味
着对话框不会随页面滚走：它自己的内容在它内部滚动，高度上限是视口高度。

### 减少动效

入场——对话框升起、遮罩在它下面淡入——声明在 `prefers-reduced-motion: no-preference` 块里，所以要求减少
动效的访客拿到的不是一段被停用的动画，而是那条规则干脆不存在。对话框瞬间打开、完全不透明，遮罩以满强度
出现。外观没有任何一处依赖于动画是否跑过。

### 覆盖它

不分层的 CSS 直接赢，就像它对库发布的每条规则都赢一样（ADR-0006）。在那之后，槽位是令牌：
`--bn-background` 是表面，`--bn-border-color` 与 `--bn-border-width` 是外框，`--bn-shadow-lg` 是漂浮档，
`--bn-overlay` 是那层幕布，而 `--bn-transition` 是升起与淡入各自的时长。要覆盖就在 `:root` 上覆盖，不要在
包裹元素上——派生令牌在它被声明的地方就已经替换完毕，所以写在容器上的 `--bn-overlay` 能到达 backdrop，但
写在容器上的 `--bn-shadow-x` 不会重新缩放那一档。
