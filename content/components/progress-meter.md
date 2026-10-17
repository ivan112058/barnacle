---
title: "Progress / Meter"
description: "One slot and one fill for two bare elements: progress for work in flight, meter for a measurement inside a known range."
---

`progress` and `meter` are two elements and one component. Barnacle gives them a single slot — the
same border, the same radius, the same track, the same fill — because that is what they are: a
bordered bar with something inside it. What differs is where the fill comes from, and that
difference is the browser's job, not yours. Write the element and put the number in the attribute
it was invented for.

```html
<!-- work in flight: how far along a job is -->
<progress value="72" max="100">72%</progress>

<!-- a measurement in a range: how full a tank is, given what full means -->
<meter value="0.72" min="0" max="1" low="0.25" high="0.75" optimum="1">72%</meter>
```

No class name appears in either line (ADR-0001). `value` and `max` are the whole API for
`progress`; `min`, `max`, `low`, `high` and `optimum` are the whole API for `meter`. The slot keeps
its width and the fill inside it grows, so a bar that goes from 3% to 97% never reflows the grid it
sits in.

### Work with no known end

A `progress` element without a `value` attribute is not "at zero" — it is a job whose size nobody
knows yet. Barnacle stops that state from reading as an empty slot: the bar switches to the main
colour and gains a diagonal hatch, and the hatch crawls while the visitor accepts motion.

```html
<progress>Working…</progress>
```

The crawl is declared inside `@media (prefers-reduced-motion: no-preference)`, so a visitor who
asked for reduced motion sees the same hatched bar standing still rather than a bar that vanished or
a job that appears stuck. Nothing else about the appearance changes: the removal is the absence of a
rule, not a rule that switches motion off afterwards.

### Status colours

`progress` carries meaning through `data-variant`, exactly as Alert and Button do: `success`,
`warning` and `danger` repaint the fill, and `error` is an accepted alias of `danger`.

```html
<progress value="100" max="100" data-variant="success">Uploaded</progress>
<progress value="64" max="100" data-variant="warning">Retrying</progress>
<progress value="18" max="100" data-variant="danger">Failed</progress>
```

The variant is spent on the fill and nowhere else — not on the border, not on the height, and not on
the width — so switching it can never move anything around it. With no variant, or with a name the
library does not know, the fill is `--bn-main`.

### The three bands of a meter

A `meter` does not need a variant, because its meaning is already in the markup. `low`, `high` and
`optimum` tell the browser which part of the range is good, and the engine picks the band from the
parsed value: optimum is green, suboptimum warning-orange, and even-less-good danger-red. All three
come from the same semantic tokens `data-variant` uses, so the two axes never disagree about what
"danger" looks like.

```html
<meter value="90" min="0" max="100" low="30" high="60" optimum="100">Battery: 90%</meter>
<meter value="45" min="0" max="100" low="30" high="60" optimum="100">Battery: 45%</meter>
<meter value="12" min="0" max="100" low="30" high="60" optimum="100">Battery: 12%</meter>
```

With `data-variant` in play the variant wins over the band, which is what you want when the bar is
about status rather than about a measurement: a queue at 12% painted `data-variant="warning"` reads
as "watch this", not as the band the range would have chosen.

### Overriding it

Both elements take their structure from the same tokens as the rest of the library, so the usual
knobs apply and none of them needs `!important`. Write unlayered CSS and it wins outright, because
every rule the library ships sits in a cascade layer (ADR-0006) — the
[usage page](/usage) shows the two ways to override. Or change a token on `:root`:
`--bn-border-width` thickens the frame, `--bn-main` recolours both the default fill and the
indeterminate hatch, and `--bn-radius` breaks the square corners the library otherwise insists on.
Tokens have to be overridden on `:root` specifically: a derived token is substituted where it is
declared, so the same declaration on a wrapper in the middle of the page changes nothing.
