#!/usr/bin/env node
/**
 * Scripted verification for ticket 13 — Table.
 *
 * The three verification methods in `.scratch/barnacle-design/issues/13-table.md` are the
 * specification of this file, and every checklist bullet is a check below:
 *
 *   1. the window squeezed to phone width: the page itself never scrolls sideways, the table does
 *   2. adjacent cells paint one border, never a double line and never a misaligned seam
 *   3. the header separator is still unmistakable in the dark theme
 *   plus: the alignment rule is decidable (numbers end-aligned, text start-aligned), and no
 *   focus or selection state can move a border width.
 *
 * The expected values are the independent source of truth: spec.md §3 (invariants), §5 (this file
 * owns bare `table`/`thead`/`tbody`/`th`/`td`), §6 (tokens), §7 (interaction contract), §8 (Table's
 * semantic anchors), §10 (a component page has no authored H2), ADR-0001 (the element is the
 * anchor), ADR-0003 (shadow tiers), ADR-0005 (`--bn-` / `--_` only) and
 * `D:\code\barnacle-notes\orchestrator-decisions.md` §1/§4/§11. They are never recomputed from
 * `src/css/table.css`.
 *
 * Two things about the browser half are deliberate:
 *
 *   - Every measurement is taken from `static/barnacle.css`, the shipped bytes, served from
 *     `static/` only. Nothing from `src/` is reachable, so a green run cannot be measuring a
 *     source file the browser never loaded.
 *   - A wide table inside no wrapper is measured too, as a *negative control*: a `<table>` is not
 *     a block container, `overflow` does not apply to `display: table`, and no rule in the library
 *     can make a bare `<table>` scroll. That boundary is exactly why the page must document a
 *     wrapper, so it is asserted rather than assumed.
 *
 * Run with: npm run verify:table   (or: node scripts/verify-table.mjs)
 * Options:  --no-browser  skip the real-Chrome checks (they need playwright-core)
 *           --no-docs     skip the seite build + built-page checks
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

/* ------------------------------------ expectations ----------------------------------- */

const SOURCE = 'src/css/table.css';
const ARTIFACT = 'static/barnacle.css';
const ARTIFACT_MIN = 'static/barnacle.min.css';
const DOC_PAGE = 'content/components/table.md';
const DOC_HTML = 'dist/components/table.html';

/** spec §6.1 — computed values, spelled out here so the source can never define its own truth. */
const BORDER = '3px';
const COLLAPSE = 'separate';
const SPACING = '0px';
const RADIUS = '0px';
const INK = 'rgb(0, 0, 0)';
const SURFACE = 'rgb(255, 255, 255)';
const MAIN_SURFACE = 'rgb(255, 210, 63)';
const RING_COLOR = 'rgb(116, 185, 255)';
const DARK_SURFACE = 'rgb(38, 38, 38)';
const DARK_INK = 'rgb(255, 253, 245)';
const MOTION = '0.15s';

/** ADR-0003: the table is a static block, so it takes the small tier — half the base offset. */
const SHADOW_SM = 'rgb(0, 0, 0) 2px 2px 0px 0px';
const SHADOW_LIFT_PX = 2;

/** The base layer's typography: --bn-font-weight-base / --bn-font-weight-heading (spec §6.1). */
const BODY_WEIGHT = '500';
const HEADING_WEIGHT = '700';

/**
 * The row tints, worked out by hand from spec §6.1 — independent expectations, not values read back
 * out of the browser. `color-mix(in srgb, A p%, B)` is p·A + (1−p)·B per channel:
 *   hover    = #FFD23F 18% + #FFFFFF 82% = rgb(255, 247, 220)
 *   selected = #FFD23F 40% + #FFFFFF 60% = rgb(255, 237, 178)
 *   selected, dark (background #262626) = rgb(125, 107, 48)
 * Chrome serialises the result as `color(srgb …)`, so it is compared channel by channel.
 */
const HOVER_TINT_RGB = [255, 247, 220];
const SELECTED_TINT_RGB = [255, 237, 178];
const DARK_SELECTED_TINT_RGB = [125, 107, 48];

/**
 * WCAG 2.x relative-luminance contrast floors, as asserted numbers:
 *   - body text keeps the page's own ink on the page's own surface — never faded to create the
 *     header/body hierarchy (the ticket forbids exactly that): 7:1 is the AAA body floor.
 *   - the separator line must be distinguishable from the surface it is drawn against (3:1 is the
 *     WCAG non-text floor). It is deliberately *not* asserted against the header band: a saturated
 *     yellow band and a white body have a luminance ratio near 1.4 by construction, and a luminance
 *     floor between them would be measuring the wrong thing. What makes the bands distinguishable is
 *     then asserted where it really lives: the band's saturation against the body's.
 */
const TEXT_CONTRAST_FLOOR = 7;
const LINE_CONTRAST_FLOOR = 3;
/** The header band is a saturated colour band, not a slightly darker grey: |Δsaturation| ≥ 0.5. */
const BAND_SATURATION_FLOOR = 0.5;

/** spec §3 invariant 3 / §7 — properties whose value *is* the geometry. */
const GEOMETRY_PROPERTIES = [
  'transform',
  'translate',
  'box-shadow',
  'outline',
  'outline-offset',
  'transition',
  'transition-property',
  'transition-duration',
];

/** spec §3 invariant 7 — a state rule may change colour, never a box metric. */
const STATE_PROPERTIES = new Set([
  'background',
  'background-color',
  'color',
  'border-color',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'border-block-start-color',
  'border-inline-start-color',
  'outline',
  'outline-color',
  'outline-offset',
  'opacity',
  'cursor',
]);

/** The box metrics no state rule may touch, spelled out so a violation names the property. */
const BOX_METRIC = /^(?:border|border-width|border-block-start|border-inline-start|border-(?:top|right|bottom|left)(?:-width)?|padding|padding-\w+|margin|margin-\w+|inline-size|block-size|width|height|font-size|font-weight|line-height)$/;

/** Hardcoded colour forms ADR-0005 keeps in 01-theme.css only (`color-mix(in srgb, …)` is not one). */
const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch|oklab|lch|lab|color)\(/;

/** Any absolute pixel length. The library's scale is relative, and geometry comes from slots. */
const PX_LITERAL = /[\d.]+px/;

const STATE_SELECTOR = /:(?:hover|active|focus-visible|focus|checked|target)\b|\[class[*^$|~]?=|\.bn-selected\b/;

/** spec §5 + the two names this ticket introduces (ADR-0005: appearance rides `bn-`). */
const REQUIRED_SELECTORS = [
  'table',
  'thead',
  'tbody',
  'caption',
  'th',
  'td',
  'figure',
  '.bn-table-scroll',
  '.bn-num',
  '.bn-selected',
];

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

const isStateRule = (rule) => STATE_SELECTOR.test(rule.selector);

/* -------------------------------- the documentation page ------------------------------- */

/**
 * Split a content file into frontmatter, prose and fences, the way seite reads it and the way
 * scripts/verify-demo.mjs dissects it: a fence is only a fence when its ``` sits at the start of a
 * line, and the info string is what an author wrote.
 */
function dissectDocs(raw) {
  const frontmatterMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const frontmatter = frontmatterMatch ? frontmatterMatch[1] : '';
  const body = frontmatterMatch ? raw.slice(frontmatterMatch[0].length) : raw;
  const proseLines = [];
  const fences = [];
  let open = null;
  for (const line of body.split(/\r?\n/)) {
    const marker = line.match(/^(\s*)(`{3,}|~{3,})(.*)$/);
    if (!open) {
      if (marker && marker[1] === '') open = { info: marker[3].trim(), lines: [] };
      else proseLines.push(line);
      continue;
    }
    if (marker && marker[1] === '' && marker[2][0] === '`' && marker[2].length >= 3) {
      fences.push({ info: open.info, text: open.lines.join('\n') });
      open = null;
      continue;
    }
    open.lines.push(line);
  }
  if (open) fences.push({ info: open.info, text: open.lines.join('\n'), unterminated: true });
  return { frontmatter, prose: proseLines.join('\n'), fences };
}

/** A fence info string must stay a bare language token (the demo layer's contract). */
const ALLOWED_FENCE_INFO =
  /^(?:html|css|js|javascript|json|xml|svg|text|txt|markdown|md|powershell|ps1|sh|bash|shell|console|diff)?$/;

/** Prose with inline code spans removed: `<table>` in backticks is text, not markup. */
const proseWithoutInlineCode = (prose) => prose.replace(/`[^`]*`/g, '``');

/* -------------------------------------- the page -------------------------------------- */

/**
 * The measurement page. Every table on it is markup a user would really write: a captioned table
 * in a `<figure>` (the semantic wrapper), the same table in a `.bn-table-scroll` `<div>` (the
 * escape hatch for markup with no semantic wrapper), and a bare `<table>` with no wrapper at all.
 *
 * The two wide tables carry five columns and a `colgroup` so that both alignment mechanisms are
 * measurable. The first one keeps `.bn-num` on the `<col>` on purpose: measured in Chrome, a
 * `text-align` on a `<col>` does *not* reach the cells of that column, so the class has to go on the
 * header cell and on the cells themselves. That measurement is asserted below rather than assumed.
 *
 * No `<script>` tag anywhere in it: the no-JavaScript check is about the artifact, not about a
 * fixture that dresses itself.
 */
const FIXTURE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <link rel="icon" href="data:,">
    <title>barnacle table harness</title>
    <link rel="stylesheet" href="/static/barnacle.css">
  </head>
  <body>
    <main>
      <figure id="figure">
        <table id="table">
          <caption id="caption">Revenue by region</caption>
          <colgroup>
            <col><col><col><col><col class="bn-num">
          </colgroup>
          <thead>
            <tr id="head-row">
              <th scope="col" id="h-region">Region</th>
              <th scope="col" id="h-city">City</th>
              <th scope="col" id="h-beds">Beds</th>
              <th scope="col" id="h-occupancy">Occupancy</th>
              <th scope="col" id="h-revenue">Revenue in thousands</th>
            </tr>
          </thead>
          <tbody>
            <tr id="row-1">
              <th scope="row" id="r1-name">North</th>
              <td id="r1-city">Oslo</td>
              <td id="r1-beds">1,204</td>
              <td id="r1-occupancy">82%</td>
              <td id="r1-revenue">3,917</td>
            </tr>
            <tr id="row-2" class="bn-selected">
              <th scope="row" id="r2-name">South</th>
              <td id="r2-city">Lisbon</td>
              <td id="r2-beds">980</td>
              <td id="r2-occupancy">74%</td>
              <td id="r2-revenue">2,184</td>
            </tr>
            <tr id="row-3">
              <th scope="row" id="r3-name">East</th>
              <td id="r3-city" tabindex="0">Kyiv</td>
              <td id="r3-beds">1,733</td>
              <td id="r3-occupancy">88%</td>
              <td id="r3-revenue">4,102</td>
            </tr>
          </tbody>
          <tfoot>
            <tr id="foot-row">
              <th scope="row" id="f-name">Total</th>
              <td id="f-city"></td>
              <td id="f-beds">3,917</td>
              <td id="f-occupancy"></td>
              <td id="f-revenue">10,203</td>
            </tr>
          </tfoot>
        </table>
        <figcaption id="figcaption">Figures are in thousands of euros.</figcaption>
      </figure>

      <div class="bn-table-scroll" id="wrap-div">
        <table id="table-classed">
          <colgroup>
            <col><col><col><col>
          </colgroup>
          <thead>
            <tr id="c-head-row">
              <th scope="col" id="c-h-region">Region</th>
              <th scope="col" id="c-h-city">City</th>
              <th scope="col" id="c-h-beds">Beds</th>
              <th scope="col" id="c-h-occupancy">Occupancy</th>
              <th scope="col" class="bn-num" id="c-h-revenue">Revenue in thousands</th>
            </tr>
          </thead>
          <tbody>
            <tr id="c-row-1">
              <td id="c-r1-region">North</td>
              <td id="c-r1-city">Oslo</td>
              <td id="c-r1-beds">1,204</td>
              <td id="c-r1-occupancy">82%</td>
              <td class="bn-num" id="c-r1-revenue">3,917</td>
            </tr>
            <tr id="c-row-2">
              <td id="c-r2-region">South</td>
              <td id="c-r2-city">Lisbon</td>
              <td id="c-r2-beds">980</td>
              <td id="c-r2-occupancy">74%</td>
              <td class="bn-num" id="c-r2-revenue">2,184</td>
            </tr>
          </tbody>
        </table>
      </div>

      <table id="table-bare">
        <thead>
          <tr><th scope="col" id="b-head-city">City</th><th scope="col">Beds</th></tr>
        </thead>
        <tbody>
          <tr><td id="b-cell-city">Oslo</td><td id="b-cell-beds">12</td></tr>
        </tbody>
      </table>
    </main>
  </body>
</html>
`;

/**
 * The same wide table, with no wrapper anywhere near it: the negative control for "a bare
 * `<table>` cannot scroll itself". Used only in the browser checks, and only for that claim.
 */
const BARE_WIDE_FIXTURE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <link rel="icon" href="data:,">
    <title>barnacle table harness — no wrapper</title>
    <link rel="stylesheet" href="/static/barnacle.css">
  </head>
  <body>
    <main>
      <table id="table-bare-wide">
        <thead>
          <tr>
            <th scope="col">Region</th><th scope="col">City</th><th scope="col">Beds</th>
            <th scope="col">Occupancy</th><th scope="col">Revenue in thousands</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>North</td><td>Oslo</td><td>1,204</td><td>82%</td><td>3,917</td></tr>
        </tbody>
      </table>
    </main>
  </body>
</html>
`;

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.xml': 'application/xml; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * Serves the in-memory fixtures, the published artifact from `static/`, and — under the `/docs/`
 * prefix — the built site from `dist/` for the documentation-page checks.
 */
async function startServer() {
  const staticRoot = abs('static');
  const distRoot = abs('dist');
  const server = http.createServer((req, res) => {
    let urlPath;
    try {
      urlPath = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    } catch {
      res.writeHead(400).end('bad url');
      return;
    }
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
      res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' }).end(FIXTURE);
      return;
    }
    if (urlPath === '/bare.html') {
      res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' }).end(BARE_WIDE_FIXTURE);
      return;
    }
    if (urlPath.startsWith('/static/')) {
      const file = path.resolve(staticRoot, `.${urlPath.replace(/^\/static/, '')}`);
      if (file.startsWith(staticRoot + path.sep)) {
        send(file);
        return;
      }
    }
    if (urlPath === '/docs' || urlPath.startsWith('/docs/')) {
      const rel = urlPath.replace(/^\/docs/, '') || '/';
      // A static host resolves /usage to usage.html; mirror that here.
      const candidates = rel.endsWith('/')
        ? [path.join(rel, 'index.html')]
        : [rel, `${rel}.html`, path.join(rel, 'index.html')];
      const file = candidates
        .map((candidate) => path.resolve(distRoot, `.${candidate}`))
        .find((candidate) => candidate.startsWith(distRoot + path.sep) && fs.existsSync(candidate) && fs.statSync(candidate).isFile());
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
    fixture: `${origin}/harness.html`,
    bare: `${origin}/bare.html`,
    docs: `${origin}/docs/components/table`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/**
 * A mid-transition read lies in a very believable way: 30/30 reads after `hover()` return the
 * value from *before* the transition (browser-harness-findings §3.3). Freezing is not optional,
 * and it must be registered before `goto` — `addStyleTag` after load is already too late.
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

/** One page per check, so a failure cannot leak state (or a hover) into the next one. */
async function withPage(browser, url, options, fn) {
  const { freeze = true, githubPages = false, ...contextOptions } = options ?? {};
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...contextOptions });
  // The built pages reference their assets through the deployed absolute base_url (spec §12), so a
  // documentation-page check has to answer those requests from dist/ — the same trick
  // scripts/verify-demo.mjs uses, and it doubles as a sub-path safety check.
  if (githubPages) {
    await context.route('https://ivan112058.github.io/barnacle/**', (route) => {
      const target = new URL(route.request().url()).pathname.replace(/^\/barnacle/, '') || '/';
      const file = path.join(abs('dist'), target === '/' ? 'index.html' : target);
      route.fulfill(fs.existsSync(file) ? { path: file } : { status: 404, body: `not found: ${target}` });
    });
  }
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  // The freeze overwrites `transition`, so a check that is *about* the transition declaration opts
  // out with { freeze: false }. With JavaScript disabled there is no init script to run.
  if (freeze && contextOptions.javaScriptEnabled !== false) {
    await page.addInitScript(FREEZE_INIT, FREEZE_CSS);
  }
  try {
    await page.goto(url, { waitUntil: 'load' });
    return await fn(page, { consoleErrors, pageErrors });
  } finally {
    await context.close();
  }
}

/* ---------------------------------- readable assertions ---------------------------------- */

class StyleAssertionError extends Error {
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
    this.name = 'StyleAssertionError';
    Object.assign(this, { invariant, selector, property, expected, actual, hint });
  }
}

/** Reads several computed properties of one element inside a single style snapshot. */
async function readStyles(page, selector, properties) {
  return page.evaluate(
    ([sel, props]) => {
      const el = document.querySelector(sel);
      if (!el) return { found: false };
      const cs = getComputedStyle(el);
      const out = { found: true };
      for (const property of props) out[property] = cs[property];
      return out;
    },
    [selector, properties],
  );
}

/** Compares computed properties; reports every failure instead of only the first one. */
async function expectStyle(page, selector, expectations, invariantPrefix = '') {
  const properties = Object.keys(expectations);
  const actual = await readStyles(page, selector, properties);
  if (!actual.found) {
    throw new StyleAssertionError({
      invariant: `${invariantPrefix}the element exists`,
      selector,
      property: '<existence>',
      expected: 'an element matching the selector',
      actual: '<element not found>',
      hint: 'check the fixture markup in scripts/verify-table.mjs',
    });
  }
  const broken = [];
  for (const [property, want] of Object.entries(expectations)) {
    if (actual[property] === want) continue;
    broken.push(
      new StyleAssertionError({
        invariant: `${invariantPrefix}${property}`,
        selector,
        property,
        expected: want,
        actual: actual[property],
        hint: /\d+\.\d+px/.test(String(actual[property]))
          ? 'a fractional px length usually means the transition was NOT frozen in time'
          : undefined,
      }),
    );
  }
  if (broken.length > 0) throw new AggregateError(broken, broken.map((error) => error.message).join('\n\n'));
  return actual;
}

/**
 * The whole table as one snapshot: the table box, its own frame, and for every cell its border
 * widths, its box geometry and the few computed properties the hierarchy and alignment checks
 * need. One `evaluate` means the numbers below all describe the same layout, which is what makes
 * "the seam between these two cells" a measurement instead of a comparison of two moments.
 */
async function readTableGeometry(page, selector) {
  return page.evaluate((sel) => {
    const table = document.querySelector(sel);
    if (!table) return { found: false };
    const cs = getComputedStyle(table);
    const rect = table.getBoundingClientRect();
    const round = (value) => Math.round(value * 100) / 100;
    return {
      found: true,
      id: table.id,
      borderCollapse: cs.borderCollapse,
      borderSpacing: cs.borderSpacing,
      boxSizing: cs.boxSizing,
      tableLayout: cs.tableLayout,
      textAlign: cs.textAlign,
      radius: cs.borderTopLeftRadius,
      boxShadow: cs.boxShadow,
      background: cs.backgroundColor,
      frame: {
        top: cs.borderTopWidth,
        right: cs.borderRightWidth,
        bottom: cs.borderBottomWidth,
        left: cs.borderLeftWidth,
        style: cs.borderTopStyle,
        color: cs.borderTopColor,
      },
      rect: {
        x: round(rect.x),
        y: round(rect.y),
        width: round(rect.width),
        height: round(rect.height),
        right: round(rect.right),
        bottom: round(rect.bottom),
      },
      // A caption is the first box inside the table's border box, so the frame's block-start edge
      // is measured against the caption when there is one and against the first row when there is
      // not. Either way the number has to be exactly one border.
      caption: table.caption
        ? (() => {
            const r = table.caption.getBoundingClientRect();
            const s = getComputedStyle(table.caption);
            return { y: round(r.y), bottom: round(r.bottom), height: round(r.height), captionSide: s.captionSide };
          })()
        : null,
      rows: [...table.rows].map((row, rowIndex) => ({
        id: row.id,
        section: row.parentElement.tagName.toLowerCase(),
        rowIndex,
        cells: [...row.cells].map((cell, cellIndex) => {
          const s = getComputedStyle(cell);
          const r = cell.getBoundingClientRect();
          return {
            tag: cell.tagName.toLowerCase(),
            id: cell.id,
            rowIndex,
            cellIndex,
            x: round(r.x),
            y: round(r.y),
            width: round(r.width),
            height: round(r.height),
            right: round(r.right),
            bottom: round(r.bottom),
            borderTopWidth: s.borderTopWidth,
            borderRightWidth: s.borderRightWidth,
            borderBottomWidth: s.borderBottomWidth,
            borderLeftWidth: s.borderLeftWidth,
            borderTopColor: s.borderTopColor,
            borderInlineStartWidth: s.borderInlineStartWidth,
            background: s.backgroundColor,
            color: s.color,
            textAlign: s.textAlign,
            fontWeight: s.fontWeight,
            whiteSpace: s.whiteSpace,
            verticalAlign: s.verticalAlign,
            fontVariantNumeric: s.fontVariantNumeric,
            paddingInlineStart: s.paddingInlineStart,
            paddingInlineEnd: s.paddingInlineEnd,
          };
        }),
      })),
    };
  }, selector);
}

const NONZERO = (width) => Number.parseFloat(width) > 0;

/**
 * The double-line proof, expressed as a statement about *owners*: for every interior edge of the
 * grid, exactly one of the two cells that meet there may declare a border. Two owners means a
 * double line; a gap means a misaligned seam; a frame that is not exactly one border means the
 * table's own frame and the cell's border were both painted.
 */
function analyseSeams(geometry) {
  const rows = geometry.rows;
  const vertical = [];
  const horizontal = [];
  for (let r = 0; r < rows.length; r += 1) {
    const cells = rows[r].cells;
    for (let c = 0; c + 1 < cells.length; c += 1) {
      const left = cells[c];
      const right = cells[c + 1];
      vertical.push({
        edge: `row ${r} col ${c}|${c + 1}`,
        owners: [left.borderRightWidth, right.borderLeftWidth].filter(NONZERO),
        gap: Math.round((right.x - left.right) * 100) / 100,
        left,
        right,
      });
    }
  }
  for (let r = 0; r + 1 < rows.length; r += 1) {
    const upper = rows[r].cells;
    const lower = rows[r + 1].cells;
    for (let c = 0; c < Math.min(upper.length, lower.length); c += 1) {
      horizontal.push({
        edge: `row ${r}|${r + 1} col ${c}`,
        owners: [upper[c].borderBottomWidth, lower[c].borderTopWidth].filter(NONZERO),
        gap: Math.round((lower[c].y - upper[c].bottom) * 100) / 100,
        upper: upper[c],
        lower: lower[c],
      });
    }
  }

  const first = rows[0].cells;
  const last = rows[rows.length - 1].cells;
  // Measured in Chrome: a `caption-side: top` caption starts at the table's border-box top and the
  // frame's block-start line is painted *below* it, between the caption and the first row. So the
  // frame's top edge is measured against the caption's bottom edge when there is one, and against
  // the border box otherwise — both have to come out at exactly one border width.
  const captionAbove = geometry.caption ? Math.round((geometry.caption.y - geometry.rect.y) * 100) / 100 : null;
  const captionToFrame = geometry.caption ? Math.round((first[0].y - geometry.caption.bottom) * 100) / 100 : null;
  const columns = Math.max(...rows.map((row) => row.cells.length));
  const columnDrift = [];
  for (let c = 0; c < columns; c += 1) {
    const inColumn = rows.map((row) => row.cells[c]).filter(Boolean);
    const lefts = inColumn.map((cell) => cell.x);
    const rights = inColumn.map((cell) => cell.right);
    columnDrift.push({
      column: c,
      left: Math.round((Math.max(...lefts) - Math.min(...lefts)) * 100) / 100,
      right: Math.round((Math.max(...rights) - Math.min(...rights)) * 100) / 100,
    });
  }

  return {
    vertical,
    horizontal,
    columnDrift,
    frame: {
      left: Math.round((first[0].x - geometry.rect.x) * 100) / 100,
      right: Math.round((geometry.rect.right - first[first.length - 1].right) * 100) / 100,
      top: captionToFrame ?? Math.round((first[0].y - geometry.rect.y) * 100) / 100,
      bottom: Math.round((geometry.rect.bottom - last[0].bottom) * 100) / 100,
    },
    captionAbove,
    captionToFrame,
    rowWidth: Math.round(first.reduce((sum, cell) => sum + cell.width, 0) * 100) / 100,
  };
}

/** Relative luminance and the WCAG contrast ratio — the honest way to say "still readable". */
function contrastRatio(foreground, background) {
  const channel = (value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (rgb) => {
    const [r, g, b] = rgb.match(/[\d.]+/g).slice(0, 3).map(Number);
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const a = luminance(foreground);
  const b = luminance(background);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

/** HSV saturation of a computed `rgb(…)` string — how far a colour is from a grey of equal value. */
function saturation(rgb) {
  const [r, g, b] = rgb.match(/[\d.]+/g).slice(0, 3).map(Number);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : Math.round(((max - min) / max) * 1000) / 1000;
}

/** The numeric channels of a computed colour: `rgb(…)`, `rgba(…)` and `color(srgb …)` alike. */
function rgbChannels(value) {
  const srgb = value.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  if (srgb) return [1, 2, 3].map((index) => Number(srgb[index]) * 255);
  return value.match(/[\d.]+/g).slice(0, 3).map(Number);
}

/** Compares a computed background against a hand-derived rgb triple, allowing 8-bit rounding. */
async function expectColour(page, selector, expected, label) {
  const snapshot = await readStyles(page, selector, ['backgroundColor']);
  must(snapshot.found, `${label}${selector} is missing from the fixture`);
  const delta = rgbChannels(snapshot.backgroundColor).map(
    (channel, index) => Math.round(Math.abs(channel - expected[index]) * 100) / 100,
  );
  must(
    delta.every((channel) => channel <= 1),
    `${label}${selector} must be rgb(${expected.join(', ')}), read ${snapshot.backgroundColor} (Δ ${delta.join(', ')})`,
  );
  return `${snapshot.backgroundColor} = rgb(${expected.join(', ')})`;
}

/* ================================ static checks: the page ============================= */

console.log(`barnacle table verification — ${ROOT}\n`);

const rawSource = fs.readFileSync(abs(SOURCE), 'utf8');
const source = blankComments(rawSource);
const rules = parseRules(source);
const allDeclarations = rules.flatMap((rule) =>
  declarations(rule.body).map(([property, value]) => ({ property, value, ...rule })),
);
const customProps = [...new Set([...source.matchAll(/--[\w-]+/g)].map((match) => match[0]))];

const rawArtifact = fs.readFileSync(abs(ARTIFACT), 'utf8');
const rawArtifactMin = fs.readFileSync(abs(ARTIFACT_MIN), 'utf8');

const docsRaw = fs.existsSync(abs(DOC_PAGE)) ? fs.readFileSync(abs(DOC_PAGE), 'utf8') : '';
const docs = dissectDocs(docsRaw);

await check(`the Table page exists as a component page (${DOC_PAGE})`, () => {
  must(docsRaw.length > 0, `${DOC_PAGE} is missing`);
  must(/^title:\s*".+"$/m.test(docs.frontmatter), 'the frontmatter has no quoted title');
  must(/^description:\s*".+"$/m.test(docs.frontmatter), 'the frontmatter has no quoted description');
  const bytes = fs.readFileSync(abs(DOC_PAGE));
  must(!(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf), 'a BOM makes seite fail the build');
  const headings = [...docs.prose.matchAll(/^(#{1,6})\s+(.*)$/gm)].map((match) => match[0]);
  const tooHigh = headings.filter((heading) => /^#{1,2}\s/.test(heading));
  must(
    tooHigh.length === 0,
    `a component page body starts at H3 — the template supplies the one H2 (spec §10): ${tooHigh.join(' | ')}`,
  );
  must(headings.length > 0, 'the page has no headings at all');
  const badFences = docs.fences.filter((fence) => !ALLOWED_FENCE_INFO.test(fence.info) || fence.unterminated);
  must(
    badFences.length === 0,
    `every fence must be a plain language token and terminated: ${badFences.map((fence) => fence.info).join(', ')}`,
  );
  return `${headings.length} H3 heading(s), ${docs.fences.length} fence(s): ${docs.fences.map((fence) => fence.info).join(', ')}`;
});

await check('the example is runnable markup: bare anchors plus the documented scroll wrapper', () => {
  const demos = docs.fences.filter((fence) => fence.text.trim().startsWith('<'));
  must(demos.length > 0, 'no HTML fence exists, so the page has no Preview panel');
  const demo = demos[0].text;
  for (const anchor of ['<table', '<thead', '<tbody', '<tfoot', '<th ', '<td', 'scope="row"']) {
    must(demo.includes(anchor), `the example has no ${anchor} — the semantic anchors are the point`);
  }
  must(
    /<figure[^>]*>[\s\S]*<table/.test(demo),
    'the example must wrap its table in the documented scroll container (a `figure` here)',
  );
  must(/class="bn-num"/.test(demo), 'the example does not carry a .bn-num column');
  must(
    (demo.match(/class="bn-num"/g) ?? []).length >= 3,
    'every cell of the numeric column needs the class — a <col> cannot carry it (measured)',
  );
  return `${demo.split('\n').length} lines of example markup, figure-wrapped, numeric column on the cells`;
});

await check('the prose names the semantic anchors and documents both names the page needs', () => {
  const prose = docs.prose;
  const anchors = ['`table`', '`thead`', '`tbody`', '`th`', '`td`'];
  const missing = anchors.filter((anchor) => !prose.includes(anchor));
  must(missing.length === 0, `the page never names ${missing.join(', ')}`);
  for (const name of ['figure', '.bn-table-scroll', '.bn-num', '.bn-selected']) {
    must(prose.includes(name), `the page never documents ${name}`);
  }
  must(
    /not a block container/.test(prose) && /overflow/.test(prose),
    'the page must say why the wrapper is needed (a table is not a block container)',
  );
  const shortcode = prose.match(/\{\{[<%#]/);
  must(!shortcode, `the prose uses seite shortcode syntax (${shortcode?.[0]}) — authors write Markdown only`);
  const rawHtml = proseWithoutInlineCode(prose).match(/<[a-zA-Z][^>]*>/);
  must(!rawHtml, `raw HTML outside a fence: ${rawHtml?.[0]} — the demo layer is the only renderer`);
  for (const marker of ['site-demo', 'data-site-']) {
    must(!prose.includes(marker), `the prose mentions ${marker}; the layer must not need author markup`);
  }
  return `anchors ${anchors.join(' ')}, wrapper + alignment + selection documented, no raw HTML in prose`;
});

await check('no link on the page carries a trailing slash (check --strict calls those broken)', () => {
  const links = [...docsRaw.matchAll(/\]\(([^)\s]+)\)/g)].map((match) => match[1]);
  const trailing = links.filter((href) => href.endsWith('/'));
  must(
    trailing.length === 0,
    `a root-relative link must not end in "/": ${trailing.join(', ')} — only the collection index does`,
  );
  const outside = links.filter((href) => /^https?:/.test(href));
  must(outside.length === 0, `an absolute link would leave the base path: ${outside.join(', ')}`);
  return links.length === 0 ? 'no links in the body' : `${links.length} link(s), none trailing: ${links.join(', ')}`;
});

/* =================================== static checks =================================== */

await check('src/css/table.css is UTF-8 without a BOM and writes no @layer', () => {
  const bytes = fs.readFileSync(abs(SOURCE));
  must(
    !(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf),
    'a BOM breaks the build chain and seite content checks',
  );
  const offenders = rawSource
    .split(/\r?\n/)
    .map((line, index) => [line, index + 1])
    .filter(([line]) => /^\s*@layer\b/.test(line));
  must(
    offenders.length === 0,
    `remove @layer from line(s) ${offenders.map(([, n]) => n).join(', ')} — CSS_MANIFEST in scripts/build.mjs assigns the layer`,
  );
  must(rules.length > 0, 'the file declares no rule at all — ticket 13 has not landed');
  return `${rules.length} rules, layer assignment left to the manifest`;
});

await check('src/css/table.css invents no name (ADR-0005: --bn-* and --_* only)', () => {
  const unknownPublic = customProps.filter((name) => HYGIENE.publicToken.test(name) && !PUBLIC_TOKENS.has(name));
  must(
    unknownPublic.length === 0,
    `unknown public token(s): ${unknownPublic.join(', ')} — spec §6.1 is the whole vocabulary`,
  );
  const foreign = customProps.filter(
    (name) => !HYGIENE.publicToken.test(name) && !HYGIENE.internalToken.test(name),
  );
  must(foreign.length === 0, `custom properties outside the two namespaces: ${foreign.join(', ')}`);

  const declared = [
    ...new Set(
      allDeclarations.map(({ property }) => property).filter((name) => HYGIENE.internalToken.test(name)),
    ),
  ];
  const invented = declared.filter((name) => !FROZEN_SLOTS.has(name));
  must(
    invented.length === 0,
    `new internal slot(s): ${invented.join(', ')} — geometry is declared once, in 00-base.css (orchestrator §4)`,
  );
  const read = [...new Set([...source.matchAll(/var\(\s*(--_[\w-]+)/g)].map((match) => match[1]))];
  const unknownReads = read.filter((name) => !FROZEN_SLOTS.has(name));
  must(unknownReads.length === 0, `unknown internal variable(s) read: ${unknownReads.join(', ')}`);
  return `${declared.length} frozen slot(s) re-pointed, ${read.length} read, 0 invented`;
});

await check('no !important and no colour literal (colours come from 01-theme.css)', () => {
  must(!/!\s*important/.test(source), 'the layer contract makes !important unnecessary and forbidden');
  const offenders = [...source.matchAll(new RegExp(COLOUR_LITERAL.source, 'g'))].map((match) => match[0]);
  must(offenders.length === 0, `hardcoded colour(s): ${[...new Set(offenders)].join(', ')}`);
  const mixes = [...source.matchAll(/color-mix\([^)]*\)/g)].map((match) => match[0]);
  const literalMix = mixes.filter((call) => !/var\(--/.test(call));
  must(literalMix.length === 0, `color-mix() must mix tokens, not literals: ${literalMix.join('; ')}`);
  must(mixes.length > 0, 'no color-mix() tint is declared — the row states have no colour to paint');
  return `0 colour literals, ${mixes.length} token-only color-mix() tint(s)`;
});

await check('every length is a token or a relative unit — no px literal anywhere in the file', () => {
  const offenders = [...source.matchAll(new RegExp(PX_LITERAL.source, 'g'))].map((match) => match[0]);
  must(
    offenders.length === 0,
    `absolute pixel length(s): ${[...new Set(offenders)].join(', ')} — ` +
      'the type scale is relative and geometry is derived from --bn-* (spec §3 invariant 3)',
  );
  return '0 px literals';
});

await check('geometry reads the shared slots (no numeric displacement, no literal shadow)', () => {
  const offenders = allDeclarations
    .filter(({ property, value }) => GEOMETRY_PROPERTIES.includes(property) && /\d/.test(value))
    .map(({ selector, property, value }) => `${selector} { ${property}: ${value} }`);
  must(
    offenders.length === 0,
    `geometry must be a var(--_…) reference (spec §3 invariant 3): ${offenders.join('; ')}`,
  );
  const translates = [...source.matchAll(/translate\(([^)]*)\)/g)].map((match) => match[1].trim());
  const badTranslates = translates.filter((args) => !args.startsWith('var(--_'));
  must(badTranslates.length === 0, `translate() arguments must be slots: ${badTranslates.join('; ')}`);
  const shadows = allDeclarations.filter(({ property }) => property === 'box-shadow');
  must(shadows.length > 0, 'no box-shadow is declared at all');
  const literalShadows = shadows.filter(({ value }) => !value.startsWith('var(--_'));
  must(literalShadows.length === 0, `box-shadow must read a slot: ${literalShadows.map((d) => d.value).join('; ')}`);
  const badSlots = allDeclarations
    .filter(({ property }) => property.startsWith('--_'))
    .filter(({ property, value }) => {
      if (value.startsWith('var(--')) return false;
      if (value === 'none' && property.startsWith('--_shadow')) return false;
      return true;
    })
    .map(({ selector, property, value }) => `${selector} { ${property}: ${value} }`);
  must(badSlots.length === 0, `a slot may only be re-pointed at a token: ${badSlots.join('; ')}`);
  return `${shadows.length} shadow(s) via slots, ${translates.length} translate() call(s), all slot references`;
});

await check('the border model is `separate` + `border-spacing: 0` — the chosen way to never double a line', () => {
  const tableRule = rules.find((rule) => rule.selector === 'table');
  must(tableRule, 'there is no `table { … }` rule');
  const declared = Object.fromEntries(declarations(tableRule.body));
  must(
    declared['border-collapse'] === COLLAPSE,
    `table must declare border-collapse: ${COLLAPSE}, found ${declared['border-collapse'] ?? '<none>'}`,
  );
  must(
    declared['border-spacing'] === '0',
    `table must declare border-spacing: 0 (separate borders only touch when the spacing is zero), found ${
      declared['border-spacing'] ?? '<none>'
    }`,
  );
  must(
    declared.border === `var(--bn-border-width) solid var(--bn-border-color)`,
    `the frame must be the structural border: found ${declared.border ?? '<none>'}`,
  );
  must(
    rawArtifact.includes(`border-collapse: ${COLLAPSE}`),
    `${ARTIFACT} does not carry the border model — run npm run build`,
  );
  must(
    rawArtifactMin.includes(`border-collapse:${COLLAPSE}`),
    `${ARTIFACT_MIN} does not carry the border model — run npm run build`,
  );
  return `collapse model = ${COLLAPSE}, spacing 0, frame ${declared.border}`;
});

await check('each interior edge has exactly one owner: cells draw only their start edges', () => {
  const offenders = [];
  for (const { selector, property, value } of allDeclarations) {
    if (property === 'border' || property === 'border-width' || /^border-(?:top|right|bottom|left)(?:-width)?$/.test(property)) {
      // The table's own frame is the one legitimate shorthand; a cell may never take one, because
      // a cell that draws four sides doubles every seam it shares with its neighbour.
      if (selector !== 'table') offenders.push(`${selector} { ${property}: ${value} }`);
    }
    if (property === 'border-block-start' || property === 'border-inline-start') {
      const ok = value.includes('var(--bn-border-width)') || value === '0';
      if (!ok) offenders.push(`${selector} { ${property}: ${value} }`);
    }
  }
  must(
    offenders.length === 0,
    `a cell may only draw its block-start / inline-start edge, at --bn-border-width:\n  ${offenders.join('\n  ')}`,
  );
  const drawn = allDeclarations.filter(
    ({ property, value }) =>
      (property === 'border-block-start' || property === 'border-inline-start') &&
      value.includes('var(--bn-border-width)'),
  );
  must(drawn.length >= 1, 'no cell edge is drawn at all — the grid has no lines');
  return `${drawn.length} start-edge rule(s) at --bn-border-width, no four-sided cell borders`;
});

await check('the frame duplicates are suppressed on the first row and the first column', () => {
  const suppressTop = rules.filter((rule) =>
    declarations(rule.body).some(([property, value]) => property === 'border-block-start' && value === '0'),
  );
  const suppressStart = rules.filter((rule) =>
    declarations(rule.body).some(([property, value]) => property === 'border-inline-start' && value === '0'),
  );
  must(
    suppressTop.length > 0 && /first-of-type|first-child/.test(suppressTop.map((rule) => rule.selector).join(' ')),
    'no rule removes the first row\'s block-start border, so it doubles the table frame',
  );
  must(
    suppressStart.length > 0 && /first-child/.test(suppressStart.map((rule) => rule.selector).join(' ')),
    'no rule removes the first column\'s inline-start border, so it doubles the table frame',
  );
  return `${suppressTop[0].selector} ; ${suppressStart[0].selector}`;
});

await check('no state rule can change a border width or any other box metric (invariant 7)', () => {
  const stateRules = rules.filter(isStateRule);
  must(stateRules.length > 0, 'no :hover / focus / selected rule exists');
  const offenders = [];
  for (const rule of stateRules) {
    for (const [property, value] of declarations(rule.body)) {
      if (property.startsWith('--_')) continue; // slot overrides are the geometry channel
      if (BOX_METRIC.test(property) || !STATE_PROPERTIES.has(property)) {
        offenders.push(`${rule.selector} { ${property}: ${value} }`);
      }
    }
  }
  must(
    offenders.length === 0,
    `a state may only repaint (spec §3 invariant 7 — a border that grows on hover reflows the grid):\n  ${offenders.join('\n  ')}`,
  );
  return `${stateRules.length} state rule(s): ${[
    ...new Set(stateRules.flatMap((rule) => declarations(rule.body).map(([property]) => property))),
  ].join(', ')}`;
});

await check('every bare anchor and every appearance name from the ticket is present', () => {
  const missing = REQUIRED_SELECTORS.filter((name) => !rules.some((rule) => rule.selector.includes(name)));
  must(missing.length === 0, `missing selector(s): ${missing.join(', ')}`);
  return REQUIRED_SELECTORS.join(' ');
});

await check('motion is declared inside @media (prefers-reduced-motion: no-preference) only', () => {
  const motionRules = rules.filter((rule) =>
    declarations(rule.body).some(([property]) => property === 'transition' || property.startsWith('transition-')),
  );
  const outside = motionRules.filter(
    (rule) => !rule.conditions.some((condition) => /prefers-reduced-motion:\s*no-preference/.test(condition)),
  );
  must(
    outside.length === 0,
    `transition declared outside the no-preference block: ${outside.map((rule) => rule.selector).join(', ')}`,
  );
  must(
    !/prefers-reduced-motion:\s*reduce/.test(source),
    'a reduce block that switches motion off afterwards is the rejected form (spec §7)',
  );
  must(
    !allDeclarations.some(({ property }) => property === 'animation' || property.startsWith('animation-')),
    'table.css declares an animation; a table has no entry animation to guard',
  );
  return `${motionRules.length} transition rule(s), 0 reduce blocks, 0 animations`;
});

await check('the built artifact carries the table block inside @layer components', () => {
  must(
    rawArtifact.includes('/* src/css/table.css (@layer components) */'),
    `${ARTIFACT} has no table.css block — run npm run build`,
  );
  const block = rawArtifact.slice(
    rawArtifact.indexOf('/* src/css/table.css'),
    rawArtifact.indexOf('/* src/css/dialog.css'),
  );
  for (const needle of [
    'border-collapse: separate',
    'border-spacing: 0',
    'border-block-start: var(--bn-border-width)',
    'border-inline-start: var(--bn-border-width)',
  ]) {
    must(block.includes(needle), `${ARTIFACT} table block is missing ${JSON.stringify(needle)}`);
  }
  return `${block.split('\n').length} lines of table.css in ${ARTIFACT}`;
});

/* ============================= the built documentation page ========================== */
/** seite is not on PATH on this machine (spec §12): probe the documented locations. */
function locateSeite() {
  for (const candidate of [process.env.SEITE_BIN, 'D:\\sdk\\seite\\seite.exe', 'seite'].filter(Boolean)) {
    const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
    if (probe.status === 0) return { bin: candidate, version: (probe.stdout ?? '').trim() };
  }
  return null;
}

function runSeite(args) {
  const result = spawnSync(SEITE.bin, args, {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120_000,
    env: { ...process.env, SEITE_YES: '1' },
  });
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() };
}

const SEITE = process.argv.includes('--no-docs') ? null : locateSeite();

if (!SEITE) {
  skips += 3;
  console.log(
    `SKIP  3 built-page checks — ${process.argv.includes('--no-docs') ? '--no-docs' : 'the seite CLI was not found (set SEITE_BIN)'}`,
  );
} else {
  console.log(`      ${SEITE.version} at ${SEITE.bin}\n`);
  await check('seite build exits 0 with the Table page in the collection', () => {
    const result = runSeite(['build', '--dir', ROOT]);
    must(result.status === 0, `exit ${result.status}:\n${result.output}`);
    const problems = result.output.split('\n').filter((line) => /\b(broken|missing|error)\b/i.test(line));
    must(problems.length === 0, `the build mentions problems:\n${problems.join('\n')}`);
    return result.output.split('\n').find((line) => /Built\b/.test(line))?.trim() ?? 'clean';
  });

  await check('the component index lists the Table page (the collection picked it up)', () => {
    const index = fs.readFileSync(abs('dist/components/index.html'), 'utf8');
    must(
      /href="[^"]*\/components\/table"/.test(index),
      'dist/components/index.html does not link to the Table page — the collection did not list it',
    );
    return 'the index links /components/table without a trailing slash';
  });

  await check('the built page carries the raw fence and the demo layer\'s mount point', () => {
    must(fs.existsSync(abs(DOC_HTML)), `${DOC_HTML} was not built`);
    const html = fs.readFileSync(abs(DOC_HTML), 'utf8');
    must(/class="site-prose"/.test(html), `${DOC_HTML} lost its .site-prose body wrapper`);
    must(/<pre style="background-color:#2b303b/.test(html), `${DOC_HTML} has no raw seite fence`);
    for (const forbidden of ['role="tablist"', 'data-site-demo']) {
      must(!html.includes(forbidden), `${DOC_HTML} contains ${forbidden}: the demo UI must be built client-side`);
    }
    must(/&lt;table/.test(html), `${DOC_HTML} does not carry the table example as escaped text`);
    const h2s = [...html.matchAll(/<h2\b[^>]*>/g)];
    must(h2s.length === 1 && /data-site-heading=/.test(h2s[0][0]), `${DOC_HTML} must render exactly the template's one H2`);
    return `${html.length}B, raw fence + one injected H2, no demo markup in the build output`;
  });
}

/* =================================== browser checks =================================== */

const BROWSER_CHECKS = [
  [
    'verification 2: a bare <table> is dressed — separate borders, a 3px frame, the small tier',
    async (browser, server) =>
      withPage(browser, server.fixture, {}, async (page) => {
        await expectStyle(
          page,
          '#table-bare',
          {
            borderCollapse: COLLAPSE,
            borderSpacing: SPACING,
            boxSizing: 'border-box',
            borderTopWidth: BORDER,
            borderRightWidth: BORDER,
            borderBottomWidth: BORDER,
            borderLeftWidth: BORDER,
            borderTopStyle: 'solid',
            borderTopColor: INK,
            borderTopLeftRadius: RADIUS,
            boxShadow: SHADOW_SM,
            backgroundColor: SURFACE,
            textAlign: 'start',
          },
          'bare <table>: ',
        );
        // `inline-size: 100%` is a used length on a table, so the honest check is geometric: the
        // border box fills its container exactly instead of overflowing it by two border widths.
        const fill = await page.evaluate(() => {
          const table = document.querySelector('#table-bare');
          const main = table.parentElement;
          return {
            table: Math.round(table.getBoundingClientRect().width * 100) / 100,
            available: main.clientWidth,
          };
        });
        must(
          Math.abs(fill.table - fill.available) < 0.51,
          `a table fills its container: ${fill.table}px in ${fill.available}px of available width`,
        );
        // The first column's only body cell: the frame owns its inline-start edge (0), and the
        // body row group owns the seam above it (3px) because a thead precedes it.
        await expectStyle(
          page,
          '#b-cell-city',
          {
            borderTopWidth: BORDER,
            borderInlineStartWidth: '0px',
            borderBottomWidth: '0px',
            borderInlineEndWidth: '0px',
            fontWeight: BODY_WEIGHT,
          },
          'a body <td> in column 1: ',
        );
        // The next cell over draws both of its own edges: nothing else does.
        await expectStyle(
          page,
          '#b-cell-beds',
          { borderTopWidth: BORDER, borderInlineStartWidth: BORDER, fontWeight: BODY_WEIGHT },
          'a body <td> in column 2: ',
        );
        await expectStyle(
          page,
          '#b-head-city',
          {
            borderTopWidth: '0px',
            borderInlineStartWidth: '0px',
            fontWeight: HEADING_WEIGHT,
            backgroundColor: MAIN_SURFACE,
            color: INK,
            verticalAlign: 'top',
          },
          'a header <th> in the first row/column (no edge doubles the frame): ',
        );
        return `${COLLAPSE} + ${SPACING} spacing, frame ${BORDER} solid ${INK}, shadow ${SHADOW_SM}`;
      }),
  ],
  [
    'verification 2: adjacent cells never double a line and never drift — one owner per interior edge',
    async (browser, server) =>
      withPage(browser, server.fixture, {}, async (page) => {
        const geometry = await readTableGeometry(page, '#table');
        must(geometry.found, '#table is missing from the fixture');
        const { vertical, horizontal, frame, captionAbove, captionToFrame, columnDrift, rowWidth } =
          analyseSeams(geometry);

        const doubled = [...vertical, ...horizontal].filter((edge) => edge.owners.length !== 1);
        must(
          doubled.length === 0,
          `every interior edge needs exactly one owner (0 = a gap, 2 = a double line):\n  ${doubled
            .map((edge) => `${edge.edge} → ${edge.owners.length} owner(s) [${edge.owners.join(', ')}]`)
            .join('\n  ')}`,
        );
        const drifted = [...vertical, ...horizontal].filter((edge) => edge.gap !== 0);
        must(
          drifted.length === 0,
          `the cells must touch: ${drifted.map((edge) => `${edge.edge} gap ${edge.gap}px`).join('; ')}`,
        );
        for (const edge of [...vertical, ...horizontal]) {
          must(
            edge.owners[0] === BORDER,
            `${edge.edge} is painted ${edge.owners[0]} wide, expected ${BORDER}`,
          );
        }
        const columnMisalignment = columnDrift.filter((column) => column.left !== 0 || column.right !== 0);
        must(
          columnMisalignment.length === 0,
          `columns are misaligned across rows: ${columnMisalignment
            .map((column) => `col ${column.column} left Δ${column.left} right Δ${column.right}`)
            .join('; ')}`,
        );
        must(
          frame.left === 3 && frame.right === 3 && frame.top === 3 && frame.bottom === 3,
          `the frame must be exactly one ${BORDER} line on every side (frame edges: ${JSON.stringify(frame)})`,
        );
        must(
          captionAbove === 0 && captionToFrame === 3,
          `the caption is drawn above the frame at the border-box top (${captionAbove}px) and exactly one ` +
            `${BORDER} line separates it from the first row (${captionToFrame}px)`,
        );
        const expectedWidth = Math.round((rowWidth + 2 * 3) * 100) / 100;
        must(
          Math.abs(geometry.rect.width - expectedWidth) < 0.51,
          `the table box must be the frame plus the columns: ${geometry.rect.width}px vs ${expectedWidth}px`,
        );
        return `${vertical.length} vertical + ${horizontal.length} horizontal edges, 1 owner each, gap 0; frame ${BORDER} on four sides; ${geometry.rect.width}px = 2×3px + ${rowWidth}px`;
      }),
  ],
  [
    'verification 2: the head/body seam is one 3px line owned by the body row, not two',
    async (browser, server) =>
      withPage(browser, server.fixture, {}, async (page) => {
        const geometry = await readTableGeometry(page, '#table');
        const headRow = geometry.rows.find((row) => row.section === 'thead');
        const bodyRow = geometry.rows.find((row) => row.section === 'tbody');
        must(headRow && bodyRow, 'the fixture must carry a thead and a tbody');
        for (const [index, head] of headRow.cells.entries()) {
          const body = bodyRow.cells[index];
          must(
            head.borderBottomWidth === '0px',
            `thead cell ${index} draws a block-end border (${head.borderBottomWidth}); the seam would double`,
          );
          must(
            body.borderTopWidth === BORDER,
            `tbody cell ${index} must own the seam at ${BORDER}, found ${body.borderTopWidth}`,
          );
          must(body.borderTopColor === INK, `the seam must be ${INK}, found ${body.borderTopColor}`);
          must(
            Math.round((body.y - head.bottom) * 100) / 100 === 0,
            `the seam has a gap: ${head.bottom} → ${body.y}`,
          );
        }
        return `${bodyRow.cells.length} seam cell(s): thead block-end 0px, tbody block-start ${BORDER} solid ${INK}, gap 0`;
      }),
  ],
  [
    'verification 2: the caption, the row header and the foot keep the same grid',
    async (browser, server) =>
      withPage(browser, server.fixture, {}, async (page) => {
        const geometry = await readTableGeometry(page, '#table');
        const sections = geometry.rows.map((row) => row.section);
        must(
          sections.join(',') === 'thead,tbody,tbody,tbody,tfoot',
          `the fixture's sections read ${sections.join(',')}`,
        );
        const foot = geometry.rows.find((row) => row.section === 'tfoot');
        const lastBody = geometry.rows.filter((row) => row.section === 'tbody').pop();
        for (const [index, cell] of foot.cells.entries()) {
          must(cell.borderTopWidth === BORDER, `a foot cell must keep the grid: found ${cell.borderTopWidth}`);
          must(
            Math.round((cell.y - lastBody.cells[index].bottom) * 100) / 100 === 0,
            `the foot row is detached from the body at column ${index}`,
          );
        }
        const rowHeader = geometry.rows[1].cells[0];
        must(
          rowHeader.tag === 'th' && rowHeader.fontWeight === HEADING_WEIGHT,
          `a body row header must keep the heading weight, found ${rowHeader.tag}/${rowHeader.fontWeight}`,
        );
        await expectStyle(
          page,
          '#caption',
          { textAlign: 'start', fontWeight: HEADING_WEIGHT, captionSide: 'top' },
          'caption: ',
        );
        return `caption on top at heading weight, 4 sections in one grid, body row header at ${HEADING_WEIGHT}`;
      }),
  ],
  [
    'verification: the header band is emphasis added — the body keeps full contrast, the band is saturated',
    async (browser, server) =>
      withPage(browser, server.fixture, {}, async (page) => {
        await expectStyle(
          page,
          '#h-city',
          {
            fontWeight: HEADING_WEIGHT,
            backgroundColor: MAIN_SURFACE,
            color: INK,
            whiteSpace: 'nowrap',
            textAlign: 'start',
            verticalAlign: 'top',
          },
          'a column header: ',
        );
        // A body cell paints nothing itself: the table's surface shows through, so the ink contrast
        // below is the real one a reader sees.
        await expectStyle(
          page,
          '#r1-city',
          { fontWeight: BODY_WEIGHT, color: INK, backgroundColor: 'rgba(0, 0, 0, 0)' },
          'a body cell: ',
        );
        const colours = await readStyles(page, '#table', ['backgroundColor']);
        const header = await readStyles(page, '#h-city', ['backgroundColor', 'color']);
        const body = await readStyles(page, '#r1-city', ['color']);
        const bodyInk = contrastRatio(body.color, colours.backgroundColor);
        const headerInk = contrastRatio(header.color, header.backgroundColor);
        must(
          bodyInk >= TEXT_CONTRAST_FLOOR,
          `body text must keep at least ${TEXT_CONTRAST_FLOOR}:1 on the table surface, measured ${bodyInk}:1`,
        );
        must(
          headerInk >= TEXT_CONTRAST_FLOOR,
          `header text must keep at least ${TEXT_CONTRAST_FLOOR}:1 on the band, measured ${headerInk}:1`,
        );
        const bandDelta = Math.round((saturation(header.backgroundColor) - saturation(colours.backgroundColor)) * 1000) / 1000;
        must(
          bandDelta >= BAND_SATURATION_FLOOR,
          `the header band must be a saturated band, not a grey wash: Δsaturation ${bandDelta} ` +
            `(${header.backgroundColor} vs ${colours.backgroundColor})`,
        );
        return `body ink ${bodyInk}:1, header ink ${headerInk}:1, Δsaturation ${bandDelta} (${header.backgroundColor} vs ${colours.backgroundColor}), weight ${HEADING_WEIGHT}>${BODY_WEIGHT}`;
      }),
  ],
  [
    'the alignment rule: text starts, `.bn-num` ends — measured on the text, not on the property',
    async (browser, server) =>
      withPage(browser, server.fixture, {}, async (page) => {
        const measured = await page.evaluate(() => {
          const sample = (selector) => {
            const cell = document.querySelector(selector);
            const range = document.createRange();
            range.selectNodeContents(cell);
            const text = range.getBoundingClientRect();
            const box = cell.getBoundingClientRect();
            const style = getComputedStyle(cell);
            // The content edge, inside the border *and* the padding: a cell that draws its own
            // inline-start edge starts 3px further in, and that is the edge text hugs.
            const contentLeft =
              box.left + Number.parseFloat(style.borderInlineStartWidth) + Number.parseFloat(style.paddingInlineStart);
            const contentRight =
              box.right - Number.parseFloat(style.borderInlineEndWidth) - Number.parseFloat(style.paddingInlineEnd);
            return {
              id: cell.id,
              textAlign: style.textAlign,
              fontVariantNumeric: style.fontVariantNumeric,
              gapStart: Math.round((text.left - contentLeft) * 100) / 100,
              gapEnd: Math.round((contentRight - text.right) * 100) / 100,
            };
          };
          return {
            text: sample('#r1-city'),
            rowHeader: sample('#r1-name'),
            // Measured negative control: the class is on the <col> here, and a table column does not
            // hand `text-align` down to its cells in Chrome, so this cell must stay start-aligned.
            byCol: sample('#r1-revenue'),
            byColHeader: sample('#h-revenue'),
            // The supported path: the class on the header cell and on the cells of the column.
            byCell: sample('#c-r1-revenue'),
            byCellHeader: sample('#c-h-revenue'),
          };
        });
        const startAligned = { text: measured.text, rowHeader: measured.rowHeader, byCol: measured.byCol, byColHeader: measured.byColHeader };
        for (const [label, cell] of Object.entries(startAligned)) {
          must(
            cell.textAlign === 'start',
            `${label} (${cell.id}) must align to the start, found ${cell.textAlign}`,
          );
          must(
            Math.abs(cell.gapStart) <= 0.51,
            `${label} (${cell.id}) text must hug the start edge inside the padding, off by ${cell.gapStart}px`,
          );
        }
        for (const [label, cell] of Object.entries({ byCell: measured.byCell, byCellHeader: measured.byCellHeader })) {
          must(
            cell.textAlign === 'end',
            `${label} (${cell.id}) carries .bn-num and must align to the end, found ${cell.textAlign}`,
          );
          must(
            cell.fontVariantNumeric === 'tabular-nums',
            `${label} (${cell.id}) must use tabular figures, found ${cell.fontVariantNumeric}`,
          );
          must(
            Math.abs(cell.gapEnd) <= 0.51,
            `${label} (${cell.id}) text must hug the end edge inside the padding, off by ${cell.gapEnd}px`,
          );
        }
        return `text ${measured.text.textAlign} / row header ${measured.rowHeader.textAlign} (both hugging their start edge), ` +
          `.bn-num on cells ${measured.byCell.textAlign} with ${measured.byCell.fontVariantNumeric}, ` +
          `on a <col> ${measured.byCol.textAlign} (measured: a column does not inherit into its cells)`;
      }),
  ],
  [
    'the scroll convention: a figure and a .bn-table-scroll wrapper confine a wide table, shadow included',
    async (browser, server) =>
      withPage(browser, server.fixture, {}, async (page) => {
        const state = await page.evaluate(() => {
          const measure = (wrapperSelector, tableSelector) => {
            const wrapper = document.querySelector(wrapperSelector);
            const table = document.querySelector(tableSelector);
            const wr = wrapper.getBoundingClientRect();
            const tr = table.getBoundingClientRect();
            const shadow = (getComputedStyle(table).boxShadow.match(/-?[\d.]+px/g) ?? []).map(Number.parseFloat);
            return {
              overflowX: getComputedStyle(wrapper).overflowX,
              scrollWidth: wrapper.scrollWidth,
              clientWidth: wrapper.clientWidth,
              shadowX: shadow[0],
              shadowY: shadow[1],
              roomRight: Math.round((wr.right - tr.right) * 100) / 100,
              roomBottom: Math.round((wr.bottom - tr.bottom) * 100) / 100,
            };
          };
          return { figure: measure('#figure', '#table'), div: measure('.bn-table-scroll', '#table-classed') };
        });
        for (const [label, wrap] of Object.entries(state)) {
          must(wrap.overflowX === 'auto', `${label}: the wrapper must scroll (overflow-x: ${wrap.overflowX})`);
          must(
            wrap.scrollWidth === wrap.clientWidth,
            `${label}: at desktop width a table that fits must not scroll (${wrap.scrollWidth}px of content in ${wrap.clientWidth}px)`,
          );
          must(
            wrap.roomRight >= wrap.shadowX && wrap.roomBottom >= wrap.shadowY,
            `${label}: the hard shadow (${wrap.shadowX}px ${wrap.shadowY}px) must finish inside the clip, ` +
              `room right ${wrap.roomRight}px bottom ${wrap.roomBottom}px`,
          );
        }
        return `figure + div: overflow-x auto, no scrollbar at 1280px, ${state.figure.shadowX}px of shadow room on both sides`;
      }),
  ],
  [
    'verification 1: at 375px the page never scrolls sideways and the table scrolls itself',
    async (browser, server) =>
      withPage(browser, server.fixture, { viewport: { width: 375, height: 720 } }, async (page) => {
        const before = await page.evaluate(() => ({
          innerWidth: window.innerWidth,
          documentScrollWidth: document.documentElement.scrollWidth,
          bodyScrollWidth: document.body.scrollWidth,
          wrappers: [...document.querySelectorAll('#figure, .bn-table-scroll')].map((wrapper) => ({
            overflowX: getComputedStyle(wrapper).overflowX,
            scrollWidth: wrapper.scrollWidth,
            clientWidth: wrapper.clientWidth,
          })),
        }));
        must(
          before.documentScrollWidth <= before.innerWidth,
          `the page must not scroll sideways: documentElement.scrollWidth ${before.documentScrollWidth} > innerWidth ${before.innerWidth}`,
        );
        must(
          before.bodyScrollWidth <= before.innerWidth,
          `the body must not scroll sideways either: ${before.bodyScrollWidth} > ${before.innerWidth}`,
        );
        for (const [index, wrapper] of before.wrappers.entries()) {
          must(
            wrapper.overflowX === 'auto',
            `wrapper ${index} must remain a scroll container at 375px (overflow-x: ${wrapper.overflowX})`,
          );
          must(
            wrapper.scrollWidth > wrapper.clientWidth,
            `the wide table must overflow its wrapper at 375px so the reader can scroll it: ` +
              `${wrapper.scrollWidth}px of content in ${wrapper.clientWidth}px`,
          );
        }
        // Scrolled to the end, the hard shadow has to be visible again rather than clipped away.
        const after = await page.evaluate(() => {
          const wrapper = document.querySelector('#figure');
          wrapper.scrollLeft = wrapper.scrollWidth;
          const table = wrapper.querySelector('table');
          const wr = wrapper.getBoundingClientRect();
          const tr = table.getBoundingClientRect();
          const shadow = (getComputedStyle(table).boxShadow.match(/-?[\d.]+px/g) ?? []).map(Number.parseFloat);
          return {
            scrolledTo: wrapper.scrollLeft,
            roomRight: Math.round((wr.right - tr.right) * 100) / 100,
            shadowX: shadow[0],
          };
        });
        must(
          after.scrolledTo > 0 && after.roomRight >= after.shadowX - 0.5,
          `scrolled to the end (${after.scrolledTo}px) the shadow must be visible again, within the sub-pixel ` +
            `rounding of scrollWidth (an integer): ${after.roomRight}px of room for a ${after.shadowX}px shadow`,
        );
        return `innerWidth ${before.innerWidth}, documentElement.scrollWidth ${before.documentScrollWidth} ≤ ${before.innerWidth}, wrappers ${before.wrappers
          .map((wrapper) => `${wrapper.scrollWidth}>${wrapper.clientWidth}`)
          .join(' / ')}`;
      }),
  ],
  [
    'verification 1 (negative control): a bare wide table has no scroll container, so the page widens',
    async (browser, server) =>
      withPage(browser, server.bare, { viewport: { width: 375, height: 720 } }, async (page) => {
        const state = await page.evaluate(() => ({
          innerWidth: window.innerWidth,
          documentScrollWidth: document.documentElement.scrollWidth,
          tableWidth: Math.round(document.querySelector('table').getBoundingClientRect().width),
          position: getComputedStyle(document.querySelector('table')).position,
        }));
        must(
          state.documentScrollWidth > state.innerWidth,
          'a bare <table> is not a block container and `overflow` does not apply to it, so a wide one ' +
            'must widen the page — this is the boundary the documented wrapper exists for, and if this ' +
            `no longer holds the convention can be simplified: documentElement.scrollWidth ${state.documentScrollWidth} vs innerWidth ${state.innerWidth}`,
        );
        return `no wrapper: ${state.tableWidth}px table → documentElement.scrollWidth ${state.documentScrollWidth} > innerWidth ${state.innerWidth}`;
      }),
  ],
  [
    'verification 3: in the dark theme the header separator is still unmistakable',
    async (browser, server) =>
      withPage(browser, server.fixture, {}, async (page) => {
        await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
        await expectStyle(
          page,
          '#table',
          { backgroundColor: DARK_SURFACE, borderTopColor: DARK_INK, boxShadow: `rgb(255, 253, 245) 2px 2px 0px 0px` },
          'dark table: ',
        );
        await expectStyle(
          page,
          '#h-city',
          { backgroundColor: MAIN_SURFACE, color: INK, fontWeight: HEADING_WEIGHT },
          'dark header band: ',
        );
        const geometry = await readTableGeometry(page, '#table');
        const headRow = geometry.rows.find((row) => row.section === 'thead');
        const bodyRow = geometry.rows.find((row) => row.section === 'tbody');
        const seam = bodyRow.cells[1];
        must(
          headRow.cells[1].borderBottomWidth === '0px' && seam.borderTopWidth === BORDER,
          `the dark seam must still be one ${BORDER} line owned by the body: ${headRow.cells[1].borderBottomWidth} / ${seam.borderTopWidth}`,
        );
        must(seam.borderTopColor === DARK_INK, `the dark seam must be the flipped border colour, found ${seam.borderTopColor}`);
        const lineContrast = contrastRatio(seam.borderTopColor, DARK_SURFACE);
        must(
          lineContrast >= LINE_CONTRAST_FLOOR,
          `the separator must stay visible against the dark surface: ${lineContrast}:1 < ${LINE_CONTRAST_FLOOR}:1`,
        );
        const bodyInk = contrastRatio(seam.color, DARK_SURFACE);
        must(
          bodyInk >= TEXT_CONTRAST_FLOOR,
          `dark body text must keep at least ${TEXT_CONTRAST_FLOOR}:1 on the dark surface, measured ${bodyInk}:1`,
        );
        const bandDelta = Math.round((saturation(MAIN_SURFACE) - saturation(DARK_SURFACE)) * 1000) / 1000;
        must(
          bandDelta >= BAND_SATURATION_FLOOR,
          `the dark header band must stay a saturated band: Δsaturation ${bandDelta}`,
        );
        // The tint mixes against --bn-secondary-background, so it flips with the theme by itself.
        const darkTint = await expectColour(page, '#row-2', DARK_SELECTED_TINT_RGB, '.bn-selected in dark: ');
        return `dark: surface ${DARK_SURFACE}, seam ${BORDER} ${seam.borderTopColor} at ${lineContrast}:1 against the surface, body ink ${bodyInk}:1, band Δsaturation ${bandDelta}, selected row ${darkTint}`;
      }),
  ],
  [
    'no focus, hover or selection state moves a border: the ring is an outline, the tint a background',
    async (browser, server) =>
      withPage(browser, server.fixture, {}, async (page) => {
        const SIDES = ['borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth'];
        // The keyboard sample comes first, while the page has never seen the mouse: a click moves
        // Chrome's sequential-focus starting point.
        await page.evaluate(() => document.activeElement?.blur?.());
        await page.keyboard.press('Tab');
        const focused = await page.evaluate(() => ({
          activeId: document.activeElement?.id ?? '',
          focusVisible: document.activeElement?.matches?.(':focus-visible') ?? false,
        }));
        must(
          focused.activeId === 'r3-city' && focused.focusVisible,
          `one Tab must reach the focusable cell with :focus-visible, reached ${focused.activeId} (visible: ${focused.focusVisible})`,
        );
        const COLUMNS = [
          ['#r1-name', '#r2-name', '#r3-name'],
          ['#r1-city', '#r2-city', '#r3-city'],
          ['#r1-beds', '#r2-beds', '#r3-beds'],
          ['#r1-occupancy', '#r2-occupancy', '#r3-occupancy'],
          ['#r1-revenue', '#r2-revenue', '#r3-revenue'],
        ];
        const samples = {};
        for (const column of COLUMNS) {
          for (const selector of column) samples[selector] = await readStyles(page, selector, SIDES);
        }
        await expectStyle(
          page,
          '#r3-city',
          {
            outlineStyle: 'solid',
            outlineWidth: '3px',
            outlineOffset: '3px',
            outlineColor: RING_COLOR,
            ...Object.fromEntries(SIDES.map((side) => [side, samples['#r3-city'][side]])),
          },
          'a focused cell: ',
        );
        // Row 2 carries .bn-selected and #r3-city is focused: same column, same box, different state.
        // Comparing across columns would compare a frame edge with an interior edge and prove nothing.
        const drift = [];
        for (const [plain, selected, focusable] of COLUMNS) {
          for (const side of SIDES) {
            if (samples[selected][side] !== samples[plain][side]) {
              drift.push(`${selected}.${side} = ${samples[selected][side]} vs ${plain} ${samples[plain][side]}`);
            }
            if (samples[focusable][side] !== samples[plain][side]) {
              drift.push(`${focusable}.${side} = ${samples[focusable][side]} vs ${plain} ${samples[plain][side]}`);
            }
          }
        }
        must(drift.length === 0, `no row state may move a border: ${drift.join(', ')}`);
        // And both row states really do repaint — otherwise this proves nothing.
        const selectedTint = await expectColour(page, '#row-2', SELECTED_TINT_RGB, '.bn-selected: ');
        await page.hover('#row-1');
        const hoverTint = await expectColour(page, '#row-1', HOVER_TINT_RGB, 'a hovered row: ');
        // Every cell of the hovered row, against the resting sample of that same cell.
        for (const [cell] of COLUMNS) {
          await expectStyle(
            page,
            cell,
            Object.fromEntries(SIDES.map((side) => [side, samples[cell][side]])),
            'a hovered row, its borders: ',
          );
        }
        return `Tab reached #r3-city with a 3px ${RING_COLOR} outline; ${COLUMNS.length} columns × 4 sides unchanged by hover, focus and selection; hover ${hoverTint}, selected ${selectedTint}`;
      }),
  ],
  [
    'the motion guard: the tint cross-fades only where motion is accepted, and nothing else changes',
    async (browser, server) => {
      const full = await withPage(browser, server.fixture, { freeze: false }, async (page) => {
        const matches = await page.evaluate(() => matchMedia('(prefers-reduced-motion: no-preference)').matches);
        must(matches === true, 'the default context does not report prefers-reduced-motion: no-preference');
        const style = await readStyles(page, '#row-1', ['transitionProperty', 'transitionDuration']);
        const properties = style.transitionProperty.split(',').map((value) => value.trim());
        const durations = style.transitionDuration.split(',').map((value) => value.trim());
        must(
          properties.length === 1 && properties[0] === 'background-color',
          `a table row transitions the background tint and nothing else, read ${style.transitionProperty}`,
        );
        must(
          durations.every((value) => value === MOTION),
          `the tint must run for --bn-transition (${MOTION}), read ${style.transitionDuration}`,
        );
        return `${style.transitionProperty} over ${MOTION}`;
      });
      const reduce = await withPage(
        browser,
        server.fixture,
        { reducedMotion: 'reduce', freeze: false },
        async (page) => {
          const matches = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
          must(matches === true, 'the reducedMotion: reduce context did not reach the page');
          const durations = await readStyles(page, '#row-1', ['transitionDuration']);
          must(
            durations.transitionDuration.split(',').every((value) => value.trim() === '0s'),
            `with reduced motion no transition may be declared, read ${durations.transitionDuration}`,
          );
          await expectStyle(
            page,
            '#table',
            { borderCollapse: COLLAPSE, boxShadow: SHADOW_SM, borderTopWidth: BORDER },
            'reduced motion, appearance: ',
          );
          return durations.transitionDuration;
        },
      );
      return `no-preference: ${full}; reduce: ${reduce} with the appearance untouched`;
    },
  ],
  [
    'the appearance is complete with JavaScript switched off (spec §3 invariant 6)',
    async (browser, server) =>
      withPage(browser, server.fixture, { javaScriptEnabled: false }, async (page) => {
        const scripts = await page.evaluate(() => document.querySelectorAll('script').length);
        must(scripts === 0, `the fixture must not load a script, found ${scripts}`);
        await expectStyle(
          page,
          '#table',
          { borderCollapse: COLLAPSE, borderSpacing: SPACING, boxShadow: SHADOW_SM, borderTopWidth: BORDER },
          'no-JavaScript table: ',
        );
        await expectStyle(
          page,
          '#h-city',
          { backgroundColor: MAIN_SURFACE, color: INK, fontWeight: HEADING_WEIGHT },
          'no-JavaScript header band: ',
        );
        await expectStyle(page, '#c-r1-revenue', { textAlign: 'end' }, 'no-JavaScript .bn-num: ');
        const tint = await expectColour(
          page,
          '#row-2',
          SELECTED_TINT_RGB,
          "no-JavaScript .bn-selected (the tint is not the script's): ",
        );
        return `frame, header band, end-aligned numbers and the selected tint (${tint}) all render with no script`;
      }),
  ],
  [
    'the docs site styles its prose, not the preview panel: both directions measured',
    async (browser, server) =>
      withPage(browser, server.docs, { githubPages: true }, async (page) => {
        const state = await page.evaluate(() => {
          const panel = document.querySelector('[data-site-demo] [role="tabpanel"]');
          // The second cell of the first body row: a cell that owns both of its start edges.
          const demoCell = panel?.querySelector('tbody tr > :nth-child(2)') ?? null;
          const numericCell = panel?.querySelector('.bn-num') ?? null;
          const numericHeader = panel?.querySelector('th.bn-num') ?? null;
          const proseTable = document.querySelector('.site-prose > table');
          const proseCell = proseTable?.querySelector('tbody td') ?? null;
          const proseHeader = proseTable?.querySelector('th') ?? null;
          const read = (element, properties) => {
            if (!element) return null;
            const style = getComputedStyle(element);
            return Object.fromEntries(properties.map((property) => [property, style[property]]));
          };
          return {
            demoTable: read(panel?.querySelector('table'), ['borderCollapse', 'borderTopWidth', 'boxShadow']),
            demoCell: read(demoCell, ['borderTopWidth', 'borderInlineStartWidth', 'borderInlineEndWidth', 'borderBlockEndWidth', 'paddingBlockStart']),
            demoHeader: read(panel?.querySelector('thead th'), ['backgroundColor', 'fontWeight', 'whiteSpace']),
            numericCell: read(numericCell, ['textAlign', 'fontVariantNumeric']),
            numericHeader: read(numericHeader, ['textAlign']),
            proseTable: read(proseTable, ['borderCollapse', 'borderTopWidth']),
            proseCell: read(proseCell, ['borderTopWidth', 'borderInlineStartWidth', 'paddingBlockStart', 'textAlign']),
            proseHeader: read(proseHeader, ['backgroundColor']),
          };
        });

        // 1. Inside the preview panel the library's own bytes are what the browser computes: the
        //    separated border model, one owner per seam, the library's cell padding, and `.bn-num`
        //    ending the line in tabular figures. The site's `collapse` + four-sided 2px cell border
        //    + `text-align: left` would each show up here if the exclusion were missing.
        must(state.demoTable, 'the preview panel has no table');
        must(
          state.demoTable.borderCollapse === COLLAPSE,
          `the preview table must compute the library's border model (${COLLAPSE}), read ${state.demoTable.borderCollapse}`,
        );
        must(
          state.demoTable.borderTopWidth === BORDER,
          `the preview table must compute the library's frame (${BORDER}), read ${state.demoTable.borderTopWidth}`,
        );
        must(
          state.demoTable.boxShadow === SHADOW_SM,
          `the preview table must compute the library's shadow (${SHADOW_SM}), read ${state.demoTable.boxShadow}`,
        );
        must(
          state.demoCell.borderTopWidth === BORDER &&
            state.demoCell.borderInlineStartWidth === BORDER &&
            state.demoCell.borderInlineEndWidth === '0px' &&
            state.demoCell.borderBlockEndWidth === '0px',
          `the preview cell must own exactly its two start edges at ${BORDER}, read ` +
            `${state.demoCell.borderTopWidth}/${state.demoCell.borderInlineStartWidth}/${state.demoCell.borderInlineEndWidth}/${state.demoCell.borderBlockEndWidth}`,
        );
        must(
          state.demoCell.paddingBlockStart === '10px',
          `the preview cell must keep the library's padding (0.625rem = 10px), read ${state.demoCell.paddingBlockStart}`,
        );
        must(
          state.numericCell.textAlign === 'end' && state.numericCell.fontVariantNumeric === 'tabular-nums',
          `the preview .bn-num cell must end-align in tabular figures, read ${state.numericCell.textAlign}/${state.numericCell.fontVariantNumeric}`,
        );
        must(
          state.numericHeader.textAlign === 'end',
          `the preview .bn-num header must end-align too, read ${state.numericHeader.textAlign}`,
        );

        // 2. The control: a Markdown table in the prose is still the docs site's table — the
        //    exclusion narrowed the site's rules, it did not remove them.
        must(state.proseTable, 'content/components/table.md has no Markdown table to use as the control');
        must(
          state.proseTable.borderCollapse === 'collapse',
          `a prose table must keep the docs site's collapse, read ${state.proseTable.borderCollapse}`,
        );
        must(
          state.proseCell.borderTopWidth === '2px' && state.proseCell.borderInlineStartWidth === '2px',
          `a prose cell must keep the docs site's four-sided 2px border, read ` +
            `${state.proseCell.borderTopWidth}/${state.proseCell.borderInlineStartWidth}`,
        );
        must(
          state.proseCell.paddingBlockStart === '8px',
          `a prose cell must keep the docs site's padding (0.5rem = 8px), read ${state.proseCell.paddingBlockStart}`,
        );
        must(
          state.proseCell.textAlign === 'left',
          `a prose cell must keep the docs site's left alignment, read ${state.proseCell.textAlign}`,
        );
        must(
          state.proseHeader.backgroundColor === MAIN_SURFACE,
          `a prose header must keep the docs site's accent band, read ${state.proseHeader.backgroundColor}`,
        );
        // 3. And it is the *site's* styling wherever the prose puts the table, not only at the top
        //    level: prose is not flat (a table inside a list item is prose too), which is why the
        //    exclusion is written on the element rather than as a direct-child selector. Probed in
        //    the DOM here so the claim is measured rather than asserted in a comment.
        const nested = await page.evaluate(() => {
          const prose = document.querySelector('.site-prose');
          const list = document.createElement('ul');
          const item = document.createElement('li');
          const table = document.createElement('table');
          table.innerHTML = '<tbody><tr><td>nested</td></tr></tbody>';
          item.appendChild(table);
          list.appendChild(item);
          prose.appendChild(list);
          const cell = table.querySelector('td');
          return {
            borderCollapse: getComputedStyle(table).borderCollapse,
            cellBorderTopWidth: getComputedStyle(cell).borderTopWidth,
            cellPaddingBlockStart: getComputedStyle(cell).paddingBlockStart,
          };
        });
        must(
          nested.borderCollapse === 'collapse' &&
            nested.cellBorderTopWidth === '2px' &&
            nested.cellPaddingBlockStart === '8px',
          `a table nested deeper in the prose must still be the docs site's table, read ` +
            `${nested.borderCollapse}/${nested.cellBorderTopWidth}/${nested.cellPaddingBlockStart}`,
        );
        return (
          `preview: ${state.demoTable.borderCollapse} + frame ${state.demoTable.borderTopWidth} + cell ` +
          `${state.demoCell.borderTopWidth}/${state.demoCell.borderInlineStartWidth}/${state.demoCell.borderInlineEndWidth}/` +
          `${state.demoCell.borderBlockEndWidth} + .bn-num ${state.numericCell.textAlign} (${state.numericCell.fontVariantNumeric}); ` +
          `prose table: ${state.proseTable.borderCollapse} + cell ${state.proseCell.borderTopWidth} + ` +
          `${state.proseCell.textAlign}; nested prose table: ${nested.borderCollapse} + cell ${nested.cellBorderTopWidth}`
        );
      }),
  ],
  [
    'the documentation page: the example runs, and a phone width never widens the page',
    async (browser, server) =>
      withPage(
        browser,
        server.docs,
        { viewport: { width: 375, height: 720 }, githubPages: true },
        async (page, issues) => {
          const state = await page.evaluate(() => {
            const panel = document.querySelector('[data-site-demo] [role="tabpanel"]');
            const table = panel?.querySelector('table') ?? null;
            const wrapper = table?.closest('figure, .bn-table-scroll') ?? null;
            const style = table ? getComputedStyle(table) : null;
            const numeric = panel?.querySelector('.bn-num') ?? null;
            return {
              innerWidth: window.innerWidth,
              documentScrollWidth: document.documentElement.scrollWidth,
              hasTable: Boolean(table),
              wrapperTag: wrapper ? wrapper.tagName.toLowerCase() : '',
              overflowX: wrapper ? getComputedStyle(wrapper).overflowX : '',
              wrapperScrollWidth: wrapper?.scrollWidth ?? 0,
              wrapperClientWidth: wrapper?.clientWidth ?? 0,
              borderCollapse: style?.borderCollapse ?? '',
              borderTopWidth: style?.borderTopWidth ?? '',
              numericAlign: numeric ? getComputedStyle(numeric).textAlign : '',
              authoredH2: document.querySelectorAll('.site-prose h2').length,
            };
          });
          must(state.hasTable, 'the preview panel has no real <table>: the example is not runnable');
          must(
            state.wrapperTag === 'figure',
            `the example must use the documented wrapper, found <${state.wrapperTag}>`,
          );
          must(state.overflowX === 'auto', `the demo wrapper must scroll (overflow-x: ${state.overflowX})`);
          must(state.authoredH2 === 0, `the page body renders ${state.authoredH2} H2(s); the template owns the one H2`);
          must(
            state.documentScrollWidth <= state.innerWidth,
            `the documentation page must not scroll sideways at 375px: ${state.documentScrollWidth} > ${state.innerWidth}`,
          );
          must(
            state.wrapperScrollWidth > state.wrapperClientWidth,
            `the wide example must overflow its wrapper at 375px: ${state.wrapperScrollWidth}px of content in ${state.wrapperClientWidth}px`,
          );
          must(
            issues.consoleErrors.length === 0 && issues.pageErrors.length === 0,
            `console: ${issues.consoleErrors.join(' | ')} page: ${issues.pageErrors.join(' | ')}`,
          );
          // The preview panel is the library's rendering: static/style.css excludes it from the
          // site's own prose rules, and the dedicated check above asserts that in both directions.
          return (
            `375px: documentElement.scrollWidth ${state.documentScrollWidth} ≤ innerWidth ${state.innerWidth}, ` +
            `wrapper ${state.wrapperScrollWidth} > ${state.wrapperClientWidth}; preview table measured ` +
            `border-collapse ${state.borderCollapse}, border-top ${state.borderTopWidth}, .bn-num ${state.numericAlign}`
          );
        },
      ),
  ],
];

/** Browser checks need playwright-core; without it they skip loudly, exactly as ticket 04's do. */
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
        '(it is a devDependency of this repository: npm install)',
    );
    return;
  }
  const server = await startServer();
  // channel: 'chrome' drives the system Chrome; the bundled chromium revision is not present.
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  console.log(`      ${server.fixture} on system Chrome ${browser.version()}\n`);
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
