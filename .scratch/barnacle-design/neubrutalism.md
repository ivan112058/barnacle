# Neubrutalism (Neo-brutalism) — implementable specification, sourced

**Provenance note up front.** <https://neubrutalism.com/> is **static HTML** — a plain fetch returned the full prose including the `#anatomy` (section 02 "Visual DNA") and `#implementation` (section 05 "Building with Neubrutalism") sections. No JS-rendered mirror or GitHub markdown was needed. `https://neubrutalism.com/#anatomy` and `https://neubrutalism.com/#implementation` serve the same document (fragment-only). Below, **[NB]** = neubrutalism.com itself; everything else is labelled secondary. Where a source is silent, I say "no source states X" rather than inventing a number.

Primary/secondary sources used:

- **[NB]** <https://neubrutalism.com/> (`#anatomy`, `#implementation`, `#usage`)
- **[NN/g]** Hayat Sheikh, "Neobrutalism: Definition and Best Practices," 11 Apr 2025 — <https://www.nngroup.com/articles/neobrutalism/> (NN/g uses the "neobrutalism" spelling; NB quotes it as its epigraph)
- **[NBD]** neobrutalism.dev — React/Tailwind component library by Samuel Breznjak (the "neobrutalism.dev" project NB names as ecosystem Layer 4). Real shipping CSS tokens: <https://raw.githubusercontent.com/ekmas/neobrutalism-components/main/src/styling/globals.css> and <https://raw.githubusercontent.com/ekmas/neobrutalism-components/main/public/r/button.json>
- **[NB-CSS]** OshekharO, "Neubrutalism CSS" minimal framework (README + source CSS): <https://github.com/OshekharO/Neubrutalism>
- **[WCAG]** W3C WAI, Understanding SC 2.4.13 Focus Appearance — <https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html> ; WCAG 2.2 REC <https://www.w3.org/TR/WCAG22/>
- **[MDN]** <https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/box-shadow>
- **[SM]** Smashing Magazine, "The Split Personality Of Brutalist Web Development" (2020) — <https://www.smashingmagazine.com/2020/01/split-personality-brutalist-web-development/> (historical context only; it predates neubrutalism as a term and never uses it)

---

## A. Anatomy — constituent elements

### A1. Borders (the signature move)

- **NB**: "The signature neubrutalist move is the **heavy outline**. Cards, buttons, inputs, and illustrations read as if stamped, boxed, or screen-printed… it restores edge clarity in an era of soft cards and low-contrast surfaces." [NB #anatomy §B]
- **Widths, exact (NB token table and snippets):** `--border: 3px solid #000` (default component border); `--border-thin: 2px solid #000` (secondary borders, dividers); `--border-thick: 4px solid #000` (section dividers, hero elements). Prose production rule: "Use a **single canonical stroke width** for most components (e.g., 2–3px). Only deviate intentionally for hierarchy." [NB #implementation, #anatomy §B]
- **Independent library values differ and are useful corroboration of the 2–4px band:** [NBD] uses `border-2` (2px) on buttons/cards with `border-border` defaulting to `oklch(0% 0 0)` (pure black). Its `--border-radius` is **5px**, not 0 — a real-world deviation worth knowing. [NB-CSS] uses `--nb-border-width: 2px`, 3px on modal dialog. So: **0–5px radius, 2–4px border** is the observed real-world band; NB's stated ideal is strictly `border-radius: 0`.
- **Radius:** [NB] shows a three-way comparison and marks `border-radius: 0` as "Neubrutalist" (vs `12px` SaaS, `999px` pill), states "**0px** Ideal border-radius" and "Square corners. That's the point." [NB #anatomy §B, #implementation]. [NBD] ships 5px, [NB-CSS] ships 0.5rem (8px) — i.e. "near-square" is the looser real-world rule, and [NB] itself allows "Prefer square or near-square corners."
- **Border colour:** black. [NB] resolves borders to `#000`; [NBD] to `oklch(0% 0 0)`. Both allow coloured borders on accent variants ("Matching border and shadow color adds personality while keeping structure" — [NB] card variation "Accent").
- **Semantics rule:** "Treat Borders as Semantics — A border should communicate: container, interactive, focus, selected, or error. If it doesn't communicate any of these, remove it." [NB #usage]

### A2. Hard / offset shadow geometry

- **NB**: depth is "**anti-naturalistic**… hard, offset shadows with little or no blur. Elements feel stacked, shifted, or physically misregistered — like printed layers that don't fully align." [NB #anatomy §C]
- **Exact values (NB):** hard offset `5px 5px 0 0 #000`; large offset `10px 10px 0 0 #000`; soft/Material contrast case `0 4px 12px rgba(0,0,0,.15)`; the page's "0 **Blur on hard shadows**" stat.
- **NB's three-tier system (anatomy) / four-tier token table (implementation):**

  | Token | Value | Purpose (NB's own words) |
  |---|---|---|
  | `--shadow-sm` | `3px 3px 0 0 #000` | badges, chips, small controls / inline actions |
  | `--shadow` | `5px 5px 0 0 #000` | cards, buttons, panels |
  | `--shadow-lg` | `8px 8px 0 0 #000` | hover states, overlays / hero elements, focus |
  | `--shadow-xl` | `12px 12px 0 0 #000` | hero elements, dialogs |

  Also shown in NB's live select: "Extra Large (12px 12px 0 0 #000)".
- **Geometry rule:** offset is **equal on x and y and positive (down-right)** in every NB example. No NB source shows a negative or asymmetric offset. 4th value (spread) is always `0`.
- **Corroboration:** [NN/g]: "solid, single-color shadows (e.g., a black drop shadow offset by **4px**)". [NBD] composes its shadow from parts: `--box-shadow-x: 4px; --box-shadow-y: 4px; --shadow: var(--box-shadow-x) var(--box-shadow-y) 0px 0px var(--border);` plus `--reverse-box-shadow-x: -4px; --reverse-box-shadow-y: -4px` and a second `--shadow-nav: 4px 4px 0px 0px var(--border)`. Its buttons reference `shadow-shadow`.
  → **The real-world offset band is 3–8px, most commonly 4px; NB's canonical page uses 5px.** [NB-CSS] uses `rgba(0,0,0,0.15)` instead of solid black at 2/4/6/8px (a variant, arguably weaker).
- **Hierarchy warning:** "When every card, chip, button, and tooltip gets equally aggressive shadow, hierarchy collapses." [NB #anatomy §C]

### A3. Colour palette

- **NB**: "categorical, not ambient… **No gradients. Flat fills with pop-art energy. A black-and-white structural base punctuated by one to three saturated accents.**" [NB #anatomy §A]
- **NB's canonical palette, exact hex:** Black `#000000`; Off-White `#FFFDF5`; Bold Yellow `#FFD23F`; Coral Pink `#FF6B6B`; Sky Blue `#74B9FF`; Soft Green `#88D498`; Orange `#FFA552`; Lavender `#B8A9FA`. Tokens: `--bg: #FFFDF5`, `--yellow: #FFD23F`, `--pink: #FF6B6B`, `--blue: #74B9FF`.
- **Structure:** one neutral base + one dark outline colour + limited accents; "Use color to carve surfaces into discrete, identifiable objects"; "Don't let every component compete at maximum saturation"; "Mistake 'loud' for accessible — **yellow on white fails contrast**"; "Rely on color alone to convey state or meaning." [NB #anatomy §A]
- **Numeric constraint:** body text **4.5:1** (WCAG AA); NB repeats "4.5:1 Min contrast (WCAG AA)". [NB #anatomy §A, history stat strip]
- **Theme inversion:** [NBD] ships one neutral/accent set as CSS vars (`--main: hsl(217, 100%, 66%)`, `--background: hsl(214, 95%, 93%)`, `--secondary-background`/`--foreground`/`--border`/`--ring` in `oklch`). [NB-CSS] flips hard-shadow colour in dark mode: light theme `2px 2px 0 rgba(0,0,0,0.15)` → dark theme `2px 2px 0 rgba(255,255,255,0.1)` (i.e. keep the hard edge, invert its colour). [NB] does not specify a dark theme.
- **No source states** a saturation/lightness numeric range (no HSL/OKLCH bounds). NB's palette is high-saturation mid-to-light accents on a warm off-white; that's descriptive, not a stated rule.

### A4. Typography

- **NB**: "**assertive contrast**: oversized sans-serif display headlines, abrupt scale shifts… The best implementations separate expressive display type from calm operational body copy." Body text "should be boring on purpose… Calm paragraph text and predictable spacing." [NB #anatomy §D, #typography]
- **Weights (exact, as demonstrated):** Display Syne **800**; Heading Space Grotesk **700**; Body Inter **400**; Mono Space Mono **400**. NB's three recommended pairings: (1) Syne 800 / Space Grotesk 700 / Inter 400 / Space Mono — this site; (2) Bebas Neue / Plus Jakarta Sans 700 / DM Sans 400 / JetBrains Mono; (3) Archivo Black / Outfit 700 / Inter 400 / Space Mono. All are Google Fonts; NB lists Syne 400–800, Bebas Neue 400, Archivo Black 400, Space Grotesk 300–700, Inter 100–900, Space Mono 400/700, JetBrains Mono 100–800. [NB #typography]
- **Case / tracking:** NB only says "high weight, **tight tracking**" for the impact face and "Contrast via **scale and weight**, not novelty letterforms." [NB #anatomy §D] **No source on neubrutalism.com states a letter-spacing value.** The independent framework [NB-CSS] does: headings `letter-spacing: -0.02em`, `.nb-display-1/2` `font-weight: 900`, `letter-spacing: -0.03em`, `line-height: 1.1`; table headers `text-transform: uppercase; letter-spacing: 0.05em`; heading sizes h1 `2.75rem` → h6 `1rem`, `font-weight: 800`, `line-height: 1.2`; body `line-height: 1.6`. **Treat those as one library's convention, not as the canon.**
- **Don'ts:** don't make the whole type system shout at one volume; no ornate/decorative faces ("loud in scale, not letterform"); don't sacrifice body readability; don't ignore line-height. [NB #anatomy §D]
- **Real-world library defaults:** [NBD] `--heading-font-weight: 700`, `--base-font-weight: 500`, base font DM Sans via `next/font`. [NBD]

### A5. Layout / composition

- "broken but not random": use an underlying grid, then "selectively disrupt… through offset modules, asymmetric spacing, and overscaled elements." Keep nav and reading flows predictable; allow local breaks (offset cards, overlapped panels, rotated elements). **Asymmetry at macro level** (heroes, card stacks, illustrations); **mechanical alignment at micro level** (labels, fields, buttons, error states). "Once disruption interferes with comprehension, the design crosses from expression into sabotage." [NB #anatomy §E]

### A6. Spacing / density

- **No numeric spacing scale is stated by [NB].** Qualitative rules only: body copy needs "generous line-height," "predictable spacing," reserved extreme typographic gestures; [NN/g] notes bold type is "balanced by a generous use of whitespace, creating a visual rhythm that feels deliberate rather than overwhelming."
- For a concrete scale from an independent source: [NB-CSS] ships `--nb-spacing-xs: 0.25rem; sm 0.5rem; md 1rem; lg 1.5rem; xl 2rem; 2xl 3rem; 3xl 4rem`, button padding `0.625rem 1.25rem`, and a `1300px` container token in [NBD] (`--spacing-container: 1300px`). [NB] itself uses `padding: 12px 24px` for the canonical button and `padding: 1.5rem` for the canonical card — **those two are NB's own values**.

### A7. Iconography

- **[NB] states no iconography rules at all** in `#anatomy` or `#implementation`. Closest adjacent evidence: [NN/g] cites "oversized buttons and icons," "thick strokes," and skeuomorphic/retro elements (Windows-98-style buttons, monospace, pixel art) as neobrutalist traits — <https://www.nngroup.com/articles/neobrutalism/>. [NBD] hard-codes icon sizing inside the button class: `[&_svg]:size-4` (1rem), shrinking to `size-3.5` on the `xs`/`icon-xs` sizes, with `[&_svg]:pointer-events-none`. **I found no source that states an icon stroke-width, corner style, or fill rule for neubrutalism** — do not invent one.

---

## B. Implementation — the CSS techniques (most important section)

### B1. Token theming with CSS custom properties

[NB] states the whole style "can be compressed into a handful of CSS custom properties. This is what makes it parameterized and themeable — change the tokens, change the flavor," and gives verbatim:

```css
:root {
  /* The border is the main structural signifier */
  --border: 3px solid #000;

  /* Hard shadows: offset, zero blur, always */
  --shadow-sm: 3px 3px 0 0 #000;
  --shadow:    5px 5px 0 0 #000;
  --shadow-lg: 8px 8px 0 0 #000;

  /* Square corners. That's the point. */
  --radius: 0;

  /* Palette: neutral base + loud accents */
  --bg: #FFFDF5;
  --yellow: #FFD23F;
  --pink:   #FF6B6B;
  --blue:   #74B9FF;
}
```

[NB #implementation, "The Token System"]

**Higher-leverage variant (recommended, and what a shipping library does):** factor the shadow into offsets so you can animate/move the element by exactly the shadow vector. From [NBD]'s real global stylesheet:

```css
:root {
  --border-radius: 5px;
  --box-shadow-x: 4px;
  --box-shadow-y: 4px;
  --reverse-box-shadow-x: -4px;
  --reverse-box-shadow-y: -4px;
  --border: oklch(0% 0 0);
  --shadow: var(--box-shadow-x) var(--box-shadow-y) 0px 0px var(--border);
}
@theme inline {                       /* Tailwind v4 mapping */
  --spacing-boxShadowX: var(--box-shadow-x);
  --spacing-boxShadowY: var(--box-shadow-y);
  --radius-base:  var(--border-radius);
  --shadow-shadow: var(--shadow);
  --shadow-nav: 4px 4px 0px 0px var(--border);
}
```

This is the key structural idea: **the translate distance on hover/active and the shadow offset are the same token**, so one number controls both. [NBD]

### B2. How the hard shadow is done

**`box-shadow` with `blur-radius: 0`, and that is the correct default** — not a pseudo-element:

- [MDN] documents the 4-length form: offsets, then `<blur-radius>`, then `<spread-radius>`; "If not specified, it will be set to `0` (meaning that **the shadow's edge will be sharp**)." So `5px 5px 0 0 #000` = 5px right, 5px down, 0 blur, 0 spread, opaque black → a hard, unblurred edge. <https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/box-shadow>
- **Why not a pseudo-element:** with `box-shadow` the offset layer paints *behind* the element's own border/background automatically, which is exactly the "printed layers misregistered" look, and it costs no extra DOM. You only need `::before`/`::after` when you want (a) a shadow that is *not* clipped to the element's border-box silhouette, (b) multiple independently-coloured layers, or (c) a pixel-art stepped corner. That last case is real and sourced: [NBD]'s 8-bit pixel utilities build a stepped, clip-path'd border shell in a **`::before` with `z-index: -1` and `pointer-events: none`** (`@utility px-border-md`, `isolation: isolate` on the parent), and a pixel-cornered shape via `clip-path: polygon(...)` in `@utility px-rounded-md` — which also sets `border-radius: 0`. Use pseudo-elements for those effects, not for the plain hard shadow.
- **[NB]'s "why it translates so well to code":** "`box-shadow` defines offset and blur; `border-radius` controls softness; `border`, color, and typography remain explicit rather than atmospheric. In Tailwind: `border border-black rounded-none shadow-[5px_5px_0_0_#000]`."

### B3. The canonical button (verbatim from [NB #implementation])

```css
.btn {
  border: 3px solid #000;
  border-radius: 0;
  background: #FFD23F;
  color: #000;
  box-shadow: 5px 5px 0 0 #000;
  font-weight: 700;
  padding: 12px 24px;
  cursor: pointer;
  transition: all 0.1s ease;
}
.btn:hover  { transform: translate(-2px, -2px); box-shadow: 7px 7px 0 0 #000; }
.btn:active { transform: translate(3px, 3px);   box-shadow: none; }

/* Never forget focus */
.btn:focus-visible { outline: 3px solid #74B9FF; outline-offset: 3px; }
```

**The geometry is the point and it is self-consistent:** on hover the element moves **up-left by 2px** and the shadow grows **from 5 to 7 (+2)** → the object lifts off its shadow. On `:active` it moves **down-right by 3px** and the shadow collapses to `none` → it lands flat on the page. [NB]'s own description: "On hover, the shadow grows and the element lifts. On click/active, the element 'presses down' by moving in the shadow direction and the shadow disappears. It's physical, immediate, satisfying."

### B4. The canonical card ([NB #implementation], verbatim)

```css
.card {
  background: #fff;
  border: 3px solid #000;
  box-shadow: 5px 5px 0 0 #000;
  padding: 1.5rem;
  transition: transform 0.15s, box-shadow 0.15s;
}
.card:hover { transform: translate(-2px, -2px); box-shadow: 7px 7px 0 0 #000; }
```

Note NB uses `transform, box-shadow 0.15s` here rather than `all 0.1s` on the button — **enumerate the animated properties; don't use `transition: all`.** NB's own two snippets are inconsistent on this, so prefer the card's explicit form.

### B5. Form controls — the "offset shadow grows on focus" pattern ([NB #implementation], verbatim)

```css
.nb-input {
  padding: 0.75rem 1rem;
  border: 3px solid #000;
  border-radius: 0;
  background: #fff;
  box-shadow: 3px 3px 0 0 #000;
  transition: box-shadow 0.15s, transform 0.15s;
}
.nb-input:focus {
  outline: 3px solid #74B9FF;
  outline-offset: 2px;
  box-shadow: 5px 5px 0 0 #000;
  transform: translate(-1px, -1px);
}
```

Note the input uses the **small** tier (3px) at rest and grows one tier (5px) on focus, moving only 1px. [NB] also ships an "Extra Large (12px 12px 0 0 #000)" option in its demo select, but no token for it.

### B6. The alternative press direction — "reverse" variant (corroborating source)

[NBD]'s button variants are the cleanest expression of the tokenised idea, and they add a third behaviour:

- `default`: `shadow-shadow hover:translate-x-boxShadowX hover:translate-y-boxShadowY hover:shadow-none` → **on hover, move by exactly the shadow offset and delete the shadow** (press-in on hover, not click).
- `reverse`: `hover:translate-x-reverseBoxShadowX hover:translate-y-reverseBoxShadowY hover:shadow-shadow` → **starts flat, grows the shadow on hover** (pull-up).
- `neutral`: same as default but on the secondary surface.
- All variants share `border-2 border-border`, `focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2`, `disabled:opacity-50`. [NBD] <https://raw.githubusercontent.com/ekmas/neobrutalism-components/main/public/r/button.json>

And [NB-CSS] implements the classic press with a smaller travel plus a **bounce** easing:

```css
button:hover  { transform: translate(-1px,-1px); box-shadow: var(--nb-shadow-hard-md); }
button:active { transform: translate(1px,1px);  box-shadow: none; }
/* tokens: --nb-transition: 0.15s ease-in-out;
           --nb-transition-bounce: 0.3s cubic-bezier(0.68,-0.55,0.265,1.55); */
```

<https://github.com/OshekharO/Neubrutalism>

**Three sourced transform conventions, all consistent with the rule "move toward or away from the shadow by the same number of pixels":** `-1px/-1px` [NB-CSS], `-2px/-2px` + `+3px/+3px` [NB], full shadow offset (4px) [NBD]. Duration band: **0.1s–0.3s**; [NB] uses `0.1s ease` and `0.15s`, [NB-CSS] `0.15s ease-in-out`.

### B7. Borders × shadow interaction (the practical trap)

- The hard shadow is drawn **behind** the border-box, so a border and a hard shadow coexist without the shadow bleeding under the border. [MDN] box-shadow paints as a drop shadow of the border-box silhouette.
- **Overlap/clipping trap:** an element with `5px 5px 0 0` shadow paints 5px outside its box in the positive x/y direction. Inside an `overflow: hidden` ancestor (or a scroll container) the shadow is **clipped**, and NB already tells you the visual glue is the lift: the hover state moves the element up-left by the same amount, so the visual bounds stay put while the silhouette shifts. Practical rule: give grid/flex parents ≥ the largest shadow offset in padding/gap, or the shadows of adjacent cards will sit on top of each other. No source states this explicitly — it is a mechanical consequence of the offsets NB specifies.
- **Coloured shadow variant:** [NB] card variation "Accent — matching border and shadow color adds personality while keeping structure." Implement by pointing both at the same var (`border: 3px solid var(--pink); box-shadow: 5px 5px 0 0 var(--pink)`), which is exactly what [NBD] does with `border-border` + `shadow-shadow`.
- **Keep the box stable:** `:hover` may change the border *colour* but never the border *width*, or the whole grid reflows. No source says this; it follows from the fixed-offset system.

### B8. Focus rings for accessibility (all sourced)

- **[NB]'s rule:** use `outline` + `outline-offset`, and prefer `:focus-visible`:

  ```css
  .btn:focus-visible { outline: 3px solid #74B9FF; outline-offset: 3px; }
  .nb-input:focus    { outline: 3px solid #74B9FF; outline-offset: 2px; }
  ```

  [NB]'s accessibility table: "2.4.7 Focus Visible … Thick outlines must not swallow focus rings. **Use `outline-offset`.**"
- **Why `outline` and not a border/box-shadow swap:** WCAG's Understanding doc for SC 2.4.13 (AAA) explains that `outline` encloses each fragment of a multi-line link solidly, and that "Offsetting indicators slightly from the focused component… can help make indicators more visible. In CSS, the `outline` and `outline-offset` properties are commonly used to achieve this." It also states the pass/fail geometry: a focus indicator must cover at least the area of a **2 CSS pixel thick perimeter** of the unfocused component, and have **3:1 change-of-contrast** between focused and unfocused states; an indicator inset further inside the component "need[s] to be thicker than 2 CSS pixels." Technique C40 (two-colour focus indicator) is the WG's answer to the "one ring colour fails on some backgrounds" problem — directly relevant here, because neubrutalism's accent-filled cards cycle through many backgrounds. <https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html>
- **Conflict with the hard shadow:** if you express focus as `box-shadow` you overwrite the object's hard shadow. [NB-CSS] shows the workaround — **stack both shadows in one declaration**:

  ```css
  button:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px var(--nb-color-primary-focus), var(--nb-shadow-hard-sm);
  }
  ```

  and additionally a global `:focus-visible { outline: 2px solid var(--nb-color-primary); outline-offset: 2px; }`. [NBD] instead uses Tailwind's ring system: `focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2`. Both are valid; **never `outline: none` without a replacement** — that is WCAG failure F78 ("styling element outlines and borders in a way that removes or renders non-visible the visual focus indicator").

### B9. Crisp, non-antialiased edges — what is actually verifiable

- The reliable, sourced mechanism is **zero blur**: `box-shadow: … 0 0 <color>` gives "the shadow's edge will be sharp" ([MDN]), and [NB]'s whole shadow scale is built on the third and fourth values being `0 0`.
- For genuinely pixel-stepped / non-antialiased corners (pixel-art flavour), [NBD] uses **`clip-path: polygon(…)`** to cut 2×-pixel notches at each corner and explicitly resets `border-radius: 0` — see `@utility px-rounded-md` and `@utility px-border-md` in <https://raw.githubusercontent.com/ekmas/neobrutalism-components/main/src/styling/globals.css>. The border in that variant is a `::before` overlay painted with the same polygon (outer polygon, inner polygon, cutout), not a CSS `border`.
- **Claims I could NOT source, and you should treat as unverified folklore:** anything about `transform: translateZ(0)`/`will-change` "forcing crisp subpixel rendering," `shape-rendering: crispEdges` for HTML, half-pixel offsets, or `backface-visibility` hacks for hard shadows. No source in this research states any of them. Don't put them in a spec as facts.

### B10. Motion cost & reduced motion

- Animate **`transform` + `box-shadow` only**; both are in [NB]'s snippets and in [NBD]'s class list. `transform` is compositor-friendly; `box-shadow` is not free but the offsets are tiny and stable. Avoid animating `all`.
- **[NB-CSS] ships the reduced-motion guard verbatim** — copy this shape:

  ```css
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
      scroll-behavior: auto !important;
    }
  }
  @media (prefers-reduced-motion: no-preference) {
    * { scroll-behavior: smooth; }
    /* keyframe entrance animations go here */
  }
  ```

  (Note the second block: entrance animations should live *inside* `no-preference` rather than being disabled afterwards.) [NB-CSS] <https://github.com/OshekharO/Neubrutalism>
- **Responsive de-intensification** (nice trick, [NB-CSS]): below 768px it downgrades every hard shadow to the small tier —
  `.nb-card, .nb-btn, button, .nb-badge, .nb-alert, .nb-modal-dialog { box-shadow: var(--nb-shadow-sm); }` — "Reduce hard shadows on mobile for better performance." That is a real, copyable mitigation for the offset-shadow-grows-content-bounds problem on narrow screens.

### B11. Theming mechanics

- **Single-knob theming:** [NB]'s pitch is literally "change the tokens, change the flavor," and its history section notes Figma variables made the style parameterised — "you could change `--border-width` and `--shadow-offset` and get a different flavor of the same grammar."
- **Dark mode:** [NB-CSS] shows the complete pattern — `:root { … }` for light, `[data-theme="dark"], .nb-dark { … }` overriding the same custom properties (backgrounds, text, accents, **and the hard-shadow colour**: `2px 2px 0 rgba(255,255,255,0.1)`). Toggle with `document.documentElement.classList.toggle('nb-dark')`. Since every component only reads `var(--…)`, nothing else changes. <https://github.com/OshekharO/Neubrutalism>
- **Framework mapping:** [NB] gives the Tailwind one-liner — `border border-black rounded-none shadow-[5px_5px_0_0_#000]` — and attributes the style's spread partly to Tailwind JIT (2021) "making arbitrary shadow/border values trivial." [NBD] demonstrates the modern Tailwind v4 route: `@theme inline` maps `--shadow-shadow`, `--radius-base`, `--spacing-boxShadowX/Y` so `shadow-shadow`, `rounded-base`, `translate-x-boxShadowX` become first-class utilities.

---

## C. Accessibility and pitfalls

**[NB]'s own table (verbatim criteria, its own "Neubrutalist Concern" column):**

| WCAG criterion | Requirement | NB's stated concern |
|---|---|---|
| 1.4.3 Contrast (Minimum) | 4.5:1 normal text, 3:1 large text | "Loud palettes don't guarantee compliance. Test every combination." |
| 1.4.11 Non-text Contrast | 3:1 for UI component boundaries | "Decorative borders can obscure meaningful state changes." |
| 2.4.7 Focus Visible | Keyboard focus clearly indicated | "Thick outlines must not swallow focus rings. Use `outline-offset`." |
| 2.5.8 Target Size | 24×24px minimum (AA) | "Visual bulk from borders ≠ actual clickable area. Verify padding." |
| 1.4.1 Use of Color | Colour not sole information channel | "Palette experimentation increases risk of color-only signaling." |

[NB] pins these to **WCAG 2.2** (W3C Recommendation, Oct 2023, updated Dec 2024) and adds: WCAG 3.0 "is still an early working draft — not expected to reach Recommendation before roughly 2029… Build against 2.2 today." (WCAG 2.2 is the correct citation: <https://www.w3.org/TR/WCAG22/>. Note the 24×24px minimum is genuinely in WCAG 2.2 — SC 2.5.8 Target Size (Minimum), Level AA.)

**NB's four named failure modes** [#usage]: contrast failures ("Yellow on white, pink on orange, mid-tones all fail WCAG"); colour-only state ("violates 1.4.1"); **fake hit areas** ("thick borders imply larger targets than actual code provides"); **focus obscured** ("decorative shadows can hide keyboard focus indicators").

**Mitigations, sourced:**

1. **Contrast testing is a build step, not a review step.** "Prove WCAG Compliance Early… Neubrutalism's palette freedom is where projects fail. Enforce contrast ratios during design, not after launch." [NB #usage] Enforce the 4.5:1 / 3:1 numbers above.
2. **Two-colour / offset focus indicator** so the ring survives every accent fill: WCAG technique C40 plus `outline-offset` ([WCAG] Understanding 2.4.13). [NB] mandates `outline-offset` (3px button, 2px input).
3. **Focus must not be eaten by the shadow system.** Either stack ring + hard shadow in one `box-shadow` list [NB-CSS] or use an outline that is drawn outside the shadow (note: `outline` draws outside `box-shadow`, so an `outline-offset` of at least the shadow offset keeps them from colliding — [NB]'s 3px offset vs its 5px rest shadow is the tension to check on your own components).
4. **Real hit areas ≥ 24×24px**, verified by padding not by stroke weight. [NB #usage] (table row 2.5.8).
5. **Never signal state by colour alone** — pair it with the border/outline/shadow/icon change. [NB #anatomy §A "Don't", #usage]
6. **Motion:** clamp transitions/animations under `prefers-reduced-motion: reduce` and gate entrance animations behind `no-preference`. [NB-CSS]
7. **Hierarchy collapse (a UX pitfall, not a WCAG one):** "When every card, chip, button, and tooltip gets equally aggressive shadow, hierarchy collapses" [NB #anatomy §C]; "If every object is loud, nothing is legible" [#usage]. NB's structural answer is **separate expression from interaction**: "Use neubrutalism aggressively on hero sections, marketing blocks, and editorial modules. Dial it down inside dashboards, forms, and transactional flows." [#usage]
8. **Sector risk** (NB's own guidance, useful when scoping): best fit = creator/portfolio, SaaS landing pages, Web3; use with caution = e-commerce checkout, editorial/dense reading, product dashboards; avoid or heavily moderate = banking & insurance, healthcare, government services (accessibility compliance mandatory, audience is everyone). [NB #usage]
9. **Design-history caution:** [SM] documents that "brutalist web design has grown so quickly that there does not seem to be a clear consensus on what the style actually *is*" — two competing philosophies under one name — so "brutalist" ≠ "neubrutalist"; [NN/g] draws the same line ("Unlike true brutalist web design, neobrutalist designs are likely to be more colorful and orderly"). Don't cite 2014–2020 brutalist artefacts as neubrutalist precedent.

---

## D. Do / Don't

### Do (each rule traceable)

1. **One canonical stroke.** `border: 3px solid #000` by default; 2px for secondary/dividers; 4px for hero/section dividers. "The outline should clarify the object, not overpower its content." [NB]
2. **Square or near-square corners.** `--radius: 0` is NB's ideal; shipping libraries sit at 0–5px. Never pill, never >8px. [NB, NBD]
3. **Zero blur, zero spread, equal positive x/y offsets.** `5px 5px 0 0 #000`. [NB, MDN]
4. **Pick a tier, not a value:** 3 / 5 / 8 (and 12 for hero/dialog) — badges → cards/buttons → hover/overlays → dialogs. [NB]
5. **Tokenise offsets as variables and derive the translate from them** (`--box-shadow-x/y` → `translate-x/y` → `shadow: none` on press). [NBD]
6. **Hover lifts, active presses:** move up-left by ~1–2px and grow the shadow by the same amount; on `:active` move down-right and set `box-shadow: none`. Transition 0.1–0.15s, `transform` and `box-shadow` only. [NB, NB-CSS]
7. **Borders and shadows should agree** — black on black, or one accent colour used for both. [NB]
8. **Flat fills only, one neutral + one dark outline + 1–3 saturated accents.** [NB]
9. **Calm body type, loud display type.** Failing that, at minimum keep body at 4.5:1 with generous line-height. [NB, NN/g]
10. **Always ship a visible focus style** — `:focus-visible` with `outline` + `outline-offset` (3px/3px is NB's value) or a 2-layer `box-shadow` ring that also preserves the hard shadow. [NB, NB-CSS, WCAG]
11. **Assign each border a meaning** — container / interactive / focus / selected / error — or delete it. [NB]
12. **Reserve the harshest gestures:** one border system, one hard-shadow behaviour, one loud display scale. [NB]

### Don't — what BREAKS the style

1. **Blurred shadows.** `0 4px 12px rgba(0,0,0,.15)` is the explicit counter-example. "0 Blur on hard shadows." [NB]
2. **Gradients.** "Use gradients (flat fills are the grammar)" is listed under **Don't**. [NB] Its own playground toggle literally labels one option "Gradients (please no)."
3. **Soft rounding** — pills and 12px cards. [NB]
4. **Mixing arbitrary shadow offsets per component.** "When every card, chip, button, and tooltip gets equally aggressive shadow, hierarchy collapses" — and inconsistent offsets destroy the misregistered-print logic. [NB]
5. **Low-contrast accent-on-accent** — "yellow on white fails," "pink on orange… fail." [NB]
6. **Colour-only state** (1.4.1 violation) and **relying on the thick border as the click target** (fake hit areas). [NB]
7. **`outline: none` with no replacement** (WCAG failure F78). [WCAG]
8. **A type system that shouts at one volume**, or ornate/decorative display faces. [NB]
9. **Coloured text on coloured fills without a contrast check**, and every component at max saturation. [NB]
10. **Treating web brutalism's deliberate disorder as neubrutalism.** "Broken but not random"; "First-wave web brutalism weaponized disorder. Neubrutalism choreographs it." [NB, SM]
11. **Animating `all`** or ignoring `prefers-reduced-motion`. [NB vs NB-CSS — prefer NB-CSS's guard]
12. **Shipping the aesthetic into transactional/dense surfaces** (checkout, settings tables, healthcare, government) rather than keeping it in hero/marketing layers. [NB #usage]

---

## Appendix — exact snippet inventory (all verbatim from sources)

| Source | Snippet | Value |
|---|---|---|
| [NB] | button rest / hover / active | `3px solid #000`, `5px 5px 0 0 #000` → `translate(-2px,-2px)` + `7px 7px 0 0 #000` → `translate(3px,3px)` + `box-shadow:none`; `transition: all .1s ease` |
| [NB] | button focus | `outline: 3px solid #74B9FF; outline-offset: 3px` |
| [NB] | card rest / hover | same border/shadow, `padding: 1.5rem`, `transition: transform .15s, box-shadow .15s` → `translate(-2px,-2px)` + `7px` shadow |
| [NB] | input rest / focus | `3px 3px 0 0` → focus `outline 3px #74B9FF, offset 2px`, `5px 5px 0 0`, `translate(-1px,-1px)` |
| [NB] | token tiers | 2/3/4px borders; 3/5/8/12px shadows; radius 0 |
| [NBD] | global tokens | `--border-radius: 5px`; `--box-shadow-x/y: 4px`; `--reverse-box-shadow-x/y: -4px`; `--shadow: var(--box-shadow-x) var(--box-shadow-y) 0px 0px var(--border)`; `--border: oklch(0% 0 0)`; `--shadow-nav: 4px 4px 0px 0px var(--border)`; `--heading-font-weight: 700`; `--base-font-weight: 500` |
| [NBD] | button classes | `border-2 border-border`, `rounded-base`, `shadow-shadow`, `focus-visible:ring-2 ring-black ring-offset-2`, `[&_svg]:size-4`; default hover = translate by shadow + `shadow-none`; reverse variant grows shadow on hover |
| [NB-CSS] | button rest/hover/active | `--nb-border-width: 2px`, `border-radius: .5rem`, `box-shadow: 2px 2px 0 rgba(0,0,0,.15)`; hover `translate(-1px,-1px)` + 4px shadow; active `translate(1px,1px)` + `box-shadow: none` |
| [NB-CSS] | focus (both patterns) | `:focus-visible { outline: 2px solid primary; outline-offset: 2px }` and button: `box-shadow: 0 0 0 3px var(--nb-color-primary-focus), var(--nb-shadow-hard-sm)` |
| [NB-CSS] | hard-shadow scale | `2px 2px 0 rgba(0,0,0,.15)` / `4px` / `6px` / `8px`; dark mode swaps to `rgba(255,255,255,.1)` |
| [NB-CSS] | reduced motion | global `animation-duration/transition-duration: 0.01ms !important`, `scroll-behavior: auto` under `reduce`; entrance animations under `no-preference` |
| [MDN] | shadow geometry | 3rd `<length>` = blur-radius, "If not specified, it will be set to `0` (meaning that the shadow's edge will be sharp)"; 4th = spread-radius |

**Explicit gaps (nothing in the sources states these — do not present as canon):** an iconography spec (stroke width, corner treatment) for neubrutalism; a numeric saturation/lightness range for the palette; a numeric spacing scale or container width *from neubrutalism.com*; letter-spacing values *from neubrutalism.com* (only "tight tracking" as prose); any anti-aliasing technique beyond zero-blur and `clip-path` pixel corners; whether the offset should ever be negative or asymmetric; a dark-mode spec on neubrutalism.com itself.

**One caution about the domain:** `neubrutalism.com` is an unattributed, unsigned single-page guide. It is internally consistent, its CSS snippets run, and its ecosystem claims check out (neobrutalism.dev exists and is a real library; the Michał Malewicz March 2022 uxdesign.cc essay it credits as the namer is real, though that URL currently sits behind Cloudflare — HTTP 403 to automated fetches). But treat its *normative* claims ("Ideal border-radius: 0px," "Year term crystallized: 2022") as this page's position, not as an industry standard. NN/g's independent article is the better citable authority for definition and characteristics; neobrutalism.dev and OshekharO's framework are the better authorities for shipping code.
