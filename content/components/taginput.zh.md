---
# 本文件由 scripts/i18n-zh.mjs 从 components/taginput.md 生成，请勿手改；要改译文请改那边。
title: "标签输入"
description: "一个把你打的字变成标签的文本框。一个元素、一个你已经写好的 input，剩下的交给键盘。"
---

`bn-taginput` 增强你已经写好的字段。把 input 给它，把起始标签给它，这个元素就把每一个变成带自己删除
按钮的胶囊——没有 shadow root，没有克隆的 input，没有要你自己生成的标记：

```html
<bn-taginput value="Design, Code">
  <input type="text" placeholder="Add a tag…">
</bn-taginput>
```

在上面的字段里打字，然后按 `Enter` 或 `,`：这段文字变成一个标签。点一个胶囊的 `×`，它就没了。没有脚本
时，同样的标记仍然是一个你能打字的文本框——胶囊是脚本必须提供的那唯一一项能力。

元素起始的列表从两个地方之一读取，顺序是：元素自己的 `value` 属性，然后是字段自己的 `value`。把起始列表
写在 input 上，是关掉脚本的读者仍然看得见的那一种，所以两者之中它更体贴。

### 添加标签

三个手势加的是同一样东西，而三者都经过同一个解析器：

- `Enter` 把字段里的东西提交掉，并清空它。
- `,` 做同样的事，而且它自己永远不会被写进标签。
- 粘贴一列内容会按逗号拆分：所有完整的部分变成标签，只有没写完的尾巴——最后一个逗号之后的那段——留在
  字段里。

每个值都会去掉首尾空白，空值或只有空白的值不算标签，重复的会被丢掉。比较刻意是区分大小写的：`Design` 与
`design` 是两个不同的标签，而一个标识符、一个文件名或一个令牌保留它被打进去时的大小写。顺序保留，所以
列表读回来就是你输入的样子。

### 删除标签

每个胶囊都带一个删除按钮，而删除完全不需要鼠标：

- 点胶囊的 `×`，或者在获得焦点的删除按钮上按 `Enter`；
- 在删除按钮获得焦点时按 `Delete` 或 `Backspace`；
- 在空字段里按 `Backspace`——最后一个标签被删掉，一次一个，直到字段重新变空；
- 在空字段里按 `ArrowLeft` 走进胶囊，在最后一个上按 `ArrowRight` 走回来。`Home` 与 `End` 跳到第一个
  与最后一个删除按钮。

删除之后光标回到字段里，准备收下一个标签。一个胶囊消失时外框什么都不变：边框与内边距只声明一次，没有任何
状态规则碰它们，所以删掉一个标签不会让字段移动一个像素。

### 读写标签

这个元素保存的是列表，不是 DOM，所以 API 就是胶囊所显示的那同一个东西：

```js
const field = document.querySelector('bn-taginput');

field.tags();                          // → ['Design', 'Code']   a copy; mutating it changes nothing
field.setTags(['Design', 'code']);     // → ['Design', 'code']   replaces the whole set
field.setTags('Design, code');         // → ['Design', 'code']   a comma-joined string is a set too
field.addTag('UI');                    // → ['Design', 'code', 'UI']
field.removeTagAt(0);                  // → ['code', 'UI']
field.clearTags();                     // → []
```

| 方法 | 签名 | 作用 |
|---|---|---|
| `tags()` | `→ string[]` | 当前的标签，按顺序。是一份拷贝。 |
| `setTags(value)` | `(string[] \| string) → string[]` | 替换整个集合；返回替换后持有的内容。 |
| `addTag(value)` | `(string) → string[]` | 追加一个值（或一串逗号连接的内容）；重复的会被忽略。 |
| `removeTagAt(index)` | `(number) → string[]` | 删除 0 基索引处的标签；越界是安静的空操作。 |
| `clearTags()` | `() → string[]` | 清空集合。 |

每一次写入都走同一条路：去空白、拆分、丢掉空值、去重，而且它是幂等的——写入字段本来就持有的集合不会渲染
任何东西，也不会宣告任何东西。`value` 属性与列表保持同步，所以 `field.getAttribute('value')` 永远与
`field.tags()` 一致，列表也能从标记里查到。这个属性是状态的*反映*；元素初始化之后，请通过方法来写。

### change 事件

每一次真的改变了东西的变更都只宣告一次，作为一个 `CustomEvent`，像其它每个 barnacle 事件一样冒泡并穿过
shadow 边界：

```js
const field = document.querySelector('bn-taginput');

field.addEventListener('bn:change', (event) => {
  console.log(event.detail.tags, event.detail.added, event.detail.removed, event.detail.source);
});
```

| `detail` 键 | 类型 | 含义 |
|---|---|---|
| `tags` | `string[]` | 变更之后的整个列表，按顺序。 |
| `added` | `string[]` | 这次变更加进来的标签。 |
| `removed` | `string[]` | 这次变更拿走的标签。 |
| `source` | `string` | `'input'`（打字或粘贴）、`'remove'`（胶囊的按钮）、`'backspace'`（空字段上的手势）或 `'api'`（上面某个方法）。 |

空操作是无声的：写入字段本来就持有的集合、在空字段上按 `Enter`，或者在已经没有标签时按 `Backspace`，都
什么也不宣告。

### 禁用

元素上的 `disabled` 会禁用字段与每一个删除按钮，而外框与文字保持对比度——禁用的字段仍然可读，而不是淡成
一个幽灵：

```html
<bn-taginput value="Design, Code" disabled>
  <input type="text" placeholder="Add a tag…">
</bn-taginput>
```

从脚本里切换这个属性会被观察到，所以字段与胶囊两个方向都会跟随它。

### 没有 JavaScript 时

这个元素的样式表不依赖脚本：字段盒子、它的焦点环，以及 input 在其中的位置，全都由 CSS 决定。没有脚本时你
得到一个带同样外框的普通文本框，而标签就作为文本留在作者写在 input 上的那个样子。丢掉的只是胶囊的行为，
而且仅此而已。

### 覆盖它

这里没有任何一条规则自带颜色或距离：外框读 `--bn-border-width` 与 `--bn-radius`，表面读
`--bn-secondary-background`，静止阴影读 `--bn-shadow-sm`（与表单字段静止时同一小档），焦点环读
`--bn-ring`。你自己写的不分层 CSS 赢过库发布的每条规则，所以覆盖不需要 `!important`——见
[自定义主题](/zh/customizing)——并记得把令牌改在 `:root` 上，因为派生令牌在它被声明的地方就已经替换完毕。
