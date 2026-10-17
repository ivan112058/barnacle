---
title: "Utilities"
description: "Twenty single-purpose classes: text alignment, screen-reader-only content, four layout combinations, a four-step spacing scale, sizing and one muted text colour. Bounded on purpose."
---

The utilities are the smallest part of the library and the easiest to overgrow, so they are capped at
twenty classes in five groups. A utility here is a decision that is worth repeating ("centre this",
"push that away by one step"), never a property that gets a class per value.

```html
<p class="bn-text-center">Centred text.</p>
<ul class="bn-list-none">
  <li>No marker, no invented indent.</li>
</ul>
```

### Text alignment

`.bn-text-start`, `.bn-text-center`, `.bn-text-end`. Logical values rather than `left` and `right`, so
a right-to-left page needs no extra rule.

### Screen-reader only

`.bn-visually-hidden` is the one accessibility utility, and the only class in the library that makes
something invisible. It keeps the content in the accessibility tree and keeps it focusable, which is
what `display: none` and `visibility: hidden` both throw away: use it for a control's label when the
visible text is an icon, or for a heading that structures the page for a screen reader without
appearing on it.

### Layout combinations

Four fixed arrangements, each a single decision rather than a set of properties:

`.bn-stack` puts children in a column with one gap between them; `.bn-cluster` wraps them in a row and
centres them on the cross axis; `.bn-center` centres a single thing both ways; `.bn-between` pushes the
first and last child apart. `bn-stack`, `bn-cluster` and `bn-between` read their gap from
`--_stack-gap` if you set it, and otherwise use their own default.

For anything with columns, reach for the grid on the Layout page instead — `bn-col-*` carries the
measurement, and these four only arrange what is inside it.

```html
<div class="bn-between">
  <span>A label</span>
  <span>A value</span>
</div>
```

### Block spacing

Eight classes: four steps in two directions. `.bn-mt-2`, `.bn-mt-4`, `.bn-mt-8`, `.bn-mt-16` and their
`.bn-mb-2`, `.bn-mb-4`, `.bn-mb-8`, `.bn-mb-16` counterparts, mapping to `0.5rem`, `1rem`, `2rem` and
`4rem`. The numbers are the scale, not pixel counts: `2 / 4 / 8 / 16` is a doubling ladder, and a page
that needs `0.7rem` between two elements is a page writing its own margin.

They set `margin-block-start` and `margin-block-end`, so they work the same way in every writing mode.

### Sizing and text

`.bn-w-full` makes an element fill its container's inline size. `.bn-truncate` keeps it to one line and
ends it with an ellipsis — and because it also resets the automatic minimum size, it works inside a
flex or grid item rather than overflowing it.

`.bn-list-none` removes both the list marker and the start padding a markerless list would keep, which
makes it the clearest example of the layer rule below.

`.bn-text-muted` de-emphasises text by deriving the colour from `--bn-foreground`, so it flips with the
theme instead of turning into an invisible grey on a dark background.

### The boundary

Twenty classes, and the line is drawn in three places.

No numeric axis beyond the four spacing steps. No responsive prefixes at all: a `bn-md-*` family would
be this list multiplied by the number of breakpoints, and a page that needs a breakpoint already has
the grid or its own media query. And no colour, border or shadow: those are the library's visual
modifiers — `.bn-outline`, `.bn-ghost`, `.bn-sm`, `.bn-lg`, `.bn-attached`, `.bn-icon` — and a utility
that shared one of those names would silently redefine a component's shape rather than nudge it.

### Why they win, and how to win over them

Every rule in the library sits in a cascade layer, and `utilities` is the last one (ADR-0006). A
utility therefore beats a component or a base rule inside the library without `!important` and without
a specificity argument — `.bn-list-none` overriding `ul { list-style: square }` is the same mechanism,
not a special case.

The same ADR points the other way for you: **unlayered CSS wins over every layer.** A stylesheet
loaded after the library's, with no `@layer` in it, overrides any of these classes — or any component —
without `!important`. That is why none of these twenty classes needs one either.
