#!/usr/bin/env node
/**
 * Scripted verification for ticket 01 — build chain and layer manifest.
 *
 * Every claim this ticket makes is checked here, so the checks are repeatable
 * instead of a one-off manual pass. The seams under test are public:
 *
 *   - the build command's exit status, stderr/stdout and the four artifacts it
 *     writes into static/
 *   - the exports of scripts/build.mjs (CSS_MANIFEST, LAYER_ORDER)
 *
 * The expected values below are the independent source of truth: they are
 * copied from spec.md §5 (file table), §12 (build chain) and ADR-0006
 * (cascade layer order) — never recomputed from the implementation.
 *
 * Run with: npm run verify   (or: node scripts/verify.mjs)
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const abs = (...parts) => path.join(ROOT, ...parts);

/* ---------------------------------- expectations ---------------------------------- */

/** ADR-0006: the layer order is a public contract. Append new layers at the end only. */
const EXPECTED_LAYER_ORDER = ['theme', 'base', 'components', 'animations', 'utilities'];
const EXPECTED_DECLARATION = `@layer ${EXPECTED_LAYER_ORDER.join(', ')};`;

/** spec.md §5: concatenation order, prefix = order. */
const EXPECTED_CSS_FILES = [
  '00-base.css',
  '01-theme.css',
  'animations.css',
  'button.css',
  'card.css',
  'badge.css',
  'alert.css',
  'form.css',
  'table.css',
  'dialog.css',
  'accordion.css',
  'progress.css',
  'spinner.css',
  'skeleton.css',
  'dropdown.css',
  'tabs.css',
  'taginput.css',
  'toast.css',
  'layout.css',
  'utilities.css',
];

/** spec.md §12: four published artifacts, the unminified one first in each pair. */
const ARTIFACTS = [
  'static/barnacle.css',
  'static/barnacle.min.css',
  'static/barnacle.js',
  'static/barnacle.min.js',
];

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

function runBuild() {
  const result = spawnSync(process.execPath, ['scripts/build.mjs'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return {
    status: result.status,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim(),
  };
}

function read(rel) {
  return readFileSync(abs(rel), 'utf8');
}

function firstLine(text) {
  return text.split('\n', 1)[0].replace(/\r$/, '');
}

function hashArtifacts() {
  const hashes = {};
  for (const rel of ARTIFACTS) {
    must(existsSync(abs(rel)), `${rel} is missing`);
    const bytes = readFileSync(abs(rel));
    must(bytes.length > 0, `${rel} is empty`);
    hashes[rel] = createHash('sha256').update(bytes).digest('hex');
  }
  return hashes;
}

/** Run a build with one source file temporarily mutated, then always restore it. */
function buildWithMutatedFile(rel, mutate) {
  const target = abs(rel);
  const original = readFileSync(target);
  try {
    const next = mutate(original.toString('utf8'));
    if (next === null) rmSync(target);
    else writeFileSync(target, next);
    return runBuild();
  } finally {
    writeFileSync(target, original);
  }
}

/* ------------------------------------ checks ------------------------------------ */

console.log(`barnacle build verification — ${ROOT}\n`);

await check('package.json exists with an empty dependencies object', () => {
  const pkg = JSON.parse(read('package.json'));
  must(
    pkg.dependencies !== undefined && typeof pkg.dependencies === 'object',
    'package.json must declare a "dependencies" object',
  );
  const deps = Object.keys(pkg.dependencies);
  must(deps.length === 0, `dependencies must be empty, found: ${deps.join(', ')}`);
  return 'dependencies = {}';
});

await check('esbuild is a devDependency and npm run build exists', () => {
  const pkg = JSON.parse(read('package.json'));
  const dev = pkg.devDependencies ?? {};
  must(dev.esbuild, 'esbuild must be in devDependencies');
  must(typeof pkg.scripts?.build === 'string', 'package.json must define a build script');
  must(typeof pkg.scripts?.verify === 'string', 'package.json must define a verify script');
  return `devDependencies.esbuild = ${dev.esbuild}`;
});

await check('.gitignore ignores dist/ and node_modules/', () => {
  const ignored = read('.gitignore')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  const covers = (dir) => ignored.some((line) => line.replace(/^\//, '').replace(/\/$/, '') === dir);
  must(covers('dist'), '.gitignore must ignore dist/');
  must(covers('node_modules'), '.gitignore must ignore node_modules/');
  return ignored.join(' ');
});

await check('build artifacts in static/ are not gitignored', () => {
  const result = spawnSync('git', ['check-ignore', ...ARTIFACTS], { cwd: ROOT, encoding: 'utf8' });
  must(result.status === 1 || result.status === 0, `git check-ignore failed: ${result.stderr}`);
  must(result.status === 1, `these artifacts are gitignored: ${result.stdout.trim()}`);
  return 'static/*.css and static/*.js are tracked';
});

let manifest = null;
let declaredLayerOrder = null;
await check('scripts/build.mjs exports a CSS manifest and layer order', async () => {
  const module = await import(pathToFileURL(abs('scripts/build.mjs')).href);
  must(Array.isArray(module.CSS_MANIFEST), 'CSS_MANIFEST must be an exported array');
  must(Array.isArray(module.LAYER_ORDER), 'LAYER_ORDER must be an exported array');
  manifest = module.CSS_MANIFEST;
  declaredLayerOrder = module.LAYER_ORDER;
  return `${manifest.length} entries, ${declaredLayerOrder.length} layers`;
});

await check('the declared layer order matches ADR-0006', () => {
  must(declaredLayerOrder, 'LAYER_ORDER was not exported');
  must(
    JSON.stringify(declaredLayerOrder) === JSON.stringify(EXPECTED_LAYER_ORDER),
    `expected ${EXPECTED_LAYER_ORDER.join(', ')}, got ${declaredLayerOrder.join(', ')}`,
  );
  return EXPECTED_DECLARATION;
});

await check('the manifest lists all 20 spec §5 files in order', () => {
  must(manifest, 'CSS_MANIFEST was not exported');
  const files = manifest.map((entry) => entry.file);
  must(
    JSON.stringify(files) === JSON.stringify(EXPECTED_CSS_FILES),
    `manifest order differs from spec §5:\n  expected ${EXPECTED_CSS_FILES.join(', ')}\n  actual   ${files.join(', ')}`,
  );
  return files.length === 20 ? '20 files, order matches' : `${files.length} files`;
});

await check('every manifest file exists and declares a layer in LAYER_ORDER', () => {
  const missing = [];
  const badLayers = [];
  const used = new Set();
  for (const entry of manifest) {
    if (!existsSync(abs('src/css', entry.file))) missing.push(entry.file);
    if (!EXPECTED_LAYER_ORDER.includes(entry.layer)) badLayers.push(`${entry.file} → ${entry.layer}`);
    used.add(entry.layer);
  }
  must(missing.length === 0, `missing on disk: ${missing.join(', ')}`);
  must(badLayers.length === 0, `unknown layer: ${badLayers.join(', ')}`);
  const unused = EXPECTED_LAYER_ORDER.filter((layer) => !used.has(layer));
  must(unused.length === 0, `layers declared but never used: ${unused.join(', ')}`);
  return `${manifest.length} files across ${used.size} layers`;
});

await check('the build succeeds and reports zero esbuild warnings', () => {
  const { status, output } = runBuild();
  must(status === 0, `build exited with ${status}:\n${output}`);
  const summary = output.split('\n').find((line) => /build ok:/.test(line));
  must(summary, `build did not print a summary line:\n${output}`);
  must(
    /0 warnings/.test(summary),
    `build reported warnings: ${summary}`,
  );
  const noise = output
    .split('\n')
    .filter((line) => !/build ok:/.test(line))
    .filter((line) => /warning/i.test(line));
  must(noise.length === 0, `build printed warnings:\n${noise.join('\n')}`);
  return summary.trim();
});

await check('no build tooling leaks into the artifacts', () => {
  for (const rel of ARTIFACTS) {
    const text = read(rel);
    must(!/node_modules|esbuild/.test(text), `${rel} references build tooling`);
  }
  return 'no esbuild / node_modules references in the four artifacts';
});

let baselineHashes = null;
await check('one build writes all four artifacts', () => {
  baselineHashes = hashArtifacts();
  const sizes = ARTIFACTS.map((rel) => `${path.basename(rel)}=${statSync(abs(rel)).size}B`);
  return sizes.join(' ');
});

await check('two consecutive builds are byte-identical', () => {
  must(baselineHashes, 'no baseline hashes');
  const { status, output } = runBuild();
  must(status === 0, `second build exited with ${status}:\n${output}`);
  const second = hashArtifacts();
  const drift = ARTIFACTS.filter((rel) => baselineHashes[rel] !== second[rel]);
  must(
    drift.length === 0,
    `these artifacts changed between builds: ${drift
      .map((rel) => `${rel} (${baselineHashes[rel].slice(0, 12)} → ${second[rel].slice(0, 12)})`)
      .join(', ')}`,
  );
  return Object.entries(second)
    .map(([rel, hash]) => `${path.basename(rel)}=${hash.slice(0, 12)}`)
    .join(' ');
});

await check('both minified artifacts are smaller than their sources', () => {
  for (const [full, min] of [
    ['static/barnacle.css', 'static/barnacle.min.css'],
    ['static/barnacle.js', 'static/barnacle.min.js'],
  ]) {
    must(
      statSync(abs(min)).size < statSync(abs(full)).size,
      `${min} (${statSync(abs(min)).size}B) is not smaller than ${full} (${statSync(abs(full)).size}B)`,
    );
  }
  return 'barnacle.min.css < barnacle.css, barnacle.min.js < barnacle.js';
});

await check('line 1 of static/barnacle.css is the @layer declaration', () => {
  const line = firstLine(read('static/barnacle.css'));
  must(line === EXPECTED_DECLARATION, `line 1 is ${JSON.stringify(line)}`);
  return line;
});

await check('line 1 of static/barnacle.min.css is still the @layer declaration', () => {
  const line = firstLine(read('static/barnacle.min.css'));
  must(
    line === EXPECTED_DECLARATION,
    `line 1 is ${JSON.stringify(line)}, expected the five layers in ADR-0006 order`,
  );
  must(
    line === firstLine(read('static/barnacle.css')),
    'the unminified and minified artifacts must share a byte-identical first line',
  );
  return line;
});

await check('the declaration appears only once in the artifact', () => {
  const text = read('static/barnacle.css');
  const occurrences = text.split('\n').filter((line) => line.trim() === EXPECTED_DECLARATION).length;
  must(occurrences === 1, `found ${occurrences} copies of the declaration`);
  return 'exactly one statement';
});

await check('IIFE artifacts contain no top-level import/export', () => {
  for (const rel of ['static/barnacle.js', 'static/barnacle.min.js']) {
    const text = read(rel);
    const statement = text.match(/^\s*(?:import|export)\b.*$/m);
    must(!statement, `${rel} contains a module statement: ${statement?.[0].trim()}`);
    must(/\(\(\)\s*=>|\(function\s*\(/.test(text), `${rel} is not wrapped in an IIFE`);
  }
  return 'both files are IIFE-wrapped with no ES module syntax';
});

await check('a missing manifest file fails the build and names the file', () => {
  const before = hashArtifacts();
  const { status, output } = buildWithMutatedFile('src/css/dialog.css', () => null);
  must(status !== 0, 'build succeeded even though src/css/dialog.css was deleted');
  must(/dialog\.css/.test(output), `build did not name the missing file:\n${output}`);
  const after = hashArtifacts();
  const drift = ARTIFACTS.filter((rel) => before[rel] !== after[rel]);
  must(drift.length === 0, `the failed build still rewrote: ${drift.join(', ')}`);
  return `exit ${status}: ${output.split('\n').find((line) => /dialog\.css/.test(line))?.trim()}`;
});

await check('a missing first-line @layer declaration fails the build', () => {
  const { status, output } = buildWithMutatedFile('src/css/00-base.css', (text) => `/* moved */\n${text}`);
  must(status !== 0, 'build succeeded even though the declaration was not on line 1');
  must(/00-base\.css/.test(output), `build did not name 00-base.css:\n${output}`);
  must(/@layer/.test(output), `build did not mention @layer:\n${output}`);
  return `exit ${status}: ${output.split('\n').find((line) => /@layer/.test(line))?.trim()}`;
});

await check('a source file declaring its own @layer fails the build', () => {
  const { status, output } = buildWithMutatedFile(
    'src/css/button.css',
    (text) => `@layer components { }\n${text}`,
  );
  must(status !== 0, 'build succeeded even though button.css declared its own @layer');
  must(/button\.css/.test(output), `build did not name button.css:\n${output}`);
  return `exit ${status}: ${output.split('\n').find((line) => /button\.css/.test(line))?.trim()}`;
});

await check('destructive probes left the artifacts byte-identical to the baseline', () => {
  const { status, output } = runBuild();
  must(status === 0, `rebuild exited with ${status}:\n${output}`);
  const restored = hashArtifacts();
  const drift = ARTIFACTS.filter((rel) => baselineHashes[rel] !== restored[rel]);
  must(drift.length === 0, `not restored: ${drift.join(', ')}`);
  return 'all four artifacts reproduce the baseline hashes';
});

/* ------------------------------------ summary ------------------------------------ */

console.log(`\n${checks - failures.length}/${checks} checks passed`);
if (failures.length > 0) {
  console.log('\nfailed:');
  for (const name of failures) console.log(`  - ${name}`);
  process.exit(1);
}
