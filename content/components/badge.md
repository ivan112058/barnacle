---
title: "Badge"
description: "A small label with no element of its own: .bn-badge is the one anchor HTML cannot supply."
---

`.bn-badge` is the anchor, and it is a class because there is nothing else it could be (ADR-0001). A
status chip, a count, a category tag — HTML has no element for any of them, and the nearest
candidates all mean something else, so the badge is the case the class name was reserved for. It
lives on a `span`.

```html
<p>
  Status: <span class="bn-badge">Draft</span>
  <span class="bn-badge" data-variant="success">Passing</span>
  <span class="bn-badge" data-variant="warning">Needs review</span>
  <span class="bn-badge" data-variant="danger">Failing</span>
</p>
```

A badge is a label, not a control. It sits one shadow tier below a button (ADR-0003: not every object
carries the same weight) and it does not move — hovering one does nothing, and the border width never
changes, so a row of badges cannot reflow under the pointer.

### Meaning and appearance

`data-variant` carries meaning, exactly as it does everywhere else: `success`, `warning` and `danger`
(`error` is an alias), plus `secondary` for the case that is a hierarchy rather than a colour — a
draft badge is quieter than a passing one, but it is not "grey-meaning-something". Shapes are
classes: `.bn-solid` fills the badge with the current colour, `.bn-outline` trades the fill for
coloured ink and a coloured border, and `.bn-sm` / `.bn-lg` change the size without touching the
border box.

```html
<p>
  <span class="bn-badge">Default</span>
  <span class="bn-badge" data-variant="secondary">Draft</span>
  <span class="bn-badge bn-solid" data-variant="success">Solid</span>
  <span class="bn-badge bn-outline" data-variant="danger">Outline</span>
  <span class="bn-badge bn-sm">Small</span>
  <span class="bn-badge bn-lg">Large</span>
</p>
```

The five accent classes from the card page work here too — `.bn-pink`, `.bn-blue`, `.bn-green`,
`.bn-orange` and `.bn-lavender` — because an accent is appearance and appearance is not the badge's
business to own.

### One colour for the border and the shadow

A badge that carries a colour draws its border and its hard shadow in that colour, one tier down from
the card and by the same mechanism: the colour is republished as `--bn-shadow-color` and the sm shape
is restated from `--bn-shadow-x` and `--bn-shadow-y`. A badge with no colour of its own keeps
`--bn-shadow-sm`, byte for byte, and `secondary` deliberately stays structural — it is a hierarchy,
not a colour.

### In a link

A badge inside a link takes the page's accent on hover, so a tag list reads as one object rather than
a row of chips floating inside a highlight. Link badges are the reason the rule exists; nothing else
changes on hover.

```html
<p>
  <a href="/components/card">Cards <span class="bn-badge" data-variant="success">Ready</span></a>
</p>
```

### Overriding it

Write unlayered CSS and it wins over every layered rule in the library (ADR-0006) — no `!important`
anywhere. Or move a token on `:root`: `--bn-secondary-background` is the surface, `--bn-border-color`
the border and the shadow colour when no variant is in play, and `--bn-radius` the corner. Tokens
have to be redefined on `:root` specifically, because a derived token is substituted where it is
declared rather than where it is used.
