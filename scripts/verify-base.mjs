#!/usr/bin/env node
/**
 * Scripted verification for ticket 06 — base layer and layer order contract.
 *
 * Ticket 06 owns `src/css/00-base.css` (the base layer block of the published artifact) and the
 * Typography page of the documentation site. The verification methods in
 * `.scratch/barnacle-design/issues/06-base-layer-and-layer-order.md` are the specification of
 * this file; each one that can be checked without a browser is a check below:
 *
 *   2. the unminified artifact's first line is still the `@layer` declaration and its layer
 *      order matches the list ticket 01 recorded (ADR-0006)
 *   3. unlayered user CSS beats every layer, which needs two things: no `!important` anywhere,
 *      and no unlayered rule of ours — a colour token override needs no `!important` to win
 *   1. (partly) bare semantic HTML has a complete, non-JS appearance: every element ticket 06
 *      lists has a rule, and code/pre/mark/hr/blockquote stay visible in both themes because
 *      the tokens they read differ from the page tokens
 *
 * The expected values are the independent source of truth, transcribed from
 * `D:\code\barnacle-notes\orchestrator-decisions.md` §4 (the frozen geometry block, verbatim),
 * `component-style-recipes.md` §2.3/§9.2, spec.md §3/§5/§7/§8 and ADR-0005/0006. They are never
 * recomputed from the implementation.
 *
 * Deliberately NOT checked here (ticket 08's browser harness owns them):
 *   - that the page renders completely with JavaScript disabled
 *   - that a live `:root { --bn-... }` override on a real page wins without `!important`
 *   - computed geometry (transform / box-shadow) after hover, active and Tab
 *
 * Run with: npm run verify:base   (or: node scripts/verify-base.mjs)
 * Options:  --no-site   skip the seite build / index checks (offline runs)
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const abs = (...parts) => path.join(ROOT, ...parts);

/* ---------------------------------- expectations ---------------------------------- */

/** ADR-0006: the layer order is a public contract. Append new layers at the end only. */
const EXPECTED_LAYER_ORDER = ['theme', 'base', 'components', 'animations', 'utilities'];
const EXPECTED_DECLARATION = `@layer ${EXPECTED_LAYER_ORDER.join(', ')};`;

const BASE_FILE = '00-base.css';
const ARTIFACT = 'static/barnacle.css';
const ARTIFACT_MIN = 'static/barnacle.min.css';

/**
 * orchestrator-decisions.md §4 — the ten interaction-geometry slots, verbatim. Values are
 * frozen: components (07+) read them, never redeclare a number of their own.
 */
const EXPECTED_GEOMETRY = {
  '--_lift-x': 'calc(var(--bn-shadow-lift) * -1)',
  '--_lift-y': 'calc(var(--bn-shadow-lift) * -1)',
  '--_press-x': 'var(--bn-press)',
  '--_press-y': 'var(--bn-press)',
  '--_shadow-rest': 'var(--bn-shadow-md)',
  '--_shadow-hover': 'var(--bn-shadow-lg)',
  '--_shadow-press': 'none',
  '--_focus-ring': '3px solid var(--bn-ring)',
  '--_focus-ring-offset': '3px',
  '--_motion': 'var(--bn-transition)',
};

/**
 * component-style-recipes.md §2.3 (and appendix A) — the border/surface default slots of the
 * same single source. Their names and semantics are frozen too; a component overrides them on
 * its own selector when it needs a different tier.
 */
const EXPECTED_DEFAULT_SLOTS = {
  '--_border-rest': 'var(--bn-border-color)',
  '--_border-hover': 'var(--bn-border-color)',
  '--_border-press': 'var(--bn-border-color)',
  '--_surface': 'var(--bn-secondary-background)',
  '--_surface-hover': 'var(--bn-secondary-background)',
  '--_surface-press': 'var(--bn-secondary-background)',
};

/** spec.md §8 + the ticket checkbox: every bare element the base layer must dress. */
const REQUIRED_BARE_ELEMENTS = [
  'body',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'ul',
  'ol',
  'li',
  'blockquote',
  'code',
  'pre',
  'hr',
  'mark',
  'a',
];

/** The heading scale, read as numbers off the artifact: a descending display scale. */
const HEADINGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];

/**
 * Properties whose value is interaction geometry. In the base layer their right-hand side may
 * not contain a digit at all: every number lives in a `--_` slot on `:root` (ADR-0005, spec §3
 * invariant 3). `var(--_lift-x)` has no digit; `translate(-2px, -2px)` has.
 */
const GEOMETRY_PROPERTIES = new Set([
  'transform',
  'translate',
  'rotate',
  'scale',
  'box-shadow',
  'outline',
  'outline-offset',
  'transition',
]);

/** Hardcoded colour forms ADR-0005 keeps in 01-theme.css only. */
const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(|\bcolor\(/;

const TYPOGRAPHY_PAGE = 'content/components/typography.md';

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

/* ---------------------------------- CSS structure ---------------------------------- */

/**
 * Replace comment bodies with spaces of identical length: braces inside a comment can no longer
 * confuse brace matching, and offsets still line up with the raw text, so the file marker
 * comments the build chain writes stay findable by index.
 */
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
 * All `selector { body }` rules of a block body, flattened out of any at-rule wrapper (a rule
 * inside `@media (hover: hover) { … }` is returned with its own selector). The checks below are
 * about rules, not about the condition they sit under.
 */
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
    const body = text.slice(open + 1, close);
    if (selector.startsWith('@')) rules.push(...topLevelRules(body));
    else rules.push({ selector, body });
    i = close + 1;
  }
  return rules;
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

/**
 * The body of one source file's `@layer <name> { … }` block, located by the marker comment the
 * build chain writes (`/* src/css/00-base.css (@layer base) *​/`). `raw` and `blanked` must be
 * the same length.
 */
function fileBlock(raw, blanked, file) {
  const marker = `/* src/css/${file}`;
  const start = raw.indexOf(marker);
  must(start !== -1, `the artifact has no ${file} block (marker comment not found)`);
  const next = raw.indexOf('/* src/css/', start + marker.length);
  const rawSlice = raw.slice(start, next === -1 ? raw.length : next);
  const openInSlice = rawSlice.indexOf('{');
  must(openInSlice !== -1, `${file} block has no opening brace`);
  const open = start + openInSlice;
  const close = matchBrace(blanked, open, file);
  return blanked.slice(open + 1, close);
}

/** The `@layer <name> { … }` block of one source file, unwrapped. */
function sourceBlock(css, file) {
  const body = fileBlock(css.raw, css.blanked, file);
  return body;
}

/** The declarations of a layer's `:root` rules, merged in document order. */
function rootDeclarations(layer) {
  const pairs = new Map();
  for (const rule of topLevelRules(layer)) {
    if (rule.selector !== ':root') continue;
    for (const [name, value] of declarations(rule.body)) pairs.set(name, value);
  }
  return pairs;
}

/** The declarations of a layer's `[data-theme="dark"]` rule. */
function darkDeclarations(layer) {
  const pairs = new Map();
  for (const rule of topLevelRules(layer)) {
    if (!/\[data-theme\s*=\s*["']?dark["']?\]/.test(rule.selector)) continue;
    for (const [name, value] of declarations(rule.body)) pairs.set(name, value);
  }
  return pairs;
}

/** Every rule of a block whose selector names `element` as a whole word. */
function rulesFor(rules, element) {
  const re = new RegExp(`(?<![\\w-])${element}(?![\\w-])`);
  return rules.filter((rule) => re.test(rule.selector));
}

/** Split a value on whitespace outside parentheses and quotes. */
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

/* ------------------------------ token resolution ------------------------------ */

/** Recursively substitute `var(--x)` until only arithmetic, keywords and colours remain. */
function expand(value, lookup, depth = 0) {
  must(depth < 16, `custom property indirection too deep at ${value}`);
  return value.replace(/var\(\s*(--[A-Za-z0-9_-]+)\s*\)/g, (_, name) => {
    const resolved = lookup(name);
    must(resolved !== undefined, `${name} is referenced but never declared`);
    return `(${expand(resolved, lookup, depth + 1)})`;
  });
}

/** Evaluate a fully expanded `calc()` expression of lengths; `px` is dropped. */
function evaluate(expression) {
  const text = expression.replace(/calc\(/g, '(').replace(/(\d)px\b/g, '$1');
  let i = 0;
  const skip = () => {
    while (i < text.length && /\s/.test(text[i])) i += 1;
  };
  function primary() {
    skip();
    if (text[i] === '(') {
      i += 1;
      const value = sum();
      skip();
      must(text[i] === ')', `missing ")" in ${expression}`);
      i += 1;
      return value;
    }
    const start = i;
    if (text[i] === '-' || text[i] === '+') i += 1;
    while (i < text.length && /[0-9.]/.test(text[i])) i += 1;
    must(i > start, `expected a number at offset ${i} in ${expression}`);
    return Number(text.slice(start, i));
  }
  function product() {
    let value = primary();
    for (;;) {
      skip();
      const op = text[i];
      if (op !== '*' && op !== '/') return value;
      i += 1;
      const rhs = primary();
      value = op === '*' ? value * rhs : value / rhs;
    }
  }
  function sum() {
    let value = product();
    for (;;) {
      skip();
      const op = text[i];
      if (op !== '+' && op !== '-') return value;
      i += 1;
      const rhs = product();
      value = op === '+' ? value + rhs : value - rhs;
    }
  }
  const value = sum();
  skip();
  must(i === text.length, `unexpected "${text.slice(i)}" in ${expression}`);
  return value;
}

/** Strip the parentheses that var() substitution introduced. */
function flatten(value) {
  return value.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Remove only the parentheses that wrap a whole expression — the pair var() substitution adds
 * around each replacement — leaving meaningful grouping (a `calc()` factor) intact.
 */
function unwrap(text) {
  let out = text.trim();
  for (;;) {
    if (!out.startsWith('(')) return out;
    let depth = 0;
    let close = -1;
    for (let i = 0; i < out.length; i += 1) {
      if (out[i] === '(') depth += 1;
      else if (out[i] === ')') {
        depth -= 1;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    if (close !== out.length - 1) return out;
    out = out.slice(1, -1).trim();
  }
}

/* ------------------------------------ checks ------------------------------------ */

console.log(`barnacle base-layer verification — ${ROOT}\n`);

const rawArtifact = readFileSync(abs(ARTIFACT), 'utf8');
const rawMin = readFileSync(abs(ARTIFACT_MIN), 'utf8');
const css = { raw: rawArtifact, blanked: blankComments(rawArtifact) };
const base = sourceBlock(css, BASE_FILE);

/* ------------------------- 1. layer order (verification method 2) ------------------------- */

await check('line 1 of the unminified artifact is the five-layer declaration in ADR-0006 order', () => {
  const line = css.raw.split('\n', 1)[0].replace(/\r$/, '');
  must(line === EXPECTED_DECLARATION, `line 1 is ${JSON.stringify(line)}`);
  const declared = line
    .replace(/^@layer\s+/, '')
    .replace(/;\s*$/, '')
    .split(',')
    .map((part) => part.trim());
  must(
    JSON.stringify(declared) === JSON.stringify(EXPECTED_LAYER_ORDER),
    `the declaration lists ${declared.join(', ')}`,
  );
  return line;
});

await check('line 1 of the minified artifact is the same declaration byte for byte', () => {
  const line = rawMin.split('\n', 1)[0].replace(/\r$/, '');
  must(line === EXPECTED_DECLARATION, `line 1 is ${JSON.stringify(line)}`);
  return line;
});

await check('the artifact emits every source file into its declared layer, in manifest order', async () => {
  const { CSS_MANIFEST, LAYER_ORDER } = await import(
    pathToFileURL(abs('scripts/build.mjs')).href
  );
  must(
    JSON.stringify(LAYER_ORDER) === JSON.stringify(EXPECTED_LAYER_ORDER),
    `build.mjs LAYER_ORDER is ${LAYER_ORDER.join(', ')}`,
  );
  const markers = [...css.raw.matchAll(/\/\* src\/css\/([^ ]+) \(@layer ([a-z]+)\) \*\//g)].map(
    (match) => ({ file: match[1], layer: match[2] }),
  );
  must(
    markers.length === CSS_MANIFEST.length,
    `expected ${CSS_MANIFEST.length} layer blocks, found ${markers.length}`,
  );
  const drift = markers
    .map((marker, index) => ({ marker, entry: CSS_MANIFEST[index] }))
    .filter(({ marker, entry }) => marker.file !== entry.file || marker.layer !== entry.layer);
  must(
    drift.length === 0,
    `block order drifted from CSS_MANIFEST: ${drift
      .map(({ marker, entry }) => `${marker.file}(${marker.layer}) vs ${entry.file}(${entry.layer})`)
      .join(', ')}`,
  );
  const used = new Set(markers.map((marker) => marker.layer));
  const unused = EXPECTED_LAYER_ORDER.filter((layer) => !used.has(layer));
  must(unused.length === 0, `declared but unused layers: ${unused.join(', ')}`);
  return `${markers.length} blocks, ${used.size} layers, order matches CSS_MANIFEST`;
});

await check('the library contributes no unlayered rule, so user CSS always wins', () => {
  const text = css.blanked;
  const re = /@layer\s+[A-Za-z][\w-]*\s*\{/g;
  let residue = '';
  let cursor = 0;
  let match;
  while ((match = re.exec(text)) !== null) {
    const open = match.index + match[0].length - 1;
    const close = matchBrace(text, open, '@layer');
    residue += text.slice(cursor, match.index);
    cursor = close + 1;
    re.lastIndex = cursor;
  }
  residue += text.slice(cursor);
  const stripped = residue.replace(EXPECTED_DECLARATION, '').trim();
  must(
    !stripped.includes('{'),
    `the artifact has unlayered rules: ${stripped.slice(0, 120)}`,
  );
  return 'every rule of ours sits inside a layer; only the declaration is unlayered';
});

await check('neither artifact contains !important (verification method 3)', () => {
  // Comments are blanked first: prose *about* `!important` is not a declaration of one.
  for (const [label, text] of [
    ['static/barnacle.css', rawArtifact],
    ['static/barnacle.min.css', rawMin],
    ['src/css/00-base.css', readFileSync(abs('src/css', BASE_FILE), 'utf8')],
  ]) {
    must(!/!\s*important/.test(blankComments(text)), `${label} contains !important`);
  }
  return 'no !important in either artifact or in the base source';
});

/* ------------------------------ 2. source hygiene ------------------------------ */

await check('src/css/00-base.css line 1 is the declaration and carries no other @layer', () => {
  const source = readFileSync(abs('src/css', BASE_FILE), 'utf8');
  must(source.codePointAt(0) !== 0xfeff, 'src/css/00-base.css must be UTF-8 without a BOM');
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  must(lines[0] === EXPECTED_DECLARATION, `line 1 is ${JSON.stringify(lines[0])}`);
  const extra = lines
    .map((line, index) => [line, index + 1])
    .filter(([line, number]) => number > 1 && /^\s*@layer\b/.test(line));
  must(
    extra.length === 0,
    `remove @layer from line(s) ${extra.map(([, n]) => n).join(', ')} — CSS_MANIFEST assigns the layer`,
  );
  return `${lines.length} lines, declaration on line 1 only`;
});

await check('the base layer uses only --bn-* and --_* custom properties', () => {
  const names = new Set([...base.matchAll(/--[\w-]+/g)].map((match) => match[0]));
  const offenders = [...names].filter(
    (name) => !name.startsWith('--bn-') && !name.startsWith('--_'),
  );
  must(
    offenders.length === 0,
    `ADR-0005 allows only --bn-* and --_*: ${offenders.join(', ')}`,
  );
  return `${names.size} distinct properties, all prefixed`;
});

await check('the base layer holds no colour literal (colours come from 01-theme.css)', () => {
  const offenders = [...base.matchAll(new RegExp(COLOUR_LITERAL.source, 'g'))].map(
    (match) => match[0],
  );
  must(
    offenders.length === 0,
    `hardcoded colour(s) in the base layer: ${[...new Set(offenders)].join(', ')}`,
  );
  return '0 hex / rgb() / hsl() / oklch() / color() literals';
});

/* ------------------- 3. interaction geometry (the deliverable 07 reads) ------------------- */

const baseRoot = rootDeclarations(base);
/** Every `--_` slot the base layer declares, wherever it declares it. */
const internalSlots = new Map();
for (const rule of topLevelRules(base)) {
  for (const [name, value] of declarations(rule.body)) {
    if (name.startsWith('--_')) internalSlots.set(name, value);
  }
}

await check('the base layer declares the ten frozen geometry slots on :root', () => {
  const missing = Object.keys(EXPECTED_GEOMETRY).filter((name) => !baseRoot.has(name));
  must(missing.length === 0, `missing geometry slot(s): ${missing.join(', ')}`);
  return Object.keys(EXPECTED_GEOMETRY).join(', ');
});

await check('the geometry values are the ones orchestrator-decisions §4 froze, verbatim', () => {
  const wrong = Object.entries(EXPECTED_GEOMETRY).filter(
    ([name, want]) => baseRoot.get(name) !== want,
  );
  must(
    wrong.length === 0,
    wrong
      .map(([name, want]) => `${name} = ${JSON.stringify(baseRoot.get(name))} (frozen: ${JSON.stringify(want)})`)
      .join('; '),
  );
  return `${Object.keys(EXPECTED_GEOMETRY).length} values match the decision file`;
});

await check('the base layer declares the border and surface default slots verbatim', () => {
  const wrong = Object.entries(EXPECTED_DEFAULT_SLOTS).filter(
    ([name, want]) => baseRoot.get(name) !== want,
  );
  const missing = Object.keys(EXPECTED_DEFAULT_SLOTS).filter((name) => !baseRoot.has(name));
  must(missing.length === 0, `missing default slot(s): ${missing.join(', ')}`);
  must(
    wrong.length === 0,
    wrong
      .map(([name, want]) => `${name} = ${JSON.stringify(baseRoot.get(name))} (expected ${JSON.stringify(want)})`)
      .join('; '),
  );
  return Object.keys(EXPECTED_DEFAULT_SLOTS).join(', ');
});

await check('the geometry block is the only --_ declaration site in the base layer', () => {
  const declared = new Set();
  for (const rule of topLevelRules(base)) {
    for (const [name] of declarations(rule.body)) {
      if (name.startsWith('--_')) declared.add(name);
    }
  }
  const allowed = new Set([
    ...Object.keys(EXPECTED_GEOMETRY),
    ...Object.keys(EXPECTED_DEFAULT_SLOTS),
  ]);
  const extra = [...declared].filter((name) => !allowed.has(name));
  must(
    extra.length === 0,
    `unregistered internal variable(s) in the base layer: ${extra.join(', ')} — the geometry source is frozen (orchestrator-decisions §4 + recipes §2.3)`,
  );
  return `${declared.size} slots, all from the frozen list`;
});

await check('no geometry property in the base layer carries a numeric literal', () => {
  const offenders = [];
  for (const rule of topLevelRules(base)) {
    for (const [property, value] of declarations(rule.body)) {
      if (!GEOMETRY_PROPERTIES.has(property)) continue;
      if (/\d/.test(value)) offenders.push(`${rule.selector} { ${property}: ${value} }`);
    }
  }
  must(
    offenders.length === 0,
    `geometry values must be var(--_…) references, found: ${offenders.join('; ')}`,
  );
  return `${GEOMETRY_PROPERTIES.size} geometry properties, all digit-free`;
});

/* --- derivation chain, evaluated arithmetically against the theme tokens --- */

const themeBlock = sourceBlock(css, '01-theme.css');
const lightTokens = rootDeclarations(themeBlock);
const darkTokens = darkDeclarations(themeBlock);
const lookupWith = (overrides = {}) => (name) => {
  if (name in overrides) return overrides[name];
  if (internalSlots.has(name)) return internalSlots.get(name);
  if (baseRoot.has(name)) return baseRoot.get(name);
  return lightTokens.get(name);
};

await check('--_lift-* derives from --bn-shadow-lift and --_press-* from --bn-press', () => {
  const baseline = {
    liftX: evaluate(expand('var(--_lift-x)', lookupWith())),
    liftY: evaluate(expand('var(--_lift-y)', lookupWith())),
    pressX: evaluate(expand('var(--_press-x)', lookupWith())),
    pressY: evaluate(expand('var(--_press-y)', lookupWith())),
  };
  must(baseline.liftX === -2 && baseline.liftY === -2, `lift should be -2px, got ${baseline.liftX}`);
  must(baseline.pressX === 3 && baseline.pressY === 3, `press should be 3px, got ${baseline.pressX}`);

  const scaled = { '--bn-shadow-x': '8px', '--bn-shadow-y': '8px' };
  const lift = evaluate(expand('var(--_lift-x)', lookupWith(scaled)));
  const press = evaluate(expand('var(--_press-x)', lookupWith(scaled)));
  must(
    lift === -4,
    `--bn-shadow-x: 8px must rescale --_lift-x to -4px through the chain, got ${lift}`,
  );
  must(
    press === 3,
    `--bn-press is an independent token and must stay 3px, got ${press}`,
  );
  return `lift ${baseline.liftX}px → ${lift}px when --bn-shadow-x: 8px; press stays ${press}px`;
});

await check('--_shadow-rest/hover resolve to the md/lg tiers and --_shadow-press to none', () => {
  const scaled = { '--bn-shadow-x': '8px', '--bn-shadow-y': '8px' };
  /** A resolved shadow split into "x y blur spread colour", with x/y evaluated as lengths. */
  function shadowTier(name, overrides) {
    const parts = splitTopLevel(unwrap(expand(`var(${name})`, lookupWith(overrides))));
    must(
      parts.length === 5,
      `${name} must resolve to "x y blur spread colour", got ${parts.join(' | ')}`,
    );
    must(
      parts[2] === '0' && parts[3] === '0',
      `${name} must keep a zero blur and spread, got ${parts.join(' ')}`,
    );
    must(
      /#[0-9a-fA-F]{3,8}/.test(unwrap(parts[4])),
      `${name} must take its colour from --bn-shadow-color, got ${parts[4]}`,
    );
    return [evaluate(parts[0]), evaluate(parts[1])];
  }
  const rest = shadowTier('--_shadow-rest', scaled);
  const hover = shadowTier('--_shadow-hover', scaled);
  must(
    rest[0] === 8 && rest[1] === 8,
    `--_shadow-rest should be the md tier (8px/8px at --bn-shadow-x: 8px), got ${rest.join('/')}`,
  );
  must(
    hover[0] === 12 && hover[1] === 12,
    `--_shadow-hover should be the lg tier (12px/12px at --bn-shadow-x: 8px), got ${hover.join('/')}`,
  );
  const press = flatten(expand('var(--_shadow-press)', lookupWith())).trim();
  must(press === 'none', `--_shadow-press must be none, got ${press}`);
  return `rest ${rest.join('/')}px, hover ${hover.join('/')}px at 8px offset, press none`;
});

await check('--_focus-ring and --_motion resolve through the public tokens', () => {
  const ring = flatten(expand('var(--_focus-ring)', lookupWith())).trim();
  const ringColour = lightTokens.get('--bn-ring');
  must(
    ring === `3px solid ${ringColour}`,
    `--_focus-ring should resolve to "3px solid ${ringColour}", got ${ring}`,
  );
  const offset = evaluate(expand('var(--_focus-ring-offset)', lookupWith()));
  must(offset === 3, `--_focus-ring-offset should be 3px, got ${offset}`);
  const motion = flatten(expand('var(--_motion)', lookupWith())).trim();
  must(
    motion === lightTokens.get('--bn-transition'),
    `--_motion should resolve to --bn-transition (${lightTokens.get('--bn-transition')}), got ${motion}`,
  );
  const retimed = flatten(expand('var(--_motion)', lookupWith({ '--bn-transition': '400ms linear' }))).trim();
  must(retimed === '400ms linear', `retiming --bn-transition must retime --_motion, got ${retimed}`);
  return `ring ${ring}; offset ${offset}px; motion follows --bn-transition (retimed: ${retimed})`;
});

/* -------------------------------- 4. focus contract -------------------------------- */

await check('the base layer draws the focus ring from --_focus-ring / --_focus-ring-offset', () => {
  const rules = topLevelRules(base).filter((rule) => /:focus-visible/.test(rule.selector));
  must(rules.length > 0, 'the base layer has no :focus-visible rule');
  const outline = rules
    .flatMap((rule) => declarations(rule.body))
    .find(([property]) => property === 'outline');
  const offset = rules
    .flatMap((rule) => declarations(rule.body))
    .find(([property]) => property === 'outline-offset');
  must(outline, 'no outline declared for :focus-visible');
  must(offset, 'no outline-offset declared for :focus-visible');
  must(
    outline[1] === 'var(--_focus-ring)',
    `outline must read --_focus-ring, got ${outline[1]}`,
  );
  must(
    offset[1] === 'var(--_focus-ring-offset)',
    `outline-offset must read --_focus-ring-offset, got ${offset[1]}`,
  );
  return `${outline.join(': ')}; ${offset.join(': ')}`;
});

await check('bare a is covered by that focus ring (no a-specific opt-out)', () => {
  const universal = topLevelRules(base).some(
    (rule) =>
      /:focus-visible/.test(rule.selector) &&
      rule.selector
        .split(',')
        .map((part) => part.trim())
        .includes(':focus-visible'),
  );
  const aSpecific = topLevelRules(base).some(
    (rule) => /(?:^|[\s,>+~])a(?:[\s.:,[>+~]|$)/.test(rule.selector) && /:focus-visible/.test(rule.selector),
  );
  must(
    universal || aSpecific,
    'a bare `a` focus ring is required: either a universal :focus-visible rule or `a:focus-visible`',
  );
  return universal ? ':focus-visible applies to every element, `a` included' : 'a:focus-visible';
});

await check('no rule anywhere disables an outline without a replacement', () => {
  const offenders = [];
  for (const rule of topLevelRules(base)) {
    for (const [property, value] of declarations(rule.body)) {
      if (property === 'outline' && /^none\b/.test(value)) offenders.push(rule.selector);
    }
  }
  must(offenders.length === 0, `outline: none on ${offenders.join(', ')} (WCAG F78)`);
  must(!/outline\s*:\s*none/.test(rawArtifact), 'the artifact contains `outline: none`');
  return 'no outline: none in the base layer or the artifact';
});

/* ---------------------- 5. bare-element appearance (verification method 1) ---------------------- */

await check('body takes its background, foreground, family, weight and line-height from tokens', () => {
  const rule = topLevelRules(base).find((candidate) => candidate.selector === 'body');
  must(rule, 'the base layer has no `body` rule');
  const pairs = new Map(declarations(rule.body));
  const expected = {
    background: 'var(--bn-background)',
    color: 'var(--bn-foreground)',
    'font-family': 'var(--bn-font-family)',
    'font-weight': 'var(--bn-font-weight-base)',
  };
  for (const [property, want] of Object.entries(expected)) {
    must(
      pairs.get(property) === want,
      `body { ${property} } should be ${want}, got ${JSON.stringify(pairs.get(property))}`,
    );
  }
  const lineHeight = pairs.get('line-height');
  must(
    lineHeight && /^[\d.]+$/.test(lineHeight) && Number(lineHeight) >= 1.4,
    `body needs a readable unitless line-height, got ${lineHeight}`,
  );
  return `background/color/family/weight from tokens, line-height ${lineHeight}`;
});

await check('h1–h6 each declare a size, the scale descends, and all read the display tokens', () => {
  const rules = topLevelRules(base);
  const sizes = new Map();
  for (const heading of HEADINGS) {
    const matching = rulesFor(rules, heading);
    must(matching.length > 0, `no rule targets ${heading}`);
    const shared = matching.flatMap((rule) => declarations(rule.body));
    const size = shared.find(([property]) => property === 'font-size');
    must(size, `${heading} declares no font-size`);
    const rem = size[1].match(/^([\d.]+)rem$/);
    must(rem, `${heading} font-size should be a rem length, got ${size[1]}`);
    sizes.set(heading, Number(rem[1]));
  }
  const display = rules
    .filter((rule) => /h1/.test(rule.selector))
    .flatMap((rule) => declarations(rule.body));
  must(
    display.some(([property, value]) => property === 'font-family' && value === 'var(--bn-font-display)'),
    'headings must read --bn-font-display',
  );
  must(
    display.some(
      ([property, value]) => property === 'font-weight' && value === 'var(--bn-font-weight-heading)',
    ),
    'headings must read --bn-font-weight-heading',
  );
  const order = HEADINGS.map((heading) => sizes.get(heading));
  for (let i = 1; i < order.length; i += 1) {
    must(
      order[i] < order[i - 1],
      `the heading scale must descend: ${HEADINGS[i - 1]} ${order[i - 1]}rem vs ${HEADINGS[i]} ${order[i]}rem`,
    );
  }
  return HEADINGS.map((heading) => `${heading}=${sizes.get(heading)}rem`).join(' ') + ' (descending)';
});

await check('every bare element ticket 06 lists has a rule with declarations', () => {
  const rules = topLevelRules(base);
  const missing = REQUIRED_BARE_ELEMENTS.filter((element) => {
    const matching = rulesFor(rules, element);
    return !matching.some((rule) => declarations(rule.body).length > 0);
  });
  must(
    missing.length === 0,
    `no base-layer rule for: ${missing.join(', ')}`,
  );
  return `${REQUIRED_BARE_ELEMENTS.length} elements dressed`;
});

await check('lists keep square markers, nested lists tighten, and li items are spaced', () => {
  const rules = topLevelRules(base);
  const ulRules = rulesFor(rules, 'ul');
  const square = ulRules.some((rule) =>
    declarations(rule.body).some(
      ([property, value]) => property === 'list-style-type' && value === 'square',
    ),
  );
  must(square, 'ul must use square markers (neubrutalism keeps square corners)');
  const round = rules.filter((rule) =>
    declarations(rule.body).some(
      ([property, value]) => property === 'list-style-type' && /circle|disc/.test(value),
    ),
  );
  must(round.length === 0, `round bullets are forbidden: ${round.map((r) => r.selector).join(', ')}`);
  const markerSpace = ulRules.some((rule) =>
    declarations(rule.body).some(
      ([property, value]) => property === 'padding-inline-start' && /[\d.]+em/.test(value),
    ),
  );
  must(markerSpace, 'lists need inline padding so outside markers stay inside the content box');
  const nested = rules.filter(
    (rule) => /(?:ul|ol)[^,{]*\s(?:ul|ol)/.test(rule.selector) || /:is\(ul, ol\)\s*:is\(ul, ol\)/.test(rule.selector),
  );
  must(nested.length > 0, 'nested lists need their own rule (tighter rhythm)');
  const liSpacing = rulesFor(rules, 'li').some((rule) =>
    declarations(rule.body).some(([property]) => property.startsWith('margin')),
  );
  must(liSpacing, 'li items need vertical spacing');
  return `square markers, ${nested.length} nested-list rule(s), li margin present`;
});

await check('code and pre are visually distinct from the page in both themes', () => {
  const lightSurface = lightTokens.get('--bn-secondary-background');
  const darkSurface = darkTokens.get('--bn-secondary-background');
  must(
    lightSurface !== lightTokens.get('--bn-background'),
    'light theme: code/pre surface must differ from the page background',
  );
  must(
    darkSurface !== darkTokens.get('--bn-background'),
    'dark theme: code/pre surface must differ from the page background',
  );
  const rules = topLevelRules(base);
  for (const element of ['code', 'pre']) {
    const matching = rulesFor(rules, element);
    const pairs = matching.flatMap((rule) => declarations(rule.body));
    must(
      pairs.some(([property, value]) => property === 'font-family' && value === 'var(--bn-font-mono)'),
      `${element} must use --bn-font-mono`,
    );
    must(
      pairs.some(
        ([property, value]) =>
          property === 'background' && value === 'var(--bn-secondary-background)',
      ),
      `${element} must sit on --bn-secondary-background`,
    );
  }
  const pre = rulesFor(rules, 'pre').flatMap((rule) => declarations(rule.body));
  must(
    pre.some(([property, value]) => property.startsWith('overflow') && value === 'auto'),
    'pre must scroll horizontally so a long line cannot burst the grid',
  );
  const nested = rules.find((rule) => /^pre\s+code$/.test(rule.selector));
  must(nested, 'pre code must reset the inline code chrome');
  return `surface ${lightSurface} vs page ${lightTokens.get('--bn-background')} (light), ${darkSurface} vs ${darkTokens.get('--bn-background')} (dark)`;
});

await check('hr, blockquote and mark stay visible through the tokens they read', () => {
  const rules = topLevelRules(base);
  const lineToken = lightTokens.get('--bn-border-color');
  const darkLine = darkTokens.get('--bn-border-color');
  must(
    lineToken !== lightTokens.get('--bn-background') && darkLine !== darkTokens.get('--bn-background'),
    'hr needs a border colour that differs from the page background in both themes',
  );
  const hr = rulesFor(rules, 'hr').flatMap((rule) => declarations(rule.body));
  must(
    hr.some(
      ([property, value]) =>
        property === 'border-block-start' &&
        value.includes('var(--bn-border-width)') &&
        value.includes('var(--bn-border-color)'),
    ),
    'hr must derive its rule from --bn-border-width and --bn-border-color',
  );
  const quote = rulesFor(rules, 'blockquote').flatMap((rule) => declarations(rule.body));
  must(
    quote.some(
      ([property, value]) =>
        property === 'border-inline-start' &&
        value.includes('var(--bn-border-width)') &&
        value.includes('var(--bn-main)'),
    ),
    'blockquote must use a logical border derived from --bn-border-width and --bn-main',
  );
  must(
    quote.some(
      ([property, value]) => property === 'background' && value === 'var(--bn-secondary-background)',
    ),
    'blockquote must sit on --bn-secondary-background',
  );
  const mark = rulesFor(rules, 'mark').flatMap((rule) => declarations(rule.body));
  must(
    mark.some(([property, value]) => property === 'background' && value === 'var(--bn-main)'),
    'mark must highlight with --bn-main',
  );
  must(
    mark.some(
      ([property, value]) => property === 'color' && value === 'var(--bn-main-foreground)',
    ),
    'mark must use --bn-main-foreground for legibility',
  );
  for (const [mode, tokens] of [
    ['light', lightTokens],
    ['dark', darkTokens],
  ]) {
    must(
      tokens.get('--bn-main') !== tokens.get('--bn-foreground'),
      `${mode} theme: --bn-main must differ from --bn-foreground or mark is invisible`,
    );
  }
  return `hr/border ${lineToken}, blockquote border --bn-main, mark --bn-main on --bn-main-foreground`;
});

await check('bare a stays a link: underlined, token-coloured, no button geometry', () => {
  const rules = topLevelRules(base);
  const aRules = rulesFor(rules, 'a').filter((rule) =>
    rule.selector.split(',').map((part) => part.trim()).includes('a'),
  );
  must(aRules.length > 0, 'the base layer has no bare `a` rule');
  const pairs = aRules.flatMap((rule) => declarations(rule.body));
  const decoration = pairs.find(([property]) => property === 'text-decoration-line');
  must(
    (decoration && decoration[1] === 'underline') || pairs.some(([p, v]) => p === 'text-decoration' && v.includes('underline')),
    'bare `a` must keep an underline (ADR-0001: a link is a link, not a button)',
  );
  const colour = pairs.find(([property]) => property === 'color');
  must(
    colour && /var\(--_|var\(--bn-/.test(colour[1]),
    `bare a must take its colour from a token, got ${colour?.[1]}`,
  );
  const buttonGeometry = pairs.filter(
    ([property]) => property === 'box-shadow' || property === 'transform',
  );
  must(
    buttonGeometry.length === 0,
    `bare a must not take button geometry (use .bn-button): ${buttonGeometry
      .map(([p, v]) => `${p}: ${v}`)
      .join('; ')}`,
  );
  return `text-decoration-line: underline, color: ${colour[1]}, no box-shadow/transform`;
});

/* ------------------------- 6. Typography page (ticket deliverable B) ------------------------- */

/** spec §8 Typography: the bare elements the fence has to demonstrate. */
const FENCE_ELEMENTS = REQUIRED_BARE_ELEMENTS.filter((element) => element !== 'body');

/** Frontmatter opens and closes with a `---` line; the body is what the renderer turns into HTML. */
function splitFrontmatter(source, label) {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  must(lines[0] === '---', `${label}: frontmatter must open on line 1`);
  const end = lines.indexOf('---', 1);
  must(end !== -1, `${label}: frontmatter is never closed`);
  return { frontmatter: lines.slice(1, end), body: lines.slice(end + 1) };
}

/** Body lines tagged with whether they sit inside a fenced code block. */
function taggedBodyLines(body) {
  let inFence = false;
  return body.map((line) => {
    const tagged = { line, inFence };
    if (/^```/.test(line)) inFence = !inFence;
    return tagged;
  });
}

function readTypographyPage() {
  must(existsSync(abs(TYPOGRAPHY_PAGE)), `${TYPOGRAPHY_PAGE} is missing`);
  return readFileSync(abs(TYPOGRAPHY_PAGE), 'utf8');
}

/**
 * innerHTML of the first element whose class attribute contains `className`, walking the tag
 * depth by hand. Used to inspect the rendered Markdown body on its own, so that markup the
 * templates inject around it (templates/component.html supplies the H1 and the H2) cannot be
 * mistaken for content the fence leaked.
 */
function extractContainer(html, className) {
  const open = new RegExp(`<([a-z][a-z0-9]*)\\b[^>]*class="[^"]*\\b${className}\\b[^"]*"[^>]*>`, 'i').exec(
    html,
  );
  if (!open) return null;
  const tag = open[1];
  const tokens = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  tokens.lastIndex = open.index + open[0].length;
  let depth = 1;
  for (let token = tokens.exec(html); token; token = tokens.exec(html)) {
    depth += token[1] === '/' ? -1 : 1;
    if (depth === 0) return html.slice(open.index + open[0].length, token.index);
  }
  must(false, `the <${tag} class="${className}"> element is never closed`);
}

await check('content/components/typography.md exists, without a BOM, titled Typography', () => {
  const bytes = readFileSync(abs(TYPOGRAPHY_PAGE));
  must(
    !(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf),
    'a BOM makes seite report the frontmatter as missing',
  );
  const { frontmatter } = splitFrontmatter(bytes.toString('utf8'), TYPOGRAPHY_PAGE);
  const title = frontmatter.find((line) => /^title\s*:/.test(line));
  must(title, 'the page needs a title — the template renders it as the page H1');
  must(/typography/i.test(title), `the page title should be Typography, got ${title.trim()}`);
  must(
    frontmatter.some((line) => /^description\s*:/.test(line)),
    'the page needs a description — the index and the lede both read it',
  );
  return title.trim();
});

await check('the Typography page is written as exactly one standard code fence', () => {
  const { body } = splitFrontmatter(readTypographyPage(), TYPOGRAPHY_PAGE);
  const fences = body.filter((line) => /^```/.test(line));
  must(
    fences.length === 2,
    `expected one fenced block (an opening and a closing line), found ${fences.length} — ticket 04 turns each fence into the preview/code widget`,
  );
  must(
    /^```[a-z][\w-]*$/.test(fences[0]),
    `the opening fence needs a language tag, got ${JSON.stringify(fences[0])}`,
  );
  must(fences[1].trim() === '```', `the closing fence must be bare, got ${JSON.stringify(fences[1])}`);
  return `${fences[0]} … ${fences[1]}`;
});

await check('the Typography page body contains no H2 (the template supplies it)', () => {
  const { body } = splitFrontmatter(readTypographyPage(), TYPOGRAPHY_PAGE);
  const offenders = taggedBodyLines(body)
    .map((entry, index) => ({ ...entry, number: index + 1 }))
    .filter(({ line, inFence }) => !inFence && /^\s*##\s+\S/.test(line));
  must(
    offenders.length === 0,
    `H2 heading(s) at body line(s) ${offenders.map(({ number }) => number).join(', ')}`,
  );
  const h3 = taggedBodyLines(body).filter(({ line, inFence }) => !inFence && /^\s*###\s+\S/.test(line));
  return `no H2${h3.length > 0 ? ` (${h3.length} H3 allowed by spec §10)` : ''}`;
});

await check('no link written in the content carries a trailing slash', () => {
  const { body } = splitFrontmatter(readTypographyPage(), TYPOGRAPHY_PAGE);
  const targets = [...body.join('\n').matchAll(/\]\(([^)\s]+)\)/g)].map((match) => match[1]);
  const offenders = targets.filter((target) => target.endsWith('/') && target !== '/components/');
  must(
    offenders.length === 0,
    `seite check --strict calls these broken links: ${offenders.join(', ')}`,
  );
  return targets.length > 0 ? targets.join(', ') : 'no links in the page (nothing to trip --strict)';
});

await check('the fence shows every bare element, with no class attribute', () => {
  const { body } = splitFrontmatter(readTypographyPage(), TYPOGRAPHY_PAGE);
  const fence = taggedBodyLines(body)
    .filter(({ inFence }) => inFence)
    .map(({ line }) => line)
    .join('\n');
  must(fence.trim().length > 0, 'the fenced block is empty');
  const missing = FENCE_ELEMENTS.filter(
    (element) => !new RegExp(`<${element}(?![\\w-])`).test(fence),
  );
  must(missing.length === 0, `the fence never shows: ${missing.map((e) => `<${e}>`).join(', ')}`);
  must(!/class\s*=/.test(fence), 'the preview is injected as bare markup — no class attributes');
  must(
    !/<(?:html|head|body|link|script)\b/i.test(fence),
    'the fence is injected into a live page: no document wrapper and no script tag',
  );
  return `${FENCE_ELEMENTS.length} elements demonstrated, no class attributes`;
});

/* ------------------------------ 7. documentation site (seite) ------------------------------ */

const SKIP_SITE = process.argv.includes('--no-site');

function locateSeite() {
  const candidates = [process.env.SEITE_BIN, 'D:\\sdk\\seite\\seite.exe', 'seite'].filter(Boolean);
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
    if (probe.status === 0) return { bin: candidate, version: (probe.stdout ?? '').trim() };
  }
  return null;
}

function runSeite(args) {
  const result = spawnSync(SEITE.bin, args, {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 180_000,
    env: { ...process.env, SEITE_YES: '1' },
  });
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() };
}

const SEITE = SKIP_SITE ? null : locateSeite();

if (SKIP_SITE) {
  console.log('SKIP  seite build / check / index checks (--no-site)');
} else {
  await check('seite build --strict exits 0 with no broken link or missing asset', () => {
    must(SEITE, 'the seite CLI was not found — set SEITE_BIN, or pass --no-site');
    const { status, output } = runSeite(['build', '--dir', ROOT, '--strict']);
    must(status === 0, `exit ${status}:\n${output}`);
    const problems = output
      .split('\n')
      .filter((line) => /\b(broken|missing|warning|error)\b/i.test(line));
    must(problems.length === 0, `build --strict reported:\n${problems.join('\n')}`);
    return output.split('\n').find((line) => /Built\b/.test(line))?.trim() ?? 'exit 0';
  });

  await check('seite check --strict exits 0', () => {
    must(SEITE, 'the seite CLI was not found');
    const { status, output } = runSeite(['check', '--dir', ROOT, '--strict']);
    must(status === 0, `exit ${status}:\n${output}`);
    must(
      !/\b(warning|broken|missing)\b/i.test(output),
      `check --strict reported:\n${output}`,
    );
    return output.split('\n').find((line) => /No problems found|No errors/.test(line))?.trim() ?? 'exit 0';
  });

  await check('the components index lists the Typography page', () => {
    const index = readFileSync(abs('dist/components/index.html'), 'utf8');
    const link = index.match(/href="([^"]*\/components\/typography\/?)"/);
    must(link, 'dist/components/index.html does not link to the Typography entry');
    must(/Typography/.test(index), 'the index does not name the Typography entry');
    return `linked as ${link[1]}`;
  });

  await check('the built Typography page carries the fence as escaped code, not live markup', () => {
    const page = readFileSync(abs('dist/components/typography.html'), 'utf8');
    must(/<h1[^>]*>\s*Typography/.test(page), 'the page has no Typography H1');
    must(/<pre/.test(page), 'the fence did not render as a <pre> block');
    // seite's highlighter splits entities across spans, so count `<` escapes rather than
    // looking for `&lt;h1&gt;`, and prove the example stayed inert by its heading tags.
    const escaped = [...page.matchAll(/&lt;/g)].length;
    must(escaped > 20, `the example markup must be escaped as entities, found ${escaped} "&lt;"`);

    // Scope the leak check to the rendered body container, not the whole document: ticket 04's
    // templates/component.html deliberately injects the one H2 of a component page
    // (`<h2 class="site-component__section" id="example" data-site-heading="example">Example</h2>`,
    // line 25) and spec §10 keeps authored headings at H3 and below, so a document-wide
    // "no <h2>..<h6> anywhere" test can only ever be red. The intent is unchanged and now
    // precise: no heading tag *inside the Markdown-rendered body* may be a live tag.
    const body = extractContainer(page, 'site-prose');
    must(body, `<div class="site-prose"> was not found — the Markdown body has no container`);
    must(
      body.length > 0,
      'the .site-prose container is empty — this check would pass vacuously',
    );
    must(
      !/<h[1-6][\s>]/.test(body),
      'heading tags from the example leaked into the rendered body as live markup — ' +
        'the fence was injected instead of escaped',
    );

    // The mirror guarantee, asserted once here and exhaustively per component page in
    // scripts/verify-demo.mjs ("every component page renders exactly one H2, injected by the
    // template", lines 357-378), which is why it is not repeated page by page.
    const h2s = [...page.matchAll(/<h2\b[^>]*>/g)].map((match) => match[0]);
    must(
      h2s.length === 1 && /data-site-heading=/.test(h2s[0]),
      `a component page must render exactly one H2 and it must be the template-injected one, ` +
        `found ${h2s.length}: ${h2s.join(' | ')}`,
    );

    must(page.includes('Heading level six'), 'the example text never reached the page');
    return (
      `${page.length} bytes, ${escaped} escaped "<", no live heading in .site-prose ` +
      `(${body.length} bytes), one template H2, <pre> present`
    );
  });
}

/* ------------------------------------ summary ------------------------------------ */

console.log(`\n${checks - failures.length}/${checks} checks passed`);
if (failures.length > 0) {
  console.log('\nfailed:');
  for (const name of failures) console.log(`  - ${name}`);
  process.exit(1);
}
