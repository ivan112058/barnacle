---
title: "Form"
description: "Text fields, popup lists, multi-line fields, checkboxes, radios and the group that holds them — dressed from the bare elements, with an error state that only appears after the user has spoken."
---

Barnacle dresses the controls themselves — `input`, `select`, `textarea`, `label`, `fieldset` and
`legend` — so a form needs no class, no wrapper and nothing here needs a script. Write the markup you
already write, and a field arrives with the structural 3px frame, the page's secondary surface and
the small shadow tier:

```html
<fieldset>
  <legend>Account</legend>
  <label for="email">Email</label>
  <input id="email" type="email" required>
  <label for="name">Name</label>
  <input id="name" type="text">
  <label for="plan">Plan</label>
  <select id="plan">
    <option>Free</option>
    <option>Pro</option>
  </select>
  <label for="note">Note</label>
  <textarea id="note"></textarea>
</fieldset>
```

Type in the field above and leave it: the address is `required` and not an address, so the frame
turns red — but only then. Nothing is red on arrival, which is the point of the next section.

### Sizes, and why a field does not lift

A field shares the button's floor (2.5rem), its 1rem text and its square 3px frame, so a form and a
toolbar read as the same material. It does not share the button's lift: a text control that moves
under the cursor while it is the typing target is a usability error, so a hover raises the *shadow*
from the small tier to the medium one and moves nothing. The tier is a token
(`--bn-shadow-sm` at rest), so a theme that rescales the shadow system rescales every field with it.

The `fieldset` is the frame of a group — the same 3px border, the small tier and the secondary
surface — and the `legend` is its title, in the display face at the heading weight. A `label` takes
that heading weight too, and a label that follows a checkbox or a radio keeps the inline flow so the
pair stays on one line.

### Checkboxes and radios

Both are redrawn from the native element, and both are still driven by `:checked` — no class to
toggle, no `aria-checked` to keep in step, no script:

```html
<fieldset>
  <legend>Notifications</legend>
  <p><input id="digest" type="checkbox" checked> <label for="digest">Weekly digest</label></p>
  <p><input id="daily" type="radio" name="frequency"> <label for="daily">Daily</label></p>
  <p><input id="never" type="radio" name="frequency"> <label for="never">Never</label></p>
</fieldset>
```

A checked box fills with `--bn-main` and draws its mark in the accent's ink; a radio is the one
shape that is round by definition. The mark is a child of the box, sized from it, so a theme that
changes the frame width or the box size keeps the mark centred.

### Errors, after the user has spoken

The trigger is `:user-invalid`, not `:invalid`. That difference is the whole design: `:invalid` is
true from the first paint for every `required` field, so a rule written on it opens the form with a
screen of red frames — the most common form-design error there is. `:user-invalid` becomes true only
once the user has changed a value and left the field, so the error arrives as an answer rather than
as a greeting:

```html
<label for="bad-email">Email</label>
<input id="bad-email" type="email" required placeholder="Type something, then press Tab">

<label for="rejected">Rejected by the server</label>
<input id="rejected" type="text" aria-invalid="true" value="ada@">
```

Type an address without an `@` into the first field and press `Tab`: the frame turns `--bn-danger`
and the surface takes a 10% wash of it. Correct it and leave again, and both go away.

The second field is the other half of the same rule, and it is the fallback: a server-side verdict is
carried by `aria-invalid="true"`, which needs no interaction at all. A field the user has not touched
yet cannot know it is wrong; a field the server has already rejected does not have to wait.

### The meaning axis, not a class

An error is a meaning, so it rides `data-variant` like every other meaning in the library — `danger`
and `error` are the same thing, spelled two ways — and never an appearance class. There is no
`.bn-error` to add, and nothing to mix into an appearance modifier:

```html
<label for="variant">The same rejection, said semantically</label>
<input id="variant" type="text" data-variant="danger" value="ada@">
```

Both forms of the rule paint the frame and, on a text field, the surface. Neither changes a border
width, a padding or a size, so an error can appear without the form reflowing around it — the same
invariant a hovered button keeps. One thing deliberately does not change either: the shadow. The
tier was substituted on `:root`, so re-pointing `--bn-shadow-color` on a single field would do
nothing at all; the frame and the wash carry the message instead.

### Disabled

A disabled control keeps its structure and its readable contrast, stops answering the pointer, and is
never painted as an error — the platform bars it from validation altogether:

```html
<fieldset>
  <legend>Locked preferences</legend>
  <p><input id="alias" type="text" value="ada" disabled> <label for="alias">Alias</label></p>
  <p><input id="tabs" type="checkbox" checked disabled> <label for="tabs">Tab size 4</label></p>
</fieldset>
```

### Overriding it

Two knobs, and neither needs an escape hatch. Write unlayered CSS and it wins outright, because every
rule the library ships sits in a cascade layer (ADR-0006) — see [Customizing](/customizing). Or
change a token on `:root`:

```css
:root {
  --bn-border-width: 4px;
  --bn-danger: #B4232A;
}
```

`--bn-border-width` thickens every frame — the field, the box, the group and the gap inside a switch
together — and `--bn-danger` repaints the error frame and its wash. Tokens have to be overridden on
`:root` specifically: a derived token is substituted where it is declared, so the same declaration on
some wrapper in the middle of the page changes nothing.
