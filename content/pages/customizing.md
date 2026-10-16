---
title: "Customizing"
description: "Design tokens, cascade layers and the dark theme."
---

> **Placeholder.** Token documentation lands with the theme work (tickets 05, 06 and 09).

Barnacle is rethemed in CSS, not through a build step:

- **Public tokens are `--bn-*`.** Set them on `:root` and every component follows.
- **Internal variables are `--_*`** and are not part of the public API.
- **The cascade layer order is fixed** — `theme, base, components, animations, utilities` —
  so your own unlayered CSS always wins over the library without `!important`.
- **Dark mode is explicit**, via `[data-theme="dark"]`; Barnacle never follows the system
  preference on its own.
