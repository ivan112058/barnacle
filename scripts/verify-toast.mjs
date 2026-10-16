#!/usr/bin/env node
/**
 * Scripted verification for ticket 22 — Toast and the narrowed global surface.
 *
 * The verification methods in .scratch/barnacle-design/issues/22-toast-and-global-api-audit.md are
 * the specification of this file; each one is a check below, made repeatable instead of a one-off
 * manual pass:
 *
 *   1. the three entries, their signatures and the configurable duration — `node --test` owns this
 *      (`tests/js/toast.test.mjs`, driven by a fake clock); the static checks here pin the source
 *      contracts the tests cannot see (a plain module, not a custom element)
 *   2. stacking and non-occlusion, measured in a real browser: neighbour rects never touch, and a
 *      clickable element *under* the container still receives the click through the gaps
 *   3. reduced motion: no animation, and the toast still appears and still goes
 *   4. the demo on the docs page is genuinely clickable in the rendered preview panel
 *   5. `window.bn` enumerated in a browser and compared against the spec §9 table, item by item
 *
 * The expected values are the independent source of truth: spec.md §8/§9 (the component table with
 * Toast's `—` element column and `bn.toast()` API), §7 (the motion guard), ADR-0005 (prefixed
 * names) and orchestrator-decisions §4 (the `--_` geometry slots) and §1 (data-variant carries
 * meaning only).
 *
 * Run with: node scripts/verify-toast.mjs
 * Options:  --no-browser  skip the real-Chrome checks
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
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const abs = (...parts) => path.join(ROOT, ...parts);
const DIST = abs('dist');

/* ------------------------------------ expectations ----------------------------------- */

const TOAST_CSS = 'src/css/toast.css';
const TOAST_JS = 'src/js/toast.js';
const NAMESPACE_JS = 'src/js/namespace.js';
const TOAST_PAGE = 'content/components/toast.md';
const ARTIFACTS = ['static/barnacle.css', 'static/barnacle.min.css', 'static/barnacle.js', 'static/barnacle.min.js'];

/** spec §9: the only capability on the surface besides the version and the registration hook. */
const EXPECTED_SURFACE = ['register', 'toast', 'version'];
const EXPECTED_TOAST_ENTRIES = ['clear', 'el'];
const EXPECTED_VERSION = '0.1.0';

/** spec §8: Toast's element column is `—`; nothing in the markup vocabulary may claim it. */
const FORBIDDEN_ELEMENT = 'bn-toast';

/** spec §7: entry and exit motion is declared only where motion is welcome. */
const MOTION_GUARD = '@media (prefers-reduced-motion: no-preference)';

/** orchestrator §4: components read these slots and never restate a number. */
const REQUIRED_SLOTS = ['var(--_shadow-rest)', 'var(--_press-y)', 'var(--_motion)'];

/** The demo fence on the docs page; the rendering layer injects it with innerHTML. */
const DEMO_BUTTON = /onclick="bn\.toast\(/;
const DEMO_CLASS = 'class="bn-button"';

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

function bytes(rel, base = ROOT) {
  return fs.readFileSync(path.join(base, rel));
}

const argv = process.argv.slice(2);
const SKIP_BROWSER = argv.includes('--no-browser');

console.log(`barnacle toast verification — ${ROOT}\n`);

/* ============================== source contracts (no browser) ========================= */

const css = read(TOAST_CSS);
/** Comments explain the contracts; the structural checks below read the code only. */
const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
const js = read(TOAST_JS).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const namespace = read(NAMESPACE_JS).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

await check('toast.css declares no layer and no !important (CSS_MANIFEST owns its layer)', () => {
  const layer = code.split('\n').find((line) => /^@layer\b/.test(line));
  must(!layer, `toast.css must not declare a layer (found ${JSON.stringify(layer)})`);
  must(!code.includes('!important'), 'toast.css must not use !important (ADR-0006)');
  return 'no @layer, no !important';
});

await check('every motion declaration sits inside the prefers-reduced-motion guard', () => {
  const guard = code.indexOf(MOTION_GUARD);
  must(guard > -1, `toast.css has no ${MOTION_GUARD} block (spec §7)`);
  const early = [];
  for (const match of code.matchAll(/@keyframes\s+([\w-]+)|animation:\s*[^;]+/g)) {
    if (match.index < guard) early.push(match[0].trim());
  }
  must(
    early.length === 0,
    `motion is declared outside the guard: ${early.join(' | ')} — the reduced case must be the ` +
      'absence of a rule, not a rule that turns motion off afterwards',
  );
  for (const name of ['bn-toast-in', 'bn-toast-out']) {
    must(code.includes(name), `toast.css has no ${name} keyframes`);
  }
  return 'bn-toast-in / bn-toast-out declared and used only under the guard';
});

await check('toast.css states no geometry literal and reads the shared slots', () => {
  const literals = [...code.matchAll(/translate[:(]\s*([^;]+);/g)]
    .map((match) => match[1].trim())
    .filter((value) => !value.includes('var(--_'));
  must(
    literals.length === 0,
    `a displacement is not read from a slot: ${literals.join(' | ')} (orchestrator §4)`,
  );
  for (const match of code.matchAll(/box-shadow:\s*([^;]+);/g)) {
    must(
      match[1].trim().startsWith('var('),
      `box-shadow must come from a slot, found ${JSON.stringify(match[1].trim())}`,
    );
  }
  for (const slot of REQUIRED_SLOTS) {
    must(code.includes(slot), `toast.css does not read ${slot} (orchestrator §4)`);
  }
  must(!code.includes('9999'), 'z-index must stay a plain number, not 9999');
  return `${REQUIRED_SLOTS.join(', ')}; no displacement or shadow literal`;
});

await check('the container is transparent to pointers and a single toast is not', () => {
  const container = code.slice(code.indexOf('.bn-toast-container'), code.indexOf('.bn-toast '));
  must(/pointer-events:\s*none/.test(container), 'the container must not eat clicks');
  must(/position:\s*fixed/.test(container), 'the container must be fixed to the viewport');
  must(/inset-block-end:/.test(container) && /inset-inline-end:/.test(container), 'bottom-right anchor');
  must(/z-index:\s*\d+/.test(container), 'the container needs a z-index above page content');

  const toastRule = code.slice(code.indexOf('.bn-toast {'));
  must(/pointer-events:\s*auto/.test(toastRule), 'each toast must be a click target itself');
  must(/box-sizing:\s*border-box/.test(toastRule), 'padding must not push a toast out of the column');
  return 'container none / toast auto, fixed bottom-right, box-sizing: border-box';
});

await check('meaning rides data-variant: no rule here, the theme layer publishes the colour', () => {
  must(
    !/\[data-variant/.test(code),
    'toast.css must not declare [data-variant]: a components-layer declaration of --_variant-color ' +
      'would beat the theme-layer mapping and every variant would fall back',
  );
  must(
    /border-color:\s*var\(--_variant-color,\s*var\(--bn-border-color\)\)/.test(code),
    'the border must consume --_variant-color with a local fallback',
  );
  const theme = read('src/css/01-theme.css');
  for (const name of ['success', 'warning', 'danger', 'error']) {
    must(theme.includes(`data-variant="${name}"`), `01-theme.css does not map ${name}`);
  }
  must(!theme.includes('data-variant="info"'), 'info is not in the data-variant vocabulary (orchestrator §1)');
  return 'theme maps success/warning/danger(+error); toast.css only consumes the slot';
});

await check('toast.js is a plain module: no custom element, no shadow DOM', () => {
  for (const forbidden of ['customElements', 'attachShadow', 'observedAttributes', 'connectedCallback']) {
    must(!js.includes(forbidden), `${TOAST_JS} must not mention ${forbidden} (spec §9)`);
  }
  for (const exported of ['createToast', 'DEFAULT_DURATION', 'export const toast']) {
    must(js.includes(exported), `${TOAST_JS} does not export ${exported}`);
  }
  must(js.includes('toast.el ='), 'toast.el must be part of the surface');
  must(js.includes('toast.clear ='), 'toast.clear must be part of the surface');
  return 'no element, no shadow root, no lifecycle hook';
});

await check('the bundle registers no <bn-toast> element and mounts only the declared capability', () => {
  const entry = read('src/js/index.js');
  must(!entry.includes(FORBIDDEN_ELEMENT), `index.js must not register <${FORBIDDEN_ELEMENT}> (spec §8)`);
  must(/createNamespace\([^)]*\{\s*toast\s*\}\)/.test(entry), 'index.js must mount toast by name');
  must(!namespace.includes('installed'), 'the surface must carry no undeclared marker property');
  must(!/customElements\.define|attachShadow/.test(entry), 'the entry must not touch the DOM directly');
  return 'index.js mounts { toast }; namespace.js keeps its bookkeeping private';
});

await check('all four artifacts carry the toast and none of them leaks attachShadow', () => {
  const cssArtifacts = ARTIFACTS.filter((file) => file.endsWith('.css'));
  const jsArtifacts = ARTIFACTS.filter((file) => file.endsWith('.js'));
  for (const file of cssArtifacts) {
    const text = read(file);
    for (const needle of ['.bn-toast-container', '.bn-toast', 'bn-toast-in', 'bn-toast-out']) {
      must(text.includes(needle), `${file} is missing ${needle}`);
    }
  }
  for (const file of jsArtifacts) {
    const text = read(file);
    must(text.includes('bn-toast-container'), `${file} is missing the toast module`);
    must(!text.includes('attachShadow'), `${file} must not contain attachShadow`);
    must(/\(\(\)\s*=>|\(function\s*\(/.test(text), `${file} is not wrapped in an IIFE`);
  }
  return `${cssArtifacts.length} css + ${jsArtifacts.length} js artifacts, no attachShadow`;
});

await check('npm test names both js test files explicitly', () => {
  const test = JSON.parse(read('package.json')).scripts.test;
  must(test.startsWith('node --test '), `unexpected test script: ${test}`);
  for (const file of ['tests/js/base.test.mjs', 'tests/js/toast.test.mjs']) {
    must(test.includes(file), `npm test does not list ${file}`);
  }
  must(!/node --test\s*$/.test(test), 'a bare `node --test` would sweep up the browser tests');
  return test;
});

await check('the Toast page is authored for the demo layer and stays one H2 deep', () => {
  const raw = bytes(TOAST_PAGE);
  const head = raw.subarray(0, 3);
  must(!(head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf), `${TOAST_PAGE} starts with a BOM`);
  const text = raw.toString('utf8');
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  const heading = body.split(/\r?\n/).find((line) => /^#{1,2}\s/.test(line));
  must(!heading, `a component page body must start at H3 (spec §10), found ${heading}`);
  must(/\n```html\r?\n</.test(body), 'the page has no HTML fence for the preview panel');
  must(DEMO_BUTTON.test(body), 'the demo fence has no clickable bn.toast() trigger');
  must(body.includes(DEMO_CLASS), 'the demo trigger is not a .bn-button');
  must(/bn\.toast\.clear\(\)/.test(body), 'the page does not document clear()');
  must(/5000/.test(body), 'the page does not state the default duration');
  return 'no H1/H2, one html fence with a .bn-button that calls bn.toast()';
});

/**
 * seite renders a fence as a highlighted `<pre>` whose tokens are separate `<span>`s, so the
 * demo source only reassembles once the tags are stripped and the entities decoded. This is the
 * same text a reader sees in the Code panel (ticket 04's `fenceText`).
 */
function fencesText(html) {
  return [...html.matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/g)]
    .map((match) => match[1])
    .join('\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(?:39|x27);/g, "'")
    .replace(/&amp;/g, '&');
}

await check('the built Toast page keeps the fence as code and the template H2', () => {
  const page = 'dist/components/toast.html';
  must(fs.existsSync(abs(page)), `${page} was not built — run seite build first`);
  const html = read(page);
  must(/class="site-prose"/.test(html), `${page} lost its .site-prose body`);
  must(/<pre style="background-color:#2b303b/.test(html), `${page} has no raw seite fence`);

  const source = fencesText(html);
  must(source.includes('<button class="bn-button"'), `${page} does not carry the demo fence as text`);
  must(/onclick="bn\.toast\(/.test(source), `${page} lost the demo trigger in the code panel`);
  must(source.includes('bn.toast.clear()'), `${page} does not show the API fence`);

  const h2 = [...html.matchAll(/<h2\b[^>]*>/g)].map((match) => match[0]);
  must(h2.length === 1 && /data-site-heading=/.test(h2[0]), `${page} does not render exactly one template H2`);
  return 'raw fence + exactly one injected H2';
});

/* ---------------------------------- browser checks ----------------------------------- */

/** Static server on /barnacle, mirroring the deployed sub-path (ticket 04's harness). */
async function startServer() {
  const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.json': 'application/json; charset=utf-8',
  };
  const BASE = '/barnacle';
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    // A script-free probe page for the global-surface enumeration.
    if (urlPath === '/blank.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end('<!DOCTYPE html><html lang="en"><head><title>blank</title></head><body><p>blank</p></body></html>');
      return;
    }
    if (!urlPath.startsWith(BASE)) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('outside base path');
      return;
    }
    let target = urlPath.slice(BASE.length) || '/';
    if (target.endsWith('/')) target += 'index.html';
    const candidates = [target, `${target}.html`, path.join(target, 'index.html')];
    const file = candidates
      .map((candidate) => path.join(DIST, candidate))
      .find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
    if (!file) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end(`not found: ${target}`);
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(fs.readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, base: `${origin}${BASE}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

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
  try {
    await page.goto(`${server.base}/${relPath}`, { waitUntil: 'load' });
    return await fn(page, { consoleErrors, pageErrors });
  } finally {
    await context.close();
  }
}

/** Waits until the entry animation of every live toast has finished, so rects are final. */
async function settle(page) {
  await page.evaluate(() =>
    Promise.all(
      [...document.querySelectorAll('.bn-toast')].flatMap((element) =>
        element.getAnimations().map((animation) => animation.finished.catch(() => {})),
      ),
    ),
  );
}

const BROWSER_CHECKS = [];

function registerBrowserChecks() {
  BROWSER_CHECKS.push(
    [
      'the demo button in the rendered preview panel really shows a toast',
      async (browser, server) => {
        return withPage(browser, server, 'components/toast', {}, async (page, issues) => {
          const demos = await page.locator('[data-site-demo]').count();
          must(demos >= 1, `the demo layer built ${demos} preview panels on the Toast page`);
          const panel = page.locator('[data-site-demo] .site-demo__panel--preview').first();
          const button = panel.locator('button').first();
          must((await button.count()) === 1, 'the preview panel has no demo button');

          // Playwright's click checks actionability: a covered or invisible button fails here.
          await button.click();
          await page.waitForFunction(() => document.querySelectorAll('.bn-toast').length > 0, null, {
            timeout: 3000,
          });
          // The entry animation shifts the box by --bn-press on its way in; measure the final rect.
          await settle(page);

          const state = await page.evaluate(() => {
            const toast = document.querySelector('.bn-toast');
            const container = document.querySelector('.bn-toast-container');
            const panel = document.querySelector('.site-demo__panel--preview');
            const rect = toast.getBoundingClientRect();
            return {
              text: toast.textContent,
              inPanel: panel.contains(toast),
              position: getComputedStyle(container).position,
              containerZ: getComputedStyle(container).zIndex,
              bottomGap: Math.round(window.innerHeight - rect.bottom),
              rightGap: Math.round(window.innerWidth - rect.right),
              count: document.querySelectorAll('.bn-toast').length,
            };
          });
          must(state.text === 'Saved.', `the clicked demo produced ${JSON.stringify(state.text)}`);
          must(!state.inPanel, 'the toast must be a fixed layer, not a child of the preview panel');
          must(state.position === 'fixed', `the container is ${state.position}, not fixed`);
          must(state.containerZ === '100', `the container z-index is ${state.containerZ}`);
          must(state.bottomGap === 16 && state.rightGap === 16, `insets are ${state.bottomGap}/${state.rightGap}`);
          must(state.count === 1, `one click produced ${state.count} toasts`);
          must(issues.consoleErrors.length === 0, `console errors: ${issues.consoleErrors.join(' | ')}`);
          must(issues.pageErrors.length === 0, `page errors: ${issues.pageErrors.join(' | ')}`);
          return 'a real click on the preview button created one fixed toast at the viewport corner';
        });
      },
    ],
    [
      'toasts stack without touching each other or the page underneath',
      async (browser, server) => {
        return withPage(browser, server, 'components/toast', {}, async (page) => {
          await page.evaluate(() => {
            bn.toast.clear();
            // A real interactive element under the fixed layer: the click-through target.
            const probe = document.createElement('button');
            probe.id = 'toast-probe';
            probe.type = 'button';
            probe.setAttribute(
              'style',
              'position:fixed;inset:0;z-index:1;border:0;padding:0;background:transparent;box-shadow:none;color:transparent',
            );
            window.__probeClicks = 0;
            probe.addEventListener('click', () => {
              window.__probeClicks += 1;
            });
            document.body.appendChild(probe);
            bn.toast('One', { duration: 0 });
            bn.toast('Two', { duration: 0 });
            bn.toast('Three', { duration: 0 });
          });
          await settle(page);

          const geometry = await page.evaluate(() => {
            const toasts = [...document.querySelectorAll('.bn-toast')];
            const rects = toasts.map((toast) => toast.getBoundingClientRect());
            const container = document.querySelector('.bn-toast-container').getBoundingClientRect();
            const gaps = rects.slice(1).map((rect, index) => Math.round(rect.top - rects[index].bottom));
            const overlaps = rects.slice(1).map((rect, index) => rect.top < rects[index].bottom);
            const gapPoint = {
              x: Math.round(rects[0].left + 8),
              y: Math.round((rects[0].bottom + rects[1].top) / 2),
            };
            const toastPoint = {
              x: Math.round(rects[0].left + rects[0].width / 2),
              y: Math.round(rects[0].top + rects[0].height / 2),
            };
            return {
              count: toasts.length,
              gaps,
              overlaps,
              gapPoint,
              toastPoint,
              atGap: document.elementFromPoint(gapPoint.x, gapPoint.y)?.id ?? '',
              atToast: document.elementFromPoint(toastPoint.x, toastPoint.y)?.className ?? '',
              viewport: { width: window.innerWidth, height: window.innerHeight },
              container: {
                top: Math.round(container.top),
                right: Math.round(window.innerWidth - container.right),
                bottom: Math.round(window.innerHeight - container.bottom),
                width: Math.round(container.width),
                height: Math.round(container.height),
              },
            };
          });

          must(geometry.count === 3, `expected 3 stacked toasts, found ${geometry.count}`);
          must(!geometry.overlaps.includes(true), 'two toasts overlap');
          must(
            geometry.gaps.every((gap) => gap >= 12 && gap <= 14),
            `the stacking gap is ${geometry.gaps.join('/')} px, expected the 12px flex gap`,
          );
          must(geometry.atGap === 'toast-probe', `the gap between toasts is not click-through (hit ${geometry.atGap})`);
          must(geometry.atToast === 'bn-toast', `a toast is not a click target (hit ${geometry.atToast})`);
          must(
            geometry.container.right === 16 && geometry.container.bottom === 16,
            `the stack is not anchored 16px from the corner (${geometry.container.right}/${geometry.container.bottom})`,
          );
          must(geometry.container.width <= 352, `the column is ${geometry.container.width}px wide`);
          must(
            (geometry.container.width * geometry.container.height) / (geometry.viewport.width * geometry.viewport.height) <
              0.25,
            'the stack covers a quarter of the viewport or more',
          );

          // The same two points, clicked for real: the page underneath must get the click, and a
          // toast must keep the one aimed at itself.
          await page.mouse.click(geometry.gapPoint.x, geometry.gapPoint.y);
          await page.mouse.click(geometry.toastPoint.x, geometry.toastPoint.y);
          const clicks = await page.evaluate(() => window.__probeClicks);
          must(clicks === 1, `the element under the container received ${clicks} clicks, expected exactly 1`);
          return `3 toasts, 12px apart, corner inset 16px, gap click reaches the page, toast click does not`;
        });
      },
    ],
    [
      'clear() empties the stack, waits for the exit animation, and is idempotent',
      async (browser, server) => {
        return withPage(browser, server, 'components/toast', {}, async (page) => {
          const state = await page.evaluate(() => {
            bn.toast('One', { duration: 0 });
            bn.toast('Two', { duration: 0 });
            const first = bn.toast.clear();
            const immediately = document.querySelectorAll('.bn-toast').length;
            const second = bn.toast.clear();
            const closing = document.querySelectorAll('.bn-toast[data-closing]').length;
            return { first, immediately, second, closing, third: bn.toast.clear() };
          });
          must(state.first === 2, `the first clear() closed ${state.first}, expected 2`);
          must(state.immediately === 2, `the exit animation was skipped: ${state.immediately} left immediately`);
          must(state.closing === 2, `${state.closing} toasts were marked [data-closing]`);
          must(state.second === 0 && state.third === 0, 'clear() must be idempotent');

          await page.waitForFunction(
            () => document.querySelectorAll('.bn-toast').length === 0 && !document.querySelector('.bn-toast-container'),
            null,
            { timeout: 3000 },
          );
          return 'clear() reports 2, animates out, empties the document, second call is a no-op';
        });
      },
    ],
    [
      'the auto-dismiss respects the configured duration in a real browser',
      async (browser, server) => {
        return withPage(browser, server, 'components/toast', {}, async (page) => {
          const started = await page.evaluate(() => {
            const at = performance.now();
            bn.toast('Short', { duration: 400 });
            const long = bn.toast('Long', { duration: 60_000 });
            return { at, long: long.textContent };
          });
          must(started.long === 'Long');
          await page.waitForTimeout(150);
          const early = await page.evaluate(() => document.querySelectorAll('.bn-toast').length);
          must(early === 2, `the short toast went early (${early} left)`);
          await page.waitForFunction(
            () => [...document.querySelectorAll('.bn-toast')].every((toast) => toast.textContent === 'Long'),
            null,
            { timeout: 3000 },
          );
          const late = await page.evaluate(() => document.querySelectorAll('.bn-toast').length);
          must(late === 1, `expected only the long-lived toast to remain, found ${late}`);
          await page.evaluate(() => bn.toast.clear());
          return 'a 400ms toast is up at 150ms and gone once its timer fires; the 60s one stays';
        });
      },
    ],
    [
      'with reduced motion the animation is absent and the toast still comes and goes',
      async (browser, server) => {
        return withPage(
          browser,
          server,
          'components/toast',
          { reducedMotion: 'reduce' },
          async (page) => {
            const state = await page.evaluate(() => {
              const toast = bn.toast('Still visible', { duration: 0 });
              const styles = getComputedStyle(toast);
              const rect = toast.getBoundingClientRect();
              // Read everything while the element is still attached: a detached element computes
              // to empty strings, which would make this check measure nothing.
              const animation = styles.animationName;
              const duration = styles.animationDuration;
              const opacity = styles.opacity;
              const animations = toast.getAnimations().length;
              const clearReturn = bn.toast.clear();
              return {
                animation,
                duration,
                animations,
                opacity,
                height: Math.round(rect.height),
                width: Math.round(rect.width),
                clearReturn,
                remaining: document.querySelectorAll('.bn-toast').length,
                container: !!document.querySelector('.bn-toast-container'),
              };
            });
            must(
              state.animations === 0 && state.duration === '0s' && state.animation !== 'bn-toast-in',
              `reduced motion still declares an animation: ${JSON.stringify(state)}`,
            );
            must(state.opacity === '1', `the toast is not fully visible (opacity ${state.opacity})`);
            must(state.height > 0 && state.width > 0, 'the toast has no box under reduced motion');
            must(
              state.clearReturn === 1 && state.remaining === 0 && !state.container,
              `removal waited for an animation that will not play (${JSON.stringify(state)})`,
            );
            return `no animation (${state.animation}/${state.duration}), visible on arrival, removed in the same tick`;
          },
        );
      },
    ],
    [
      'window.bn matches the spec §9 table, item by item, in a browser',
      async (browser, server) => {
        const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        try {
          await page.goto(`${server.origin}/blank.html`, { waitUntil: 'load' });
          const shape = await page.evaluate(async (version) => {
            const before = Object.keys(window);
            await new Promise((resolve, reject) => {
              const script = document.createElement('script');
              script.src = '/barnacle/static/barnacle.js';
              script.onload = resolve;
              script.onerror = () => reject(new Error('barnacle.js failed to load'));
              document.head.appendChild(script);
            });
            const bn = window.bn;
            const capsule = document.createElement('div');
            capsule.className = 'bn-toast';
            document.body.appendChild(capsule);
            const toast = bn.toast('probe');
            const shapeOf = {
              addedGlobals: Object.keys(window).filter((key) => !before.includes(key)),
              bnKeys: Object.keys(bn).sort(),
              bnOwnNames: Object.getOwnPropertyNames(bn).sort(),
              legacyMarker: 'installed' in bn,
              toastEntries: Object.keys(bn.toast).sort(),
              arity: [bn.toast.length, bn.toast.el.length, bn.toast.clear.length],
              version: bn.version,
            };
            bn.toast.clear();
            return shapeOf;
          }, EXPECTED_VERSION);

          must(
            shape.addedGlobals.join(',') === 'bn',
            `loading the bundle added ${shape.addedGlobals.join(', ')} to the global object`,
          );
          must(
            shape.bnKeys.join(',') === EXPECTED_SURFACE.join(','),
            `window.bn is ${shape.bnKeys.join(', ')} — spec §9 declares ${EXPECTED_SURFACE.join(', ')}`,
          );
          must(
            shape.bnOwnNames.join(',') === EXPECTED_SURFACE.join(','),
            `window.bn has hidden own properties: ${shape.bnOwnNames.join(', ')}`,
          );
          must(shape.legacyMarker === false, 'the ticket-18 `installed` marker must be gone (WeakSet)');
          must(
            shape.toastEntries.join(',') === EXPECTED_TOAST_ENTRIES.join(','),
            `toast exposes ${shape.toastEntries.join(', ')}, expected ${EXPECTED_TOAST_ENTRIES.join(', ')}`,
          );
          must(shape.arity.join(',') === '1,1,0', `the entry arities are ${shape.arity.join(',')}`);
          must(shape.version === EXPECTED_VERSION, `version is ${shape.version}`);
          must(errors.length === 0, `page errors: ${errors.join(' | ')}`);
          return `window.bn = {${shape.bnKeys.join(', ')}}, toast = {${shape.toastEntries.join(', ')}}, one global added`;
        } finally {
          await context.close();
        }
      },
    ],
  );
}

async function runBrowserChecks() {
  registerBrowserChecks();
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

await runBrowserChecks();

/* -------------------------------------- summary -------------------------------------- */

console.log(`\n${checks - failures.length}/${checks} checks passed${skips ? `, ${skips} skipped` : ''}`);
if (failures.length > 0) {
  console.log('\nfailed:');
  for (const name of failures) console.log(`  - ${name}`);
  process.exit(1);
}
