#!/usr/bin/env node
/**
 * Scripted verification for ticket 04 — the docs-site demo rendering layer.
 *
 * The three verification methods in .scratch/barnacle-design/issues/04-docs-demo-rendering.md
 * are the specification of this file; each one is a check below, made repeatable instead of a
 * one-off manual pass:
 *
 *   1. a plain HTML fence in 02's placeholder content produces a working Preview/Code pair,
 *      with the code panel showing the angle brackets as text and not as markup
 *   2. the page is still readable with no site script, and the theme switch has a sane default
 *   3. the measured interception point for fences is recorded (client-side site script, not a
 *      seite shortcode and not build-time post-processing)
 *
 * The expected values are the independent source of truth: spec.md §10 (docs site), §11
 * (bilingual), ADR-0004 (explicit dark mode), ADR-0005 (prefixed names) and the measured seite
 * 0.20.1 behaviour in D:\code\barnacle-notes\seite-findings.md §5 (fences render as
 * `<pre style="background-color:#2b303b;">` + inline spans: no `<code>`, no language class).
 * They are never recomputed from the site files.
 *
 * Run with: node scripts/verify-demo.mjs
 * Options:  --no-browser  skip the real-Chrome checks (they need playwright-core)
 *
 * playwright-core is deliberately NOT a dependency of this repository (ticket 08 owns that
 * decision). Install it just for a local run and nothing is written to package.json:
 *
 *   npm i --no-save playwright-core@1.64.1
 *
 * Without it the browser checks report SKIP and the static checks still gate the exit code.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const abs = (...parts) => path.join(ROOT, ...parts);
const DIST = abs('dist');

/* ------------------------------------ expectations ----------------------------------- */

/** The docs site's own namespace; the library owns `bn-` / `--bn-` (orchestrator §7). */
const SITE_PREFIX = 'site-';

/** Measured seite 0.20.1 fence output (seite-findings §5.2 D) — the interception target. */
const SEITE_FENCE_OPEN = /<pre style="background-color:#2b303b/;

/** The docs-site content files that carry component demos. */
const COMPONENT_PAGE_GLOB = /^content\/components\/(?!index\.md$).+\.md$/;

/** A fence info string must stay a bare language token: no directive syntax (ticket 04). */
const ALLOWED_FENCE_INFO = /^(?:html|css|js|javascript|json|xml|svg|text|txt|markdown|md|powershell|ps1|sh|bash|shell|console|diff)?$/;

/** Shortcode syntax would be new authoring syntax; ticket 04 forbids it in content files. */
const SHORTCODE_SYNTAX = /\{\{[<%#]/;

/** Base-path prefixing: page assets must go through site.base_url (spec §12). */
const SITE_SCRIPT_TAG = /<script src="\{\{ site\.base_url \}\}\/static\/site\.js" defer><\/script>/;

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

function read(rel, base = ROOT) {
  return fs.readFileSync(path.join(base, rel), 'utf8');
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

const rel = (full, base = ROOT) => path.relative(base, full).split(path.sep).join('/');

function contentFiles() {
  return walk(abs('content'))
    .filter((file) => file.endsWith('.md'))
    .map((file) => rel(file))
    .sort();
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
  return {
    status: result.status,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim(),
  };
}

/* --------------------------------- markdown structure -------------------------------- */

/**
 * Split a content file into frontmatter, prose and fences.
 *
 * A fence is only a fence when its ```` ``` ```` sits at the start of a line; the info string
 * after it is what an author writes, so it is captured for the "no new syntax" invariant.
 */
function dissect(raw) {
  const frontmatterMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const frontmatter = frontmatterMatch ? frontmatterMatch[1] : '';
  const body = frontmatterMatch ? raw.slice(frontmatterMatch[0].length) : raw;

  const proseLines = [];
  const fences = [];
  let open = null;
  for (const line of body.split(/\r?\n/)) {
    const marker = line.match(/^(\s*)(`{3,}|~{3,})(.*)$/);
    if (!open) {
      if (marker && marker[1] === '') {
        open = { marker: marker[2], info: marker[3].trim(), lines: [] };
      } else {
        proseLines.push(line);
      }
      continue;
    }
    if (marker && marker[1] === '' && marker[2][0] === open.marker[0] && marker[2].length >= open.marker.length) {
      fences.push({ info: open.info, text: open.lines.join('\n') });
      open = null;
      continue;
    }
    open.lines.push(line);
  }
  if (open) fences.push({ info: open.info, text: open.lines.join('\n'), unterminated: true });
  return { frontmatter, prose: proseLines.join('\n'), fences };
}

/** Prose with inline code spans removed: `<button>` in backticks is text, not markup. */
function proseWithoutInlineCode(prose) {
  return prose.replace(/`[^`]*`/g, '``');
}

/** seite-findings §5.2 D: an HTML-looking fence is the demo shape; `innerHTML` is the raw text. */
function looksLikeHtml(text) {
  return text.trim().startsWith('<');
}

/**
 * A fence only deserves a Preview tab when something in it actually renders. A fragment that
 * is nothing but `<link>` / `<script>` resource references (content/pages/usage.md carries one)
 * would otherwise get an empty preview panel and would fetch a CDN stylesheet while doing it.
 */
const NON_VISUAL_TAGS = new Set(['script', 'link', 'meta', 'style', 'base', 'title', 'template', 'noscript']);

function hasVisibleElement(text) {
  const topLevel = [...text.matchAll(/<([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>/g)].map((m) => m[1].toLowerCase());
  return topLevel.some((tag) => !NON_VISUAL_TAGS.has(tag));
}

/* --------------------------------------- state --------------------------------------- */

const SEITE = locateSeite();
if (!SEITE) {
  console.error('seite CLI not found. Set SEITE_BIN or install seite 0.20.1.');
  process.exit(1);
}

const argv = process.argv.slice(2);
const SKIP_BROWSER = argv.includes('--no-browser');

console.log(`barnacle demo-rendering verification — ${ROOT}`);
console.log(`CLI: ${SEITE.version} at ${SEITE.bin}\n`);

let buildResult = null;

/* ============================ method 3: build + interception point ==================== */

await check('seite build exits 0 cleanly (no broken link, no missing asset)', () => {
  buildResult = runSeite(['build', '--dir', ROOT]);
  must(buildResult.status === 0, `exit ${buildResult.status}:\n${buildResult.output}`);
  const problems = buildResult.output
    .split('\n')
    .filter((line) => /\b(broken|missing)\b/i.test(line));
  must(problems.length === 0, `build output mentions problems:\n${problems.join('\n')}`);
  return buildResult.output.split('\n').find((line) => /Built\b/.test(line))?.trim() ?? 'clean';
});

await check('seite still emits a bare <pre> with inline spans and no language class', () => {
  // The precedent this ticket is built on (seite-findings §5.2 D). If seite ever starts
  // emitting <code class="language-x">, the site script's detection must be revisited.
  const html = read('dist/usage.html');
  must(SEITE_FENCE_OPEN.test(html), 'dist/usage.html no longer contains a seite code fence <pre>');
  must(/&lt;/.test(html), 'the fence no longer escapes its angle brackets');
  must(!/<pre[^>]*>\s*<code/.test(html), 'seite now wraps fenced code in <code> — re-derive the layer');
  return '<pre style="background-color:#2b303b;"> + inline spans, no <code>, no language class';
});

await check('the built HTML still carries the raw fence: the layer is client-side', () => {
  const page = 'dist/components/button.html';
  must(fs.existsSync(abs(page)), `${page} was not built`);
  const html = read(page);
  must(/class="site-prose"/.test(html), `${page} lost its .site-prose body wrapper`);
  must(SEITE_FENCE_OPEN.test(html), `${page} has no raw seite fence <pre> — was it post-processed?`);
  for (const forbidden of ['role="tablist"', 'data-site-demo', `${SITE_PREFIX}demo__`]) {
    must(
      !html.includes(forbidden),
      `${page} contains ${forbidden} in the built HTML: the demo UI must be built by the site script`,
    );
  }
  return 'raw <pre> in dist/, zero tablist markup in dist/';
});

/* ======================= method 1: content stays plain Markdown ======================= */

await check('every fence in every content file is a plain fence with a language token', () => {
  const problems = [];
  let fenceCount = 0;
  for (const file of contentFiles()) {
    const { fences } = dissect(read(file));
    for (const fence of fences) {
      fenceCount += 1;
      if (fence.unterminated) problems.push(`${file}: an unterminated fence`);
      if (!ALLOWED_FENCE_INFO.test(fence.info)) {
        problems.push(`${file}: fence info \`${fence.info}\` is not a plain language token`);
      }
    }
  }
  must(problems.length === 0, `\n  ${problems.join('\n  ')}`);
  must(fenceCount > 0, 'no code fences exist in content/ — nothing exercises the layer');
  return `${fenceCount} fences across ${contentFiles().length} content files`;
});

await check('content files use no authoring syntax beyond Markdown and fences', () => {
  const problems = [];
  for (const file of contentFiles()) {
    const { prose, fences } = dissect(read(file));
    if (SHORTCODE_SYNTAX.test(prose) || fences.some((f) => SHORTCODE_SYNTAX.test(f.text))) {
      problems.push(`${file}: uses seite shortcode syntax`);
    }
    const bare = proseWithoutInlineCode(prose);
    const tag = bare.match(/<[a-zA-Z][^>]*>/);
    if (tag) problems.push(`${file}: raw HTML outside a fence (${tag[0]})`);
    for (const marker of [`${SITE_PREFIX}demo`, 'data-site-']) {
      if (prose.includes(marker)) {
        problems.push(`${file}: mentions ${marker} in prose — the layer must not need author markup`);
      }
    }
  }
  must(problems.length === 0, `\n  ${problems.join('\n  ')}`);
  return 'no shortcodes, no raw HTML, no layer-specific attributes';
});

await check('a component page carries the demo fence shape this layer is built for', () => {
  const pages = contentFiles().filter((file) => COMPONENT_PAGE_GLOB.test(file));
  must(pages.length > 0, 'no component pages exist under content/components/');
  const demos = pages.filter((file) => dissect(read(file)).fences.some((f) => looksLikeHtml(f.text)));
  must(
    demos.length > 0,
    `no component page has an HTML fence, so nothing would get a Preview tab: ${pages.join(', ')}`,
  );
  return `${demos.length}/${pages.length} component pages start a fence with "<"`;
});

/* ============================== site script and its wiring ============================ */

await check('static/site.js exists and keeps to the site- namespace', () => {
  must(fs.existsSync(abs('static/site.js')), 'static/site.js is missing');
  const script = read('static/site.js');
  must(!/\.bn-|--bn-/.test(script), 'static/site.js must not touch library bn- names');
  must(script.includes(`${SITE_PREFIX}demo`), 'static/site.js does not build the site-demo tab UI');
  // The switch is the site script's job; the browser check asserts where the attribute lands.
  must(/'data-theme'/.test(script), 'static/site.js does not set the data-theme attribute');
  must(/'dark'[\s\S]*'light'/.test(script), 'static/site.js does not flip between dark and light');
  must(/localStorage/.test(script), 'static/site.js does not persist the choice');
  return `${script.length}B of site- script`;
});

await check('base.html loads static/site.js through site.base_url', () => {
  const base = read('templates/base.html');
  must(SITE_SCRIPT_TAG.test(base), 'templates/base.html does not load static/site.js with the base_url prefix');
  must(!/<script src="\/static\//.test(base), 'templates/base.html has a root-absolute script URL');
  return '{{ site.base_url }}/static/site.js, defer';
});

/* ======================= method 2: theme switch, no-script default ==================== */

await check('no built page ships a baked-in data-theme (no-script default is light)', () => {
  const baked = walk(DIST)
    .filter((file) => file.endsWith('.html'))
    .filter((file) => /<html[^>]*data-theme=/.test(read(rel(file, DIST), DIST)));
  must(baked.length === 0, `these pages hardcode a theme: ${baked.map((f) => rel(f, DIST)).join(', ')}`);
  return 'every page ships <html lang="..."> with no data-theme attribute';
});

await check('the theme switch is a header button and does not depend on the library JS', () => {
  const base = read('templates/base.html');
  must(/data-site-theme-toggle/.test(base), 'templates/base.html has no theme toggle button');
  must(/localStorage/.test(base), 'the pre-paint inline script does not read localStorage');
  const header = base.slice(base.indexOf('<header'), base.indexOf('</header>'));
  must(/data-site-theme-toggle/.test(header), 'the theme toggle is not in the site header');
  const toggleScripts = [...base.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  must(toggleScripts.length > 0, 'templates/base.html has no inline script at all');
  must(
    toggleScripts.some((script) => /dataset\.theme/.test(script)),
    'no inline script applies the stored theme before first paint',
  );
  const style = read('static/style.css');
  must(
    new RegExp(`:not\\(\\[data-site-js[^)]*\\]\\)[^{]*\\[data-site-theme-toggle\\]`).test(style),
    'static/style.css does not hide the toggle while the site script is absent',
  );
  return 'header button + pre-paint inline script, no barnacle.js involved';
});

/* ============================== component page outline ================================ */

await check('component page sources carry no H1 or H2 of their own', () => {
  const problems = [];
  for (const file of contentFiles().filter((f) => COMPONENT_PAGE_GLOB.test(f))) {
    const { prose } = dissect(read(file));
    for (const line of prose.split(/\r?\n/)) {
      const heading = line.match(/^(#{1,2})\s+(.*)$/);
      if (heading) problems.push(`${file}: "${line.trim()}"`);
    }
  }
  must(problems.length === 0, `component page bodies must start at H3 (spec §10):\n  ${problems.join('\n  ')}`);
  return 'only H3 and below appear in component page sources';
});

await check('every component page renders exactly one H2, injected by the template', () => {
  const pages = walk(abs('dist/components'))
    .filter((file) => file.endsWith('.html'))
    .filter((file) => path.basename(file) !== 'index.html');
  must(pages.length > 0, 'no component pages were built');
  const report = [];
  for (const page of pages) {
    const html = read(rel(page, DIST), DIST);
    const headings = [...html.matchAll(/<h2\b[^>]*>/g)].map((m) => m[0]);
    must(
      headings.length === 1,
      `${rel(page, DIST)} renders ${headings.length} H2s (${headings.join(' | ')}): ` +
        'one H2 comes from the template and an authored H2 would add a second',
    );
    must(
      /data-site-heading=/.test(headings[0]),
      `${rel(page, DIST)}'s only H2 is not the template-injected one: ${headings[0]}`,
    );
    report.push(`${path.basename(page)}=1`);
  }
  return report.join(' ');
});

await check('an authored H2 really does produce a second H2 (the failure mode)', () => {
  // Proven on a throwaway copy of the site so the guarantee above is not just an assertion.
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'barnacle-h2-'));
  try {
    // `data` carries data/i18n.yaml, which base.html reads for every label since ticket 23; `i18n`
    // is not needed because the probe copies the already-generated content/ as-is.
    for (const entry of ['seite.toml', 'content', 'templates', 'static', 'public', 'data', '.seite']) {
      if (fs.existsSync(abs(entry))) {
        fs.cpSync(abs(entry), path.join(temp, entry), { recursive: true });
      }
    }
    const page = path.join(temp, 'content', 'components', 'button.md');
    must(fs.existsSync(page), 'content/components/button.md is missing from the probe copy');
    fs.writeFileSync(page, `${fs.readFileSync(page, 'utf8')}\n## An authored H2\n\nText.\n`);
    const result = runSeite(['build', '--dir', temp]);
    must(result.status === 0, `probe build exited ${result.status}:\n${result.output}`);
    const html = read('dist/components/button.html', temp);
    const count = [...html.matchAll(/<h2\b[^>]*>/g)].length;
    must(
      count === 2,
      `with an authored H2 the page renders ${count} H2s; the check above is not measuring anything`,
    );
    const injected = [...html.matchAll(/<h2\b[^>]*>/g)].filter((m) => /data-site-heading=/.test(m[0]));
    must(injected.length === 1, 'the template-injected H2 is no longer identifiable');
    return 'authored H2 → 2 H2s (1 template + 1 authored), so the single-H2 check bites';
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

/* ---------------------------------- browser checks ----------------------------------- */

const BROWSER_CHECKS = [];

/**
 * Static server with the site mounted on /barnacle/, mirroring the deployed sub-path, plus a
 * route that answers the absolute https://ivan112058.github.io/barnacle/... asset URLs the
 * built pages carry (spec §12) from dist/ — so the browser run also proves sub-path safety.
 */
async function startServer() {
  const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.txt': 'text/plain; charset=utf-8',
    '.xml': 'application/xml; charset=utf-8',
  };
  const BASE = '/barnacle';
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    if (!urlPath.startsWith(BASE)) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('outside base path');
      return;
    }
    let target = urlPath.slice(BASE.length) || '/';
    if (target.endsWith('/')) target += 'index.html';
    // Static hosts resolve /usage to usage.html; mirror that here.
    const candidates = [target, `${target}.html`, path.join(target, 'index.html')];
    const file = candidates.map((candidate) => path.join(DIST, candidate)).find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
    if (!file) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end(`not found: ${target}`);
      return;
    }
    fs.readFile(file, (error, buffer) => {
      if (error) {
        res.writeHead(404, { 'content-type': 'text/plain' }).end(`not found: ${target}`);
        return;
      }
      res.writeHead(200, {
        'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(buffer);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    base: `${origin}${BASE}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** Frozen transition/animation: a mid-transition read lies in a very believable way. */
const FREEZE_INIT = (css) => {
  const apply = () => {
    const style = document.createElement('style');
    style.textContent = css;
    (document.head ?? document.documentElement).appendChild(style);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply, { once: true });
  else apply();
};
const FREEZE_CSS = '*,*::before,*::after{transition:none !important;animation:none !important;caret-color:transparent !important}';

async function withPage(browser, server, relPath, options, fn) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...options });
  const consoleErrors = [];
  const pageErrors = [];
  await context.route('https://ivan112058.github.io/barnacle/**', (route) => {
    const url = new URL(route.request().url());
    const target = url.pathname.replace(/^\/barnacle/, '') || '/';
    route.fulfill({ path: path.join(DIST, target === '/' ? 'index.html' : target) });
  });
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  if (options?.javaScriptEnabled !== false) await page.addInitScript(FREEZE_INIT, FREEZE_CSS);
  try {
    await page.goto(`${server.base}/${relPath}`, { waitUntil: 'load' });
    return await fn(page, { consoleErrors, pageErrors });
  } finally {
    await context.close();
  }
}

function registerBrowserChecks() {
  BROWSER_CHECKS.push(
    [
      'the preview/code pair is built for HTML fences and not for plain code fences',
      async (browser, server) => {
        return withPage(browser, server, 'components/button', {}, async (page, issues) => {
          const state = await page.evaluate(() => ({
            demos: document.querySelectorAll('[data-site-demo]').length,
            tablists: document.querySelectorAll('.site-prose [role="tablist"]').length,
            tabs: document.querySelectorAll('[data-site-demo] [role="tab"]').length,
            panels: document.querySelectorAll('[data-site-demo] [role="tabpanel"]').length,
            plainFence: document.querySelectorAll('.site-prose > pre').length,
            selected: [...document.querySelectorAll('[role="tab"]')].map((tab) => tab.getAttribute('aria-selected')),
          }));
          must(state.demos === 2, `expected 2 demo widgets (2 HTML fences), found ${state.demos}`);
          must(state.tablists === 2, `expected 2 tablists, found ${state.tablists}`);
          must(state.tabs === 4, `expected 2 tabs per demo, found ${state.tabs} tabs`);
          must(state.panels === 4, `expected 2 panels per demo, found ${state.panels} panels`);
          must(
            state.plainFence === 1,
            `the CSS fence must stay a plain code block: found ${state.plainFence} plain fences`,
          );
          must(
            state.selected.join() === 'true,false,true,false',
            `Preview must be selected by default, got ${state.selected.join()}`,
          );
          must(issues.consoleErrors.length === 0, `console errors: ${issues.consoleErrors.join(' | ')}`);
          must(issues.pageErrors.length === 0, `page errors: ${issues.pageErrors.join(' | ')}`);
          return '2 tab pairs + 1 untouched code fence, Preview selected in both';
        });
      },
    ],
    [
      'the preview panel injects real HTML and the page styles reach it',
      async (browser, server) => {
        return withPage(browser, server, 'components/button', {}, async (page) => {
          const state = await page.evaluate(() => {
            const panel = document.querySelector('.site-demo__panel--preview');
            const button = panel.querySelector('button');
            const code = document.querySelector('.site-demo__panel--code');
            return {
              panelTag: panel?.tagName ?? '',
              buttonTag: button?.tagName ?? '',
              className: button?.className ?? '',
              shadow: button ? getComputedStyle(button).boxShadow : '',
              borderWidth: button ? getComputedStyle(button).borderTopWidth : '',
              panelHtml: panel?.innerHTML.slice(0, 40) ?? '',
              codeHtml: code?.innerHTML.slice(0, 120) ?? '',
              codeText: code?.querySelector('pre')?.textContent ?? '',
              injectedInCode: code ? code.querySelectorAll('button:not(.seite-copy-btn)').length : -1,
              codeFences: code?.querySelectorAll('pre').length ?? 0,
              copyButtons: document.querySelectorAll('[data-site-demo] .seite-copy-btn').length,
              clickable: (() => {
                let clicked = false;
                const el = panel.querySelector('button');
                el?.addEventListener('click', () => (clicked = true), { once: true });
                el?.click();
                return clicked;
              })(),
            };
          });
          must(state.buttonTag === 'BUTTON', `the preview did not inject a real <button> (got ${state.buttonTag})`);
          must(!/&lt;/.test(state.panelHtml), 'the preview panel shows escaped angle brackets instead of markup');
          must(
            state.shadow === 'rgb(0, 0, 0) 4px 4px 0px 0px' && state.borderWidth === '3px',
            `the demo stylesheet does not reach the injected HTML (shadow=${state.shadow}, border=${state.borderWidth})`,
          );
          must(state.clickable, 'the injected preview button is not interactive');
          must(
            state.codeFences === 1 && state.injectedInCode === 0,
            'the code panel is not the untouched seite fence: ' +
              `fences=${state.codeFences}, injected elements=${state.injectedInCode}`,
          );
          must(
            /&lt;/.test(state.codeHtml) && !/<button/.test(state.codeHtml),
            `the code panel's angle brackets were parsed as markup: ${state.codeHtml}`,
          );
          must(
            state.codeText.includes('<button class="bn-button"'),
            `the code panel does not show the fence source as text: ${JSON.stringify(state.codeText.slice(0, 80))}`,
          );
          must(state.copyButtons === 2, `seite's Copy button was disturbed (found ${state.copyButtons})`);
          return 'real <button> in preview, escaped source in code, seite Copy buttons intact';
        });
      },
    ],
    [
      'the tablist is keyboard operable with arrow keys, Home and End',
      async (browser, server) => {
        return withPage(browser, server, 'components/button', {}, async (page) => {
          // Both demos on the page have their own tablist; drive the first one.
          const demo = page.locator('[data-site-demo]').first();
          const first = '.site-demo__tab[data-site-tab="preview"]';
          const second = '.site-demo__tab[data-site-tab="code"]';
          await demo.locator(first).focus();
          await page.keyboard.press('ArrowRight');
          let state = await page.evaluate(() => {
            const tabs = [...document.querySelectorAll('.site-demo__tab')].slice(0, 2);
            return {
              focused: document.activeElement?.getAttribute('data-site-tab'),
              selected: tabs.map((tab) => tab.getAttribute('aria-selected')).join(),
              tabindex: tabs.map((tab) => tab.getAttribute('tabindex')).join(),
              previewHidden: document.querySelector('.site-demo__panel--preview').hidden,
              codeHidden: document.querySelector('.site-demo__panel--code').hidden,
            };
          });
          must(state.focused === 'code', `ArrowRight did not move focus to the code tab (${state.focused})`);
          must(state.selected === 'false,true', `ArrowRight did not select the code tab (${state.selected})`);
          must(state.tabindex === '-1,0', `roving tabindex is wrong (${state.tabindex})`);
          must(state.previewHidden && !state.codeHidden, 'the panels did not swap visibility');
          await page.keyboard.press('ArrowLeft');
          state = await page.evaluate(() => ({
            focused: document.activeElement?.getAttribute('data-site-tab'),
            firstSelected: document.querySelector('.site-demo__tab').getAttribute('aria-selected'),
          }));
          must(
            state.focused === 'preview' && state.firstSelected === 'true',
            `ArrowLeft did not move back to the preview tab (${state.focused})`,
          );
          await page.keyboard.press('ArrowLeft');
          const wrapped = await page.evaluate(() => document.activeElement?.getAttribute('data-site-tab'));
          must(wrapped === 'code', `ArrowLeft did not wrap around the tablist (${wrapped})`);
          await page.keyboard.press('End');
          state = await page.evaluate(() => ({
            focused: document.activeElement?.getAttribute('data-site-tab'),
            codeSelected: document.querySelectorAll('.site-demo__tab')[1].getAttribute('aria-selected'),
          }));
          must(state.focused === 'code' && state.codeSelected === 'true', 'End did not select the last tab');
          await page.keyboard.press('Home');
          const home = await page.evaluate(() =>
            document.activeElement?.getAttribute('data-site-tab'),
          );
          must(home === 'preview', 'Home did not return to the first tab');
          return 'ArrowRight/ArrowLeft/Home/End all move selection and visibility';
        });
      },
    ],
    [
      'the theme switch sets data-theme on <html>, persists, and never lands on <body>',
      async (browser, server) => {
        const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        await context.route('https://ivan112058.github.io/barnacle/**', (route) => {
          const url = new URL(route.request().url());
          const target = url.pathname.replace(/^\/barnacle/, '') || '/';
          route.fulfill({ path: path.join(DIST, target === '/' ? 'index.html' : target) });
        });
        const page = await context.newPage();
        try {
          await page.goto(`${server.base}/usage`, { waitUntil: 'load' });
          const before = await page.evaluate(() => ({
            html: document.documentElement.getAttribute('data-theme'),
            body: document.body.getAttribute('data-theme'),
            pressed: document.querySelector('[data-site-theme-toggle]')?.getAttribute('aria-pressed'),
            visible: !!document.querySelector('[data-site-theme-toggle]')?.offsetParent,
          }));
          must(before.html === null, `a fresh page already has data-theme=${before.html}`);
          must(before.pressed === 'false', `the toggle starts aria-pressed=${before.pressed}`);
          must(before.visible, 'the theme toggle is hidden even though the site script ran');

          await page.locator('[data-site-theme-toggle]').click();
          const after = await page.evaluate(() => ({
            html: document.documentElement.getAttribute('data-theme'),
            body: document.body.getAttribute('data-theme'),
            pressed: document.querySelector('[data-site-theme-toggle]')?.getAttribute('aria-pressed'),
            stored: localStorage.getItem('barnacle-site-theme'),
            paper: getComputedStyle(document.body).backgroundColor,
          }));
          must(after.html === 'dark', `the toggle did not set data-theme on <html> (got ${after.html})`);
          must(after.body === null, `data-theme landed on <body> (${after.body}) — shadows would not flip (ADR-0004)`);
          must(after.pressed === 'true', `aria-pressed did not follow the state (${after.pressed})`);
          must(after.stored === 'dark', `the choice was not persisted (localStorage=${after.stored})`);
          must(
            after.paper === 'rgb(26, 26, 26)',
            `the dark site tokens did not apply (body background ${after.paper})`,
          );

          await page.reload({ waitUntil: 'load' });
          const reloaded = await page.evaluate(() => ({
            html: document.documentElement.getAttribute('data-theme'),
            pressed: document.querySelector('[data-site-theme-toggle]')?.getAttribute('aria-pressed'),
          }));
          must(reloaded.html === 'dark', `the theme did not survive a reload (${reloaded.html})`);
          must(reloaded.pressed === 'true', 'the toggle did not resync after a reload');

          await page.locator('[data-site-theme-toggle]').click();
          const back = await page.evaluate(() => ({
            html: document.documentElement.getAttribute('data-theme'),
            stored: localStorage.getItem('barnacle-site-theme'),
          }));
          must(back.html === 'light', `toggling back did not set data-theme="light" (${back.html})`);
          must(back.stored === 'light', `the light choice was not persisted (${back.stored})`);
          return 'html[data-theme] only, persisted across reload, dark tokens applied';
        } finally {
          await context.close();
        }
      },
    ],
    [
      'with no site script the page stays readable and the toggle stays hidden',
      async (browser, server) => {
        const context = await browser.newContext({
          viewport: { width: 1280, height: 900 },
          javaScriptEnabled: false,
        });
        await context.route('https://ivan112058.github.io/barnacle/**', (route) => {
          const url = new URL(route.request().url());
          const target = url.pathname.replace(/^\/barnacle/, '') || '/';
          route.fulfill({ path: path.join(DIST, target === '/' ? 'index.html' : target) });
        });
        const page = await context.newPage();
        try {
          await page.goto(`${server.base}/components/button`, { waitUntil: 'load' });
          const prose = page.locator('.site-prose');
          must(await prose.isVisible(), 'the prose body is not visible without JavaScript');
          const text = await prose.innerText();
          must(text.length > 200, `the prose body is nearly empty without JavaScript (${text.length} chars)`);
          must(
            text.includes('<button class="bn-button"'),
            'the fence source is not readable as text without JavaScript',
          );
          must(
            (await page.locator('.site-prose pre').count()) === 3,
            'the three fences are not all present as code blocks without JavaScript',
          );
          must(
            (await page.locator('[data-site-demo]').count()) === 0,
            'tab markup exists in the DOM without JavaScript',
          );
          must(
            !(await page.locator('[data-site-theme-toggle]').isVisible()),
            'the theme toggle is visible although its script never ran',
          );
          return 'prose + all fences readable, no tab markup, toggle hidden';
        } finally {
          await context.close();
        }
      },
    ],
    [
      'the demo layer and the theme switch work with the library script blocked',
      async (browser, server) => {
        const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        const failed = [];
        await context.route('https://ivan112058.github.io/barnacle/**', (route) => {
          const url = new URL(route.request().url());
          const target = url.pathname.replace(/^\/barnacle/, '') || '/';
          route.fulfill({ path: path.join(DIST, target === '/' ? 'index.html' : target) });
        });
        // Registered last, so it wins: the library's script never arrives.
        await context.route('**/static/barnacle.js', (route) => route.abort());
        const page = await context.newPage();
        page.on('requestfailed', (request) => failed.push(request.url()));
        try {
          await page.goto(`${server.base}/components/button`, { waitUntil: 'load' });
          must(
            failed.some((url) => url.endsWith('/static/barnacle.js')),
            'the probe did not actually block the library script',
          );
          const state = await page.evaluate(async () => {
            const before = document.documentElement.getAttribute('data-theme');
            document.querySelector('[data-site-theme-toggle]').click();
            return {
              before,
              after: document.documentElement.getAttribute('data-theme'),
              demos: document.querySelectorAll('[data-site-demo]').length,
            };
          });
          must(state.demos === 2, `the demo layer needs the library script (${state.demos} demos)`);
          must(state.after === 'dark', `the theme switch needs the library script (${state.after})`);
          return '2 demos and a working theme switch with static/barnacle.js unreachable';
        } finally {
          await context.close();
        }
      },
    ],
  );
}

/**
 * Browser checks are optional at the repository level (playwright-core is ticket 08's
 * dependency) but mandatory for a ticket-04 verification run: run them whenever the module
 * resolves, and say so loudly when it does not.
 */
async function runBrowserChecks() {
  if (SKIP_BROWSER) {
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
  console.log(`      ${server.base} on system Chrome ${browser.version()}\n`);
  try {
    for (const [name, fn] of BROWSER_CHECKS) {
      await check(name, () => fn(browser, server));
    }
  } finally {
    await browser.close();
    await server.close();
  }
}

registerBrowserChecks();
await runBrowserChecks();

/* -------------------------------------- summary -------------------------------------- */

console.log(`\n${checks - failures.length}/${checks} checks passed${skips ? `, ${skips} skipped` : ''}`);
if (failures.length > 0) {
  console.log('\nfailed:');
  for (const name of failures) console.log(`  - ${name}`);
  process.exit(1);
}
