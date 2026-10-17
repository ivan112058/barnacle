---
title: "Alert"
description: "A live region dressed by role alone: write role=alert, and the colour bar, the border and the hard shadow are already there."
---

`[role="alert"]` is the anchor (spec §8). HTML has no element for "tell the visitor about this now",
and the role is also what makes a screen reader announce the message the moment it appears — so the
alert is dressed by the role itself, on whatever element carries the message.

```html
<div role="alert">
  <p>Saved. Your changes are live.</p>
</div>
```

The anchored element is a `div` here because an alert is usually inserted as a whole block, but
nothing in the stylesheet requires one: any element with the role gets the same shape. The bar on the
inline-start side is twice the structural border width and never changes while the message is on
screen — an alert does not press, hover or reflow.

### Meaning

`data-variant` carries the meaning: `success`, `warning` and `danger` (`error` is an alias) turn the
bar, the border and the hard shadow the semantic colour, and no class is involved. An alert with no
variant — or with a variant name the library does not know — is drawn in the page's own ink, which is
the same rule every other component follows.

```html
<div role="alert" data-variant="success">
  <p>Saved. Your changes are live.</p>
</div>

<div role="alert" data-variant="warning">
  <p>Two fields are missing. The draft was kept.</p>
</div>

<div role="alert" data-variant="danger">
  <p>The import failed. Nothing was changed.</p>
</div>
```

`.bn-solid` is the loudest shape: the whole notice is filled with the current colour, with the page's
dark ink on top. The five accents from the card page (`.bn-pink`, `.bn-blue`, `.bn-green`, `.bn-orange`,
`.bn-lavender`) work here as well, because an accent is appearance rather than meaning.

```html
<div role="alert" class="bn-solid" data-variant="success">
  <p>Saved. Your changes are live.</p>
</div>

<div role="alert" class="bn-pink">
  <p>An alert in an accent colour rather than a semantic one.</p>
</div>
```

### Arrival and reduced motion

An alert fades and rises into place, and that animation is declared inside a
`prefers-reduced-motion: no-preference` block rather than switched off afterwards: a visitor who
asked for less motion gets no animation rule at all, so the message is simply there — announced,
readable, and never faded in from nothing (spec §7). The rise uses `translateY`, not `transform`, so
it can never fight the geometry that hover and press own.

### Overriding it

Unlayered CSS of your own beats every layered rule the library ships (ADR-0006), and no `!important`
is needed to say so. Behind that: `--bn-secondary-background` is the surface, `--bn-border-width` the
frame (the bar is twice it), `--bn-radius` the corner, and `--bn-shadow-x` / `--bn-shadow-y` the
shadow. Redefine tokens on `:root` — a derived token is substituted where it is declared, so a
declaration on a wrapper in the middle of the page changes nothing.
