---
title: "Switch"
description: "A checkbox that announces itself as a switch: the thumb slides by the same token that draws its shadow, and the state is the browser's own — no script, no aria-checked to maintain."
---

Barnacle dresses `input[role="switch"]` — a checkbox that announces itself as a switch — so the
control is a switch without a class, and its state is the browser's own. Add `type="checkbox"` and
`role="switch"` to the markup you already write, and the checkbox becomes a channel with a thumb
that slides across when it is on:

```html
<p>
  <label for="wifi">Wi-Fi</label>
  <input id="wifi" type="checkbox" role="switch">
</p>
```

Press it. The switch toggles with the keyboard, with a click, and with a click on its label — because
the state it shows is the `:checked` state of a native checkbox, not a copy of it kept somewhere else.
There is no script, no `aria-checked` attribute to keep in step with the picture, and nothing to
re-initialise after the page changes.

### On and off

The two states are the two states of the element. Off, the channel shows the page's own ground and
the thumb sits at the near edge; on, the channel fills with `--bn-main`, the thumb spends the travel
and lands the same gap from the far edge, and it takes the accent's ink because it now sits on a
saturated fill. No rule changes a border width, a padding or a size between the states, so a switch
can never reflow the row it is in — the same invariant a hovered button keeps.

### The slide and the shadow are one number

The thumb travels by three shadow offsets, and its own shadow is the small tier — half an offset.
Both read `--bn-shadow-x`, so the movement and the shadow it is drawn with are the same fact expressed
twice, and the channel is sized from the travel rather than from a fixed width:

```css
input[role="switch"] {
  --_switch-travel: calc(var(--bn-shadow-x) * 3);
  inline-size: calc(var(--_switch-h) + var(--_switch-travel));
}
```

That is why scaling the shadow system also scales the switch. Override the offsets on `:root` and the
thumb travels further, its shadow grows with it, and the channel widens so the thumb still lands the
same distance from the end:

```css
:root {
  --bn-shadow-x: 8px;
  --bn-shadow-y: 8px;
}
```

### Keyboard and focus

`Tab` reaches the switch with the same sequential focus every other control gets, `Space` toggles it,
and the focus ring is the library's outline — drawn outside the thick border so the border cannot
swallow it, and outside the thumb's shadow so the two never paint over each other. Nothing about the
ring is specific to the switch, which is the point: one indicator for every focusable element.

### Disabled

A disabled switch keeps its structure and its readable contrast, and stops answering the pointer:

```html
<p>
  <label for="lan">LAN</label>
  <input id="lan" type="checkbox" role="switch" checked disabled>
</p>
```

### Overriding it

Two knobs, and neither needs an escape hatch. Write unlayered CSS and it wins outright, because every
rule the library ships sits in a cascade layer (ADR-0006) — see [Customizing](/customizing). Or change
a token on `:root`: `--bn-main` repaints the on channel, `--bn-border-width` thickens the frame and the
gap between the frame and the thumb together, `--bn-shadow-x` rescales the slide and the thumb's shadow
as described above, and `--bn-foreground` sets the resting thumb's colour. Tokens have to be overridden
on `:root` specifically — a derived token is substituted where it is declared, so the same declaration
on some wrapper in the middle of the page changes nothing.
