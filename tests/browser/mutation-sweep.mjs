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
 *   - every patch is required to match the artifact **exactly once**; a refactor that moves a
 *     declaration makes this script fail loudly instead of silently mutating nothing;
 *   - each mutant declares which test must fail, which invariant name must appear in the
 *     output, and which unrelated tests must stay green — so "everything went red" cannot pass
 *     as targeting, and "nothing went red" cannot pass as green;
 *   - the real artifact's sha256 is compared before and after the whole run.
 *
 * Run: npm run test:browser:mutations   (or: node tests/browser/mutation-sweep.mjs)
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ARTIFACT_DIR, ROOT } from './harness.mjs';

/** The exact declaration each mutant breaks, and what the suite is expected to say about it. */
const MUTATIONS = [
  {
    id: 'blur-not-zero',
    invariant: 'spec §3.2',
    why: 'the md tier grows a 1px blur — the hard shadow becomes a soft one',
    patch: {
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
      from: '@media (prefers-reduced-motion: no-preference) {',
      to: '@media (prefers-reduced-motion: reduce) {',
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
 * Running one mutant
 * ------------------------------------------------------------------------------------------ */

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

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

function applyPatch(text, mutation) {
  if (mutation.patch.append) return text + mutation.patch.append;
  const { from, to } = mutation.patch;
  const occurrences = text.split(from).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `mutation "${mutation.id}": the pattern occurs ${occurrences} times in the artifact, expected exactly 1:\n  ${from}`,
    );
  }
  return text.replace(from, to);
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

try {
  for (const mutation of MUTATIONS) {
    const dir = path.join(tempRoot, mutation.id);
    fs.cpSync(ARTIFACT_DIR, dir, { recursive: true });
    const artifact = path.join(dir, 'barnacle.css');
    fs.writeFileSync(artifact, applyPatch(fs.readFileSync(artifact, 'utf8'), mutation));

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
    results.push({ mutation, failed, problems, output, verdict });

    console.log(`${problems.length === 0 ? 'PASS' : 'FAIL'}  ${mutation.id} [${mutation.invariant}] — ${verdict}`);
    console.log(`      why        : ${mutation.why}`);
    console.log(`      went red   : ${failed.join(' | ') || '<nothing>'}`);
    for (const problem of problems) console.log(`      problem    : ${problem}`);
    console.log(`      report     :\n${firstInvariantReport(output).replace(/^/gm, '        ')}`);
    console.log('');
  }

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
