#!/usr/bin/env node
/**
 * Scripted verification for ticket 20 — Tabs and its JavaScript.
 *
 * The three verification methods in `.scratch/barnacle-design/issues/20-tabs.md` are the
 * specification of this file, and each one is a check below:
 *
 *   1. work the tab strip with the keyboard alone: focus, selection, roving tabindex and the
 *      focus ring all measured in real Chrome against the shipped artifact
 *   2. load the documentation page with JavaScript switched off and read every panel
 *   3. listen for the switch event and inspect its `detail` and its bubble/compose flags
 *
 * Two more checks exist because ticket 20 makes claims a regex cannot settle:
 *
 *   4. the library styles its own element and nothing else. The docs site builds its own
 *      Preview / Code pairs out of `role="tab"` / `role="tabpanel"`, so a rule written on the bare
 *      role would reach into a foreign strip. The fixture therefore carries a second, foreign tab
 *      set next to the `<bn-tabs>` one and measures both.
 *   5. motion, geometry and naming hygiene of `src/css/tabs.css`, which is the same contract
 *      ticket 07's verifier holds Button to (spec §3 invariants, orchestrator-decisions §4).
 *
 * The expected values are the independent source of truth: spec.md §3 (invariants), §6 (tokens),
 * §7 (the interaction contract), §8 (Tabs semantics), §9 (JS architecture), ADR-0002 (shallow DOM),
 * ADR-0005 (the two namespaces) and D:\code\barnacle-notes\orchestrator-decisions.md §1/§4/§6.
 * They are never recomputed from `src/css/tabs.css` or `src/js/tabs.js`.
 *
 * Run with: node scripts/verify-tabs.mjs
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
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { blankComments, declarations, matchBrace, parseRules } from './lib/css.mjs';
import { FROZEN_SLOTS, HYGIENE, PUBLIC_TOKENS } from './lib/tokens.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const abs = (...parts) => path.join(ROOT, ...parts);
const DIST = abs('dist');

/* ------------------------------------ expectations ----------------------------------- */

const SOURCE = 'src/css/tabs.css';
const SCRIPT = 'src/js/tabs.js';
const ENTRY = 'src/js/index.js';
const ARTIFACT = 'static/barnacle.css';
const JS_ARTIFACT = 'static/barnacle.js';
const CONTENT = 'content/components/tabs.md';
const PAGE = 'dist/components/tabs.html';

/** spec §9: the one event `<bn-tabs>` announces, and the payload ticket 20 specifies. */
const EVENT = 'bn:change';
const DETAIL_KEYS = ['index', 'tab', 'panel'];

const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(|\bcolor\(/;
const GEOMETRY_PROPERTIES = [
  'transform', 'translate', 'box-shadow', 'outline', 'outline-offset', 'transition',
  'transition-property', 'transition-duration',
];
const STATE_PROPERTIES = new Set([
  'transform', 'box-shadow', 'border-color', 'border-top-color', 'border-right-color',
  'border-bottom-color', 'border-left-color', 'background', 'background-color', 'color', 'outline',
  'outline-offset', 'outline-color', 'opacity', 'cursor', 'text-decoration-color',
]);
const STATE_SELECTOR = /:(?:hover|active|focus-visible)\b/;

/** The fence info strings ticket 04's layer accepts: a bare language token, nothing else. */
const ALLOWED_FENCE_INFO = /^(?:html|css|js|javascript|json|xml|svg|text|txt|markdown|md|powershell|ps1|sh|bash|shell|console|diff)?$/;

/** Measured values, spec §6.1 + §7: 3px border, sm rest → md hover, 3px ring, 0.15s motion. */
const BORDER_PX = '3px';
const SHADOW_MD = 'rgb(0, 0, 0) 4px 4px 0px 0px';
const SHADOW_SM = 'rgb(0, 0, 0) 2px 2px 0px 0px';
const MAIN_SURFACE = 'rgb(255, 210, 63)';
const SECONDARY_SURFACE = 'rgb(255, 255, 255)';
const INK = 'rgb(0, 0, 0)';
const RING_COLOR = 'rgb(116, 185, 255)';
const HOVER_TRANSFORM = 'matrix(1, 0, 0, 1, -2, -2)';

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

const read = (rel, base = ROOT) => fs.readFileSync(path.join(base, rel), 'utf8');

/** The fenced code blocks of a Markdown file, with their info strings. */
function fences(markdown) {
  const body = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  const found = [];
  let open = null;
  for (const line of body.split(/\r?\n/)) {
    const marker = line.match(/^(\s*)(`{3,}|~{3,})(.*)$/);
    if (!open) {
      if (marker && marker[1] === '') open = { info: marker[3].trim(), lines: [] };
      continue;
    }
    if (marker && marker[1] === '' && marker[2][0] === '`') {
      found.push({ info: open.info, text: open.lines.join('\n') });
      open = null;
      continue;
    }
    open.lines.push(line);
  }
  if (open) found.push({ info: open.info, text: open.lines.join('\n'), unterminated: true });
  return found;
}

/* -------------------------------------- the page -------------------------------------- */

/**
 * The measurement page. `#tabs` is the first focusable thing on it, so one keyboard Tab reaches
 * the selected tab.
 *
 * `#foreign` is the scoping probe: the same two roles, written outside `<bn-tabs>`, on elements the
 * library has no business dressing (`<span>`, not `<button>` — a bare button is styled by Button on
 * purpose, ADR-0001, which would confound the measurement). Nothing in it may pick up a tab shape,
 * a panel frame, a panel margin or a tablist layout from tabs.css.
 *
 * No `<script>` tag: the library is loaded with `addScriptTag`, so the fixture can never depend on
 * something the artifact does not do — and the same page, loaded with no script at all, is the
 * no-JavaScript probe.
 */
const FIXTURE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <link rel="icon" href="data:,">
    <title>barnacle tabs harness</title>
    <link rel="stylesheet" href="/static/barnacle.css">
  </head>
  <body>
    <main>
      <bn-tabs id="tabs">
        <div role="tablist" aria-label="Account settings">
          <button type="button" role="tab" id="tab-0" aria-controls="panel-0" aria-selected="true">Profile</button>
          <button type="button" role="tab" id="tab-1" aria-controls="panel-1">Billing</button>
          <button type="button" role="tab" id="tab-2" aria-controls="panel-2">Danger zone</button>
        </div>
        <div role="tabpanel" id="panel-0" aria-labelledby="tab-0"><p>Panel profile.</p></div>
        <div role="tabpanel" id="panel-1" aria-labelledby="tab-1"><p>Panel billing.</p></div>
        <div role="tabpanel" id="panel-2" aria-labelledby="tab-2"><p>Panel danger.</p></div>
      </bn-tabs>

      <div id="foreign">
        <div role="tablist" aria-label="Preview / Code">
          <span role="tab" id="foreign-tab-0" aria-controls="foreign-panel-0" aria-selected="true">Preview</span>
          <span role="tab" id="foreign-tab-1" aria-controls="foreign-panel-1">Code</span>
        </div>
        <div role="tabpanel" id="foreign-panel-0"><p>Foreign preview.</p></div>
        <div role="tabpanel" id="foreign-panel-1" hidden><p>Foreign code.</p></div>
      </div>
    </main>
  </body>
</html>
`;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * One server, two mounts: the harness and the published artifact from `static/`, and the built
 * documentation site from `dist/` under the deployed `/barnacle` sub-path.
 */
async function startServer() {
  const staticRoot = abs('static');
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    const send = (file) => {
      fs.readFile(file, (error, buffer) => {
        if (error) {
          res.writeHead(404, { 'content-type': 'text/plain' }).end(`not found: ${urlPath}`);
          return;
        }
        res.writeHead(200, {
          'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
          'cache-control': 'no-store',
        });
        res.end(buffer);
      });
    };

    if (urlPath === '/harness.html') {
      res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' });
      res.end(FIXTURE);
      return;
    }
    if (urlPath.startsWith('/static/')) {
      const file = path.resolve(staticRoot, `.${urlPath.replace(/^\/static/, '')}`);
      if (file.startsWith(staticRoot + path.sep)) {
        send(file);
        return;
      }
    }
    if (urlPath.startsWith('/barnacle')) {
      let target = urlPath.slice('/barnacle'.length) || '/';
      if (target.endsWith('/')) target += 'index.html';
      const candidates = [target, `${target}.html`, path.join(target, 'index.html')];
      const file = candidates
        .map((candidate) => path.join(DIST, candidate))
        .find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
      if (file) {
        send(file);
        return;
      }
    }
    res.writeHead(404, { 'content-type': 'text/plain' }).end(`not found: ${urlPath}`);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    harness: `${origin}/harness.html`,
    docs: `${origin}/barnacle/components/tabs`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/**
 * A mid-transition read lies in a very believable way (browser-harness-findings §3.3), so the
 * transitions are frozen before `goto`. `page.keyboard.press('Tab')` is used for focus, never
 * `element.focus()`: only the real keyboard matches `:focus-visible`.
 */
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

async function withPage(browser, url, options, fn) {
  const { libraries = [], ...contextOptions } = options ?? {};
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...contextOptions });
  // The built pages carry absolute production asset URLs; answer them from dist/ (spec §12), so
  // the documentation check also proves the sub-path deployment shape.
  await context.route('https://ivan112058.github.io/barnacle/**', (route) => {
    const target = new URL(route.request().url()).pathname.replace(/^\/barnacle/, '') || '/';
    route.fulfill({ path: path.join(DIST, target === '/' ? 'index.html' : target) });
  });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  if (contextOptions.javaScriptEnabled !== false) await page.addInitScript(FREEZE_INIT, FREEZE_CSS);
  try {
    await page.goto(url, { waitUntil: 'load' });
    for (const library of libraries) await page.addScriptTag({ url: library });
    return await fn(page, { consoleErrors, pageErrors });
  } finally {
    await context.close();
  }
}

/** One snapshot of everything the tab contract is made of. */
async function readTabs(page, selector) {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) return { found: false };
    const tabs = [...root.querySelectorAll('[role="tab"]')];
    const panels = [...root.querySelectorAll('[role="tabpanel"]')];
    const style = (node) => {
      const cs = getComputedStyle(node);
      return {
        boxShadow: cs.boxShadow,
        borderTopWidth: cs.borderTopWidth,
        backgroundColor: cs.backgroundColor,
        color: cs.color,
        outlineStyle: cs.outlineStyle,
        outlineWidth: cs.outlineWidth,
        outlineOffset: cs.outlineOffset,
        outlineColor: cs.outlineColor,
        transform: cs.transform,
        marginTop: cs.marginTop,
      };
    };
    return {
      found: true,
      selected: tabs.map((tab) => tab.getAttribute('aria-selected')),
      tabIndex: tabs.map((tab) => tab.tabIndex),
      hidden: panels.map((panel) => panel.hidden),
      ids: tabs.map((tab) => tab.getAttribute('aria-controls')),
      labels: panels.map((panel) => panel.getAttribute('aria-labelledby')),
      texts: panels.map((panel) => panel.textContent.trim()),
      activeIndex: tabs.indexOf(document.activeElement),
      selectedStyle: style(tabs.find((tab) => tab.getAttribute('aria-selected') === 'true') ?? tabs[0]),
      restingStyle: style(tabs.find((tab) => tab.getAttribute('aria-selected') !== 'true') ?? tabs[0]),
      panelStyle: style(panels[0]),
      focusVisible: document.activeElement?.matches?.(':focus-visible') ?? false,
    };
  }, selector);
}

/* =================================== static checks =================================== */

console.log(`barnacle tabs verification — ${ROOT}\n`);

const rawSource = fs.readFileSync(abs(SOURCE), 'utf8');
const source = blankComments(rawSource);
const rules = parseRules(source);
const allDeclarations = rules.flatMap((rule) =>
  declarations(rule.body).map(([property, value]) => ({ property, value, ...rule })),
);
const customProps = [...new Set([...source.matchAll(/--[\w-]+/g)].map((match) => match[0]))];
const rawScript = fs.readFileSync(abs(SCRIPT), 'utf8');
const script = blankComments(rawScript);
const rawEntry = fs.readFileSync(abs(ENTRY), 'utf8');
const markdown = fs.readFileSync(abs(CONTENT), 'utf8');
const rawArtifact = fs.readFileSync(abs(ARTIFACT), 'utf8');
const rawJsArtifact = fs.readFileSync(abs(JS_ARTIFACT), 'utf8');

await check('src/css/tabs.css is UTF-8 without a BOM and writes no @layer', () => {
  const bytes = fs.readFileSync(abs(SOURCE));
  must(!(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf), 'a BOM breaks the build chain');
  const offenders = rawSource
    .split(/\r?\n/)
    .map((line, index) => [line, index + 1])
    .filter(([line]) => /^\s*@layer\b/.test(line));
  must(offenders.length === 0, `remove @layer from line(s) ${offenders.map(([, n]) => n).join(', ')}`);
  must(rules.length > 0, 'the file declares no rule at all — ticket 20 has not landed');
  return `${rules.length} rules, layer assignment left to CSS_MANIFEST`;
});

await check('src/css/tabs.css invents no name (ADR-0005: --bn-* and --_* only)', () => {
  const unknownPublic = customProps.filter((name) => HYGIENE.publicToken.test(name) && !PUBLIC_TOKENS.has(name));
  must(unknownPublic.length === 0, `unknown public token(s): ${unknownPublic.join(', ')} — spec §6.1 is the vocabulary`);
  const foreign = customProps.filter(
    (name) => !HYGIENE.publicToken.test(name) && !HYGIENE.internalToken.test(name),
  );
  must(foreign.length === 0, `custom properties outside the two namespaces: ${foreign.join(', ')}`);

  const declared = [
    ...new Set(allDeclarations.map(({ property }) => property).filter((name) => HYGIENE.internalToken.test(name))),
  ];
  const invented = declared.filter((name) => !FROZEN_SLOTS.has(name));
  must(invented.length === 0, `new internal slot(s): ${invented.join(', ')} — geometry is declared once, in 00-base.css`);

  const read_ = [...new Set([...source.matchAll(/var\(\s*(--_[\w-]+)/g)].map((match) => match[1]))];
  const unknownReads = read_.filter((name) => !FROZEN_SLOTS.has(name));
  must(unknownReads.length === 0, `unknown internal variable(s) read: ${unknownReads.join(', ')}`);
  return `${declared.length} frozen slots re-pointed, ${read_.length} read, 0 invented`;
});

await check('src/css/tabs.css holds no colour literal and no !important', () => {
  const offenders = [...source.matchAll(new RegExp(COLOUR_LITERAL.source, 'g'))].map((match) => match[0]);
  must(offenders.length === 0, `hardcoded colour(s): ${[...new Set(offenders)].join(', ')}`);
  must(!/!\s*important/.test(source), 'the layer contract makes !important unnecessary and forbidden');
  return '0 hex / rgb() / hsl() / oklch() / color() literals, no !important';
});

await check('no rule disables an outline without a replacement (WCAG F78)', () => {
  const offenders = rules.filter((rule) =>
    declarations(rule.body).some(
      ([property, value]) => (property === 'outline' || property === 'outline-style') && /^(none|0)\b/.test(value),
    ),
  );
  must(offenders.length === 0, `outline disabled on ${offenders.map((rule) => rule.selector).join(', ')}`);
  must(!/outline(?:-style)?\s*:\s*(?:none|0)\b/.test(source), 'the source contains `outline: none`');
  const rings = rules.filter((rule) =>
    declarations(rule.body).some(([property, value]) => property === 'outline' && value.includes('var(--_focus-ring)')),
  );
  must(rings.length > 0, 'no rule paints the focus ring from --_focus-ring');
  const offsets = allDeclarations.filter(({ property }) => property === 'outline-offset');
  must(offsets.length > 0, 'no outline-offset is declared — a thick border could swallow the ring');
  must(
    offsets.every(({ value }) => value === 'var(--_focus-ring-offset)'),
    `outline-offset must read the slot: ${offsets.map(({ value }) => value).join('; ')}`,
  );
  return `${rings.length} ring rule(s) at ${offsets[0].value}`;
});

await check('every geometry value in src/css/tabs.css reads a --_ slot (no number in the file)', () => {
  const offenders = allDeclarations
    .filter(({ property, value }) => GEOMETRY_PROPERTIES.includes(property) && /\d/.test(value))
    .map(({ selector, property, value }) => `${selector} { ${property}: ${value} }`);
  must(offenders.length === 0, `geometry must be a var(--_…) reference (spec §3 invariant 3): ${offenders.join('; ')}`);

  const shadows = allDeclarations.filter(({ property }) => property === 'box-shadow');
  must(shadows.length > 0, 'no box-shadow is declared at all');
  const literalShadows = shadows.filter(({ value }) => !value.startsWith('var(--_'));
  must(literalShadows.length === 0, `box-shadow must read a slot: ${literalShadows.map((d) => d.value).join('; ')}`);

  const translates = [...source.matchAll(/translate\(([^)]*)\)/g)].map((match) => match[1].trim());
  must(translates.length > 0, 'no translate() is declared at all');
  const badTranslates = translates.filter((args) => !args.startsWith('var(--_'));
  must(badTranslates.length === 0, `translate() arguments must be slots: ${badTranslates.join('; ')}`);

  const badSlots = allDeclarations
    .filter(({ property }) => property.startsWith('--_'))
    .filter(({ property, value }) => {
      if (value.startsWith('var(--')) return false;
      if (value === 'none' && property.startsWith('--_shadow')) return false;
      if (value === '0' && /^--_(?:lift|press)-[xy]$/.test(property)) return false;
      return true;
    })
    .map(({ selector, property, value }) => `${selector} { ${property}: ${value} }`);
  must(badSlots.length === 0, `a slot may only be pointed at a token or zeroed on purpose: ${badSlots.join('; ')}`);
  return `${shadows.length} shadows, ${translates.length} translate() calls, all slot references`;
});

await check('the border box is declared once and no state rule can change it (spec §3 invariant 7)', () => {
  const stateRules = rules.filter((rule) => STATE_SELECTOR.test(rule.selector));
  must(stateRules.length > 0, 'no :hover / :active / :focus-visible rule exists');
  const offenders = [];
  for (const rule of stateRules) {
    for (const [property, value] of declarations(rule.body)) {
      if (property.startsWith('--_')) continue;
      if (!STATE_PROPERTIES.has(property)) offenders.push(`${rule.selector} { ${property}: ${value} }`);
    }
  }
  must(offenders.length === 0, `a state rule may only change colour / geometry: ${offenders.join('; ')}`);
  const widths = allDeclarations.filter(({ property }) => property === 'border-width' || property === 'border');
  must(widths.length > 0, 'the tab declares no border width at all');
  const badWidths = widths.filter(({ value }) => !value.includes('var(--bn-border-width)'));
  must(badWidths.length === 0, `every border width must read --bn-border-width: ${badWidths.map((d) => d.value).join('; ')}`);
  return `${stateRules.length} state rules, all border widths from --bn-border-width`;
});

await check('motion lives inside @media (prefers-reduced-motion: no-preference)', () => {
  const motionRules = rules.filter((rule) =>
    declarations(rule.body).some(([property]) => property === 'transition' || property.startsWith('transition-')),
  );
  must(motionRules.length > 0, 'nothing declares a transition — the interaction would be instant everywhere');
  const outside = motionRules.filter(
    (rule) => !rule.conditions.some((condition) => /prefers-reduced-motion:\s*no-preference/.test(condition)),
  );
  must(outside.length === 0, `transition declared outside the no-preference block: ${outside.map((r) => r.selector).join(', ')}`);
  must(!/prefers-reduced-motion:\s*reduce/.test(source), 'a reduce block that switches motion off afterwards is rejected');
  must(
    !allDeclarations.some(({ property }) => property === 'animation' || property.startsWith('animation-')),
    'tabs.css declares an animation; ticket 20 has no entry animation to guard',
  );
  return `${motionRules.length} transition rule(s) inside no-preference, 0 reduce blocks`;
});

await check('every selector is scoped to bn-tabs, so the roles cannot style a foreign strip', () => {
  must(rules.length > 0, 'no rules to scope');
  const unscoped = rules.filter((rule) => !/(^|[\s,>+~])bn-tabs\b/.test(rule.selector)).map((rule) => rule.selector);
  must(
    unscoped.length === 0,
    `these selectors reach outside <bn-tabs>: ${unscoped.join(' | ')} — the same roles exist on pages the library does not own`,
  );
  for (const selector of ['role="tablist"', 'role="tab"', 'role="tabpanel"']) {
    must(source.includes(selector), `no rule dresses ${selector}`);
  }
  return `${rules.length} rules, every one anchored on bn-tabs`;
});

await check('a panel is hidden only through [hidden], which the script sets and the markup never carries', () => {
  const hiding = allDeclarations.filter(
    ({ property, value }) =>
      (property === 'display' && value === 'none') ||
      (property === 'visibility' && value !== 'visible') ||
      property === 'content-visibility',
  );
  const panelHiding = hiding.filter(({ selector }) => selector.includes('tabpanel'));
  must(panelHiding.length > 0, 'no rule hides a panel — [role="tabpanel"][hidden] is missing');
  const notGuarded = panelHiding.filter(({ selector }) => !selector.includes('[hidden]'));
  must(
    notGuarded.length === 0,
    `a panel is hidden without [hidden]: ${notGuarded.map((d) => d.selector).join(', ')} — no-script readers would lose it`,
  );
  return `${panelHiding.length} rule(s), all guarded by [hidden]`;
});

await check('src/js/tabs.js is built on BnBase, not on a second lifecycle or a second tabindex loop', () => {
  must(/import\s*\{\s*BnBase\s*\}\s*from\s*'\.\/base\.js'/.test(rawScript), 'tabs.js does not import BnBase');
  must(/import\s*\{\s*keydownIndex\s*\}\s*from\s*'\.\/keys\.js'/.test(rawScript), 'tabs.js does not import keydownIndex');
  must(/extends BnBase/.test(rawScript), '<bn-tabs> must extend the shared base class');
  must(/events\(\)\s*\{[\s\S]*?return\s*\[[^\]]*'click'[^\]]*'keydown'[^\]]*\]/.test(rawScript), 'events() must bind click and keydown');
  must(/this\.focusOnly\(/.test(rawScript), 'roving tabindex must go through BnBase.focusOnly');
  must(/this\.activeIndex\(/.test(rawScript), 'index lookup must go through BnBase.activeIndex');
  must(!/\.tabIndex\s*=/.test(script), 'tabs.js writes tabIndex itself — that is what focusOnly is for');
  must(!/attachShadow/.test(script), 'ADR-0002: the library is shallow-DOM only');
  must(!/prefers-color-scheme/.test(script), 'a library convention must not be second-guessed in JS');

  const emit = rawScript.match(/emit\(\s*'([\w:-]+)',\s*\{([^}]*)\}/);
  must(emit, 'no emit(...) call found in tabs.js');
  must(emit[1] === EVENT, `the event is named ${emit[1]}, expected ${EVENT}`);
  for (const key of DETAIL_KEYS) {
    must(new RegExp(`\\b${key}\\b`).test(emit[2]), `the ${EVENT} detail is missing ${key}`);
  }
  must(/return new CustomEvent|emit\(/.test(rawScript), 'the event must come from BnBase.emit');
  return `${EVENT} with detail {${DETAIL_KEYS.join(', ')}}, roving tabindex through focusOnly`;
});

await check('src/js/index.js registers <bn-tabs>', () => {
  must(/import\s*\{\s*BnTabs\s*\}\s*from\s*'\.\/tabs\.js'/.test(rawEntry), 'index.js does not import BnTabs');
  must(/register\(\s*'bn-tabs'\s*,\s*BnTabs\s*\)/.test(rawEntry), "index.js does not register 'bn-tabs'");
  return "bn.register('bn-tabs', BnTabs)";
});

await check('the built artifacts carry the tabs block and the event name', () => {
  must(rawArtifact.includes('/* src/css/tabs.css (@layer components) */'), `${ARTIFACT} has no tabs.css block — run npm run build`);
  const block = rawArtifact.slice(
    rawArtifact.indexOf('/* src/css/tabs.css'),
    rawArtifact.indexOf('/* src/css/taginput.css'),
  );
  for (const needle of ['bn-tabs [role="tab"]', 'outline: var(--_focus-ring)', 'prefers-reduced-motion: no-preference']) {
    must(block.includes(needle), `${ARTIFACT} tabs block is missing ${JSON.stringify(needle)}`);
  }
  must(rawJsArtifact.includes(EVENT), `${JS_ARTIFACT} does not carry the ${EVENT} event name`);
  must(!rawJsArtifact.includes('attachShadow'), `${JS_ARTIFACT} calls attachShadow — ADR-0002 forbids it`);
  return `${block.split('\n').length} lines of tabs.css in ${ARTIFACT}`;
});

await check('content/components/tabs.md is a component page: no H2, no trailing-slash link, plain fences', () => {
  const body = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  const headings = body.split(/\r?\n/).filter((line) => /^#{1,2}\s/.test(line));
  must(headings.length === 0, `component pages start at H3 (spec §10): ${headings.join(' | ')}`);
  const trailing = [...body.matchAll(/\]\(([^)]*)\)/g)].map((match) => match[1]).filter((url) => url.endsWith('/'));
  must(trailing.length === 0, `a trailing slash is a broken link on this site: ${trailing.join(', ')}`);

  const blocks = fences(markdown);
  must(blocks.length >= 3, `expected at least three fences on the page, found ${blocks.length}`);
  const badInfo = blocks.filter((block) => !ALLOWED_FENCE_INFO.test(block.info));
  must(badInfo.length === 0, `fence info must be a bare language token: ${badInfo.map((b) => b.info).join(', ')}`);

  // The no-script invariant, at the source level: hiding a panel is the script's job, so no fence
  // may ship a `hidden` attribute of its own.
  const hiddenAttributes = blocks
    .filter((block) => /\shidden(?=[\s=>])/.test(block.text))
    .map((block) => block.info);
  must(
    hiddenAttributes.length === 0,
    `a fence in content/components/tabs.md ships the hidden attribute (${hiddenAttributes.join(', ')}): a no-script reader would lose that panel`,
  );
  const examples = blocks.filter((block) => block.text.trim().startsWith('<'));
  must(examples.length >= 1, 'no runnable HTML example on the page');
  must(examples.some((block) => block.text.includes('<bn-tabs>')), 'the example does not use <bn-tabs>');
  return `${blocks.length} fences, ${examples.length} runnable, 0 with hidden`;
});

await check('seite builds the page, and the built HTML keeps the fences for the client-side layer', async () => {
  const bin = [process.env.SEITE_BIN, 'D:\\sdk\\seite\\seite.exe', 'seite'].filter(Boolean).find((candidate) => {
    const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
    return probe.status === 0;
  });
  must(bin, 'the seite CLI was not found (set SEITE_BIN)');
  const built = spawnSync(bin, ['build', '--dir', ROOT], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, SEITE_YES: '1' } });
  const output = `${built.stdout ?? ''}${built.stderr ?? ''}`;
  must(built.status === 0, `seite build exited ${built.status}:\n${output}`);
  must(!/\b(broken|missing)\b/i.test(output), `seite build reported problems:\n${output}`);

  must(fs.existsSync(abs(PAGE)), `${PAGE} was not produced — content/components/tabs.md did not become a page`);
  const html = read(PAGE);
  must(html.includes('&lt;bn-tabs&gt;'), `${PAGE} does not keep the fence as escaped text (was it post-processed?)`);
  // A *live* tablist element would mean the markup was baked in at build time. The prose mentions
  // the role in inline <code>, and a fence mentions it as escaped text, so only a real element tag
  // counts here.
  const liveTablist = [...html.matchAll(/<([a-z][a-z0-9-]*)\b[^>]*\brole="tablist"/g)].map((match) => match[0]);
  must(liveTablist.length === 0, `${PAGE} bakes tablist markup into the HTML: ${liveTablist.join(' | ')}`);
  const h2 = [...html.matchAll(/<h2\b[^>]*>/g)].map((match) => match[0]);
  must(h2.length === 1 && /data-site-heading=/.test(h2[0]), `${PAGE} renders ${h2.length} H2s, expected only the template one`);
  const index = read('dist/components/index.html');
  must(index.includes('/components/tabs'), 'the components index does not link to the Tabs page');
  return `dist/components/tabs.html built, 1 template H2, fences intact, index links it`;
});

/* =================================== browser checks =================================== */

const BROWSER_CHECKS = [
  [
    'verification 1: keyboard alone drives the strip — arrows, Home, End, roving tabindex, ring',
    async (browser, server) => {
      return withPage(browser, server.harness, { libraries: ['/static/barnacle.js'] }, async (page, issues) => {
        const stage = () => readTabs(page, '#tabs');
        must((await stage()).found, 'the fixture has no <bn-tabs>');
        must((await stage()).hidden.join() === 'false,true,true', 'the initial selection is not the authored one');

        // One keyboard Tab reaches the single tab stop of the strip.
        await page.keyboard.press('Tab');
        let state = await stage();
        must(
          state.activeIndex === 0 && state.focusVisible,
          `Tab did not reach the selected tab with :focus-visible (activeIndex ${state.activeIndex}, focusVisible ${state.focusVisible})`,
        );
        must(state.tabIndex.join() === '0,-1,-1', `roving tabindex at rest: ${state.tabIndex.join()}`);
        must(
          state.selectedStyle.outlineStyle === 'solid' && state.selectedStyle.outlineWidth === '3px' &&
            state.selectedStyle.outlineOffset === '3px' && state.selectedStyle.outlineColor === RING_COLOR,
          `the keyboard focus ring is incomplete: ${JSON.stringify({ ...state.selectedStyle })}`,
        );
        // Selected = filled with --bn-main and shadow collapsed; unselected = md shadow at rest.
        must(
          state.selectedStyle.backgroundColor === MAIN_SURFACE && state.selectedStyle.boxShadow === 'none',
          `the selected tab must read as pressed: ${state.selectedStyle.backgroundColor} / ${state.selectedStyle.boxShadow}`,
        );
        must(
          state.restingStyle.backgroundColor === SECONDARY_SURFACE && state.restingStyle.boxShadow === SHADOW_SM,
          `an unselected tab must rest a tier below a button: ${state.restingStyle.backgroundColor} / ${state.restingStyle.boxShadow}`,
        );

        // Arrows move focus and selection together, and never leave the tab order doubled up.
        for (const [key, index] of [['ArrowRight', 1], ['ArrowRight', 2]]) {
          await page.keyboard.press(key);
          state = await stage();
          must(state.activeIndex === index, `${key} did not move focus to tab ${index} (activeIndex ${state.activeIndex})`);
          must(state.focusVisible, `focus moved by ${key} must stay :focus-visible — the reader has to see where they are`);
          must(
            state.tabIndex.filter((value) => value === 0).length === 1 && state.tabIndex[index] === 0,
            `roving tabindex is wrong after ${key}: ${state.tabIndex.join()}`,
          );
          must(state.selected[index] === 'true', `${key} did not select tab ${index}`);
          must(state.hidden[index] === false && state.hidden.filter(Boolean).length === 2, `${key} did not swap the panels`);
        }

        // The ends are ends: no wrapping, and the key is still consumed.
        await page.keyboard.press('ArrowRight');
        state = await stage();
        must(state.activeIndex === 2 && state.selected[2] === 'true', 'ArrowRight wrapped past the last tab');

        await page.keyboard.press('Home');
        state = await stage();
        must(state.activeIndex === 0 && state.selected[0] === 'true', `Home did not reach the first tab (${state.activeIndex})`);
        await page.keyboard.press('End');
        state = await stage();
        must(state.activeIndex === 2 && state.selected[2] === 'true', `End did not reach the last tab (${state.activeIndex})`);
        await page.keyboard.press('ArrowLeft');
        state = await stage();
        must(state.activeIndex === 1 && state.tabIndex.join() === '-1,0,-1', `ArrowLeft did not move back (${state.activeIndex})`);

        // A click moves the selection without painting the keyboard ring (focus and selection stay
        // distinguishable), and leaves exactly one tab stop behind.
        await page.locator('#tab-0').click();
        state = await stage();
        must(state.selected.join() === 'true,false,false' && state.tabIndex.join() === '0,-1,-1', `a click did not select tab 0: ${state.selected.join()}, ${state.tabIndex.join()}`);
        must(state.hidden.join() === 'false,true,true', 'a click did not swap the panels');

        // Nothing in the strip ever moves the border box (spec §3 invariant 7), and the panel
        // keeps the library's frame.
        state = await stage();
        must(
          state.selectedStyle.borderTopWidth === BORDER_PX && state.restingStyle.borderTopWidth === BORDER_PX,
          `border width moved: ${state.selectedStyle.borderTopWidth} / ${state.restingStyle.borderTopWidth}`,
        );
        must(state.panelStyle.boxShadow === SHADOW_MD && state.panelStyle.borderTopWidth === BORDER_PX, `the panel is not framed: ${JSON.stringify(state.panelStyle)}`);

        await page.hover('#tab-1');
        const hovered = await page.evaluate(() => {
          const tab = document.querySelector('#tab-1');
          const cs = getComputedStyle(tab);
          return { transform: cs.transform, boxShadow: cs.boxShadow, hover: tab.matches(':hover') };
        });
        must(hovered.hover === true, 'the page does not report :hover — the lift read would be a silent no-op');
        must(
          hovered.transform === HOVER_TRANSFORM && hovered.boxShadow === SHADOW_MD,
          `an unselected tab must rise one tier by --bn-shadow-lift, like a button: ${hovered.transform} / ${hovered.boxShadow}`,
        );

        must(issues.consoleErrors.length === 0, `console errors: ${issues.consoleErrors.join(' | ')}`);
        must(issues.pageErrors.length === 0, `page errors: ${issues.pageErrors.join(' | ')}`);
        return 'Tab → arrows → Home/End → click all move focus, selection, panels and the single tab stop';
      });
    },
  ],
  [
    'verification 3: bn:change carries the index, the tab and the panel, and bubbles to document',
    async (browser, server) => {
      return withPage(browser, server.harness, { libraries: ['/static/barnacle.js'] }, async (page) => {
        const heard = await page.evaluate(() => {
          window.__seen = [];
          document.addEventListener('bn:change', (event) => {
            window.__seen.push({
              type: event.type,
              bubbles: event.bubbles,
              composed: event.composed,
              keys: Object.keys(event.detail).sort(),
              index: event.detail.index,
              tabIsSecondTab: event.detail.tab === document.getElementById('tab-1'),
              panelIsSecondPanel: event.detail.panel === document.getElementById('panel-1'),
              isCustomEvent: event instanceof CustomEvent,
              targetIsTabs: event.target === document.getElementById('tabs'),
            });
          });
          document.getElementById('tab-1').click();
          return window.__seen;
        });

        must(heard.length === 1, `a click must announce exactly one bn:change, heard ${heard.length}`);
        const [event] = heard;
        must(event.type === 'bn:change', `wrong event type: ${event.type}`);
        must(event.isCustomEvent, 'the event is not a CustomEvent (spec §9)');
        must(event.bubbles === true && event.composed === true, `spec §9 flags: bubbles=${event.bubbles}, composed=${event.composed}`);
        must(event.keys.join() === 'index,panel,tab', `detail keys are ${event.keys.join()}`);
        must(event.index === 1, `detail.index is ${event.index}`);
        must(event.tabIsSecondTab, 'detail.tab is not the selected tab element');
        must(event.panelIsSecondPanel, 'detail.panel is not the panel that tab controls');
        must(event.targetIsTabs, 'the event was not dispatched on <bn-tabs>');

        // Keyboard switches announce too, and a key that does not move the selection is silent.
        // The click above left tab-1 selected and focused, so put the selection back on the first
        // tab through the same public path (a click), then drive everything with the keyboard.
        await page.locator('#tab-0').click();
        await page.evaluate(() => {
          window.__seen = [];
        });
        await page.keyboard.press('ArrowRight');
        const afterKeyboard = await page.evaluate(() => ({
          count: window.__seen.length,
          last: window.__seen[window.__seen.length - 1],
        }));
        must(afterKeyboard.count === 1, `a keyboard switch must announce once, got ${afterKeyboard.count}`);
        must(afterKeyboard.last?.index === 1 && afterKeyboard.last?.tabIsSecondTab, `a keyboard switch must announce index 1: ${JSON.stringify(afterKeyboard.last)}`);

        // One more ArrowRight moves 1 → 2; the next clamps at the end and says nothing.
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('ArrowRight');
        const clamped = await page.evaluate(() => window.__seen.length);
        must(clamped === 2, `the clamped ArrowRight at the end must not announce: ${clamped} events`);
        return `detail {index, tab, panel}, bubbles + composed, dispatched on <bn-tabs>, clamped key silent`;
      });
    },
  ],
  [
    'tabs.css dresses its own element and leaves a foreign tab strip alone',
    async (browser, server) => {
      return withPage(browser, server.harness, { libraries: ['/static/barnacle.js'] }, async (page) => {
        const state = await page.evaluate(() => {
          const read = (selector) => {
            const node = document.querySelector(selector);
            const cs = getComputedStyle(node);
            return {
              display: cs.display,
              boxShadow: cs.boxShadow,
              borderTopWidth: cs.borderTopWidth,
              marginTop: cs.marginTop,
              paddingTop: cs.paddingTop,
              backgroundColor: cs.backgroundColor,
            };
          };
          return {
            insideTab: read('#tabs [role="tab"][aria-selected="true"]'),
            insidePanel: read('#tabs [role="tabpanel"]'),
            foreignTablist: read('#foreign [role="tablist"]'),
            foreignTab: read('#foreign [role="tab"]'),
            foreignSelectedTab: read('#foreign [role="tab"][aria-selected="true"]'),
            foreignPanel: read('#foreign [role="tabpanel"]'),
            foreignSelected: [...document.querySelectorAll('#foreign [role="tab"]')].map((tab) => tab.getAttribute('aria-selected')),
            foreignHidden: [...document.querySelectorAll('#foreign [role="tabpanel"]')].map((panel) => panel.hidden),
          };
        });

        // Self-evidence first: the same snapshot can see the library where it belongs, so a clean
        // foreign read is not a measurement of nothing.
        must(
          state.insideTab.borderTopWidth === BORDER_PX && state.insideTab.boxShadow === 'none' &&
            state.insideTab.backgroundColor === MAIN_SURFACE,
          `the harness did not measure a styled <bn-tabs> tab: ${JSON.stringify(state.insideTab)}`,
        );
        must(
          state.insidePanel.boxShadow === SHADOW_MD && state.insidePanel.borderTopWidth === BORDER_PX &&
            state.insidePanel.marginTop === '12px',
          `the harness did not measure a framed panel: ${JSON.stringify(state.insidePanel)}`,
        );
        // And nothing where it does not belong. A span carrying role="tab" outside <bn-tabs> is
        // still an inline span: no shape, no shadow, no fill, no border.
        must(
          state.foreignTab.display === 'inline' && state.foreignTab.boxShadow === 'none' &&
            state.foreignTab.borderTopWidth === '0px' && state.foreignTab.paddingTop === '0px',
          `tabs.css gave a foreign [role="tab"] a tab shape: ${JSON.stringify(state.foreignTab)}`,
        );
        must(
          state.foreignSelectedTab.backgroundColor === 'rgba(0, 0, 0, 0)',
          `tabs.css filled a foreign [role="tab"][aria-selected="true"] with --bn-main: ${state.foreignSelectedTab.backgroundColor}`,
        );
        must(
          state.foreignTablist.display !== 'flex',
          `tabs.css laid out a foreign [role="tablist"]: display ${state.foreignTablist.display}`,
        );
        must(
          state.foreignPanel.boxShadow === 'none' && state.foreignPanel.borderTopWidth === '0px' &&
            state.foreignPanel.marginTop === '0px' && state.foreignPanel.paddingTop === '0px',
          `tabs.css framed a foreign [role="tabpanel"]: ${JSON.stringify(state.foreignPanel)}`,
        );
        must(
          state.foreignSelected.join() === 'true,' && state.foreignHidden.join() === 'false,true',
          `the foreign strip is a baseline fixture and nothing may rewrite it: selected ${state.foreignSelected.join()}, hidden ${state.foreignHidden.join()}`,
        );
        return `inside: ${BORDER_PX} border + ${SHADOW_MD} panel; foreign span/panel/tablist: untouched`;
      });
    },
  ],
  [
    'verification 2: with no script every panel stays visible and readable, and the strip still looks like one',
    async (browser, server) => {
      const inspect = (page) =>
        page.evaluate(() => {
          const group = document.querySelector('bn-tabs');
          const tabs = [...group.querySelectorAll('[role="tab"]')];
          return {
            panels: [...group.querySelectorAll('[role="tabpanel"]')].map((panel) => ({
              hidden: panel.hidden,
              display: getComputedStyle(panel).display,
              boxShadow: getComputedStyle(panel).boxShadow,
              text: panel.textContent.replace(/\s+/g, ' ').trim(),
              rendered: !!(panel.offsetWidth || panel.offsetHeight || panel.getClientRects().length),
            })),
            tabBorder: getComputedStyle(tabs[0]).borderTopWidth,
            tabNames: tabs.map((tab) => tab.textContent.trim()),
            tabIndexes: tabs.map((tab) => tab.getAttribute('tabindex')),
            text: group.textContent.replace(/\s+/g, ' ').trim(),
          };
        });

      const assertReadable = (state, label) => {
        must(state.panels.length === 3, `${label}: expected 3 panels, found ${state.panels.length}`);
        for (const panel of state.panels) {
          must(!panel.hidden, `${label}: a panel ships the hidden attribute — a no-script reader loses it`);
          must(panel.display !== 'none' && panel.rendered, `${label}: a panel is not rendered`);
          must(panel.boxShadow === SHADOW_MD, `${label}: the panel lost its frame: ${panel.boxShadow}`);
        }
        for (const phrase of ['Panel profile.', 'Panel billing.', 'Panel danger.']) {
          must(state.text.includes(phrase), `${label}: ${JSON.stringify(phrase)} is not readable`);
        }
        must(state.tabBorder === BORDER_PX, `${label}: the strip lost its shape (border ${state.tabBorder})`);
        must(state.tabNames.join() === 'Profile,Billing,Danger zone', `${label}: the tabs are not readable`);
        must(
          state.tabIndexes.every((value) => value === null),
          `${label}: roving tabindex was written into the delivered markup (${state.tabIndexes.join()})`,
        );
      };

      // (a) scripting switched off entirely, (b) scripting on with the library never loaded — and
      // then loaded, so the check can prove the script is what hides the other panels and not the
      // markup.
      const noScript = await withPage(browser, server.harness, { javaScriptEnabled: false }, inspect);
      assertReadable(noScript, 'no JavaScript');

      const toggled = await withPage(browser, server.harness, {}, async (page) => {
        const before = await inspect(page);
        await page.addScriptTag({ url: '/static/barnacle.js' });
        const after = await inspect(page);
        return { before, after };
      });
      assertReadable(toggled.before, 'scripting on, library absent');
      must(
        toggled.after.panels.filter((panel) => !panel.hidden).length === 1,
        `loading the library must leave exactly one panel visible, got ${toggled.after.panels.filter((p) => !p.hidden).length}`,
      );
      must(
        toggled.after.tabIndexes.join() === '0,-1,-1',
        `loading the library must apply the roving tabindex, got ${toggled.after.tabIndexes.join()}`,
      );

      // (c) the documentation page without any script: the fences are what a reader sees, and all
      // three of them are still there as text.
      const docs = await withPage(browser, server.docs, { javaScriptEnabled: false }, async (page) => {
        const state = await page.evaluate(() => ({
          groups: document.querySelectorAll('bn-tabs').length,
          fences: [...document.querySelectorAll('.site-prose pre')].map((pre) =>
            pre.textContent.replace(/\s+/g, ' ').trim(),
          ),
          prose: document.querySelector('.site-prose')?.textContent.length ?? 0,
        }));
        must(state.groups === 0, 'with no script the demo layer cannot have built a tab set');
        must(state.fences.length === 3, `expected the three fences on the page, found ${state.fences.length}`);
        must(state.fences.some((text) => text.includes('<bn-tabs>')), 'the tabs example is not readable as text');
        must(state.prose > 1500, `the prose body is nearly empty (${state.prose} chars)`);
        return `${state.fences.length} fences readable, prose ${state.prose} chars`;
      });

      return `harness: 3/3 panels visible with scripting off and with the library absent; docs page: ${docs}`;
    },
  ],
  [
    'the documentation page works with the script on: the examples initialise and the keys switch them',
    async (browser, server) => {
      return withPage(browser, server.docs, {}, async (page, issues) => {
        const before = await page.evaluate(() => {
          const groups = [...document.querySelectorAll('bn-tabs')];
          return {
            groups: groups.length,
            visible: groups.map((group) => group.querySelectorAll('[role="tabpanel"]:not([hidden])').length),
            tabIndex: groups.map((group) => [...group.querySelectorAll('[role="tab"]')].map((tab) => tab.tabIndex)),
            selected: groups.map((group) => [...group.querySelectorAll('[role="tab"]')].map((tab) => tab.getAttribute('aria-selected'))),
            controls: groups.map((group) => [...group.querySelectorAll('[role="tab"]')].every((tab) => {
              const panel = document.getElementById(tab.getAttribute('aria-controls'));
              return panel?.getAttribute('role') === 'tabpanel';
            })),
          };
        });
        must(before.groups === 2, `expected the two example tab sets, found ${before.groups}`);
        must(before.visible.join() === '1,1', `each example must have exactly one visible panel: ${before.visible.join()}`);
        must(before.tabIndex.every((list) => list.filter((value) => value === 0).length === 1), `roving tabindex missing: ${JSON.stringify(before.tabIndex)}`);
        must(before.selected.every((list) => list[0] === 'true'), `the first tab must be selected: ${JSON.stringify(before.selected)}`);
        must(before.controls.every(Boolean), 'aria-controls does not resolve to the panels on the page');

        await page.locator('bn-tabs').first().locator('[role="tab"]').first().focus();
        await page.keyboard.press('End');
        const after = await page.evaluate(() => {
          const group = document.querySelector('bn-tabs');
          const tabs = [...group.querySelectorAll('[role="tab"]')];
          return {
            focused: tabs.indexOf(document.activeElement),
            selected: tabs.map((tab) => tab.getAttribute('aria-selected')).join(),
            visible: group.querySelectorAll('[role="tabpanel"]:not([hidden])').length,
          };
        });
        must(after.focused === 2 && after.selected === 'false,false,true', `End did not switch the last tab: ${JSON.stringify(after)}`);
        must(after.visible === 1, `End left ${after.visible} panels visible`);

        must(issues.consoleErrors.length === 0, `console errors: ${issues.consoleErrors.join(' | ')}`);
        must(issues.pageErrors.length === 0, `page errors: ${issues.pageErrors.join(' | ')}`);
        return '2 examples initialised, one visible panel each, End switches the last tab, 0 console errors';
      });
    },
  ],
];

/** Browser checks need playwright-core; without it they skip loudly, exactly as ticket 07's do. */
async function runBrowserChecks() {
  if (process.argv.includes('--no-browser')) {
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
  console.log(`      system Chrome ${browser.version()}\n`);
  try {
    for (const [name, fn] of BROWSER_CHECKS) await check(name, () => fn(browser, server));
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
