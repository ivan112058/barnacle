#!/usr/bin/env node
/**
 * Scripted verification for ticket 03 — deploy skeleton and sub-path behaviour.
 *
 * Ticket 03's verification methods are the specification of this file:
 *
 *   1. every asset a published page references must return 200 and no reference may point
 *      outside the site root — verified here locally by serving dist/ *under the /barnacle/
 *      sub-path*, which is what GitHub Pages does for a project site and what `seite serve`
 *      does not do (seite-findings §1.3: the dev server always serves from the origin root).
 *   2. `.github/workflows/deploy.yml` exists and pins the deploy mechanism
 *      (`upload-pages-artifact@v3` + `deploy-pages@v4`, main branch, pinned seite 0.20.1).
 *   3. the build chain CI runs is the build chain verified here.
 *
 * Expected values come from spec.md §12 (build & deploy), the ticket's verification methods
 * and the measured behaviour in D:\code\barnacle-notes (seite-findings §8, §9;
 * orchestrator-decisions §7, §10). They are never recomputed from the files under test.
 *
 * Run with: node scripts/verify-deploy.mjs   (or: npm run verify:deploy)
 * Options:  --no-serve   skip the sub-path HTTP crawl
 *           --no-build   reuse the existing dist/ instead of rebuilding
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listenOnFreePort } from './lib/server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const abs = (...parts) => path.join(ROOT, ...parts);
const rel = (full) => path.relative(ROOT, full).split(path.sep).join('/');

/* ------------------------------------ expectations ----------------------------------- */

/** spec.md §12: project site on a sub-path, written without a trailing slash. */
const EXPECTED_BASE_URL = 'https://ivan112058.github.io/barnacle';
const EXPECTED_BASE_PATH = '/barnacle';
/** base_url is origin + base_path; the origin alone is what GitHub Pages serves from. */
const EXPECTED_ORIGIN = EXPECTED_BASE_URL.slice(0, -EXPECTED_BASE_PATH.length);

/**
 * ticket 03: the four page-referenced artifacts plus the favicon must all return 200.
 * Site-relative — the base_path prefix is added when they are requested.
 */
const REQUIRED_URLS = [
  '/',
  '/components/',
  '/static/barnacle.css',
  '/static/barnacle.min.css',
  '/static/barnacle.js',
  '/static/style.css',
  '/favicon.svg',
];

/** A site-relative path as it actually goes over the wire on a project site. */
const mount = (urlPath) => `${EXPECTED_BASE_PATH}${urlPath === '/' ? '/' : urlPath}`;

/** spec.md §12: the deploy mechanism is seite's own workflow, pinned to the local version. */
const PINNED_SEITE_VERSION = '0.20.1';
const WORKFLOW = '.github/workflows/deploy.yml';

/**
 * Text assertions over the committed workflow. Not a YAML parser on purpose: a real CI run is
 * the authority on YAML validity (orchestrator-decisions §6 — no "should work" conclusions),
 * and this script must not add a dependency for it.
 */
const WORKFLOW_EXPECTATIONS = [
  { needle: 'branches: [main]', why: 'the workflow must deploy on pushes to main' },
  { needle: 'workflow_dispatch', why: 'the workflow must be manually dispatchable' },
  { needle: 'actions/upload-pages-artifact@v3', why: 'seite\'s upload action is part of the contract' },
  { needle: 'actions/deploy-pages@v4', why: 'seite\'s deploy action is part of the contract' },
  { needle: 'path: dist', why: 'the uploaded artifact must be dist/' },
  { needle: 'contents: read', why: 'permissions: contents: read' },
  { needle: 'pages: write', why: 'permissions: pages: write' },
  { needle: 'id-token: write', why: 'permissions: id-token: write' },
  { needle: 'group: pages', why: 'the concurrency group must be pages' },
  { needle: 'cancel-in-progress: false', why: 'an in-flight deploy must not be cancelled' },
  { needle: 'actions/setup-node@v4', why: 'the workflow must pin Node' },
  { needle: 'npm ci', why: 'CI must install from package-lock.json' },
  { needle: 'npm run build', why: 'CI must build the artifacts before seite sees them' },
  { needle: 'node scripts/verify.mjs', why: 'the 21 build-chain checks must run in CI' },
  { needle: 'node scripts/verify-theme.mjs', why: 'the 16 theme checks must run in CI' },
  { needle: 'node scripts/verify-static.mjs', why: 'the 26 static component checks must run in CI' },
  { needle: 'node scripts/verify-interaction.mjs', why: 'the 15 interaction-geometry checks must run in CI' },
  { needle: 'node scripts/verify-site.mjs', why: 'the 24 site checks must run in CI' },
  { needle: 'node scripts/verify-base.mjs', why: 'the 35 base-layer checks must run in CI' },
  { needle: 'node scripts/verify-layout.mjs', why: 'the 22 layout and utilities checks must run in CI' },
  { needle: 'node scripts/verify-release.mjs --no-browser', why: 'the offline release gate must run in CI' },
  { needle: 'git diff --exit-code -- static/', why: 'committed artifacts must match the CI build' },
  { needle: `VERSION=v${PINNED_SEITE_VERSION}`, why: 'seite must be installed at the pinned version' },
  { needle: '"$HOME/.local/bin" >> "$GITHUB_PATH"', why: 'install.sh puts seite off the CI PATH' },
  { needle: 'seite build --strict', why: 'CI must build the site in strict mode' },
  { needle: 'seite check --strict', why: 'CI must validate the site in strict mode' },
  { needle: 'needs: build', why: 'deploy must wait for the build job' },
  { needle: 'environment:', why: 'the deploy job must target a GitHub environment' },
];

/** The `environment:` mapping may be written inline or as name/url (seite's own form). */
const GITHUB_PAGES_ENVIRONMENT = /environment:\s*(?:\n\s+name:\s*)?github-pages/;

/** Things the measured behaviour forbids in CI. */
const WORKFLOW_FORBIDDEN = [
  { needle: 'seite upgrade --check', why: 'it always exits non-zero (orchestrator-decisions §7)' },
  { needle: 'gh ', why: 'the gh CLI is not installed (spec.md §12)' },
];

/** Page assets must never be root-absolute outside /barnacle: /static/... 404s (§8.2). */
const SKIPPED_SCHEMES = /^(?:mailto:|tel:|data:|javascript:|#)/i;
const EXTERNAL = /^[a-z][a-z0-9+.-]*:\/\//i;
const MIME = {
  '.css': 'text/css',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
};

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

function read(relPath) {
  return fs.readFileSync(abs(relPath), 'utf8');
}

/**
 * The assertions below are about what CI *executes*, so the workflow's explanatory comments
 * (which do name `seite upgrade --check` and the gh CLI, precisely to say they are not used)
 * must not count as usage.
 */
function workflowCode(workflow) {
  return workflow
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .map((line) => line.replace(/\s+#.*$/, ''))
    .join('\n');
}

function locateSeite() {
  const candidates = [process.env.SEITE_BIN, 'D:\\sdk\\seite\\seite.exe', 'seite'].filter(Boolean);
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
    if (probe.status === 0) return { bin: candidate, version: (probe.stdout ?? '').trim() };
  }
  return null;
}

/** `npm run build` is what CI runs; on Windows npm is a .cmd shim, so the shell is needed. */
function npmRun(script) {
  const command = `npm run ${script}`;
  const result = spawnSync(command, {
    cwd: ROOT,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    timeout: 300_000,
  });
  return {
    status: result.status,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim(),
  };
}

function runSeite(args, options = {}) {
  const result = spawnSync(SEITE.bin, args, {
    cwd: options.cwd ?? ROOT,
    encoding: 'utf8',
    timeout: options.timeout ?? 120_000,
    env: { ...process.env, SEITE_YES: '1' },
  });
  return {
    status: result.status,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim(),
  };
}

/* --------------------------------- filesystem helpers -------------------------------- */

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const isFile = (full) => fs.existsSync(full) && fs.statSync(full).isFile();

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
const SKIP_BUILD = argv.includes('--no-build');

console.log(`barnacle deploy verification — ${ROOT}`);
console.log(`CLI: ${SEITE.version} at ${SEITE.bin}`);
console.log(`Sub-path under test: ${EXPECTED_BASE_PATH} (project site, as GitHub Pages serves it)\n`);

let buildOutput = null;

/* ============================ verification method 1: build chain ====================== */

await check('npm run build exits 0 and writes all four artifacts', () => {
  const result = npmRun('build');
  must(result.status === 0, `exit ${result.status}:\n${result.output}`);
  buildOutput = result.output;
  const missing = ['static/barnacle.css', 'static/barnacle.min.css', 'static/barnacle.js', 'static/barnacle.min.js']
    .filter((file) => !isFile(abs(file)));
  must(missing.length === 0, `the build did not write ${missing.join(', ')}`);
  const summary = result.output.split('\n').find((line) => /build ok/.test(line));
  must(summary, `no build summary in:\n${result.output}`);
  return summary.trim();
});

await check(`seite build --strict exits 0 with the pinned seite ${PINNED_SEITE_VERSION}`, () => {
  must(SEITE.version === `seite ${PINNED_SEITE_VERSION}`, `the local CLI reports "${SEITE.version}"`);
  const result = runSeite(['build', '--dir', ROOT, '--strict']);
  must(result.status === 0, `exit ${result.status}:\n${result.output}`);
  const summary = result.output.split('\n').find((line) => /Built\b/.test(line));
  must(summary, `no build summary in:\n${result.output}`);
  must(!/\b(broken|missing)\b/i.test(result.output), `strict build reported:\n${result.output}`);
  return summary.trim();
});

await check(`the pinned seite version matches what the workflow installs`, () => {
  const workflow = read(WORKFLOW);
  must(
    workflow.includes(`VERSION=v${PINNED_SEITE_VERSION}`),
    `the workflow does not install seite v${PINNED_SEITE_VERSION}`,
  );
  const claimed = workflow.match(/seite --version[^\n]*/);
  return `VERSION=v${PINNED_SEITE_VERSION}${claimed ? ` + a version step` : ''}`;
});

/* ==================== verification method 2: the committed deploy workflow ============= */

await check(`${WORKFLOW} exists and pins the deploy mechanism`, () => {
  must(isFile(abs(WORKFLOW)), `${WORKFLOW} does not exist`);
  const workflow = workflowCode(read(WORKFLOW));
  const missing = WORKFLOW_EXPECTATIONS.filter((entry) => !workflow.includes(entry.needle));
  must(
    missing.length === 0,
    `\n  ${missing.map((entry) => `missing \`${entry.needle}\` (${entry.why})`).join('\n  ')}`,
  );
  const present = WORKFLOW_FORBIDDEN.filter((entry) => workflow.includes(entry.needle));
  must(
    present.length === 0,
    `\n  ${present.map((entry) => `forbidden \`${entry.needle}\` (${entry.why})`).join('\n  ')}`,
  );
  return `${WORKFLOW_EXPECTATIONS.length} required + ${WORKFLOW_FORBIDDEN.length} forbidden text assertions hold`;
});

await check('the workflow places the build chain before the seite build and upload', () => {
  const workflow = read(WORKFLOW);
  /*
   * The order the workflow has to keep, not just the presence of its steps: the artifacts are
   * built before anything reads them, every audit of the built site runs after `seite build`, and
   * the upload is last. The audit steps added for the review sit where their inputs exist —
   * verify-static / verify-interaction read `static/` only, the others read `dist/`.
   */
  const order = [
    'actions/checkout@v4',
    'actions/setup-node@v4',
    'npm ci',
    'npm run build',
    'git diff --exit-code -- static/',
    'node scripts/verify.mjs',
    'node scripts/verify-theme.mjs',
    'node scripts/verify-static.mjs',
    'node scripts/verify-interaction.mjs',
    'node scripts/verify-site.mjs',
    'seite build --strict',
    'seite check --strict',
    'node scripts/verify-base.mjs',
    'node scripts/verify-layout.mjs',
    'node scripts/verify-release.mjs --no-browser',
    'actions/upload-pages-artifact@v3',
  ];
  const positions = order.map((needle) => ({ needle, at: workflow.indexOf(needle) }));
  const missing = positions.filter((entry) => entry.at === -1);
  must(missing.length === 0, `missing from the workflow: ${missing.map((e) => e.needle).join(', ')}`);
  const outOfOrder = [];
  for (let i = 1; i < positions.length; i += 1) {
    if (positions[i].at < positions[i - 1].at) {
      outOfOrder.push(`${positions[i].needle} appears before ${positions[i - 1].needle}`);
    }
  }
  must(
    outOfOrder.length === 0,
    `the CI steps are out of order:\n  ${outOfOrder.join('\n  ')}`,
  );
  return order.join(' → ');
});

await check('the deploy job targets the github-pages environment', () => {
  const workflow = read(WORKFLOW);
  must(
    GITHUB_PAGES_ENVIRONMENT.test(workflow),
    'the deploy job must declare the github-pages environment (else Pages rejects the deploy)',
  );
  const deployJob = workflow.slice(workflow.indexOf('\n  deploy:'));
  must(deployJob.length > 0, 'the workflow has no deploy job');
  must(deployJob.includes('actions/deploy-pages@v4'), 'the deploy job does not run deploy-pages');
  must(
    deployJob.includes('actions/upload-pages-artifact@v3') === false,
    'the artifact is uploaded in the build job, not the deploy job',
  );
  return 'environment github-pages + actions/deploy-pages@v4 in the deploy job';
});

await check('the workflow installs seite before the verification script that needs it', () => {
  const workflow = read(WORKFLOW);
  const install = workflow.indexOf('VERSION=v0.20.1');
  const verifySite = workflow.indexOf('node scripts/verify-site.mjs');
  must(install !== -1 && verifySite !== -1, 'could not locate the install / verify-site steps');
  must(
    install < verifySite,
    'scripts/verify-site.mjs shells out to seite, so the CLI must be on PATH before it runs',
  );
  return 'Install seite step precedes scripts/verify-site.mjs';
});

/* ================== verification method 1, locally: serve dist/ at /barnacle/ ========== */

/** Resolve a URL path the way a static host mounted at /barnacle/ would. */
function resolveInDist(urlPath) {
  let target = decodeURIComponent(urlPath.split(/[?#]/)[0]);
  if (target.startsWith(EXPECTED_BASE_PATH)) target = target.slice(EXPECTED_BASE_PATH.length);
  const clean = target.replace(/^\/+/, '');
  if (clean === '' || target.endsWith('/')) {
    const index = path.join(DIST, clean, 'index.html');
    return isFile(index) ? index : null;
  }
  const direct = path.join(DIST, clean);
  if (isFile(direct)) return direct;
  if (isFile(`${direct}.html`)) return `${direct}.html`;
  const index = path.join(direct, 'index.html');
  if (isFile(index)) return index;
  return null;
}

/** Serve dist/ under /barnacle/ — the project-site mount the dev server never reproduces. */
async function startProjectSiteServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    if (urlPath !== EXPECTED_BASE_PATH && !urlPath.startsWith(`${EXPECTED_BASE_PATH}/`)) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end(`not found outside ${EXPECTED_BASE_PATH}\n`);
      return;
    }
    const file = resolveInDist(urlPath);
    if (!file) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end(`404 ${urlPath}\n`);
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
  const { port } = await listenOnFreePort(server);
  return { server, port };
}

if (!SKIP_SERVE) {
  must(buildOutput !== null || SKIP_BUILD, 'the build step must run before the crawl');

  const { server, port } = await startProjectSiteServer();
  const origin = `http://127.0.0.1:${port}`;
  console.log(`      serving ${rel(DIST)} at ${origin}${EXPECTED_BASE_PATH}/`);

  try {
    await check(`every internal reference carries the ${EXPECTED_BASE_PATH} prefix`, () => {
      const pages = walk(DIST).filter((file) => file.endsWith('.html'));
      must(pages.length > 0, 'no HTML pages were built');
      const problems = [];
      const external = new Set();
      let internal = 0;
      for (const page of pages) {
        for (const url of attributeUrls(fs.readFileSync(page, 'utf8'))) {
          if (url === '' || SKIPPED_SCHEMES.test(url)) continue;
          if (EXTERNAL.test(url)) {
            if (url === EXPECTED_BASE_URL || url.startsWith(`${EXPECTED_BASE_URL}/`)) internal += 1;
            else external.add(new URL(url).host);
            continue;
          }
          if (!url.startsWith('/')) {
            // A relative reference resolves against the page's own depth; it is still an
            // internal reference and must not escape the site.
            problems.push(`${rel(page)} uses the relative reference ${url}`);
            continue;
          }
          internal += 1;
          if (url !== EXPECTED_BASE_PATH && !url.startsWith(`${EXPECTED_BASE_PATH}/`)) {
            problems.push(`${rel(page)} links ${url} — outside the ${EXPECTED_BASE_PATH} site root`);
          }
        }
      }
      must(problems.length === 0, `\n  ${problems.join('\n  ')}`);
      const hosts = [...external].sort();
      return `${internal} internal references across ${pages.length} pages; external hosts: ${hosts.length ? hosts.join(', ') : 'none'}`;
    });

    await check('the homepage at /barnacle/ is 200 and links to the component index', async () => {
      const response = await fetch(`${origin}${EXPECTED_BASE_PATH}/`);
      must(response.status === 200, `GET ${EXPECTED_BASE_PATH}/ → ${response.status}`);
      const html = await response.text();
      const link = `${EXPECTED_BASE_URL}/components/`;
      must(html.includes(`href="${link}"`), `the homepage does not link to ${link}`);
      must(
        html.includes(`${EXPECTED_BASE_URL}/static/barnacle.css`),
        'the homepage does not reference the library stylesheet through the sub-path',
      );
      return `/barnacle/ → 200 (${html.length}B) with href="${link}"`;
    });

    await check(`every internal URL on every page returns 200 under ${EXPECTED_BASE_PATH}`, async () => {
      const pages = walk(DIST).filter((file) => file.endsWith('.html'));
      // Site-relative paths: the /barnacle prefix is added once, at request time.
      const urlPaths = new Set(REQUIRED_URLS);
      for (const page of pages) {
        for (const url of attributeUrls(fs.readFileSync(page, 'utf8'))) {
          if (url === '' || SKIPPED_SCHEMES.test(url)) continue;
          if (EXTERNAL.test(url)) {
            if (url !== EXPECTED_BASE_URL && !url.startsWith(`${EXPECTED_BASE_URL}/`)) continue; // off-site
            urlPaths.add(url.slice(EXPECTED_ORIGIN.length).replace(EXPECTED_BASE_PATH, '') || '/');
          } else if (url.startsWith('/')) {
            urlPaths.add(url.replace(EXPECTED_BASE_PATH, '') || '/');
          }
          // relative references are already reported by the prefix check
        }
      }
      const rows = [];
      const failuresHere = [];
      for (const urlPath of [...urlPaths].sort()) {
        const response = await fetch(`${origin}${mount(urlPath)}`);
        const body = await response.text();
        rows.push({ urlPath: mount(urlPath), status: response.status, bytes: Buffer.byteLength(body) });
        if (response.status !== 200) failuresHere.push(`${mount(urlPath)} → ${response.status}`);
        if (response.status === 200 && body.trim() === '') failuresHere.push(`${mount(urlPath)} → empty body`);
      }
      console.log(`      ${rows.length} URL(s) requested under ${EXPECTED_BASE_PATH}:`);
      for (const row of rows) {
        console.log(`        ${String(row.status)}  ${row.urlPath.padEnd(34)} ${String(row.bytes).padStart(7)}B`);
      }
      must(failuresHere.length === 0, `non-200 responses: ${failuresHere.join(', ')}`);
      const ok = rows.filter((row) => row.status === 200).length;
      return `${ok}/${rows.length} URLs returned 200 (0 × 404)`;
    });

    await check('the required asset list returns 200 byte-identically to static/', async () => {
      const report = [];
      for (const urlPath of REQUIRED_URLS) {
        const response = await fetch(`${origin}${mount(urlPath)}`);
        must(response.status === 200, `GET ${mount(urlPath)} → ${response.status}`);
        report.push(`${mount(urlPath)}=200`);
      }
      for (const artifact of ['static/barnacle.css', 'static/barnacle.min.css', 'static/barnacle.js', 'static/style.css']) {
        const served = Buffer.from(await (await fetch(`${origin}${mount(`/${artifact}`)}`)).arrayBuffer());
        const committed = fs.readFileSync(abs(artifact));
        must(
          served.equals(committed),
          `/${artifact} is served with different bytes than the committed file ` +
            `(${served.length}B vs ${committed.length}B)`,
        );
      }
      return `${report.length} required URLs 200; 4 artifacts byte-identical over HTTP`;
    });

    await check('a root-level request is not served (the site only exists under the sub-path)', async () => {
      const response = await fetch(`${origin}/`);
      must(response.status === 404, `GET / → ${response.status}; the mount must be ${EXPECTED_BASE_PATH} only`);
      return `GET / → 404, GET ${EXPECTED_BASE_PATH}/ → 200`;
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

/* -------------------------------------- summary -------------------------------------- */

console.log(`\n${checks - failures.length}/${checks} checks passed`);
if (failures.length > 0) {
  console.log('\nfailed:');
  for (const name of failures) console.log(`  - ${name}`);
  process.exit(1);
}
