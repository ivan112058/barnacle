---
title: "TagInput"
description: "A text field that turns what you type into tags. One element, one input you already wrote, and the keyboard does the rest."
---

`bn-taginput` enhances a field you already wrote. Give it the input, give it the tags it starts
with, and the element turns each one into a chip with its own remove button — no shadow root, no
cloned input, no markup to generate yourself:

```html
<bn-taginput value="Design, Code">
  <input type="text" placeholder="Add a tag…">
</bn-taginput>
```

Type in the field above and press `Enter` or `,`: the text becomes a tag. Click a chip's `×` and it
goes. With the script absent the same markup is still a text field you can type in — the chips are
the one capability a script has to supply.

The list the element starts with is read from either place, in this order: the element's `value`
attribute, then the field's own `value`. Writing the starting list on the input is what a reader
without a script can still see, so it is the more considerate of the two.

### Adding a tag

Three gestures add the same thing, and all three run through one parser:

- `Enter` commits whatever is in the field and empties it.
- `,` does the same, and is never itself typed into a tag.
- Pasting a list splits it on the comma: everything complete becomes a tag and only the unfinished
  tail — the part after the last comma — stays in the field.

Every value is trimmed, an empty or whitespace-only value is not a tag, and a duplicate is dropped.
The comparison is case-sensitive on purpose: `Design` and `design` are two different tags, and an
identifier, a file name or a token keeps the casing it was typed with. Order is kept, so the list
reads back the way it was entered.

### Removing a tag

Each chip carries a remove button, and removal needs no mouse at all:

- click a chip's `×`, or press `Enter` on the focused remove button;
- press `Delete` or `Backspace` while a remove button has focus;
- press `Backspace` in the empty field — the last tag goes, one press per tag, until the field is
  empty again;
- press `ArrowLeft` in the empty field to step into the chips, and `ArrowRight` on the last one to
  step back out. `Home` and `End` jump to the first and the last remove button.

After a removal the caret is back in the field, ready for the next tag. Nothing about the frame
changes when a chip goes: the border and the padding are stated once and no state rule touches
them, so a tag can be removed without moving the field a pixel.

### Reading and writing the tags

The element keeps the list, not the DOM, so the API is the same thing the chips display:

```js
const field = document.querySelector('bn-taginput');

field.tags();                          // → ['Design', 'Code']   a copy; mutating it changes nothing
field.setTags(['Design', 'code']);     // → ['Design', 'code']   replaces the whole set
field.setTags('Design, code');         // → ['Design', 'code']   a comma-joined string is a set too
field.addTag('UI');                    // → ['Design', 'code', 'UI']
field.removeTagAt(0);                  // → ['code', 'UI']
field.clearTags();                     // → []
```

| Method | Signature | What it does |
|---|---|---|
| `tags()` | `→ string[]` | The current tags, in order. A copy. |
| `setTags(value)` | `(string[] \| string) → string[]` | Replaces the set; returns what is held afterwards. |
| `addTag(value)` | `(string) → string[]` | Appends one value (or a comma-joined list); a duplicate is ignored. |
| `removeTagAt(index)` | `(number) → string[]` | Removes the tag at a 0-based index; out of range is a quiet no-op. |
| `clearTags()` | `() → string[]` | Empties the set. |

Every write goes through the same path: it trims, splits, drops empties and de-duplicates, and it
is idempotent — writing the set the field already holds renders nothing and announces nothing. The
`value` attribute is kept in step with the list, so `field.getAttribute('value')` always agrees
with `field.tags()` and the list is inspectable from markup. The attribute is the *reflection* of
the state; after the element has initialised, write through the methods.

### The change event

Every change that changes something is announced once, as a `CustomEvent` that bubbles and crosses
shadow boundaries like every other barnacle event:

```js
const field = document.querySelector('bn-taginput');

field.addEventListener('bn:change', (event) => {
  console.log(event.detail.tags, event.detail.added, event.detail.removed, event.detail.source);
});
```

| `detail` key | Type | Meaning |
|---|---|---|
| `tags` | `string[]` | The whole list after the change, in order. |
| `added` | `string[]` | The tags this change added. |
| `removed` | `string[]` | The tags this change took away. |
| `source` | `string` | `'input'` (typed or pasted), `'remove'` (a chip's button), `'backspace'` (the empty-field gesture) or `'api'` (one of the methods above). |

A no-op is silent: writing the set the field already holds, pressing `Enter` on an empty field, or
pressing `Backspace` with no tags left announces nothing at all.

### Disabled

`disabled` on the element disables the field and every remove button, and the frame and the text
keep their contrast — a disabled field stays readable rather than fading into a ghost:

```html
<bn-taginput value="Design, Code" disabled>
  <input type="text" placeholder="Add a tag…">
</bn-taginput>
```

Toggling the attribute from script is observed, so the field and the chips follow it in both
directions.

### Without JavaScript

The element's stylesheet does not depend on the script: the field box, its focus ring and the
input's place inside it are all CSS. Without a script you get a plain text field with the same
frame, and the tags stay as text exactly as the author wrote them on the input. What is lost is the
chip behaviour, and only that.

### Overriding it

No rule here holds a colour or a distance of its own: the frame reads `--bn-border-width` and
`--bn-radius`, the surface `--bn-secondary-background`, the resting shadow `--bn-shadow-sm` (the
same small tier a Form field rests on) and the focus ring `--bn-ring`. Unlayered CSS of your own
wins over every rule the library ships, so an override needs no `!important` — see
[Customizing](/customizing) — and remember to change tokens on `:root`, because a derived token is
substituted where it is declared.
