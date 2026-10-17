---
title: "Toast"
description: "A message that shows itself and takes itself away again — the one Barnacle component you never write markup for."
---

Toast is the component with no markup. There is no element to remember and no class to opt into:
`bn.toast()` builds the message, puts it into a fixed stack in the corner of the viewport, and takes
it away again. It is also the counter-example the architecture keeps to its own rule — a custom
element wraps internal state and a lifecycle, a message has neither, so Toast is a plain module
behind three entries on the global `bn` object (spec §9).

```html
<button class="bn-button" type="button" onclick="bn.toast('Saved.')">Show a toast</button>
<button class="bn-button" type="button" onclick="bn.toast('Saved.', { variant: 'success' })">Success</button>
<button class="bn-button" type="button" onclick="bn.toast('Careful.', { variant: 'warning' })">Warning</button>
<button class="bn-button" type="button" onclick="bn.toast('Deleted.', { variant: 'danger' })">Danger</button>
<button class="bn-button" type="button" onclick="bn.toast('Stays until you clear it.', { duration: 0 })">Sticky</button>
```

Click any of those buttons and the message appears in the bottom-right corner of the **page**, not
inside the preview panel: the stack is fixed to the viewport, which is the entire point of a toast —
it follows the visitor down a long page instead of sitting in the document at the position it was
created. Only the messages themselves are click targets; the strip they live in passes clicks
through to the page underneath, so a disappearing message can never swallow an input. The handler in
that fence is inline because the rendering layer injects example markup with `innerHTML`, where a
`script` element would be inert; in real code you would attach the call with `addEventListener`. If
the preview's handler cannot run in your setup, the same entry works from the console:
`bn.toast('hi')`.

### The API

| Entry | Signature | Does |
|---|---|---|
| `bn.toast` | `toast(message, options?)` → `Element` | Shows one message, and arms its auto-dismiss. |
| `bn.toast.el` | `el(message, options?)` → `Element` | Builds and shows one, and arms **no** timer: the caller owns its lifetime. `clear()` still closes it. |
| `bn.toast.clear` | `clear()` → `number` | Closes every live message and reports how many it started closing. Idempotent — a second call is a no-op that returns `0`. |

```js
bn.toast('Saved.');                              // shows, gone after 5000 ms
bn.toast('Saved.', { variant: 'success' });       // success / warning / danger (error is an alias)
bn.toast('Import finished.', { duration: 20000 }); // a long read gets a long life
bn.toast('Be right back.', { duration: 0 });       // no timer at all
bn.toast.clear();                                 // closes everything, returns the count

const message = bn.toast.el(document.querySelector('template').content.cloneNode(true));
// no timer: the message stays until bn.toast.clear(), whenever that suits you
```

| Option | Type | Default | Meaning |
|---|---|---|---|
| `message` | string, number or `Node` | `''` | A string is inserted as **text**, never parsed as markup; a `Node` is appended. |
| `variant` | `success` / `warning` / `danger` / `error` | none | Becomes `data-variant`, exactly as it does everywhere else in the library: meaning is an attribute, never a class. Any other value simply has no variant. |
| `duration` | milliseconds, ≥ 0 | `5000` | `0` means "do not dismiss yourself". A negative, non-finite or non-numeric value throws a `TypeError` before anything is built, so a mistyped duration cannot quietly produce a permanent message. |

### Timing and dismissal

Three things about a message that disappears on its own, in order of how easy they are to get wrong.

The default life is **5000 ms**, and every call may override it. A toast is not a notification
centre: nothing is retried, queued or replayed, so `bn.toast` is a plain call with a plain answer.

The stack never blocks the page. The container is a fixed box — it therefore lies on top of whatever
is in the bottom-right corner — but it is `pointer-events: none`, and each message switches pointer
events back on for itself. Only the messages are targets; the gaps between them and the rest of the
strip pass every click through to the page underneath. A passive disappearance can never swallow an
input.

The exit is an animation, so the element is not removed the instant its timer fires: `toast.clear()`
marks each message with `data-closing` and asks `getComputedStyle` for the `animation-duration` it is
about to play. That read is why no duration is ever written twice — the CSS owns the animation and
the JS asks for it.

### Reduced motion

The entry and the exit are declared inside a `prefers-reduced-motion: no-preference` block, so a
visitor who asked for less motion does not get a disabled animation — the rule is simply absent.
The message still appears, still stays for its duration, and still goes; and because the computed
`animation-duration` is then `0s`, it goes immediately instead of waiting for an animation that will
never play.

```css
@media (prefers-reduced-motion: no-preference) {
  @keyframes bn-toast-in {
    from { opacity: 0; translate: 0 var(--_press-y); }
  }
  .bn-toast { animation: bn-toast-in var(--_motion) both; }
}
```

### Why it is not a custom element

Custom elements exist for components that have state to keep and a lifecycle to survive: parse,
upgrade, reconnect, disconnect (ADR-0002, spec §9). A toast has one piece of state — the timer that
will remove it — and that timer belongs to the call, not to the element; the element itself has
nothing to observe and nothing to re-initialise. Wrapping it in `<bn-toast>` would buy no behaviour
and cost a custom-element name, a shadow-DOM question, and an upgrade path. So there is no
`bn-toast` in the markup vocabulary, and `bn.toast` is the only thing on the global surface that is
not a registration hook.

### Overriding it

Unlayered CSS wins outright, as it does for every rule the library ships (ADR-0006). Behind that,
the slots are tokens. `--bn-secondary-background` is the surface, `--bn-border-color` the border
when there is no variant, `--bn-press` the distance the message travels as it fades, and
`--bn-transition` the duration of both animations. Override them on `:root`, not on a wrapper: a
derived token is substituted where it is declared, which is also why the border takes the variant
colour but the hard shadow keeps the page's own shadow colour — the shadow token is built on
`:root`, where its colour is already fixed.
