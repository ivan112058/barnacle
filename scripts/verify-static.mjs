#!/usr/bin/env node
/**
 * Scripted verification for ticket 10 — Card, Badge, Alert, Spinner, Skeleton.
 *
 * The three verification methods in
 * `.scratch/barnacle-design/issues/10-card-badge-alert-spinner-skeleton.md` are the specification of
 * this file; each one is a check below, measured in real Chrome against the shipped artifact
 * (`static/barnacle.css`) instead of a hand pass:
 *
 *   1. every one of the five components holds up in the light theme and in the dark theme
 *   2. overriding `--bn-shadow-color` on an accent card moves the shadow — i.e. the accent card's
 *      border and its shadow really are the same colour and cannot drift apart
 *   3. with the system set to reduced motion the spinner stops turning and the skeleton stops
 *      shimmering, and both still say "loading" (the ring is still drawn, the placeholder is still
 *      a distinct block)
 *
 * The expected values are the independent source of truth: spec.md §3 (invariants 2, 3, 4, 5, 6,
 * 7), §6.1/§6.2 (tokens), §7 (the motion guard), §8 (the anchor of each of the five components),
 * ADR-0001 (semantics first), ADR-0003 (shadow tiers), ADR-0004 (dark mode is a switch), ADR-0005
 * (`--bn-*` / `--_*` only) and `D:\code\barnacle-notes\orchestrator-decisions.md` §1 (naming), §3C
 * (`[role="status"]` defaults to the spinner, `.bn-skeleton` overrides it), §4 (geometry has one
 * source) and §8 (a derived token is substituted where it is declared). They are never recomputed
 * from `src/css/*.css`.
 *
 * Run with: npm run verify:static   (or: node scripts/verify-static.mjs)
 * Options:  --no-browser  skip the real-Chrome checks (they need playwright-core)
 *
 * playwright-core is not a dependency of this repository (ticket 08 owns the browser harness);
 * the checks below import it lazily and report SKIP when it is absent, so the static checks still
 * gate the exit code.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const abs = (...parts) => path.join(ROOT, ...parts);

/* ------------------------------------ expectations ----------------------------------- */

/** The five files this ticket owns, in manifest order (scripts/build.mjs CSS_MANIFEST). */
const FILES = ['card.css', 'badge.css', 'alert.css', 'spinner.css', 'skeleton.css'];

/** The docs pages, one per component (spec §10: one page each, no authored H2). */
const PAGES = {
  'card.md': ['article'],
  'badge.md': ['.bn-badge'],
  'alert.md': ['[role="alert"]'],
  'spinner.md': ['[role="status"]'],
  'skeleton.md': ['.bn-skeleton', '[role="status"]'],
};

const ARTIFACT = 'static/barnacle.css';

/** spec §6.1 — the geometry, as computed values. */
const BORDER_PX = '3px';
const RADIUS = '0px';
const CARD_PADDING = '24px'; // recipe §16: 1.5rem, the canonical card
const SPINNER_SIZE = '24px'; // --_size: 1.5rem
const SPINNER_STROKE = '2px'; // calc(--bn-border-width * 2 / 3)
const ALERT_BAR = '6px'; // calc(--bn-border-width * 2)

/**
 * The ring's track: `color-mix(in srgb, var(--bn-foreground) 20%, transparent)` (spinner.css).
 * Chrome 155 serialises a color-mix result in its own colour space rather than as `rgba(…)`; that
 * spelling is part of the baseline, the way tests/browser/README.md describes it, and the
 * derivation it stands for is "20% of the page's ink over nothing" — a translucent track.
 */
const SPINNER_TRACK = 'color(srgb 0 0 0 / 0.2)';

/**
 * spec §7 / §6.1 — the three tiers, with a zero blur and a zero spread (invariant 2). The card is
 * the md tier (4px), the badge and the alert the sm tier (2px).
 */
const SHADOW = {
  none: 'none',
  sm: 'rgb(0, 0, 0) 2px 2px 0px 0px',
  md: 'rgb(0, 0, 0) 4px 4px 0px 0px',
  pink: 'rgb(255, 107, 107) 4px 4px 0px 0px',
  pinkSm: 'rgb(255, 107, 107) 2px 2px 0px 0px',
  green: 'rgb(136, 212, 152) 4px 4px 0px 0px',
  greenSm: 'rgb(136, 212, 152) 2px 2px 0px 0px',
  orange: 'rgb(255, 165, 82) 4px 4px 0px 0px',
  orangeSm: 'rgb(255, 165, 82) 2px 2px 0px 0px',
  lavender: 'rgb(184, 169, 250) 4px 4px 0px 0px',
  blue: 'rgb(116, 185, 255) 4px 4px 0px 0px',
  mdDark: 'rgb(255, 253, 245) 4px 4px 0px 0px',
  smDark: 'rgb(255, 253, 245) 2px 2px 0px 0px',
};

/** spec §6.1 / §6.2 — the colours the harness reads, in Chrome's serialisation. */
const COLOR = {
  ink: 'rgb(0, 0, 0)',
  paper: 'rgb(255, 253, 245)',
  secondary: 'rgb(255, 255, 255)',
  main: 'rgb(255, 210, 63)',
  pink: 'rgb(255, 107, 107)',
  green: 'rgb(136, 212, 152)',
  orange: 'rgb(255, 165, 82)',
  blue: 'rgb(116, 185, 255)',
  lavender: 'rgb(184, 169, 250)',
  darkPaper: 'rgb(26, 26, 26)',
  darkSecondary: 'rgb(38, 38, 38)',
  darkInk: 'rgb(255, 253, 245)',
  transparent: 'rgba(0, 0, 0, 0)',
};

/** ADR-0005: the two namespaces, and nothing else. */
const HYGIENE = {
  publicToken: /^--bn-[a-z0-9-]+$/,
  internalToken: /^--_[a-z0-9-]+$/,
};

/** spec §6.1 — the complete public token vocabulary. A component may only read from it. */
const PUBLIC_TOKENS = new Set([
  '--bn-border-width',
  '--bn-border-color',
  '--bn-radius',
  '--bn-shadow-x',
  '--bn-shadow-y',
  '--bn-shadow-reverse-x',
  '--bn-shadow-reverse-y',
  '--bn-shadow-color',
  '--bn-shadow-lift',
  '--bn-shadow-sm',
  '--bn-shadow-md',
  '--bn-shadow-lg',
  '--bn-shadow',
  '--bn-press',
  '--bn-background',
  '--bn-secondary-background',
  '--bn-foreground',
  '--bn-main',
  '--bn-main-foreground',
  '--bn-ring',
  '--bn-overlay',
  '--bn-pink',
  '--bn-blue',
  '--bn-green',
  '--bn-orange',
  '--bn-lavender',
  '--bn-success',
  '--bn-warning',
  '--bn-danger',
  '--bn-font-family',
  '--bn-font-display',
  '--bn-font-mono',
  '--bn-font-weight-base',
  '--bn-font-weight-heading',
  '--bn-transition',
]);

/**
 * orchestrator-decisions §4 — the internal slots 00-base.css declares and every component consumes.
 * A component may also carry internal variables of its own (ADR-0005's `--_` namespace is for
 * internals); the three below are the only ones this ticket adds, and they belong to exactly one
 * component each (`--_size`/`--_stroke` to the spinner, `--_shimmer` to the skeleton).
 */
const FROZEN_SLOTS = new Set([
  '--_lift-x',
  '--_lift-y',
  '--_press-x',
  '--_press-y',
  '--_shadow-rest',
  '--_shadow-hover',
  '--_shadow-press',
  '--_focus-ring',
  '--_focus-ring-offset',
  '--_motion',
  '--_border-rest',
  '--_border-hover',
  '--_border-press',
  '--_surface',
  '--_surface-hover',
  '--_surface-press',
]);
const LOCAL_SLOTS = new Set(['--_size', '--_stroke', '--_shimmer']);

/**
 * The one internal variable a component may read without declaring it: 01-theme.css maps
 * `data-variant` onto `--_variant-color` (spec §8). Declaring it in a component is a bug — a
 * components-layer declaration beats the theme-layer mapping — with one deliberate exception: the
 * accent classes (`.bn-pink` …), which *are* the appearance axis asking for a colour.
 */
const SEMANTIC_SLOT = '--_variant-color';
const ACCENT_CLASSES = ['.bn-pink', '.bn-blue', '.bn-green', '.bn-orange', '.bn-lavender'];

/**
 * The five accents and the four semantic names — the complete set of "this element carries a colour
 * of its own". A component that matches all nine republishes the colour as `--bn-shadow-color` and
 * re-derives its shadow so the border and the shadow cannot drift apart.
 */
const COLOUR_SELECTOR_PARTS = [
  '[data-variant="success"]',
  '[data-variant="warning"]',
  '[data-variant="danger"]',
  '[data-variant="error"]',
  '.bn-pink',
  '.bn-blue',
  '.bn-green',
  '.bn-orange',
  '.bn-lavender',
];

/**
 * The shadow a component may paint. The md/sm tokens are the canonical tiers; the two re-derived
 * forms exist because a shadow token is substituted where it is declared, on `:root`, with its
 * colour already baked in (orchestrator §8, measured by ticket 05 and noted in toast.css), so an
 * element that carries a colour of its own has to re-derive the *shape* to let the colour in.
 * Both re-derived forms keep the offsets in `--bn-shadow-x/y`, the blur and spread at invariant 2's
 * zero, and take their colour from the public `--bn-shadow-color` channel.
 */
const SHADOW_VALUE = {
  canonical: new Set(['var(--bn-shadow-sm)', 'var(--bn-shadow-md)']),
  redrawn: new Set([
    'var(--bn-shadow-x) var(--bn-shadow-y) 0 0 var(--bn-shadow-color)',
    'calc(var(--bn-shadow-x) / 2) calc(var(--bn-shadow-y) / 2) 0 0 var(--bn-shadow-color)',
  ]),
};

/** The `bn-` names this ticket introduces (ADR-0005 §1: everything we invent carries the prefix). */
const REQUIRED_NAMES = [
  '.bn-badge',
  '.bn-badge.bn-solid',
  '.bn-badge.bn-outline',
  '.bn-spinner',
  '.bn-skeleton',
  '.bn-pink',
  '.bn-blue',
  '.bn-green',
  '.bn-orange',
  '.bn-lavender',
];

/** Hardcoded colour forms ADR-0005 keeps in 01-theme.css only. */
const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(|\bcolor\(/;

/** spec §8: the semantic colours are the theme layer's business, never a component's. */
const SEMANTIC_TOKEN = /--bn-(?:success|warning|danger)\b/;

/** Docs-site markup that must not collide with a global ARIA anchor (orchestrator §11). */
const SITE_SOURCES = [
  'templates/base.html',
  'templates/index.html',
  'templates/page.html',
  'templates/component.html',
  'templates/components-index.html',
  'static/site.js',
];

/* -------------------------------------- harness -------------------------------------- */

const failures = [];
let checks = 0;
let skips = 0;

function must(condition, message) {
  if (!condition) throw new Error(message);
}

async function check(name, fn) {
  checks += 1;
  try {
    const detail = await fn();
    console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (error) {
    failures.push(name);
    console.log(`FAIL  ${name} — ${error.message}`);
  }
}

/* --------------------------------- CSS source reading --------------------------------- */

function read(rel) {
  return fs.readFileSync(abs(rel), 'utf8');
}

/** Comment bodies become spaces of the same length: braces and words inside prose stop counting. */
function blankComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (comment) => ' '.repeat(comment.length));
}

/** Index of the `}` closing the `{` at `openIndex`. Strings are tracked, comments are not. */
function matchBrace(text, openIndex, label) {
  must(text[openIndex] === '{', `${label}: expected "{" at index ${openIndex}`);
  let depth = 0;
  let quote = null;
  for (let i = openIndex; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error(`${label}: unbalanced braces — no matching "}" for the "{" at index ${openIndex}`);
}

/**
 * Every `selector { body }` rule, flattened out of its at-rule wrappers but keeping the wrapper
 * preludes in `conditions` — that is what makes "the animation sits inside
 * @media (prefers-reduced-motion: no-preference)" a fact instead of a regex guess. `@keyframes`
 * bodies are returned separately: their inner blocks are not selectors.
 */
function parseRules(text, conditions = []) {
  const rules = [];
  const keyframes = [];
  let i = 0;
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i])) i += 1;
    if (i >= text.length) break;
    const open = text.indexOf('{', i);
    if (open === -1) break;
    const semi = text.indexOf(';', i);
    if (semi !== -1 && semi < open) {
      i = semi + 1; // an at-statement such as `@layer a, b;` — nothing to collect
      continue;
    }
    const prelude = text.slice(i, open).trim();
    const close = matchBrace(text, open, prelude);
    const body = text.slice(open + 1, close);
    if (/^@keyframes\b/.test(prelude)) {
      keyframes.push({ name: prelude.replace(/^@keyframes\s+/, '').trim(), body, conditions });
    } else if (prelude.startsWith('@')) {
      const inner = parseRules(body, [...conditions, prelude]);
      rules.push(...inner.rules);
      keyframes.push(...inner.keyframes);
    } else {
      rules.push({ selector: prelude, body, conditions });
    }
    i = close + 1;
  }
  return { rules, keyframes };
}

/** `property: value` pairs declared directly in a rule body, in document order. */
function declarations(body) {
  const pairs = [];
  const re = /(--[\w-]+|[\w-]+)\s*:\s*([^;{}]+)/g;
  for (const match of body.matchAll(re)) {
    pairs.push([match[1], match[2].replace(/\s+/g, ' ').trim()]);
  }
  return pairs;
}

const inNoPreference = (rule) =>
  rule.conditions.some((condition) => /prefers-reduced-motion:\s*no-preference/.test(condition));

/** Every rule of the five files, tagged with the file it came from. */
const sources = FILES.map((file) => {
  const raw = read(`src/css/${file}`);
  const source = blankComments(raw);
  const { rules, keyframes } = parseRules(source);
  return {
    file,
    raw,
    source,
    rules,
    keyframes,
    declarations: rules.flatMap((rule) =>
      declarations(rule.body).map(([property, value]) => ({ property, value, ...rule })),
    ),
    customProps: [...new Set([...source.matchAll(/--[\w-]+/g)].map((match) => match[0]))],
  };
});
const allDeclarations = sources.flatMap((entry) => entry.declarations);

/* =================================== static checks =================================== */

console.log(`barnacle static-component verification — ${ROOT}\n`);

await check('the five files are UTF-8 without a BOM, write no @layer, and are no longer stubs', () => {
  const report = [];
  for (const entry of sources) {
    const bytes = fs.readFileSync(abs(`src/css/${entry.file}`));
    must(
      !(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf),
      `${entry.file}: a BOM breaks the build chain and seite content checks`,
    );
    const offenders = entry.raw
      .split(/\r?\n/)
      .map((line, index) => [line, index + 1])
      .filter(([line]) => /^\s*@layer\b/.test(line));
    must(
      offenders.length === 0,
      `${entry.file}: remove @layer from line(s) ${offenders.map(([, n]) => n).join(', ')} — CSS_MANIFEST assigns the layer`,
    );
    must(entry.rules.length > 0, `${entry.file} declares no rule at all — ticket 10 has not landed`);
    report.push(`${entry.file}=${entry.rules.length}`);
  }
  return report.join(' ');
});

await check('no component invents a name (ADR-0005: --bn-* from spec §6.1 and --_* internals only)', () => {
  for (const entry of sources) {
    const unknownPublic = entry.customProps.filter(
      (name) => HYGIENE.publicToken.test(name) && !PUBLIC_TOKENS.has(name),
    );
    must(
      unknownPublic.length === 0,
      `${entry.file}: unknown public token(s) ${unknownPublic.join(', ')} — spec §6.1 is the whole vocabulary`,
    );
    const foreign = entry.customProps.filter(
      (name) => !HYGIENE.publicToken.test(name) && !HYGIENE.internalToken.test(name),
    );
    must(foreign.length === 0, `${entry.file}: custom properties outside the two namespaces: ${foreign.join(', ')}`);
  }
  const invented = allDeclarations
    .filter(({ property }) => property.startsWith('--_'))
    .filter(
      ({ property, selector }) =>
        !FROZEN_SLOTS.has(property) &&
        !LOCAL_SLOTS.has(property) &&
        !(property === SEMANTIC_SLOT && ACCENT_CLASSES.some((name) => selector.includes(name))),
    );
  must(
    invented.length === 0,
    `new internal slot(s) outside the frozen geometry and this ticket's three locals: ${invented
      .map(({ file, selector, property }) => `${file} ${selector} { ${property} }`)
      .join('; ')}`,
  );
  const reads = sources.flatMap((entry) => [...entry.source.matchAll(/var\(\s*(--_[\w-]+)/g)].map((m) => m[1]));
  const unknownReads = [...new Set(reads)].filter(
    (name) => !FROZEN_SLOTS.has(name) && !LOCAL_SLOTS.has(name) && name !== SEMANTIC_SLOT,
  );
  must(unknownReads.length === 0, `unknown internal variable(s) read: ${unknownReads.join(', ')}`);
  const lenient = allDeclarations.filter(
    ({ property, value }) => property === SEMANTIC_SLOT && !value.startsWith('var(--bn-'),
  );
  must(
    lenient.length === 0,
    `${SEMANTIC_SLOT} may only be pointed at an accent token (a bn- class): ${lenient
      .map(({ file, selector, value }) => `${file} ${selector} { ${value} }`)
      .join('; ')}`,
  );
  return `${sources.length} files, ${new Set(allDeclarations.map((d) => d.property)).size} custom properties, 0 invented`;
});

await check('no colour literal and no !important in the five files', () => {
  const offenders = [];
  for (const entry of sources) {
    offenders.push(
      ...[...entry.source.matchAll(new RegExp(COLOUR_LITERAL.source, 'g'))].map((m) => `${entry.file}: ${m[0]}`),
    );
    must(
      !/!\s*important/.test(entry.source),
      `${entry.file} contains !important — the layer contract makes it unnecessary`,
    );
  }
  must(offenders.length === 0, `hardcoded colour(s): ${[...new Set(offenders)].join(', ')}`);
  return '0 hex / rgb() / hsl() / oklch() literals, no !important';
});

await check('geometry: every shadow is a tier or a documented re-derivation, and no distance is restated', () => {
  const shadows = allDeclarations.filter(({ property }) => property === 'box-shadow');
  must(shadows.length >= 5, `the five components must each paint a shadow, found ${shadows.length}`);
  const bad = shadows.filter(
    ({ value }) => !SHADOW_VALUE.canonical.has(value) && !SHADOW_VALUE.redrawn.has(value),
  );
  must(
    bad.length === 0,
    `box-shadow must be a tier token or one of the two re-derived forms (spec §3 invariant 2/3): ${bad
      .map(({ file, selector, value }) => `${file} ${selector} { ${value} }`)
      .join('; ')}`,
  );
  const literalShadows = shadows.filter(({ value }) => /\d+(?:\.\d+)?(?:px|rem|em|%)\b/.test(value));
  must(
    literalShadows.length === 0,
    `a shadow may not repeat an offset, a blur or a spread as a number: ${literalShadows
      .map(({ file, value }) => `${file} { ${value} }`)
      .join('; ')}`,
  );
  const literals = allDeclarations
    .filter(
      ({ property, value }) =>
        ['transform', 'translate', 'outline', 'outline-offset'].includes(property) && /\d/.test(value),
    )
    .map(({ file, selector, property, value }) => `${file} ${selector} { ${property}: ${value} }`);
  must(
    literals.length === 0,
    `geometry must be a var(--_…) or token reference (spec §3 invariant 3): ${literals.join('; ')}`,
  );
  const translates = sources.flatMap((entry) =>
    [...entry.source.matchAll(/translate\(([^)]*)\)/g)].map((m) => `${entry.file}: ${m[1].trim()}`),
  );
  const badTranslates = translates.filter((args) => !args.startsWith('var(--_'));
  must(badTranslates.length === 0, `translate() arguments must be slots: ${badTranslates.join('; ')}`);
  return `${shadows.length} shadows (${shadows.filter((s) => SHADOW_VALUE.redrawn.has(s.value)).length} re-derived for a colour), 0 literals`;
});

await check('every border width derives from --bn-border-width (the ring from a ratio of it)', () => {
  const offenders = allDeclarations
    .filter(({ property }) =>
      ['border-width', 'border-block-start-width', 'border-inline-start-width', 'border-top-width'].includes(property),
    )
    .filter(({ value }) => !value.includes('var(--bn-border-width)') && value !== 'var(--_stroke)');
  must(
    offenders.length === 0,
    `border width must read --bn-border-width: ${offenders
      .map(({ file, selector, property, value }) => `${file} ${selector} { ${property}: ${value} }`)
      .join('; ')}`,
  );
  const stroke = allDeclarations.find(({ property }) => property === '--_stroke');
  must(
    stroke && /^calc\(var\(--bn-border-width\) \* 2 \/ 3\)$/.test(stroke.value),
    `the spinner's ring must be a ratio of the structural border, read ${stroke?.value}`,
  );
  const widths = allDeclarations.filter(({ property }) => property === 'border-width');
  must(
    widths.every(({ value }) => value.includes('var(--bn-border-width)') || value === 'var(--_stroke)'),
    'every border-width declaration must be the structural width or the ring stroke',
  );
  return `${widths.length} border widths, ring ${stroke.value}`;
});

await check('meaning rides data-variant through --_variant-color; no component names a semantic colour', () => {
  const literals = sources.flatMap((entry) =>
    [...entry.source.matchAll(new RegExp(SEMANTIC_TOKEN.source, 'g'))].map((m) => `${entry.file}: ${m[0]}`),
  );
  must(
    literals.length === 0,
    `a component must read --_variant-color, not the semantic token: ${[...new Set(literals)].join(', ')}`,
  );
  const variantRules = allDeclarations.filter(({ selector }) => selector.includes('[data-variant'));
  must(variantRules.length > 0, 'no [data-variant] rule exists — the meaning axis is part of the ticket');
  const allowedInsideVariant = new Set(['--bn-shadow-color', 'box-shadow', 'background', 'color', '--_variant-color']);
  const layoutInsideVariant = variantRules.filter(
    ({ property }) => !property.startsWith('--_') && !allowedInsideVariant.has(property),
  );
  must(
    layoutInsideVariant.length === 0,
    `[data-variant] may only carry colour: ${layoutInsideVariant
      .map(({ file, selector, property, value }) => `${file} ${selector} { ${property}: ${value} }`)
      .join('; ')}`,
  );
  for (const entry of sources.filter((s) => ['badge.css', 'alert.css', 'spinner.css'].includes(s.file))) {
    must(
      /var\(--_variant-color/.test(entry.source),
      `${entry.file} does not read the semantic channel — its variants would be colourless`,
    );
  }
  return `${variantRules.length} variant declarations, 0 semantic colour literals`;
});

await check('the accent axis is bn- class names and the shape axis is bn- class names (ADR-0005 §1)', () => {
  const card = sources.find((s) => s.file === 'card.css');
  const accentTokens = ['--bn-pink', '--bn-blue', '--bn-green', '--bn-orange', '--bn-lavender'];
  for (const [index, name] of ACCENT_CLASSES.entries()) {
    must(card.source.includes(name), `card.css does not declare ${name} — the accent axis is appearance`);
    const rule = card.rules.find((r) => r.selector.split(',').map((s) => s.trim()).includes(name));
    must(rule, `${name} is mentioned but never declared as a rule`);
    must(
      declarations(rule.body).some(
        ([property, value]) => property === SEMANTIC_SLOT && value === `var(${accentTokens[index]})`,
      ),
      `${name} must point ${SEMANTIC_SLOT} at ${accentTokens[index]}`,
    );
  }
  const missing = REQUIRED_NAMES.filter((name) => !sources.some((entry) => entry.source.includes(name)));
  must(missing.length === 0, `missing name(s): ${missing.join(', ')}`);
  const shapes = REQUIRED_NAMES.filter((name) => !ACCENT_CLASSES.includes(name));
  return `${ACCENT_CLASSES.join(' ')} + ${shapes.join(' ')}`;
});

await check('an accent card republishes its colour as --bn-shadow-color, so border and shadow cannot drift', () => {
  const card = sources.find((s) => s.file === 'card.css');
  const coloured = card.rules.filter((rule) =>
    COLOUR_SELECTOR_PARTS.every((part) => rule.selector.includes(part)),
  );
  must(
    coloured.length === 1,
    `card.css must have exactly one rule for the nine colour-carrying shapes, found ${coloured.length}`,
  );
  const pairs = declarations(coloured[0].body);
  must(
    pairs.some(([property, value]) => property === '--bn-shadow-color' && value === `var(${SEMANTIC_SLOT})`),
    `the coloured card must republish ${SEMANTIC_SLOT} as --bn-shadow-color (spec §8 asks for one colour), found ${JSON.stringify(pairs)}`,
  );
  must(
    pairs.some(([property, value]) => property === 'box-shadow' && SHADOW_VALUE.redrawn.has(value)),
    'the coloured card must re-derive its shadow, because a shadow token is substituted on :root',
  );
  // The leak guard: a frozen slot overridden on a container is inherited by every descendant that
  // reads it, so a button inside an accent card would take the card's colour. The three box
  // components therefore state their shadow on the property, not through --_shadow-*.
  const slotOverrides = sources
    .filter((entry) => ['card.css', 'badge.css', 'alert.css'].includes(entry.file))
    .flatMap((entry) =>
      entry.declarations
        .filter(({ property }) => /^--_shadow-(?:rest|hover|press)$/.test(property))
        .map(({ file, selector, property }) => `${file} ${selector} { ${property} }`),
    );
  must(
    slotOverrides.length === 0,
    `a box component must not restate a shadow slot (it leaks to descendants): ${slotOverrides.join('; ')}`,
  );
  return '--bn-shadow-color republished from --_variant-color + one re-derived shadow, 0 slot overrides';
});

await check('motion is declared only inside @media (prefers-reduced-motion: no-preference)', () => {
  const motion = allDeclarations.filter(
    ({ property }) =>
      property === 'animation' ||
      property === 'transition' ||
      property.startsWith('animation-') ||
      property.startsWith('transition-'),
  );
  must(motion.length > 0, 'nothing declares an animation — the spinner would not turn');
  const outside = motion.filter((declaration) => !inNoPreference(declaration));
  must(
    outside.length === 0,
    `motion declared outside the no-preference block: ${outside
      .map(({ file, selector, property }) => `${file} ${selector} { ${property} }`)
      .join('; ')}`,
  );
  const reduce = sources.filter((entry) => /prefers-reduced-motion:\s*reduce/.test(entry.source));
  must(
    reduce.length === 0,
    `a reduce block that switches motion off afterwards is the rejected form (spec §7): ${reduce
      .map((e) => e.file)
      .join(', ')}`,
  );
  return `${motion.length} motion declarations, all guarded; 0 reduce blocks`;
});

await check("the spinner's keyframes live in spinner.css and the skeleton's in skeleton.css (decision §11)", () => {
  const spinner = sources.find((s) => s.file === 'spinner.css');
  const skeleton = sources.find((s) => s.file === 'skeleton.css');
  must(
    spinner.keyframes.some((k) => k.name === 'bn-spin'),
    'spinner.css does not declare @keyframes bn-spin — this ticket puts its own keyframes in its own file',
  );
  must(
    skeleton.keyframes.some((k) => k.name === 'bn-shimmer'),
    'skeleton.css does not declare @keyframes bn-shimmer',
  );
  const animations = read('src/css/animations.css');
  must(
    !/@keyframes\s+bn-spin\b/.test(animations) && !/@keyframes\s+bn-shimmer\b/.test(animations),
    'animations.css belongs to ticket 14 — this ticket’s keyframes must not be moved into it',
  );
  // "Still says loading" with motion switched off: the ring and the sheen are drawn outside any
  // media query, so the reduced case is a still ring and a still placeholder rather than nothing.
  const ring = spinner.rules.filter((rule) => declarations(rule.body).some(([p]) => p === 'border-width'));
  must(ring.length > 0, 'spinner.css draws no ring outside a media query — reduced motion would show nothing');
  must(ring.every((rule) => rule.conditions.length === 0), 'the ring must be unconditional');
  const sheen = skeleton.rules.filter((rule) => declarations(rule.body).some(([p]) => p === 'background-image'));
  must(
    sheen.length > 0 && sheen.every((rule) => rule.conditions.length === 0),
    'the placeholder sheen must be unconditional',
  );
  return 'bn-spin + bn-shimmer here, ring and sheen unconditional';
});

await check('decision §3C: [role="status"] is the spinner, and .bn-skeleton overrides it order-independently', () => {
  const spinner = sources.find((s) => s.file === 'spinner.css');
  const skeleton = sources.find((s) => s.file === 'skeleton.css');
  const statusRule = spinner.rules.find((rule) => /\[role="status"\]/.test(rule.selector));
  must(statusRule, 'spinner.css does not address [role="status"] — that is the component’s anchor (spec §8)');
  must(
    /:not\(\.bn-skeleton\)/.test(statusRule.selector),
    `the spinner rule must exclude .bn-skeleton explicitly, so the override does not depend on file order: ${statusRule.selector}`,
  );
  must(
    skeleton.rules.some((rule) => /(^|[^\w-])\.bn-skeleton\b/.test(rule.selector)),
    'skeleton.css does not style .bn-skeleton',
  );
  must(
    !skeleton.rules.some((rule) => /\[role="status"\](?!\.bn-skeleton)/.test(rule.selector)),
    'skeleton.css must not dress a bare [role="status"] — that is the spinner',
  );
  return `spinner: ${statusRule.selector}`;
});

await check('the built artifact carries all five files inside @layer components', () => {
  const artifact = read(ARTIFACT);
  const report = [];
  for (const file of FILES) {
    const marker = `/* src/css/${file} (@layer components) */`;
    must(artifact.includes(marker), `${ARTIFACT} has no ${file} block — run npm run build`);
    report.push(file);
  }
  const needles = [
    'box-shadow: var(--bn-shadow-x) var(--bn-shadow-y) 0 0 var(--bn-shadow-color)',
    'calc(var(--bn-shadow-x) / 2) calc(var(--bn-shadow-y) / 2) 0 0 var(--bn-shadow-color)',
    '@keyframes bn-spin',
    '@keyframes bn-shimmer',
    '--bn-shadow-color: var(--_variant-color)',
  ];
  for (const needle of needles) {
    must(artifact.includes(needle), `${ARTIFACT} is missing ${JSON.stringify(needle)}`);
  }
  return `${report.join(', ')} in the artifact`;
});

await check('the two global ARIA anchors cannot leak into the docs site (orchestrator §11)', () => {
  const offenders = [];
  for (const rel of SITE_SOURCES) {
    const text = read(rel);
    for (const role of ['status', 'alert']) {
      if (new RegExp(`role=["']${role}["']`).test(text)) offenders.push(`${rel}: role="${role}"`);
    }
  }
  must(
    offenders.length === 0,
    `the docs site uses a global anchor this ticket dresses: ${offenders.join(', ')}`,
  );
  for (const entry of sources) {
    must(
      !/site-|--site-/.test(entry.source),
      `${entry.file} mentions the docs site's namespace — the library owns bn-, the site owns site-`,
    );
  }
  return 'no role="status" / role="alert" in site markup or the site script';
});

await check('each of the five docs pages names its anchor in the lead sentence and starts at H3', () => {
  const report = [];
  for (const [file, anchors] of Object.entries(PAGES)) {
    const rel = `content/components/${file}`;
    must(fs.existsSync(abs(rel)), `${rel} is missing — one page per component (spec §10)`);
    const text = read(rel);
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    must(lines[0] === '---', `${rel}: frontmatter must open on line 1`);
    const end = lines.indexOf('---', 1);
    must(end !== -1, `${rel}: frontmatter is never closed`);
    const front = lines.slice(1, end).join('\n');
    for (const key of ['title:', 'description:']) {
      must(front.includes(key), `${rel}: frontmatter is missing ${key}`);
    }
    const body = lines.slice(end + 1);
    let inFence = false;
    const fenceInfo = [];
    const prose = [];
    for (const line of body) {
      if (/^```/.test(line)) {
        if (!inFence) fenceInfo.push(line.slice(3).trim());
        inFence = !inFence;
        continue;
      }
      if (!inFence) prose.push(line);
    }
    must(!inFence, `${rel}: a code fence is never closed`);
    const headings = prose.filter((line) => /^#{1,2}\s/.test(line));
    must(headings.length === 0, `${rel}: a component page starts at H3 (spec §10): ${headings.join(' | ')}`);
    const lead = prose.find((line) => line.trim() && !line.startsWith('>')) ?? '';
    for (const anchor of anchors) {
      must(
        lead.includes(anchor),
        `${rel}: the lead sentence must name the anchor ${anchor}, read: ${lead.slice(0, 120)}`,
      );
    }
    must(
      fenceInfo.some((info) => info === 'html'),
      `${rel}: no runnable html fence — the rendering layer turns HTML fences into Preview/Code pairs`,
    );
    const badInfo = fenceInfo.filter((info) => !/^(?:html|css|js|text|markdown)?$/.test(info));
    must(badInfo.length === 0, `${rel}: fence info must stay a bare language token: ${badInfo.join(', ')}`);
    const trailing = [...text.matchAll(/\]\(([^)]*)\)/g)].map((m) => m[1]).filter((url) => url.endsWith('/'));
    must(trailing.length === 0, `${rel}: a trailing slash is a broken link on this site: ${trailing.join(', ')}`);
    report.push(`${file}(${fenceInfo.length} fences)`);
  }
  return report.join(' ');
});

/* -------------------------------------- the page -------------------------------------- */

/**
 * The measurement page. Every component appears in its bare (semantic) form first, because that is
 * the anchor spec §8 assigns to it, and then in the shapes this ticket adds. `#card-with-button`
 * exists to prove the colour of an accent card does not leak into a control nested inside it.
 */
const FIXTURE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <link rel="icon" href="data:,">
    <title>barnacle static-component harness</title>
    <link rel="stylesheet" href="/static/barnacle.css">
  </head>
  <body>
    <main>
      <article id="card"><h3>A card</h3><p>One bare article.</p></article>
      <article id="card-pink" class="bn-pink"><h3>Pink</h3><p>An accent card.</p></article>
      <article id="card-green" class="bn-green"><h3>Green</h3><p>An accent card.</p></article>
      <article id="card-danger" data-variant="danger"><h3>Danger</h3><p>Meaning, not appearance.</p></article>
      <article id="card-override" class="bn-orange" style="--bn-shadow-color: rgb(116, 185, 255)"><h3>Override</h3><p>The token moves the shadow.</p></article>
      <article id="card-with-button"><button id="inside-button" type="button">Save</button></article>

      <p>
        <span id="badge" class="bn-badge">Default</span>
        <span id="badge-success" class="bn-badge" data-variant="success">Passing</span>
        <span id="badge-warning" class="bn-badge" data-variant="warning">Careful</span>
        <span id="badge-secondary" class="bn-badge" data-variant="secondary">Draft</span>
        <span id="badge-solid" class="bn-badge bn-solid" data-variant="success">Solid</span>
        <span id="badge-outline" class="bn-badge bn-outline" data-variant="danger">Outline</span>
        <span id="badge-pink" class="bn-badge bn-pink">Pink</span>
        <span id="badge-sm" class="bn-badge bn-sm">Small</span>
      </p>

      <div id="alert" role="alert"><p>Saved.</p></div>
      <div id="alert-warning" role="alert" data-variant="warning"><p>Careful.</p></div>
      <div id="alert-solid" role="alert" class="bn-solid" data-variant="success"><p>Filled.</p></div>

      <span id="spinner" role="status" aria-label="Loading"></span>
      <span id="spinner-explicit" role="status" class="bn-spinner" aria-label="Loading"></span>
      <span id="spinner-danger" role="status" aria-label="Loading" data-variant="danger"></span>

      <div id="skeleton" role="status" class="bn-skeleton" aria-label="Loading the report" style="inline-size: 10rem; block-size: 3rem"></div>
      <div id="skeleton-2" role="status" class="bn-skeleton" aria-label="Loading the report" style="inline-size: 6rem; block-size: 1rem"></div>
    </main>
  </body>
</html>
`;

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

/** Serves the fixture from memory and the published artifact from `static/`. */
async function startServer() {
  const staticRoot = abs('static');
  const server = http.createServer((req, res) => {
    let urlPath;
    try {
      urlPath = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    } catch {
      res.writeHead(400).end('bad url');
      return;
    }
    if (urlPath === '/harness.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(FIXTURE);
      return;
    }
    const file = path.resolve(staticRoot, `.${urlPath.replace(/^\/static/, '')}`);
    if (urlPath.startsWith('/static/') && file.startsWith(staticRoot + path.sep)) {
      fs.readFile(file, (error, buffer) => {
        if (error) {
          res.writeHead(404, { 'content-type': 'text/plain' }).end(`not found: ${urlPath}`);
          return;
        }
        res.writeHead(200, {
          'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
          'cache-control': 'no-store',
        });
        res.end(buffer);
      });
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' }).end(`not found: ${urlPath}`);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, url: `${origin}/harness.html`, close: () => new Promise((r) => server.close(r)) };
}

/**
 * A mid-transition read lies convincingly: reads after `hover()` return the value from *before* the
 * transition (browser-harness-findings §3.3). Freezing is registered before `goto`, and a check
 * that is *about* an animation opts out with `{ freeze: false }`.
 */
const FREEZE_INIT = (css) => {
  const apply = () => {
    const style = document.createElement('style');
    style.textContent = css;
    (document.head ?? document.documentElement).appendChild(style);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply, { once: true });
  else apply();
};
const FREEZE_CSS =
  '*,*::before,*::after{transition:none !important;animation:none !important;caret-color:transparent !important}';

async function withPage(browser, server, options, fn) {
  const { freeze = true, ...contextOptions } = options ?? {};
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...contextOptions });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  if (freeze && contextOptions.javaScriptEnabled !== false) {
    await page.addInitScript(FREEZE_INIT, FREEZE_CSS);
  }
  try {
    await page.goto(server.url, { waitUntil: 'load' });
    return await fn(page, { consoleErrors, pageErrors });
  } finally {
    await context.close();
  }
}

/* ---------------------------------- readable assertions ---------------------------------- */

class StyleAssertionError extends Error {
  constructor({ invariant, selector, property, expected, actual, hint }) {
    const lines = [
      `✗ invariant failed: ${invariant}`,
      `    selector : ${selector}`,
      `    property : ${property}`,
      `    expected : ${expected}`,
      `    actual   : ${actual}`,
    ];
    if (hint) lines.push(`    hint     : ${hint}`);
    super(lines.join('\n'));
    this.name = 'StyleAssertionError';
  }
}

async function readStyles(page, selector, properties) {
  return page.evaluate(
    ([sel, props]) => {
      const el = document.querySelector(sel);
      if (!el) return { found: false };
      const cs = getComputedStyle(el);
      const out = { found: true };
      for (const property of props) out[property] = cs[property];
      return out;
    },
    [selector, properties],
  );
}

async function expectStyle(page, selector, expectations, invariantPrefix = '') {
  const properties = Object.keys(expectations);
  const actual = await readStyles(page, selector, properties);
  if (!actual.found) {
    throw new StyleAssertionError({
      invariant: `${invariantPrefix}the element exists`,
      selector,
      property: '<existence>',
      expected: 'an element matching the selector',
      actual: '<element not found>',
      hint: 'check the fixture markup in scripts/verify-static.mjs',
    });
  }
  const broken = [];
  for (const [property, want] of Object.entries(expectations)) {
    if (actual[property] === want) continue;
    broken.push(
      new StyleAssertionError({
        invariant: `${invariantPrefix}${property}`,
        selector,
        property,
        expected: want,
        actual: actual[property],
        hint: /\d+\.\d+px/.test(String(actual[property]))
          ? 'a fractional px length usually means the transition was NOT frozen in time'
          : undefined,
      }),
    );
  }
  if (broken.length > 0) throw new AggregateError(broken, broken.map((error) => error.message).join('\n\n'));
  return actual;
}

/** Reads a shadow's four lengths plus the animation state, so each claim is a measured fact. */
async function readGeometry(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { found: false };
    const cs = getComputedStyle(el);
    const lengths = (cs.boxShadow.match(/-?[\d.]+px/g) ?? []).map((value) => parseFloat(value));
    const matrix = cs.transform;
    const parts = matrix.startsWith('matrix(') ? matrix.slice(7, -1).split(',').map(Number) : [];
    return {
      found: true,
      hovered: el.matches(':hover'),
      shadow: cs.boxShadow,
      shadowX: lengths[0],
      shadowY: lengths[1],
      shadowBlur: lengths[2],
      shadowSpread: lengths[3],
      shadowLengths: lengths.length,
      transform: matrix,
      translateX: parts[4] ?? 0,
      translateY: parts[5] ?? 0,
      animationName: cs.animationName,
      animationDuration: cs.animationDuration,
      animationIterationCount: cs.animationIterationCount,
      borderTopWidth: cs.borderTopWidth,
      borderInlineStartWidth: cs.borderInlineStartWidth,
      borderRadius: cs.borderRadius,
    };
  }, selector);
}

/* =================================== browser checks =================================== */

const BROWSER_CHECKS = [
  [
    'verification 1: a bare <article> is a card — md tier, structural border, secondary surface',
    async (browser, server) =>
      withPage(browser, server, {}, async (page, issues) => {
        await expectStyle(
          page,
          '#card',
          {
            boxShadow: SHADOW.md,
            borderTopWidth: BORDER_PX,
            borderTopColor: COLOR.ink,
            borderRadius: RADIUS,
            backgroundColor: COLOR.secondary,
            color: COLOR.ink,
            paddingTop: CARD_PADDING,
            paddingLeft: CARD_PADDING,
            display: 'block',
            transform: 'none',
          },
          'bare <article>: ',
        );
        const geometry = await readGeometry(page, '#card');
        must(
          geometry.shadowBlur === 0 && geometry.shadowSpread === 0 && geometry.shadowLengths === 4,
          `the hard shadow must keep a zero blur and a spread (spec §3 invariant 2), read ${geometry.shadow}`,
        );
        must(
          geometry.shadowX === geometry.shadowY && geometry.shadowX > 0,
          `the shadow offsets must be equal and positive, read ${geometry.shadow}`,
        );
        must(issues.consoleErrors.length === 0, `console errors: ${issues.consoleErrors.join(' | ')}`);
        must(issues.pageErrors.length === 0, `page errors: ${issues.pageErrors.join(' | ')}`);
        return `${geometry.shadow}, border ${BORDER_PX} ${COLOR.ink}, padding ${CARD_PADDING}`;
      }),
  ],
  [
    'verification 2: an accent card paints its border and its shadow in the same colour',
    async (browser, server) =>
      withPage(browser, server, {}, async (page) => {
        await expectStyle(
          page,
          '#card-pink',
          { borderTopColor: COLOR.pink, boxShadow: SHADOW.pink, backgroundColor: COLOR.secondary },
          '.bn-pink card: ',
        );
        await expectStyle(
          page,
          '#card-green',
          { borderTopColor: COLOR.green, boxShadow: SHADOW.green },
          '.bn-green card: ',
        );
        const pink = await readGeometry(page, '#card-pink');
        must(
          pink.shadow.includes(COLOR.pink),
          `the shadow must be drawn in the card's own colour, read ${pink.shadow}`,
        );
        return `border ${COLOR.pink} + shadow ${pink.shadow}`;
      }),
  ],
  [
    'verification 2: overriding --bn-shadow-color on an accent card moves the shadow',
    async (browser, server) =>
      withPage(browser, server, {}, async (page) => {
        await expectStyle(
          page,
          '#card-override',
          { boxShadow: SHADOW.blue, borderTopColor: COLOR.orange },
          'accent card with the token overridden: ',
        );
        // …and the same lever, applied at runtime, on an accent card that shipped without it.
        const moved = await page.evaluate(() => {
          const el = document.querySelector('#card-pink');
          el.style.setProperty('--bn-shadow-color', 'rgb(116, 185, 255)');
          return getComputedStyle(el).boxShadow;
        });
        must(
          moved === SHADOW.blue,
          `a card's shadow must read --bn-shadow-color on the card, read ${moved} (a :root-substituted token would ignore it)`,
        );
        return `--bn-shadow-color override → ${moved}`;
      }),
  ],
  [
    'verification 1: the dark theme flips the card’s border and shadow to the page’s light ink',
    async (browser, server) =>
      withPage(browser, server, {}, async (page) => {
        await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
        await expectStyle(
          page,
          '#card',
          {
            boxShadow: SHADOW.mdDark,
            borderTopColor: COLOR.darkInk,
            backgroundColor: COLOR.darkSecondary,
            color: COLOR.darkInk,
          },
          'dark bare <article>: ',
        );
        await expectStyle(
          page,
          '#card-pink',
          { boxShadow: SHADOW.pink, borderTopColor: COLOR.pink },
          'dark .bn-pink card (accents are unchanged by spec §6.2): ',
        );
        return `dark: ${SHADOW.mdDark}; the accent card keeps ${COLOR.pink}`;
      }),
  ],
  [
    'the meaning axis reaches the card through the theme mapping (and is not clobbered here)',
    async (browser, server) =>
      withPage(browser, server, {}, async (page) => {
        await expectStyle(
          page,
          '#card-danger',
          { borderTopColor: COLOR.pink, boxShadow: SHADOW.pink },
          'article[data-variant="danger"]: ',
        );
        return 'data-variant="danger" → border and shadow in --bn-danger';
      }),
  ],
  [
    'an accent card does not leak its colour into a control nested inside it',
    async (browser, server) =>
      withPage(browser, server, {}, async (page) => {
        await page.evaluate(() => {
          document.querySelector('#card-with-button').classList.add('bn-pink');
        });
        await expectStyle(
          page,
          '#inside-button',
          { boxShadow: SHADOW.md, borderTopColor: COLOR.ink },
          'button inside .bn-pink card: ',
        );
        return 'the nested button keeps the page’s own shadow colour';
      }),
  ],
  [
    'the badge: sm tier, no lift on hover, and its variants colour border and shadow together',
    async (browser, server) =>
      withPage(browser, server, {}, async (page) => {
        await expectStyle(
          page,
          '#badge',
          {
            boxShadow: SHADOW.sm,
            borderTopWidth: BORDER_PX,
            borderTopColor: COLOR.ink,
            backgroundColor: COLOR.secondary,
            borderRadius: RADIUS,
            display: 'inline-flex',
          },
          '.bn-badge: ',
        );
        await expectStyle(
          page,
          '#badge-success',
          { borderTopColor: COLOR.green, boxShadow: SHADOW.greenSm },
          '.bn-badge[data-variant="success"]: ',
        );
        await expectStyle(
          page,
          '#badge-pink',
          { borderTopColor: COLOR.pink, boxShadow: SHADOW.pinkSm },
          '.bn-badge.bn-pink: ',
        );
        // secondary is a hierarchy, not a colour: the shadow stays the page's own.
        await expectStyle(
          page,
          '#badge-secondary',
          { borderTopColor: COLOR.ink, boxShadow: SHADOW.sm },
          '.bn-badge[data-variant="secondary"]: ',
        );
        await expectStyle(
          page,
          '#badge-solid',
          { backgroundColor: COLOR.green, color: COLOR.ink },
          '.bn-solid: ',
        );
        await expectStyle(
          page,
          '#badge-outline',
          { backgroundColor: COLOR.transparent, color: COLOR.pink, borderTopColor: COLOR.pink },
          '.bn-outline: ',
        );
        const sizes = await page.evaluate(() => {
          const big = getComputedStyle(document.querySelector('#badge'));
          const small = getComputedStyle(document.querySelector('#badge-sm'));
          return { big: big.fontSize, small: small.fontSize, smallBorder: small.borderTopWidth };
        });
        must(
          sizes.small === '12px' && sizes.big === '13px',
          `the size axis must change only the type, read ${JSON.stringify(sizes)}`,
        );
        must(sizes.smallBorder === BORDER_PX, 'a size may not touch the border box');
        await page.hover('#badge-success');
        const hovered = await readGeometry(page, '#badge-success');
        must(hovered.hovered === true, 'the page does not report :hover after page.hover()');
        must(
          hovered.transform === 'none',
          `a badge is a label, not a control: it must not lift, read ${hovered.transform}`,
        );
        return `sm ${SHADOW.sm}, success ${COLOR.green} border + ${SHADOW.greenSm}, sizes 13px/12px, no lift`;
      }),
  ],
  [
    'the alert: a doubled inline-start bar, the sm tier, and variants that colour both',
    async (browser, server) =>
      withPage(browser, server, {}, async (page) => {
        await expectStyle(
          page,
          '#alert',
          {
            display: 'flex',
            boxShadow: SHADOW.sm,
            borderTopWidth: BORDER_PX,
            borderInlineStartWidth: ALERT_BAR,
            borderTopColor: COLOR.ink,
            backgroundColor: COLOR.secondary,
          },
          '[role="alert"]: ',
        );
        await expectStyle(
          page,
          '#alert-warning',
          { borderTopColor: COLOR.orange, borderInlineStartColor: COLOR.orange, boxShadow: SHADOW.orangeSm },
          '[role="alert"][data-variant="warning"]: ',
        );
        await expectStyle(
          page,
          '#alert-solid',
          { backgroundColor: COLOR.green, color: COLOR.ink, boxShadow: SHADOW.greenSm },
          '[role="alert"].bn-solid: ',
        );
        return `bar ${ALERT_BAR} + ${SHADOW.sm}; warning ${COLOR.orange}`;
      }),
  ],
  [
    'the spinner: a bare [role="status"] turns, and its arc takes the semantic colour',
    async (browser, server) =>
      withPage(browser, server, { freeze: false }, async (page) => {
        await expectStyle(
          page,
          '#spinner',
          {
            display: 'inline-block',
            inlineSize: SPINNER_SIZE,
            blockSize: SPINNER_SIZE,
            borderTopWidth: SPINNER_STROKE,
            borderBottomWidth: SPINNER_STROKE,
            borderTopColor: COLOR.main,
            borderBottomColor: SPINNER_TRACK,
            borderRadius: '50%',
            animationName: 'bn-spin',
            animationIterationCount: 'infinite',
          },
          'bare [role="status"]: ',
        );
        await expectStyle(page, '#spinner-explicit', { animationName: 'bn-spin' }, '.bn-spinner: ');
        await expectStyle(
          page,
          '#spinner-danger',
          { borderTopColor: COLOR.pink },
          '[data-variant="danger"] spinner: ',
        );
        // --_size is the ring's outside: border-box, so the box is the size the author asked for.
        // offsetWidth, not boundingBox(): the ring is mid-rotation, and a rotated square has a
        // larger axis-aligned box (a measurement artefact, not a layout fact).
        const box = await page.evaluate(() => {
          const el = document.querySelector('#spinner');
          return { width: el.offsetWidth, height: el.offsetHeight };
        });
        must(
          box.width === 24 && box.height === 24,
          `the ring must occupy ${SPINNER_SIZE} square including its stroke, read ${box.width}×${box.height}`,
        );
        const label = await page.evaluate(() => document.querySelector('#spinner').getAttribute('aria-label'));
        must(label, 'the spinner must carry an accessible name (a ring says nothing to a screen reader)');
        return `${SPINNER_SIZE} ring, ${SPINNER_STROKE} stroke, arc ${COLOR.main}, bn-spin infinite`;
      }),
  ],
  [
    'verification 3: reduced motion stops the spin, and the ring still says "loading"',
    async (browser, server) => {
      const reduced = await withPage(browser, server, { reducedMotion: 'reduce', freeze: false }, async (page) => {
        const matches = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
        must(matches === true, 'the reducedMotion: reduce context did not reach the page');
        await expectStyle(page, '#spinner', { animationName: 'none', animationDuration: '0s' }, 'reduced spinner: ');
        // "Still says loading": the ring is drawn and its arc is the accent colour, so the element
        // is visibly an incomplete circle rather than an empty box.
        await expectStyle(
          page,
          '#spinner',
          {
            inlineSize: SPINNER_SIZE,
            borderTopWidth: SPINNER_STROKE,
            borderTopColor: COLOR.main,
            borderBottomColor: SPINNER_TRACK,
          },
          'reduced spinner geometry: ',
        );
        await expectStyle(
          page,
          '#skeleton',
          {
            animationName: 'none',
            borderTopWidth: BORDER_PX,
            borderRadius: RADIUS,
            backgroundImage:
              'linear-gradient(90deg, rgba(0, 0, 0, 0) 0%, color(srgb 0 0 0 / 0.08) 50%, rgba(0, 0, 0, 0) 100%)',
          },
          'reduced skeleton: ',
        );
        const box = await page.locator('#skeleton').boundingBox();
        must(
          Math.round(box.width) === 160 && Math.round(box.height) === 48,
          `the placeholder keeps the size its author gave it, read ${Math.round(box.width)}×${Math.round(box.height)}`,
        );
        return 'spinner frozen with its ring intact; skeleton a still, bordered, sheened block';
      });
      const full = await withPage(browser, server, { freeze: false }, async (page) => {
        const matches = await page.evaluate(() => matchMedia('(prefers-reduced-motion: no-preference)').matches);
        must(matches === true, 'the default context does not report prefers-reduced-motion: no-preference');
        await expectStyle(
          page,
          '#skeleton',
          { animationName: 'bn-shimmer', backgroundSize: '200% 100%', backgroundRepeat: 'no-repeat' },
          'animated skeleton: ',
        );
        return (await readStyles(page, '#spinner', ['animationDuration'])).animationDuration;
      });
      return `reduce: ${reduced}; no-preference: skeleton bn-shimmer, spinner ${full}`;
    },
  ],
  [
    'decision §3C: the skeleton is not the spinner, on the same page and in either motion setting',
    async (browser, server) =>
      withPage(browser, server, { freeze: false }, async (page) => {
        const [spinner, skeleton] = await Promise.all([
          readGeometry(page, '#spinner'),
          readGeometry(page, '#skeleton'),
        ]);
        must(skeleton.borderRadius === RADIUS, `a placeholder is square (--bn-radius), read ${skeleton.borderRadius}`);
        must(spinner.borderRadius === '50%', `the spinner is a circle, read ${spinner.borderRadius}`);
        must(
          skeleton.animationName === 'bn-shimmer' && spinner.animationName === 'bn-spin',
          `each keeps its own animation, read ${skeleton.animationName} / ${spinner.animationName}`,
        );
        const width = await page.evaluate(() => getComputedStyle(document.querySelector('#skeleton')).inlineSize);
        must(width === '160px', `a placeholder takes the width its author gives it, read ${width}`);
        const stacked = await page.evaluate(
          () => getComputedStyle(document.querySelector('#skeleton-2')).marginBlockStart,
        );
        must(stacked === '8px', `consecutive placeholders keep a rhythm, read ${stacked}`);
        return `spinner circle/bn-spin, skeleton square/bn-shimmer at ${width}`;
      }),
  ],
  [
    'verification 1: the five components render with JavaScript switched off',
    async (browser, server) =>
      withPage(browser, server, { javaScriptEnabled: false }, async (page) => {
        const scripts = await page.evaluate(() => document.querySelectorAll('script').length);
        must(scripts === 0, `the fixture must not load a script, found ${scripts}`);
        await expectStyle(page, '#card', { boxShadow: SHADOW.md, backgroundColor: COLOR.secondary }, 'no-JS card: ');
        await expectStyle(page, '#card-pink', { boxShadow: SHADOW.pink }, 'no-JS accent card: ');
        await expectStyle(page, '#badge-success', { boxShadow: SHADOW.greenSm }, 'no-JS badge: ');
        await expectStyle(page, '#alert-warning', { boxShadow: SHADOW.orangeSm }, 'no-JS alert: ');
        await expectStyle(
          page,
          '#spinner',
          { animationName: 'bn-spin', borderTopWidth: SPINNER_STROKE, inlineSize: SPINNER_SIZE },
          'no-JS spinner: ',
        );
        await expectStyle(page, '#skeleton', { animationName: 'bn-shimmer' }, 'no-JS skeleton: ');
        return 'rest geometry, accents, variants, ring and placeholders all render with no script';
      }),
  ],
];

/** Browser checks need playwright-core; without it they skip loudly, as the other verifiers do. */
async function runBrowserChecks() {
  if (process.argv.includes('--no-browser')) {
    skips += BROWSER_CHECKS.length;
    console.log(`SKIP  ${BROWSER_CHECKS.length} browser checks (--no-browser)`);
    return;
  }
  let chromium;
  try {
    ({ chromium } = await import('playwright-core'));
  } catch {
    skips += BROWSER_CHECKS.length;
    console.log(
      `SKIP  ${BROWSER_CHECKS.length} browser checks — playwright-core is not installed ` +
        '(run: npm i --no-save playwright-core@1.64.1)',
    );
    return;
  }
  const server = await startServer();
  // channel: 'chrome' drives the system Chrome; the bundled chromium revision is not present.
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  console.log(`      ${server.url} on system Chrome ${browser.version()}\n`);
  try {
    for (const [name, fn] of BROWSER_CHECKS) await check(name, () => fn(browser, server));
  } finally {
    await browser.close();
    await server.close();
  }
}

await runBrowserChecks();

/* -------------------------------------- summary -------------------------------------- */

console.log(`\n${checks - failures.length}/${checks} checks passed${skips ? `, ${skips} skipped` : ''}`);
if (failures.length > 0) {
  console.log('\nfailed:');
  for (const name of failures) console.log(`  - ${name}`);
  process.exit(1);
}
