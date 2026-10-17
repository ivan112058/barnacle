#!/usr/bin/env node
/**
 * Scripted verification for ticket 19 — `<bn-dropdown>`.
 *
 * The four verification methods in `.scratch/barnacle-design/issues/19-dropdown.md` are the
 * specification of this file; each one is a check below, measured in real Chrome against the
 * shipped artifacts (`static/barnacle.css`, `static/barnacle.js`) instead of a hand pass:
 *
 *   1. open, move, pick and close the whole way with the keyboard
 *   2. put a `<bn-dropdown>` with no internal structure on the page: no console output at all
 *   3. listen for the events and confirm `bubbles` and `composed` are both true
 *   4. measure the popover API in the target browser, and record what the CSS-only fallback does
 *
 * The expected values are the independent source of truth: spec.md §8 (the element), §9 (the JS
 * architecture), §3 invariant 6 (the appearance survives without the script), §7 (the motion guard),
 * ADR-0002 (shallow DOM), ADR-0005 (prefixed names) and `orchestrator-decisions.md` §4 (geometry has
 * one source) / §6 (what a JS ticket must run). They are never recomputed from the source files.
 *
 * Run with: npm run verify:dropdown   (or: node scripts/verify-dropdown.mjs)
 * Options:  --no-browser  skip the real-Chrome checks (they need playwright-core)
 *
 * playwright-core is deliberately NOT a dependency of this repository (ticket 08 owns that
 * decision). Install it just for a local run and nothing is written to package.json:
 *
 *   npm i --no-save playwright-core@1.64.1
 *
 * Without it the browser checks report SKIP and the static checks still gate the exit code.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { blankComments, declarations, matchBrace, parseRules } from './lib/css.mjs';
import { FROZEN_SLOTS } from './lib/tokens.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const abs = (...parts) => path.join(ROOT, ...parts);

/* ------------------------------------ expectations ----------------------------------- */

const JS_SOURCE = 'src/js/dropdown.js';
const CSS_SOURCE = 'src/css/dropdown.css';
const ANIMATIONS_SOURCE = 'src/css/animations.css';
const DOC_PAGE = 'content/components/dropdown.md';
const CSS_ARTIFACT = 'static/barnacle.css';
const JS_ARTIFACTS = ['static/barnacle.js', 'static/barnacle.min.js'];

/** The element, its class API and the events, all named in the ticket and spec §8/§9. */
const ELEMENT = 'bn-dropdown';
const ITEM_CLASS = '.bn-dropdown-item';
const EVENTS = ['bn:open', 'bn:close', 'bn:select'];

/** 01-theme.css publishes the semantic channel; a component only reads it. */
const SEMANTIC_SLOT = '--_variant-color';

/** spec §6.1 — the public vocabulary. Anything else is a name this ticket invented. */
const PUBLIC_TOKEN_PREFIX = '--bn-';

/** Properties whose value *is* the geometry (spec §3 invariant 3): no number may appear in one. */
const GEOMETRY_PROPERTIES = [
  'transform',
  'translate',
  'box-shadow',
  'outline',
  'outline-offset',
  'transition',
  'transition-property',
  'transition-duration',
  'animation',
];

/** Hardcoded colour forms ADR-0005 keeps in 01-theme.css only. */
const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(|\bcolor\(/;

/** What the ticket promises the element will do, as selectors and API calls in the source. */
const REQUIRED_JS = [
  ['class BnDropdown extends BnBase', 'the base class from ticket 18 must be reused, not reinvented'],
  ["from './keys.js'", 'the roving-tabindex arithmetic lives in keys.js'],
  ['keydownIndex(', 'the arrow/Home/End moves must be keydownIndex()'],
  ["querySelector(", 'the trigger and the panel must be found in the author’s markup'],
  ['showPopover', 'the native popover API must be detected before anything is bound'],
  ['hidePopover', 'closing must go through the native popover API'],
  ["'keydown'", 'keydown must be a declared binding'],
  ['Escape', 'Escape is the component’s own key, not a navigation key'],
  ['aria-expanded', 'the trigger must report the state'],
];

/** What the docs page must contain for a reader to be able to use the element at all. */
const DOC_SECTIONS = ['###'];

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

/* -------------------------------------- the page -------------------------------------- */

/**
 * The measurement page. Every element is one of the verification methods:
 *
 *   #d1  the happy path: open, move, pick, close, and the three events
 *   #d2  the broken contract (no [popovertarget]) — it must stay completely silent
 *   #d3  a second dropdown, to prove the two do not share an anchor
 *   #d4  a dropdown at the bottom of a long page, to prove the panel flips instead of running
 *        off the viewport
 *   #outside  the thing a light dismiss hands focus to
 *
 * No styling of its own beyond spacing: everything measured comes from static/barnacle.css.
 */
const FIXTURE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <link rel="icon" href="data:,">
    <title>barnacle dropdown harness</title>
    <link rel="stylesheet" href="/static/barnacle.css">
    <style>body { margin: 0; padding: 24px; } .spacer { height: 120vh; }</style>
  </head>
  <body>
    <p><button id="outside" type="button">Outside</button></p>

    <bn-dropdown id="d1">
      <button id="t1" type="button" popovertarget="p1" aria-expanded="false">Actions</button>
      <menu popover id="p1" aria-label="Actions">
        <li><button id="i1" class="bn-dropdown-item" value="rename">Rename</button></li>
        <li><button id="i2" class="bn-dropdown-item" value="duplicate">Duplicate</button></li>
        <li><a id="i3" class="bn-dropdown-item" href="#rename">Delete</a></li>
      </menu>
    </bn-dropdown>

    <bn-dropdown id="d2">
      <button id="t2" type="button" popovertarget="not-a-panel" aria-expanded="false">Broken</button>
    </bn-dropdown>

    <bn-dropdown id="d5">
      <span>a dropdown with no trigger and no panel at all</span>
    </bn-dropdown>

    <bn-dropdown id="d3">
      <button id="t3" type="button" popovertarget="p3">More</button>
      <menu popover id="p3" aria-label="More">
        <li><button id="j1" class="bn-dropdown-item" value="one">One</button></li>
      </menu>
    </bn-dropdown>

    <div class="spacer"></div>

    <bn-dropdown id="d4">
      <button id="t4" type="button" popovertarget="p4">At the bottom</button>
      <menu popover id="p4" aria-label="Bottom">
        <li><button id="k1" class="bn-dropdown-item" value="one">One</button></li>
        <li><button id="k2" class="bn-dropdown-item" value="two">Two</button></li>
      </menu>
    </bn-dropdown>

    <script src="/static/barnacle.js" defer></script>
  </body>
</html>
`;

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/** Serves the fixture from memory and the published artifacts from `static/`. Nothing under
 *  `src/` is reachable, so a browser check can only measure the shipped bytes. */
async function startServer() {
  const staticRoot = abs('static');
  const server = http.createServer((req, res) => {
    let urlPath;
    try {
      urlPath = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    } catch {
      res.writeHead(400).end('bad url');
      return;
    }
    if (urlPath === '/harness.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(FIXTURE);
      return;
    }
    const file = path.resolve(staticRoot, `.${urlPath.replace(/^\/static/, '')}`);
    if (urlPath.startsWith('/static/') && file.startsWith(staticRoot + path.sep)) {
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
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' }).end(`not found: ${urlPath}`);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, url: `${origin}/harness.html`, close: () => new Promise((r) => server.close(r)) };
}

/** Freezes transition/animation before first paint: a mid-transition read lies convincingly
 *  (browser-harness-findings §3.3). Checks that are *about* motion opt out with { freeze: false }. */
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

/** Records every component event the page sees, so "bubbles and composed are true" is measured on
 *  the events themselves rather than read out of the source. The detail is reduced to what survives
 *  serialization: a DOM node cannot cross the `page.evaluate` boundary, so the page answers the
 *  "is it really the element" question itself, with `instanceof`. */
const RECORD_INIT = () => {
  window.__bnEvents = [];
  const describe = (detail = {}) => ({
    keys: Object.keys(detail).sort(),
    value: detail.value ?? null,
    itemId: detail.item?.id ?? null,
    itemIsElement: detail.item instanceof HTMLElement,
    triggerId: detail.trigger?.id ?? null,
    triggerIsElement: detail.trigger instanceof HTMLElement,
    panelId: detail.panel?.id ?? null,
    panelIsElement: detail.panel instanceof HTMLElement,
  });
  for (const type of ['bn:open', 'bn:close', 'bn:select']) {
    document.addEventListener(type, (event) => {
      window.__bnEvents.push({
        type: event.type,
        bubbles: event.bubbles,
        composed: event.composed,
        isCustomEvent: event instanceof CustomEvent,
        detail: describe(event.detail),
      });
    });
  }
};

async function withPage(browser, server, options, fn) {
  const { freeze = true, ...contextOptions } = options ?? {};
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...contextOptions });
  const page = await context.newPage();
  const consoleErrors = [];
  const consoleOther = [];
  const pageErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
    else if (['warning', 'assert'].includes(message.type())) consoleOther.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  if (freeze && contextOptions.javaScriptEnabled !== false) await page.addInitScript(FREEZE_INIT, FREEZE_CSS);
  if (contextOptions.javaScriptEnabled !== false) await page.addInitScript(RECORD_INIT);
  try {
    await page.goto(server.url, { waitUntil: 'load' });
    if (contextOptions.javaScriptEnabled !== false) {
      await page.waitForFunction(() => globalThis.customElements?.get('bn-dropdown'));
    }
    return await fn(page, { consoleErrors, consoleOther, pageErrors });
  } finally {
    await context.close();
  }
}

/** The element's own view of the world, plus the geometry of one trigger/panel pair. */
async function readState(page, pair = {}) {
  const { trigger = 't1', panel = 'p1' } = pair;
  return page.evaluate(
    ({ triggerId, panelId }) => {
      const trigger = document.getElementById(triggerId);
      const panel = document.getElementById(panelId);
      const round = (rect) => ({ x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) });
      const active = document.activeElement;
      const triggerRect = trigger.getBoundingClientRect();
      return {
        open: panel.matches(':popover-open'),
        activeId: active?.id ?? active?.tagName ?? null,
        activeInPanel: panel.contains(active),
        itemTabIndex: [...panel.querySelectorAll('.bn-dropdown-item')].map((item) => item.tabIndex),
        triggerBox: {
          x: Math.round(triggerRect.x),
          y: Math.round(triggerRect.y),
          bottom: Math.round(triggerRect.bottom),
          h: Math.round(triggerRect.height),
        },
        panelBox: panel.matches(':popover-open') ? round(panel.getBoundingClientRect()) : null,
        anchorName: getComputedStyle(trigger).anchorName,
        positionAnchor: getComputedStyle(panel).positionAnchor,
        ariaExpanded: trigger.getAttribute('aria-expanded'),
      };
    },
    { triggerId: trigger, panelId: panel },
  );
}

/* =================================== static checks =================================== */

console.log(`barnacle dropdown verification — ${ROOT}\n`);

const jsSource = fs.readFileSync(abs(JS_SOURCE), 'utf8');
const rawCssSource = fs.readFileSync(abs(CSS_SOURCE), 'utf8');
const cssSource = blankComments(rawCssSource);
const rules = parseRules(cssSource);
const allDeclarations = rules.flatMap((rule) =>
  declarations(rule.body).map(([property, value]) => ({ property, value, ...rule })),
);
const customProps = [...new Set([...cssSource.matchAll(/--[\w-]+/g)].map((match) => match[0]))];
const artifacts = JS_ARTIFACTS.map((file) => [file, fs.readFileSync(abs(file), 'utf8')]);
const cssArtifact = fs.readFileSync(abs(CSS_ARTIFACT), 'utf8');

await check(`${JS_SOURCE} reuses BnBase and the keys.js arithmetic, and builds no second base class`, () => {
  must(jsSource.charCodeAt(0) !== 0xfeff, `${JS_SOURCE} must be UTF-8 without a BOM`);
  const missing = REQUIRED_JS.filter(([needle]) => !jsSource.includes(needle));
  must(
    missing.length === 0,
    `missing from the source: ${missing.map(([needle, why]) => `${JSON.stringify(needle)} (${why})`).join('; ')}`,
  );
  must(!/attachShadow/.test(jsSource), 'ADR-0002: the library never touches attachShadow');
  must(!/console\./.test(jsSource), 'the "no structure, no noise" promise allows no console call at all');
  must(/emit\(/.test(jsSource), 'events go through BnBase.emit(), never a hand-built CustomEvent');
  for (const type of EVENTS) must(jsSource.includes(`'${type}'`), `the source never mentions ${type}`);
  return `${REQUIRED_JS.length} contract anchors, no attachShadow, no console call`;
});

await check('the artifact registers <bn-dropdown> and never reaches for a shadow root', () => {
  const entry = fs.readFileSync(abs('src/js/index.js'), 'utf8');
  must(/bn\.register\('bn-dropdown'/.test(entry), 'src/js/index.js does not register <bn-dropdown>');
  for (const [file, text] of artifacts) {
    must(!/attachShadow/.test(text), `${file} contains attachShadow`);
    must(text.includes('bn-dropdown'), `${file} does not mention the element — run npm run build`);
  }
  return `${JS_ARTIFACTS.join(', ')} carry the element, 0 attachShadow`;
});

await check(`${CSS_SOURCE} invents no name and holds no colour or geometry literal`, () => {
  must(rawCssSource.charCodeAt(0) !== 0xfeff, `${CSS_SOURCE} must be UTF-8 without a BOM`);
  const offenders = rawCssSource
    .split(/\r?\n/)
    .map((line, index) => [line, index + 1])
    .filter(([line]) => /^\s*@layer\b/.test(line));
  must(offenders.length === 0, `remove @layer from line(s) ${offenders.map(([, n]) => n).join(', ')}`);
  must(rules.length > 0, `${CSS_SOURCE} declares no rule at all — ticket 19 has not landed`);

  const foreign = customProps.filter(
    (name) => !name.startsWith(PUBLIC_TOKEN_PREFIX) && !name.startsWith('--_'),
  );
  must(foreign.length === 0, `custom properties outside the two namespaces: ${foreign.join(', ')}`);

  const declared = [...new Set(allDeclarations.map(({ property }) => property).filter((name) => name.startsWith('--_')))];
  const invented = declared.filter((name) => !FROZEN_SLOTS.has(name));
  must(
    invented.length === 0,
    `new internal slot(s): ${invented.join(', ')} — geometry is declared once, in 00-base.css (orchestrator §4)`,
  );
  const read = [...new Set([...cssSource.matchAll(/var\(\s*(--_[\w-]+)/g)].map((match) => match[1]))];
  const unknown = read.filter((name) => !FROZEN_SLOTS.has(name) && name !== SEMANTIC_SLOT);
  must(unknown.length === 0, `unknown internal variable(s) read: ${unknown.join(', ')}`);

  const colours = [...cssSource.matchAll(new RegExp(COLOUR_LITERAL.source, 'g'))].map((match) => match[0]);
  must(colours.length === 0, `hardcoded colour(s): ${[...new Set(colours)].join(', ')}`);
  must(!/!\s*important/.test(cssSource), 'the layer contract makes !important unnecessary and forbidden');

  const geometry = allDeclarations
    .filter(({ property, value }) => GEOMETRY_PROPERTIES.includes(property) && /\d/.test(value))
    .map(({ selector, property, value }) => `${selector} { ${property}: ${value} }`);
  must(geometry.length === 0, `geometry must be a var(--_…) reference (spec §3 invariant 3): ${geometry.join('; ')}`);

  const shadows = allDeclarations.filter(({ property }) => property === 'box-shadow');
  must(shadows.length > 0, 'the panel declares no box-shadow at all');
  const literalShadows = shadows.filter(({ value }) => !value.startsWith('var(--_'));
  must(literalShadows.length === 0, `box-shadow must read a slot: ${literalShadows.map((d) => d.value).join('; ')}`);
  const translates = [...cssSource.matchAll(/translate(?:X|Y)?\(([^)]*)\)/g)].map((match) => match[1].trim());
  const badTranslates = translates.filter((args) => args !== '' && !args.startsWith('var(--_'));
  must(badTranslates.length === 0, `translate() arguments must be slots: ${badTranslates.join('; ')}`);
  must(/^\s*box-shadow: var\(--_/m.test(cssSource), 'no rule paints the panel with a shadow slot');

  const badSlots = allDeclarations
    .filter(({ property }) => property.startsWith('--_'))
    .filter(({ property, value }) => {
      if (value.startsWith('var(--')) return false;
      if (value === 'transparent') return false;
      if (value === 'none' && property.startsWith('--_shadow')) return false;
      if (value === '0' && /^--_(?:lift|press)-[xy]$/.test(property)) return false;
      return true;
    })
    .map(({ selector, property, value }) => `${selector} { ${property}: ${value} }`);
  must(badSlots.length === 0, `a slot may only be pointed at a token or zeroed on purpose: ${badSlots.join('; ')}`);

  must(
    !/outline(?:-style)?\s*:\s*(?:none|0)\b/.test(cssSource),
    'the focus ring must never be removed without a replacement (WCAG F78)',
  );
  return `${rules.length} rules, ${declared.length} slots overridden, 0 invented, 0 literals`;
});

await check('motion is declared only inside (prefers-reduced-motion: no-preference)', () => {
  const motion = rules.filter((rule) =>
    declarations(rule.body).some(([property]) => property === 'transition' || property === 'animation'),
  );
  must(motion.length > 0, 'nothing declares a transition — the item highlight would be instant');
  const outside = motion.filter(
    (rule) => !rule.conditions.some((condition) => /prefers-reduced-motion:\s*no-preference/.test(condition)),
  );
  must(outside.length === 0, `motion outside the guard: ${outside.map((rule) => rule.selector).join(', ')}`);
  must(
    !/prefers-reduced-motion:\s*reduce/.test(cssSource + fs.readFileSync(abs(ANIMATIONS_SOURCE), 'utf8')),
    'a reduce block that switches motion off afterwards is the rejected form (spec §7)',
  );
  const animations = fs.readFileSync(abs(ANIMATIONS_SOURCE), 'utf8');
  must(/@keyframes bn-/.test(animations), 'the entry animation has no bn- prefixed keyframes');
  for (const rule of parseRules(blankComments(animations))) {
    const motionHere = declarations(rule.body).some(([property]) => property === 'animation');
    if (motionHere) {
      must(
        rule.conditions.some((condition) => /prefers-reduced-motion:\s*no-preference/.test(condition)),
        `animations.css: ${rule.selector} animates outside the no-preference guard`,
      );
    }
  }
  return `${motion.length} guarded motion rule(s) in dropdown.css, keyframes in animations.css`;
});

await check(`${CSS_SOURCE} styles the author's panel and items through descendant selectors only`, () => {
  const selectors = rules.map((rule) => rule.selector);
  must(
    selectors.some((selector) => selector.trim() === ELEMENT),
    `no rule addresses <${ELEMENT}> itself`,
  );
  must(
    selectors.some((selector) => selector.includes(`${ELEMENT} [popover]`)),
    'the panel is not addressed as a descendant — a shadow root would break the shallow-DOM styling',
  );
  must(
    selectors.some((selector) => selector.includes(ITEM_CLASS)),
    `no rule addresses ${ITEM_CLASS}`,
  );
  must(
    !selectors.some((selector) => selector.startsWith(':host')),
    ':host is a shadow-DOM selector and cannot match anything here (ADR-0002)',
  );
  const anchor = selectors.length > 0 && /position-area/.test(cssSource);
  must(anchor, 'the panel declares no position-area — a top-layer popover would sit at the viewport origin');
  return `${selectors.length} selectors, ${ELEMENT} / [popover] / ${ITEM_CLASS}, position-area: on`;
});

await check('the artifact carries both blocks inside their layers', () => {
  must(
    cssArtifact.includes(`/* ${CSS_SOURCE} (@layer components) */`),
    `${CSS_ARTIFACT} has no dropdown.css block — run npm run build`,
  );
  must(
    cssArtifact.includes('position-area: bottom span-right'),
    `${CSS_ARTIFACT} does not carry the anchoring rule`,
  );
  must(
    cssArtifact.includes(`/* ${ANIMATIONS_SOURCE} (@layer animations) */`),
    `${CSS_ARTIFACT} has no animations.css block`,
  );
  return `${CSS_ARTIFACT} carries dropdown.css in @layer components and the keyframes in @layer animations`;
});

await check(`${DOC_PAGE} documents the options, without an authored H1/H2 or raw HTML`, () => {
  const raw = fs.readFileSync(abs(DOC_PAGE), 'utf8');
  must(raw.charCodeAt(0) !== 0xfeff, `${DOC_PAGE} must be UTF-8 without a BOM`);
  const frontmatter = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  must(frontmatter, `${DOC_PAGE} has no frontmatter`);
  must(/^title:\s*"Dropdown"/m.test(frontmatter[1]), 'the page title must be "Dropdown"');
  const body = raw.slice(frontmatter[0].length);

  const prose = [];
  const fences = [];
  let open = null;
  for (const line of body.split(/\r?\n/)) {
    const marker = line.match(/^(\s*)(`{3,}|~{3,})(.*)$/);
    if (!open) {
      if (marker && marker[1] === '') open = { marker: marker[2], info: marker[3].trim(), lines: [] };
      else prose.push(line);
      continue;
    }
    if (marker && marker[1] === '' && marker[2][0] === open.marker[0] && marker[2].length >= open.marker.length) {
      fences.push({ info: open.info, text: open.lines.join('\n') });
      open = null;
      continue;
    }
    open.lines.push(line);
  }
  must(!open, `${DOC_PAGE} has an unterminated fence`);

  const proseText = prose.join('\n');
  const headings = proseText.split(/\r?\n/).filter((line) => /^#{1,2}\s/.test(line));
  must(headings.length === 0, `a component page starts at H3 (spec §10): ${headings.join(' | ')}`);
  must(
    DOC_SECTIONS.some((marker) => proseText.includes(marker)),
    'the page has no H3 section at all — the options would not be described',
  );
  must(!/\{\{|\{%/.test(proseText), 'no shortcode syntax in the prose');
  const rawHtml = proseText.replace(/`[^`]*`/g, '``').match(/<[a-zA-Z][^>]*>/);
  must(!rawHtml, `raw HTML outside a fence: ${rawHtml?.[0]}`);
  const badFences = fences.filter((fence) => !/^(?:html|css|js|javascript|text|txt|sh|bash)?$/.test(fence.info));
  must(badFences.length === 0, `fence info must be a plain language token: ${badFences.map((f) => f.info).join(', ')}`);
  const html = fences.filter((fence) => fence.text.trim().startsWith('<'));
  must(html.length > 0, 'no HTML fence, so nothing on the page would be runnable');

  for (const fence of html) {
    must(fence.text.includes(ELEMENT), `an HTML fence does not use <${ELEMENT}>`);
    must(/popovertarget="[^"]+"/.test(fence.text), 'an HTML fence has no trigger with popovertarget');
    must(/<[a-z]+ popover id="[^"]+"/.test(fence.text), 'an HTML fence has no [popover] panel with an id');
  }
  const targets = html.flatMap((fence) => [...fence.text.matchAll(/popovertarget="([^"]+)"/g)].map((m) => m[1]));
  const ids = html.flatMap((fence) => [...fence.text.matchAll(/popover id="([^"]+)"/g)].map((m) => m[1]));
  for (const target of targets) must(ids.includes(target), `popovertarget="${target}" has no matching panel id`);
  must(new Set(targets).size === targets.length, `a demo id is used twice: ${targets.join(', ')}`);
  for (const type of EVENTS) must(raw.includes(type), `${DOC_PAGE} never documents ${type}`);
  must(/detail/.test(raw), `${DOC_PAGE} does not describe the event detail`);

  const links = [...proseText.matchAll(/\]\(([^)\s]+)\)/g)].map((match) => match[1]).filter((href) => href.startsWith('/'));
  const trailing = links.filter((href) => href.endsWith('/') && href !== '/components/');
  must(trailing.length === 0, `a page link ends in a slash and breaks check --strict: ${trailing.join(', ')}`);
  return `${fences.length} fences (${html.length} runnable), ${targets.length} wired trigger(s), 0 authored H1/H2`;
});

/* =================================== browser checks =================================== */

const BROWSER_CHECKS = [];

function registerBrowserChecks() {
  BROWSER_CHECKS.push(
    [
      'verification 4: the popover and anchor-positioning APIs the element relies on are present',
      async (browser, server) =>
        withPage(browser, server, {}, async (page) => {
          const api = await page.evaluate(() => ({
            showPopover: typeof HTMLElement.prototype.showPopover,
            hidePopover: typeof HTMLElement.prototype.hidePopover,
            togglePopover: typeof HTMLElement.prototype.togglePopover,
            popoverTargetElement: 'popoverTargetElement' in HTMLButtonElement.prototype,
            popoverOpenSelector: (() => {
              try {
                document.getElementById('p1').matches(':popover-open');
                return true;
              } catch (error) {
                return `throw ${error.name}`;
              }
            })(),
            anchorName: CSS.supports('anchor-name: --bn-x'),
            positionArea: CSS.supports('position-area: bottom'),
          }));
          must(api.showPopover === 'function', 'the popover API is not available in the target browser');
          must(api.hidePopover === 'function', 'hidePopover is missing');
          must(api.popoverOpenSelector === true, ':popover-open does not parse');
          must(api.anchorName && api.positionArea, 'CSS anchor positioning is not available — the panel would not anchor');
          return `${page.context().browser().version()}: popover OK, :popover-open OK, anchor positioning OK`;
        }),
    ],
    [
      'verification 3: a click on the trigger opens the panel, announces bn:open, and anchors it under the trigger',
      async (browser, server) =>
        withPage(browser, server, {}, async (page, issues) => {
          await page.click('#t1');
          await page.waitForFunction(() => document.getElementById('p1').matches(':popover-open'));
          await page.waitForTimeout(120);
          const state = await readState(page);
          must(state.open === true, 'the trigger did not open the panel');
          must(state.ariaExpanded === 'true', `aria-expanded was not updated (${state.ariaExpanded})`);
          must(
            state.panelBox.x === state.triggerBox.x,
            `the panel must start at the trigger's left edge: ${state.panelBox.x} vs ${state.triggerBox.x}`,
          );
          must(
            Math.abs(state.panelBox.y - state.triggerBox.bottom) <= 1,
            `the panel must sit directly under the trigger: ${state.panelBox.y} vs ${state.triggerBox.bottom}`,
          );
          must(/^--bn-dropdown-\d+$/.test(state.anchorName), `the trigger has no anchor name (${state.anchorName})`);
          must(state.positionAnchor === state.anchorName, `the panel is anchored to ${state.positionAnchor}`);

          const events = await page.evaluate(() => window.__bnEvents);
          const opened = events.filter((event) => event.type === 'bn:open');
          must(opened.length === 1, `expected exactly one bn:open, saw ${opened.length}`);
          must(opened[0].bubbles === true, 'bn:open must bubble');
          must(opened[0].composed === true, 'bn:open must be composed');
          must(opened[0].isCustomEvent === true, 'bn:open must be a CustomEvent');
          must(
            opened[0].detail.triggerId === 't1' && opened[0].detail.triggerIsElement === true,
            `bn:open detail must carry the trigger element (${JSON.stringify(opened[0].detail)})`,
          );
          must(
            opened[0].detail.panelId === 'p1' && opened[0].detail.panelIsElement === true,
            `bn:open detail must carry the panel element (${JSON.stringify(opened[0].detail)})`,
          );
          must(issues.consoleErrors.length === 0, `console errors: ${issues.consoleErrors.join(' | ')}`);
          must(issues.consoleOther.length === 0, `console warnings: ${issues.consoleOther.join(' | ')}`);
          must(issues.pageErrors.length === 0, `page errors: ${issues.pageErrors.join(' | ')}`);
          return `panel ${state.panelBox.x},${state.panelBox.y} under trigger ${state.triggerBox.x},${state.triggerBox.y}+${state.triggerBox.h}; one bubbling, composed bn:open`;
        }),
    ],
    [
      'verification 2: a <bn-dropdown> with no structure is silent — no throw, no console output',
      async (browser, server) =>
        withPage(browser, server, {}, async (page, issues) => {
          const probe = await page.evaluate(() => {
            const dangling = document.getElementById('d2');
            const bare = document.getElementById('d5');
            let threw = null;
            try {
              // Drive the paths that would explode if the element had adopted a node it never found.
              for (const element of [dangling, bare]) {
                element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
                element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                element.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: document.body }));
              }
            } catch (error) {
              threw = `${error.name}: ${error.message}`;
            }
            const trigger = document.getElementById('t2');
            return {
              threw,
              danglingAdopted: dangling._panel ?? null,
              bareAdopted: bare._panel ?? null,
              expanded: trigger.getAttribute('aria-expanded'),
              anchorStyle: trigger.getAttribute('style'),
              items: dangling.items().length,
            };
          });
          must(probe.threw === null, `a broken element threw: ${probe.threw}`);
          must(probe.danglingAdopted === null, 'a trigger pointing at a missing id must adopt nothing');
          must(probe.bareAdopted === null, 'a dropdown with no trigger must adopt nothing');
          must(probe.items === 0, `a broken element reported items: ${probe.items}`);
          must(probe.expanded === 'false', `a broken element touched aria-expanded (${probe.expanded})`);
          must(probe.anchorStyle === null, `a broken element wrote an inline style (${probe.anchorStyle})`);
          must(issues.consoleErrors.length === 0, `console errors: ${issues.consoleErrors.join(' | ')}`);
          must(issues.consoleOther.length === 0, `console warnings: ${issues.consoleOther.join(' | ')}`);
          must(issues.pageErrors.length === 0, `page errors: ${issues.pageErrors.join(' | ')}`);
          return 'no exception, no console output, nothing adopted, nothing written into the markup';
        }),
    ],
    [
      'verification 1: the keyboard walks the menu, picks an item, closes, and hands focus back',
      async (browser, server) =>
        withPage(browser, server, {}, async (page) => {
          await page.click('#t1');
          await page.waitForFunction(() => document.getElementById('p1').matches(':popover-open'));
          await page.waitForTimeout(120);

          let state = await readState(page);
          must(state.activeId === 'i1', `focus must enter the menu on open, found ${state.activeId}`);
          must(
            state.itemTabIndex.join() === '0,-1,-1',
            `roving tabindex must leave one item tabbable, found ${state.itemTabIndex.join()}`,
          );

          await page.keyboard.press('ArrowDown');
          state = await readState(page);
          must(state.activeId === 'i2', `ArrowDown must move to the next item, found ${state.activeId}`);
          must(state.itemTabIndex.join() === '-1,0,-1', `roving tabindex after ArrowDown: ${state.itemTabIndex.join()}`);

          await page.keyboard.press('End');
          state = await readState(page);
          must(state.activeId === 'i3', `End must reach the last item, found ${state.activeId}`);

          await page.keyboard.press('ArrowDown');
          state = await readState(page);
          must(state.activeId === 'i1', `ArrowDown must wrap to the first item, found ${state.activeId}`);

          await page.keyboard.press('Home');
          state = await readState(page);
          must(state.activeId === 'i1', `Home must return to the first item, found ${state.activeId}`);

          await page.keyboard.press('ArrowUp');
          state = await readState(page);
          must(state.activeId === 'i3', `ArrowUp must wrap to the last item, found ${state.activeId}`);

          // Pick the item under the keyboard: Enter on a focused button is the browser's click.
          await page.keyboard.press('Home');
          await page.keyboard.press('Enter');
          await page.waitForFunction(() => !document.getElementById('p1').matches(':popover-open'));
          await page.waitForTimeout(120);
          state = await readState(page);
          must(state.open === false, 'picking an item did not close the panel');
          must(state.activeId === 't1', `focus must return to the trigger, found ${state.activeId}`);
          must(state.ariaExpanded === 'false', `aria-expanded must report the close, found ${state.ariaExpanded}`);

          const selected = await page.evaluate(() =>
            window.__bnEvents.filter((event) => event.type === 'bn:select'),
          );
          must(selected.length === 1, `expected exactly one bn:select, saw ${selected.length}`);
          must(selected[0].detail.value === 'rename', `bn:select value was ${selected[0].detail.value}`);
          must(selected[0].bubbles === true && selected[0].composed === true, 'bn:select must bubble and compose');

          // Escape is the other way out, and it also owns the focus.
          await page.click('#t1');
          await page.waitForFunction(() => document.getElementById('p1').matches(':popover-open'));
          await page.waitForTimeout(120);
          await page.keyboard.press('ArrowDown');
          await page.keyboard.press('Escape');
          await page.waitForFunction(() => !document.getElementById('p1').matches(':popover-open'));
          await page.waitForTimeout(120);
          state = await readState(page);
          must(state.open === false, 'Escape did not close the panel');
          must(state.activeId === 't1', `Escape must hand focus back to the trigger, found ${state.activeId}`);

          const closed = await page.evaluate(() => window.__bnEvents.filter((event) => event.type === 'bn:close'));
          must(closed.length === 2, `every close must announce itself once, saw ${closed.length}`);
          return 'Arrow/Home/End walk and wrap, Enter picks, Escape and a pick both close and restore focus';
        }),
    ],
    [
      'a link item is selectable too, and the click path reports the value and closes',
      async (browser, server) =>
        withPage(browser, server, {}, async (page) => {
          await page.click('#t1');
          await page.waitForFunction(() => document.getElementById('p1').matches(':popover-open'));
          await page.waitForTimeout(120);
          await page.click('#i3');
          await page.waitForFunction(() => !document.getElementById('p1').matches(':popover-open'));
          const state = await readState(page);
          const selected = await page.evaluate(() => window.__bnEvents.filter((e) => e.type === 'bn:select'));
          must(selected.length === 1, `expected one bn:select, saw ${selected.length}`);
          must(
            selected[0].detail.value === 'Delete',
            `an item without a value attribute falls back to its label, got ${selected[0].detail.value}`,
          );
          must(
            selected[0].detail.itemId === 'i3' && selected[0].detail.itemIsElement === true,
            `the event must carry the item element, got ${JSON.stringify(selected[0].detail)}`,
          );
          must(state.open === false, 'clicking an item must close the panel');
          must(state.activeId === 't1', `focus must return to the trigger, found ${state.activeId}`);
          return 'an <a class="bn-dropdown-item"> selects, reports its label, and closes the menu';
        }),
    ],
    [
      'two dropdowns on one page never share an anchor',
      async (browser, server) =>
        withPage(browser, server, {}, async (page) => {
          const first = await page.evaluate(() => getComputedStyle(document.getElementById('t1')).anchorName);
          const second = await page.evaluate(() => getComputedStyle(document.getElementById('t3')).anchorName);
          must(first !== second, `both triggers use the anchor name ${first}`);
          await page.click('#t3');
          await page.waitForFunction(() => document.getElementById('p3').matches(':popover-open'));
          await page.waitForTimeout(120);
          const state = await readState(page, { trigger: 't3', panel: 'p3' });
          const geometry = await page.evaluate(() => {
            const trigger = document.getElementById('t3').getBoundingClientRect();
            const panel = document.getElementById('p3').getBoundingClientRect();
            return {
              triggerX: Math.round(trigger.x),
              triggerBottom: Math.round(trigger.bottom),
              panelX: Math.round(panel.x),
              panelY: Math.round(panel.y),
            };
          });
          must(state.open === true, 'the second dropdown did not open');
          must(
            geometry.panelX === geometry.triggerX && geometry.panelY === geometry.triggerBottom,
            `the second panel did not anchor under its own trigger: panel ${geometry.panelX},${geometry.panelY}`,
          );
          return `${first} vs ${second}; the second menu opened under #t3`;
        }),
    ],
    [
      'a trigger at the bottom of the page gets its panel above it, inside the viewport',
      async (browser, server) =>
        withPage(browser, server, {}, async (page) => {
          await page.click('#t4');
          await page.waitForFunction(() => document.getElementById('p4').matches(':popover-open'));
          await page.waitForTimeout(150);
          const geometry = await page.evaluate(() => {
            const trigger = document.getElementById('t4').getBoundingClientRect();
            const panel = document.getElementById('p4').getBoundingClientRect();
            return {
              triggerTop: Math.round(trigger.top),
              panelBottom: Math.round(panel.bottom),
              panelTop: Math.round(panel.top),
              panelRight: Math.round(panel.right),
              viewportWidth: innerWidth,
              viewportHeight: innerHeight,
            };
          });
          must(
            geometry.panelBottom <= geometry.triggerTop,
            `the panel must flip above the trigger: panel bottom ${geometry.panelBottom} vs trigger top ${geometry.triggerTop}`,
          );
          must(geometry.panelTop >= 0, `the flipped panel runs off the top (${geometry.panelTop})`);
          must(
            geometry.panelRight <= geometry.viewportWidth,
            `the panel runs off the right edge (${geometry.panelRight} > ${geometry.viewportWidth})`,
          );
          return `panel flipped above the trigger and stayed inside ${geometry.viewportWidth}×${geometry.viewportHeight}`;
        }),
    ],
    [
      'a click outside dismisses the menu and leaves focus where the visitor put it',
      async (browser, server) =>
        withPage(browser, server, {}, async (page) => {
          await page.click('#t1');
          await page.waitForFunction(() => document.getElementById('p1').matches(':popover-open'));
          await page.waitForTimeout(120);
          await page.click('#outside');
          await page.waitForFunction(() => !document.getElementById('p1').matches(':popover-open'));
          await page.waitForTimeout(120);
          const state = await page.evaluate(() => ({
            active: document.activeElement?.id ?? document.activeElement?.tagName,
            expanded: document.getElementById('t1').getAttribute('aria-expanded'),
          }));
          must(state.active === 'outside', `the trigger stole the focus back (${state.active})`);
          must(state.expanded === 'false', `aria-expanded was not updated (${state.expanded})`);
          return 'light dismiss closes, focus stays on #outside, aria-expanded follows';
        }),
    ],
    [
      'verification 4 (fallback): with the script blocked the CSS still opens and anchors the panel',
      async (browser, server) =>
        withPage(browser, server, { javaScriptEnabled: false }, async (page) => {
          await page.click('#t1');
          await page.waitForTimeout(150);
          const geometry = await page.evaluate(() => {
            const panel = document.getElementById('p1');
            const trigger = document.getElementById('t1').getBoundingClientRect();
            const box = panel.getBoundingClientRect();
            return {
              open: panel.matches(':popover-open'),
              triggerX: Math.round(trigger.x),
              triggerBottom: Math.round(trigger.bottom),
              panelX: Math.round(box.x),
              panelY: Math.round(box.y),
              hasShadow: getComputedStyle(panel).boxShadow,
            };
          });
          must(geometry.open === true, 'without the script the popover must still open (native invoker)');
          must(
            geometry.panelX === geometry.triggerX && geometry.panelY === geometry.triggerBottom,
            `the implicit anchor must place the panel under the trigger: ${geometry.panelX},${geometry.panelY}`,
          );
          must(geometry.hasShadow !== 'none', 'the panel lost its hard shadow without the script');
          return `no-JavaScript: panel ${geometry.panelX},${geometry.panelY} under the trigger, hard shadow intact`;
        }),
    ],
    [
      'reduced motion removes the motion and leaves the appearance alone',
      async (browser, server) => {
        const reduce = await withPage(browser, server, { reducedMotion: 'reduce', freeze: false }, async (page) => {
          const matches = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
          must(matches === true, 'the reducedMotion: reduce context did not reach the page');
          await page.click('#t1');
          await page.waitForFunction(() => document.getElementById('p1').matches(':popover-open'));
          const style = await page.evaluate(() => {
            const panel = getComputedStyle(document.getElementById('p1'));
            const item = getComputedStyle(document.getElementById('i1'));
            return {
              animation: panel.animationName,
              itemTransition: item.transitionDuration,
              itemColor: item.color,
            };
          });
          must(style.animation === 'none', `the panel must not animate under reduced motion (${style.animation})`);
          must(
            style.itemTransition.split(',').every((value) => value.trim() === '0s'),
            `the item must not transition under reduced motion (${style.itemTransition})`,
          );
          return `animation: ${style.animation}, item transition: ${style.itemTransition}`;
        });
        const full = await withPage(browser, server, { freeze: false }, async (page) => {
          const matches = await page.evaluate(() => matchMedia('(prefers-reduced-motion: no-preference)').matches);
          must(matches === true, 'the default context does not prefer no-preference');
          await page.click('#t1');
          await page.waitForFunction(() => document.getElementById('p1').matches(':popover-open'));
          const style = await page.evaluate(() => ({
            animation: getComputedStyle(document.getElementById('p1')).animationName,
            itemTransition: getComputedStyle(document.getElementById('i1')).transitionDuration,
          }));
          must(style.animation === 'bn-fade-in-up', `the panel must animate in (${style.animation})`);
          must(
            style.itemTransition.split(',').every((value) => value.trim() === '0.15s'),
            `the item highlight must run for --bn-motion (${style.itemTransition})`,
          );
          return `animation: ${style.animation}, item transition: ${style.itemTransition}`;
        });
        return `reduce → ${reduce}; no-preference → ${full}`;
      },
    ],
  );
}

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
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  console.log(`      ${server.url} on system Chrome ${browser.version()}\n`);
  try {
    for (const [name, fn] of BROWSER_CHECKS) await check(name, () => fn(browser, server));
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
