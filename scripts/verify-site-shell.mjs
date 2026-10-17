#!/usr/bin/env node
/**
 * Scripted verification for the docs-site page shell — the one place where the site and the
 * library disagree about what an `article` is.
 *
 * The defect this file exists for: `article` is the library's card (ADR-0001, spec §5, ticket
 * 10), and `templates/component.html` / `templates/page.html` wrap the *whole page* in
 * `<article class="site-component">` / `<article class="site-page">`. After the card landed, every
 * documentation page therefore inherited the card's 1.5rem padding, 3px structural border, md
 * hard shadow and white second surface — a black-framed page rather than a page. seite's own 404
 * page has the same shape and no class at all (its `<article>` is generated, not written here).
 *
 * The fix is site-side and unlayered (static/style.css): a shell reset that outranks the
 * library's layers by origin, which is exactly the override contract ADR-0006 publishes. Nothing
 * is added to the library — a `:not(.site-*)` inside a component would couple the library to this
 * one site.
 *
 * The checks, in the order they build on each other:
 *
 *   1. static/style.css carries the reset, unlayered and without `!important`, and the library
 *      sources stay free of `site-` (the fix never reached across);
 *   2. the templates keep the shell on `article.site-*` and no template opens a bare `<article>`
 *      page shell of its own;
 *   3. `seite build` exits 0 and the built pages match a complete shell inventory — every page
 *      accounted for, seite's 404 the only classless shell;
 *   4. real Chrome: every shell-bearing built page computes *no card box* — `box-shadow: none`,
 *      four zero border widths, zero padding, no background image, a transparent background;
 *   5. real Chrome: a demo card inside a Preview panel is **still a card** — the control that
 *      proves the reset is scoped to the shell rather than to `article`;
 *   6. the same two readings under the dark theme, so the reset is proven theme-independent;
 *   7. the site's own gutter survives: the shell sits exactly on `.site-main`'s content edge and
 *      `.site-main` keeps the `clamp()` padding ticket 17 handed it (the shell's zero padding must
 *      not eat the page margin).
 *
 * Run with: node scripts/verify-site-shell.mjs
 * Options:  --no-build   assume dist/ is current (skips the seite build)
 *           --no-browser skip the real-Chrome checks (they need playwright-core)
 *
 * Run `npm run build` first: the checks that read static/ artifacts and dist/ need both.
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

const SITE_CSS = 'static/style.css';

/**
 * The shell selectors, as the two halves of the contract:
 *
 *   - `.site-component` / `.site-page` are the shells the templates write;
 *   - `.site-main > article` is the classless shell seite generates for 404.html. It is named by
 *     its *position* because there is no class to name it by, and the position is honest: the
 *     site's page shell is the one direct `article` child of the container. A demo card can never
 *     match it — the Preview panel sits between `.site-main` and the card — so the selector
 *     cannot swallow the very control check 5 measures.
 */
const SHELL_SELECTORS = ['.site-component', '.site-page', '.site-main > article'];

/**
 * The declarations the site writes to take the card box back, plus the radius the card also sets
 * (0 in the current theme, reset here so a future `--bn-radius` cannot round the page shell).
 */
const SHELL_DECLARATIONS = {
  'border-width': '0',
  'box-shadow': 'none',
  padding: '0',
  background: 'none',
  'border-radius': '0',
};

/** What a shell must compute. Chrome's serialisations, read as longhands where it matters. */
const SHELL_COMPUTED = Object.freeze({
  boxShadow: 'none',
  borderTopWidth: '0px',
  borderRightWidth: '0px',
  borderBottomWidth: '0px',
  borderLeftWidth: '0px',
  paddingTop: '0px',
  paddingRight: '0px',
  paddingBottom: '0px',
  paddingLeft: '0px',
  backgroundImage: 'none',
  backgroundColor: 'rgba(0, 0, 0, 0)',
  borderRadius: '0px',
});

/** What `.site-main` must compute on a page whose shell is the container itself (no article). */
const CONTAINER_COMPUTED = Object.freeze({
  boxShadow: 'none',
  borderTopWidth: '0px',
  borderRightWidth: '0px',
  borderBottomWidth: '0px',
  borderLeftWidth: '0px',
  backgroundImage: 'none',
});

/**
 * The control: a card inside a Preview panel is the library's own rendering (ticket 04 injects it
 * from a fence verbatim), so it must keep the card box — spec §6.1's 3px border, 1.5rem padding
 * and md hard shadow, on the second surface. Light values first; the dark pair is below.
 */
const DEMO_CARD_LIGHT = Object.freeze({
  boxShadow: 'rgb(0, 0, 0) 4px 4px 0px 0px',
  borderTopWidth: '3px',
  borderRightWidth: '3px',
  borderBottomWidth: '3px',
  borderLeftWidth: '3px',
  paddingTop: '24px',
  paddingRight: '24px',
  paddingBottom: '24px',
  paddingLeft: '24px',
  backgroundColor: 'rgb(255, 255, 255)',
});

const DEMO_CARD_DARK = Object.freeze({
  ...DEMO_CARD_LIGHT,
  boxShadow: 'rgb(255, 253, 245) 4px 4px 0px 0px',
  backgroundColor: 'rgb(38, 38, 38)',
});

/** spec.md §4 / ticket 17: the site width and the gutter both live in static/style.css. */
const SITE_WIDTH_REM = 62;
const SITE_PAD = Object.freeze({ min: 1, max: 2, vw: 4 });

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

const read = (relative) => fs.readFileSync(abs(relative), 'utf8');
const exists = (relative) => fs.existsSync(abs(relative));

function locateSeite() {
  const candidates = [process.env.SEITE_BIN, 'D:\\sdk\\seite\\seite.exe', 'seite'].filter(Boolean);
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
    if (probe.status === 0) return { bin: candidate, version: (probe.stdout ?? '').trim() };
  }
  return null;
}

/** A stylesheet with its comments removed: a selector quoted in a comment is documentation. */
const withoutComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Every top-level `selector { body }` pair in a stylesheet, comments stripped. */
function rules(css) {
  return [...withoutComments(css).matchAll(/(?<=\}|^)\s*([^{}@][^{}]*?)\s*\{([^{}]*?)\}(?!\s*[;}])/g)].map(
    (match) => ({ selector: match[1].replace(/\s+/g, ' ').trim(), body: match[2] }),
  );
}

const rel = (full) => path.relative(ROOT, full).split(path.sep).join('/');

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/**
 * The shell inventory, derived from the content collections rather than hardcoded: one component
 * page per `content/components/*.md` (except the index), one plain page per `content/pages/*.md`
 * (except the homepage), plus the homepage, the collection index and seite's 404.
 *
 * `kind` says what the built page must contain:
 *   component    `<article class="site-component">`
 *   page         `<article class="site-page">`
 *   seite-404    `<article>` with no class (seite generates it)
 *   none         no `article` shell at all; `.site-main` is the page shell
 */
function shellInventory() {
  const pages = new Map();
  const slugs = (dir) =>
    fs
      .readdirSync(abs(dir))
      .filter((file) => file.endsWith('.md') && file !== 'index.md')
      .map((file) => file.slice(0, -3));

  for (const slug of slugs('content/components')) pages.set(`components/${slug}.html`, 'component');
  for (const slug of slugs('content/pages')) pages.set(`${slug}.html`, 'page');
  pages.set('index.html', 'none');
  pages.set('components/index.html', 'none');
  pages.set('404.html', 'seite-404');
  return pages;
}

const SHELL_FOR_KIND = {
  component: '.site-component',
  page: '.site-page',
  'seite-404': '.site-main > article',
};

/* -------------------------------------- arguments ------------------------------------ */

const SEITE = locateSeite();
if (!SEITE) {
  console.error('seite CLI not found. Set SEITE_BIN or install seite 0.20.1.');
  process.exit(1);
}

const argv = process.argv.slice(2);
const SKIP_BUILD = argv.includes('--no-build');
const SKIP_BROWSER = argv.includes('--no-browser');

console.log(`barnacle docs-site page-shell verification — ${ROOT}`);
console.log(`CLI: ${SEITE.version} at ${SEITE.bin}\n`);

/* ================================ the site-side rule ================================ */

await check('static/style.css resets the card box on the page shell, unlayered and without !important', () => {
  const css = read(SITE_CSS);
  const shellRules = new Map();

  for (const selector of SHELL_SELECTORS) {
    const matching = rules(css).filter((rule) =>
      rule.selector.split(',').map((part) => part.trim()).includes(selector),
    );
    must(
      matching.length >= 1,
      `${SITE_CSS} carries no rule naming ${selector} — the page shell would be a card again`,
    );
    for (const rule of matching) shellRules.set(rule.selector, rule);
  }

  for (const [selector, rule] of shellRules) {
    for (const [property, value] of Object.entries(SHELL_DECLARATIONS)) {
      const declared = new RegExp(`(?:^|[;{])\\s*${property}\\s*:\\s*([^;]*)`, 'i').exec(rule.body);
      must(declared, `${SITE_CSS}: "${selector}" does not declare ${property}`);
      must(
        declared[1].trim().toLowerCase() === value,
        `${SITE_CSS}: "${selector}" sets ${property}: ${declared[1].trim()} (expected ${value})`,
      );
    }
  }

  const important = [...shellRules.values()].filter((rule) => /!important/i.test(rule.body));
  must(
    important.length === 0,
    `the shell reset must win by origin (ADR-0006), not by !important: ${important.map((r) => r.selector).join(', ')}`,
  );
  must(
    !/@layer\b/.test(withoutComments(css)),
    `${SITE_CSS} must stay unlayered — an unlayered declaration is what outranks every library layer`,
  );
  return `${shellRules.size} unlayered rule(s): ${[...shellRules.keys()].join(' | ')}`;
});

await check('the fix is site-side: no library source or artifact knows the site namespace', () => {
  const library = [...walk(abs('src/css')).map(rel), 'static/barnacle.css', 'static/barnacle.min.css'];
  const leaks = library.filter((file) => /site-component|site-page|:not\(\.site-/.test(read(file)));
  must(
    leaks.length === 0,
    `the library must not learn about the docs site (a :not(.site-*) there would couple them): ${leaks.join(', ')}`,
  );
  return `${library.length} library files, zero site-component/site-page/:not(.site-*) references`;
});

await check('the templates keep the shell on article.site-*, and no template opens a bare article shell', () => {
  const component = read('templates/component.html');
  const page = read('templates/page.html');
  must(
    /<article class="site-component">/.test(component),
    'templates/component.html no longer wraps the page in <article class="site-component">',
  );
  must(
    /<article class="site-page">/.test(page),
    'templates/page.html no longer wraps the page in <article class="site-page">',
  );

  const problems = [];
  const templates = walk(abs('templates')).map(rel);
  for (const file of templates) {
    for (const tag of read(file).matchAll(/<article\b[^>]*>/g)) {
      if (!/class="site-(component|page)"/.test(tag[0])) {
        problems.push(`${file}: ${tag[0]} is a bare article page shell (the library would paint it as a card)`);
      }
    }
  }
  for (const file of ['templates/index.html', 'templates/components-index.html']) {
    must(
      !/<article\b/.test(read(file)),
      `${file} must not use the library's card element as its page shell — it has no shell element at all`,
    );
  }
  must(problems.length === 0, `\n  ${problems.join('\n  ')}`);
  return `${templates.length} templates; component.html + page.html are the only article shells`;
});

/* ============================== the site, built ====================================== */

await check('seite build exits 0 (dist/ current for the browser checks)', () => {
  if (SKIP_BUILD) {
    must(exists('dist'), 'dist/ is missing and --no-build was passed');
    return 'skipped (--no-build)';
  }
  const result = spawnSync(SEITE.bin, ['build', '--dir', ROOT], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120_000,
    env: { ...process.env, SEITE_YES: '1' },
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  must(result.status === 0, `exit ${result.status}:\n${output.trim()}`);
  const summary = output.split('\n').find((line) => /Built\b/.test(line));
  must(summary, `no build summary in:\n${output.trim()}`);
  return summary.trim();
});

await check('every built page matches the shell inventory — seite 404 is the only classless shell', () => {
  const expected = shellInventory();
  const built = walk(DIST)
    .filter((file) => file.endsWith('.html'))
    .map((file) => path.relative(DIST, file).split(path.sep).join('/'));

  const problems = [];
  for (const page of built) {
    if (!expected.has(page)) problems.push(`${page} was built but is not in the shell inventory`);
  }
  const seen = { component: 0, page: 0, 'seite-404': 0, none: 0 };
  for (const [page, kind] of expected) {
    if (!exists(`dist/${page}`)) {
      problems.push(`${page} was not built`);
      continue;
    }
    const articles = [...read(`dist/${page}`).matchAll(/<article\b[^>]*>/g)].map((match) => match[0]);
    if (kind === 'none') {
      if (articles.length > 0) problems.push(`${page}: expected no article shell, found ${articles.join(', ')}`);
    } else if (kind === 'seite-404') {
      if (articles.length !== 1 || articles[0] !== '<article>') {
        problems.push(`${page}: expected seite's bare <article>, found ${articles.join(' | ') || '<none>'}`);
      }
    } else {
      const want = `<article class="site-${kind}">`;
      if (articles.length !== 1 || articles[0] !== want) {
        problems.push(`${page}: expected ${want}, found ${articles.join(' | ') || '<none>'}`);
      }
    }
    seen[kind] += 1;
  }
  must(problems.length === 0, `\n  ${problems.join('\n  ')}`);
  return `${built.length} pages: ${seen.component} component + ${seen.page} plain + seite 404 + ${seen.none} shell-less`;
});

/* ---------------------------------- browser checks ----------------------------------- */

const BROWSER_CHECKS = [];

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

/**
 * dist/ under the production sub-path, plus a route for the absolute production origin the built
 * pages reference for their assets — which is also what proves the assets really load.
 */
async function startServer() {
  const BASE = '/barnacle';
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    if (!urlPath.startsWith(BASE)) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('outside base path');
      return;
    }
    const relPath = urlPath.slice(BASE.length) || '/';
    const candidates = [
      path.join(DIST, relPath),
      path.join(DIST, `${relPath}.html`),
      path.join(DIST, relPath, 'index.html'),
      path.join(DIST, `${relPath}index.html`),
    ];
    const file = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
    if (!file) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end(`not found: ${relPath}`);
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
  return {
    origin,
    base: `${origin}${BASE}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** Frozen transition/animation, injected before `goto` (a mid-transition read lies). */
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

async function withPage(browser, server, relPath, options, fn) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...options });
  const consoleErrors = [];
  const pageErrors = [];
  await context.route('https://ivan112058.github.io/barnacle/**', (route) => {
    const target = new URL(route.request().url()).pathname.replace(/^\/barnacle/, '') || '/';
    route.fulfill({ path: path.join(DIST, target === '/' ? 'index.html' : target) });
  });
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.addInitScript(FREEZE_INIT, FREEZE_CSS);
  try {
    await page.goto(`${server.base}/${relPath}`, { waitUntil: 'load' });
    return await fn(page, { consoleErrors, pageErrors });
  } finally {
    await context.close();
  }
}

/** Read a set of computed properties of one element, in one style snapshot. */
function readStyle(page, selector, properties) {
  return page.evaluate(
    ([sel, props]) => {
      const element = document.querySelector(sel);
      if (!element) return { found: false };
      const style = getComputedStyle(element);
      const out = { found: true };
      for (const property of props) out[property] = style[property];
      return out;
    },
    [selector, properties],
  );
}

/** Compare a read object against expectations, naming the contract and the property that broke. */
function expectStyle(label, actual, expectations) {
  const problems = [];
  for (const [property, expected] of Object.entries(expectations)) {
    if (actual[property] !== expected) {
      problems.push(`${label}: ${property} reads "${actual[property]}" (expected "${expected}")`);
    }
  }
  must(problems.length === 0, `\n  ${problems.join('\n  ')}`);
}

function registerBrowserChecks() {
  BROWSER_CHECKS.push([
    'real Chrome: no built page hands its shell the card box — every page, not a sample',
    async (browser, server) => {
      const expected = shellInventory();
      const readings = [];
      for (const [page, kind] of expected) {
        const selector = SHELL_FOR_KIND[kind] ?? '.site-main';
        const wanted = kind === 'none' ? CONTAINER_COMPUTED : SHELL_COMPUTED;
        const measured = await withPage(browser, server, page, {}, async (browserPage, issues) => {
          const style = await readStyle(browserPage, selector, Object.keys(wanted));
          return { style, issues };
        });
        must(measured.style.found, `${page}: no element matches the page shell selector ${selector}`);
        expectStyle(`${page} (${selector})`, measured.style, wanted);
        must(
          measured.issues.consoleErrors.length === 0 && measured.issues.pageErrors.length === 0,
          `${page} logged an error while being measured: ${[...measured.issues.consoleErrors, ...measured.issues.pageErrors].join(' | ')}`,
        );
        readings.push(
          `${page}: shadow ${measured.style.boxShadow}, border ${measured.style.borderTopWidth ?? '-'}, pad ${measured.style.paddingTop ?? '-'}, bg ${measured.style.backgroundColor ?? '-'}`,
        );
      }
      return `${expected.size} pages measured in one pass — ${readings.join('; ')}`;
    },
  ]);

  BROWSER_CHECKS.push([
    'real Chrome: a demo card inside a Preview panel is still a card (the control)',
    async (browser, server) => {
      return withPage(browser, server, 'components/card.html', {}, async (page) => {
        const demo = await page.evaluate(() => {
          const article = document.querySelector('.site-demo__panel--preview article');
          if (!article) return { found: false };
          const style = getComputedStyle(article);
          return {
            found: true,
            // Self-evidence that this is the library's rendering and not the page shell: it sits
            // inside a Preview panel, and it does not match any shell selector.
            inPreview: Boolean(article.closest('.site-demo__panel--preview')),
            isShell: article.matches('.site-component, .site-page, .site-main > article'),
            previews: document.querySelectorAll('.site-demo__panel--preview article').length,
            boxShadow: style.boxShadow,
            borderTopWidth: style.borderTopWidth,
            borderRightWidth: style.borderRightWidth,
            borderBottomWidth: style.borderBottomWidth,
            borderLeftWidth: style.borderLeftWidth,
            paddingTop: style.paddingTop,
            paddingRight: style.paddingRight,
            paddingBottom: style.paddingBottom,
            paddingLeft: style.paddingLeft,
            backgroundColor: style.backgroundColor,
          };
        });
        must(demo.found, 'components/card.html no longer renders an <article> demo in a Preview panel');
        must(demo.inPreview, 'the measured article is not inside a Preview panel — it is not the library rendering');
        must(!demo.isShell, 'the measured article also matches a page-shell selector — the control is compromised');
        expectStyle('the demo card', demo, DEMO_CARD_LIGHT);
        return `${demo.previews} demo card(s) in Preview panels; card ${demo.boxShadow}, border ${demo.borderTopWidth}, padding ${demo.paddingTop}, bg ${demo.backgroundColor}`;
      });
    },
  ]);

  BROWSER_CHECKS.push([
    'real Chrome: the reset is theme-independent — dark shell still reset, dark demo card still a card',
    async (browser, server) => {
      return withPage(browser, server, 'components/card.html', {}, async (page) => {
        const state = await page.evaluate(() => {
          document.documentElement.dataset.theme = 'dark';
          const shell = getComputedStyle(document.querySelector('.site-component'));
          const card = getComputedStyle(document.querySelector('.site-demo__panel--preview article'));
          return {
            theme: document.documentElement.getAttribute('data-theme'),
            shell: {
              boxShadow: shell.boxShadow,
              borderTopWidth: shell.borderTopWidth,
              paddingTop: shell.paddingTop,
              backgroundColor: shell.backgroundColor,
            },
            card: {
              boxShadow: card.boxShadow,
              borderTopWidth: card.borderTopWidth,
              paddingTop: card.paddingTop,
              backgroundColor: card.backgroundColor,
            },
          };
        });
        must(state.theme === 'dark', 'the dark theme did not reach <html>');
        expectStyle('the dark page shell', state.shell, {
          boxShadow: 'none',
          borderTopWidth: '0px',
          paddingTop: '0px',
          backgroundColor: 'rgba(0, 0, 0, 0)',
        });
        expectStyle('the dark demo card', state.card, {
          boxShadow: DEMO_CARD_DARK.boxShadow,
          borderTopWidth: DEMO_CARD_DARK.borderTopWidth,
          paddingTop: DEMO_CARD_DARK.paddingTop,
          backgroundColor: DEMO_CARD_DARK.backgroundColor,
        });
        return `shell ${state.shell.boxShadow} / padding ${state.shell.paddingTop}; card ${state.card.boxShadow} on ${state.card.backgroundColor}`;
      });
    },
  ]);

  BROWSER_CHECKS.push([
    "real Chrome: the shell's zero padding does not eat the site gutter (ticket 17's clamp)",
    async (browser, server) => {
      return withPage(browser, server, 'components/button.html', {}, async (page) => {
        const state = await page.evaluate(() => {
          const main = document.querySelector('.site-main');
          const shell = document.querySelector('.site-component');
          const mainStyle = getComputedStyle(main);
          const mainBox = main.getBoundingClientRect();
          const shellBox = shell.getBoundingClientRect();
          return {
            viewport: window.innerWidth,
            sitePad: mainStyle.paddingLeft,
            mainWidth: Math.round(mainBox.width),
            mainLeft: mainBox.left,
            mainRight: mainBox.right,
            shellLeft: shellBox.left,
            shellRight: shellBox.right,
            shellWidth: Math.round(shellBox.width),
            proseWidth: Math.round(document.querySelector('.site-prose').getBoundingClientRect().width),
            overflow: document.documentElement.scrollWidth - window.innerWidth,
          };
        });
        // clamp(1rem, 4vw, 2rem) at a 1280px viewport: 4vw = 51.2px, capped at 2rem = 32px.
        const expectedPad = Math.round(
          Math.min(Math.max(SITE_PAD.min * 16, (state.viewport * SITE_PAD.vw) / 100), SITE_PAD.max * 16),
        );
        const problems = [];
        const pad = parseFloat(state.sitePad);
        if (pad !== expectedPad) {
          problems.push(`.site-main padding-inline is ${state.sitePad}, expected ${expectedPad}px at ${state.viewport}px`);
        }
        if (Math.abs(state.shellLeft - (state.mainLeft + pad)) > 0.5) {
          problems.push(`the shell starts at ${state.shellLeft}, not on .site-main's content edge`);
        }
        if (Math.abs(state.shellRight - (state.mainRight - pad)) > 0.5) {
          problems.push(`the shell ends at ${state.shellRight}, not on .site-main's content edge`);
        }
        if (state.mainWidth > SITE_WIDTH_REM * 16 + 1) {
          problems.push(`.site-main is ${state.mainWidth}px wide, past ${SITE_WIDTH_REM}rem`);
        }
        if (state.overflow > 0) problems.push(`the page overflows the viewport by ${state.overflow}px`);
        must(problems.length === 0, `\n  ${problems.join('\n  ')}`);
        return `main ${state.mainWidth}px with ${state.sitePad} padding, shell ${state.shellWidth}px on the content edge, prose ${state.proseWidth}px, overflow ${state.overflow}`;
      });
    },
  ]);
}

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
    console.log(`SKIP  ${BROWSER_CHECKS.length} browser checks — playwright-core is not installed`);
    return;
  }
  const server = await startServer();
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
