---
title: "Table"
description: "The bare table element, dressed by default: one line per seam, a saturated header band, and one documented wrapper that stops a wide table from widening the page."
---

Barnacle dresses the `table`, `thead`, `tbody`, `tfoot`, `th` and `td` elements you already write, so
a table is a table without a class (ADR-0001). The only markup the library cannot supply is the
scroll container — and the numbers column, because HTML has no way to say "this column is numeric".

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

### Wide tables

A `<table>` is not a block container, so `overflow` does not apply to it: a table wider than the
page widens the page instead of scrolling. No rule inside the library can change that — the scroll
container is markup, and there are exactly two shapes for it. A `figure` that directly contains the
table gets it by element, because a captioned table *is* a figure; markup with no semantic wrapper
to use (a table inside a card, a section, a `div` that is already there) uses `.bn-table-scroll` on a
plain `div`:

```html
<figure>
  <table>…</table>
  <figcaption>…</figcaption>
</figure>

<div class="bn-table-scroll">
  <table>…</table>
</div>
```

Both become the horizontal scroll container, and both leave room at the end for the table's hard
shadow rather than cutting it off. At desktop width a table that fits does not scroll; on a phone
the page stays exactly as wide as the viewport and the table scrolls inside its wrapper.

### One line per seam

The frame is the table's own border, and each cell paints only its block-start and inline-start
edge, so an interior seam is painted by exactly one of the two cells that meet there. That is what
keeps a seam one line wide instead of two, and it is why the first row and the first column give
their start edges up: the frame already owns those.

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

With `border-collapse: collapse` the same grid would be resolved by the user agent's border-conflict
rules instead — a single line as well, but one whose width and owner are decided elsewhere, split
between the two cells, and impossible to measure from the boxes. The separated model also keeps a
per-cell shadow and a sticky header border intact.

### Header and rows

The header row is emphasis added, never contrast removed: it is filled with `--bn-main`, set in the
display face at the heading weight, and kept on one line, while the body keeps the page's own ink on
the page's own surface at full strength. A row header inside the body (`<th scope="row">`) keeps the
heading weight on the body's surface, so the header band stays the only band.

Hovering a body row tints it, and a row marked `.bn-selected` keeps that tint. Selection is the
page's state and the class only paints it — `aria-selected` is meaningful on a row inside a `grid`
or a `treegrid`, not on a row of a plain table, so there is no attribute to reach for. Neither state
touches a border width, a padding or any other box metric: a row can never reflow the grid by being
hovered, focused or selected.

### Numbers

Text columns align to the start, always. A numeric column carries `.bn-num` on its header cell and
on every cell of the column, which aligns the column to the end and switches it to tabular figures
so the digits line up even when their widths differ:

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

The class goes on the cells rather than on a `<col>` on purpose: a table column hands its
declarations down to its cells for backgrounds and widths, but not `text-align` — measured in
Chrome, a `<col class="bn-num">` aligns nothing.

### At a glance

| Name | Where it goes | What it does |
| --- | --- | --- |
| `.bn-num` | the header cell and every cell of a numeric column | aligns that column to the end of the line, in tabular figures |
| `.bn-table-scroll` | a `div` around the table, when there is no `figure` to use | makes that `div` the horizontal scroll container |
| `.bn-selected` | a `tr` | paints a selected row; the page owns the state |

Everything else is an element: `table`, `thead`, `tbody`, `tfoot`, `caption`, `th`, `td`.

### Overriding it

Two knobs, and neither needs `!important`. Write unlayered CSS and it wins outright, because every
rule the library ships sits in a cascade layer (ADR-0006) — see [Customizing](/customizing). Or
change a token on `:root`: `--bn-border-width` thickens the frame and every seam with it,
`--bn-border-color` recolours both, `--bn-main` repaints the header band, and `--bn-shadow-x`
rescales the shadow tiers and the room the wrapper keeps for them. Tokens have to be overridden on
`:root` specifically — a derived token is substituted where it is declared, so the same declaration
on some wrapper in the middle of the page changes nothing.
