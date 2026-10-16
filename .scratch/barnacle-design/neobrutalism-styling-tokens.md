# neobrutalism.dev `/styling` — complete styling/token system, verbatim

Reference for the barnacle CSS library design. Everything below is quoted from the
`ekmas/neobrutalism-components` source at commit
`3306a802724874a85f93079702b2795370a279d4` (branch `main`, "Merge pull request #117 from
ekmas/base-ui", Mon Sep 14 17:39:29 2026 +0200) and cross-checked against the **deployed**
site.

## 0. Provenance / how this was obtained

`https://www.neobrutalism.dev/styling` is client-rendered, so a plain fetch returns only
demo prose. What was done instead:

1. `git clone --depth 1 https://github.com/ekmas/neobrutalism-components.git` (into a temp
   dir) — gives the whole tree, so no file guessing.
2. Read the real sources (paths below).
3. **Verified against the live deployment**: downloaded
   `https://www.neobrutalism.dev/_next/static/chunks/app/styling/page-ae2732b1eb385ce1.js`
   and confirmed the minified template literal is byte-equivalent to the source template,
   that `useState` defaults are `5`, `[4,4]`, `[700,500]`, and that all 30 deployed palette
   objects (names/order/main/bg/chart1..5) are **identical** to `src/data/colors.ts`, and
   that all 20 fonts are present in the bundle. Downloaded
   `/_next/static/css/c1b954fcfdc612d4.css` and confirmed the deployed token defaults
   (`--border-radius:5px`, `--box-shadow-x:4px`, `--box-shadow-y:4px`,
   `--reverse-box-shadow-x:-4px`, `--heading-font-weight:700`, `--base-font-weight:500`,
   `--base-font-family:var(--font-dm-sans),sans-serif`,
   `--shadow:var(--box-shadow-x) var(--box-shadow-y) 0px 0px var(--border)`), with
   `--background`/`--main` minified from `hsl()` to `#dcebfe` / `#5294ff` (= exactly
   `hsl(214, 95%, 93%)` / `hsl(217, 100%, 66%)`).

Source file paths (repo-relative):

| Path | What it is |
|---|---|
| `src/app/styling/page.tsx` | The `/styling` route |
| `src/app/styling/styling.tsx` | **The configurator** (591 lines) — all options + the CSS it generates |
| `src/data/colors.ts` | Color modes + all palettes (344 lines) |
| `src/data/fonts.ts` | The 20 selectable Google fonts |
| `src/lib/google-fonts.ts` | Font loading / apply / clear |
| `src/styling/globals.css` | **The site's own token file** (319 lines) |
| `src/components/app/set-styling-pref.tsx` | Re-applies stored picks on every page load |
| `src/scripts/add-registry-styles.ts` | Generates the 30 shadcn registry style items |
| `public/r/styling/*.json` | The 30 generated registry items (e.g. `blue.json`) |
| `src/app/layout.tsx` | DM Sans via `next/font`, variable `--font-dm-sans` |
| `src/components/ui/*.tsx` | Component class conventions |

Note: an earlier doc in this folder said a raw fetch of `src/styling/globals.css` failed.
The path is correct and the file exists; the fetch failure was transient (raw.githubusercontent
also failed once during this session and succeeded on retry via `git clone`).

---

## 1. The `/styling` configurator — options, choices, defaults

`src/app/styling/styling.tsx`. State (lines 94–99) and defaults:

```tsx
  const [mode, setMode] = useState<ColorMode>(DEFAULT_COLOR_MODE)
  const [palette, setPalette] = useState<ColorPalette>(defaultPalette)
  const [borderRadius, setBorderRadius] = useState(5)
  const [boxShadowLength, setBoxShadowLength] = useState([4, 4])
  const [fontWeight, setFontWeight] = useState([700, 500])
  const [font, setFont] = useState<LoadedFont>(getDefaultFont)
```

The UI is a `Sheet` labelled **"Customize styling"** (trigger button: `Customize`) plus a
`Copy` button opening a dialog **"Install this theme"** with `Shadcn CLI` / `Manual` tabs.

| # | Option label (verbatim) | Control | Exact choices | Default |
|---|---|---|---|---|
| 1 | `Color Mode` | 2 buttons (`grid-cols-2`) | `Monochromatic`, `Duotone` (`colorModes` in `src/data/colors.ts`) | `Monochromatic` (`DEFAULT_COLOR_MODE = "monochromatic"`) |
| 2 | `Color` | `Select` | Names from `colors[mode]`, capitalized in the UI. Monochromatic (17): `red, orange, amber, yellow, lime, green, emerald, teal, cyan, sky, blue, indigo, violet, purple, fuchsia, pink, rose`. Duotone (13): `red, orange, amber, yellow, lime, green, emerald, teal, cyan, sky, violet, fuchsia, rose` (no indigo, purple or pink) | `blue` (`DEFAULT_COLOR_NAME = "blue"`; `defaultPalette` = the blue monochromatic palette) |
| 3 | `Font` | `Select` | 20 Google fonts, see §6 | `DM Sans` (`DEFAULT_FONT_NAME`) |
| 4 | `Border Radius` | 4 buttons (`grid-cols-4`), labels `"0 px"`…`"15 px"` | `0`, `5`, `10`, `15` (px) | `5` |
| 5 | `Horizontal Box Shadow` | 5 buttons (`grid-cols-5`), labels `"-4 px"`…`"4 px"` | `-4`, `-2`, `0`, `2`, `4` (px) | `4` |
| 6 | `Vertical Box Shadow` | 5 buttons (`grid-cols-5`) | `-4`, `-2`, `0`, `2`, `4` (px) | `4` |
| 7 | `Heading Font Weight` | 3 buttons (`grid-cols-3`) | `700`, `800`, `900` | `700` |
| 8 | `Base Font Weight` | 3 buttons (`grid-cols-3`) | `500`, `600`, `700` | `500` |

Footer buttons: `Save changes` (closes the sheet) and `Reset` (restores every default above
and calls `localStorage.clear()`).

**There is no border-width option and no "shadow style"/"shadow size" option.** The shadow
is parameterised only as two independent offsets (x, y) in the `-4…4px` range, and border
width is hard-coded per component as `border-2` (2px) — see §4. There is also no dark-mode
option (see §5).

Persistence (localStorage keys, all read back in `useLayoutEffect`, lines 103–137):

| Key | Stored value |
|---|---|
| `colorMode` | `"monochromatic"` \| `"duotone"` |
| `palette` | JSON of the whole `ColorPalette` object |
| `borderRadius` | number as string, e.g. `"5"` |
| `boxShadow` | `"<x>,<y>"`, e.g. `"4,4"` |
| `fontWeight` | `"<heading>,<base>"`, e.g. `"700,500"` |
| `font` | JSON `{ family, url }` (`FONT_STORAGE_KEY` in `src/lib/google-fonts.ts`) |

The preview applies picks by setting inline style properties on `document.documentElement`:
`--background`, `--main`, `--chart-1`…`--chart-5` (from the palette), `--border-radius`,
`--box-shadow-x`, `--box-shadow-y`, `--heading-font-weight`, `--base-font-weight`,
`--base-font-family` (font). `src/components/app/set-styling-pref.tsx` repeats exactly that
on every other page so the whole docs site adopts the picks.

CLI URLs shown in the dialog (`src/lib/site.ts`: `REGISTRY_URL = ${SITE_URL}/r`,
`SITE_URL = https://neobrutalism.dev` in production):

```
npx shadcn@latest init  https://neobrutalism.dev/r/styling/blue.json
npx shadcn@latest add   https://neobrutalism.dev/r/styling/blue.json
```
with the file name `${palette.name}` for monochromatic and `${palette.name}-duotone` for
duotone (`styling.tsx` line 245; the 30 files in `public/r/styling/`).

---

## 2. The generated CSS — verbatim

This is the single most important artifact. The template literal is `styling.tsx` lines
247–302 verbatim (interpolations intact):

```
@import "tailwindcss";
@import "tw-animate-css";

/* Neobrutalism ${mode} palette: ${name} */
:root {
  --background: ${bg};
  --secondary-background: oklch(100% 0 0);
  --foreground: oklch(0% 0 0);
  --main-foreground: oklch(0% 0 0);
  --main: ${main};
  --border: oklch(0% 0 0);
  --ring: oklch(0% 0 0);
  --overlay: oklch(0% 0 0 / 0.8);
  --shadow: ${boxShadowLength[0]}px ${boxShadowLength[1]}px 0px 0px var(--border);
  --chart-1: ${chart1};
  --chart-2: ${chart2};
  --chart-3: ${chart3};
  --chart-4: ${chart4};
  --chart-5: ${chart5};
  --chart-active-dot: #000;
}

@theme inline {
  --color-main: var(--main);
  --color-background: var(--background);
  --color-secondary-background: var(--secondary-background);
  --color-foreground: var(--foreground);
  --color-main-foreground: var(--main-foreground);
  --color-border: var(--border);
  --color-overlay: var(--overlay);
  --color-ring: var(--ring);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);

  --spacing-boxShadowX: ${boxShadowLength[0]}px;
  --spacing-boxShadowY: ${boxShadowLength[1]}px;
  --spacing-reverseBoxShadowX: -${boxShadowLength[0]}px;
  --spacing-reverseBoxShadowY: -${boxShadowLength[1]}px;
  --radius-base: ${borderRadius}px;
  --shadow-shadow: var(--shadow);
  --font-weight-base: ${fontWeight[1]};
  --font-weight-heading: ${fontWeight[0]};
}

@layer base {
  body {
    @apply text-foreground font-base bg-background;
  }

  h1, h2, h3, h4, h5, h6{
    @apply font-heading;
  }
}
```

### 2.1 Fully expanded with the defaults (output for mode=monochromatic, palette=blue, radius 5, shadow 4/4, weights 700/500)

```css
@import "tailwindcss";
@import "tw-animate-css";

/* Neobrutalism monochromatic palette: blue */
:root {
  --background: hsl(214, 95%, 93%);
  --secondary-background: oklch(100% 0 0);
  --foreground: oklch(0% 0 0);
  --main-foreground: oklch(0% 0 0);
  --main: hsl(217, 100%, 66%);
  --border: oklch(0% 0 0);
  --ring: oklch(0% 0 0);
  --overlay: oklch(0% 0 0 / 0.8);
  --shadow: 4px 4px 0px 0px var(--border);
  --chart-1: #5294FF;
  --chart-2: #FF4D50;
  --chart-3: #FACC00;
  --chart-4: #05E17A;
  --chart-5: #7A83FF;
  --chart-active-dot: #000;
}

@theme inline {
  --color-main: var(--main);
  --color-background: var(--background);
  --color-secondary-background: var(--secondary-background);
  --color-foreground: var(--foreground);
  --color-main-foreground: var(--main-foreground);
  --color-border: var(--border);
  --color-overlay: var(--overlay);
  --color-ring: var(--ring);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);

  --spacing-boxShadowX: 4px;
  --spacing-boxShadowY: 4px;
  --spacing-reverseBoxShadowX: -4px;
  --spacing-reverseBoxShadowY: -4px;
  --radius-base: 5px;
  --shadow-shadow: var(--shadow);
  --font-weight-base: 500;
  --font-weight-heading: 700;
}

@layer base {
  body {
    @apply text-foreground font-base bg-background;
  }

  h1, h2, h3, h4, h5, h6{
    @apply font-heading;
  }
}
```

> No dark-mode block, and no `prefers-color-scheme` anywhere. The only dark rules on the
> deployed site are Tailwind's `dark:` variant (media-query strategy) used by two demo
> examples — see §5.

### 2.2 What the generated CSS deliberately does NOT contain

Structurally important for a reimplementation: the emitted project CSS **hard-codes px
numbers** instead of referencing intermediate variables, and drops several tokens the site's
own stylesheet has. Missing from the emitted block (present in `src/styling/globals.css`):

- `--border-radius`, `--box-shadow-x`, `--box-shadow-y`, `--reverse-box-shadow-x`,
  `--reverse-box-shadow-y` — the emitted CSS writes `--radius-base: 5px` and
  `--spacing-boxShadow*: 4px` directly, so there is no single-knob `--box-shadow-x` to read.
- `--heading-font-weight`, `--base-font-weight` — emitted as raw numbers directly in
  `--font-weight-base` / `--font-weight-heading`.
- `--base-font-family` and any `font-family` declaration — the selected font is **not** part
  of the copied CSS (see §6).
- `--shadow-nav`, `--animate-marquee`, `--animate-marquee2`, `--animate-orbit`,
  `--animate-orbit-reverse`, `--spacing-container`, the scrollbar rules and the `@utility
  px-*` 8-bit pixel utilities (see §3 and §7).
- `--color-chart-active-dot` — `--chart-active-dot` is emitted but is **not** mapped into
  `@theme inline` (components use it raw as `fill: "var(--chart-active-dot)"`).

### 2.3 Second generated block — the CLI tab's `cliOverrides` (`styling.tsx` lines 307–319, verbatim template)

The dialog's `Shadcn CLI` tab says "Then update these in your globals.css to match your
radius, shadow and font weights:" and shows:

```
:root {
  --shadow: ${boxShadowLength[0]}px ${boxShadowLength[1]}px 0px 0px var(--border);
}

@theme inline {
  --spacing-boxShadowX: ${boxShadowLength[0]}px;
  --spacing-boxShadowY: ${boxShadowLength[1]}px;
  --spacing-reverseBoxShadowX: -${boxShadowLength[0]}px;
  --spacing-reverseBoxShadowY: -${boxShadowLength[1]}px;
  --radius-base: ${borderRadius}px;
  --font-weight-base: ${fontWeight[1]};
  --font-weight-heading: ${fontWeight[0]};
}
```

Expanded with defaults it is identical to the corresponding lines of §2.1 (a comment in the
source states: "The registry item installs the palette with a 5px radius, a 4px shadow and
500/700 font weights. This is what the Manual CSS sets on top of that").

### 2.4 The registry (CLI) form of the same theme — `public/r/styling/blue.json` verbatim

```json
{
  "$schema": "https://ui.shadcn.com/schema/registry-item.json",
  "name": "neobrutalism-blue",
  "type": "registry:style",
  "extends": "none",
  "title": "Neobrutalism Blue",
  "description": "A collection of neobrutalism-styled components based on shadcn/ui.",
  "dependencies": [
    "tw-animate-css",
    "class-variance-authority",
    "lucide-react"
  ],
  "registryDependencies": [
    "utils",
    "https://neobrutalism.dev/r/button.json"
  ],
  "cssVars": {
    "light": {
      "background": "hsl(214, 95%, 93%)",
      "secondary-background": "oklch(100% 0 0)",
      "main": "hsl(217, 100%, 66%)",
      "ring": "oklch(0% 0 0)",
      "foreground": "oklch(0% 0 0)",
      "main-foreground": "oklch(0% 0 0)",
      "border": "oklch(0% 0 0)",
      "overlay": "oklch(0% 0 0 / 0.8)",
      "shadow": "4px 4px 0px 0px var(--border)",
      "chart-1": "#5294FF",
      "chart-2": "#FF4D50",
      "chart-3": "#FACC00",
      "chart-4": "#05E17A",
      "chart-5": "#7A83FF",
      "chart-active-dot": "#000"
    },
    "theme": {
      "color-main": "var(--main)",
      "color-background": "var(--background)",
      "color-secondary-background": "var(--secondary-background)",
      "color-foreground": "var(--foreground)",
      "color-main-foreground": "var(--main-foreground)",
      "color-border": "var(--border)",
      "color-ring": "var(--ring)",
      "color-overlay": "var(--overlay)",
      "color-chart-1": "var(--chart-1)",
      "color-chart-2": "var(--chart-2)",
      "color-chart-3": "var(--chart-3)",
      "color-chart-4": "var(--chart-4)",
      "color-chart-5": "var(--chart-5)",
      "spacing-boxShadowX": "4px",
      "spacing-boxShadowY": "4px",
      "spacing-reverseBoxShadowX": "-4px",
      "spacing-reverseBoxShadowY": "-4px",
      "radius-base": "5px",
      "font-weight-base": "500",
      "font-weight-heading": "700",
      "shadow-shadow": "var(--shadow)",
      "animate-marquee": "marquee 5s linear infinite",
      "animate-marquee2": "marquee2 5s linear infinite"
    }
  },
  "css": {
    "@import \"tw-animate-css\"": {},
    "@layer base": {
      "body": {
        "font-weight": "var(--font-weight-base)",
        "color": "var(--foreground)"
      },
      "h1, h2, h3, h4, h5, h6": {
        "font-weight": "var(--font-weight-heading)"
      }
    },
    "@keyframes marquee": {
      "0%": { "transform": "translateX(0%)" },
      "100%": { "transform": "translateX(-100%)" }
    },
    "@keyframes marquee2": {
      "0%": { "transform": "translateX(100%)" },
      "100%": { "transform": "translateX(0%)" }
    },
    "body, .scrollbar": {
      "--sb-track-color": "#ffffff",
      "--sb-thumb-color": "#000000"
    },
    ".scrollbar::-webkit-scrollbar": { "width": "16px" },
    ".scrollbar::-webkit-scrollbar-track": { "background": "var(--sb-track-color)" },
    ".scrollbar::-webkit-scrollbar-thumb": { "background": "var(--sb-thumb-color)" },
    "@supports not selector(::-webkit-scrollbar)": {
      ".scrollbar": { "scrollbar-color": "var(--sb-thumb-color) var(--sb-track-color)" }
    }
  }
}
```

(Line breaks in the `css` object above are collapsed for readability of the JSON keys; the
generator's exact object is `src/scripts/add-registry-styles.ts` lines 31–135, quoted in §8.)

---

## 3. `src/styling/globals.css` — full verbatim contents (319 lines)

This is the site's own stylesheet (the token source of truth the registry items mirror).

```css
@import "tailwindcss";
@import "tw-animate-css";

@plugin "@tailwindcss/typography";

:root {
  --border-radius: 5px;
  --box-shadow-x: 4px;
  --box-shadow-y: 4px;
  --reverse-box-shadow-x: -4px;
  --reverse-box-shadow-y: -4px;

  --heading-font-weight: 700;
  --base-font-weight: 500;
  /* Any Google font works here. --font-dm-sans is set by next/font on <html>. */
  --base-font-family: var(--font-dm-sans), sans-serif;

  --background: hsl(214, 95%, 93%);
  --secondary-background: oklch(100% 0 0);
  --foreground: oklch(0% 0 0);
  --main-foreground: oklch(0% 0 0);

  --main: hsl(217, 100%, 66%);
  --border: oklch(0% 0 0);
  --ring: oklch(0% 0 0);
  --overlay: oklch(0% 0 0 / 0.8);

  --shadow: var(--box-shadow-x) var(--box-shadow-y) 0px 0px var(--border);

  --chart-1: #5294ff;
  --chart-2: #ff4d50;
  --chart-3: #facc00;
  --chart-4: #05e17a;
  --chart-5: #7a83ff;
  --chart-active-dot: #000;
}

@theme inline {
  --color-main: var(--main);
  --color-background: var(--background);
  --color-secondary-background: var(--secondary-background);
  --color-foreground: var(--foreground);
  --color-main-foreground: var(--main-foreground);
  --color-border: var(--border);
  --color-overlay: var(--overlay);
  --color-ring: var(--ring);

  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);

  --spacing-boxShadowX: var(--box-shadow-x);
  --spacing-boxShadowY: var(--box-shadow-y);
  --spacing-reverseBoxShadowX: var(--reverse-box-shadow-x);
  --spacing-reverseBoxShadowY: var(--reverse-box-shadow-y);

  --radius-base: var(--border-radius);

  --shadow-shadow: var(--shadow);
  --shadow-nav: 4px 4px 0px 0px var(--border);

  --font-weight-base: var(--base-font-weight);
  --font-weight-heading: var(--heading-font-weight);

  --animate-marquee: marquee 5s linear infinite;
  --animate-marquee2: marquee2 5s linear infinite;
  --animate-orbit: orbit 180s linear infinite;
  --animate-orbit-reverse: orbit 180s linear infinite reverse;

  --spacing-container: 1300px;

  @keyframes marquee {
    0% {
      transform: translateX(0%);
    }
    100% {
      transform: translateX(-100%);
    }
  }

  @keyframes marquee2 {
    0% {
      transform: translateX(100%);
    }
    100% {
      transform: translateX(0%);
    }
  }

  @keyframes orbit {
    from {
      rotate: 0deg;
    }
    to {
      rotate: 360deg;
    }
  }
}

@layer base {
  body {
    @apply text-foreground font-base relative;
    font-family: var(--base-font-family);
  }

  h1,
  h2,
  h3,
  h4,
  h5,
  h6 {
    @apply font-heading;
  }
}

body,
.scrollbar {
  --sb-track-color: #ffffff;
  --sb-thumb-color: #000000;
}

.scrollbar::-webkit-scrollbar {
  width: 16px;
}

body::-webkit-scrollbar {
  width: 20px;
}

.toc-scrollbar::-webkit-scrollbar {
  width: 0px;
}

body::-webkit-scrollbar-track,
.scrollbar::-webkit-scrollbar-track {
  background: var(--sb-track-color);
}

body::-webkit-scrollbar-track {
  border-left: 4px solid #000;
}

body::-webkit-scrollbar-thumb,
.scrollbar::-webkit-scrollbar-thumb {
  background: var(--sb-thumb-color);
}

.code::-webkit-scrollbar-track {
  background: transparent;
}

.code::-webkit-scrollbar-thumb {
  background: white;
}

.code::-webkit-scrollbar {
  width: 10px;
  height: 10px;
  border: 0 !important;
}

.code::-webkit-scrollbar-corner {
  background: transparent !important;
  border: 0 !important;
}

.command-scrollbar::-webkit-scrollbar {
  width: 10px;
}

.command-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}

.command-scrollbar::-webkit-scrollbar-thumb {
  background: #000;
}

@supports not selector(::-webkit-scrollbar) {
  body,
  .scrollbar {
    scrollbar-color: var(--sb-thumb-color) var(--sb-track-color);
  }

  .command-scrollbar {
    scrollbar-color: #000 transparent;
  }
}

/* 8-bit pixel utilities (from 8bit.cnlibs.com) */
@utility px-rounded-md {
  --px: var(--pixel-size, 3px);
  --px2: calc(var(--pixel-size, 3px) * 2);
  --px-shape: polygon(
    0 var(--px2),
    var(--px) var(--px2),
    var(--px) var(--px),
    var(--px2) var(--px),
    var(--px2) 0,
    calc(100% - var(--px2)) 0,
    calc(100% - var(--px2)) var(--px),
    calc(100% - var(--px)) var(--px),
    calc(100% - var(--px)) var(--px2),
    100% var(--px2),
    100% calc(100% - var(--px2)),
    calc(100% - var(--px)) calc(100% - var(--px2)),
    calc(100% - var(--px)) calc(100% - var(--px)),
    calc(100% - var(--px2)) calc(100% - var(--px)),
    calc(100% - var(--px2)) 100%,
    var(--px2) 100%,
    var(--px2) calc(100% - var(--px)),
    var(--px) calc(100% - var(--px)),
    var(--px) calc(100% - var(--px2)),
    0 calc(100% - var(--px2))
  );
  clip-path: var(--px-shape);
  border-radius: 0;
}

@utility px-border-md {
  isolation: isolate;
  position: relative;

  &::before {
    --px: var(--pixel-size, 3px);
    --px2: calc(var(--pixel-size, 3px) * 2);
    --pw: var(--px-border-width, 2px);
    --pxw: calc(var(--px) + var(--pw));
    --px2w: calc(var(--px2) + var(--pw));
    inset: var(--px-border-offset, 0px);
    z-index: -1;
    pointer-events: none;
    content: "";
    background: var(--px-border-color, var(--border));
    clip-path: polygon(
      0 var(--px2),
      var(--px) var(--px2),
      var(--px) var(--px),
      var(--px2) var(--px),
      var(--px2) 0,
      calc(100% - var(--px2)) 0,
      calc(100% - var(--px2)) var(--px),
      calc(100% - var(--px)) var(--px),
      calc(100% - var(--px)) var(--px2),
      100% var(--px2),
      100% calc(100% - var(--px2)),
      calc(100% - var(--px)) calc(100% - var(--px2)),
      calc(100% - var(--px)) calc(100% - var(--px)),
      calc(100% - var(--px2)) calc(100% - var(--px)),
      calc(100% - var(--px2)) 100%,
      var(--px2) 100%,
      var(--px2) calc(100% - var(--px)),
      var(--px) calc(100% - var(--px)),
      var(--px) calc(100% - var(--px2)),
      0 calc(100% - var(--px2)),
      0 var(--px2),
      var(--pw) var(--px2w),
      var(--pw) calc(100% - var(--px2w)),
      var(--pxw) calc(100% - var(--px2w)),
      var(--pxw) calc(100% - var(--pxw)),
      var(--px2w) calc(100% - var(--pxw)),
      var(--px2w) calc(100% - var(--pw)),
      calc(100% - var(--px2w)) calc(100% - var(--pw)),
      calc(100% - var(--px2w)) calc(100% - var(--pxw)),
      calc(100% - var(--pxw)) calc(100% - var(--pxw)),
      calc(100% - var(--pxw)) calc(100% - var(--px2w)),
      calc(100% - var(--pw)) calc(100% - var(--px2w)),
      calc(100% - var(--pw)) var(--px2w),
      calc(100% - var(--pxw)) var(--px2w),
      calc(100% - var(--pxw)) var(--pxw),
      calc(100% - var(--px2w)) var(--pxw),
      calc(100% - var(--px2w)) var(--pw),
      var(--px2w) var(--pw),
      var(--px2w) var(--pxw),
      var(--pxw) var(--pxw),
      var(--pxw) var(--px2w),
      var(--pw) var(--px2w)
    );
    position: absolute;
  }
}

@utility px-ring {
  isolation: isolate;
  position: relative;

  &:focus-visible {
    background-color: var(--px-ring-color, var(--ring));
  }

  &::after {
    inset: var(--px-face-offset, var(--px-ring-width, 2px));
    z-index: -2;
    pointer-events: none;
    content: "";
    background: var(--px-bg, transparent);
    clip-path: var(--px-shape, none);
    position: absolute;
  }
}

@layer components {
  /* Landing hero star ring on phones: as large as fits below the 70px navbar,
     never smaller than the 300px it started with. The desktop size is set by
     the md: utilities on the element. */
  [data-slot="star-ring"] {
    --rx: max(300px, calc(50vh - 67px));
    --ry: max(300px, calc(50vh - 67px));
  }

  @supports (height: 1dvh) {
    [data-slot="star-ring"] {
      --rx: max(300px, calc(50dvh - 67px));
      --ry: max(300px, calc(50dvh - 67px));
    }
  }
}
```

Sibling stylesheet `src/styling/marquee.css` holds only marquee animation rules
(`--gap`, `--duration`) — not part of the token system. `src/styling/code.css` holds
Shiki/rehype-pretty-code rules and the `[data-theme="light"|"dark"] { display: block|none }`
pair (that is **code-block theme switching, unrelated to color scheme**).

---

## 4. Naming conventions

### 4.1 Custom properties

`:root` tokens (site stylesheet — the "source" form):

| Token | Default | Consumed by |
|---|---|---|
| `--border-radius` | `5px` | `--radius-base` in `@theme inline` |
| `--box-shadow-x` | `4px` | `--shadow`, `--spacing-boxShadowX` |
| `--box-shadow-y` | `4px` | `--shadow`, `--spacing-boxShadowY` |
| `--reverse-box-shadow-x` | `-4px` | `--spacing-reverseBoxShadowX` |
| `--reverse-box-shadow-y` | `-4px` | `--spacing-reverseBoxShadowY` |
| `--heading-font-weight` | `700` | `--font-weight-heading` |
| `--base-font-weight` | `500` | `--font-weight-base` |
| `--base-font-family` | `var(--font-dm-sans), sans-serif` | `body { font-family }` |
| `--background` | `hsl(214, 95%, 93%)` | `--color-background` |
| `--secondary-background` | `oklch(100% 0 0)` | `--color-secondary-background` |
| `--foreground` | `oklch(0% 0 0)` | `--color-foreground` |
| `--main` | `hsl(217, 100%, 66%)` | `--color-main` |
| `--main-foreground` | `oklch(0% 0 0)` | `--color-main-foreground` |
| `--border` | `oklch(0% 0 0)` | `--color-border` |
| `--ring` | `oklch(0% 0 0)` | `--color-ring` |
| `--overlay` | `oklch(0% 0 0 / 0.8)` | `--color-overlay` |
| `--shadow` | `var(--box-shadow-x) var(--box-shadow-y) 0px 0px var(--border)` | `--shadow-shadow` |
| `--chart-1` | `#5294ff` | `--color-chart-1` |
| `--chart-2` | `#ff4d50` | `--color-chart-2` |
| `--chart-3` | `#facc00` | `--color-chart-3` |
| `--chart-4` | `#05e17a` | `--color-chart-4` |
| `--chart-5` | `#7a83ff` | `--color-chart-5` |
| `--chart-active-dot` | `#000` | read raw by chart examples (`fill: "var(--chart-active-dot)"`); **no** `@theme` mapping |

`@theme inline` mappings (Tailwind v4 namespaces): `--color-*`, `--spacing-boxShadowX`,
`--spacing-boxShadowY`, `--spacing-reverseBoxShadowX`, `--spacing-reverseBoxShadowY`,
`--spacing-container: 1300px`, `--radius-base`, `--shadow-shadow`, `--shadow-nav`,
`--font-weight-base`, `--font-weight-heading`, `--animate-marquee`, `--animate-marquee2`,
`--animate-orbit`, `--animate-orbit-reverse` (plus inline `@keyframes marquee`, `marquee2`,
`orbit`).

Naming rules to reuse:
- Color tokens are **bare** semantic names (`--main`, `--border`, `--background`), not
  `--color-*`; the `--color-` prefix exists only on the `@theme inline` side, i.e.
  `--main` → `--color-main` → utilities `bg-main`, `text-main-foreground`, `border-border`.
- The **shadow is a `--shadow` custom property**, exposed as the utility `shadow-shadow`
  via `--shadow-shadow`. There is no `--shadow-sm/-lg` scale (that is neubrutalism.com's
  token set, a different project).
- The **radius is `--border-radius`** in the site stylesheet (not `--radius-base`), exposed
  as `rounded-base` via `--radius-base`. In the emitted project CSS the token is
  `--radius-base` directly (there is no `--border-radius`).
- Offsets are also exposed as **spacing** tokens so `translate-x-boxShadowX` /
  `translate-y-boxShadowY` (and the `reverse` pair) work as Tailwind utilities.

### 4.2 Utility/class names actually used by components

Counts across `src/components/ui/*.tsx`:

| Class | Uses |
|---|---|
| `border-border` | 133 |
| `font-base` | 87 |
| `rounded-base` | 84 |
| `border-2` | 81 |
| `font-heading` | 38 |
| `round-full` variants (`rounded-full`) | 17 |
| `shadow-shadow` | 11 |
| `shadow-none` | 10 |
| `translate-y-boxShadowY` / `translate-x-boxShadowX` | 2 / 2 |
| `translate-x-reverseBoxShadowX` / `translate-y-reverseBoxShadowY` | 1 / 1 |
| `shadow-nav` | 3 (site chrome only: `src/components/app/navbar.tsx`, `search.tsx`) |

**Defaults, stated exactly:**
- **Border width default: `border-2` = 2px**, hard-coded per component. There is **no**
  `--border-width` token anywhere in the repo, and no global `*` border rule. The 8-bit
  pixel utilities use their own `--px-border-width` (default `2px`) and `--pixel-size`
  (default `3px`).
- **Border color default: `--border: oklch(0% 0 0)`** (pure black, OKLCH), used as
  `border-border`.
- **Border radius default: 5px** (`--border-radius: 5px` / `--radius-base: 5px`).
  `.rounded-base { border-radius: var(--border-radius) }` in the compiled site CSS;
  in an installed project `.rounded-base { border-radius: var(--radius-base) }`.
- **Shadow default: `4px 4px 0px 0px var(--border)`** — i.e. x=4px, y=4px, blur 0, spread 0,
  color = the border color. Utility: `shadow-shadow`. Compiled: `.shadow-shadow{--tw-shadow:var(--shadow)}`
  then `box-shadow: var(--tw-inset-shadow), var(--tw-inset-ring-shadow), var(--tw-ring-offset-shadow), var(--tw-ring-shadow), var(--tw-shadow)`.
  A second, non-tokenised `--shadow-nav: 4px 4px 0px 0px var(--border)` exists for the navbar
  (`shadow-nav`).
- **Font weight defaults: heading `700`, base `500`** (`font-heading`, `font-base`).
- **Exact default colors:** `--background: hsl(214, 95%, 93%)` (deployed CSS minifies to
  `#dcebfe`), `--main: hsl(217, 100%, 66%)` (→ `#5294ff`),
  `--secondary-background: oklch(100% 0 0)`, `--foreground: oklch(0% 0 0)`,
  `--main-foreground: oklch(0% 0 0)`, `--border: oklch(0% 0 0)`, `--ring: oklch(0% 0 0)`,
  `--overlay: oklch(0% 0 0 / 0.8)`, charts `#5294FF #FF4D50 #FACC00 #05E17A #7A83FF`,
  `--chart-active-dot: #000`. Mixed color spaces on purpose: palette `main`/`bg` are `hsl()`
  (from the design tool), neutrals are `oklch()`, charts are hex.

### 4.3 Canonical component class strings (verbatim)

`src/components/ui/button.tsx` — variants (this is where the "shadow becomes a translate"
idiom lives):

```tsx
      variant: {
        default:
          "text-main-foreground bg-main border-2 border-border shadow-shadow hover:translate-x-boxShadowX hover:translate-y-boxShadowY hover:shadow-none",
        noShadow: "text-main-foreground bg-main border-2 border-border",
        neutral:
          "bg-secondary-background text-foreground border-2 border-border shadow-shadow hover:translate-x-boxShadowX hover:translate-y-boxShadowY hover:shadow-none",
        reverse:
          "text-main-foreground bg-main border-2 border-border hover:translate-x-reverseBoxShadowX hover:translate-y-reverseBoxShadowY hover:shadow-shadow",
      },
      size: {
        default: "h-10 px-4 py-2",
        xs: "h-8 gap-1.5 px-2.5 text-xs [&_svg]:size-3.5",
        sm: "h-9 px-3",
        lg: "h-11 px-8",
        icon: "size-10",
        "icon-xs": "size-8 [&_svg]:size-3.5",
        "icon-sm": "size-9",
        "icon-lg": "size-11",
      },
```

with the shared base string:

```tsx
"inline-flex items-center justify-center whitespace-nowrap rounded-base text-sm font-base ring-offset-white transition-all gap-2 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-disabled:pointer-events-none data-disabled:opacity-50"
```

`src/components/ui/input.tsx`:

```tsx
        "flex h-10 w-full rounded-base border-2 border-border bg-secondary-background selection:bg-main selection:text-main-foreground px-3 py-2 text-sm font-base text-foreground file:border-0 file:bg-transparent file:text-sm file:font-heading placeholder:text-foreground/50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
```

`src/components/ui/card.tsx`:

```tsx
        "group/card rounded-base flex flex-col shadow-shadow border-2 gap-(--card-spacing) py-(--card-spacing) border-border bg-background text-foreground font-base [--card-spacing:--spacing(6)] data-[size=sm]:[--card-spacing:--spacing(4)]"
```

Pattern summary: `rounded-base` + `border-2` + `border-border` + (`shadow-shadow` or
`bg-secondary-background`) + `font-base`/`font-heading`; focus ring is
Tailwind's ring (`focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2`),
**not** an `outline`; hover on the default variant moves the element by exactly the shadow
offset and removes the shadow (`hover:translate-x-boxShadowX hover:translate-y-boxShadowY
hover:shadow-none`); the `reverse` variant starts flat and grows the shadow.

---

## 5. Dark mode

**There is none in the token system.** Concretely:

- No `.dark` selector, no `[data-theme]` token block, no `class`/`selector` dark-mode
  strategy, no theme toggle in the site chrome (`src/components/app/navbar.tsx` has a search
  button and links only), no `darkMode` key in `next.config.mjs`.
- The deployed CSS bundle `c1b954fcfdc612d4.css` contains exactly **one**
  `@media (prefers-color-scheme:dark)` block and it only holds two Tailwind `dark:` variant
  utilities generated from two demo files:
  `.dark\:bg-green-800` (`src/examples/ui/avatar/badge.tsx`:
  `<AvatarBadge className="bg-green-600 dark:bg-green-800" />`) and `.dark\:brightness-40`
  (`src/examples/ui/card/image.tsx`). `[data-theme="light"|"dark"]` appears only in
  `src/styling/code.css`, where it toggles which syntax-highlighting theme is displayed
  (`display: block` / `display: none`) — unrelated to UI color scheme.
- The 30 registry style items only carry `cssVars.light` and `cssVars.theme`; there is no
  `cssVars.dark` key.
- The "Color Mode" control in the configurator means **Monochromatic vs Duotone palettes**,
  not light/dark.

So: `dark` = not implemented upstream. If barnacle needs dark mode it is a new design
decision, not a port. (The 8-bit `px-*` utilities and `--overlay` are the only other
theme-adjacent hooks.)

---

## 6. Fonts

Fonts **are** configurable in the configurator (a `Select` of 20 Google fonts, §1 #3), but
the selected font is **not written into the generated CSS**. `installation.mdx` step 2 says
only: "Pick a font from the styling page and load it in your project like any other Google
font." On the site itself the pick is applied by injecting a
`https://fonts.googleapis.com/css2?family=<Name>:wght@...&display=swap` `<link>` and setting
`--base-font-family` on `:root` (see `src/lib/google-fonts.ts`, which also defines
`FONT_FAMILY_VARIABLE = "--base-font-family"`, `GOOGLE_FONT_LINK_ID = "google-font-stylesheet"`,
`fontFamilyValue(family) => '"<Family>", sans-serif'`).

`src/data/fonts.ts` verbatim:

```ts
export type GoogleFont = {
  name: string
  // Weights available on Google Fonts. Only weights a font actually has are
  // requested, because the Google Fonts API rejects the whole request otherwise.
  weights: number[]
}

export const DEFAULT_FONT_NAME = "DM Sans"

const ALL_WEIGHTS = [400, 500, 600, 700, 800, 900]

const fonts: GoogleFont[] = [
  { name: "DM Sans", weights: ALL_WEIGHTS },
  { name: "Archivo", weights: ALL_WEIGHTS },
  { name: "Archivo Black", weights: [400] },
  { name: "Bricolage Grotesque", weights: [400, 500, 600, 700, 800] },
  { name: "Chivo", weights: ALL_WEIGHTS },
  { name: "Geist", weights: ALL_WEIGHTS },
  { name: "IBM Plex Sans", weights: [400, 500, 600, 700] },
  { name: "Inter", weights: ALL_WEIGHTS },
  { name: "Instrument Sans", weights: [400, 500, 600, 700] },
  { name: "Lexend", weights: ALL_WEIGHTS },
  { name: "Manrope", weights: [400, 500, 600, 700, 800] },
  { name: "Outfit", weights: ALL_WEIGHTS },
  { name: "Poppins", weights: ALL_WEIGHTS },
  { name: "Public Sans", weights: ALL_WEIGHTS },
  { name: "Rubik", weights: ALL_WEIGHTS },
  { name: "Sora", weights: [400, 500, 600, 700, 800] },
  { name: "Space Grotesk", weights: [400, 500, 600, 700] },
  { name: "Space Mono", weights: [400, 700] },
  { name: "Syne", weights: [400, 500, 600, 700, 800] },
  { name: "Work Sans", weights: ALL_WEIGHTS },
]

export default fonts
```

**Default font: DM Sans**, loaded on the site with `next/font` (`src/app/layout.tsx`):

```tsx
const dmSans = DM_Sans({
  subsets: ["latin"],
  display: "swap",
  adjustFontFallback: false,
  variable: "--font-dm-sans",
})
```
applied as `<html className={`${dmSans.variable} scroll-smooth`} lang="en">`, with
`--base-font-family: var(--font-dm-sans), sans-serif;` in `globals.css`.

---

## 7. Component defaults vs computed CSS — quick map

| Configurator knob | Token written | Utility | Computed CSS |
|---|---|---|---|
| Border Radius 0/5/10/15 | `--border-radius: Npx` (site) or `--radius-base: Npx` (emitted) | `rounded-base` | `border-radius: var(--border-radius)` / `var(--radius-base)` |
| Horizontal Box Shadow −4…4 | `--box-shadow-x: Npx` (site) / `--spacing-boxShadowX: Npx` (emitted) | `translate-x-boxShadowX` | `translate-x: Npx` (and `--shadow`'s first length) |
| Vertical Box Shadow −4…4 | `--box-shadow-y: Npx` | `translate-y-boxShadowY` | same |
| (derived) | `--reverse-box-shadow-x/y: -Npx` | `translate-x/y-reverseBoxShadowX/Y` | negative travel for the `reverse` variant |
| Heading Font Weight 700/800/900 | `--heading-font-weight: N` | `font-heading` | `font-weight: N` |
| Base Font Weight 500/600/700 | `--base-font-weight: N` | `font-base` | `font-weight: N` |
| Color Mode + Color | `--background`, `--main`, `--chart-1..5` | `bg-background`, `bg-main`, `text-main-foreground`, `border-border`, `bg-secondary-background` | the palette values |
| — | `--shadow` | `shadow-shadow` | `box-shadow: Npx Npx 0 0 var(--border)` |
| — (fixed) | `--border` | `border-border`, `border-2` | `border: 2px solid oklch(0% 0 0)` |
| Font | `--base-font-family` (site preview only) | — | not emitted into project CSS |

---

## 8. `src/scripts/add-registry-styles.ts` — how the registry items are generated (verbatim, lines 24–97)

```ts
// Everything below mirrors src/styling/globals.css. Each palette compiles to
// a registry:style item that `shadcn init <url>` writes into a fresh
// project's globals.css, so it has to carry every token and rule the ui
// components depend on, not just the palette colours. Keep the two in sync.

// @theme inline tokens. The CLI adds a --color-* entry for every colour in
// cssVars.light on its own; the rest are listed here.
const THEME = {
  "color-main": "var(--main)",
  "color-background": "var(--background)",
  "color-secondary-background": "var(--secondary-background)",
  "color-foreground": "var(--foreground)",
  "color-main-foreground": "var(--main-foreground)",
  "color-border": "var(--border)",
  "color-ring": "var(--ring)",
  "color-overlay": "var(--overlay)",
  "color-chart-1": "var(--chart-1)",
  "color-chart-2": "var(--chart-2)",
  "color-chart-3": "var(--chart-3)",
  "color-chart-4": "var(--chart-4)",
  "color-chart-5": "var(--chart-5)",
  "spacing-boxShadowX": "4px",
  "spacing-boxShadowY": "4px",
  "spacing-reverseBoxShadowX": "-4px",
  "spacing-reverseBoxShadowY": "-4px",
  "radius-base": "5px",
  "font-weight-base": "500",
  "font-weight-heading": "700",
  "shadow-shadow": "var(--shadow)",
  "animate-marquee": "marquee 5s linear infinite",
  "animate-marquee2": "marquee2 5s linear infinite",
}

// Extra CSS the components need beyond tokens: the tw-animate-css import
// (dialogs, sheets and so on use its animate-in utilities), the base font
// weights, the marquee keyframes and the scrollbar styling used by
// scroll-area. The CLI places @keyframes inside @theme inline, like
// globals.css does.
const CSS = {
  '@import "tw-animate-css"': {},
  "@layer base": {
    body: {
      "font-weight": "var(--font-weight-base)",
      color: "var(--foreground)",
    },
    "h1, h2, h3, h4, h5, h6": {
      "font-weight": "var(--font-weight-heading)",
    },
  },
  "@keyframes marquee": {
    "0%": { transform: "translateX(0%)" },
    "100%": { transform: "translateX(-100%)" },
  },
  "@keyframes marquee2": {
    "0%": { transform: "translateX(100%)" },
    "100%": { transform: "translateX(0%)" },
  },
  "body, .scrollbar": {
    "--sb-track-color": "#ffffff",
    "--sb-thumb-color": "#000000",
  },
  ".scrollbar::-webkit-scrollbar": { width: "16px" },
  ".scrollbar::-webkit-scrollbar-track": {
    background: "var(--sb-track-color)",
  },
  ".scrollbar::-webkit-scrollbar-thumb": {
    background: "var(--sb-thumb-color)",
  },
  "@supports not selector(::-webkit-scrollbar)": {
    ".scrollbar": {
      "scrollbar-color": "var(--sb-thumb-color) var(--sb-track-color)",
    },
  },
}
```

Registry naming: monochromatic → `neobrutalism-<name>` written to
`public/r/styling/<name>.json`; duotone → `neobrutalism-<name>-duotone` /
`<name>-duotone.json`. Titles: `Neobrutalism <Name>` and
`Neobrutalism <Name> Duotone`. Every item: `type: "registry:style"`, `extends: "none"`,
dependencies `["tw-animate-css", "class-variance-authority", "lucide-react"]`,
`registryDependencies: ["utils", "https://neobrutalism.dev/r/button.json"]`.

---

## 9. Full palette data (`src/data/colors.ts`, all 30 palettes)

Colors are `hsl()` for `main` and `bg`; charts are 6-digit hex. Format:
`name | main | bg | c1 c2 c3 c4 c5`.

### Monochromatic (17) — used when Color Mode = Monochromatic

| name | main | bg | chart1..5 |
|---|---|---|---|
| red | `hsl(359, 100%, 69%)` | `hsl(0, 100%, 94%)` | `#FF6164` `#5294FF` `#FACC00` `#05E17A` `#7A83FF` |
| orange | `hsl(28, 100%, 51%)` | `hsl(33, 100%, 92%)` | `#FF7A05` `#0099FF` `#FFBF00` `#00D696` `#7A83FF` |
| amber | `hsl(45, 100%, 50%)` | `hsl(48, 96%, 89%)` | `#FFBF00` `#0099FF` `#FF7A05` `#00D696` `#7A83FF` |
| yellow | `hsl(49, 100%, 49%)` | `hsl(54, 92%, 88%)` | `#FACC00` `#7A83FF` `#FF4D50` `#00D696` `#0099FF` |
| lime | `hsl(84, 100%, 45%)` | `hsl(84, 71%, 89%)` | `#8AE500` `#0099FF` `#FF4D50` `#FACC00` `#7A83FF` |
| green | `hsl(152, 96%, 45%)` | `hsl(142, 84%, 93%)` | `#05E17A` `#FF7A05` `#0099FF` `#FFBF00` `#7A83FF` |
| emerald | `hsl(162, 100%, 42%)` | `hsl(156, 84%, 90%)` | `#00D696` `#7A83FF` `#FACC00` `#FF4D50` `#0099FF` |
| teal | `hsl(173, 100%, 42%)` | `hsl(170, 82%, 89%)` | `#00D6BD` `#0099FF` `#7A83FF` `#FF4D50` `#FACC00` |
| cyan | `hsl(190, 100%, 47%)` | `hsl(190, 95%, 90%)` | `#00C8F0` `#FF7A05` `#7A83FF` `#FF4D50` `#FACC00` |
| sky | `hsl(204, 100%, 50%)` | `hsl(207, 89%, 93%)` | `#0099FF` `#FF4D50` `#FACC00` `#05E17A` `#7A83FF` |
| **blue (default)** | `hsl(217, 100%, 66%)` | `hsl(214, 95%, 93%)` | `#5294FF` `#FF4D50` `#FACC00` `#05E17A` `#7A83FF` |
| indigo | `hsl(236, 100%, 76%)` | `hsl(236, 100%, 94%)` | `#858DFF` `#FACC00` `#FF4D50` `#00D696` `#0099FF` |
| violet | `hsl(258, 100%, 76%)` | `hsl(259, 94%, 95%)` | `#A985FF` `#00D696` `#FACC00` `#FF4D50` `#0099FF` |
| purple | `hsl(276, 100%, 74%)` | `hsl(270, 100%, 95%)` | `#CA7AFF` `#FFBF00` `#00D696` `#FF7A05` `#0099FF` |
| fuchsia | `hsl(291, 100%, 71%)` | `hsl(290, 100%, 95%)` | `#E96BFF` `#FACC00` `#FF7A05` `#FF4D50` `#7A83FF` |
| pink | `hsl(332, 96%, 69%)` | `hsl(327, 73%, 95%)` | `#FC64AB` `#FACC00` `#FF7A05` `#FF4D50` `#7A83FF` |
| rose | `hsl(353, 100%, 70%)` | `hsl(355, 100%, 94%)` | `#FF6678` `#7A83FF` `#FACC00` `#00D696` `#5294FF` |

### Duotone (13) — `main` unchanged, `bg` replaced by one shared accent

| name | main | bg | chart1..5 |
|---|---|---|---|
| red | `hsl(359, 100%, 69%)` | `hsl(204, 100%, 80%)` | `#FF6164` `#0099FF` `#FACC00` `#05E17A` `#7A83FF` |
| orange | `hsl(28, 100%, 51%)` | `hsl(204, 100%, 80%)` | `#FF7A05` `#0099FF` `#FFBF00` `#00D696` `#7A83FF` |
| amber | `hsl(45, 100%, 50%)` | `hsl(28, 100%, 80%)` | `#FFBF00` `#FF7A05` `#0099FF` `#00D696` `#7A83FF` |
| yellow | `hsl(49, 100%, 49%)` | `hsl(236, 100%, 80%)` | `#FACC00` `#7A83FF` `#FF4D50` `#00D696` `#0099FF` |
| lime | `hsl(84, 100%, 45%)` | `hsl(204, 100%, 80%)` | `#8AE500` `#0099FF` `#FF4D50` `#FACC00` `#7A83FF` |
| green | `hsl(152, 96%, 45%)` | `hsl(28, 100%, 80%)` | `#05E17A` `#FF7A05` `#0099FF` `#FFBF00` `#7A83FF` |
| emerald | `hsl(162, 100%, 42%)` | `hsl(236, 100%, 80%)` | `#00D696` `#7A83FF` `#FACC00` `#FF4D50` `#0099FF` |
| teal | `hsl(173, 100%, 42%)` | `hsl(204, 100%, 80%)` | `#00D6BD` `#0099FF` `#7A83FF` `#FF4D50` `#FACC00` |
| cyan | `hsl(190, 100%, 47%)` | `hsl(28, 100%, 80%)` | `#00C8F0` `#FF7A05` `#7A83FF` `#FF4D50` `#FACC00` |
| sky | `hsl(204, 100%, 50%)` | `hsl(236, 100%, 80%)` | `#0099FF` `#7A83FF` `#FACC00` `#05E17A` `#FF4D50` |
| violet | `hsl(258, 100%, 76%)` | `hsl(162, 100%, 80%)` | `#A985FF` `#00D696` `#FACC00` `#FF4D50` `#0099FF` |
| fuchsia | `hsl(291, 100%, 71%)` | `hsl(49, 100%, 80%)` | `#E96BFF` `#FACC00` `#FF7A05` `#FF4D50` `#7A83FF` |
| rose | `hsl(353, 100%, 70%)` | `hsl(236, 100%, 80%)` | `#FF6678` `#7A83FF` `#FACC00` `#00D696` `#5294FF` |

The duotone `bg` values are always the same 80%-lightness family:
`hsl(204, 100%, 80%)`, `hsl(28, 100%, 80%)`, `hsl(236, 100%, 80%)`,
`hsl(49, 100%, 80%)`, `hsl(162, 100%, 80%)`. The comment in the source says palettes come
from the "Monochromatic color palettes" and "Duotone mode palettes" frames of the
Neobrutalism components Figma file.

---

## 10. Notes for a different, independent library

Facts worth deciding on explicitly (all of the above is the upstream position):

1. `--main` / `--background` / `--secondary-background` / `--foreground` /
   `--main-foreground` / `--border` / `--ring` / `--overlay` is a *shadcn-compatible* six-to-eight
   token surface. Renaming these breaks drop-in shadcn component compatibility, which is the
   library's main adoption vector.
2. Upstream splits **one** semantic color into `main` (fill) + `main-foreground` (text on
   fill), and `background` + `secondary-background` (inverted surface) + `foreground`. There
   is no `muted`, `accent`, `destructive`, `card`, `popover` or `input` token — `destructive`
   variants are expressed with plain Tailwind reds in the component files.
3. Border width is **not** a token upstream (2px hard-coded), even though the Figma file and
   the wider neobrutalism literature treat stroke width as the signature variable. A new
   library could tokenise it (`--border-width`) without conflicting with any upstream name.
4. The shadow is **one** token (`--shadow`), reachable only as `shadow-shadow`, plus a
   non-tokenised `--shadow-nav`. Offsets are doubled as *spacing* tokens
   (`--spacing-boxShadowX/Y`) so the translate distance and the shadow offset are the same
   number — that is the load-bearing structural idea.
5. Radius is `--border-radius` on the site but `--radius-base` in an installed project — an
   inconsistency worth not copying.
6. No dark mode exists; if barnacle adds one, that is new surface area (upstream's only
   adjacent precedent is the third-party "Neubrutalism CSS" framework flipping the shadow
   color in dark mode).
7. Fonts are a configurator-only concern upstream; the token that matters is
   `--base-font-family` and the two weight tokens.
