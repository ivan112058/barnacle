#!/usr/bin/env node
/**
 * mutation-sweep.mjs — the non-vacuity proof for `tests/browser/`.
 *
 * A green test suite proves nothing on its own: an assertion that can never fail is
 * indistinguishable from a browser that satisfies every invariant. This script takes the
 * question the other way round — *can each assertion actually go red?* — by running the real
 * test files from `tests/browser/` against a deliberately broken copy of the artifact.
 *
 * How it stays safe and honest:
 *
 *   - it never touches `static/`: the artifact is copied into a fresh temporary directory and
 *     the copy is mutated there. The harness reads `BARNACLE_ARTIFACT_DIR`, so the same test
 *     files measure the mutant;
 *   - it runs exactly the command `package.json` runs for `test:browser`, so the evidence is
 *     evidence about the suite that ships, not about a parallel re-implementation;
 *   - every patch is **located**, not found by whole-file uniqueness. It names the `@layer` and
 *     the rule prelude the declaration lives in, and only then must the pattern occur exactly
 *     once *inside that rule*. Two components may legitimately spell a declaration the same way
 *     — since ticket 20 the `bn-tabs` hover rule is byte-identical to the button's — and a sweep
 *     that demanded a unique whole-file match turned that duplication into a hard stop: the third
 *     mutant threw, the remaining eight never ran, and the run still looked like a partial sweep
 *     rather than a broken one. Targeting the rule is the fix; pruning the mutant or skipping a
 *     non-unique pattern is not;
 *   - a mutant that leaves the artifact byte-identical is a failure, so a stale locator cannot
 *     ever pass as a mutation, and a mutant whose suite stays green is a failure too;
 *   - each mutant declares which test must fail, which invariant name must appear in the
 *     output, and which unrelated tests must stay green — so "everything went red" cannot pass
 *     as targeting, and "nothing went red" cannot pass as green;
 *   - every mutant is listed as executed or not at the end of the run, and the real artifact's
 *     sha256 is compared before and after the whole run.
 *
 * Run: npm run test:browser:mutations   (or: node tests/browser/mutation-sweep.mjs)
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ARTIFACT_DIR, ROOT } from './harness.mjs';

/**
 * The exact declaration each mutant breaks, and what the suite is expected to say about it.
 *
 * `patch.rule` is the prelude of the rule the declaration lives in (`patch.layer` narrows the
 * search to the blocks inside `@layer <name>`, which matters because one source file per
 * component means the artifact repeats `@layer components` many times). A body patch is located
 * by the declaration it contains; a `target: 'prelude'` patch, whose pattern *is* the shared
 * prelude, names its own `contains` discriminator instead. `append` and `atFileStart` are the two
 * patches that are not about a rule at all.
 */
const MUTATIONS = [
  {
    id: 'blur-not-zero',
    invariant: 'spec §3.2',
    why: 'the md tier grows a 1px blur — the hard shadow becomes a soft one',
    patch: {
      layer: 'theme',
      rule: ':root',
      from: '--bn-shadow-md: var(--bn-shadow-x) var(--bn-shadow-y) 0 0 var(--bn-shadow-color);',
      to: '--bn-shadow-md: var(--bn-shadow-x) var(--bn-shadow-y) 1px 0 var(--bn-shadow-color);',
    },
    mustFail: ['spec §3.2 — the hard shadow keeps a zero blur and a zero spread'],
    mustMention: 'spec §3.2 — the hard shadow blur radius is 0',
    // Insensitive by construction: the lg tier carries its own `0` blur, and §3.7 reads border
    // widths only. A mutation that reddened these too would mean the assertions are not targeted.
    mustPass: [
      'spec §3.3 — hover lifts the object by exactly the amount the shadow grows',
      'spec §3.7 — hover may change a colour but never a border width',
    ],
  },
  {
    id: 'lift-written-as-a-literal',
    invariant: 'spec §3.3',
    why: '--bn-shadow-lift stops deriving from --bn-shadow-x, so the displacement and the shadow growth disagree',
    patch: {
      layer: 'theme',
      rule: ':root',
      from: '--bn-shadow-lift: calc(var(--bn-shadow-x) / 2);',
      to: '--bn-shadow-lift: 3px;',
    },
    mustFail: ['spec §3.3 — hover lifts the object by exactly the amount the shadow grows'],
    mustMention: 'spec §3.3 — the displacement distance is --bn-shadow-lift',
    mustPass: [
      'spec §3.2 — the hard shadow keeps a zero blur and a zero spread',
      'spec §3.7 — hover may change a colour but never a border width',
    ],
  },
  {
    id: 'hover-changes-a-border-width',
    invariant: 'spec §3.7',
    why: 'the hover rule adds a border width, i.e. the grid reflows under the mouse',
    patch: {
      // The button's hover rule, not "the first rule in the file that contains this transform":
      // since ticket 20 `bn-tabs [role="tab"]:…:hover` carries the identical declaration.
      layer: 'components',
      rule: ':is(button, .bn-button):not(:disabled):not([aria-disabled="true"]):hover',
      from: '    transform: translate(var(--_lift-x), var(--_lift-y));',
      to: '    transform: translate(var(--_lift-x), var(--_lift-y));\n    border-width: calc(var(--bn-border-width) + 1px);',
    },
    mustFail: ['spec §3.7 — hover may change a colour but never a border width'],
    mustMention: 'spec §3.7 — hover must not change borderTopWidth',
    mustPass: [
      'spec §3.2 — the hard shadow keeps a zero blur and a zero spread',
      'spec §3.3 — hover lifts the object by exactly the amount the shadow grows',
    ],
  },
  {
    id: 'focus-ring-removed',
    invariant: 'spec §7',
    why: 'the focus ring token resolves to none — the WCAG F78 regression the library forbids',
    patch: {
      layer: 'base',
      rule: ':root',
      from: '--_focus-ring: 3px solid var(--bn-ring);',
      to: '--_focus-ring: none;',
    },
    mustFail: ['spec §7 — a real Tab paints a 3px offset outline and the hard shadow survives it'],
    // outlineStyle, not outlineWidth: `outline: none` still computes a width of 3px (the initial
    // `medium`), which is exactly why the style and the colour have to be asserted as well.
    mustMention: 'spec §7 — the focus ring is an outline and the hard shadow survives it: outlineStyle',
    mustPass: [
      'spec §3.2 — the hard shadow keeps a zero blur and a zero spread',
      'ADR-0004 — a system dark preference must not switch the theme',
    ],
  },
  {
    id: 'important-in-a-layer',
    invariant: 'ADR-0006',
    why: 'an !important layered declaration outranks the unlayered user rule — the only way a shipped layer regains priority over unlayered CSS',
    patch: {
      layer: 'components',
      rule: ':is(button, .bn-button)',
      from: '  background: var(--_surface);',
      to: '  background: var(--_surface) !important;',
    },
    mustFail: ['ADR-0006 — an unlayered user rule beats every layer the library ships'],
    mustMention: 'ADR-0006 — an unlayered user rule wins over the components layer',
    mustPass: ['ADR-0006 — inside one layer, specificity decides (the control for the case above)'],
  },
  {
    id: 'follows-the-system-dark-preference',
    invariant: 'ADR-0004',
    why: 'a prefers-color-scheme media query appears — the theme silently follows the system',
    patch: {
      append: '\n@media (prefers-color-scheme: dark) { :root { --bn-background: #1A1A1A; } }\n',
    },
    mustFail: ['ADR-0004 — a system dark preference must not switch the theme'],
    mustMention: 'ADR-0004 — the page stays light with no data-theme',
    mustPass: ['orchestrator §8 — data-theme on <html> flips the hard shadow, on <body> it cannot'],
  },
  {
    id: 'tier-hardcoded',
    invariant: 'spec §6',
    why: 'the md tier is written as a literal, so overriding --bn-shadow-x no longer rescales it',
    patch: {
      layer: 'theme',
      rule: ':root',
      from: '--bn-shadow-md: var(--bn-shadow-x) var(--bn-shadow-y) 0 0 var(--bn-shadow-color);',
      to: '--bn-shadow-md: 4px 4px 0 0 var(--bn-shadow-color);',
    },
    mustFail: ['spec §6 — one token on <html> rescales every shadow tier, and only on <html>'],
    mustMention: 'spec §6 — one token rescales the md tier',
    mustPass: ['spec §3.2 — the hard shadow keeps a zero blur and a zero spread'],
  },
  {
    id: 'motion-guard-inverted',
    invariant: 'spec §7',
    why: 'the transitions are declared only where motion is reduced — the guard, backwards',
    patch: {
      // The button's motion block out of the ten `prefers-reduced-motion` blocks in the artifact:
      // the nested `:is(button, .bn-button)` rule is what tells it apart from the tabs/table/
      // toast/dropdown ones. Mutating any other block would leave the button's transition intact
      // and the mutant would be green — a false "not captured".
      layer: 'components',
      rule: '@media (prefers-reduced-motion: no-preference)',
      contains: ':is(button, .bn-button)',
      target: 'prelude',
      from: '@media (prefers-reduced-motion: no-preference)',
      to: '@media (prefers-reduced-motion: reduce)',
    },
    mustFail: ['spec §7 — the reduced-motion guard removes the motion and changes nothing else'],
    mustMention: 'spec §7 — with reduced motion no transition is declared at all',
    mustPass: ['spec §3.2 — the hard shadow keeps a zero blur and a zero spread'],
  },
  {
    id: 'dark-shadow-colour-not-repainted',
    invariant: 'orchestrator §8',
    why: 'the dark theme forgets to repaint --bn-shadow-color, so the hard shadow stays black on a dark page',
    patch: {
      layer: 'theme',
      rule: '[data-theme="dark"]',
      from: '  --bn-shadow-color: #FFFDF5;',
      to: '  --bn-shadow-color: #000000;',
    },
    mustFail: ['orchestrator §8 — data-theme on <html> flips the hard shadow, on <body> it cannot'],
    mustMention: 'orchestrator §8 — html[data-theme="dark"] repaints the hard shadow in the dark ink',
    mustPass: ['ADR-0004 — a system dark preference must not switch the theme'],
  },
  {
    id: 'derivation-moved-onto-the-component',
    invariant: 'orchestrator §8',
    why: 'the button resolves the shadow tokens on itself, so a data-theme on <body> can now repaint the hard shadow white',
    patch: {
      layer: 'components',
      rule: ':is(button, .bn-button)',
      from: '  box-shadow: var(--_shadow-rest);',
      to: '  box-shadow: var(--bn-shadow-x) var(--bn-shadow-y) 0 0 var(--bn-shadow-color);',
    },
    mustFail: ['orchestrator §8 — data-theme on <html> flips the hard shadow, on <body> it cannot'],
    mustMention: 'orchestrator §8 — but body[data-theme="dark"] cannot repaint the shadow chain',
    // §3.3 compares the *hover* (lg) tier and the offsets, both of which are unchanged by moving
    // the resting declaration onto the component; §3.7 reads border widths.
    mustPass: [
      'spec §3.3 — hover lifts the object by exactly the amount the shadow grows',
      'spec §3.7 — hover may change a colour but never a border width',
    ],
  },
  {
    id: 'layer-declaration-dropped',
    invariant: 'ADR-0006',
    why: 'line 1 of the artifact loses the layer declaration — the public layer order is gone',
    patch: {
      atFileStart: true,
      from: '@layer theme, base, components, animations, utilities;\n',
      to: '',
    },
    mustFail: ['ADR-0006 — the page really loaded the shipped artifact, from the site subpath'],
    mustMention: 'ADR-0006 — the loaded artifact declares the layer order, and declares it first',
    mustPass: [
      'ADR-0006 — an unlayered user rule beats every layer the library ships',
      'spec §3.2 — the hard shadow keeps a zero blur and a zero spread',
    ],
  },
];

/* --------------------------------------------------------------------------------------------
 * Locating the rule a mutant breaks
 * ------------------------------------------------------------------------------------------ */

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** CSS with its comments removed: a selector or declaration quoted in a comment is prose. */
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** A rule prelude as it is compared: comments gone, whitespace collapsed. */
const normalizePrelude = (prelude) => stripComments(prelude).replace(/\s+/g, ' ').trim();

/** 1-based line number of an offset, so a locator failure points at a place a person can open. */
const lineOf = (text, offset) => text.slice(0, offset).split('\n').length;

/** Skip a quoted string, honouring backslash escapes; returns the index of its closing quote. */
function skipString(text, start) {
  const quote = text[start];
  for (let i = start + 1; i < text.length; i += 1) {
    if (text[i] === '\\') {
      i += 1;
      continue;
    }
    if (text[i] === quote) return i;
  }
  throw new Error(`unterminated string starting at offset ${start}`);
}

/** The index of the `}` matching the `{` at `open`; strings and comments are opaque to it. */
function matchBrace(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text.startsWith('/*', i)) {
      const close = text.indexOf('*/', i + 2);
      if (close === -1) throw new Error(`unterminated comment at offset ${i}`);
      i = close + 1;
      continue;
    }
    const character = text[i];
    if (character === '"' || character === "'") {
      i = skipString(text, i);
      continue;
    }
    if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error(`unbalanced braces: no "}" matches the "{" at offset ${open}`);
}

/**
 * Every `{ … }` block of a stylesheet, at any depth, with the (normalised) preludes that enclose
 * it. `preludeStart` is where the block's own prelude begins — after the previous sibling, so it
 * can carry leading comments — and `bodyStart`/`bodyEnd` delimit the inside of the braces.
 *
 * A scanner rather than a regex because the artifact nests at-rules (`@layer components` holding
 * `@media (hover: hover)` holding a selector) and a flat `selector { body }` regex reads the
 * outer brace pair as one rule, which is exactly how "the selector appears twice" goes unnoticed.
 */
function collectBlocks(text) {
  const blocks = [];
  const walk = (start, end, ancestors) => {
    let i = start;
    let preludeStart = start;
    while (i < end) {
      if (text.startsWith('/*', i)) {
        const close = text.indexOf('*/', i + 2);
        i = close === -1 ? end : close + 2;
        continue;
      }
      const character = text[i];
      if (character === '"' || character === "'") {
        i = skipString(text, i) + 1;
        continue;
      }
      if (character === '}') break;
      if (character === ';') {
        // A statement that ends with `;` (the artifact's `@layer theme, base, …;` line, or a
        // declaration) starts no block, so the next prelude begins after it. Without this the
        // first block of the file inherits the whole header as its prelude and `@layer base`
        // never compares equal to anything.
        i += 1;
        preludeStart = i;
        continue;
      }
      if (character === '{') {
        const bodyEnd = matchBrace(text, i);
        const prelude = normalizePrelude(text.slice(preludeStart, i));
        blocks.push({ prelude, preludeStart, bodyStart: i + 1, bodyEnd, ancestors });
        walk(i + 1, bodyEnd, [...ancestors, prelude]);
        i = bodyEnd + 1;
        preludeStart = i;
        continue;
      }
      i += 1;
    }
  };
  walk(0, text.length, []);
  return blocks;
}

/**
 * The one block a mutant targets. A body patch selects by `rule` **and** by the declaration it
 * must contain, so `:is(button, .bn-button)` resolves to the button's resting rule rather than to
 * the identically-preluded rule inside its own motion block. A `target: 'prelude'` patch selects
 * by `contains` instead, because its pattern is the shared prelude itself.
 *
 * Zero or several candidates is a hard error, not a skip: the locator is part of the evidence.
 */
function locateBlock(text, mutation) {
  const { rule, layer, contains, target = 'body', from } = mutation.patch;
  const wanted = normalizePrelude(rule);
  const needle = contains ?? (target === 'body' ? from.trim() : null);
  if (target === 'prelude' && !needle) {
    throw new Error(`mutation "${mutation.id}": a prelude patch needs a "contains" discriminator`);
  }
  const layerPrelude = layer ? `@layer ${layer}` : null;
  const candidates = collectBlocks(text).filter(
    (block) =>
      block.prelude === wanted &&
      (!layerPrelude || block.ancestors.includes(layerPrelude)) &&
      (!needle || text.slice(block.bodyStart, block.bodyEnd).includes(needle)),
  );

  const where = `${layerPrelude ? `${layerPrelude} › ` : ''}${wanted}`;
  if (candidates.length !== 1) {
    const found = candidates.map((block) => `line ${lineOf(text, block.preludeStart)}`).join(', ');
    throw new Error(
      `mutation "${mutation.id}": ${candidates.length} block(s) match ${where}` +
        `${needle ? ` containing ${JSON.stringify(needle)}` : ''}${found ? ` (${found})` : ''}, expected exactly 1. ` +
        'Update the locator; do not prune the mutation or skip it.',
    );
  }
  return candidates[0];
}

/** A human-readable locator, printed for each mutant so the evidence names its target. */
function describePatch(mutation) {
  const { append, atFileStart, rule, layer, contains, target = 'body' } = mutation.patch;
  if (append) return 'appended at the end of the artifact';
  if (atFileStart) return 'the first statement of the artifact';
  const where = `${layer ? `@layer ${layer} › ` : ''}${normalizePrelude(rule)}${target === 'prelude' ? ' (its prelude)' : ''}`;
  return contains ? `${where}, containing ${JSON.stringify(contains)}` : where;
}

/** Apply one mutant to the artifact text. Exactly-once is required *inside the located rule*. */
function applyPatch(text, mutation) {
  const { append, atFileStart, from, to, target = 'body' } = mutation.patch;
  if (append) return text + append;
  if (atFileStart) {
    if (!text.startsWith(from)) {
      throw new Error(
        `mutation "${mutation.id}": the artifact does not start with:\n  ${JSON.stringify(from)}`,
      );
    }
    return to + text.slice(from.length);
  }

  const block = locateBlock(text, mutation);
  const zone =
    target === 'prelude'
      ? { start: block.preludeStart, end: block.bodyStart - 1 }
      : { start: block.bodyStart, end: block.bodyEnd };
  const region = text.slice(zone.start, zone.end);
  const occurrences = region.split(from).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `mutation "${mutation.id}": the pattern occurs ${occurrences} times inside the located ${target}, expected exactly 1:\n  ${JSON.stringify(from)}`,
    );
  }
  return text.slice(0, zone.start) + region.replace(from, to) + text.slice(zone.end);
}

/* --------------------------------------------------------------------------------------------
 * Running one mutant
 * ------------------------------------------------------------------------------------------ */

/** The command `npm run test:browser` runs — read from package.json, so the two cannot drift. */
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const [testBin, ...testArgs] = pkg.scripts['test:browser'].split(' ');

/**
 * Test names from node:test's spec reporter, read out of the `failing tests:` section.
 *
 * Only that section is parsed: the progress lines report suites as well as tests, and a suite
 * name would make "which assertion caught this" ambiguous. File-level load failures appear in
 * the same section as `test at <file>:1:1`, and are dropped by the `.mjs` filter.
 */
function failedTests(output) {
  const lines = output.split(/\r?\n/);
  const start = lines.findIndex((line) => /^✖ failing tests:/.test(line.trim()));
  const names = new Set();
  for (let i = start === -1 ? 0 : start; i < lines.length; i += 1) {
    if (!/^\s*test at /.test(lines[i])) continue;
    for (let j = i + 1; j < lines.length; j += 1) {
      const match = /^\s*✖ (.+?)(?: \(\d[\d.]*ms\))?$/.exec(lines[j]);
      if (match) {
        if (!match[1].endsWith('.mjs')) names.add(match[1]);
        break;
      }
    }
  }
  return [...names];
}

/** The first five-line report the assertion helper prints, for the written record. */
function firstInvariantReport(output) {
  const lines = output.split(/\r?\n/);
  const start = lines.findIndex((line) => line.includes('✗ invariant failed:'));
  return start === -1 ? '<none>' : lines.slice(start, start + 6).join('\n');
}

function runSuite(artifactDir) {
  const result = spawnSync(testBin, testArgs, {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, BARNACLE_ARTIFACT_DIR: artifactDir },
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  return { status: result.status, output };
}

/* --------------------------------------------------------------------------------------------
 * The sweep
 * ------------------------------------------------------------------------------------------ */

const realCss = path.join(ARTIFACT_DIR, 'barnacle.css');
const beforeHash = sha256(realCss);
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'barnacle-mutation-sweep-'));
const results = [];
let failures = 0;

console.log(`barnacle browser-harness mutation sweep`);
console.log(`  suite   : ${testBin} ${testArgs.join(' ')}`);
console.log(`  artifact: ${realCss} (sha256 ${beforeHash.slice(0, 16)}…)`);
console.log(`  mutants : ${tempRoot}\n`);

/*
 * Preflight: every locator has to resolve and actually change the artifact before a single
 * browser is launched. A stale locator then costs a second instead of a sweep, and the exact
 * mutant that failed is named instead of the sweep stopping halfway with no manifest.
 */
const preflight = MUTATIONS.map((mutation) => {
  const text = fs.readFileSync(realCss, 'utf8');
  const mutant = applyPatch(text, mutation);
  if (mutant === text) {
    throw new Error(`mutation "${mutation.id}": the patch left the artifact byte-identical — it mutated nothing`);
  }
  const hash = crypto.createHash('sha256').update(mutant).digest('hex');
  console.log(`  locate ${mutation.id.padEnd(34)} ${describePatch(mutation)} → ${hash.slice(0, 12)}…`);
  return { id: mutation.id, hash };
});
console.log(`\n  preflight ok: ${preflight.length}/${MUTATIONS.length} locators resolve, every mutant differs from the artifact\n`);

try {
  for (const mutation of MUTATIONS) {
    const dir = path.join(tempRoot, mutation.id);
    fs.cpSync(ARTIFACT_DIR, dir, { recursive: true });
    const artifact = path.join(dir, 'barnacle.css');
    const originalText = fs.readFileSync(artifact, 'utf8');
    const mutantText = applyPatch(originalText, mutation);
    if (mutantText === originalText) {
      throw new Error(`mutation "${mutation.id}": the patch left the artifact byte-identical — it mutated nothing`);
    }
    fs.writeFileSync(artifact, mutantText);
    const mutantHash = sha256(artifact);

    const { status, output } = runSuite(dir);
    const failed = failedTests(output);
    const problems = [];

    if (status === 0) problems.push('the suite stayed GREEN');
    for (const name of mutation.mustFail) {
      if (!failed.includes(name)) problems.push(`expected this test to fail, it did not: ${name}`);
    }
    if (!output.includes(mutation.mustMention)) {
      problems.push(`the invariant "${mutation.mustMention}" is not named in the output`);
    }
    for (const name of mutation.mustPass) {
      if (failed.includes(name)) problems.push(`this test should have stayed green: ${name}`);
    }

    const verdict = problems.length === 0 ? 'RED as designed' : 'SWEEP FAILED';
    if (problems.length > 0) failures += 1;
    results.push({ mutation, failed, problems, output, verdict, mutantHash });

    console.log(`${problems.length === 0 ? 'PASS' : 'FAIL'}  ${mutation.id} [${mutation.invariant}] — ${verdict}`);
    console.log(`      why        : ${mutation.why}`);
    console.log(`      locator    : ${describePatch(mutation)}`);
    console.log(`      mutant     : sha256 ${mutantHash.slice(0, 16)}… (artifact ${beforeHash.slice(0, 16)}…)`);
    console.log(`      went red   : ${failed.join(' | ') || '<nothing>'}`);
    for (const problem of problems) console.log(`      problem    : ${problem}`);
    console.log(`      report     :\n${firstInvariantReport(output).replace(/^/gm, '        ')}`);
    console.log('');
  }

  // Every mutant must have been *executed*, not merely declared. The failure this replaces was a
  // throw on the third patch: eight mutants never ran, and nothing in the output said so.
  const missing = MUTATIONS.filter((mutation) => !results.some((result) => result.mutation.id === mutation.id));
  if (missing.length > 0) {
    failures += 1;
    console.log(`FAIL  ${missing.length} mutant(s) were never executed: ${missing.map((m) => m.id).join(', ')}\n`);
  }

  console.log(`mutant manifest — executed ${results.length}/${MUTATIONS.length}:`);
  for (const result of results) {
    const captured = result.verdict === 'RED as designed' ? result.mutation.mustFail.join(' | ') : '<not captured>';
    const where = describePatch(result.mutation);
    console.log(`  ${result.verdict === 'RED as designed' ? 'PASS' : 'FAIL'}  ${result.mutation.id}`);
    console.log(`        target : ${where}`);
    console.log(`        caught : ${captured}`);
  }
  const capturedCount = results.filter((result) => result.verdict === 'RED as designed').length;
  console.log(`\nexecuted ${results.length}/${MUTATIONS.length} mutants, captured ${capturedCount}/${MUTATIONS.length} as designed\n`);

  // The green half of the same picture: the untouched artifact, run by the same command.
  const green = runSuite(ARTIFACT_DIR);
  const greenFailed = failedTests(green.output);
  const greenOk = green.status === 0 && greenFailed.length === 0;
  if (!greenOk) failures += 1;
  console.log(`${greenOk ? 'PASS' : 'FAIL'}  unmutated-artifact — the suite is green when nothing is broken`);
  console.log(`      went red   : ${greenFailed.join(' | ') || '<nothing>'}\n`);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

const afterHash = sha256(realCss);
if (afterHash !== beforeHash) {
  failures += 1;
  console.log(`FAIL  the committed artifact changed during the sweep: ${beforeHash} -> ${afterHash}`);
} else {
  console.log(`PASS  static/barnacle.css untouched (sha256 ${afterHash.slice(0, 16)}…)\n`);
}

console.log(`${MUTATIONS.length} mutants + 1 unmutated control, ${failures === 0 ? 'all as designed' : `${failures} unexpected`}`);
process.exitCode = failures === 0 ? 0 : 1;
