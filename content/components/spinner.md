---
title: "Spinner"
description: "The default look of a status region: a bare role=status turns, and it keeps saying loading when motion is reduced."
---

`[role="status"]` is the anchor (spec §8), and its default appearance here is the ring. The two facts
belong together: a status region is a live region, a live region on a page is nearly always saying
"working on it", and so the shape it takes by default is the one that says exactly that. Write the
role and the ring arrives.

```html
<span role="status" aria-label="Loading"></span>
```

The ring is 24 pixels across, so it says nothing at all to a screen reader. Give it a name with
`aria-label` (or, once the Utilities component lands, a visually hidden text child) — but never
visible text, which would burst out of a 24-pixel box. `.bn-spinner` is the same ring as an explicit
class, for the markup you want to read at a glance.

```html
<span role="status" class="bn-spinner" aria-label="Loading the report"></span>
```

### Size and colour

The ring scales with one internal value and the structural border width: its stroke is two thirds of
`--bn-border-width`, so a page that thickens its borders thickens the ring with them. It is a circle —
the library's second deliberate one, after a radio button; a ring is round by meaning, and `--bn-radius`
still governs every box.

`data-variant` colours the moving arc through the same channel as every other component:

```html
<span role="status" aria-label="Loading" data-variant="success"></span>
<span role="status" aria-label="Loading" data-variant="danger"></span>
```

### Reduced motion

The rotation is declared inside a `prefers-reduced-motion: no-preference` block (spec §7), never in a
`reduce` block that stops an animation after the fact. What is left when motion is reduced is a still,
incomplete ring: the arc that is missing is the loading glyph, and the accessible name is the words,
so the element still says "loading" instead of saying nothing at all.

### Sibling: the skeleton

The spinner and the skeleton share the `role="status"` anchor, and `.bn-skeleton` is what tells them
apart: a bare status region is the ring, and a status region with that class is a placeholder. See
[Skeleton](/components/skeleton).

### Overriding it

Unlayered CSS wins over every layered rule the library ships (ADR-0006), so an override needs no
`!important`. Behind that, `--bn-main` is the arc of a plain ring, `--bn-foreground` feeds the track
(a mix of it, so the track flips with the theme), and `--bn-border-width` is the stroke's origin.
Remember to redefine tokens on `:root`: a derived token is substituted where it is declared.
