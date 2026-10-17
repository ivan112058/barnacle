#!/usr/bin/env node
/**
 * Scripted verification for ticket 02 — seite site skeleton.
 *
 * The four verification methods in .scratch/barnacle-design/issues/02-site-skeleton.md are
 * the specification of this file; each one is a check below, made repeatable instead of a
 * one-off manual pass:
 *
 *   1. `seite build` passes, `seite check` reports no broken-link / missing-asset
 *   2. the four published artifacts are byte-identical between static/ and dist/static/
 *   3. the repository-root AGENTS.md is byte-identical to the pre-ticket blob
 *   4. what `seite init` actually writes is recorded, and only .seite/ was taken from it
 *
 * The expected values are the independent source of truth: spec.md §4 (layout), §10 (docs
 * site), §12 (build & deploy), and the measured seite 0.20.1 behaviour in
 * D:\code\barnacle-notes\seite-findings.md. They are never recomputed from the site files.
 *
 * Run with: node scripts/verify-site.mjs
 * Options:  --no-serve   skip the local-preview check
 *           --minify-experiment  build with minify = false and true, compare, restore
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reserveFreePort } from './lib/server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const abs = (...parts) => path.join(ROOT, ...parts);

/* ------------------------------------ expectations ----------------------------------- */

/** spec.md §12: project site on a sub-path, written without a trailing slash. */
const EXPECTED_BASE_URL = 'https://ivan112058.github.io/barnacle';
const EXPECTED_BASE_PATH = '/barnacle';
/** base_url is origin + base_path; the origin alone is what a host serves from. */
const EXPECTED_ORIGIN = EXPECTED_BASE_URL.slice(0, -EXPECTED_BASE_PATH.length);

/** spec.md §12: the four published artifacts, unminified first in each pair. */
const ARTIFACTS = [
  'static/barnacle.css',
  'static/barnacle.min.css',
  'static/barnacle.js',
  'static/barnacle.min.js',
];

/** seite-findings §2.2: a collection without all four fields is rejected by seite. */
const REQUIRED_COLLECTION_FIELDS = ['name', 'label', 'directory', 'default_template'];

/** spec.md §4 + the three measured deviations recorded in the ticket Answer. */
const CONTENT_FILES = [
  'content/pages/index.md',
  'content/pages/usage.md',
  'content/pages/customizing.md',
  'content/components/index.md',
];
const TEMPLATE_FILES = [
  'templates/base.html',
  'templates/index.html',
  'templates/page.html',
  'templates/components-index.html',
  'templates/component.html',
];

/** Files `seite init` writes that must never reach this repository (ticket scaffold rule). */
const SCAFFOLD_PATHS = [
  'CLAUDE.md',
  '.mcp.json',
  '.claude',
  '.cursor',
  '.codex',
  'opencode.json',
  '.agents',
];

/** Page assets must never be root-absolute: /static/... 404s on a project site (§8.2). */
const ROOT_ABSOLUTE_ASSET = /^(?:href|src)="\/static\//;

/* -------------------------------------- harness -------------------------------------- */

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

function read(rel) {
  return fs.readFileSync(abs(rel), 'utf8');
}

function bytes(rel) {
  return fs.readFileSync(abs(rel));
}

function sha(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function locateSeite() {
  const candidates = [process.env.SEITE_BIN, 'D:\\sdk\\seite\\seite.exe', 'seite'].filter(Boolean);
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
    if (probe.status === 0) return { bin: candidate, version: (probe.stdout ?? '').trim() };
  }
  return null;
}

function runSeite(args, options = {}) {
  const result = spawnSync(SEITE.bin, args, {
    cwd: options.cwd ?? ROOT,
    encoding: 'utf8',
    timeout: options.timeout ?? 120_000,
    env: { ...process.env, SEITE_YES: '1' },
  });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  return { status: result.status, stdout, stderr, output: `${stdout}${stderr}`.trim() };
}

function git(args) {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'buffer' });
  return { status: result.status, out: result.stdout ?? Buffer.alloc(0) };
}

/** The branch this ticket is based on; HEAD is the fallback for a detached checkout. */
function referenceRef() {
  for (const ref of ['feat/barnacle-v1', 'HEAD']) {
    if (git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).status === 0) return ref;
  }
  return null;
}

/* ------------------------------- filesystem / link helpers ---------------------------- */

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const rel = (full) => path.relative(ROOT, full).split(path.sep).join('/');

/** Resolve a site-internal URL path against dist/ the way a static host would. */
function resolveInDist(urlPath) {
  const dist = abs('dist');
  let target = decodeURI(urlPath.split(/[?#]/)[0]);
  if (target.startsWith(EXPECTED_BASE_PATH)) target = target.slice(EXPECTED_BASE_PATH.length);
  if (target === '' || target === '/') return path.join(dist, 'index.html');
  const candidate = path.join(dist, target);
  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  const asIndex = path.join(candidate, 'index.html');
  if (fs.existsSync(asIndex)) return asIndex;
  const asHtml = `${candidate}.html`;
  if (fs.existsSync(asHtml)) return asHtml;
  return null;
}

function attributeUrls(html) {
  return [...html.matchAll(/(?:href|src)="([^"]*)"/g)].map((match) => match[1]);
}

/* ------------------------------------- shared state ----------------------------------- */

const SEITE = locateSeite();
if (!SEITE) {
  console.error('seite CLI not found. Set SEITE_BIN or install seite 0.20.1.');
  process.exit(1);
}

const argv = process.argv.slice(2);
const SKIP_SERVE = argv.includes('--no-serve');
const MINIFY_EXPERIMENT = argv.includes('--minify-experiment');

console.log(`barnacle site verification — ${ROOT}`);
console.log(`CLI: ${SEITE.version} at ${SEITE.bin}\n`);

let buildResult = null;
let checkResult = null;
let initProbe = null;

/* ============================ verification method 1: build + check ==================== */

await check('seite build exits 0', () => {
  buildResult = runSeite(['build', '--dir', ROOT]);
  must(buildResult.status === 0, `exit ${buildResult.status}:\n${buildResult.output}`);
  const summary = buildResult.output.split('\n').find((line) => /Built\b/.test(line));
  must(summary, `no build summary in:\n${buildResult.output}`);
  return summary.trim();
});

await check('seite build reports no broken link or missing asset', () => {
  must(buildResult, 'build did not run');
  const lines = buildResult.output.split('\n').filter((line) => /\b(broken|missing)\b/i.test(line));
  must(lines.length === 0, `build output mentions broken links / missing assets:\n${lines.join('\n')}`);
  const noise = buildResult.output.split('\n').filter((line) => /pre-tracking/i.test(line));
  must(noise.length === 0, `build still reports pre-tracking config noise: ${noise.join(' ')}`);
  return 'clean build output';
});

await check('seite check --strict exits 0 with no warnings', () => {
  checkResult = runSeite(['check', '--dir', ROOT, '--strict']);
  must(checkResult.status === 0, `exit ${checkResult.status}:\n${checkResult.output}`);
  const clean = checkResult.output.split('\n').find((line) => /No problems found|No errors/.test(line));
  must(clean, `no clean-check summary in:\n${checkResult.output}`);
  must(
    !/\bwarning|broken|missing\b/i.test(checkResult.output),
    `check reported problems:\n${checkResult.output}`,
  );
  return clean.trim();
});

await check('seite.toml declares the project-site base_url and minify = false', () => {
  const toml = read('seite.toml');
  const baseUrl = toml.match(/^base_url\s*=\s*"([^"]*)"/m);
  must(baseUrl, 'seite.toml has no base_url');
  must(baseUrl[1] === EXPECTED_BASE_URL, `base_url is ${baseUrl[1]}`);
  const minify = toml.match(/^minify\s*=\s*(\w+)/m);
  must(minify, 'seite.toml has no minify setting');
  must(
    minify[1] === 'false',
    `minify must stay false so seite cannot rewrite the published artifacts (found ${minify[1]})`,
  );
  return `base_url = ${EXPECTED_BASE_URL}, minify = false`;
});

await check('seite.toml declares every collection with the four required fields', () => {
  const toml = read('seite.toml');
  const blocks = toml.split(/^\[\[collections\]\]$/m).slice(1);
  must(blocks.length === 2, `expected the pages and components collections, found ${blocks.length}`);
  const names = [];
  for (const block of blocks) {
    for (const field of REQUIRED_COLLECTION_FIELDS) {
      must(new RegExp(`^${field}\\s*=`, 'm').test(block), `a collection block is missing ${field}`);
    }
    names.push(block.match(/^name\s*=\s*"([^"]*)"/m)[1]);
  }
  must(names.includes('components'), `no components collection in ${names.join(', ')}`);
  must(names.includes('pages'), `no pages collection in ${names.join(', ')}`);
  const components = blocks.find((block) => /^name\s*=\s*"components"/m.test(block));
  must(
    /^directory\s*=\s*"components"/m.test(components),
    'the components collection must own content/components',
  );
  must(
    /^default_template\s*=\s*"component\.html"/m.test(components),
    'the components collection must use the root-level component.html template',
  );
  return `${names.join(', ')}; components → content/components → component.html`;
});

/* ============================== site skeleton and separation ========================== */

await check('the seite directory skeleton exists', () => {
  const required = [
    ...CONTENT_FILES,
    ...TEMPLATE_FILES,
    'static/style.css',
    'static/barnacle.css',
    'static/barnacle.min.css',
    'static/barnacle.js',
    'static/barnacle.min.js',
    '.seite/config.json',
    'README.md',
  ];
  const missing = required.filter((file) => !fs.existsSync(abs(file)));
  must(missing.length === 0, `missing: ${missing.join(', ')}`);
  for (const dir of ['content', 'templates', 'static', 'public']) {
    must(fs.existsSync(abs(dir)) && fs.statSync(abs(dir)).isDirectory(), `${dir}/ is missing`);
  }
  return `${required.length} files plus content/ templates/ static/ public/`;
});

await check('no templates live in a subdirectory (seite ignores them silently)', () => {
  const nested = walk(abs('templates'))
    .map(rel)
    .filter((file) => !/^templates\/[^/]+$/.test(file))
    .filter((file) => !file.startsWith('templates/shortcodes/'));
  must(
    nested.length === 0,
    `subdirectory templates are silently ignored by seite: ${nested.join(', ')}`,
  );
  return 'all templates sit directly under templates/';
});

await check('every authored text file is UTF-8 without a BOM', () => {
  const authored = [
    'seite.toml',
    '.seite/config.json',
    'README.md',
    'static/style.css',
    'public/favicon.svg',
    ...CONTENT_FILES,
    ...TEMPLATE_FILES,
    'scripts/verify-site.mjs',
  ];
  const withBom = authored.filter((file) => {
    const head = bytes(file).subarray(0, 3);
    return head.length === 3 && head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf;
  });
  must(
    withBom.length === 0,
    `a BOM makes seite report frontmatter-missing: ${withBom.join(', ')}`,
  );
  return `${authored.length} files start with plain UTF-8 bytes`;
});

await check('the docs-site stylesheet and the library artifacts stay separate', () => {
  const site = read('static/style.css');
  must(!/\.bn-/.test(site), 'static/style.css must not define library bn- classes');
  must(!/--bn-/.test(site), 'static/style.css must not define library --bn- tokens');
  for (const artifact of ARTIFACTS) {
    const text = read(artifact);
    must(!/site-/.test(text), `${artifact} must not contain docs-site site- classes`);
  }
  return 'style.css has no bn-/, artifacts have no site-';
});

await check('the README documents the local preview command', () => {
  const readme = read('README.md');
  must(
    readme.includes('D:\\sdk\\seite\\seite.exe'),
    'the README must call seite by its absolute path (it is not on PATH)',
  );
  must(/seite\.exe"? serve --port \d+/.test(readme), 'the README must document `seite serve --port`');
  must(readme.includes('4377'), 'the README must name the preview port');
  must(readme.includes('scripts/verify-site.mjs'), 'the README must document the site checks');
  return 'absolute seite path + `serve --port 4377`';
});

/* ============================ verification method 2: byte fidelity ==================== */

await check('seite copies all four artifacts into dist/static/ byte-identically', () => {
  const report = [];
  for (const artifact of ARTIFACTS) {
    const target = `dist/${artifact}`;
    must(fs.existsSync(abs(target)), `${target} was not produced`);
    const source = bytes(artifact);
    const copy = bytes(target);
    must(
      source.equals(copy),
      `${artifact}: seite rewrote it (${source.length}B → ${copy.length}B, ` +
        `${sha(source).slice(0, 12)} → ${sha(copy).slice(0, 12)})`,
    );
    report.push(`${path.basename(artifact)}=${source.length}B/${sha(source).slice(0, 12)}`);
  }
  return report.join(' ');
});

await check('dist/static/style.css is copied byte-identically too', () => {
  const source = bytes('static/style.css');
  const copy = bytes('dist/static/style.css');
  must(source.equals(copy), `style.css was rewritten (${source.length}B → ${copy.length}B)`);
  return `${source.length}B unchanged`;
});

await check('dist/ favicon from public/ is copied byte-identically', () => {
  must(fs.existsSync(abs('dist/favicon.svg')), 'public/favicon.svg did not reach dist/');
  const source = bytes('public/favicon.svg');
  const copy = bytes('dist/favicon.svg');
  must(source.equals(copy), `favicon.svg was rewritten (${source.length}B → ${copy.length}B)`);
  return `${source.length}B unchanged`;
});

/* =========================== sub-path safety of every built page ====================== */

await check('every page asset URL is sub-path safe and resolves inside dist/', () => {
  const pages = walk(abs('dist')).filter((file) => file.endsWith('.html'));
  must(pages.length > 0, 'no HTML pages were built');
  const problems = [];
  let internal = 0;
  for (const page of pages) {
    const html = fs.readFileSync(page, 'utf8');
    if (ROOT_ABSOLUTE_ASSET.test(html)) {
      problems.push(`${rel(page)} uses a root-absolute /static/ asset (404 under /barnacle/)`);
    }
    for (const url of attributeUrls(html)) {
      if (/^(?:mailto:|#|data:)/.test(url)) continue;
      const isAbsoluteSite = url === EXPECTED_BASE_URL || url.startsWith(`${EXPECTED_BASE_URL}/`);
      const isRootRelative = url.startsWith('/');
      if (!isAbsoluteSite && !isRootRelative) continue;
      internal += 1;
      const urlPath = isAbsoluteSite ? url.slice(EXPECTED_ORIGIN.length) : url;
      if (!urlPath.startsWith(EXPECTED_BASE_PATH)) {
        problems.push(`${rel(page)} links ${url} without the ${EXPECTED_BASE_PATH} prefix`);
        continue;
      }
      if (!resolveInDist(urlPath)) problems.push(`${rel(page)} links ${url} → no such file in dist/`);
    }
  }
  must(problems.length === 0, `\n  ${problems.join('\n  ')}`);
  return `${internal} internal URLs across ${pages.length} pages resolve under ${EXPECTED_BASE_PATH}`;
});

await check('the homepage renders content/pages/index.md and links to /components/', () => {
  const html = read('dist/index.html');
  must(
    html.includes('semantic-first Neubrutalism UI library'),
    'dist/index.html does not contain the homepage prose from content/pages/index.md',
  );
  const link = `${EXPECTED_BASE_URL}/components/`;
  must(html.includes(`href="${link}"`), `dist/index.html does not link to ${link}`);
  return `homepage prose + link to ${EXPECTED_BASE_PATH}/components/`;
});

await check('the components collection index resolves through the -index template rule', () => {
  const html = read('dist/components/index.html');
  must(
    html.includes('template: templates/components-index.html'),
    'dist/components/index.html was not rendered by templates/components-index.html ' +
      '(seite resolves collection indexes by the <collection>-index.html name)',
  );
  must(
    !read('dist/index.html').includes('template: templates/components-index.html'),
    'the homepage picked up the collection index template',
  );
  return 'templates/components-index.html won over templates/index.html';
});

/* ============================ verification method 3: AGENTS.md ======================== */

await check('the repository AGENTS.md is byte-identical to the pre-ticket blob', () => {
  const ref = referenceRef();
  must(ref, 'could not resolve a git reference for AGENTS.md');
  const blob = git(['show', `${ref}:AGENTS.md`]);
  must(blob.status === 0, `git show ${ref}:AGENTS.md failed`);
  const working = bytes('AGENTS.md');
  must(
    working.equals(blob.out),
    `AGENTS.md differs from ${ref} (${sha(working).slice(0, 12)} vs ${sha(blob.out).slice(0, 12)})`,
  );
  return `${ref}:${sha(working).slice(0, 12)} (${working.length}B) matches the working tree`;
});

await check('the repo AGENTS.md is still ours, not the seite scaffold one', () => {
  const ours = read('AGENTS.md');
  must(ours.includes('## Agent skills'), 'AGENTS.md lost its own content');
  must(ours.length < 8000, `AGENTS.md grew to ${ours.length}B — the 12.6KB seite file?`);
  return `${ours.length}B, keeps the repo's own sections`;
});

await check('no seite agent scaffolding was copied into the repository', () => {
  const found = SCAFFOLD_PATHS.filter((entry) => fs.existsSync(abs(entry)));
  must(found.length === 0, `seite scaffolding in the repo: ${found.join(', ')}`);
  return `absent: ${SCAFFOLD_PATHS.join(', ')}`;
});

/* ============================ verification method 4: seite init ====================== */

await check('seite init writes a known file set, of which only .seite/ was taken', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'barnacle-seite-init-'));
  const target = path.join(parent, 'site');
  const result = runSeite([
    'init',
    target,
    '--title',
    'Barnacle',
    '--description',
    'A semantic-first Neubrutalism UI library.',
    '--deploy-target',
    'github-pages',
    '--collections',
    'pages',
    '--agents',
    'claude',
    '--yes',
  ]);
  must(result.status === 0, `seite init exited ${result.status}:\n${result.output}`);
  const written = walk(target).map((file) => path.relative(target, file).split(path.sep).join('/'));
  initProbe = { dir: target, written };
  for (const expected of [
    'AGENTS.md',
    'CLAUDE.md',
    '.mcp.json',
    'seite.toml',
    '.seite/config.json',
    '.github/workflows/deploy.yml',
    'templates/base.html',
  ]) {
    must(written.includes(expected), `seite init no longer writes ${expected}`);
  }
  console.log(`      seite init wrote ${written.length} files:`);
  for (const file of [...written].sort()) console.log(`        ${file}`);
  return `${written.length} files, full list above`;
});

await check('.seite/config.json matches the version seite init declares', () => {
  must(initProbe, 'the init probe did not run');
  const generated = JSON.parse(fs.readFileSync(path.join(initProbe.dir, '.seite/config.json'), 'utf8'));
  const ours = JSON.parse(read('.seite/config.json'));
  must(
    ours.version === generated.version,
    `version ${ours.version} ≠ the version init writes (${generated.version})`,
  );
  must(Array.isArray(ours.agents), 'agents must be an array');
  return `version ${ours.version}, agents ${JSON.stringify(ours.agents)}`;
});

await check('the repo AGENTS.md is not the one seite init generates', () => {
  must(initProbe, 'the init probe did not run');
  const generated = fs.readFileSync(path.join(initProbe.dir, 'AGENTS.md'), 'utf8');
  must(generated.includes('MCP Server'), 'the init probe did not produce the seite AGENTS.md');
  must(read('AGENTS.md') !== generated, 'the repo AGENTS.md is the seite scaffold file');
  return `seite's is ${generated.length}B, ours is ${bytes('AGENTS.md').length}B`;
});

await check('the repo seite.toml is hand-written, not the init output', () => {
  must(initProbe, 'the init probe did not run');
  const generated = fs.readFileSync(path.join(initProbe.dir, 'seite.toml'), 'utf8');
  const ours = read('seite.toml');
  must(ours !== generated, 'seite.toml is a verbatim copy of the scaffold');
  must(!generated.includes('ivan112058.github.io'), 'the probe config unexpectedly has our base_url');
  must(ours.includes(EXPECTED_BASE_URL), 'our seite.toml lost the project-site base_url');
  must(ours.includes('[[collections]]'), 'our seite.toml has no collections');
  return `ours is ${ours.length}B with 2 collections, scaffold is ${generated.length}B`;
});

/* ================================ local preview command ============================== */

async function freePort() {
  return reserveFreePort();
}

async function waitForOk(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'timeout';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${url} never became reachable: ${lastError}`);
}

if (!SKIP_SERVE) {
  await check('seite serve previews the homepage and /components/ on a sub-path-free origin', async () => {
    const port = await freePort();
    const child = spawn(
      SEITE.bin,
      ['serve', '--dir', ROOT, '--port', String(port), '--no-repl'],
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, SEITE_YES: '1' } },
    );
    let log = '';
    child.stdout.on('data', (chunk) => (log += chunk));
    child.stderr.on('data', (chunk) => (log += chunk));
    try {
      const origin = `http://127.0.0.1:${port}`;
      const home = await (await waitForOk(`${origin}/`, 30_000)).text();
      must(
        home.includes(`href="${origin}/static/barnacle.css"`),
        `the preview did not rewrite the asset URL to the dev origin:\n${home.slice(0, 400)}`,
      );
      const components = await (await waitForOk(`${origin}/components/`, 15_000)).text();
      must(
        components.includes(`href="${origin}/static/style.css"`),
        'the /components/ preview page lost its stylesheet',
      );
      return `${origin}/ and /components/ both served`;
    } finally {
      child.kill();
      await new Promise((resolve) => child.once('exit', resolve));
      // `seite serve` builds into dist/ with the dev origin baked in, so rebuild before
      // leaving: a dist/ that was last written by the dev server is not deployable.
      runSeite(['build', '--dir', ROOT]);
    }
  });
}

/* ============================== optional: minify experiment ========================== */

if (MINIFY_EXPERIMENT) {
  await check('the committed minify setting is the one that preserves artifact bytes', () => {
    const tomlPath = abs('seite.toml');
    const original = fs.readFileSync(tomlPath, 'utf8');
    const rows = [];
    try {
      for (const value of ['false', 'true']) {
        fs.writeFileSync(tomlPath, original.replace(/^minify\s*=\s*\w+$/m, `minify = ${value}`));
        const result = runSeite(['build', '--dir', ROOT]);
        must(result.status === 0, `build with minify = ${value} exited ${result.status}`);
        for (const artifact of ARTIFACTS) {
          const source = bytes(artifact);
          const copy = bytes(`dist/${artifact}`);
          rows.push({
            minify: value,
            artifact: path.basename(artifact),
            source: source.length,
            copy: copy.length,
            sourceHash: sha(source).slice(0, 12),
            copyHash: sha(copy).slice(0, 12),
            same: source.equals(copy),
          });
        }
      }
    } finally {
      fs.writeFileSync(tomlPath, original);
      runSeite(['build', '--dir', ROOT]);
    }
    console.log('      minify experiment (source bytes → dist bytes, sha256[:12]):');
    for (const row of rows) {
      console.log(
        `        minify=${row.minify.padEnd(5)} ${row.artifact.padEnd(18)} ` +
          `${String(row.source).padStart(5)}B/${row.sourceHash} → ` +
          `${String(row.copy).padStart(5)}B/${row.copyHash}  ` +
          `${row.same ? 'IDENTICAL' : 'REWRITTEN'}`,
      );
    }
    const preserving = ['false', 'true'].filter((value) =>
      rows.filter((row) => row.minify === value).every((row) => row.same),
    );
    must(
      preserving.includes('false'),
      `minify = false no longer preserves the artifacts: ${JSON.stringify(rows)}`,
    );
    must(
      !preserving.includes('true'),
      'minify = true now preserves every artifact — the documented decision needs revisiting',
    );
    return 'minify = false keeps all four artifacts byte-identical, minify = true does not';
  });
}

/* -------------------------------------- summary -------------------------------------- */

console.log(`\n${checks - failures.length}/${checks} checks passed`);
if (initProbe) {
  console.log(`seite init probe written to ${initProbe.dir} (temp, safe to delete)`);
}
if (failures.length > 0) {
  console.log('\nfailed:');
  for (const name of failures) console.log(`  - ${name}`);
  process.exit(1);
}
