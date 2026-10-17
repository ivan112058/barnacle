#!/usr/bin/env node
/**
 * scripts/verify-release.mjs — ticket 24: the v1 release gate.
 *
 * One command, two modes, one exit code:
 *
 *   node scripts/verify-release.mjs                  (npm run verify:release)
 *     OFFLINE. Everything that can be proven without the site being published: the build is
 *     fresh and byte-identical to what is committed, dist/ is crawled link by link *under the
 *     /barnacle/ sub-path* (never through file://), every asset returns 200, every bilingual
 *     page switches to its own counterpart, dark mode holds on every page in real Chrome, the
 *     README's per-file consumption recipe produces the same computed styles as the whole
 *     artifact, its CDN / raw URLs are well-formed and point at files that exist, and the i18n
 *     output matches its English masters.
 *
 *   node scripts/verify-release.mjs --live            (npm run verify:release -- --live)
 *     The same gate with the HTTP-facing half pointed at
 *     https://ivan112058.github.io/barnacle/ and at the two mirrors of the `main` branch
 *     (jsDelivr and raw.githubusercontent). This is the mode that can fail while Pages is not
 *     enabled, and it is meant to: a green offline run proves the site *would* work, only
 *     --live proves it does. It reports the deployment's HTTP status, Content-Type and byte
 *     count per URL, and fails loudly with "the site is not published yet" rather than with
 *     forty copies of "404".
 *
 * `BN_LIVE=1` is the same as `--live`. Other options: `--no-build` (reuse dist/ and static/ as
 * they are), `--no-browser` (skip the real-Chrome checks), `--help`.
 *
 * Expected values are the independent source of truth, never recomputed from the files under
 * test: spec.md §12 (build & deploy, the three consumption routes), §14 (the sub-path question
 * this script answers), §6.1/§6.2 (the token literals below), ADR-0004 (dark mode is an explicit
 * switch on <html>), ADR-0006 (line 1 of the artifact is the layer declaration), and
 * `.scratch/barnacle-design/issues/24-full-site-deploy-verification.md`.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ARTIFACTS, CSS_MANIFEST, LAYER_DECLARATION } from './build.mjs';
import { listenOnFreePort } from './lib/server.mjs';

/* ======================================= expectations ====================================== */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const abs = (...parts) => path.join(ROOT, ...parts);
const rel = (full) => path.relative(ROOT, full).split(path.sep).join('/');
const read = (relPath) => fs.readFileSync(abs(relPath), 'utf8');
const isFile = (full) => fs.existsSync(full) && fs.statSync(full).isFile();

/** spec.md §12: a project site, so every URL lives one segment below the origin. */
const SITE_ORIGIN = 'https://ivan112058.github.io';
const BASE_PATH = '/barnacle';
const SITE_ROOT = `${SITE_ORIGIN}${BASE_PATH}/`;

/** spec.md §12.3: the three consumption routes, and where each of them reads from. */
const CDN_REPO = 'ivan112058/barnacle';
const CDN_BRANCH = 'main';
const CDN_PREFIX = `https://cdn.jsdelivr.net/gh/${CDN_REPO}@${CDN_BRANCH}/`;
const RAW_PREFIX = `https://raw.githubusercontent.com/${CDN_REPO}/${CDN_BRANCH}/`;
/** Both mirrors must serve the whole artifact set, so all four files are required in both. */
const ARTIFACT_SET = [ARTIFACTS.css, ARTIFACTS.cssMin, ARTIFACTS.js, ARTIFACTS.jsMin];
/** The per-file recipe is only valid with these two: the layer declaration and the tokens. */
const REQUIRED_SOURCES = ['src/css/00-base.css', 'src/css/01-theme.css'];

/** spec.md §6.1 / §6.2, as computed-value strings — not derived by re-reading the stylesheet. */
const LIGHT = {
  background: 'rgb(255, 253, 245)',
  foreground: 'rgb(0, 0, 0)',
  shadow: 'rgb(0, 0, 0) 4px 4px 0px 0px',
};
const DARK = {
  background: 'rgb(26, 26, 26)',
  foreground: 'rgb(255, 253, 245)',
  shadow: 'rgb(255, 253, 245) 4px 4px 0px 0px',
};
/** spec.md §6.1: `--bn-border-width: 3px` on `--bn-border-color` (which flips in dark). */
const CARD_BORDER = { light: '3px solid rgb(0, 0, 0)', dark: '3px solid rgb(255, 253, 245)' };

/** A page's own extension decides the MIME family it must be served with. */
const MIME_FAMILY = {
  '.css': /css/i,
  '.js': /javascript|ecmascript/i,
  '.mjs': /javascript|ecmascript/i,
  '.svg': /svg/i,
  '.png': /png/i,
  '.jpg': /jpe?g/i,
  '.jpeg': /jpe?g/i,
  '.gif': /gif/i,
  '.webp': /webp/i,
  '.avif': /avif/i,
  '.ico': /icon|x-icon/i,
  '.woff': /font|woff/i,
  '.woff2': /font|woff/i,
  '.ttf': /font|ttf/i,
  '.otf': /font|otf/i,
  '.html': /html/i,
  '.xml': /xml/i,
  '.json': /json/i,
  '.txt': /text/i,
  '.md': /text|markdown/i,
};

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

/** Things a link may start with and never be a site URL. */
const NON_NAVIGATING = /^(?:#|mailto:|tel:|javascript:|data:|blob:|about:)/i;
const ABSOLUTE_URL = /^[a-z][a-z0-9+.-]*:\/\//i;

/* ========================================= harness ========================================= */

const failures = [];
const skipped = [];
let checks = 0;

function must(condition, message) {
  if (!condition) throw new Error(message);
}

async function check(name, fn) {
  checks += 1;
  try {
    const detail = await fn();
    console.log(`PASS  ${name}${detail ? `\n      ${detail}` : ''}`);
  } catch (error) {
    failures.push({ name, message: error.message });
    console.log(`FAIL  ${name}\n      ${error.message}`);
  }
}

function skip(name, why) {
  skipped.push({ name, why });
  console.log(`SKIP  ${name}\n      ${why}`);
}

function section(title) {
  console.log(`\n—— ${title} ${'—'.repeat(Math.max(0, 74 - title.length))}`);
}

function info(message) {
  console.log(`      ${message}`);
}

/* ======================================= the command line ================================== */

const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) {
  console.log(
    [
      'usage: node scripts/verify-release.mjs [--live] [--no-build] [--no-browser]',
      '',
      '  --live        run the HTTP-facing half against https://ivan112058.github.io/barnacle/',
      '                and the jsDelivr / raw mirrors of the main branch (BN_LIVE=1 works too)',
      '  --no-build    reuse dist/ and static/ as they are instead of rebuilding them',
      '  --no-browser  skip the real-Chrome checks (dark mode, per-file composition)',
      '',
      'exit code: 0 = every check passed, 1 = at least one failed (skipped checks never pass a run)',
    ].join('\n'),
  );
  process.exit(0);
}

const LIVE = argv.includes('--live') || process.env.BN_LIVE === '1' || process.env.BN_LIVE === 'true';
const SKIP_BUILD = argv.includes('--no-build');
const SKIP_BROWSER = argv.includes('--no-browser');

/* ========================================= helpers ========================================= */

function npmRun(script) {
  // The shell is only needed on Windows, where npm is a .cmd shim. The arguments stay an array so
  // that POSIX spawns `npm` itself — a single command string with shell:false would look for a
  // binary literally named "npm run build" and fail with ENOENT on the Linux CI runner.
  const result = spawnSync('npm', ['run', script], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    timeout: 600_000,
  });
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() };
}

function git(args) {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', timeout: 120_000 });
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() };
}

function locateSeite() {
  const candidates = [process.env.SEITE_BIN, 'D:\\sdk\\seite\\seite.exe', 'seite'].filter(Boolean);
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
    if (probe.status === 0) return { bin: candidate, version: (probe.stdout ?? '').trim() };
  }
  return null;
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const mimeOf = (file) => MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';

/** `dist/components/index.html` → `/barnacle/components/`; `dist/index.html` → `/barnacle/`. */
function publishedPathOf(distFile) {
  const relPath = path.relative(DIST, distFile).split(path.sep).join('/');
  if (relPath === 'index.html') return `${BASE_PATH}/`;
  if (relPath.endsWith('/index.html')) return `${BASE_PATH}/${relPath.slice(0, -'index.html'.length)}`;
  return `${BASE_PATH}/${relPath.replace(/\.html$/, '')}`;
}

/**
 * Every page seite published, as a published URL path. The two 404 pages are excluded from the
 * "reachable from the homepage" set on purpose — nothing links to them, GitHub Pages serves them
 * by status code — but their files are still asserted to exist below.
 */
function distPages() {
  return walk(DIST)
    .filter((file) => file.endsWith('.html'))
    .map((file) => ({ file, path: publishedPathOf(file) }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

const isChinesePath = (publishedPath) => {
  const rest = publishedPath.slice(BASE_PATH.length);
  return rest === '/zh' || rest === '/zh/' || rest.startsWith('/zh/');
};

/**
 * A published URL that identifies one page, whatever form the link happened to use.
 *
 * The crawl has to compare *pages* rather than *strings*: `/barnacle/components/`,
 * `/barnacle/components/index` and `/barnacle/usage.html` can all be served for the same page,
 * and a 404 crawl alone would not notice the site linking two URLs for it. Folding them here is
 * what makes the reachability comparison sound.
 *
 * Folding is not forgiveness: the pager used to emit `/barnacle/components/index` for a
 * collection index (measured on card.html and dialog.html), which is the shape GitHub Pages does
 * not universally serve, so the non-canonical forms are collected as `aliases` and a check
 * rejects any of them. The canonical/hreflang/sitemap URL is the trailing-slash form.
 */
function canonicalPath(publishedPath) {
  if (publishedPath.endsWith('/index')) return publishedPath.slice(0, -'index'.length);
  if (publishedPath.endsWith('.html')) return publishedPath.slice(0, -'.html'.length);
  return publishedPath;
}

/** The same page in the other language (the switcher's contract, ticket 23). */
function counterpartPath(publishedPath) {
  const rest = publishedPath.slice(BASE_PATH.length);
  if (rest === '/' || rest === '') return `${BASE_PATH}/zh/`;
  if (rest === '/zh' || rest === '/zh/') return `${BASE_PATH}/`;
  if (rest.startsWith('/zh/')) return `${BASE_PATH}${rest.slice('/zh'.length)}`;
  return `${BASE_PATH}/zh${rest}`;
}

/**
 * A sub-path bug class of its own: the prefix applied twice. `/barnacle/barnacle/…` and
 * `/barnacle/zh/zh/…` are what a doubled `site.base_url` or `lang_prefix` looks like, and a
 * 404 is not guaranteed (the second copy is often a valid-looking path).
 */
function doubledSegments(publishedPath) {
  const rest = publishedPath.slice(BASE_PATH.length);
  const segments = rest.split('/').filter(Boolean);
  for (let i = 1; i < segments.length; i += 1) {
    if (segments[i] === segments[i - 1]) return `${publishedPath} repeats the segment "${segments[i]}"`;
  }
  const doubledBase = rest.slice(1).startsWith(BASE_PATH.slice(1));
  if (doubledBase) return `${publishedPath} repeats the site root`;
  return null;
}

/* ------------------------------- the /barnacle/ mount under test ---------------------------- */

/**
 * A static server that mounts one or more roots **under /barnacle/**, which is what GitHub Pages
 * does for a project site and what `seite serve` never does. `file://` is not an option: its
 * origin and directory-index semantics are different from a web server's, and the whole point of
 * this file is the sub-path.
 */
async function startSiteServer(mounts) {
  const resolved = mounts
    .map(({ prefix, root }) => ({
      prefix: prefix.length > 1 && prefix.endsWith('/') ? prefix.slice(0, -1) : prefix,
      root: path.resolve(root),
    }))
    .sort((a, b) => b.prefix.length - a.prefix.length);

  const server = http.createServer((request, response) => {
    let urlPath;
    try {
      urlPath = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    } catch {
      response.writeHead(400).end('bad url');
      return;
    }
    if (urlPath !== BASE_PATH && !urlPath.startsWith(`${BASE_PATH}/`)) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(`outside ${BASE_PATH}: ${urlPath}`);
      return;
    }
    let relPath = urlPath.slice(BASE_PATH.length) || '/';
    if (relPath.endsWith('/')) relPath += 'index.html';

    const mount = resolved.find(
      ({ prefix }) => prefix === '/' || relPath === prefix || relPath.startsWith(`${prefix}/`),
    );
    if (!mount) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(`no mount for ${relPath}`);
      return;
    }
    const sub = mount.prefix === '/' ? relPath : relPath.slice(mount.prefix.length);
    const target = path.resolve(mount.root, `.${sub}`);
    if (target !== mount.root && !target.startsWith(mount.root + path.sep)) {
      response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('forbidden');
      return;
    }
    const file = [target, `${target}.html`, path.join(target, 'index.html')].find(isFile);
    if (!file) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(`not found: ${relPath}`);
      return;
    }
    response.writeHead(200, { 'content-type': mimeOf(file), 'cache-control': 'no-store' });
    response.end(fs.readFileSync(file));
  });

  const { port } = await listenOnFreePort(server);
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise((done) => server.close(done)),
  };
}

/* ------------------------------------ the HTTP request ------------------------------------- */

/**
 * One published path, over the wire, from whichever deployment is under test.
 *
 * `origin` is the local mount in offline mode and `null` in live mode, in which case the request
 * goes to the real `https://ivan112058.github.io/barnacle/…`. Both modes get the same shape back
 * (status / Content-Type / byte count / body), so the same crawl code measures both.
 */
async function requestPath(publishedPath, origin) {
  const url = `${origin ?? SITE_ORIGIN}${publishedPath}`;
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30_000) });
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    url,
    finalUrl: response.url,
    status: response.status,
    contentType: response.headers.get('content-type') ?? '',
    bytes: buffer.length,
    buffer,
  };
}

/** The bytes of a file the request should reproduce exactly (offline and live alike). */
const servedFiles = [
  'static/barnacle.css',
  'static/barnacle.min.css',
  'static/barnacle.js',
  'static/barnacle.min.js',
  'static/style.css',
  'static/site.js',
];

/* ================================== reference classification =============================== */

/**
 * Split one page's HTML into the three things this file cares about:
 *   - `pages`:   `<a href>` — the crawl follows these;
 *   - `assets`:  `<link rel=stylesheet|icon|…>`, `<script src>`, `<img src>`, `srcset`-less media;
 *   - `alternates`: `<link rel=canonical|alternate>` — page URLs that must also exist.
 */
function extractReferences(html) {
  const pages = [...html.matchAll(/<a\b[^>]*?\bhref\s*=\s*"([^"]*)"/gi)].map((match) => match[1]);
  const assets = [...html.matchAll(/<(?:script|img|source|video|audio|iframe|embed)\b[^>]*?\bsrc\s*=\s*"([^"]*)"/gi)].map(
    (match) => match[1],
  );
  const alternates = [];
  for (const tag of html.matchAll(/<link\b([^>]*)>/gi)) {
    const attrs = tag[1];
    const href = (attrs.match(/\bhref\s*=\s*"([^"]*)"/) ?? [])[1];
    if (!href) continue;
    const relValue = ((attrs.match(/\brel\s*=\s*"([^"]*)"/) ?? [])[1] ?? '').toLowerCase();
    if (/canonical|alternate/.test(relValue)) alternates.push(href);
    else assets.push(href);
  }
  return { pages, assets, alternates };
}

/**
 * Resolve one reference against the page it appeared on.
 *
 * @returns {{kind: 'internal', path: string, relative?: string}
 *          | {kind: 'external', host: string}
 *          | {kind: 'skip'}}
 */
function classifyReference(raw, fromPath) {
  const value = (raw ?? '').trim();
  if (value === '' || NON_NAVIGATING.test(value)) return { kind: 'skip' };

  if (value.startsWith('//')) {
    const url = new URL(`https:${value}`);
    if (`${url.protocol}//${url.host}` !== SITE_ORIGIN) return { kind: 'external', host: url.host };
    return { kind: 'internal', path: url.pathname };
  }
  if (ABSOLUTE_URL.test(value)) {
    const url = new URL(value);
    if (url.origin !== SITE_ORIGIN) return { kind: 'external', host: url.host };
    return { kind: 'internal', path: url.pathname };
  }
  if (value.startsWith('/')) return { kind: 'internal', path: value };

  // A relative reference resolves against the page that carries it. The shipped pages do not use
  // them (templates go through site.base_url), so this is a safety net: it must still stay inside.
  const base = fromPath.endsWith('/') ? fromPath : path.posix.dirname(fromPath);
  return { kind: 'internal', path: path.posix.resolve(base, value), relative: value };
}

/* ========================================= the crawl ======================================= */

/** `url(…)` references inside a stylesheet — how fonts and images reach a page. */
function cssUrlReferences(css, fromPath) {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...withoutComments.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)]
    .map((match) => match[2].trim())
    .filter((value) => value && !/^(?:data:|about:|blob:)/i.test(value))
    .map((value) => ({ value, from: fromPath }));
}

/**
 * Breadth-first walk from the homepage, following `<a href>` and nothing else, exactly the way a
 * reader would. Every URL it lands on is requested for real.
 *
 * The crawl legitimately reaches non-page URLs as well — the Usage page links the four artifacts
 * directly (`<a href="/barnacle/static/barnacle.css">`) — so responses are split into HTML pages
 * and everything else instead of being assumed to be pages.
 */
async function crawlSite(origin) {
  const start = `${BASE_PATH}/`;
  const responses = new Map();
  const queue = [start];
  const queued = new Set(queue);
  const outsideRoot = [];
  const doubled = [];
  const relativeRefs = [];
  const externalHosts = new Set();
  const assets = new Set();
  const pageRefs = new Set();
  const alternates = new Map();
  const aliases = new Map();
  const htmlPages = new Map();

  const visit = (publishedPath, fromPath, relation) => {
    if (publishedPath === BASE_PATH) publishedPath = `${BASE_PATH}/`;
    if (publishedPath !== BASE_PATH && !publishedPath.startsWith(`${BASE_PATH}/`)) {
      outsideRoot.push(`${fromPath} → ${publishedPath} (${relation})`);
      return null;
    }
    const problem = doubledSegments(publishedPath);
    if (problem) doubled.push(`${fromPath} → ${problem}`);
    return publishedPath;
  };

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    const response = await requestPath(current, origin);
    responses.set(current, response);
    if (response.status !== 200) continue;
    const html = response.buffer.toString('utf8');
    if (!/html/i.test(response.contentType) || !/<html[\s>]/i.test(html)) continue;

    const canonical = canonicalPath(current);
    if (canonical !== current) aliases.set(current, canonical);
    if (!htmlPages.has(canonical)) htmlPages.set(canonical, { path: canonical, servedAs: current, response });

    const found = extractReferences(html);
    alternates.set(canonical, found.alternates);

    for (const raw of [...found.pages, ...found.alternates]) {
      const classified = classifyReference(raw, current);
      if (classified.kind === 'skip') continue;
      if (classified.kind === 'external') {
        externalHosts.add(classified.host);
        continue;
      }
      if (classified.relative) relativeRefs.push(`${current} → ${classified.relative}`);
      const target = visit(classified.path, current, found.pages.includes(raw) ? 'link' : 'head');
      if (!target) continue;
      pageRefs.add(target);
      if (!queued.has(target)) {
        queued.add(target);
        queue.push(target);
      }
    }

    for (const raw of found.assets) {
      const classified = classifyReference(raw, current);
      if (classified.kind === 'skip') continue;
      if (classified.kind === 'external') {
        externalHosts.add(classified.host);
        continue;
      }
      if (classified.relative) relativeRefs.push(`${current} → ${classified.relative}`);
      const target = visit(classified.path, current, 'asset');
      if (target) assets.add(target);
    }
  }

  /**
   * Fonts and images never appear in the HTML: they arrive through a stylesheet's `url()`. The
   * library ships no webfont and no bitmap today, which is exactly why this has to be measured
   * rather than assumed — the day someone adds one, it has to return 200 under the sub-path too.
   */
  const cssAssets = new Set();
  for (const assetPath of [...assets]) {
    if (!assetPath.endsWith('.css')) continue;
    const response = responses.get(assetPath) ?? (await requestPath(assetPath, origin));
    if (response.status !== 200) continue;
    for (const reference of cssUrlReferences(response.buffer.toString('utf8'), assetPath)) {
      const classified = classifyReference(reference.value, assetPath);
      if (classified.kind !== 'internal') continue;
      if (classified.relative) relativeRefs.push(`${assetPath} → ${classified.relative}`);
      const target = visit(classified.path, assetPath, 'url()');
      if (target) cssAssets.add(target);
    }
  }

  return {
    origin,
    start,
    pages: [...responses.keys()].sort(),
    htmlPages,
    responses,
    pageRefs,
    assets: [...assets].sort(),
    cssAssets: [...cssAssets].sort(),
    nonPageUrls: [...responses.keys()].filter((publishedPath) => !htmlPages.has(canonicalPath(publishedPath))).sort(),
    outsideRoot,
    doubled,
    relativeRefs,
    aliases,
    externalHosts: [...externalHosts].sort(),
    alternates,
  };
}

/* ============================== browser: real Chrome, real pages =========================== */

/** Freeze time before the first style calculation (browser-harness-findings §3.3). */
const FREEZE_CSS = `
*, *::before, *::after {
  transition: none !important;
  animation: none !important;
  caret-color: transparent !important;
}
`;

async function loadChromium() {
  try {
    const { chromium } = await import('playwright-core');
    return chromium;
  } catch {
    return null;
  }
}

function trackPageIssues(page) {
  const state = { consoleErrors: [], pageErrors: [], failedRequests: [] };
  page.on('console', (message) => {
    if (message.type() === 'error') state.consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => state.pageErrors.push(error.message));
  page.on('requestfailed', (request) => {
    const reason = request.failure()?.errorText ?? 'unknown';
    if (reason === 'net::ERR_ABORTED') return;
    state.failedRequests.push(`${request.method()} ${request.url()} — ${reason}`);
  });
  return {
    reset() {
      state.consoleErrors.length = 0;
      state.pageErrors.length = 0;
      state.failedRequests.length = 0;
    },
    problems() {
      return [
        ...state.consoleErrors.map((text) => `console.error: ${text}`),
        ...state.pageErrors.map((text) => `pageerror: ${text}`),
        ...state.failedRequests.map((text) => `request failed: ${text}`),
      ];
    },
  };
}

/**
 * Read the theme twice — `data-theme="dark"` and `data-theme="light"` — on the live page.
 *
 * The two reads are each other's control: if the same values came back in both, the assertion
 * would be measuring a constant rather than the theme, so the light read must reproduce the light
 * literals. `data-theme` goes on `<html>`, never `<body>`: a derived token is substituted where it
 * is declared, so a theme on `<body>` cannot flip the shadow colour (orchestrator-decisions §8).
 */
function themeSnapshot(page, theme) {
  return page.evaluate((value) => {
    document.documentElement.dataset.theme = value;
    const probe = document.createElement('span');
    probe.style.cssText =
      'position:absolute;visibility:hidden;color:var(--bn-foreground);box-shadow:var(--bn-shadow-md)';
    document.body.appendChild(probe);
    const computed = getComputedStyle(probe);
    const snapshot = {
      theme: document.documentElement.dataset.theme,
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      foreground: computed.color,
      shadow: computed.boxShadow,
    };
    probe.remove();
    return snapshot;
  }, theme);
}

/**
 * The dark-mode pass. Every page the crawl reached, in both languages, in real system Chrome.
 *
 * Offline the pages are served from the local mount and their absolute
 * `https://ivan112058.github.io/barnacle/…` sub-resource URLs are fulfilled from dist/ (the way
 * scripts/verify-i18n.mjs does it); live they are loaded from the deployment itself.
 */
async function darkModePass({ chromium, pages, origin }) {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const problems = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    if (origin) {
      await context.route(`${SITE_ORIGIN}${BASE_PATH}/**`, (route) => {
        const { pathname } = new URL(route.request().url());
        let relPath = pathname.slice(BASE_PATH.length) || '/';
        if (relPath.endsWith('/')) relPath += 'index.html';
        const file = [
          path.join(DIST, relPath),
          path.join(DIST, `${relPath}.html`),
          path.join(DIST, relPath, 'index.html'),
        ].find(isFile);
        if (file) route.fulfill({ status: 200, contentType: mimeOf(file), body: fs.readFileSync(file) });
        else route.fulfill({ status: 404, body: `not found: ${relPath}` });
      });
    }
    await context.addInitScript((css) => {
      const apply = () => {
        const style = document.createElement('style');
        style.textContent = css;
        (document.head ?? document.documentElement).appendChild(style);
      };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply, { once: true });
      else apply();
    }, FREEZE_CSS);

    const page = await context.newPage();
    const issues = trackPageIssues(page);

    for (const target of pages) {
      const url = `${origin ?? SITE_ORIGIN}${target.path}`;
      issues.reset();
      const response = await page.goto(url, { waitUntil: 'load' });
      if (!response || response.status() !== 200) {
        problems.push(`${target.path}: the page itself answered ${response ? response.status() : 'no response'}`);
        continue;
      }
      const dark = await themeSnapshot(page, 'dark');
      const light = await themeSnapshot(page, 'light');
      if (dark.theme !== 'dark') {
        problems.push(`${target.path}: <html data-theme="${dark.theme}">, expected "dark"`);
      }
      if (dark.bodyBackground !== DARK.background) {
        problems.push(`${target.path}: dark body background is ${dark.bodyBackground}, expected ${DARK.background}`);
      }
      if (dark.foreground !== DARK.foreground) {
        problems.push(`${target.path}: dark --bn-foreground resolves to ${dark.foreground}, expected ${DARK.foreground}`);
      }
      if (dark.shadow !== DARK.shadow) {
        problems.push(`${target.path}: dark --bn-shadow-md is ${dark.shadow}, expected ${DARK.shadow}`);
      }
      if (light.bodyBackground !== LIGHT.background || light.foreground !== LIGHT.foreground) {
        problems.push(
          `${target.path}: the light control read ${light.bodyBackground} / ${light.foreground}, ` +
            `expected ${LIGHT.background} / ${LIGHT.foreground}`,
        );
      }
      if (light.shadow !== LIGHT.shadow) {
        problems.push(`${target.path}: the light control's shadow is ${light.shadow}, expected ${LIGHT.shadow}`);
      }
      const pageIssues = issues.problems();
      if (pageIssues.length > 0) problems.push(`${target.path}: ${pageIssues.join(' | ')}`);
    }
    return { problems, chrome: browser.version() };
  } finally {
    await browser.close();
  }
}

/* ===================================== build freshness ===================================== */

function artifactFirstLines() {
  return Object.entries({ css: ARTIFACTS.css, cssMin: ARTIFACTS.cssMin }).map(([key, file]) => ({
    key,
    file,
    line: fs.readFileSync(abs(file), 'utf8').split('\n', 1)[0].replace(/\r$/, ''),
  }));
}

/* ===================================== the composition ===================================== */

/**
 * The README's third consumption route, measured: the same page loaded twice — once through the
 * single `static/barnacle.css` artifact, once through one `<link>` per `src/css/` file — in real
 * Chrome, and compared property by property.
 *
 * The per-file `<link>` set is generated from `CSS_MANIFEST`, i.e. from the build's own order, so
 * this cannot drift from the build chain. A file written by hand would measure a copy.
 */
const COMPOSITION_MARKUP = `    <main>
      <button id="button" type="button">Press me</button>
      <article id="card">
        <h2>A card</h2>
        <p>Bare &lt;article&gt;, no class (spec §8).</p>
      </article>
    </main>`;

function compositionPage(stylesheets) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<!-- No favicon request: a 404 for /favicon.ico would report a console error that is not a finding. -->
<link rel="icon" href="data:,">
<title>barnacle per-file composition</title>
${stylesheets.map((href) => `<link rel="stylesheet" href="${href}">`).join('\n')}
</head>
<body>
${COMPOSITION_MARKUP}
</body>
</html>
`;
}

/** The three properties both consumption routes must agree on (spec §12.3). */
function compositionSnapshot(page) {
  return page.evaluate(() => {
    const button = document.querySelector('#button');
    const card = document.querySelector('#card');
    const border = getComputedStyle(card);
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;color:var(--bn-foreground)';
    document.body.appendChild(probe);
    const snapshot = {
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      buttonShadow: getComputedStyle(button).boxShadow,
      cardBorder: `${border.borderTopWidth} ${border.borderTopStyle} ${border.borderTopColor}`,
      foreground: getComputedStyle(probe).color,
    };
    probe.remove();
    return snapshot;
  });
}

async function compositionPass({ chromium, origin }) {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addInitScript((css) => {
      const apply = () => {
        const style = document.createElement('style');
        style.textContent = css;
        (document.head ?? document.documentElement).appendChild(style);
      };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply, { once: true });
      else apply();
    }, FREEZE_CSS);
    const page = await context.newPage();
    const issues = trackPageIssues(page);

    const read = async (file, theme) => {
      await page.goto(`${origin}${BASE_PATH}/${file}`, { waitUntil: 'load' });
      if (theme) await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
      return compositionSnapshot(page);
    };

    const whole = { light: await read('whole.html', null), dark: await read('whole.html', 'dark') };
    const perFile = { light: await read('per-file.html', null), dark: await read('per-file.html', 'dark') };

    const expectations = {
      light: {
        bodyBackground: LIGHT.background,
        buttonShadow: LIGHT.shadow,
        cardBorder: CARD_BORDER.light,
        foreground: LIGHT.foreground,
      },
      dark: {
        bodyBackground: DARK.background,
        buttonShadow: DARK.shadow,
        cardBorder: CARD_BORDER.dark,
        foreground: DARK.foreground,
      },
    };

    const problems = [];
    for (const theme of ['light', 'dark']) {
      for (const [property, expected] of Object.entries(expectations[theme])) {
        if (whole[theme][property] !== expected) {
          problems.push(`whole artifact, ${theme} ${property}: ${whole[theme][property]}, expected ${expected}`);
        }
        if (perFile[theme][property] !== expected) {
          problems.push(`per-file links, ${theme} ${property}: ${perFile[theme][property]}, expected ${expected}`);
        }
        if (whole[theme][property] !== perFile[theme][property]) {
          problems.push(
            `${theme} ${property}: per-file links give ${perFile[theme][property]}, ` +
              `the whole artifact gives ${whole[theme][property]}`,
          );
        }
      }
    }
    problems.push(...issues.problems().map((problem) => `composition page: ${problem}`));
    return { problems, chrome: browser.version() };
  } finally {
    await browser.close();
  }
}

/* ======================================= README routes ===================================== */

/** Every `<prefix><path>` the README publishes for one consumption route. */
function readmeRouteUrls(prefix) {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`${escaped}([A-Za-z0-9._/-]+)`, 'g');
  return [...read('README.md').matchAll(pattern)].map((match) => match[1]);
}

/* ========================================== the run ======================================== */

console.log(`barnacle release verification — ${ROOT}`);
console.log(`Target: ${LIVE ? `LIVE ${SITE_ROOT}` : `offline, dist/ merged at ${BASE_PATH}/`}`);
console.log('');

const SEITE = locateSeite();
if (!SEITE) {
  console.error('seite CLI not found. Set SEITE_BIN or install seite 0.20.1.');
  process.exit(1);
}

const tempDirs = [];
const servers = [];
let localSite = null;
let compositionSite = null;

try {
  /* ------------------------------- 1. static/ is not stale ------------------------------- */

  section('1. the committed artifacts are what the sources build');

  if (SKIP_BUILD) {
    skip('npm run build rewrites the four artifacts', '--no-build was passed');
  } else {
    await check('npm run build exits 0 and rewrites the four artifacts', () => {
      const result = npmRun('build');
      must(result.status === 0, `exit ${result.status}:\n${result.output}`);
      const missing = ARTIFACT_SET.filter((file) => !isFile(abs(file)));
      must(missing.length === 0, `the build did not write ${missing.join(', ')}`);
      const summary = result.output.split('\n').find((line) => /build ok/.test(line));
      must(summary, `no build summary in:\n${result.output}`);
      return summary.trim();
    });
  }

  await check('static/ is byte-identical to the build (git diff --exit-code HEAD -- static/)', () => {
    must(fs.existsSync(abs('static')), 'static/ does not exist');
    const diff = git(['diff', '--exit-code', 'HEAD', '--', 'static/']);
    must(
      diff.status === 0,
      `the committed artifacts differ from what the build writes — commit the rebuild:\n${diff.output
        .split('\n')
        .slice(0, 20)
        .join('\n')}`,
    );
    const untracked = git(['ls-files', '--others', '--exclude-standard', '--', 'static/']);
    must(untracked.output === '', `untracked files under static/: ${untracked.output}`);
    return 'git diff HEAD -- static/ is empty and nothing is untracked';
  });

  await check('both CSS artifacts carry the cascade layer order on line 1 (ADR-0006)', () => {
    const lines = artifactFirstLines();
    const wrong = lines.filter((entry) => entry.line !== LAYER_DECLARATION);
    must(
      wrong.length === 0,
      wrong.map((entry) => `${entry.file}: line 1 is ${JSON.stringify(entry.line)}`).join('\n'),
    );
    return `${lines.map((entry) => entry.file).join(' + ')} → ${LAYER_DECLARATION}`;
  });

  if (SKIP_BUILD) {
    if (!fs.existsSync(DIST)) {
      console.error(
        '--no-build was passed but dist/ does not exist — run `npm run verify:release` without ' +
          'the flag (or `seite build`) first',
      );
      process.exit(1);
    }
    skip('seite build --strict exits 0', '--no-build was passed; the existing dist/ is used');
  } else {
    await check('seite build --strict exits 0', () => {
      const result = spawnSync(SEITE.bin, ['build', '--dir', ROOT, '--strict'], {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: 300_000,
        env: { ...process.env, SEITE_YES: '1' },
      });
      const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
      must(result.status === 0, `exit ${result.status}:\n${output}`);
      must(!/\b(broken|missing)\b/i.test(output), `strict build reported:\n${output}`);
      return output.split('\n').find((line) => /Built\b/.test(line))?.trim() ?? 'strict build clean';
    });
  }

  await check('the two 404 pages are built (GitHub Pages serves them by status code)', () => {
    const missing = ['404.html', 'zh/404.html'].filter((file) => !isFile(abs('dist', file)));
    must(missing.length === 0, `missing in dist/: ${missing.join(', ')}`);
    return 'dist/404.html + dist/zh/404.html';
  });

  /* --------------------------------- 2. i18n output is fresh ------------------------------ */

  section('2. the generated Chinese pages match their English masters');

  await check('npm run i18n:check exits 0 with no stale page', () => {
    const result = npmRun('i18n:check');
    must(result.status === 0, `exit ${result.status}:\n${result.output}`);
    const confirmation = result.output.split('\n').find((line) => /matches its sidecar/i.test(line));
    must(confirmation, `no confirmation line in:\n${result.output}`);
    return confirmation.trim();
  });

  /* ------------------------------------- 3. the crawl -------------------------------------- */

  section(
    LIVE
      ? `3. link-by-link crawl of the deployed site (${SITE_ROOT})`
      : `3. link-by-link crawl of dist/ mounted at ${BASE_PATH}/`,
  );

  if (!LIVE) {
    localSite = await startSiteServer([{ prefix: '/', root: DIST }]);
    servers.push(localSite);
    info(`serving dist/ at ${localSite.origin}${BASE_PATH}/`);
  }

  const expectedPages = distPages();
  const reachable = expectedPages.filter((page) => !/\/404$/.test(page.path));
  const crawlOrigin = LIVE ? null : localSite.origin;

  /** In live mode a dead deployment must be one loud sentence, not forty 404s. */
  let liveReachable = true;
  if (LIVE) {
    const preflight = await requestPath(`${BASE_PATH}/`, null);
    liveReachable = preflight.status === 200;
    info(`GET ${SITE_ROOT} → ${preflight.status} ${preflight.contentType || '(no content-type)'} ${preflight.bytes}B`);
    await check('the site is published at https://ivan112058.github.io/barnacle/', () => {
      must(
        preflight.status === 200,
        `GET ${SITE_ROOT} → ${preflight.status}. The GitHub Pages site is not published yet: ` +
          'enable it in Settings → Pages (Source: GitHub Actions) and push main, then run this again.',
      );
      must(/html/i.test(preflight.contentType), `the homepage is served as ${preflight.contentType}, not HTML`);
      must(preflight.bytes > 0, 'the homepage is empty');
      return `${preflight.status} · ${preflight.contentType} · ${preflight.bytes} bytes`;
    });
  }

  if (!LIVE || liveReachable) {
    const crawl = await crawlSite(crawlOrigin);
    const crawledPages = [...crawl.htmlPages.values()];
    info(
      `${crawl.pages.length} URL(s) requested → ${crawl.htmlPages.size} distinct page(s) over ` +
        `${crawl.pages.length - crawl.nonPageUrls.length} URL(s) (${crawl.aliases.size} in a non-canonical form); ` +
        `${crawl.nonPageUrls.length} non-page URL(s): ${crawl.nonPageUrls.join(', ')}`,
    );
    info(
      `${crawl.assets.length} asset(s) from the HTML, ${crawl.cssAssets.length} from CSS url(); ` +
        `external host(s): ${crawl.externalHosts.length > 0 ? crawl.externalHosts.join(', ') : 'none'}`,
    );
    if (crawl.aliases.size > 0) {
      info(
        `${crawl.aliases.size} link(s) do not use the page's canonical URL form (they are served, but ` +
          `the canonical/hreflang URL of the same page is the trailing-slash form):`,
      );
      for (const [alias, canonical] of crawl.aliases) info(`  ${alias} → ${canonical}`);
    }
    if (crawl.relativeRefs.length > 0) {
      info(`${crawl.relativeRefs.length} relative reference(s) resolve inside the site (allowed): ${crawl.relativeRefs.join(', ')}`);
    }

    /*
     * The crawl folds non-canonical URLs into their canonical page so the comparison is about
     * pages, not strings (see `canonicalPath`) — which also means a `/…/components/index` link
     * would pass every check above. It is not an acceptable link: GitHub Pages does not fall back
     * from an extensionless path to `.html` on every request, and the pager used to emit exactly
     * that form for a collection index. So the folding is now only an analysis device; linking a
     * second URL of the same page is a failure of its own.
     */
    await check("every page link uses that page's canonical URL (no /index or .html aliases)", () => {
      const aliases = [...crawl.aliases].map(([alias, canonical]) => `${alias} → ${canonical}`);
      must(
        aliases.length === 0,
        `links in a non-canonical form — the canonical URL of the same page is the ` +
          `trailing-slash one:\n  ${aliases.join('\n  ')}`,
      );
      return `${crawl.pages.length} requested URL(s), all in canonical form`;
    });

    await check('every page reachable from the homepage answers 200 (no 404 anywhere)', () => {
      const broken = crawl.pages
        .map((publishedPath) => ({ publishedPath, response: crawl.responses.get(publishedPath) }))
        .filter(({ response }) => response.status !== 200);
      must(
        broken.length === 0,
        broken.map(({ publishedPath, response }) => `${publishedPath} → ${response.status}`).join('\n'),
      );
      const english = crawledPages.filter((page) => !isChinesePath(page.path)).length;
      return `${crawledPages.length} pages (${english} en + ${crawledPages.length - english} zh), 0 × 404`;
    });

    await check('the crawl reaches every page seite published — no page is orphaned', () => {
      const crawled = new Set(crawl.htmlPages.keys());
      const expected = new Set(reachable.map((page) => page.path));
      const missing = [...expected].filter((publishedPath) => !crawled.has(publishedPath)).sort();
      const extra = [...crawled].filter((publishedPath) => !expected.has(publishedPath)).sort();
      must(
        missing.length === 0,
        `published but unreachable from the homepage: ${missing.join(', ')}`,
      );
      must(extra.length === 0, `linked but not published: ${extra.join(', ')}`);
      return `${crawled.size} crawled = ${expected.size} under ${BASE_PATH}/ (the two 404 pages are excluded: nothing links to them)`;
    });

    await check('no reference points outside the /barnacle site root', () => {
      must(
        crawl.outsideRoot.length === 0,
        `root-absolute or escaping references:\n  ${crawl.outsideRoot.join('\n  ')}`,
      );
      return `${crawl.pageRefs.size} distinct page reference(s), all inside ${BASE_PATH}/`;
    });

    await check('no URL carries a doubled prefix (/barnacle/barnacle, /zh/zh)', () => {
      must(crawl.doubled.length === 0, crawl.doubled.join('\n'));
      return 'no reference repeats a path segment';
    });

    await check('every asset (stylesheet, script, icon, font, image) answers 200 with a plausible Content-Type', async () => {
      const problems = [];
      const rows = [];
      for (const assetPath of [...crawl.assets, ...crawl.cssAssets]) {
        const response = crawl.responses.get(assetPath) ?? (await requestPath(assetPath, crawlOrigin));
        const extension = path.extname(assetPath).toLowerCase();
        const family = MIME_FAMILY[extension];
        rows.push(`${response.status} ${assetPath} ${response.contentType || '-'} ${response.bytes}B`);
        if (response.status !== 200) problems.push(`${assetPath} → ${response.status}`);
        else if (response.bytes === 0) problems.push(`${assetPath} → empty body`);
        else if (family && !family.test(response.contentType)) {
          problems.push(`${assetPath} → Content-Type ${response.contentType || '(none)'}, expected ${family}`);
        }
      }
      must(problems.length === 0, problems.join('\n'));
      return rows.join('\n');
    });

    await check('the six published static/ files are served byte-identically to the committed ones', async () => {
      const problems = [];
      for (const file of servedFiles) {
        const publishedPath = `${BASE_PATH}/${file}`;
        const response = crawl.responses.get(publishedPath) ?? (await requestPath(publishedPath, crawlOrigin));
        must(response.status === 200, `${publishedPath} → ${response.status}`);
        const committed = fs.readFileSync(abs(file));
        if (!response.buffer.equals(committed)) {
          problems.push(`${publishedPath}: ${response.bytes}B over the wire vs ${committed.length}B committed`);
        }
      }
      must(problems.length === 0, problems.join('\n'));
      return `${servedFiles.length} files byte-identical (${servedFiles.map((file) => file.replace('static/', '')).join(', ')})`;
    });

    await check('the language switcher lands on the same page in the other language', () => {
      const problems = [];
      let pages = 0;
      for (const page of crawledPages) {
        const html = page.response.buffer.toString('utf8');
        const links = [...html.matchAll(/<a class="site-lang__item" href="([^"]+)"/g)].map((match) => match[1]);
        if (links.length !== 1) {
          problems.push(`${page.path}: ${links.length} switcher links, expected 1`);
          continue;
        }
        const expected = `${SITE_ORIGIN}${counterpartPath(page.path)}`;
        if (links[0] !== expected) {
          problems.push(`${page.path}: switcher points at ${links[0]}, expected ${expected}`);
          continue;
        }
        if (!crawl.htmlPages.has(counterpartPath(page.path))) {
          problems.push(`${page.path}: counterpart ${counterpartPath(page.path)} is not a published page`);
          continue;
        }
        pages += 1;
      }
      must(problems.length === 0, problems.join('\n'));
      return `${pages} pages, each pointing at its own counterpart (en ↔ zh), both directions`;
    });

    await check('hreflang agrees with ticket 23: en + zh + x-default, all pointing at published pages', () => {
      const problems = [];
      let pages = 0;
      for (const page of crawledPages) {
        const html = page.response.buffer.toString('utf8');
        const lang = (html.match(/<html lang="([^"]*)"/) ?? [, ''])[1];
        const expectedLang = isChinesePath(page.path) ? 'zh' : 'en';
        if (lang !== expectedLang) problems.push(`${page.path}: <html lang="${lang}">, expected "${expectedLang}"`);
        const head = (html.match(/<head>[\s\S]*?<\/head>/) ?? [html])[0];
        const found = [...head.matchAll(/<link rel="alternate" hreflang="([^"]*)" href="([^"]*)">/g)].map((match) => ({
          lang: match[1],
          href: match[2],
        }));
        if (found.length !== 3) {
          problems.push(`${page.path}: ${found.length} hreflang alternates, expected en + zh + x-default`);
          continue;
        }
        const byLang = Object.fromEntries(found.map((entry) => [entry.lang, entry.href]));
        const english = `${SITE_ORIGIN}${isChinesePath(page.path) ? counterpartPath(page.path) : page.path}`;
        const chinese = `${SITE_ORIGIN}${isChinesePath(page.path) ? page.path : counterpartPath(page.path)}`;
        if (byLang.en !== english) problems.push(`${page.path}: hreflang en = ${byLang.en}`);
        if (byLang.zh !== chinese) problems.push(`${page.path}: hreflang zh = ${byLang.zh}`);
        if (byLang['x-default'] !== english) problems.push(`${page.path}: x-default = ${byLang['x-default']}`);
        for (const [language, href] of Object.entries(byLang)) {
          if (!href.startsWith(SITE_ORIGIN)) {
            problems.push(`${page.path}: hreflang ${language} is not on the site origin: ${href}`);
            continue;
          }
          const target = canonicalPath(href.slice(SITE_ORIGIN.length) || `${BASE_PATH}/`);
          if (!crawl.htmlPages.has(target)) {
            problems.push(`${page.path}: hreflang ${language} points at ${target}, which is not published`);
          }
        }
        pages += 1;
      }
      must(problems.length === 0, problems.join('\n'));
      return `${pages} pages · 3 alternates each · en/zh/x-default all resolve · <html lang> matches the URL`;
    });

    /* ---------------------------------- 4. dark mode, per page ---------------------------- */

    section('4. dark mode holds on every page (real Chrome)');

    const chromium = SKIP_BROWSER ? null : await loadChromium();
    if (!chromium) {
      skip(
        'every page holds under html[data-theme="dark"]',
        SKIP_BROWSER ? '--no-browser was passed' : 'playwright-core is not installed (npm i --no-save playwright-core@1.64.1)',
      );
    } else {
      await check('every page holds under html[data-theme="dark"], with the light read as control', async () => {
        const targets = crawledPages.map((page) => ({ path: page.path }));
        const result = await darkModePass({ chromium, pages: targets, origin: crawlOrigin });
        must(
          result.problems.length === 0,
          `${result.problems.length} page(s) failed:\n  ${result.problems.slice(0, 25).join('\n  ')}` +
            (result.problems.length > 25 ? `\n  … and ${result.problems.length - 25} more` : ''),
        );
        const components = targets.filter((target) => /\/components\/[^/]+$/.test(target.path)).length;
        return (
          `${targets.length} pages in Chrome ${result.chrome}: body ${DARK.background}, ` +
          `--bn-foreground ${DARK.foreground}, --bn-shadow-md ${DARK.shadow}, 0 console/page errors` +
          ` (${components} of them component pages, en + zh)`
        );
      });
    }
  } else {
    for (const name of [
      'every page reachable from the homepage answers 200 (no 404 anywhere)',
      'the crawl reaches every page seite published — no page is orphaned',
      'every asset (stylesheet, script, icon) answers 200 with a plausible Content-Type',
      'the six published static/ files are served byte-identically to the committed ones',
      'the language switcher lands on the same page in the other language',
      'hreflang agrees with ticket 23: en + zh + x-default, all pointing at published pages',
    ]) {
      skip(name, 'the site is not published yet, so there is no live response to measure');
    }

    section('4. dark mode holds on every page (real Chrome)');
    skip(
      'every page holds under html[data-theme="dark"], with the light read as control',
      'the site is not published yet, so there is no live page to theme',
    );
  }

  /* ------------------------- 5. the README's three consumption routes --------------------- */

  section('5. the consumption routes the README promises');

  await check('the README publishes a jsDelivr CDN URL for every artifact, on the main branch', () => {
    const paths = readmeRouteUrls(CDN_PREFIX);
    must(paths.length > 0, `the README shows no ${CDN_PREFIX}… URL`);
    const missing = ARTIFACT_SET.filter((file) => !paths.includes(file));
    must(missing.length === 0, `the CDN route does not cover ${missing.join(', ')}`);
    const absent = [...new Set(paths)].filter((file) => !isFile(abs(file)));
    must(absent.length === 0, `a CDN URL points at a file that does not exist: ${absent.join(', ')}`);
    return `${[...new Set(paths)].sort().join(', ')} — all four exist in static/`;
  });

  await check('the README publishes a raw.githubusercontent URL for every artifact, on main', () => {
    const paths = readmeRouteUrls(RAW_PREFIX);
    must(paths.length > 0, `the README shows no ${RAW_PREFIX}… URL`);
    const missing = ARTIFACT_SET.filter((file) => !paths.includes(file));
    must(missing.length === 0, `the raw-download route does not cover ${missing.join(', ')}`);
    const absent = [...new Set(paths)].filter((file) => !isFile(abs(file)));
    must(absent.length === 0, `a raw URL points at a file that does not exist: ${absent.join(', ')}`);
    return `${[...new Set(paths)].sort().join(', ')} — all four exist in static/`;
  });

  await check('the README documents the per-file route and lists every file in build order', () => {
    const readme = read('README.md');
    for (const file of REQUIRED_SOURCES) {
      must(readme.includes(file), `the README does not mention ${file}`);
      must(isFile(abs(file)), `${file} does not exist`);
    }
    // A recipe that silently omits one file is the failure mode this route has, and the fix is
    // always the same: add the file to CSS_MANIFEST *and* to the README's list.
    const missing = CSS_MANIFEST.map((entry) => `src/css/${entry.file}`).filter((file) => !readme.includes(file));
    must(
      missing.length === 0,
      `the README's per-file recipe omits ${missing.join(', ')} — every CSS_MANIFEST entry must be listed in build order`,
    );
    return `${REQUIRED_SOURCES.length} required sources + all ${CSS_MANIFEST.length} manifest files listed`;
  });

  await check('the README records how to re-verify once the site is live', () => {
    const readme = read('README.md');
    must(readme.includes('scripts/verify-release.mjs'), 'the README does not name scripts/verify-release.mjs');
    must(readme.includes('--live'), 'the README does not document the --live mode');
    must(readme.includes(SITE_ROOT) || readme.includes(`${SITE_ORIGIN}${BASE_PATH}`), 'the README does not name the deployed URL');
    return `npm run verify:release -- --live against ${SITE_ROOT}`;
  });

  /* ----------- the per-file route, measured: composition server + real Chrome ------------- */

  const chromiumForComposition = SKIP_BROWSER ? null : await loadChromium();
  if (!chromiumForComposition) {
    skip(
      'the per-file route computes the same styles as the whole artifact',
      SKIP_BROWSER ? '--no-browser was passed' : 'playwright-core is not installed',
    );
  } else {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'barnacle-compose-'));
    tempDirs.push(tempDir);
    fs.writeFileSync(
      path.join(tempDir, 'whole.html'),
      compositionPage([`${BASE_PATH}/static/barnacle.css`]),
      'utf8',
    );
    fs.writeFileSync(
      path.join(tempDir, 'per-file.html'),
      compositionPage(CSS_MANIFEST.map((entry) => `${BASE_PATH}/src-css/${entry.file}`)),
      'utf8',
    );
    compositionSite = await startSiteServer([
      { prefix: '/static', root: abs('static') },
      { prefix: '/src-css', root: abs('src', 'css') },
      { prefix: '/', root: tempDir },
    ]);
    servers.push(compositionSite);

    await check('the per-file route computes the same styles as the whole artifact', async () => {
      const result = await compositionPass({ chromium: chromiumForComposition, origin: compositionSite.origin });
      must(result.problems.length === 0, result.problems.join('\n'));
      return (
        `${CSS_MANIFEST.length} <link> tags = ${CSS_MANIFEST.map((entry) => entry.file).length} files · ` +
        `Chrome ${result.chrome} · body background, button hard shadow and card border identical in light and dark`
      );
    });
  }

  /* ------------------------------------- 6. the live half --------------------------------- */

  if (!LIVE) {
    section('6. the deployed site (live mode only)');
    skip(
      'the site is published at https://ivan112058.github.io/barnacle/',
      'offline run — add --live (or BN_LIVE=1) once GitHub Pages is enabled and main is pushed',
    );
    skip(
      'the jsDelivr and raw.githubusercontent mirrors serve the committed bytes',
      'offline run — this is the only check that can prove the mirrors reach the main branch',
    );
  } else {
    section(`6. the mirrors of the ${CDN_BRANCH} branch (live)`);

    await check('the jsDelivr and raw.githubusercontent mirrors serve the committed artifacts', async () => {
      const problems = [];
      const rows = [];
      /*
       * raw.githubusercontent.com drops connections from some networks often enough that a single
       * attempt reports a healthy mirror as broken (measured: 200/162694B on one run, three
       * transport errors in a row on the next). Only transport errors are retried — a 404, a wrong
       * byte count or a mismatched body still fails on the first response, because those are the
       * conditions this check exists to catch.
       */
      const fetchWithRetries = async (url, attempts = 3) => {
        let lastError;
        for (let attempt = 1; attempt <= attempts; attempt += 1) {
          try {
            const response = await fetch(url, {
              redirect: 'follow',
              signal: AbortSignal.timeout(30_000),
            });
            return { response, buffer: Buffer.from(await response.arrayBuffer()) };
          } catch (error) {
            lastError = error;
            if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 750 * attempt));
          }
        }
        throw lastError;
      };
      for (const prefix of [CDN_PREFIX, RAW_PREFIX]) {
        for (const file of ARTIFACT_SET) {
          const url = `${prefix}${file}`;
          let response;
          let buffer;
          try {
            ({ response, buffer } = await fetchWithRetries(url));
          } catch (error) {
            problems.push(`${url} → ${error.message} (3 attempts)`);
            continue;
          }
          const committed = fs.readFileSync(abs(file));
          rows.push(`${response.status} ${url} ${buffer.length}B`);
          if (response.status !== 200) problems.push(`${url} → ${response.status}`);
          else if (!buffer.equals(committed)) {
            problems.push(`${url}: ${buffer.length}B served vs ${committed.length}B committed`);
          }
        }
      }
      must(problems.length === 0, problems.join('\n'));
      return rows.join('\n');
    });
  }
} finally {
  for (const server of servers) await server.close();
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
}

/* ========================================= summary ========================================= */

console.log(`\n${checks - failures.length}/${checks} checks passed${skipped.length > 0 ? `, ${skipped.length} skipped` : ''}`);
if (skipped.length > 0) {
  console.log('not verified:');
  for (const entry of skipped) console.log(`  - ${entry.name} (${entry.why})`);
}
if (failures.length > 0) {
  console.log('\nfailed:');
  for (const failure of failures) console.log(`  - ${failure.name}`);
  if (LIVE) {
    console.log(
      '\nIf the failures above are 404s for the site origin, the deployment is simply not published yet: ' +
        'enable Pages (Source: GitHub Actions) and push main, then run `npm run verify:release -- --live` again.',
    );
  }
  process.exit(1);
}
