---
title: "Button"
description: "The one component page ticket 04 needs: it exercises the fence-to-demo layer."
---

> **Placeholder.** Ticket 07 replaces this body with the real Button documentation. The page
> exists now because ticket 04 has to render its demo layer against a real component page.

Reach for the bare `<button>` element — or `<a>` when the control navigates. The fence below is
the whole authoring surface: a standard Markdown code fence, nothing else.

```html
<style>
  .site-demo-button button {
    padding: 0.6rem 1.2rem;
    border: 3px solid #000;
    background: #ffd23f;
    box-shadow: 4px 4px 0 0 #000;
    font: inherit;
    cursor: pointer;
  }
</style>

<div class="site-demo-button">
  <button class="bn-button" type="button">Press me</button>
</div>
```

### Variants

Semantic variants are expressed with `data-variant`, so the same element gains meaning without
losing its identity. This fence has no stylesheet of its own: it is rendered by the rules the
fence above already put into the page, which is exactly what "the preview runs in the page's
style scope" means.

```html
<div class="site-demo-button">
  <button class="bn-button" type="button">Default</button>
  <button class="bn-button" data-variant="danger" type="button">Delete</button>
</div>
```

### Where the declarations live

A fence that does not start with a tag is a code block and stays one — no preview tab, no
injection.

```css
/* src/css/button.css — filled by ticket 07 (layer: components) */
.bn-button {
  box-shadow: var(--bn-shadow-md);
}
```
