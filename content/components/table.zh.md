---
# 本文件由 scripts/i18n-zh.mjs 从 components/table.md 生成，请勿手改；要改译文请改那边。
title: "表格"
description: "裸 table 元素，默认就被装扮好：每条接缝只画一条线，一条饱和的表头带，以及一个写在文档里的包裹元素，用来阻止宽表格把页面撑宽。"
---

Barnacle 装扮你已经在写的 `table`、`thead`、`tbody`、`tfoot`、`th` 与 `td` 元素，所以表格不加类就是
表格（ADR-0001）。库唯一供不出的标记是滚动容器——以及数字列，因为 HTML 没有办法说「这一列是数字」。

```html
<figure>
  <table>
    <caption>Revenue by region</caption>
    <thead>
      <tr>
        <th scope="col">Region</th>
        <th scope="col">City</th>
        <th scope="col">Beds</th>
        <th scope="col">Occupancy</th>
        <th scope="col" class="bn-num">Revenue in thousands</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <th scope="row">North</th>
        <td>Oslo</td>
        <td>1,204</td>
        <td>82%</td>
        <td class="bn-num">3,917</td>
      </tr>
      <tr>
        <th scope="row">South</th>
        <td>Lisbon</td>
        <td>980</td>
        <td>74%</td>
        <td class="bn-num">2,184</td>
      </tr>
      <tr>
        <th scope="row">East</th>
        <td>Kyiv</td>
        <td>1,733</td>
        <td>88%</td>
        <td class="bn-num">4,102</td>
      </tr>
    </tbody>
    <tfoot>
      <tr>
        <th scope="row">Total</th>
        <td></td>
        <td>3,917</td>
        <td></td>
        <td class="bn-num">10,203</td>
      </tr>
    </tfoot>
  </table>
  <figcaption>Figures are in thousands of euros.</figcaption>
</figure>
```

### 宽表格

`<table>` 不是块级容器，所以 `overflow` 对它不适用：比页面宽的表格会把页面撑宽，而不是自己滚动。库里的
任何规则都改变不了这一点——滚动容器是标记，而它恰好只有两种形状。直接包住表格的 `figure` 靠元素就得到
它，因为一张带标题的表格*本来*就是 figure；没有语义包裹元素可用的标记（卡片里的表格、section 里的表格、
已经存在的 `div` 里的表格）则在普通的 `div` 上用 `.bn-table-scroll`：

```html
<figure>
  <table>…</table>
  <figcaption>…</figcaption>
</figure>

<div class="bn-table-scroll">
  <table>…</table>
</div>
```

两者都变成水平滚动容器，而且都在末端留出表格硬阴影的地方，而不是把它裁掉。在桌面宽度下，放得下的表格不
滚动；在手机上，页面宽度恰好等于视口，表格在它的包裹元素里滚动。

### 每条接缝一条线

外框是表格自己的边框，而每个单元格只画块首与行首的那条边，所以一条内部接缝只由在那里相遇的两个单元格中
的一个来画。这就是让接缝只有一条线宽而不是两条线的原因，也是第一行与第一列让出自己起始边的理由：外框已经
拥有那些了。

```css
table {
  border-collapse: separate;
  border-spacing: 0;
}

th,
td {
  border-block-start: var(--bn-border-width) solid var(--bn-border-color);
  border-inline-start: var(--bn-border-width) solid var(--bn-border-color);
}
```

如果用 `border-collapse: collapse`，同一套网格会改由用户代理的边框冲突规则来解析——也还是一条线，但那
一条的宽度与归属在别处决定，在两个单元格之间劈开，而且无法从盒子里量出来。分离模型还让逐单元格的阴影和
粘性表头的边框保持完整。

### 表头与行

表头行是加上去的强调，从来不是减掉的对比：它用 `--bn-main` 填满，用展示字体按标题字重排，并保持在一行
里；而表体在页面自己的表面上、用页面自己的墨色、以满强度呈现。表体里的行表头（`<th scope="row">`）在表体
的表面上保留标题字重，所以表头带仍然是唯一的一条带。

悬停表体的一行会把它微微染色，而标了 `.bn-selected` 的行会保留这层染色。选中是页面的状态，这个类只负责把
它画出来——`aria-selected` 在 `grid` 或 `treegrid` 里的行上才有意义，在普通表格的行上没有，所以没有属性
可以抓。两种状态都不碰边框宽度、内边距或任何别的盒模型尺寸：一行永远不会因为被悬停、被聚焦或被选中而让
网格重排。

### 数字

文本列永远向起始端对齐。数字列在表头单元格以及这一列的每一个单元格上带 `.bn-num`，它把整列对齐到末端，
并切换到等宽数字，于是即使数字宽度不同也对得齐：

```html
<tr>
  <th scope="col">City</th>
  <th scope="col" class="bn-num">Revenue</th>
</tr>
<tr>
  <td>Oslo</td>
  <td class="bn-num">3,917</td>
</tr>
```

这个类故意加在单元格上而不加在 `<col>` 上：表格列会把它的声明下传给单元格，对背景和宽度成立，但对
`text-align` 不成立——在 Chrome 里实测，`<col class="bn-num">` 什么也没对齐。

### 一览

| 名称 | 加在哪里 | 做什么 |
| --- | --- | --- |
| `.bn-num` | 表头单元格，以及数字列的每一个单元格 | 把那一列对齐到行末，用等宽数字 |
| `.bn-table-scroll` | 没有 `figure` 可用时，包住表格的那个 `div` | 让那个 `div` 成为水平滚动容器 |
| `.bn-selected` | 一个 `tr` | 画出一行被选中的样子；状态归页面所有 |

别的都是元素：`table`、`thead`、`tbody`、`tfoot`、`caption`、`th`、`td`。

### 覆盖它

两个旋钮，两个都不需要 `!important`。写不分层的 CSS 就直接赢，因为库发布的每条规则都在级联层里
（ADR-0006）——见[自定义主题](/zh/customizing)。或者在 `:root` 上改一个令牌：`--bn-border-width` 连同
每一条接缝一起加粗外框，`--bn-border-color` 给两者重新上色，`--bn-main` 重绘表头带，而 `--bn-shadow-x`
重新缩放各档阴影，也重新缩放包裹元素为它们留出的空间。令牌必须改在 `:root` 上——派生令牌在它被声明的地方
就已经替换完毕，所以写在页面中段某个包裹元素上的同样声明什么也不会改变。
