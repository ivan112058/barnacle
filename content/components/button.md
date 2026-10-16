---
title: "Button"
description: "The bare button element, dressed by default. The .bn-button class is the opt-in shape for anchors and spans, which have no way to say that they are buttons."
---

Barnacle dresses the `button` element you already write, so correct markup is the default instead of
something you opt into (ADR-0001). The class covers the other direction: an `<a>` or a `<span>` has
no attribute that says "I am a button", so `.bn-button` is how one takes the shape. A bare link
stays a link — underlined, flat, never lifted — which is the entire point of the split.

```html
<button type="button">Save changes</button>
<button class="bn-button" type="button">The same button, written with the class</button>
<a class="bn-button" href="#button-demo">An anchor wearing .bn-button</a>
```

None of that is styled by the page: the shape, the colours and the hard shadow all come from the
library, and the whole thing keeps its appearance with JavaScript switched off.

### Variants

Meaning is an attribute, never a class. `data-variant` accepts `success`, `warning` and `danger`
(`error` is an alias for `danger`), plus `secondary` for the hierarchy case rather than a colour
one. A variant repaints the surface and the ink on top of it and touches nothing else — the border,
the hard shadow and every box metric stay exactly where they were, so a variant can never reflow a
grid.

### Appearance

Everything that is shape rather than meaning is a class, and the two axes compose freely.
`.bn-outline` trades the fill for a border and ink in the current semantic colour and drops the
shadow a tier; `.bn-ghost` removes fill, border, shadow and displacement altogether; `.bn-sm` and
`.bn-lg` change the size, with the default being the absence of a class; `.bn-icon` squares a button
up around a single glyph; and `.bn-button-group` lays buttons out in a row, where `.bn-attached`
pulls the borders over each other so the group reads as one bar. Being disabled is the element's own
state — `disabled`, or `aria-disabled="true"` when the control cannot use it — and not a fourth
class.

```html
<button type="button" data-variant="success">Saved</button>
<button type="button" data-variant="warning">Careful</button>
<button type="button" data-variant="danger">Delete</button>
<button type="button" data-variant="secondary">Cancel</button>

<button type="button" class="bn-outline">Outline</button>
<button type="button" class="bn-outline" data-variant="danger">Outline, in danger</button>
<button type="button" class="bn-ghost">Ghost</button>

<button type="button" class="bn-sm">Small</button>
<button type="button" class="bn-lg">Large</button>
<button type="button" disabled>Disabled</button>

<menu class="bn-button-group">
  <button type="button">One</button>
  <button type="button">Two</button>
  <button type="button">Three</button>
</menu>
```

### Interaction

Hovering lifts the button up and to the left by `--bn-shadow-lift` while the hard shadow grows by
exactly the same amount, so the shadow keeps its place on the page and the button appears to rise
off it. Pressing falls by `--bn-press` and collapses the shadow underneath. The focus ring is an
`outline` rather than a second shadow, so it cannot swallow the hard shadow and a thick border
cannot swallow it. Only the colours change between states — the border keeps its width, because a
border that grows on hover reflows the whole grid. And the transition is only declared where the
visitor has not asked for reduced motion.

```css
/* src/css/button.css, trimmed to the parts that matter. No number appears in the file: every
   displacement, shadow tier, ring and duration is a slot declared once in 00-base.css. */
:is(button, .bn-button) {
  border-width: var(--bn-border-width);
  border-color: var(--_border-rest);
  box-shadow: var(--_shadow-rest);
}

@media (hover: hover) {
  :is(button, .bn-button):hover {
    transform: translate(var(--_lift-x), var(--_lift-y));
    box-shadow: var(--_shadow-hover);
    border-color: var(--_border-hover);      /* colour only — never a width */
  }
}

:is(button, .bn-button):active {
  transform: translate(var(--_press-x), var(--_press-y));
  box-shadow: var(--_shadow-press);
}

:is(button, .bn-button):focus-visible {
  outline: var(--_focus-ring);
  outline-offset: var(--_focus-ring-offset);
}

@media (prefers-reduced-motion: no-preference) {
  :is(button, .bn-button) {
    transition: transform var(--_motion), box-shadow var(--_motion);
  }
}
```

### Overriding it

Two knobs, and neither needs `!important`. Write unlayered CSS and it wins outright, because every
rule the library ships sits in a cascade layer (ADR-0006). Or change a token on `:root`:
`--bn-main` repaints the default button, `--bn-shadow-x` rescales every shadow tier and the hover
lift together, and `--bn-press` sets how far the button drops. Tokens have to be overridden on
`:root` specifically — a derived token is substituted where it is declared, so the same declaration
on some wrapper in the middle of the page changes nothing.
