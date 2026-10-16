#!/usr/bin/env node
/**
 * Scripted verification for ticket 05 — public tokens and dark mode.
 *
 * Ticket 05 owns exactly one source file (`src/css/01-theme.css`) and the theme layer
 * of the published artifacts. Everything this ticket claims is checked here against
 * the **unminified artifact** (`static/barnacle.css`), which is the artifact the spec
 * and ADRs describe, plus the theme layer's own text.
 *
 * The seams under test are public:
 *
 *   - `static/barnacle.css`: the theme layer block, the custom properties it
 *     declares, and every custom property the whole artifact references
 *   - `src/css/01-theme.css`: the source of that block
 *
 * Expected values below are the independent source of truth: they are transcribed
 * from spec.md §6.1 / §6.2 / §6.3 and ADR-0003/0004/0005. They are deliberately
 * written out as literals rather than recomputed from the implementation.
 *
 * Deliberately NOT checked here (they belong to ticket 08's browser harness):
 *   - computed shadow geometry with `--bn-shadow-x: 8px` overridden live
 *   - that hard shadows actually turn white under `[data-theme="dark"]` on screen
 *   - that `colorScheme: 'dark'` alone changes nothing
 *
 * Run with: npm run verify:theme   (or: node scripts/verify-theme.mjs)
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const abs = (...parts) => path.join(ROOT, ...parts);

/* ------------------------------------ harness ------------------------------------ */

const failures = [];
let checks = 0;

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

/* ---------------------------------- expectations ---------------------------------- */

/** spec.md §6.1: every public token in the light theme, name → value, verbatim. */
const EXPECTED_ROOT_TOKENS = {
  '--bn-border-width': '3px',
  '--bn-border-color': '#000000',
  '--bn-radius': '0',
  '--bn-shadow-x': '4px',
  '--bn-shadow-y': '4px',
  '--bn-shadow-reverse-x': '-4px',
  '--bn-shadow-reverse-y': '-4px',
  '--bn-shadow-color': 'var(--bn-border-color)',
  '--bn-shadow-lift': 'calc(var(--bn-shadow-x) / 2)',
  '--bn-shadow-sm':
    'calc(var(--bn-shadow-x) / 2) calc(var(--bn-shadow-y) / 2) 0 0 var(--bn-shadow-color)',
  '--bn-shadow-md': 'var(--bn-shadow-x) var(--bn-shadow-y) 0 0 var(--bn-shadow-color)',
  '--bn-shadow-lg':
    'calc(var(--bn-shadow-x) * 1.5) calc(var(--bn-shadow-y) * 1.5) 0 0 var(--bn-shadow-color)',
  '--bn-shadow': 'var(--bn-shadow-md)',
  '--bn-press': '3px',
  '--bn-background': '#FFFDF5',
  '--bn-secondary-background': '#FFFFFF',
  '--bn-foreground': '#000000',
  '--bn-main': '#FFD23F',
  '--bn-main-foreground': '#000000',
  '--bn-ring': '#74B9FF',
  '--bn-overlay': 'rgb(0 0 0 / 0.8)',
  '--bn-pink': '#FF6B6B',
  '--bn-blue': '#74B9FF',
  '--bn-green': '#88D498',
  '--bn-orange': '#FFA552',
  '--bn-lavender': '#B8A9FA',
  '--bn-success': 'var(--bn-green)',
  '--bn-warning': 'var(--bn-orange)',
  '--bn-danger': 'var(--bn-pink)',
  '--bn-font-family': 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
  '--bn-font-display': 'var(--bn-font-family)',
  '--bn-font-mono': 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  '--bn-font-weight-base': '500',
  '--bn-font-weight-heading': '700',
  '--bn-transition': '150ms ease',
};

/** spec.md §6.2: the dark block resets these six tokens and nothing else. */
const EXPECTED_DARK_TOKENS = {
  '--bn-background': '#1A1A1A',
  '--bn-secondary-background': '#262626',
  '--bn-foreground': '#FFFDF5',
  '--bn-border-color': '#FFFDF5',
  '--bn-shadow-color': '#FFFDF5',
  '--bn-ring': '#74B9FF',
};

/**
 * spec.md §6.2: accent colours (--bn-main plus the five accents and the three
 * semantic aliases) must survive dark mode untouched.
 */
const ACCENT_TOKENS = [
  '--bn-main',
  '--bn-pink',
  '--bn-blue',
  '--bn-green',
  '--bn-orange',
  '--bn-lavender',
  '--bn-success',
  '--bn-warning',
  '--bn-danger',
];

/** ADR-0005: public tokens are `--bn-*`, internal variables are `--_*`. Nothing else. */
const PUBLIC_PREFIX = '--bn-';
const INTERNAL_PREFIX = '--_';

/**
 * Foreign custom properties the artifact is allowed to reference. The list is empty
 * and is meant to stay empty: the check below exists so that a stray unprefixed
 * `--foo` in a future ticket fails loudly instead of silently.
 */
const ALLOWED_FOREIGN_PROPERTIES = [];

/** The theme layer's file owns exactly one internal variable, the variant colour. */
const VARIANT_PROPERTY = '--_variant-color';

/** spec.md §6.1: the three shadow tiers and the internal offset slot they derive from. */
const SHADOW_TIERS = ['--bn-shadow-sm', '--bn-shadow-md', '--bn-shadow-lg'];
const OFFSET_SLOTS = [
  ['--bn-shadow-x', '--bn-shadow-y'],
  ['--bn-shadow-reverse-x', '--bn-shadow-reverse-y'],
];

/* ------------------------------------ CSS slicing ------------------------------------ */

/** Strip CSS comments so they can never satisfy or trip a text check. */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

function readArtifact() {
  return readFileSync(abs('static/barnacle.css'), 'utf8');
}

/**
 * Index of the `}` that closes the block opened by the `{` at `openIndex`.
 * Comment-stripped input only, so string state is cheap to track.
 */
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

/** All top-level rule blocks `selector { body }` of a text blob. */
function topLevelRules(text) {
  const rules = [];
  let i = 0;
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i])) i += 1;
    if (i >= text.length) break;
    const open = text.indexOf('{', i);
    const semi = text.indexOf(';', i);
    if (open === -1 || (semi !== -1 && semi < open)) break; // at-statement or junk
    const selector = text.slice(i, open).trim();
    const close = matchBrace(text, open, selector);
    rules.push({ selector, body: text.slice(open + 1, close) });
    i = close + 1;
  }
  return rules;
}

/** The block body of every `@layer <name> { … }` in the artifact, concatenated. */
function layerBodies(css, layerName) {
  const bodies = [];
  const re = new RegExp(`@layer\\s+${layerName}\\s*\\{`, 'g');
  for (const match of css.matchAll(re)) {
    const open = match.index + match[0].length - 1;
    const close = matchBrace(css, open, `@layer ${layerName}`);
    bodies.push(css.slice(open + 1, close));
  }
  must(bodies.length === 1, `expected exactly one @layer ${layerName} block, found ${bodies.length}`);
  return bodies[0];
}

/** Split a CSS value on whitespace that is not inside parentheses or quotes. */
function splitTopLevel(value) {
  const parts = [];
  let current = '';
  let depth = 0;
  let quote = null;
  for (const ch of value) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === '(') {
      depth += 1;
      current += ch;
    } else if (ch === ')') {
      depth -= 1;
      current += ch;
    } else if (/\s/.test(ch) && depth === 0) {
      if (current) parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);
  return parts;
}

/** `customProp: value` pairs declared directly in a rule body, in document order. */
function declarations(body) {
  const pairs = [];
  const re = /(--[\w-]+|[\w-]+)\s*:\s*([^;{}]+)/g;
  for (const match of body.matchAll(re)) {
    pairs.push([match[1], match[2].replace(/\s+/g, ' ').trim()]);
  }
  return pairs;
}

/** The `:root` rules of a layer body, as declared pairs. */
function rootDeclarations(layer) {
  const roots = topLevelRules(layer).filter((rule) => rule.selector === ':root');
  must(roots.length > 0, 'the theme layer declares no :root rule');
  const pairs = new Map();
  for (const rule of roots) {
    for (const [name, value] of declarations(rule.body)) pairs.set(name, value);
  }
  return pairs;
}

/** The `[data-theme="dark"]` rules of a layer body, as declared pairs. */
function darkDeclarations(layer) {
  const rules = topLevelRules(layer).filter((rule) =>
    /\[data-theme\s*=\s*["']?dark["']?\]/.test(rule.selector),
  );
  must(rules.length > 0, 'the theme layer declares no [data-theme="dark"] rule');
  const pairs = new Map();
  for (const rule of rules) {
    for (const [name, value] of declarations(rule.body)) pairs.set(name, value);
  }
  return pairs;
}

/** Every `data-variant="…"` selector of a layer body → the property it sets. */
function variantMap(layer) {
  const mapping = new Map();
  for (const rule of topLevelRules(layer)) {
    if (!/data-variant/.test(rule.selector)) continue;
    for (const [name, value] of declarations(rule.body)) {
      mapping.set(name, value);
    }
  }
  return mapping;
}

/* ------------------------------------ checks ------------------------------------ */

/** Field-by-field comparison of a spec transcription against what the artifact declares. */
function diff(expected, actual, label) {
  const missing = Object.keys(expected).filter((key) => !(key in actual));
  const extra = Object.keys(actual).filter((key) => !(key in expected));

  const wrong = Object.keys(expected).filter(
    (key) => key in actual && actual[key] !== expected[key],
  );
  must(
    missing.length === 0 && extra.length === 0 && wrong.length === 0,
    [
      missing.length > 0 ? `missing: ${missing.join(', ')}` : null,
      extra.length > 0 ? `unexpected: ${extra.join(', ')}` : null,
      ...wrong.map((key) => `${key} = ${JSON.stringify(actual[key])} (spec: ${JSON.stringify(expected[key])})`),
    ]
      .filter(Boolean)
      .join(`; `),
  );
  return `${Object.keys(expected).length} ${label} match spec`;
}

console.log(`barnacle theme verification — ${ROOT}\n`);

const rawCss = readArtifact();
const css = stripComments(rawCss);
const theme = layerBodies(css, 'theme');
/**
 * Token extraction is itself a claim, so a failure here is reported as a failing
 * check instead of an uncaught throw — the remaining checks still run and report.
 */
function extract(label, fn, fallback) {
  try {
    return fn();
  } catch (error) {
    failures.push(label);
    console.log(`FAIL  ${label} — ${error.message}`);
    return fallback;
  }
}
const rootTokens = extract(
  'the theme layer declares a :root rule',
  () => rootDeclarations(theme),
  new Map(),
);
const darkTokens = extract(
  'the theme layer declares a [data-theme="dark"] rule',
  () => darkDeclarations(theme),
  new Map(),
);
const variants = extract(
  'the theme layer declares a data-variant mapping',
  () => variantMap(theme),
  new Map(),
);
checks += 3;

/* -------------------------- 1. no prefers-color-scheme -------------------------- */

await check('the unminified artifact never mentions prefers-color-scheme', () => {
  // Checked on the comment-stripped text: a comment cannot switch a colour scheme,
  // so only live CSS counts. Ticket 01's verify.mjs greps the raw file separately.
  const live = [...css.matchAll(/prefers-color-scheme/g)].length;
  const raw = [...rawCss.matchAll(/prefers-color-scheme/g)].length;
  must(
    live === 0,
    `ADR-0004 forbids it, found ${live} live hit(s) in static/barnacle.css (raw: ${raw})`,
  );
  return `0 live hits in the artifact (raw text including comments: ${raw})`;
});

await check('dark mode is opt-in through [data-theme="dark"] only', () => {
  const selectors = topLevelRules(theme)
    .map((rule) => rule.selector)
    .filter((selector) => /prefers-color-scheme|color-scheme|:root\[data-theme/.test(selector));
  must(selectors.length === 0, `unexpected theme selector(s): ${selectors.join(' | ')}`);
  const media = [...theme.matchAll(/@media[^{]*/g)].map((m) => m[0].trim());
  must(media.length === 0, `the theme layer must not wrap tokens in media queries: ${media.join(' | ')}`);
  const dark = topLevelRules(theme).filter((rule) =>
    /\[data-theme\s*=\s*["']?dark["']?\]/.test(rule.selector),
  );
  must(dark.length > 0, 'no [data-theme="dark"] rule found');
  return dark.map((rule) => rule.selector).join(', ');
});

/* ------------------------------ 2. naming discipline ------------------------------ */

await check('every custom property in the artifact is --bn-* or --_*', () => {
  const seen = new Map(); // name -> where
  const declareRe = /(--[\w-]+)\s*:/g;
  const useRe = /var\(\s*(--[\w-]+)/g;
  for (const [re, where] of [
    [declareRe, 'declared'],
    [useRe, 'referenced'],
  ]) {
    for (const match of css.matchAll(re)) {
      const name = match[1];
      if (!seen.has(name)) seen.set(name, where);
    }
  }
  const offenders = [...seen.keys()].filter(
    (name) =>
      !name.startsWith(PUBLIC_PREFIX) &&
      !name.startsWith(INTERNAL_PREFIX) &&
      !ALLOWED_FOREIGN_PROPERTIES.includes(name),
  );
  must(
    offenders.length === 0,
    `ADR-0005 allows only ${PUBLIC_PREFIX}* and ${INTERNAL_PREFIX}*: ${offenders
      .map((name) => `${name} (${seen.get(name)})`)
      .join(', ')}`,
  );
  return `${seen.size} distinct custom properties, all prefixed`;
});

await check('every custom property name is pure ASCII [A-Za-z0-9_-]', () => {
  const names = new Set();
  for (const match of css.matchAll(/--[\w-]+/g)) names.add(match[0]);
  const offenders = [...names].filter((name) => !/^--[A-Za-z0-9_-]+$/.test(name));
  must(offenders.length === 0, `non-ASCII custom property name(s): ${offenders.join(', ')}`);
  const nonAsciiBytes = [...names].filter((name) => /[^\x20-\x7E]/.test(name));
  must(nonAsciiBytes.length === 0, `non-ASCII bytes in: ${nonAsciiBytes.join(', ')}`);
  return `${names.size} names, ASCII only`;
});

/* --------------------------- 3. shadow derivation chain --------------------------- */

await check('all three shadow tiers derive from the offset slot', () => {
  const noRoot = 'the theme layer declares a :root rule';
  if (failures.includes(noRoot)) throw new Error('skipped: no :root rule to read');
  for (const tier of SHADOW_TIERS) {
    const value = rootTokens.get(tier);
    must(value, `${tier} is not declared on :root`);
    must(
      OFFSET_SLOTS.some(([x, y]) => value.includes(`var(${x})`) && value.includes(`var(${y})`)),
      `${tier} does not read its offsets from ${OFFSET_SLOTS.map(([x, y]) => `${x}/${y}`).join(' or ')}: ${value}`,
    );
    // The two offset slots must each be a derived expression, not a frozen literal.
    // spec §6.1 allows the plain `var()` form and the `calc(var() * k)` form; anything
    // else (a bare number, a fixed length) stops rescaling when the offset changes.
    const slots = splitTopLevel(value);
    must(
      slots.length === 5,
      `${tier} must be "x y blur spread colour" (5 components), got ${slots.length}: ${value}`,
    );
    slots.slice(0, 2).forEach((slot, index) => {
      const axis = index === 0 ? 'x' : 'y';
      must(
        new RegExp(
          `^(?:calc\\(var\\(--bn-shadow(?:-reverse)?-${axis}\\)(?:\\s*[*\\/]\\s*[\\d.]+)?\\)|var\\(--bn-shadow(?:-reverse)?-${axis}\\))$`,
        ).test(slot),
        `${tier}: offset slot ${index + 1} must derive from --bn-shadow-${axis} (or its reverse), got ${slot}`,
      );
    });
    must(slots[2] === '0' && slots[3] === '0', `${tier} must keep zero blur and spread: ${value}`);
    must(
      slots[4] === 'var(--bn-shadow-color)',
      `${tier} must take its colour from --bn-shadow-color, got ${slots[4]}`,
    );
    must(!/#[0-9a-fA-F]{3,8}/.test(value), `${tier} hardcodes a colour: ${value}`);
  }
  const lift = rootTokens.get('--bn-shadow-lift');
  must(lift === 'calc(var(--bn-shadow-x) / 2)', `--bn-shadow-lift must be derived: ${lift}`);
  must(rootTokens.get('--bn-shadow') === 'var(--bn-shadow-md)', '--bn-shadow must alias --bn-shadow-md');
  return `${SHADOW_TIERS.join(', ')} + --bn-shadow-lift, all offset-derived`;
});

await check('overriding --bn-shadow-x rescales all three tiers by pure arithmetic', () => {
  if (failures.includes('the theme layer declares a :root rule')) {
    throw new Error('skipped: no :root rule to read');
  }
  /**
   * Evaluates a shadow value with every token resolved, so that "8px rescales the
   * tiers proportionally" is checked as arithmetic rather than by reading the source.
   * Only px/unitless numbers and var() indirection appear in these values by construction.
   */
  function resolve(name, overrides, depth = 0) {
    must(depth < 12, `token indirection too deep at ${name}`);
    if (name in overrides) return overrides[name];
    const value = rootTokens.get(name);
    must(value !== undefined, `${name} is not declared on :root`);
    return value.replace(/var\(\s*(--[\w-]+)\s*\)/g, (_, ref) => `(${resolve(ref, overrides, depth + 1)})`);
  }
  /** Strip every pair of parentheses that wraps the *whole* expression. */
  function stripWrapping(text) {
    let out = text.trim();
    while (out.startsWith('(') && parenDepth(out, 0) === out.length - 1) out = out.slice(1, -1).trim();
    return out;
  }
  /**
   * Reduce a fully token-resolved shadow component to plain arithmetic and evaluate
   * it. `stripWrapping` first peels the parens that var() substitution added, then
   * calc() / var() wrappers and px units are removed — what remains is `8 / 2`.
   */
  function evaluate(expr) {
    let text = stripWrapping(expr);
    let previous;
    do {
      previous = text;
      text = stripWrapping(text);
      text = text
        .replace(/calc\((.*)\)/s, '($1)')
        .replace(/var\(--[\w-]+\)/g, '')
        .replace(/px\b/g, '');
      text = stripWrapping(text);
    } while (text !== previous);
    must(text.length > 0, `empty shadow expression: ${expr}`);
    must(/^[\d\s.*+/()-]+$/.test(text), `unexpected characters in evaluated shadow: ${text}`);
    // eslint-disable-next-line no-new-func
    const value = Function(`"use strict"; return (${text});`)();
    must(Number.isFinite(value), `shadow expression did not evaluate: ${expr}`);
    return value;
  }
  /** Strip every pair of parentheses that wraps the *whole* expression. */
  function stripWrapping(text) {
    let out = text.trim();
    while (out.startsWith('(') && parenDepth(out, 0) === out.length - 1) out = out.slice(1, -1).trim();
    return out;
  }
  /** Index of the ")" that closes the "(" at index 0 in an already token-resolved value. */
  function parenDepth(text, start) {
    let depth = 0;
    for (let i = start; i < text.length; i += 1) {
      if (text[i] === '(') depth += 1;
      else if (text[i] === ')') {
        depth -= 1;
        if (depth === 0) return i;
      }
    }
    return -1;
  }
  /** "x y 0 0 colour" → [x, y]; the blur and spread are always zero here. */
  function offsets(name, overrides) {
    const resolved = resolve(name, overrides).trim();
    // var() substitution wraps each resolved token in parentheses; strip the pair
    // that wraps the whole shadow value so the five components can be split apart.
    const parts = splitTopLevel(stripWrapping(resolved));
    must(
      parts.length === 5,
      `${name} resolved to ${parts.length} parts (expected "x y 0 0 colour"): ${resolved}`,
    );
    must(
      parts[2] === '0' && parts[3] === '0',
      `${name} must keep zero blur and spread: ${resolved}`,
    );
    must(
      /^(?:var\(--bn-shadow-color\)|\(*#[0-9a-fA-F]{3,8}\)*)$/.test(parts[4]),
      `${name} colour slot drifted (must resolve to --bn-shadow-color): ${parts[4]}`,
    );
    return [evaluate(parts[0]), evaluate(parts[1])];
  }

  const base = offsets('--bn-shadow-md', {});
  must(base[0] === 4 && base[1] === 4, `baseline md offsets should be 4px/4px, got ${base.join('/')}`);

  const scaled = { '--bn-shadow-x': '8px', '--bn-shadow-y': '8px' };
  const md = offsets('--bn-shadow-md', scaled);
  const sm = offsets('--bn-shadow-sm', scaled);
  const lg = offsets('--bn-shadow-lg', scaled);
  must(md[0] === 8 && md[1] === 8, `md should be 8px/8px, got ${md.join('/')}`);
  must(sm[0] === 4 && sm[1] === 4, `sm should be 4px/4px, got ${sm.join('/')}`);
  must(lg[0] === 12 && lg[1] === 12, `lg should be 12px/12px, got ${lg.join('/')}`);

  const lift = evaluate(resolve('--bn-shadow-lift', scaled));
  must(lg[0] - md[0] === lift, `hover lift ${lift}px must equal lg - md = ${lg[0] - md[0]}px`);
  must(lift === 4, `lift should be 4px at baseline 8px, got ${lift}px`);
  return `x=8px → sm 4px, md 8px, lg 12px, lift 4px (lg - md = lift holds)`;
});

/* ------------------------------- 4. token inventory ------------------------------- */

await check('the light theme matches spec §6.1 token for token', () => {
  if (failures.includes('the theme layer declares a :root rule')) {
    throw new Error('skipped: no :root rule to read');
  }
  return diff(EXPECTED_ROOT_TOKENS, Object.fromEntries(rootTokens), 'light tokens');
});

await check('the dark block matches spec §6.2 and resets nothing else', () => {
  if (failures.includes('the theme layer declares a [data-theme="dark"] rule')) {
    throw new Error('skipped: no [data-theme="dark"] rule to read');
  }
  must(darkTokens.size > 0, 'the dark block is empty');
  const detail = diff(EXPECTED_DARK_TOKENS, Object.fromEntries(darkTokens), 'dark tokens');
  for (const name of Object.keys(EXPECTED_DARK_TOKENS)) {
    must(
      name.startsWith(PUBLIC_PREFIX),
      `the dark block may only reset public tokens, found ${name}`,
    );
  }
  return detail;
});

await check('dark mode keeps every accent colour unchanged', () => {
  const touched = ACCENT_TOKENS.filter((token) => darkTokens.has(token));
  must(
    touched.length === 0,
    `spec §6.2 keeps accents fixed, but the dark block resets: ${touched.join(', ')}`,
  );
  return `${ACCENT_TOKENS.length} accent tokens untouched`;
});

await check('the dark block re-tunes only neutrals, the border and the shadow colour', () => {
  if (failures.includes('the theme layer declares a :root rule')) {
    throw new Error('skipped: no :root rule to compare against');
  }
  const neutral = ['--bn-background', '--bn-secondary-background', '--bn-foreground', '--bn-border-color'];
  for (const name of neutral) {
    must(darkTokens.has(name), `the dark block must re-tune ${name}`);
  }
  must(darkTokens.has('--bn-shadow-color'), 'the dark block must re-tune --bn-shadow-color (hard shadows flip white)');
  const light = rootTokens.get('--bn-foreground');
  const dark = darkTokens.get('--bn-foreground');
  must(light !== dark, `--bn-foreground must differ between modes (${light} vs ${dark})`);
  must(
    rootTokens.get('--bn-border-width') !== undefined &&
      !darkTokens.has('--bn-border-width') &&
      !darkTokens.has('--bn-shadow-x') &&
      !darkTokens.has('--bn-shadow-y'),
    'the dark block must not re-tune structural geometry',
  );
  return `foreground ${light} → ${dark}; border-color → ${darkTokens.get('--bn-border-color')}; shadow-color → ${darkTokens.get('--bn-shadow-color')}`;
});

/* ---------------------------- 5. semantic variant mapping ---------------------------- */

await check('data-variant maps the three semantic values onto --_variant-color', () => {
  must(variants.size > 0, 'the theme layer declares no --_variant-color mapping');
  must(
    variants.size === 1 && variants.has(VARIANT_PROPERTY),
    `the mapping must only set ${VARIANT_PROPERTY}, found: ${[...variants.keys()].join(', ')}`,
  );
  const rules = topLevelRules(theme).filter((rule) => /data-variant/.test(rule.selector));
  const byValue = new Map();
  for (const rule of rules) {
    for (const value of ['success', 'warning', 'danger', 'error']) {
      if (new RegExp(`data-variant\\s*=\\s*["']?${value}["']?`).test(rule.selector)) {
        byValue.set(value, rule.body.trim());
      }
    }
  }
  const expected = {
    success: 'var(--bn-success)',
    warning: 'var(--bn-warning)',
    danger: 'var(--bn-danger)',
    error: 'var(--bn-danger)',
  };
  for (const [value, want] of Object.entries(expected)) {
    const body = byValue.get(value);
    must(body, `no rule maps data-variant="${value}"`);
    must(
      body.replace(/\s+/g, ' ') === `${VARIANT_PROPERTY}: ${want};`,
      `data-variant="${value}" should set "${VARIANT_PROPERTY}: ${want};", got "${body}"`,
    );
  }
  must(
    !/data-(size|appearance|color|accent|kind|shape|variant\s*=\s*["']?(pink|blue|green|orange|lavender))/.test(theme),
    'appearance hooks (size/outline/ghost/accent colours) must be bn- classes, not data-* attributes',
  );
  return `success/warning/danger + error alias → ${VARIANT_PROPERTY}`;
});

/* ------------------------------ 6. source-file hygiene ------------------------------ */

await check('the theme layer defines no colours outside 01-theme.css', () => {
  const layerText = rawCss.slice(
    rawCss.indexOf('/* src/css/01-theme.css'),
    rawCss.indexOf('/* src/css/animations.css'),
  );
  must(layerText.length > 0, 'could not locate the 01-theme.css block in the artifact');
  const literals = [...layerText.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]);
  const expectedCount = Object.values(EXPECTED_ROOT_TOKENS).filter((value) => /^#/.test(value)).length +
    Object.values(EXPECTED_DARK_TOKENS).filter((value) => /^#/.test(value)).length;
  must(
    literals.length === expectedCount,
    `expected ${expectedCount} colour literals in the theme block (all in :root / dark), found ${literals.length}`,
  );
  must(!/!important/.test(rawCss), 'the artifact must not contain !important');
  return `${literals.length} colour literals, 0 !important in the artifact`;
});

await check('01-theme.css does not declare its own @layer (build chain owns layers)', () => {
  const source = readFileSync(abs('src/css/01-theme.css'), 'utf8');
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const offenders = lines
    .map((line, index) => [line, index + 1])
    .filter(([line]) => /^\s*@layer\b/.test(line));
  must(
    offenders.length === 0,
    `remove @layer from src/css/01-theme.css:${offenders.map(([, n]) => n).join(',')} — CSS_MANIFEST assigns it`,
  );
  const bom = source.codePointAt(0) === 0xfeff;
  must(!bom, 'src/css/01-theme.css must be UTF-8 without a BOM');
  return `${lines.length} lines, no @layer, no BOM`;
});

/* ------------------------------------ summary ------------------------------------ */

console.log(`\n${checks - failures.length}/${checks} checks passed`);
if (failures.length > 0) {
  console.log('\nfailed:');
  for (const name of failures) console.log(`  - ${name}`);
  process.exit(1);
}
