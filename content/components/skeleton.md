---
title: "Skeleton"
description: "A loading placeholder: .bn-skeleton is what tells a status region to be a block of empty page instead of a turning ring."
---

`.bn-skeleton` is the override, and `[role="status"]` is the anchor it overrides (spec §8, decision
§3C). The two components share one role, so one class has to say which of them this is: a bare status
region turns, and a status region carrying `.bn-skeleton` becomes a placeholder. The class is the
anchor because there is no other way to say "this live region is a placeholder" — exactly the case
ADR-0001 keeps class names for.

```html
<div role="status" class="bn-skeleton" aria-label="Loading the report" style="inline-size: 12rem; block-size: 1rem"></div>
```

A skeleton has no intrinsic size. It is a block with a minimum height and nothing else, so give it a
width and a height — an inline style in these examples, a rule or a utility class of your own in a
real page. There is deliberately no `.bn-skeleton` width scale: an unbounded set of width classes
would be a second layout system wearing the library's prefix.

### A composed placeholder

A single placeholder is rarely the whole story, and the honest accessibility pattern for several of
them is one busy region rather than a handful of live ones: put `aria-busy="true"` and a label on the
container, and leave the children as plain `.bn-skeleton` blocks. Nothing turns, because the container
is not a status region.

```html
<article aria-busy="true" aria-label="Loading the release notes">
  <div class="bn-skeleton" style="block-size: 1.5rem; inline-size: 40%"></div>
  <div class="bn-skeleton" style="block-size: 1rem"></div>
  <div class="bn-skeleton" style="block-size: 1rem"></div>
  <div class="bn-skeleton" style="block-size: 1rem; inline-size: 70%"></div>
</article>
```

Consecutive placeholders keep a rhythm the way lines of text do, and each one is a bordered block on
a surface mixed from the page's own ink — so the placeholder is visible in both themes without a
colour literal anywhere in the stylesheet.

### Reduced motion

The highlight that sweeps across a placeholder is declared inside a
`prefers-reduced-motion: no-preference` block, which is the shape spec §7 asks for: there is no
`reduce` block switching motion off, there is simply no animation rule. What remains is the frozen
sheen on a bordered block the size its author gave it — still recognisably a placeholder waiting for
content, rather than an empty div.

### Sibling: the spinner

Remove the class and the same element turns instead. A bare `role="status"` is the ring, so a
placeholder must keep `.bn-skeleton`, and a ring that must sit inside a status region of its own
should not. See [Spinner](/components/spinner).

### Overriding it

Unlayered CSS of your own wins over every layered rule the library ships (ADR-0006), so an override
needs no `!important`. Behind that, the placeholder's surface is a mix of `--bn-foreground` into
`--bn-secondary-background` — the ink token is what makes both themes work — its border is
`--bn-border-width` of `--bn-border-color`, and `--bn-radius` is the corner. Redefine tokens on
`:root`; a derived token is substituted where it is declared, not where it is used.
