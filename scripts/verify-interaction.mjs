#!/usr/bin/env node
/**
 * Scripted verification for ticket 09 — the interaction contract, in one place.
 *
 * Ticket 07 proved the interaction geometry *worked*; ticket 09's job is to make it structurally
 * impossible for the values to scatter again, and to prove that mechanically. The three
 * verification methods in
 * `.scratch/barnacle-design/issues/09-unify-interaction-contract.md` are the specification of
 * this file:
 *
 *   1. after the refactor every interaction invariant of the ticket-08 harness is still green
 *   2. overriding `--bn-shadow-x` / `--bn-press` on `<html>` moves every component that has
 *      joined the contract, in step
 *   3. a full-text search of the CSS finds no displacement number outside the single source
 *
 * Methods 1 and 3 are text/regular-expression assertions against `src/css/*.css` (and the built
 * artifact); method 2 is measured in real Chrome against `static/barnacle.css`. The expected
 * values are an independent source of truth — spec.md §3 (invariants) and §7 (the interaction
 * contract), ADR-0005, and `D:\code\barnacle-notes\orchestrator-decisions.md` §4 (the frozen
 * slot block, verbatim) — and are never recomputed from the files they audit.
 *
 * Run with: npm run verify:interaction   (or: node scripts/verify-interaction.mjs)
 * Options:  --no-browser  skip the real-Chrome checks (they need playwright-core)
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The build chain is the source of truth for two things this audit must not re-implement: the
// list of files that make up the artifact, and the exact text each file contributes to it. A
// second copy of either would drift, and the audit would then be measuring the wrong files.
import { CSS_MANIFEST, LAYER_DECLARATION, layerBlock } from './build.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const abs = (...parts) => path.join(ROOT, ...parts);

/* ==============================================================================================
 * 1. Expectations — transcribed from the design documents, never from the implementation
 * ============================================================================================ */

/** The file that owns the single source (orchestrator-decisions §4: "06 declares, 07 consumes"). */
const BASE_FILE = '00-base.css';

/**
 * ADR-0005: the base layer may name a public token or an internal slot, and nothing else (no
 * invented `--brand-*`, no bare `--lift`). `--_variant-color` is the one slot another layer
 * publishes (01-theme.css maps `data-variant` onto it).
 */
const PUBLIC_TOKEN = /^--bn-[a-z0-9-]+$/;
const INTERNAL_SLOT = /^--_[a-z0-9-]+$/;

/** spec.md §6.1 — the complete public token vocabulary. Nothing else may be written down. */
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

/** The one internal slot a component reads without declaring it (published by 01-theme.css). */
const SEMANTIC_SLOT = '--_variant-color';

/**
 * orchestrator-decisions §4 + recipes §2.3 — the frozen slot block of `00-base.css`, verbatim.
 * These are the *only* names a component may override, and the values below are the ones the
 * single source must declare.
 */
const FROZEN_SLOTS = new Map([
  ['--_lift-x', 'calc(var(--bn-shadow-lift) * -1)'],
  ['--_lift-y', 'calc(var(--bn-shadow-lift) * -1)'],
  ['--_press-x', 'var(--bn-press)'],
  ['--_press-y', 'var(--bn-press)'],
  ['--_shadow-rest', 'var(--bn-shadow-md)'],
  ['--_shadow-hover', 'var(--bn-shadow-lg)'],
  ['--_shadow-press', 'none'],
  ['--_focus-ring', '3px solid var(--bn-ring)'],
  ['--_focus-ring-offset', '3px'],
  ['--_motion', 'var(--bn-transition)'],
]);

/** recipes §2.3 — the border/surface default slots of the same single source. */
const DEFAULT_SLOTS = new Map([
  ['--_border-rest', 'var(--bn-border-color)'],
  ['--_border-hover', 'var(--bn-border-color)'],
  ['--_border-press', 'var(--bn-border-color)'],
  ['--_surface', 'var(--bn-secondary-background)'],
  ['--_surface-hover', 'var(--bn-secondary-background)'],
  ['--_surface-press', 'var(--bn-secondary-background)'],
]);

/**
 * The ten geometry slots of orchestrator-decisions §4 form a *value chain*: each one is derived
 * from a public token and nothing else. A component may not re-point them at an internal slot or
 * at a literal — it may only override them with another public token or an explicit zero.
 *
 * The ring thickness (`--_focus-ring-offset`, and the `3px` inside `--_focus-ring`) is the one
 * number that is neither a displacement nor a shadow, so spec §7 fixes it literally.
 */
const DERIVED_VALUE = {
  '--_lift': /^(?:calc\(\s*var\(--bn-[\w-]+\)[^)]*\)|var\(--bn-[\w-]+\)|0)$/,
  '--_press': /^(?:var\(--bn-[\w-]+\)|calc\(\s*var\(--bn-[\w-]+\)[^)]*\)|0)$/,
  '--_shadow': /^(?:var\(--bn-shadow[\w-]*\)|none)$/,
  '--_motion': /^var\(--bn-transition\)$/,
};

/** spec §3 invariant 3 — the property whose value *is* the hard shadow. */
const SHADOW_PROPERTY = 'box-shadow';

/**
 * A dimension literal — `4px`, `0.25rem`, `50%`. This is the thing a token has to replace, and the
 * only number a component may write down in a shadow is the bare `0` of a hard shadow's blur and
 * spread (spec §3 invariant 2: the shadow is offset, never blurred, never spread).
 */
const SHADOW_DIMENSION = /(?:^|[\s(,*/+-])(?:\d*\.)?\d+(?:px|rem|em|%|vw|vh|vmin|vmax|ch|ex|pt|pc|in|cm|mm|q)\b/i;

/** Split a declaration value on top-level whitespace, keeping `calc(...)` and `var(...)` whole. */
function shadowParts(value) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const char of value.trim()) {
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    if (/\s/.test(char) && depth === 0) {
      if (current !== '') parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current !== '') parts.push(current);
  return parts;
}

/**
 * spec §3 invariant 2/3 — a component's `box-shadow` must be *derived from the tokens*, never
 * written down. Two shapes qualify, and only these two:
 *
 *   1. one tier by reference — `var(--_shadow-rest)`, `var(--bn-shadow-sm)`;
 *   2. the tier spelled out — the offsets as `var(--bn-shadow-x/y)`, optionally through `calc()`;
 *      a blur and a spread that are exactly `0`; the colour as a `--bn-*` token.
 *
 * Tickets 10, 13 and 16 re-derive the shape in place (a scaled shadow on an accent card, badge or
 * alert; the same `0 0` on every hard shadow), and that is legitimate: the offsets still come from
 * `--bn-shadow-x/y`. What the check has to keep catching is a component that stops deriving —
 * `4px 4px 0 0 var(--bn-shadow-color)`, `var(--bn-shadow-x) var(--bn-shadow-y) 2px 0 var(...)`, or
 * any colour written down instead of read. So the rule is stated over the *parts* of the value, not
 * over the shape of a string: every part is a token reference, a `calc()` over tokens, or `0`.
 */
function isDerivedShadow(value) {
  const trimmed = value.trim();
  if (/^(?:none|inherit|initial|unset|revert)$/.test(trimmed)) return true;
  // A dimension literal is a hard-coded offset, blur or spread wherever it sits — including inside
  // a `calc()`, where `calc(4px + var(--bn-shadow-x))` derives nothing from the token that matters.
  if (SHADOW_DIMENSION.test(trimmed)) return false;
  return shadowParts(trimmed).every(
    (part) =>
      part === '0' ||
      /^var\(--(?:_|bn-)[\w-]+\)$/.test(part) ||
      /^calc\([^()]*(?:\([^()]*\)[^()]*)*\)$/.test(part),
  );
}

/** spec §7 + decision D — the touch-stickiness guard a hover rule must sit inside. */
const HOVER_GUARD = /hover:\s*hover/;

/** spec §7 — motion is declared where the visitor accepts it, never switched off afterwards. */
const MOTION_GUARD = /prefers-reduced-motion:\s*no-preference/;

/**
 * The interaction geometry a component's state rules must read, per state. A `:hover` rule may
 * declare `transform` and `box-shadow`, but only as these slots — that is the shape ticket 09
 * exists to protect (spec §7: the object rises by exactly what its shadow grows by).
 */
const STATE_SLOTS = {
  hover: ['--_lift-x', '--_lift-y', '--_shadow-hover'],
  active: ['--_press-x', '--_press-y', '--_shadow-press'],
};

/** The properties a state rule may use to carry the geometry. */
const GEOMETRY_STATE_PROPERTIES = ['transform', 'translate', 'box-shadow'];

/** The one allowed way to displace an element: two slot references, in either displacement family. */
const SLOT_TRANSLATE = /^translate\(\s*var\(--_(?:lift|press)-[xy]\)\s*,\s*var\(--_(?:lift|press)-[xy]\)\s*\)$/;

/**
 * The `:hover` rules a component must declare for itself, and the two slots each one has to read.
 * The rule stays with the component (see `00-base.css` section 3 for why hoisting it failed), so
 * this is the list that keeps every component's version identical in shape.
 */
const REQUIRED_HOVER_RULES = [
  { file: 'button.css', selector: ':is(button, .bn-button):not(:disabled):not([aria-disabled="true"]):hover' },
  { file: 'tabs.css', selector: 'bn-tabs [role="tab"]:not(:disabled):not([aria-disabled="true"]):hover' },
];

/** Every component file that has joined the contract (ticket 09 audits what has landed). */
const CONTRACT_FILES = ['button.css', 'tabs.css', 'dropdown.css', 'toast.css'];

/** spec §6.1 — the geometry values the browser checks measure against. */
const GEOMETRY = {
  borderWidth: '3px',
  md: 'rgb(0, 0, 0) 4px 4px 0px 0px',
  sm: 'rgb(0, 0, 0) 2px 2px 0px 0px',
  lg: 'rgb(0, 0, 0) 6px 6px 0px 0px',
  /** A rest-tier tag is a `r g b` prefix matching one of the tiers above. */
  rest: /^rgb\(0, 0, 0\) (?:2px 2px|4px 4px) 0px 0px$/,
  hover: 'matrix(1, 0, 0, 1, -2, -2)',
  press: 'matrix(1, 0, 0, 1, 3, 3)',
  /** decision E — --bn-press stays 3px; the override below must move it to 5px. */
  pressOverride: '5px',
  pressOverridden: 'matrix(1, 0, 0, 1, 5, 5)',
  /** --bn-shadow-x/y: 8px on <html> scales sm/md/lg to 4/8/12px and the lift to 4px. */
  scaled: '8px',
  scaledMd: 'rgb(0, 0, 0) 8px 8px 0px 0px',
  scaledLift: 'matrix(1, 0, 0, 1, -4, -4)',
};

/* ====================================== harness ====================================== */

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

/** `file:line` for an index into a source string — the whole point of a static audit. */
function locate(file, source, index) {
  return `${file}:${source.slice(0, index).split('\n').length}`;
}

/**
 * Compare two selectors as written, ignoring whitespace and quote style. Used to find the hover
 * rule a component is required to declare, however it happens to be formatted.
 */
function sameSelector(left, right) {
  const normalise = (selector) => selector.replace(/["']/g, '').replace(/\s+/g, ' ').trim();
  return normalise(left) === normalise(right);
}

/* ================================== CSS source reading ================================== */

/** Comment bodies become spaces: prose about a declaration is not a declaration. */
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

/** Index of the `)` closing the `(` at `openIndex`, counting nested parentheses. */
function balancedEnd(text, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return text.length - 1;
}

/**
 * Every rule of one source file, flattened out of its at-rule wrappers while keeping the wrappers
 * in `conditions`. `at` is the index of the rule's prelude in the file, which is what turns a
 * finding into `src/css/button.css:169` instead of "somewhere in the library".
 */
function parseRules(file, text, conditions = [], offset = 0) {
  const rules = [];
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
    if (prelude.startsWith('@')) {
      rules.push(...parseRules(file, body, [...conditions, prelude], offset + open + 1));
    } else {
      rules.push({ file, selector: prelude, body, conditions, at: offset + i, bodyAt: offset + open + 1 });
    }
    i = close + 1;
  }
  return rules;
}

/** `property: value` pairs declared directly in a rule body, with their index in the source. */
function declarations(rule) {
  const pairs = [];
  const re = /(--[\w-]+|[\w-]+)\s*:\s*([^;{}]+)/g;
  for (const match of rule.body.matchAll(re)) {
    pairs.push({
      property: match[1],
      value: match[2].replace(/\s+/g, ' ').trim(),
      at: rule.bodyAt + match.index,
      selector: rule.selector,
      conditions: rule.conditions,
      file: rule.file,
    });
  }
  return pairs;
}

/** The manifest is the build chain's own list — an audit that read a second list would drift. */
const SOURCE_FILES = CSS_MANIFEST.map((entry) => entry.file);

const sources = new Map(
  SOURCE_FILES.map((file) => {
    const raw = fs.readFileSync(abs('src/css', file), 'utf8');
    const blanked = blankComments(raw);
    // `blanked` is what the parser sees: a comment may legitimately contain a `{`, and a comment
    // is not a rule. (Ticket 09's first audit parsed the raw text and read a `{` inside a doc
    // comment as a rule prelude, which then swallowed the rule that followed it.)
    return [file, { raw, blanked, rules: parseRules(file, blanked) }];
  }),
);

/**
 * The artifact a fresh `npm run build` would publish, assembled with the build chain's own helper
 * and the same two normalisations `prepareSource` applies (LF, no trailing whitespace, and the
 * layer declaration dropped from the file that carries it).
 *
 * It exists so that a finding's `file:line` can be trusted: if the shipped artifact is this
 * string, then a line number found in `src/css/` means the same thing in `static/barnacle.css`.
 */
function expectedArtifact() {
  const blocks = CSS_MANIFEST.map((entry) => {
    const text = sources.get(entry.file).raw.replace(/\r\n/g, '\n');
    const body = entry.file === BASE_FILE ? text.split('\n').slice(1) : text.split('\n');
    return layerBlock({ rel: `src/css/${entry.file}`, layer: entry.layer, css: body.join('\n').replace(/\s+$/, '') });
  });
  return `${LAYER_DECLARATION}\n${blocks.join('\n')}\n`;
}

/** Every rule of every source file, tagged with the file it came from. */
const allRules = [...sources.values()].flatMap((source) => source.rules);
/** Every declaration of every source file. */
const allDeclarations = allRules.flatMap(declarations);

const baseSource = sources.get(BASE_FILE);
must(baseSource, `${BASE_FILE} is not in CSS_MANIFEST`);

/** Rules outside the single source — "component files" for the purposes of this audit. */
const componentRules = allRules.filter((rule) => rule.file !== BASE_FILE);
const componentDeclarations = allDeclarations.filter((declaration) => declaration.file !== BASE_FILE);

/** The `:root` rule of 00-base.css, which is where the slots are declared. */
const baseRootRule = baseSource.rules.find((rule) => rule.selector === ':root');
const baseRootDeclarations = baseRootRule ? declarations(baseRootRule) : [];

/** Every place a `--_` slot is given a value, anywhere in `src/css/`. */
const slotSites = allDeclarations.filter((declaration) => INTERNAL_SLOT.test(declaration.property));

/** Which family a slot belongs to, for the derivation rule. */
function familyOf(name) {
  if (/^--_(?:lift|press)-[xy]$/.test(name)) return name.startsWith('--_lift') ? '--_lift' : '--_press';
  if (/^--_shadow-/.test(name)) return '--_shadow';
  if (name === '--_motion') return '--_motion';
  return null;
}

const slotValue = (name) => baseRootDeclarations.find((d) => d.property === name)?.value;

/* ==================================== static checks ==================================== */

console.log(`barnacle interaction-contract verification — ${ROOT}\n`);
console.log(`      auditing ${SOURCE_FILES.length} source files: ${SOURCE_FILES.join(', ')}\n`);

await check('every src/css file is UTF-8 without a BOM and writes no @layer', () => {
  const problems = [];
  for (const file of SOURCE_FILES) {
    const bytes = fs.readFileSync(abs('src/css', file));
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) problems.push(`${file}: BOM`);
    const offenders = sources
      .get(file)
      .raw.split(/\r?\n/)
      .map((line, index) => [line, index + 1])
      // 00-base.css is the one file that carries the layer declaration, on line 1 (ADR-0006); every
      // other `@layer` belongs to CSS_MANIFEST in scripts/build.mjs.
      .filter(([line, number]) => /^\s*@layer\b/.test(line) && !(file === BASE_FILE && number === 1))
      .map(([, n]) => n);
    if (offenders.length > 0) problems.push(`${file}: @layer on line(s) ${offenders.join(', ')}`);
  }
  must(problems.length === 0, problems.join('; '));
  must(
    sources.get(BASE_FILE).raw.split('\n')[0] === LAYER_DECLARATION,
    `${BASE_FILE} line 1 must be the layer declaration ${JSON.stringify(LAYER_DECLARATION)}`,
  );
  return `${SOURCE_FILES.length} files clean, the declaration on ${BASE_FILE} line 1`;
});

await check('no src/css file names a custom property outside --bn-* / --_*', () => {
  const foreign = new Set();
  for (const file of SOURCE_FILES) {
    for (const match of sources.get(file).blanked.matchAll(/--[\w-]+/g)) {
      const name = match[0];
      if (PUBLIC_TOKEN.test(name) || INTERNAL_SLOT.test(name)) continue;
      foreign.add(`${file}: ${name}`);
    }
  }
  must(foreign.size === 0, `custom properties outside the two namespaces (ADR-0005): ${[...foreign].join(', ')}`);
  return 'only --bn-* and --_*, everywhere';
});

await check('the geometry slots are declared once, in 00-base.css :root, and only referenced after', () => {
  const expected = new Set([...FROZEN_SLOTS.keys(), ...DEFAULT_SLOTS.keys()]);

  // One canonical declaration per slot, on :root, in the single source. A component *re-points* a
  // slot on its own selector — that is how `.bn-outline` drops a shadow tier and how `.bn-ghost`
  // zeroes a displacement — but the source of the number is one block, and this check keeps it
  // that way: presence once, in one place, with the frozen value.
  const missing = [...expected].filter((name) => slotValue(name) === undefined);
  must(missing.length === 0, `not declared in ${BASE_FILE} :root: ${missing.join(', ')}`);
  const duplicates = [...expected].filter(
    (name) => baseRootDeclarations.filter((declaration) => declaration.property === name).length > 1,
  );
  must(duplicates.length === 0, `declared more than once in ${BASE_FILE} :root: ${duplicates.join(', ')}`);
  const inRoot = new Set(baseRootDeclarations.map((declaration) => declaration.property));
  must(
    [...expected].every((name) => inRoot.has(name)),
    `a slot is declared outside the :root rule of ${BASE_FILE}`,
  );

  // The ten geometry slots, wherever they appear, may only be given a derived value or an explicit
  // zero — never a length. That is the difference between "one source" and "one source plus N
  // copies that happen to agree today".
  const overrides = slotSites.filter((declaration) => familyOf(declaration.property));
  const offenders = overrides
    .filter((declaration) => !DERIVED_VALUE[familyOf(declaration.property)].test(declaration.value))
    .map(
      (declaration) =>
        `${locate(declaration.file, sources.get(declaration.file).blanked, declaration.at)} — ${declaration.selector} { ${declaration.property}: ${declaration.value} }`,
    );
  must(
    offenders.length === 0,
    `a geometry slot may only be derived from --bn-* or zeroed: ${offenders.join('; ')}`,
  );

  const files = [...new Set(overrides.map((declaration) => declaration.file))];
  const zeroed = overrides.filter((declaration) => declaration.value === '0').length;
  return `${expected.size} slots on ${BASE_FILE} :root; ${overrides.length} component override(s) across ${files.join('/')} (${zeroed} zeroed), every value derived`;
});

await check('every frozen slot value is the one orchestrator-decisions §4 froze, verbatim', () => {
  const wrong = [];
  for (const [name, want] of [...FROZEN_SLOTS, ...DEFAULT_SLOTS]) {
    const actual = slotValue(name);
    if (actual !== want) wrong.push(`${name} = ${JSON.stringify(actual)} (frozen: ${JSON.stringify(want)})`);
  }
  must(wrong.length === 0, wrong.join('; '));
  return `${FROZEN_SLOTS.size + DEFAULT_SLOTS.size} values match the decision file`;
});

await check('every translate() is a slot reference, and the slots are used everywhere they must be', () => {
  // A displacement written as a number is the regression this whole ticket exists to prevent
  // (spec §3 invariant 3). Outside animations.css — whose literal offset is an *entry* motion, not
  // an interaction displacement, and is ticket 14's file — every translate() must read a slot.
  // Read through the declaration parser, not a regex over raw text: `translate(var(--a), var(--b))`
  // nests parentheses, and a greedy `[^)]*` silently truncates it into something that looks wrong.
  const translations = allDeclarations.filter(
    (declaration) =>
      (declaration.property === 'transform' || declaration.property === 'translate') &&
      // animations.css is ticket 14's file, and an *entry* keyframe offset (`translateY(0.5rem)`)
      // is not an interaction displacement — spec §7 governs the slots, not the entrance.
      declaration.file !== 'animations.css',
  );
  must(translations.length > 0, 'nothing is displaced anywhere — the interaction contract is empty');

  const offenders = translations
    .map((declaration) => {
      const calls = [...declaration.value.matchAll(/\btranslate(?:3d|X|Y|Z)?\(/g)].map((match) =>
        declaration.value.slice(match.index, balancedEnd(declaration.value, declaration.value.indexOf('(', match.index)) + 1),
      );
      const bad = calls.filter((call) => !SLOT_TRANSLATE.test(call.replace(/\s+/g, ' ')));
      if (bad.length === 0) return null;
      return `${locate(declaration.file, sources.get(declaration.file).blanked, declaration.at)} — ${declaration.selector} { ${declaration.property}: ${declaration.value} }`;
    })
    .filter(Boolean);
  must(
    offenders.length === 0,
    `a displacement must read --_lift-*/--_press-* (spec §3 invariant 3): ${offenders.join('; ')}`,
  );

  // And the slots must actually be spent: a component that declares a hover state but never moves
  // would pass every check above while quietly losing the contract.
  for (const { file, selector } of REQUIRED_HOVER_RULES) {
    const rule = sources.get(file).rules.find((candidate) => sameSelector(candidate.selector, selector));
    must(rule, `${file}: no rule with the selector ${JSON.stringify(selector)}`);
    must(
      /translate\(var\(--_lift-x\), var\(--_lift-y\)\)/.test(rule.body),
      `${file}: the hover rule must lift with translate(var(--_lift-x), var(--_lift-y)), got ${JSON.stringify(rule.body.replace(/\s+/g, ' ').trim())}`,
    );
  }

  const counts = new Map();
  for (const declaration of translations) {
    counts.set(declaration.file, (counts.get(declaration.file) ?? 0) + 1);
  }
  const entryOffset = [...sources.get('animations.css').blanked.matchAll(/translate[XY]?\(\s*-?[\d.]/g)].length;
  return `${translations.length} displacement declaration(s) across ${[...counts].map(([file, count]) => `${file}×${count}`).join(', ')}; ${entryOffset} literal entry offset(s) in animations.css`;
});

await check('no box-shadow outside 00-base.css is a literal (spec §3 invariant 2/3)', () => {
  const shadows = componentDeclarations.filter((declaration) => declaration.property === SHADOW_PROPERTY);
  const offenders = shadows
    .filter((declaration) => !isDerivedShadow(declaration.value))
    .map(
      (declaration) =>
        `${locate(declaration.file, sources.get(declaration.file).blanked, declaration.at)} — ${declaration.selector} { box-shadow: ${declaration.value} }`,
    );
  must(
    offenders.length === 0,
    `a component paints a shadow of its own instead of deriving it from the tokens (spec §3 invariant 2/3): ${offenders.join('; ')}`,
  );
  const byTier = shadows.filter((declaration) => /^var\(--[\w-]+\)$/.test(declaration.value.trim())).length;
  return `${shadows.length} component shadow declaration(s), every one derived from --bn-* tokens (${byTier} as a single tier reference, ${shadows.length - byTier} spelled out from the offset tokens)`;
});

await check('every component hover rule reads the geometry slots — no transform, no shadow value', () => {
  const hoverRules = componentRules.filter((rule) => /:hover\b/.test(rule.selector));
  must(hoverRules.length > 0, 'no component declares a hover rule at all');

  const offenders = [];
  for (const rule of hoverRules) {
    for (const declaration of declarations(rule)) {
      if (!GEOMETRY_STATE_PROPERTIES.includes(declaration.property)) continue;
      const ok =
        declaration.property === SHADOW_PROPERTY
          ? /^var\(--_shadow-(?:hover|rest|press)\)$/.test(declaration.value)
          : SLOT_TRANSLATE.test(declaration.value);
      if (!ok) {
        offenders.push(
          `${locate(declaration.file, sources.get(declaration.file).blanked, declaration.at)} — ${rule.selector} { ${declaration.property}: ${declaration.value} }`,
        );
      }
      must(
        !/\d/.test(declaration.value),
        `${locate(declaration.file, sources.get(declaration.file).blanked, declaration.at)} — ${rule.selector} { ${declaration.property}: ${declaration.value} } carries a number (spec §3 invariant 3)`,
      );
    }
  }
  must(
    offenders.length === 0,
    `a component hover rule must read the slots, not restate them: ${offenders.join('; ')}`,
  );

  // The two components that own a hover state must own it in the same shape: the same slots, read
  // in the same properties, under the same guard. A component that quietly stops moving is as bad
  // as one that moves by its own number.
  for (const { file, selector } of REQUIRED_HOVER_RULES) {
    const rule = hoverRules.find((candidate) => candidate.file === file && sameSelector(candidate.selector, selector));
    must(
      rule,
      `${file} has no hover rule with the selector ${JSON.stringify(selector)} — the component's interaction state is its own to declare`,
    );
    must(
      rule.conditions.some((condition) => HOVER_GUARD.test(condition)),
      `${file} declares ${JSON.stringify(selector)} outside @media (hover: hover): it would stick on touch (decision D)`,
    );
    const declared = new Map(declarations(rule).map((declaration) => [declaration.property, declaration.value]));
    must(
      SLOT_TRANSLATE.test(declared.get('transform') ?? ''),
      `${file} must lift with translate(var(--_lift-x), var(--_lift-y)), got ${JSON.stringify(declared.get('transform'))}`,
    );
    must(
      /var\(--_shadow-hover\)/.test(declared.get('box-shadow') ?? ''),
      `${file} must grow with --_shadow-hover, got ${JSON.stringify(declared.get('box-shadow'))}`,
    );
  }

  const repaints = hoverRules.filter((rule) => declarations(rule).length > 0 && !declarations(rule).some((d) => GEOMETRY_STATE_PROPERTIES.includes(d.property)));
  return `${hoverRules.length} component hover rule(s); ${REQUIRED_HOVER_RULES.length} contract rule(s) verified slot by slot; ${repaints.length} colour-only state rule(s)`;
});

await check('every component press rule reads the geometry slots too', () => {
  const pressRules = componentRules.filter((rule) => /:active\b/.test(rule.selector));
  must(pressRules.length > 0, 'no component declares a press state — the object could never fall');
  const offenders = pressRules
    .filter((rule) => {
      const declared = new Map(declarations(rule).map((declaration) => [declaration.property, declaration.value]));
      return (
        !SLOT_TRANSLATE.test(declared.get('transform') ?? '') ||
        !/var\(--_shadow-press\)|none/.test(declared.get('box-shadow') ?? '')
      );
    })
    .map((rule) => `${locate(rule.file, sources.get(rule.file).blanked, rule.at)} — ${rule.selector} { ${rule.body.replace(/\s+/g, ' ').trim()} }`);
  must(
    offenders.length === 0,
    `a component press rule must fall by the press slots: ${offenders.join('; ')}`,
  );
  return `${pressRules.length} press rule(s), all reading --_press-* / --_shadow-press`;
});

await check('the focus ring is drawn from the ring slots wherever it is restated', () => {
  const rings = allRules.filter((rule) => /:focus-visible/.test(rule.selector));
  must(rings.length > 0, 'no :focus-visible rule anywhere — WCAG F78');
  const offenders = [];
  for (const rule of rings) {
    for (const declaration of declarations(rule)) {
      if (declaration.property === 'outline' && !/var\(--_focus-ring\)/.test(declaration.value)) {
        offenders.push(`${locate(rule.file, sources.get(rule.file).blanked, declaration.at)} — ${rule.selector} { outline: ${declaration.value} }`);
      }
      if (declaration.property === 'outline-offset' && !/var\(--_focus-ring-offset\)|\d+px/.test(declaration.value)) {
        offenders.push(`${locate(rule.file, sources.get(rule.file).blanked, declaration.at)} — ${rule.selector} { outline-offset: ${declaration.value} }`);
      }
      if (declaration.property === 'outline' && /^(?:none|0)\b/.test(declaration.value)) {
        offenders.push(`${locate(rule.file, sources.get(rule.file).blanked, declaration.at)} — ${rule.selector} removes the ring`);
      }
    }
  }
  must(offenders.length === 0, `the focus ring must read the slots: ${offenders.join('; ')}`);
  const offsets = rings.flatMap((rule) =>
    declarations(rule)
      .filter((declaration) => declaration.property === 'outline-offset')
      .map((declaration) => declaration.value),
  );
  return `${rings.length} ring rule(s); offsets: ${[...new Set(offsets)].join(', ')}`;
});

await check('the motion guard contains every transition that moves something', () => {
  // spec §7: motion is *declared* where the visitor accepts it, never switched off afterwards. The
  // check that matters is the one about movement: a transition over `transform` or `box-shadow` is
  // the interaction contract in motion, and an unguarded one animates for a visitor who asked for
  // less. (A bare `a` also colour-transitions in the base layer; that is a colour change, not a
  // displacement, and predates this ticket — it is deliberately out of scope here rather than
  // quietly rewritten.)
  const transitions = allRules.flatMap((rule) =>
    declarations(rule)
      .filter((declaration) => declaration.property === 'transition')
      .map((declaration) => ({ rule, declaration })),
  );
  must(transitions.length > 0, 'nothing declares a transition — every interaction would be instant');

  const movement = transitions.filter(({ declaration }) => /transform|box-shadow/.test(declaration.value));
  must(movement.length > 0, 'no transition covers transform or box-shadow — the interaction would snap');
  const unguarded = movement
    .filter(({ rule }) => !rule.conditions.some((condition) => MOTION_GUARD.test(condition)))
    .map(({ rule, declaration }) => `${rule.file}: ${rule.selector} { ${declaration.value} }`);
  must(
    unguarded.length === 0,
    `a transition over the interaction geometry is declared outside @media (prefers-reduced-motion: no-preference): ${unguarded.join('; ')}`,
  );

  const reduceBlocks = SOURCE_FILES.filter((file) => /prefers-reduced-motion:\s*reduce/.test(sources.get(file).blanked));
  must(
    reduceBlocks.length === 0,
    `a reduce block that switches motion off afterwards is the rejected form (spec §7): ${reduceBlocks.join(', ')}`,
  );

  const literalDurations = movement
    .filter(({ declaration }) => /\d+(?:\.\d+)?(?:ms|s)\b/.test(declaration.value.replace(/var\([^)]*\)/g, '')))
    .map(({ rule, declaration }) => `${rule.file}: ${rule.selector} { ${declaration.value} }`);
  must(
    literalDurations.length === 0,
    `a transition duration is written as a number instead of reading --_motion: ${literalDurations.join('; ')}`,
  );

  return `${movement.length} movement transition rule(s), all inside the guard and timed by --_motion; ${transitions.length - movement.length} colour-only transition(s) unaffected`;
});

await check('every component file has joined the contract or documents why not', () => {
  const missing = CONTRACT_FILES.filter((file) => !SOURCE_FILES.includes(file));
  must(missing.length === 0, `not in CSS_MANIFEST: ${missing.join(', ')}`);
  const known = new Set([...FROZEN_SLOTS.keys(), ...DEFAULT_SLOTS.keys(), SEMANTIC_SLOT]);
  const report = CONTRACT_FILES.map((file) => {
    const reads = new Set(
      [...sources.get(file).blanked.matchAll(/var\(\s*(--_[\w-]+)/g)].map((match) => match[1]),
    );
    must(reads.size > 0, `${file} reads no --_ slot — it is not part of the interaction contract`);
    const unknown = [...reads].filter((name) => !known.has(name));
    must(unknown.length === 0, `${file} reads a slot nobody declares: ${unknown.join(', ')}`);
    return `${file} (${reads.size})`;
  });
  return report.join(', ');
});

await check('the built artifact is a fresh concatenation of src/css/, byte for byte', () => {
  const artifactPath = abs('static/barnacle.css');
  must(fs.existsSync(artifactPath), 'static/barnacle.css is missing — run npm run build');
  const artifact = fs.readFileSync(artifactPath, 'utf8');
  for (const { file, selector } of REQUIRED_HOVER_RULES) {
    must(
      artifact.includes(selector),
      `the artifact does not carry the ${file} hover rule ${JSON.stringify(selector)} — run npm run build`,
    );
  }
  // The layout the browser block below measures against: the artifact *is* the concatenation, so
  // a line number found in a source file can be trusted to mean the same thing in `static/`.
  must(
    artifact === expectedArtifact(),
    'static/barnacle.css differs from a fresh concatenation of src/css/*.css — run npm run build',
  );
  return `${(artifact.length / 1024).toFixed(1)} kB artifact, byte-identical to src/css/`;
});

/* ==================================== browser checks ==================================== */

/**
 * The measurement page. Every control here is an anchor of the interaction contract: a bare
 * `<button>`, the `.bn-button` class, the tab strip (a component from a *later* ticket, which is
 * the proof that the source is shared rather than the button's private geometry), and a plain
 * `<a>` as the negative control — a link takes no geometry at all.
 *
 * The page carries no style of its own, and no script. Everything measured is the shipped
 * artifact.
 */
const FIXTURE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <link rel="icon" href="data:,">
    <title>barnacle interaction-contract harness</title>
    <link rel="stylesheet" href="/static/barnacle.css">
  </head>
  <body>
    <main>
      <button id="bare" type="button">Press me</button>
      <a id="classed" class="bn-button" href="#classed">A shaped anchor</a>
      <a id="link" href="#link">A plain link</a>

      <bn-tabs>
        <div role="tablist">
          <button id="tab-1" role="tab" aria-selected="false" type="button">One</button>
          <button id="tab-2" role="tab" aria-selected="true" type="button">Two</button>
        </div>
        <div role="tabpanel">Panel</div>
      </bn-tabs>

      <button id="disabled" type="button" disabled>Disabled</button>
      <button id="ghost" class="bn-ghost" type="button">Ghost</button>
    </main>
  </body>
</html>
`;

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/** Serves the fixture from memory and the artifact from `static/` — nothing from `src/`. */
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
 * A post-hover read without a freeze lies (browser-harness-findings §3.3): the value read is the
 * one from *before* the transition. Freezing is registered before `goto`, because `addStyleTag`
 * after load is too late.
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

async function withPage(browser, server, fn) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.addInitScript(FREEZE_INIT, FREEZE_CSS);
  try {
    await page.goto(server.url, { waitUntil: 'load' });
    return await fn(page, { consoleErrors, pageErrors });
  } finally {
    await context.close();
  }
}

/** One snapshot: the shadow's four lengths, the matrix, and which states really match. */
async function readGeometry(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { found: false };
    const cs = getComputedStyle(el);
    const shadow = cs.boxShadow;
    const lengths = (shadow.match(/-?[\d.]+px/g) ?? []).map((value) => Number.parseFloat(value));
    const matrix = cs.transform;
    const parts = matrix.startsWith('matrix(') ? matrix.slice(7, -1).split(',').map(Number) : [];
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;inline-size:var(--bn-shadow-lift)';
    document.body.appendChild(probe);
    const lift = Number.parseFloat(getComputedStyle(probe).inlineSize);
    probe.remove();
    return {
      found: true,
      hovered: el.matches(':hover'),
      pressed: el.matches(':active'),
      shadow,
      shadowX: lengths[0],
      shadowY: lengths[1],
      shadowBlur: lengths[2],
      shadowSpread: lengths[3],
      transform: matrix,
      translateX: parts[4] ?? 0,
      translateY: parts[5] ?? 0,
      lift,
    };
  }, selector);
}

/** Override a token where it actually rescales the derived chain: on `<html>` (§8). */
const setRootToken = (page, token, value) =>
  page.evaluate(([name, v]) => document.documentElement.style.setProperty(name, v), [token, value]);

const BROWSER_CHECKS = [
  [
    'method 2: overriding --bn-press on <html> moves every control that joined the contract',
    async (browser, server) =>
      withPage(browser, server, async (page, issues) => {
        // The negative control first: a plain <a> must never take the geometry.
        const link = await readGeometry(page, '#link');
        must(link.shadow === 'none', `a bare <a> must take no shadow (decision A), read ${link.shadow}`);
        must(link.transform === 'none', `a bare <a> must not be displaced, read ${link.transform}`);

        const controls = ['#bare', '#classed', '#tab-1'];
        for (const selector of controls) {
          const atRest = await readGeometry(page, selector);
          must(GEOMETRY.rest.test(atRest.shadow), `${selector} at rest should be an sm/md hard shadow, read ${atRest.shadow}`);
          await page.hover(selector);
          const hovered = await readGeometry(page, selector);
          must(hovered.hovered === true, `${selector} does not report :hover — the read would be a silent no-op`);
          must(
            hovered.transform === GEOMETRY.hover,
            `${selector} must lift by --bn-shadow-lift on hover, read ${hovered.transform}`,
          );
          must(
            hovered.shadowX - atRest.shadowX === 2 && hovered.lift === 2,
            `${selector} must grow its shadow by exactly the lift: ${atRest.shadowX}px → ${hovered.shadowX}px`,
          );
          must(
            atRest.shadowX === hovered.shadowX + hovered.translateX,
            `${selector}: the shadow must stay planted (${atRest.shadowX} vs ${hovered.shadowX} + ${hovered.translateX})`,
          );
          await page.mouse.down();
          const pressed = await readGeometry(page, selector);
          await page.mouse.up();
          must(pressed.pressed === true, `${selector} does not report :active while the mouse is down`);
          must(
            pressed.transform === GEOMETRY.press,
            `${selector} must fall by --bn-press on press, read ${pressed.transform}`,
          );
          must(pressed.shadow === 'none', `${selector} must collapse its shadow on press, read ${pressed.shadow}`);
          await page.mouse.move(0, 0);
        }

        // The override: one number on <html>, and every control that joined the contract responds
        // — the button and the tab together, which is the whole claim of a single source.
        await setRootToken(page, '--bn-press', GEOMETRY.pressOverride);
        await setRootToken(page, '--bn-shadow-x', GEOMETRY.scaled);
        await setRootToken(page, '--bn-shadow-y', GEOMETRY.scaled);
        for (const selector of controls) {
          const atRest = await readGeometry(page, selector);
          must(
            atRest.lift === 4,
            `${selector} must rescale with the :root override (--bn-shadow-lift 2px → 4px), read ${atRest.lift}px`,
          );
          // The button rests on the md tier (2 × lift); the tab deliberately rests one tier lower
          // (1 × lift). What matters here is that both *scaled* with the one token.
          must(
            atRest.shadowX === atRest.lift || atRest.shadowX === atRest.lift * 2,
            `${selector} must rest on a rescaled tier (offset 1× or 2× the 4px lift), read ${atRest.shadow}`,
          );
          await page.hover(selector);
          const hovered = await readGeometry(page, selector);
          must(
            hovered.transform === GEOMETRY.scaledLift,
            `${selector} must lift by the rescaled --bn-shadow-lift (4px), read ${hovered.transform}`,
          );
          must(
            hovered.shadowX - atRest.shadowX === 4,
            `${selector} must grow its shadow by the rescaled lift: ${atRest.shadowX}px → ${hovered.shadowX}px`,
          );
          await page.mouse.down();
          const pressed = await readGeometry(page, selector);
          await page.mouse.up();
          must(
            pressed.transform === GEOMETRY.pressOverridden,
            `${selector} must fall by the overridden --bn-press (5px), read ${pressed.transform}`,
          );
          await page.mouse.move(0, 0);
        }

        must(issues.consoleErrors.length === 0, `console errors: ${issues.consoleErrors.join(' | ')}`);
        must(issues.pageErrors.length === 0, `page errors: ${issues.pageErrors.join(' | ')}`);
        return `${controls.length} controls + a bare link: lift ${GEOMETRY.hover} → ${GEOMETRY.scaledLift}, press ${GEOMETRY.press} → ${GEOMETRY.pressOverridden}, shadow ${GEOMETRY.md} → ${GEOMETRY.scaledMd}`;
      }),
  ],
  [
    'the selected tab and the ghost zero the shared slots rather than cancelling a transform',
    async (browser, server) =>
      withPage(browser, server, async (page) => {
        await page.hover('#tab-2');
        const selected = await readGeometry(page, '#tab-2');
        must(selected.shadow === 'none', `a selected tab sits flat, read ${selected.shadow}`);
        must(
          selected.transform === 'matrix(1, 0, 0, 1, 0, 0)',
          `a selected tab zeroes its slots, so its matrix stays the identity, read ${selected.transform}`,
        );
        await page.hover('#ghost');
        const ghost = await readGeometry(page, '#ghost');
        must(ghost.shadow === 'none', `a hovered ghost paints no shadow, read ${ghost.shadow}`);
        must(
          ghost.transform === 'matrix(1, 0, 0, 1, 0, 0)',
          `a hovered ghost zeroes its slots, so its matrix stays the identity, read ${ghost.transform}`,
        );
        return 'selected tab and ghost: identity matrix, no shadow — no rule cancels a transform';
      }),
  ],
  [
    'a disabled control owns no geometry (the shared rule is guarded at the selector)',
    async (browser, server) =>
      withPage(browser, server, async (page) => {
        await page.hover('#disabled');
        const disabled = await readGeometry(page, '#disabled');
        must(
          disabled.transform === 'none',
          `a disabled control must not lift on hover, read ${disabled.transform}`,
        );
        must(disabled.shadow === GEOMETRY.md, `a disabled control keeps its structure, read ${disabled.shadow}`);
        return `disabled: ${disabled.transform} / ${disabled.shadow}`;
      }),
  ],
];

/** Browser checks need playwright-core; without it they skip loudly, exactly as ticket 04's do. */
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

/* ====================================== summary ====================================== */

console.log(`\n${checks - failures.length}/${checks} checks passed${skips ? `, ${skips} skipped` : ''}`);
if (failures.length > 0) {
  console.log('\nfailed:');
  for (const name of failures) console.log(`  - ${name}`);
  process.exit(1);
}
