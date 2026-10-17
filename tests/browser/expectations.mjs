/**
 * expectations.mjs — the expected computed values, as an **independent source of truth**.
 *
 * Every constant below is derived by hand from the design documents, never from
 * `src/css/*.css` or from `static/barnacle.css`: the harness exists to disagree with the
 * implementation, so an expectation recomputed from the implementation would be tautological
 * and could never fail (the anti-pattern the `tdd` skill calls "tautological").
 *
 * Sources:
 *
 *   spec.md §3      invariants 2 (zero blur / zero spread, equal positive offsets), 3 (the
 *                   displacement and the shadow offset share one origin), 7 (hover never
 *                   changes a border width)
 *   spec.md §6.1    the light-theme token values (#000000, 4px, 3px, #FFFDF5, #FFD23F, #74B9FF)
 *   spec.md §7      the interaction contract: md at rest, lg on hover (4px → 6px, +2px, lift 2px),
 *                   press collapses the shadow, the focus ring is a 3px outline offset by 3px
 *   ADR-0003        the shadow tiers are all derived from --bn-shadow-x/y
 *   ADR-0004        dark mode is an explicit switch, never a system preference
 *   ADR-0006        the layer declaration is line 1 and unlayered user CSS beats every layer
 *   orchestrator-decisions.md §6.1/§8, §4   the token table and the inheritance limit
 *                   (an override only rescales the chain when it lands on :root / <html>)
 *
 * The right-hand strings are Chrome's normalised serialisations of those values. They are part
 * of the baseline: a Chrome major upgrade may legitimately change how a value is spelled, which
 * is exactly why `tests/browser/README.md` records the Chrome version the baseline was taken on.
 */

/** ADR-0006: the cascade layer order is a public contract, fixed on line 1 of the artifact. */
export const LAYER_NAMES = Object.freeze(['theme', 'base', 'components', 'animations', 'utilities']);

/** Line 1 of `static/barnacle.css` and of `static/barnacle.min.css`, byte for byte. */
export const LAYER_DECLARATION = `@layer ${LAYER_NAMES.join(', ')};`;

/**
 * The artifact is served from a subpath, like a GitHub Pages project site would be
 * (`https://user.github.io/barnacle/`). If this path ever stops matching, the harness is
 * measuring a page that loaded no library CSS at all — the failure mode that makes every
 * other assertion meaningless.
 */
export const ARTIFACT_HREF = '/barnacle/static/barnacle.css';

/** spec §6.1 — the geometry tokens, as computed values. */
export const GEOMETRY = Object.freeze({
  borderWidth: '3px',
  radius: '0px',
  /** --bn-shadow-lift = calc(--bn-shadow-x / 2). */
  lift: 2,
  /** --bn-press = 3px (decision E: deliberately not the 4px resting offset). */
  press: 3,
  /** --bn-transition. */
  transition: '0.15s',
});

/** spec §6.1 / §6.2 — the colours the harness reads, in Chrome's serialisation. */
export const COLOR = Object.freeze({
  ink: 'rgb(0, 0, 0)', // #000000 — --bn-border-color and --bn-shadow-color in the light theme
  paper: 'rgb(255, 253, 245)', // #FFFDF5 — --bn-background
  surface: 'rgb(255, 210, 63)', // #FFD23F — --bn-main, the button surface
  ring: 'rgb(116, 185, 255)', // #74B9FF — --bn-ring
  darkPaper: 'rgb(26, 26, 26)', // #1A1A1A — [data-theme="dark"] --bn-background
  darkInk: 'rgb(255, 253, 245)', // #FFFDF5 — [data-theme="dark"] --bn-shadow-color
  /** The fixture's own unlayered rule (`fixtures/cascade.html`), not a library colour. */
  userSurface: 'rgb(0, 128, 0)', // #008000
});

/**
 * spec §7 — `box-shadow` at rest (md), on hover (lg, exactly --bn-shadow-lift larger) and
 * pressed (collapsed). sm is the tier `.bn-outline` and `pre` start from.
 * spec §3 invariant 2: the third and fourth lengths are always 0.
 */
export const SHADOW = Object.freeze({
  none: 'none',
  sm: 'rgb(0, 0, 0) 2px 2px 0px 0px',
  md: 'rgb(0, 0, 0) 4px 4px 0px 0px',
  lg: 'rgb(0, 0, 0) 6px 6px 0px 0px',
  /** The dark theme repaints the offset in --bn-foreground white (ADR-0003/§6.2). */
  mdDark: 'rgb(255, 253, 245) 4px 4px 0px 0px',
});

/**
 * ADR-0003 / orchestrator-decisions §8 — one token rescales the whole hierarchy. Setting
 * `--bn-shadow-x` **and** `--bn-shadow-y` to 8px on `<html>` yields sm 4px, md 8px, lg 12px
 * (half / one / one-and-a-half), and the lift — the amount the object moves — follows to 4px.
 */
export const SCALED = Object.freeze({
  token: '8px',
  /** The x offset of each tier, which is all a single-token override rescales. */
  offsets: Object.freeze({ sm: 4, md: 8, lg: 12 }),
  /** The full string once both offsets are overridden (spec §3 invariant 2: they stay equal). */
  sm: 'rgb(0, 0, 0) 4px 4px 0px 0px',
  md: 'rgb(0, 0, 0) 8px 8px 0px 0px',
  lg: 'rgb(0, 0, 0) 12px 12px 0px 0px',
  lift: 4,
});

/** spec §7 — Chrome serialises `translate()` as a 2D matrix. */
export const TRANSFORM = Object.freeze({
  none: 'none',
  hover: 'matrix(1, 0, 0, 1, -2, -2)', // translate(-2px, -2px): up and to the left
  press: 'matrix(1, 0, 0, 1, 3, 3)', // translate(3px, 3px): down toward where the shadow was
  identity: 'matrix(1, 0, 0, 1, 0, 0)', // the ghost, whose lift slots are zeroed
});

/** spec §7 — what the transition must cover when the visitor accepts motion. */
export const TRANSITION_PROPERTIES = Object.freeze([
  'transform',
  'box-shadow',
  'background-color',
  'border-color',
]);

/** The complete CSS `outline` the focus ring resolves to (spec §7: 3px solid, offset 3px). */
export const FOCUS_RING = Object.freeze({
  outlineStyle: 'solid',
  outlineWidth: '3px',
  outlineOffset: '3px',
  outlineColor: COLOR.ring,
});
