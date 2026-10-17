---
title: "Tabs"
description: "bn-tabs dresses the tab structure you already write: one tab stop, arrow keys, Home and End, and the panel bookkeeping that ARIA cannot express by itself."
---

Tabs invents no markup. You write `role="tablist"`, `role="tab"` and `role="tabpanel"` — the
structure a screen reader already understands — and `<bn-tabs>` adds the behaviour those roles
cannot carry: which tab the `Tab` key reaches, where the arrows go, and which panel is visible. It
is a shallow wrapper in the strict sense (ADR-0002): no shadow DOM, no generated elements, no
rewriting of the subtree you wrote.

```html
<bn-tabs>
  <div role="tablist" aria-label="Account settings">
    <button type="button" role="tab" id="tab-profile" aria-controls="panel-profile" aria-selected="true">Profile</button>
    <button type="button" role="tab" id="tab-billing" aria-controls="panel-billing">Billing</button>
    <button type="button" role="tab" id="tab-danger" aria-controls="panel-danger">Danger zone</button>
  </div>
  <div role="tabpanel" id="panel-profile" aria-labelledby="tab-profile">
    <p>The name, the avatar and the language the account speaks.</p>
  </div>
  <div role="tabpanel" id="panel-billing" aria-labelledby="tab-billing">
    <p>The plan, the invoices and the card on file.</p>
  </div>
  <div role="tabpanel" id="panel-danger" aria-labelledby="tab-danger">
    <p>Deleting the account. This one asks twice.</p>
  </div>
</bn-tabs>
```

### Keyboard

The tab strip is a single stop in the tab order, and the arrows move the selection inside it:

- `Tab` reaches the selected tab and then leaves the strip — the other tabs are one keypress away,
  not one `Tab` away. That is the roving tabindex: `tabindex="0"` on the selected tab and `-1` on
  everybody else, maintained by the element.
- `ArrowRight` and `ArrowLeft` (and `ArrowDown` / `ArrowUp`) move to the neighbouring tab and
  focus follows the selection, so the tab you are standing on is always the panel you can read.
- `Home` and `End` jump to the first and the last tab.
- The ends are ends: the arrows stop there instead of wrapping around.
- A key pressed inside a panel is left to the panel. A `<textarea>` in a panel keeps its own arrow
  keys, because only a key pressed on a tab is a navigation key here.

Selection and focus stay distinguishable. The selected tab is filled with `--bn-main` and its hard
shadow is collapsed — the resting form of a pressed button — while the keyboard focus paints the
library's outline ring outside it. Only the keyboard paints that ring: a click selects without
lighting it up.

### The event

Every switch announces itself as a bubbling, composed `CustomEvent` named `bn:change`.

```js
const tabs = document.querySelector('bn-tabs');

tabs.addEventListener('bn:change', (event) => {
  const { index, tab, panel } = event.detail;
  console.log(index, tab, panel);
});
```

- `detail.index` — the position of the selected tab, counted from `0`.
- `detail.tab` — the selected tab element itself.
- `detail.panel` — the panel that tab controls, or `null` when the markup has no panel for it.

Selecting the tab that is already selected is not a change, so it dispatches nothing; loading the
page is not a change either. The event bubbles, so a listener on any ancestor hears it.

### What the element writes

The behaviour is the whole of it — a few attributes, and nothing else:

- `aria-selected="true"` on the selected tab and `false` on the rest.
- `tabindex="0"` on the selected tab and `-1` on the rest.
- `hidden` on every panel except the selected one.
- Missing ids and links: a tab with no `id` gets `bn-tab-1`, a panel with no `id` gets
  `bn-tabpanel-2`, a missing `aria-controls` is filled in, and a panel without an
  `aria-labelledby` points back at its tab.

Ids and attributes you wrote yourself are never rewritten. `aria-controls` therefore decides which
panel a tab owns, even when the panels sit in a different order than the tabs.

### Without JavaScript

Hiding a panel is the script's job and never the markup's, which is what keeps the page readable
when the script does not arrive. Author the examples above with no `hidden` attribute, and a
reader with scripting switched off sees all three panels one after the other, under the same strip.

```html
<!-- nothing in this markup is hidden: every panel is readable without the script -->
<bn-tabs>
  <div role="tablist" aria-label="Account settings">
    <button type="button" role="tab" aria-selected="true">Profile</button>
    <button type="button" role="tab">Billing</button>
  </div>
  <div role="tabpanel">The name, the avatar and the language the account speaks.</div>
  <div role="tabpanel">The plan, the invoices and the card on file.</div>
</bn-tabs>
```

### Overriding it

The strip takes its geometry from the same slots as a button, so the usual two knobs apply and
neither needs `!important`. Write unlayered CSS and it wins outright, because every rule the
library ships sits in a cascade layer (ADR-0006). Or change a token on `:root`: `--bn-main`
repaints the selected tab, `--bn-shadow-x` rescales every shadow tier and the hover lift together,
and `--bn-press` sets how far a tab drops when pressed. Tokens have to be overridden on `:root`
specifically — a derived token is substituted where it is declared, so the same declaration on
some wrapper in the middle of the page changes nothing.
