---
title: "Dialog"
description: "The native modal, dressed: a hard-edged frame in the browser's top layer, an overlay from one token, and no script needed to open or close it."
---

Dialog is the native `dialog` element, dressed. Everything a modal needs is already in the platform:
`showModal()` moves the element into the browser's top layer, the browser dims and blocks the rest of
the page behind `::backdrop`, moves focus inside, keeps it there while the dialog is open, and hands
it back to whatever opened the dialog when it closes. Barnacle adds the frame — the page's own
surface, the structural border, and the largest hard shadow tier — and stops there.

```html
<button type="button" class="bn-button" commandfor="dlg-invite" command="show-modal">Invite someone</button>

<dialog id="dlg-invite">
  <h3>Invite someone</h3>
  <p>They get an email with a link that expires in 24 hours.</p>
  <form method="dialog">
    <button type="button" class="bn-button" command="close" commandfor="dlg-invite">Cancel</button>
    <button type="submit" class="bn-button" autofocus>Got it</button>
  </form>
</dialog>
```

Click **Invite someone**: the dialog takes over the viewport and the page behind it goes dim. Three
things close it, and none of them needs a script. The **Cancel** button carries
`command="close"` with a `commandfor` naming the dialog; the **Got it** button is a submit inside
`<form method="dialog">`, which closes the dialog and copies the button's `value` into
`dialog.returnValue`; and Escape is the browser's own. A submit button inside that form is the one
close that also carries an answer back to the page, which is why the action row is a form even when
there is nothing to submit.

Both open and close are declarative attributes on ordinary buttons, so the example works in a
preview panel where a `script` element would be inert. `command` and `commandfor` are the modern
spelling of the pattern; in a browser that predates them the trigger button is simply inert, and the
same dialog is opened from code with `dialog.showModal()`. Opening from code is the way to open a
dialog that no author-facing button owns — a first-visit notice, a confirmation a handler decides
on.

### Focus goes in, and comes back

Opening a modal moves focus into the dialog. The browser's default is the first focusable element in
document order, and `autofocus` overrides it: in the example above **Cancel** comes first, and
**Got it** still takes the focus. That is the convention worth writing down — put `autofocus` on the
button you want focused, usually the safe one, instead of relying on which element happens to be
first.

Closing — by the form, by `command="close"`, or by Escape — returns focus to the element that had it
before the dialog opened. The trigger is usually that element, which is what makes the round trip
feel like nothing happened. Focus is not escapable by Tab while the dialog is open: a modal keeps the
keyboard inside itself until it is closed.

### Without JavaScript

```html
<dialog open>
  <h3>Open by default</h3>
  <p>An <code>open</code> dialog is in the document flow: no top layer, no overlay, no focus trap.</p>
</dialog>
```

The `open` attribute is the element's only piece of state, so a page can render a dialog server-side
and show it without a line of script. It is not a modal — there is no overlay and no focus trap — and
it is drawn with the same frame as the modal: the border, the page surface, the largest shadow tier.
An open dialog takes its place in the flow, so the paragraph after it sits below it instead of
sliding underneath.

A `<dialog>` without `open` is `display: none`. Its content is not rendered at all, which is why the
trigger and the dialog are siblings in the markup rather than nested: a dialog inside the block that
opens it inherits that block's layout while it is closed and nothing while it is open.

### The overlay

`::backdrop` is painted from `--bn-overlay`, 80% black, and it is not retuned by the dark theme.
That is deliberate: on a dark page the frame does the separating, not the veil. Measured against the
composited overlay in Chrome, the two numbers that matter are the dialog's surface and its ink:

| Theme | Surface vs masked page | Ink (border and shadow) vs masked page |
|---|---|---|
| Light | 12.5 : 1 | 1.7 : 1 |
| Dark | 1.2 : 1 | 20.0 : 1 |

So the light theme separates with the surface and the dark theme separates with the border and the
hard shadow; in both themes the pair that carries the separation clears the 3:1 non-text floor.
There is nothing to switch on and nothing to configure.

Because a modal lives in the top layer, no ancestor `overflow` or `z-index` can clip it, and the
dialog needs no `z-index` of its own. It also means the dialog is never scrolled away with the page:
its own content scrolls inside it, capped at the viewport height.

### Reduced motion

The entry — the dialog rising, the overlay fading in underneath it — is declared inside a
`prefers-reduced-motion: no-preference` block, so a visitor who asked for less motion does not get a
disabled animation; the rule is simply absent. The dialog opens instantly, fully opaque, with the
overlay at its full strength. Nothing about the appearance depends on the animation having run.

### Overriding it

Unlayered CSS wins outright, as it does for every rule the library ships (ADR-0006). Behind that, the
slots are tokens: `--bn-background` is the surface, `--bn-border-color` and `--bn-border-width` the
frame, `--bn-shadow-lg` the floating tier, `--bn-overlay` the veil, and `--bn-transition` the length
of both the rise and the fade. Override them on `:root`, not on a wrapper — a derived token is
substituted where it is declared, so `--bn-overlay` set on a container reaches the backdrop, but
`--bn-shadow-x` set on one does not rescale the tier.
