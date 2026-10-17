---
title: "Card"
description: "A bare article is a card, and a card that carries a colour paints its border and its hard shadow with it."
---

`article` is the anchor. A card is a self-contained piece of a document, which is what HTML's own
sectioning element already means, so Barnacle dresses the element rather than inventing `.bn-card`
(ADR-0001). Write the markup you would write anyway and the padding, the structural border, the
second surface and the hard shadow arrive with it.

```html
<article>
  <h3>Ship the release</h3>
  <p>One bare article, dressed by the library and nothing else.</p>
</article>
```

A card does not move. It is a container rather than a control, so it never lifts on hover and never
presses, however many cards share a grid. Hover geometry belongs to the things you can pick up.

### Meaning and appearance

Two axes, and they never mix (spec §3 invariant 4). Meaning rides `data-variant` — `success`,
`warning`, `danger` (`error` is an alias) — and a card that names one is painted in that semantic
colour without a single class. Everything that is shape rather than meaning is a `bn-` class: the
five accents say what a card *looks like*, not what it means, and they work on a badge or an alert
too.

```html
<article data-variant="danger">
  <h3>Deleted</h3>
  <p>Meaning: this card is in the danger state.</p>
</article>

<article class="bn-pink">
  <h3>Pink</h3>
  <p>Appearance: the card is pink, whatever pink means to you.</p>
</article>

<article class="bn-green">
  <h3>Green</h3>
  <p>The same shape in another accent.</p>
</article>
```

### One colour for the border and the shadow

A card that carries a colour of its own draws its border *and* its hard shadow in that colour. That is
the reason `--bn-shadow-color` exists as a token of its own rather than as an alias for
`--bn-border-color` (spec §6.1), and it is worth knowing how it works, because the obvious spelling
does not:

```css
/* What does NOT work: the shadow keeps the page's ink. */
article.bn-pink {
  border-color: var(--bn-pink);
  --bn-shadow-color: var(--bn-pink);   /* inert on its own */
}

/* What the library does: republish the colour and re-derive the tier's shape. */
article:is([data-variant="danger"], .bn-pink) {
  --bn-shadow-color: var(--_variant-color);
  box-shadow: var(--bn-shadow-x) var(--bn-shadow-y) 0 0 var(--bn-shadow-color);
}
```

`--bn-shadow-md` and its brothers are declared on `:root`, and a derived token is substituted where it
is declared — so the inherited string already has its colour baked in, and redefining
`--bn-shadow-color` on the card cannot reach it. The card therefore restates the md *shape*: the
offsets still come from `--bn-shadow-x` and `--bn-shadow-y`, the blur and the spread stay at the hard
shadow's zero, and the colour comes from the public channel. A card with no colour of its own keeps
reading `--bn-shadow-md`, so redefining that token still moves every plain card on the page.

The consequence is that on a coloured card `--bn-shadow-color` is live. Set it and the shadow follows
while the border stays where the variant put it; custom properties inherit, so a card nested inside a
coloured one follows the outer colour until it sets its own.

### Overriding it

Unlayered CSS of your own wins outright, as it does over every rule the library ships (ADR-0006), so
an override needs no `!important`. Behind that, the knobs are tokens: `--bn-secondary-background` is
the surface, `--bn-border-width` the frame, `--bn-radius` the corner (zero, and staying there), and
`--bn-shadow-x` / `--bn-shadow-y` rescale every tier and the hover lift together. Change them on
`:root` — a derived token is substituted where it is declared, so the same declaration on a wrapper
halfway down the page changes nothing.
