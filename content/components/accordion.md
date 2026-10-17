---
title: "Accordion"
description: "The native details and summary pair, dressed by default: a disclosure that opens without a line of script, and a mark whose travel comes from the same scale as the hard shadow."
---

Barnacle dresses the `details` and `summary` elements, so a disclosure needs no class, no attribute
and no script: the browser already knows how to open and close it, and the library decides what it
looks like. Closed and open are two different objects on purpose — the header stays exactly where it
was, and the panel arrives under a single separator line.

```html
<details>
  <summary>Shipping and delivery</summary>
  <p>Orders leave the warehouse within one working day, and tracking arrives by email.</p>
</details>
```

### A stack of panels

Panels in a row are just `details` elements in a row. The library spaces them apart by more than a
hard shadow is wide, so no item paints onto its neighbour and opening one never shuffles the
others sideways:

```html
<details>
  <summary>Shipping and delivery</summary>
  <p>Orders leave the warehouse within one working day.</p>
</details>
<details>
  <summary>Returns</summary>
  <p>Send anything back within thirty days, in the condition it arrived.</p>
</details>
<details>
  <summary>Warranty</summary>
  <p>Every part is covered for two years against manufacturing faults.</p>
</details>
```

### Panels nest

A `details` inside another one is still a `details`, and each level keeps its own frame. A nested
panel that sits directly inside a panel is indented by the outer panel's content padding; a nested
panel wrapped in a `div` like this one keeps the outer padding around it:

```html
<details>
  <summary>Billing</summary>
  <div>
    <p>Invoices are issued on the first working day of the month.</p>
    <details>
      <summary>Invoice archive</summary>
      <p>The last twenty-four invoices are kept in the account.</p>
    </details>
  </div>
</details>
```

### The mark and the shadow scale

The header carries one mark: a square, three border widths across, filled with the accent. Opening
the panel turns it 45° into a diamond and moves it up and to the left by the library's lift, so a
square is closed and a diamond is open even before the content is read.

That travel is not a number this component chooses. It is `--_lift-x` and `--_lift-y`, declared once
for the whole library and derived from `--bn-shadow-lift`, which is half of `--bn-shadow-x`. The same
token is what gives the item its hard shadow, so changing the base offset rescales the shadow and the
mark's travel in step — one number, one flavour:

```css
:root {
  --bn-shadow-x: 8px;
  --bn-shadow-y: 8px;
}
```

Override it on `:root`, and nowhere else: a derived token is substituted where it is declared, so the
same declaration on a wrapper element changes nothing. From script the override has to land on
`document.documentElement` for the same reason.

### Keyboard and focus

`summary` is a real interactive element, so nothing has to be wired up: Tab reaches it, Enter and
Space both toggle it, and the focus ring is the library's one ring — a three-pixel outline offset by
three pixels, drawn outside the frame so a thick border cannot swallow it. The panel opens with
scripting switched off for the same reason: the toggle is the browser's, not the library's.

### Overriding it

Write unlayered CSS and it wins outright, because every rule the library ships sits in a cascade
layer (ADR-0006) — see [Customizing](/customizing). Or change a token on `:root`: `--bn-border-width`
thickens the frame and the mark with it, `--bn-border-color` recolours both, `--bn-main` and
`--bn-danger` repaint the mark, and `--bn-shadow-x` rescales the shadow and the mark's travel
together.
