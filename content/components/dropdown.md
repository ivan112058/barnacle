---
title: "Dropdown"
description: "A menu on the native popover API. You write the trigger and the panel; the element adds the keyboard, the focus handling, the anchoring and the events."
---

`bn-dropdown` enhances markup you already wrote instead of building a menu for you. Give a button a
`popovertarget` and give the panel it points at a `popover` attribute, and the browser opens it,
anchors it, and dismisses it on a click outside — with JavaScript switched off. The element adds what
the platform leaves out: arrow-key navigation, focus that enters the menu on open and returns to the
trigger on close, and three events to listen for.

```html
<bn-dropdown>
  <button type="button" popovertarget="menu-actions" aria-expanded="false">Actions</button>
  <menu popover id="menu-actions" aria-label="Actions">
    <li><button type="button" class="bn-dropdown-item" value="rename">Rename</button></li>
    <li><button type="button" class="bn-dropdown-item" value="duplicate">Duplicate</button></li>
    <li><button type="button" class="bn-dropdown-item" value="delete">Delete</button></li>
  </menu>
</bn-dropdown>
```

Nothing in that markup is generated: no shadow root, no cloned nodes, no ids minted behind your
back. The panel is a real child of the element, which is why the stylesheet can address it with an
ordinary descendant selector. If any part of the contract is missing — no `popovertarget`, an `id`
that resolves to nothing, a target without `popover` — the element does nothing at all and says
nothing: no error, no console message, no repair attempt.

### What the element adds

Inside the open menu the arrow keys move through the items and wrap at the ends, `Home` and `End`
jump to the first and last, and exactly one item stays in the tab order while the rest are reachable
only with the arrows. `Esc` closes the menu and hands focus back to the trigger; so does picking an
item. Tabbing out of the menu closes it too, rather than leaving it floating over the page. A close
that happened somewhere else — a click outside, or the platform's own light dismiss — leaves focus
where the visitor put it, and `aria-expanded` on the trigger always reports the truth.

### Events

Everything the element announces is a `CustomEvent` that bubbles and crosses shadow boundaries, in
keeping with the rest of the library. Listening is the only way to know that something was picked.

```js
const dropdown = document.querySelector('bn-dropdown');

dropdown.addEventListener('bn:open', (event) => console.log('opened', event.detail.trigger));
dropdown.addEventListener('bn:close', (event) => console.log('closed', event.detail.panel));
dropdown.addEventListener('bn:select', (event) => console.log('picked', event.detail.value));
```

| Event | Fired when | `detail` |
|---|---|---|
| `bn:open` | the panel has opened, by any means | `{ trigger, panel }` |
| `bn:close` | the panel has closed, by any means | `{ trigger, panel }` |
| `bn:select` | an item was clicked or activated | `{ value, item }` |

`value` is the item's `value` attribute when it has one, and its text otherwise, so a menu of
plain labelled buttons needs no bookkeeping attributes at all. `item` is the element itself, for
the cases where the value is not enough.

### Items

An item is any focusable element carrying `.bn-dropdown-item` — a `button` is the right answer
almost every time, but the class is what makes it a menu item, and an item may contain other
elements as long as it does not contain a second item. A `value` attribute is optional. Mark a
choice that is already active with `aria-selected="true"`, or one that is toggled on with
`aria-checked="true"`; both paint the item in the accent colour without any extra class.

```html
<bn-dropdown>
  <button type="button" popovertarget="menu-view">View</button>
  <menu popover id="menu-view" aria-label="View">
    <li><button type="button" class="bn-dropdown-item" value="grid" aria-checked="true">Grid</button></li>
    <li><button type="button" class="bn-dropdown-item" value="list" aria-checked="false">List</button></li>
    <li><button type="button" class="bn-dropdown-item" value="board" aria-checked="false">Board</button></li>
  </menu>
</bn-dropdown>
```

### How it is placed

The panel is put under its trigger by CSS anchor positioning, not by a wrapper with
`position: relative`: a popover is rendered in the top layer, where `position: absolute` resolves
against the page rather than against the element you nested it in. The browser gives a popover an
implicit anchor — the button that invoked it — which is enough while the menu is opened by a click
or a keypress. The element also names that anchor explicitly, one unique name per instance, so two
dropdowns on one page cannot steal each other's position and a programmatic open lands in the same
place. Without the script the CSS still finds the implicit anchor and the panel still appears under
its trigger.

### Overriding it

The panel and the items read the same tokens as everything else, and no rule here holds a colour or
a distance of its own. `--bn-secondary-background` sets the panel's surface, `--bn-main` the
highlight on a hovered or selected item, and `--bn-shadow-md` the panel's hard shadow with
`--bn-border-width` its border. Unlayered CSS of your own wins over every rule the library ships, so
an override needs no `!important`; remember to change tokens on `:root`, because a derived token is
substituted where it is declared.
