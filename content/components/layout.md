---
title: "Layout"
description: "A 12-column grid and a centred container, built out of two custom properties and one breakpoint. No semantic element can express a layout, so the classes are the API."
---

A container, a row and twelve column classes. That is the whole layout vocabulary, and the point of
keeping it that small is that a page cannot need a rule this library did not think of: `12` columns,
one breakpoint, and a gap you can retune once.

```html
<div class="bn-container">
  <div class="bn-row">
    <div class="bn-col-8">Two thirds on a wide screen, full width on a phone.</div>
    <div class="bn-col-4">One third next to it.</div>
  </div>
</div>
```

`bn-container` centres a readable column — `max-inline-size` `75rem`, `2rem` of inline padding, and
nothing else. No background, no border, no shadow: a layout is a measurement, not a look.

`bn-row` turns its children into a 12-track grid. `bn-col-1` through `bn-col-12` say how many of
those tracks a child takes, and are meant to add up to twelve per line.

### Breakpoints

There is exactly one breakpoint, and it is **768px** — the same width as `48rem`, because a media
query resolves `rem` against the initial font size of 16px rather than against the page's own font
size. Above it a column spans the tracks its class asks for. At or below it **every** column becomes
the full width of the row, whichever class it carries: on a phone, a three-up card grid becomes a
one-up list without a second class name and without a media query in the page.

That single breakpoint is a deliberate limit rather than an oversight. A responsive column language
(`bn-col-md-6`, `bn-col-lg-4`, …) multiplies twelve classes by the number of breakpoints, and the
utility set is meant to stay small enough to read in one screen. A page that genuinely needs a
different rhythm has two options that cost the library nothing: write its own media query — unlayered
CSS wins over every layer (ADR-0006) — or reach for the four fixed combinations on the Utilities page.

The grid is checked from the narrowest viewport up, so the collapse is a tested claim rather than an
intention: **320, 375, 768, 1024 and 1440** pixels, in real Chrome, asserting that
`document.documentElement.scrollWidth` never exceeds the viewport width and that the column count per
line is what the class asks for. Below 768px every example on this page is one column wide; the two
before it are one column on a phone and a strict two-thirds / one-third split from 768px up.

### Why grid and a custom property per column

Columns are laid out with CSS grid, and each column class carries nothing but `--_span: n`. The family
rule reads that number once:

```css
.bn-row {
  --_span: var(--_grid-columns);
  display: grid;
  grid-template-columns: repeat(var(--_grid-columns), minmax(0, 1fr));
  gap: var(--_grid-gap);
}

:is(.bn-col-1, .bn-col-2, /* … */ .bn-col-12) {
  grid-column: span min(var(--_span), var(--_grid-columns));
  min-inline-size: 0;
}

.bn-col-6 { --_span: 6; }

@media (max-width: 768px) {
  :is(.bn-col-1, .bn-col-2, /* … */ .bn-col-12) { --_span: var(--_grid-columns); }
}
```

The alternative was a flex row whose columns carry a percentage width. Grid wins on three counts that
matter in a documentation site as much as in an application: the gutters are a single `gap`, so no
column has to subtract its share of the gutter from a percentage and rows cannot drift a fraction of
a pixel apart; a column can be forced to shrink below its content (`minmax(0, 1fr)` together with
`min-inline-size: 0`), which is exactly what a long unbreakable token needs; and the whole responsive
behaviour is one media query that touches one declaration, not twelve more rules.

One consequence is worth knowing, because it is inherited rather than obvious. `--_span` cascades, so
a `.bn-row` nested inside a column would inherit its parent's span and lay its own children out across
the parent's columns. The row resets it: a nested row always starts from a clean twelve columns.

### Composing with utilities

The grid and the Utilities page are designed to be used together, and the library never needs a
modifier class per layout: a column is a column, and the utilities only ever nudge what is inside it.
Two habits keep a page honest:

```html
<div class="bn-row">
  <div class="bn-col-12 bn-text-center">A heading centred over a full-width row.</div>
</div>
```

This site's own `/components/` index is the worked example. Its cards are `.bn-col-4` blocks, so they
are three across from 768px up — two at 768px, one on a phone — while their contents use the plain
`site-` classes. The grid is under that load on every page of this site rather than on a single
demonstration page.

### The gap and the hard shadow

`--_grid-gap` defaults to `1.5rem` (24px), and the number is not arbitrary: the largest hard shadow
offset in the library is `--bn-shadow-lg`, 6px at the default 4px base. A gap narrower than that would
let one card's shadow land on its neighbour, which reads as a rendering bug rather than a style. If you
tighten the gap for a dense layout, either raise the gap back above the shadow offset or drop those
cards to a smaller shadow tier with the library's shadow tokens on `:root`.
