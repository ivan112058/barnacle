/**
 * harness.mjs — the browser acceptance harness: real system Chrome, real shipped artifacts,
 * computed styles.
 *
 * What it is for: `scripts/verify*.mjs` check that the *bytes* of the artifact are right;
 * this checks what a browser *computes* from those bytes. Ticket 08 (spec §3 invariants,
 * spec §7 interaction contract, ADR-0003/0004/0006). Ticket 09 rewrites the interaction
 * contract and must be able to say "nothing observable changed" — this is where that is
 * measured.
 *
 * Three anti-flake rules are built into the shared preamble below. Each one was measured, and
 * each one is a *silent* failure mode rather than an occasional one:
 *
 *   1. **Freeze `transition` and `animation` before any assertion.**
 *      Unfrozen, `page.hover()` followed by an immediate read returned the *pre-transition*
 *      value in 30 out of 30 samples (`browser-harness-findings.md` §3.3). It does not look
 *      flaky; it looks like a passing test that is lying. `sleep` cannot replace the freeze,
 *      because the delay + duration is decided by the CSS under test, which the test cannot
 *      know. The freeze is injected through `addInitScript`, i.e. before `goto`: an
 *      `addStyleTag` after load is already too late.
 *
 *   2. **Reach focusable elements with a real keyboard `Tab`.**
 *      `element.focus()` happens to match `:focus-visible` on a freshly loaded page in Chrome
 *      155, but it bypasses the tab order entirely: it passes even when the element is
 *      unreachable by keyboard, and it silently flips once the page has seen a mouse click.
 *      Asserting a focus ring on a `<div>` is equally invalid — `<div>` is not focusable, so
 *      the test would measure the default `outline: none` and prove nothing.
 *
 *   3. **Read every `:hover` value inside one `evaluate`.**
 *      Interleaved `$eval`s do not actually drop the hover state (measured — the original
 *      "hover is broken" report was a probe reading the wrong page object), but one evaluate
 *      gives one style snapshot, one round trip, and — most importantly — lets the read carry
 *      `el.matches(':hover')` as self-evidence, so "the value happened to equal the resting
 *      value" cannot pass as a hover assertion.
 *
 * Two more landmines, guarded here rather than in every test:
 *
 *   - `chromium.launch()` without `channel` fails on this machine: playwright-core 1.64.1 wants
 *     chromium revision 1248 and `%LOCALAPPDATA%\ms-playwright` only has 1223 (playwright
 *     1.60.0, installed by an unrelated repository). `channel: 'chrome'` drives the system
 *     Chrome and downloads nothing; `launchChrome()` explains that in the failure message.
 *   - A page with no favicon makes the browser request `/favicon.ico`, the static server
 *     answers 404, and Chrome logs a `console.error` — which turns "zero console errors" into
 *     noise. Every fixture therefore carries `<link rel="icon" href="data:,">`, and the
 *     request failure is reported through `assertNoPageIssues`.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright-core';

/* ==============================================================================================
 * 0. Where things are
 * ============================================================================================ */

/** Repository root, derived from this file (`tests/browser/harness.mjs`). */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The pages under test. They carry markup only; every style comes from the artifact. */
export const FIXTURE_DIR = path.join(ROOT, 'tests', 'browser', 'fixtures');

/**
 * The published artifact — the bytes a user would download, not a second copy of the sources.
 *
 * `BARNACLE_ARTIFACT_DIR` is the harness's only escape hatch, used by
 * `tests/browser/mutation-sweep.mjs`: it points the *same* test files at a deliberately broken
 * copy of the artifact, which is how "every assertion can actually fail" is demonstrated
 * without ever touching the committed artifact.
 */
export const ARTIFACT_DIR = path.resolve(process.env.BARNACLE_ARTIFACT_DIR ?? path.join(ROOT, 'static'));

/** The site is served from a subpath, the way a GitHub Pages project site is. */
export const BASE_PATH = '/barnacle';

/** The system Chrome is the only browser this harness drives (see the header). */
export const CHROME_CHANNEL = 'chrome';

/* ==============================================================================================
 * 1. A static server on 127.0.0.1:<ephemeral port>, with several mounted roots
 *
 * `file://` is not an option: it has its own load-failure and origin semantics and it cannot
 * serve the artifact from a subpath. Random ports (`listen(0)`) keep concurrent test files from
 * fighting over one, and keep a crashed run from leaving a port in a bad state.
 * ============================================================================================ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/** The two roots of the site: the fixtures at `/barnacle/`, the artifacts at `/barnacle/static/`. */
export function siteMounts({ fixtureDir = FIXTURE_DIR, artifactDir = ARTIFACT_DIR } = {}) {
  return [
    { prefix: '/static', root: artifactDir },
    { prefix: '/', root: fixtureDir },
  ];
}

function normalizePrefix(prefix) {
  if (!prefix.startsWith('/')) throw new Error(`mount prefix must start with "/": ${prefix}`);
  if (prefix.length > 1 && prefix.endsWith('/')) return prefix.slice(0, -1);
  return prefix;
}

/**
 * @param {{mounts: {prefix: string, root: string}[], basePath?: string}} options
 * @returns {Promise<{port: number, origin: string, baseUrl: string, url(rel?: string): string, close(): Promise<void>}>}
 */
export async function startStaticServer({ mounts, basePath = BASE_PATH } = {}) {
  if (!Array.isArray(mounts) || mounts.length === 0) throw new Error('startStaticServer needs at least one mount');
  const base = normalizePrefix(basePath);
  // Longest prefix first, so `/static` wins over `/`.
  const resolved = mounts
    .map(({ prefix, root }) => ({ prefix: normalizePrefix(prefix), root: path.resolve(root) }))
    .sort((a, b) => b.prefix.length - a.prefix.length);

  const server = http.createServer((req, res) => {
    let urlPath;
    try {
      urlPath = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    } catch {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('bad url');
      return;
    }

    // Strip the mount prefix. `basePath` and the roots are decoupled on purpose: pointing a root
    // one level off produces `<element not found>` in every assertion, which reads like a broken
    // selector, so the two are kept independent and obvious.
    let rel;
    if (base === '/') rel = urlPath;
    else if (urlPath === base) rel = '/';
    else if (urlPath.startsWith(base + '/')) rel = urlPath.slice(base.length);
    else {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end(`outside basePath: ${urlPath}`);
      return;
    }

    if (rel.endsWith('/')) rel += 'index.html';
    const mount = resolved.find(({ prefix }) => prefix === '/' || rel === prefix || rel.startsWith(prefix + '/'));
    if (!mount) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end(`no mount for ${rel}`);
      return;
    }
    const sub = mount.prefix === '/' ? rel : rel.slice(mount.prefix.length);
    const abs = path.resolve(mount.root, '.' + sub);

    // Path traversal guard: the mount root is the only reachable tree.
    if (abs !== mount.root && !abs.startsWith(mount.root + path.sep)) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }).end('forbidden');
      return;
    }

    fs.readFile(abs, (error, buffer) => {
      if (error) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end(`not found: ${rel}`);
        return;
      }
      const type = MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream';
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }).end(buffer);
    });
  });

  // An ephemeral port can still be taken by another process between the request and the bind.
  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await new Promise((resolve, reject) => {
        const onError = (error) => {
          server.off('listening', onListening);
          reject(error);
        };
        const onListening = () => {
          server.off('error', onError);
          resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(0, '127.0.0.1');
      });
      lastError = undefined;
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;

  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}`;
  const baseUrl = `${origin}${base === '/' ? '/' : base + '/'}`;

  return {
    port,
    origin,
    baseUrl,
    /** `server.url('button.html')` -> `http://127.0.0.1:<port>/barnacle/button.html`. */
    url(relPath = '') {
      return baseUrl + String(relPath).replace(/^\//, '');
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

/* ==============================================================================================
 * 2. Freezing time — anti-flake rule 1
 * ============================================================================================ */

/**
 * The style injected before the document's first style calculation. `transition: none` makes a
 * post-hover read the end state instead of a sample from the start of a transition; `animation:
 * none` does the same for a keyframe animation; `caret-color` keeps a screenshot-free harness
 * from depending on the caret blink.
 */
export const FREEZE_CSS = `
*, *::before, *::after {
  transition: none !important;
  animation: none !important;
  caret-color: transparent !important;
}
`;

/**
 * The init script. It must be registered on the context (or page) **before** `goto`; an
 * `addStyleTag` after load can already be too late, because the first computed-style read may
 * have sampled the pre-transition value.
 */
export const FREEZE_INIT = (css) => {
  const apply = () => {
    const style = document.createElement('style');
    style.dataset.barnacleHarness = 'freeze';
    style.textContent = css;
    (document.head ?? document.documentElement).appendChild(style);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply, { once: true });
  else apply();
};

/* ==============================================================================================
 * 3. The browser
 * ============================================================================================ */

/**
 * Launch the system Chrome. `channel: 'chrome'` is not a preference here, it is the only way
 * this harness starts: playwright-core 1.64.1 resolves a bundled chromium revision that this
 * machine does not have, and downloading one is explicitly out of scope for the ticket.
 *
 * @param {import('playwright-core').LaunchOptions} [options]
 * @returns {Promise<import('playwright-core').Browser>}
 */
export async function launchChrome(options = {}) {
  try {
    const browser = await chromium.launch({ channel: CHROME_CHANNEL, headless: true, ...options });
    // The version line is the regression baseline for later tickets: computed-value
    // serialisations can change across Chrome majors, so every run states what it measured on.
    console.log(`[browser-harness] chrome ${browser.version()} (channel: ${CHROME_CHANNEL}, headless)`);
    return browser;
  } catch (error) {
    throw new Error(
      [
        `could not launch the system Chrome (channel: '${CHROME_CHANNEL}')`,
        '  - this harness drives the Chrome installed on the machine and downloads nothing;',
        '    the replay browser bundled with playwright-core is deliberately not installed here.',
        '  - check that Google Chrome is installed and up to date, and that no policy blocks',
        '    headless launches.',
        '  - do NOT "fix" this with `npx playwright install`: that downloads a second browser and',
        '    makes the suite measure something other than the machine\'s Chrome.',
        `  original error: ${error.message}`,
      ].join('\n'),
    );
  }
}

/* ==============================================================================================
 * 4. Page issues — console errors and uncaught exceptions are assertion failures
 * ============================================================================================ */

/**
 * `console` events and `pageerror` events are two independent pipelines: the first catches
 * `console.error()`, the second catches an uncaught exception. Registering only one misses
 * half of the failures, so both are collected here, plus failed requests (a 404 stylesheet
 * would otherwise silently turn every style assertion into a UA-default read).
 */
export function collectPageIssues(page) {
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('requestfailed', (request) => {
    const reason = request.failure()?.errorText ?? 'unknown';
    // An aborted request is a navigation detail (a context closing mid-flight), not a page bug.
    if (reason === 'net::ERR_ABORTED') return;
    failedRequests.push(`${request.method()} ${request.url()} — ${reason}`);
  });

  return { consoleErrors, pageErrors, failedRequests };
}

/**
 * A page that is already frozen (unless asked otherwise) and already collecting issues.
 * One page per test, so a failure — or a hover — cannot leak into the next one.
 *
 * `freeze: false` exists for the one kind of assertion the freeze would invalidate: reading the
 * declared `transition` values. `transition: none !important` would make `transition-duration`
 * read `0s` no matter what the artifact says, i.e. an "is the reduced-motion guard in place"
 * test would pass without proving anything.
 *
 * @param {import('playwright-core').Browser} browser
 * @param {{freeze?: boolean} & import('playwright-core').BrowserContextOptions} [options]
 */
export async function newHarnessPage(browser, { freeze = true, ...contextOptions } = {}) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const issues = collectPageIssues(page);
  if (freeze) await context.addInitScript(FREEZE_INIT, FREEZE_CSS);
  return { context, page, issues, close: () => context.close() };
}

/** Navigate and wait for the load event, so every subresource is in before the first read. */
export function navigate(page, url) {
  return page.goto(url, { waitUntil: 'load' });
}

/* ==============================================================================================
 * 5. Assertions that name the invariant they defend
 *
 * A failure must identify the *contract* that broke before it identifies the property: the
 * reader of a red run should learn which invariant is in danger, not that "a string differs".
 * ============================================================================================ */

export class ComputedStyleAssertionError extends Error {
  constructor({ invariant, selector, property, expected, actual, hint }) {
    const lines = [
      `✗ invariant failed: ${invariant}`,
      `    selector : ${selector}`,
      `    property : ${property}`,
      `    expected : ${expected}`,
      `    actual   : ${actual}`,
    ];
    if (hint) lines.push(`    hint     : ${hint}`);
    super(lines.join('\n'));
    this.name = 'ComputedStyleAssertionError';
    Object.assign(this, { invariant, selector, property, expected, actual, hint });
  }
}

/**
 * Only a genuinely fractional length means "the transition was not frozen". Matching a bare
 * `px -3` (an earlier version of this regex) flagged a perfectly ordinary `1px` and produced a
 * misleading hint.
 */
const FRACTIONAL_PX = /\d+\.\d+px/;

/**
 * Compare a value the harness already read (a parsed length, a boolean flag, a media query)
 * against its expectation. `assertComputed` is the same thing for a CSS property read.
 *
 * @returns {unknown} the actual value, so a caller can chain
 */
export function assertValue({ invariant, selector, property, expected, actual, hint }) {
  if (Object.is(actual, expected)) return actual;
  throw new ComputedStyleAssertionError({
    invariant,
    selector,
    property,
    expected: String(expected),
    actual: String(actual),
    hint: hint ?? (FRACTIONAL_PX.test(String(actual)) ? 'a fractional px length usually means the transition was NOT frozen in time' : undefined),
  });
}

/**
 * Read several computed properties of one element **in a single style snapshot**. Every read in
 * this harness goes through here, which is what makes `:hover` reads trustworthy.
 *
 * NOTE for future maintainers: everything inside `page.evaluate` runs in the *browser* and
 * cannot see this module's scope. Referencing a module-level helper in there fails with
 * `ReferenceError: <name> is not defined` raised from the page, with a stack that points at
 * UtilityScript rather than at this file.
 */
export async function readComputed(page, selector, properties) {
  return page.evaluate(
    ([sel, props]) => {
      const element = document.querySelector(sel);
      if (!element) return { found: false };
      const style = getComputedStyle(element);
      /** @type {Record<string, string>} */
      const out = { found: true };
      for (const property of props) out[property] = style[property];
      return out;
    },
    [selector, properties],
  );
}

/** Read one computed property and compare it to `expected`. */
export async function assertComputed(page, selector, property, expected, invariant) {
  const snapshot = await readComputed(page, selector, [property]);
  if (!snapshot.found) {
    throw new ComputedStyleAssertionError({
      invariant,
      selector,
      property,
      expected,
      actual: '<element not found>',
      hint: 'check the selector against the fixture markup — a missing element and a wrong value read very differently to a person but not to a test',
    });
  }
  return assertValue({ invariant, selector, property, expected, actual: snapshot[property] });
}

/** Assert several properties of one element; reports every failure instead of only the first. */
export async function assertComputedAll(page, selector, expectations, invariantPrefix = '') {
  const failures = [];
  for (const [property, expected] of Object.entries(expectations)) {
    try {
      await assertComputed(page, selector, property, expected, `${invariantPrefix}${property}`);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, failures.map((error) => error.message).join('\n\n'));
}

/** The page must have logged nothing and thrown nothing while it was loaded and driven. */
export function assertNoPageIssues(issues, invariant = 'the page loads and runs without an error') {
  const problems = [
    ...issues.consoleErrors.map((text) => `console.error: ${text}`),
    ...issues.pageErrors.map((text) => `pageerror: ${text}`),
    ...issues.failedRequests.map((text) => `request failed: ${text}`),
  ];
  if (problems.length > 0) {
    throw new ComputedStyleAssertionError({
      invariant,
      selector: '<page>',
      property: 'console | pageerror | requestfailed',
      expected: '0 errors',
      actual: `${problems.length} error(s)`,
      hint: `\n      ${problems.join('\n      ')}`,
    });
  }
}

/* ==============================================================================================
 * 6. Driving the page: hover, keyboard focus, token overrides
 * ============================================================================================ */

/**
 * Anti-flake rule 3: hover with the real mouse, then read everything in **one** evaluate, and
 * carry `matches(':hover')` as proof that the read is not a resting value that happens to pass.
 */
export async function readHovered(page, selector, properties) {
  await page.hover(selector);
  const snapshot = await page.evaluate(
    ([sel, props]) => {
      const element = document.querySelector(sel);
      if (!element) return null;
      const style = getComputedStyle(element);
      /** @type {Record<string, string>} */
      const out = { ':hover': String(element.matches(':hover')) };
      for (const property of props) out[property] = style[property];
      return out;
    },
    [selector, properties],
  );
  // Playwright's `hover()` already fails loudly on an unknown selector; this guards the
  // narrower race where the element disappears between the hover and the read, and turns it
  // into the same five-field report as every other failure.
  if (!snapshot) {
    throw new ComputedStyleAssertionError({
      invariant: 'the hovered element exists when its styles are read',
      selector,
      property: '<existence>',
      expected: 'an element matching the selector',
      actual: '<element not found>',
      hint: 'check the selector against the fixture markup',
    });
  }
  return snapshot;
}

/**
 * The geometry of one element, read in a single snapshot: the four lengths of the shadow, the
 * resolved `--bn-shadow-lift`, the 2D matrix, and which interaction states actually match.
 *
 * `--bn-shadow-lift` is read by *using* it in a real property on a hidden probe: an
 * unregistered custom property keeps its `calc()` unevaluated when read back with
 * `getPropertyValue`, so only a real property shows the number the browser will actually use.
 */
export async function readGeometry(page, selector) {
  return page.evaluate((sel) => {
    const element = document.querySelector(sel);
    if (!element) return { found: false };
    const style = getComputedStyle(element);
    const shadow = style.boxShadow;
    const lengths = (shadow.match(/-?[\d.]+px/g) ?? []).map((value) => Number.parseFloat(value));
    const matrix = style.transform;
    const parts = matrix.startsWith('matrix(') ? matrix.slice(7, -1).split(',').map(Number) : [];

    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;inline-size:var(--bn-shadow-lift)';
    document.body.appendChild(probe);
    const lift = Number.parseFloat(getComputedStyle(probe).inlineSize);
    probe.remove();

    return {
      found: true,
      hovered: element.matches(':hover'),
      pressed: element.matches(':active'),
      focusVisible: element.matches(':focus-visible'),
      shadow,
      shadowX: lengths[0],
      shadowY: lengths[1],
      shadowBlur: lengths[2],
      shadowSpread: lengths[3],
      shadowLengths: lengths.length,
      transform: matrix,
      translateX: parts[4] ?? 0,
      translateY: parts[5] ?? 0,
      lift,
    };
  }, selector);
}

/**
 * Anti-flake rule 2: reach the element with a real keyboard `Tab`.
 *
 * The element must be genuinely focusable and genuinely reachable — that is the assertion, not
 * an incidental detail of it. `activeElement` is blurred first (including `<body>`), because a
 * leftover focus makes the first `Tab` land somewhere else and report `actual: BODY`, which is
 * a hard failure to read.
 */
export async function tabTo(page, selector) {
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('Tab');
  const state = await page.evaluate((sel) => {
    const element = document.querySelector(sel);
    return {
      activeTag: document.activeElement?.tagName ?? '<none>',
      activeMatches: document.activeElement === element,
      tabIndex: element?.tabIndex ?? null,
    };
  }, selector);

  if (!state.activeMatches) {
    throw new ComputedStyleAssertionError({
      invariant: 'a real keyboard Tab reaches the element',
      selector,
      property: 'document.activeElement',
      expected: `document.activeElement === ${selector}`,
      actual: `${state.activeTag} (target tabIndex=${state.tabIndex})`,
      hint: 'the element may be unreachable by keyboard, disabled, or preceded by another focusable element in the tab order',
    });
  }
}

/**
 * Override a token on `<html>`. This is the *only* place an override rescales the derived
 * chain: a derived custom property is substituted on the element that declares it, so a
 * `--bn-shadow-x` written on a wrapper is inherited as an already-substituted string and
 * changes nothing (orchestrator-decisions §8, asserted in `theme.test.mjs`).
 */
export function setRootToken(page, token, value) {
  return page.evaluate(([name, v]) => document.documentElement.style.setProperty(name, v), [token, value]);
}

/** The same override, deliberately on the wrong element (the negative control above). */
export function setTokenOn(page, selector, token, value) {
  return page.evaluate(
    ([sel, name, v]) => document.querySelector(sel)?.style.setProperty(name, v),
    [selector, token, value],
  );
}

/** `matchMedia(query).matches` — the only honest way to prove a context option reached the page. */
export function readMedia(page, query) {
  return page.evaluate((q) => matchMedia(q).matches, query);
}
