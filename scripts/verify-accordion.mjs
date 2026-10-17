#!/usr/bin/env node
/**
 * Scripted verification for ticket 15 — Accordion.
 *
 * The three verification methods in `.scratch/barnacle-design/issues/15-accordion.md` are the
 * specification of this file, and every checklist bullet is a check below:
 *
 *   1. override `--bn-shadow-x` on <html> and the indicator's action changes with it
 *   2. open and close a panel, and the container does not jump: no border width moves, the
 *      summary's box is byte-for-byte the same, and the next panel shifts by exactly the panel
 *      that appeared
 *   3. with JavaScript switched off, clicking a summary still opens the panel
 *   plus: closed and open are both legible, a real Tab lands on the summary with a 3px offset
 *   outline, Enter and Space both toggle, and the motion is declared only where motion is
 *   welcome.
 *
 * The expected values are the independent source of truth: spec.md §3 (invariants 3, 6, 7), §5
 * (this file owns `details`/`summary`), §6 (tokens), §7 (the interaction contract), §8 (Accordion's
 * semantic anchor), §10 (a component page has no authored H2), ADR-0001 (the element is the
 * anchor), ADR-0003 (shadow tiers), ADR-0005 (`--bn-` / `--_` only) and
 * `D:\code\barnacle-notes\orchestrator-decisions.md` §4 (the frozen slot block), §8 (a derived
 * token only rescales when the override lands on `<html>`) and §13 (state rules stay with the
 * component). They are never recomputed from `src/css/accordion.css`.
 *
 * Two things about the browser half are deliberate:
 *
 *   - Every measurement is taken from `static/barnacle.css`, the shipped bytes, served from
 *     `static/` only. Nothing from `src/` is reachable, so a green run cannot be measuring a
 *     source file the browser never loaded.
 *   - The one state axis is `details[open]`, so the "no jump" check compares the *same* two
 *     elements across the toggle rather than two different fixtures: the summary's rect, padding
 *     and border widths have to be identical, the details' frame has to be identical, and the
 *     next sibling has to move by exactly the height the panel added.
 *
 * Run with: npm run verify:accordion   (or: node scripts/verify-accordion.mjs)
 * Options:  --no-browser  skip the real-Chrome checks (they need playwright-core)
 *           --no-docs     skip the seite build + built-page checks
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const abs = (...parts) => path.join(ROOT, ...parts);

/* ------------------------------------ expectations ----------------------------------- */

const SOURCE = 'src/css/accordion.css';
const SLOT_SOURCE = 'src/css/00-base.css';
const TOKEN_SOURCE = 'src/css/01-theme.css';
const ARTIFACT = 'static/barnacle.css';
const ARTIFACT_MIN = 'static/barnacle.min.css';
const DOC_PAGE = 'content/components/accordion.md';
const DOC_HTML = 'dist/components/accordion.html';

/** spec §6.1 — computed values, spelled out here so the source can never define its own truth. */
const BORDER = '3px';
const RADIUS = '0px';
const INK = 'rgb(0, 0, 0)';
const SURFACE = 'rgb(255, 255, 255)';
const MAIN = 'rgb(255, 210, 63)';
const DANGER = 'rgb(255, 107, 107)';
const RING = 'rgb(116, 185, 255)';
const DARK_SURFACE = 'rgb(38, 38, 38)';
const DARK_INK = 'rgb(255, 253, 245)';
const MOTION = '0.15s';

/** ADR-0003: an accordion item is a static block, so it rests on the small tier. */
const SHADOW_SM = 'rgb(0, 0, 0) 2px 2px 0px 0px';
/** --bn-shadow-x: 8px on <html> doubles the sm tier and quadruples the lift. */
const SCALED_SM = 'rgb(0, 0, 0) 4px 4px 0px 0px';
const DARK_SM = 'rgb(255, 253, 245) 2px 2px 0px 0px';

/** spec §6.1: --bn-font-weight-heading. */
const HEADING_WEIGHT = '700';

/**
 * The same-source chain this ticket is about (spec §3 invariant 3):
 *   --bn-shadow-x (4px) → --bn-shadow-lift (calc(x / 2) = 2px) → --_lift-x/y (calc(lift * -1) = -2px)
 * so the mark travels -2px on each axis, and 8px of base offset moves it -4px.
 */
const LIFT_PX = 2;
const SCALED_LIFT_PX = 4;
const ROTATION_DEG = 45;

/** The mark's content box: calc(var(--bn-border-width) * 3) = 9px, plus a 3px border each side. */
const INDICATOR_SIZE = '9px';

/** WCAG 2.x body-text floor — the open summary must stay readable, not fade. */
const TEXT_CONTRAST_FLOOR = 7;

/** ADR-0005: the two namespaces, and nothing else. */
const HYGIENE = {
  publicToken: /^--bn-[a-z0-9-]+$/,
  internalToken: /^--_[a-z0-9-]+$/,
};

/** spec §6.1 — the complete public token vocabulary. A component may only read from it. */
const PUBLIC_TOKENS = new Set([
  '--bn-border-width',
  '--bn-border-color',
  '--bn-radius',
  '--bn-shadow-x',
  '--bn-shadow-y',
  '--bn-shadow-reverse-x',
  '--bn-shadow-reverse-y',
  '--bn-shadow-color',
  '--bn-shadow-lift',
  '--bn-shadow-sm',
  '--bn-shadow-md',
  '--bn-shadow-lg',
  '--bn-shadow',
  '--bn-press',
  '--bn-background',
  '--bn-secondary-background',
  '--bn-foreground',
  '--bn-main',
  '--bn-main-foreground',
  '--bn-ring',
  '--bn-overlay',
  '--bn-pink',
  '--bn-blue',
  '--bn-green',
  '--bn-orange',
  '--bn-lavender',
  '--bn-success',
  '--bn-warning',
  '--bn-danger',
  '--bn-font-family',
  '--bn-font-display',
  '--bn-font-mono',
  '--bn-font-weight-base',
  '--bn-font-weight-heading',
  '--bn-transition',
]);

/** orchestrator-decisions §4 — the slots 00-base.css declares. A component only reads them. */
const FROZEN_SLOTS = new Set([
  '--_lift-x',
  '--_lift-y',
  '--_press-x',
  '--_press-y',
  '--_shadow-rest',
  '--_shadow-hover',
  '--_shadow-press',
  '--_focus-ring',
  '--_focus-ring-offset',
  '--_motion',
  '--_border-rest',
  '--_border-hover',
  '--_border-press',
  '--_surface',
  '--_surface-hover',
  '--_surface-press',
]);

/** spec §3 invariant 3 / §7 — properties whose value *is* the geometry. */
const GEOMETRY_PROPERTIES = ['transform', 'translate', 'rotate', 'box-shadow', 'outline', 'outline-offset'];

/** spec §3 invariant 7 — what a state rule is allowed to repaint, and nothing else. */
const STATE_PROPERTIES = new Set([
  'background',
  'background-color',
  'background-image',
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
  'outline-style',
  'outline-width',
  'opacity',
  'cursor',
  'translate',
  'rotate',
  'box-shadow',
]);

/** The box metrics no state rule may touch, spelled out so a violation names the property. */
const BOX_METRIC =
  /^(?:border|border-width|border-(?:block|inline)-(?:start|end)(?:-width)?|border-(?:top|right|bottom|left)(?:-width)?|padding|padding-\w+|margin|margin-\w+|inline-size|block-size|width|height|font-size|font-weight|line-height|display|gap)$/;

/** Hardcoded colour forms ADR-0005 keeps in 01-theme.css only (`color-mix(in srgb, …)` is not one). */
const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch|oklab|lch|lab)\(/;

/** Any absolute pixel length. The library's scale is relative, and geometry comes from tokens. */
const PX_LITERAL = /[\d.]+px/;

/** `details[open]` is the state; a hover or focus rule is one too (spec §3 invariant 7). */
const STATE_SELECTOR = /:hover\b|:active\b|:focus-visible\b|:focus\b|\[open\]/;

/** The names the ticket asks for: the element anchors, the state, the mark, the panel. */
const REQUIRED_SELECTORS = [
  'details',
  'summary',
  'summary::after',
  'details[open] > summary::after',
  'details > summary +',
];

/** A fence info string must stay a bare language token (the demo layer's contract). */
const ALLOWED_FENCE_INFO = /^(?:html|css|js|javascript|json|text|txt|markdown|md|svg|xml)?$/;

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

/* --------------------------------- CSS source reading --------------------------------- */

/** Comment bodies become spaces of the same length: braces and words inside prose stop counting. */
function blankComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (comment) => ' '.repeat(comment.length));
}

/** Index of the `}` closing the `{` at `openIndex`. Strings are tracked, comments are not. */
function matchBrace(text, openIndex, label) {
  must(text[openIndex] === '{', `${label}: expected "{" at index ${openIndex}`);
  let depth = 0;
  let quote = null;
  for (let i = openIndex; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error(`${label}: unbalanced braces — no matching "}" for the "{" at index ${openIndex}`);
}

/**
 * Every `selector { body }` rule, flattened out of its at-rule wrappers but keeping the wrapper
 * preludes in `conditions` — that is what makes "the transition sits inside
 * @media (prefers-reduced-motion: no-preference)" a fact instead of a regex guess.
 */
function parseRules(text, conditions = []) {
  const rules = [];
  let i = 0;
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i])) i += 1;
    if (i >= text.length) break;
    const open = text.indexOf('{', i);
    if (open === -1) break;
    const semi = text.indexOf(';', i);
    if (semi !== -1 && semi < open) {
      i = semi + 1; // an at-statement such as `@layer a, b;` — nothing to collect
      continue;
    }
    const prelude = text.slice(i, open).trim();
    const close = matchBrace(text, open, prelude);
    const body = text.slice(open + 1, close);
    if (prelude.startsWith('@')) rules.push(...parseRules(body, [...conditions, prelude]));
    else rules.push({ selector: prelude, body, conditions });
    i = close + 1;
  }
  return rules;
}

/** `property: value` pairs declared directly in a rule body, in document order. */
function declarations(body) {
  const pairs = [];
  const re = /(--[\w-]+|[\w-]+)\s*:\s*([^;{}]+)/g;
  for (const match of body.matchAll(re)) {
    pairs.push([match[1], match[2].replace(/\s+/g, ' ').trim()]);
  }
  return pairs;
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

/** Prose with inline code spans removed: `<details>` in backticks is text, not markup. */
const proseWithoutInlineCode = (prose) => prose.replace(/`[^`]*`/g, '``');

/**
 * The nesting depth of `details` elements in one fence, and the largest number of sibling
 * `<details>` it stacks. A multi-panel example is a stack; a nested example is a depth of two.
 */
function analyseDetailsMarkup(markup) {
  const tags = [...markup.matchAll(/<(\/?)details\b/gi)];
  let depth = 0;
  let maxDepth = 0;
  let siblingsAtDepthZero = 0;
  for (const tag of tags) {
    if (tag[1] === '/') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0) siblingsAtDepthZero += 1;
    depth += 1;
    maxDepth = Math.max(maxDepth, depth);
  }
  return { maxDepth, siblings: siblingsAtDepthZero, balanced: depth === 0 };
}

/* -------------------------------------- the page -------------------------------------- */

/**
 * The measurement page. Every panel is markup a user would really write: a bare `details` with a
 * `summary` and one paragraph, one with a wrapper element around two paragraphs (so the separator
 * has exactly one owner), and one nested panel. No `<script>` tag anywhere: the no-JavaScript check
 * is about the artifact, not about a fixture that dresses itself.
 */
const FIXTURE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <link rel="icon" href="data:,">
    <title>barnacle accordion harness</title>
    <link rel="stylesheet" href="/static/barnacle.css">
  </head>
  <body>
    <main>
      <details id="first">
        <summary id="summary-one">Shipping and delivery</summary>
        <p id="panel-one">Orders leave the warehouse within one working day.</p>
      </details>

      <details id="second">
        <summary id="summary-two">Returns</summary>
        <div id="panel-two">
          <p>Send anything back within thirty days.</p>
          <p>Keep the original packaging if you can.</p>
        </div>
      </details>

      <details id="nested">
        <summary id="summary-three">Billing</summary>
        <div id="panel-three">
          <p>Invoices are issued on the first working day of the month.</p>
          <details id="inner">
            <summary id="summary-four">Invoice archive</summary>
            <p id="panel-four">The last twenty-four invoices are kept.</p>
          </details>
        </div>
      </details>
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
 * Serves the in-memory fixture, the published artifact from `static/`, and — under the `/docs/`
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
        .find(
          (candidate) =>
            candidate.startsWith(distRoot + path.sep) && fs.existsSync(candidate) && fs.statSync(candidate).isFile(),
        );
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
    docs: `${origin}/docs/components/accordion`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/**
 * A mid-transition read lies in a very believable way: 30/30 reads after `hover()` return the value
 * from *before* the transition. Freezing is not optional, and it must be registered before `goto`.
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

/** One page per check, so a failure cannot leak state (or an open panel) into the next one. */
async function withPage(browser, url, options, fn) {
  const { freeze = true, githubPages = false, ...contextOptions } = options ?? {};
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...contextOptions });
  // The built pages reference their assets through the deployed absolute base_url (spec §12), so a
  // documentation-page check has to answer those requests from dist/.
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
  // The freeze overwrites `transition`, so a check that is *about* the transition opts out with
  // { freeze: false }. With JavaScript disabled there is no init script to run.
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

/* ---------------------------------- readable assertions --------------------------------- */

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

/**
 * One snapshot of a single panel: the item box, its frame, the summary box and its frame, and the
 * indicator pseudo-element as the browser computes it. One `evaluate` means every number below
 * describes the same layout, which is what makes "nothing moved" a measurement.
 */
async function readPanel(page, id) {
  return page.evaluate((panelId) => {
    const details = document.getElementById(panelId);
    if (!details) return { found: false };
    const summary = details.querySelector(':scope > summary');
    const ds = getComputedStyle(details);
    const ss = getComputedStyle(summary);
    const mark = getComputedStyle(summary, '::after');
    const round = (value) => Math.round(value * 100) / 100;
    const rect = (element) => {
      const box = element.getBoundingClientRect();
      return { x: round(box.x), y: round(box.y), width: round(box.width), height: round(box.height), bottom: round(box.bottom) };
    };
    /** The numbers inside a length list such as `2px 2px 0px 0px` or `-2px -2px`. */
    const lengths = (value) => (String(value).match(/-?[\d.]+px/g) ?? []).map(Number.parseFloat);
    const translate = lengths(mark.translate);
    const rotate = String(mark.rotate).match(/-?[\d.]+deg/);
    const shadow = lengths(ds.boxShadow);
    return {
      found: true,
      open: details.open,
      details: {
        rect: rect(details),
        borderWidth: [
          ds.borderTopWidth,
          ds.borderRightWidth,
          ds.borderBottomWidth,
          ds.borderLeftWidth,
        ],
        borderStyle: ds.borderTopStyle,
        borderColor: ds.borderTopColor,
        radius: ds.borderTopLeftRadius,
        background: ds.backgroundColor,
        boxShadow: ds.boxShadow,
        shadowOffset: [shadow[0] ?? 0, shadow[1] ?? 0],
      },
      summary: {
        rect: rect(summary),
        borderWidth: [
          ss.borderTopWidth,
          ss.borderRightWidth,
          ss.borderBottomWidth,
          ss.borderLeftWidth,
        ],
        padding: [ss.paddingBlockStart, ss.paddingBlockEnd, ss.paddingInlineStart, ss.paddingInlineEnd],
        display: ss.display,
        fontFamily: ss.fontFamily,
        fontWeight: ss.fontWeight,
        cursor: ss.cursor,
        listStyleType: ss.listStyleType,
        color: ss.color,
        background: ss.backgroundColor,
        outlineStyle: ss.outlineStyle,
        outlineWidth: ss.outlineWidth,
        outlineOffset: ss.outlineOffset,
        outlineColor: ss.outlineColor,
        focusVisible: summary.matches(':focus-visible'),
      },
      mark: {
        content: mark.content,
        width: mark.width,
        height: mark.height,
        borderWidth: [mark.borderTopWidth, mark.borderRightWidth, mark.borderBottomWidth, mark.borderLeftWidth],
        borderStyle: mark.borderTopStyle,
        borderColor: mark.borderTopColor,
        background: mark.backgroundColor,
        translate: mark.translate,
        translateX: translate[0] ?? 0,
        translateY: translate[1] ?? 0,
        rotate: mark.rotate,
        rotateDeg: rotate ? Number.parseFloat(rotate[0]) : 0,
        transitionProperty: mark.transitionProperty,
        transitionDuration: mark.transitionDuration,
      },
    };
  }, id);
}

/** Override a token where it actually rescales the derived chain: on `<html>` (orchestrator §8). */
const setRootToken = (page, token, value) =>
  page.evaluate(([name, v]) => document.documentElement.style.setProperty(name, v), [token, value]);

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

/* ================================ static checks: the page ============================= */

console.log(`barnacle accordion verification — ${ROOT}\n`);

const rawSource = fs.readFileSync(abs(SOURCE), 'utf8');
const source = blankComments(rawSource);
const rules = parseRules(source);
const allDeclarations = rules.flatMap((rule) =>
  declarations(rule.body).map(([property, value]) => ({ property, value, selector: rule.selector, conditions: rule.conditions })),
);
const customProps = [...new Set([...source.matchAll(/--[\w-]+/g)].map((match) => match[0]))];

const rawArtifact = fs.readFileSync(abs(ARTIFACT), 'utf8');
const rawArtifactMin = fs.readFileSync(abs(ARTIFACT_MIN), 'utf8');

const docsRaw = fs.existsSync(abs(DOC_PAGE)) ? fs.readFileSync(abs(DOC_PAGE), 'utf8') : '';
const docs = dissectDocs(docsRaw);

await check(`the Accordion page exists as a component page (${DOC_PAGE})`, () => {
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

await check('the page carries a multi-panel example and a nested one (ticket bullet 5)', () => {
  const html = docs.fences.filter((fence) => /^html$/i.test(fence.info));
  must(html.length > 0, 'no HTML fence exists, so the page has no Preview panel');
  const analysed = html.map((fence) => analyseDetailsMarkup(fence.text));
  must(
    analysed.every((fence) => fence.balanced),
    'a fences opens more details elements than it closes',
  );
  const multi = analysed.find((fence) => fence.siblings >= 2);
  must(multi, `no fence stacks at least two panels: ${analysed.map((fence) => fence.siblings).join(', ')} sibling(s)`);
  const nested = analysed.find((fence) => fence.maxDepth >= 2);
  must(nested, `no fence nests a panel inside a panel: max depth ${Math.max(...analysed.map((fence) => fence.maxDepth))}`);
  return `${html.length} HTML fence(s): one stacks ${multi.siblings} panels, one nests to depth ${nested.maxDepth}`;
});

await check('the example is runnable markup: a bare details, a bare summary, one paragraph', () => {
  const demo = docs.fences.find((fence) => /^html$/i.test(fence.info)).text;
  for (const anchor of ['<details', '<summary', '<p>']) {
    must(demo.includes(anchor), `the example has no ${anchor} — the semantic anchors are the point`);
  }
  must(!/class=/.test(demo), 'the example carries a class; a details needs none (ADR-0001)');
  must(!/<script/i.test(demo), 'the example carries a script; the toggle is the browser\'s');
  return `${demo.split('\n').length} lines of example markup, no class, no script`;
});

await check('the prose names both anchors and documents the indicator, the keyboard and the token', () => {
  const prose = docs.prose;
  for (const anchor of ['`details`', '`summary`']) {
    must(prose.includes(anchor), `the page never names ${anchor}`);
  }
  const lead = prose.split(/\r?\n/).find((line) => line.trim() !== '') ?? '';
  must(
    lead.includes('`details`') && lead.includes('`summary`'),
    `the lead sentence must name both anchors, read: ${lead.slice(0, 140)}`,
  );
  for (const name of ['Enter', 'Space', '`--bn-shadow-x`', 'focus']) {
    must(prose.includes(name), `the page never documents ${name}`);
  }
  const shortcode = prose.match(/\{\{[<%#]/);
  must(!shortcode, `the prose uses seite shortcode syntax (${shortcode?.[0]}) — authors write Markdown only`);
  const rawHtml = proseWithoutInlineCode(prose).match(/<[a-zA-Z][^>]*>/);
  must(!rawHtml, `raw HTML outside a fence: ${rawHtml?.[0]} — the demo layer is the only renderer`);
  for (const marker of ['site-demo', 'data-site-']) {
    must(!prose.includes(marker), `the prose mentions ${marker}; the layer must not need author markup`);
  }
  return `both anchors named in the lead, keyboard + focus + token documented, no raw HTML in prose`;
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

await check('src/css/accordion.css is UTF-8 without a BOM and writes no @layer', () => {
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
  must(rules.length > 0, 'the file declares no rule at all — ticket 15 has not landed');
  return `${rules.length} rules, layer assignment left to the manifest`;
});

await check('src/css/accordion.css invents no name (ADR-0005: --bn-* and --_* only)', () => {
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
    ...new Set(allDeclarations.map(({ property }) => property).filter((name) => HYGIENE.internalToken.test(name))),
  ];
  must(
    declared.length === 0,
    `the accordion declares internal slot(s) ${declared.join(', ')} — geometry is declared once, in 00-base.css`,
  );
  const read = [...new Set([...source.matchAll(/var\(\s*(--_[\w-]+)/g)].map((match) => match[1]))];
  const unknownReads = read.filter((name) => !FROZEN_SLOTS.has(name));
  must(unknownReads.length === 0, `unknown internal variable(s) read: ${unknownReads.join(', ')}`);
  return `0 slots declared, ${read.length} frozen slot(s) read: ${read.join(', ')}`;
});

await check('no !important and no colour literal (colours come from 01-theme.css)', () => {
  must(!/!\s*important/.test(source), 'the layer contract makes the flag unnecessary and forbidden');
  const offenders = [...source.matchAll(new RegExp(COLOUR_LITERAL.source, 'g'))].map((match) => match[0]);
  must(offenders.length === 0, `hardcoded colour(s): ${[...new Set(offenders)].join(', ')}`);
  const mixes = [...source.matchAll(/color-mix\([^)]*\)/g)].map((match) => match[0]);
  const literalMix = mixes.filter((call) => !/var\(--/.test(call));
  must(literalMix.length === 0, `color-mix() must mix tokens, not literals: ${literalMix.join('; ')}`);
  return `0 colour literals, ${mixes.length} token-only color-mix() tint(s)`;
});

await check('every length is a token or a relative unit — no px literal anywhere in the file', () => {
  const offenders = [...source.matchAll(new RegExp(PX_LITERAL.source, 'g'))].map((match) => match[0]);
  must(
    offenders.length === 0,
    `absolute pixel length(s): ${[...new Set(offenders)].join(', ')} — ` +
      'the scale is relative and geometry comes from --bn-* (spec §3 invariant 3)',
  );
  return '0 px literals';
});

await check('geometry reads the tokens: the frame from a tier token, the mark from the lift slots', () => {
  const offenders = allDeclarations
    .filter(({ property }) => property === 'transform')
    .map(({ selector, value }) => `${selector} { transform: ${value} }`);
  must(
    offenders.length === 0,
    `no rule writes transform — the mark's displacement is the translate property, which the ` +
      `interaction audit can read as two slots: ${offenders.join('; ')}`,
  );

  const translates = allDeclarations.filter(({ property }) => property === 'translate');
  must(translates.length > 0, 'the mark is never displaced — the open and closed states look identical');
  const badTranslates = translates.filter(({ value }) => !/^var\(--_lift-x\) var\(--_lift-y\)$/.test(value));
  must(
    badTranslates.length === 0,
    `the mark's translate must read both lift slots (spec §3 invariant 3): ${badTranslates
      .map(({ selector, value }) => `${selector} { translate: ${value} }`)
      .join('; ')}`,
  );
  const literalAngles = allDeclarations
    .filter(({ property, value }) => property === 'rotate' && !/^[\d.]+deg$/.test(value))
    .map(({ selector, value }) => `${selector} { rotate: ${value} }`);
  must(literalAngles.length === 0, `rotate must be an angle: ${literalAngles.join('; ')}`);

  const shadows = allDeclarations.filter(({ property }) => property === 'box-shadow');
  must(shadows.length > 0, 'the item paints no shadow at all — ADR-0003 gives a static block the sm tier');
  const literalShadows = shadows.filter(({ value }) => !/^var\(--(?:bn-shadow[\w-]*|_shadow[\w-]*)\)$/.test(value));
  must(
    literalShadows.length === 0,
    `box-shadow must be one tier token: ${literalShadows.map(({ value }) => value).join('; ')}`,
  );
  return `${translates.length} translate() slot pair(s), ${shadows.length} tier token, 0 transform`;
});

await check('the same-source chain is real: shadow offset → lift → mark travel (spec §3 invariant 3)', () => {
  const base = fs.readFileSync(abs(SLOT_SOURCE), 'utf8');
  const theme = fs.readFileSync(abs(TOKEN_SOURCE), 'utf8');
  must(
    base.includes('--_lift-x: calc(var(--bn-shadow-lift) * -1);'),
    `${SLOT_SOURCE} no longer declares --_lift-x from --bn-shadow-lift — the chain is broken`,
  );
  must(
    base.includes('--_lift-y: calc(var(--bn-shadow-lift) * -1);'),
    `${SLOT_SOURCE} no longer declares --_lift-y from --bn-shadow-lift — the chain is broken`,
  );
  must(
    theme.includes('--bn-shadow-lift: calc(var(--bn-shadow-x) / 2);'),
    `${TOKEN_SOURCE} no longer derives --bn-shadow-lift from --bn-shadow-x`,
  );
  must(
    theme.includes('--bn-shadow-sm: calc(var(--bn-shadow-x) / 2) calc(var(--bn-shadow-y) / 2) 0 0 var(--bn-shadow-color);'),
    `${TOKEN_SOURCE} no longer derives the sm tier from the offset tokens`,
  );
  const open = rules.filter((rule) => rule.selector.includes('details[open]'));
  must(open.length > 0, 'no details[open] rule exists — the open state is not declared');
  const travel = open.flatMap((rule) => declarations(rule.body)).filter(([property]) => property === 'translate');
  must(travel.length === 1, `the open state must declare exactly one translate, found ${travel.length}`);
  must(
    travel[0][1] === 'var(--_lift-x) var(--_lift-y)',
    `the open state must travel by both lift slots, read ${travel[0][1]}`,
  );
  return '--bn-shadow-x/2 → --bn-shadow-lift → --_lift-x/y → the mark\'s translate; 1 open travel';
});

await check('no state rule can change a border width or any other box metric (invariant 7)', () => {
  const stateRules = rules.filter(isStateRule);
  must(stateRules.length > 0, 'no details[open] / :hover / :focus rule exists');
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
    `a state may only repaint and displace (spec §3 invariant 7 — a border that grows on open reflows the page):\n  ${offenders.join('\n  ')}`,
  );
  return `${stateRules.length} state rule(s): ${[
    ...new Set(stateRules.flatMap((rule) => declarations(rule.body).map(([property]) => property))),
  ].join(', ')}`;
});

await check('the separator belongs to the panel, never to the summary (the header cannot grow)', () => {
  /**
   * Does this selector dress the summary *itself*? Trailing pseudo-classes and attribute selectors
   * are stripped first, so `details > summary:hover` counts and `details > summary + :not(details)`
   * does not: the latter dresses the element after the summary.
   */
  const summaryOwned = (selector) =>
    selector.split(',').some((part) => {
      const stripped = part
        .trim()
        .replace(/(?:::[a-z-]+(?:\([^)]*\))?|:[a-z-]+(?:\([^)]*\))?|\[[^\]]*\])+$/i, '')
        .trim();
      return /(?:^|[\s>+~])summary$/i.test(stripped);
    });
  const summaryBorders = rules
    .filter((rule) => !rule.selector.includes('::after') && summaryOwned(rule.selector))
    .flatMap((rule) => declarations(rule.body).map(([property, value]) => [rule.selector, property, value]))
    .filter(([, property]) => /^border(?:-|$)/.test(property));
  must(
    summaryBorders.length === 0,
    `a summary may not own a border — it would change width on the state that matters: ${summaryBorders
      .map(([selector, property, value]) => `${selector} { ${property}: ${value} }`)
      .join('; ')}`,
  );
  const separator = rules.filter((rule) =>
    declarations(rule.body).some(
      ([property, value]) => property === 'border-block-start' && value === 'var(--bn-border-width) solid var(--bn-border-color)',
    ),
  );
  must(separator.length === 1, `exactly one rule draws the separator, found ${separator.length}`);
  must(
    /summary\s*\+/.test(separator[0].selector),
    `the separator must belong to the element right after the summary (one owner), read ${separator[0].selector}`,
  );
  return `no border on summary; the separator is ${separator[0].selector}`;
});

await check('every required selector is present (the element anchors, the state, the mark, the panel)', () => {
  const missing = REQUIRED_SELECTORS.filter((name) => !rules.some((rule) => rule.selector.includes(name)));
  must(missing.length === 0, `missing selector(s): ${missing.join(', ')}`);
  return REQUIRED_SELECTORS.join(' ');
});

await check('motion is declared inside @media (prefers-reduced-motion: no-preference) only', () => {
  const motionRules = rules.filter((rule) =>
    declarations(rule.body).some(([property]) => property === 'transition' || property.startsWith('transition-')),
  );
  must(motionRules.length > 0, 'the mark has no transition at all — the two states would snap');
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
    'accordion.css declares an animation; the mark is a transition, and keyframes belong to their own file',
  );
  const transitioned = new Set(
    motionRules.flatMap((rule) =>
      declarations(rule.body)
        .filter(([property]) => property === 'transition')
        .flatMap(([, value]) => value.split(',').map((part) => part.trim().split(/\s+/)[0])),
    ),
  );
  for (const property of ['rotate', 'translate']) {
    must(transitioned.has(property), `the transition must cover ${property}, read ${[...transitioned].join(', ')}`);
  }
  return `${motionRules.length} transition rule(s) over ${[...transitioned].join(', ')}, 0 reduce blocks, 0 animations`;
});

await check('the focus ring is not restated here (the base layer owns the one ring)', () => {
  const rings = rules.filter((rule) => /:focus-visible/.test(rule.selector));
  must(rings.length === 0, `accordion.css restates the focus ring: ${rings.map((rule) => rule.selector).join(', ')}`);
  const base = fs.readFileSync(abs(SLOT_SOURCE), 'utf8');
  must(
    /:focus-visible\s*\{[^}]*outline:\s*var\(--_focus-ring\)/.test(base),
    `${SLOT_SOURCE} no longer paints the ring from --_focus-ring`,
  );
  return 'one ring, declared once in 00-base.css';
});

await check('the built artifact carries the accordion block inside @layer components', () => {
  must(
    rawArtifact.includes('/* src/css/accordion.css (@layer components) */'),
    `${ARTIFACT} has no accordion.css block — run npm run build`,
  );
  const block = rawArtifact.slice(
    rawArtifact.indexOf('/* src/css/accordion.css'),
    rawArtifact.indexOf('/* src/css/progress.css'),
  );
  for (const needle of [
    'details[open] > summary::after',
    'translate: var(--_lift-x) var(--_lift-y)',
    'summary::-webkit-details-marker',
    'border-block-start: var(--bn-border-width) solid var(--bn-border-color)',
  ]) {
    must(block.includes(needle), `${ARTIFACT} accordion block is missing ${JSON.stringify(needle)}`);
  }
  for (const needle of ['details[open]>summary:after', 'translate:var(--_lift-x) var(--_lift-y)']) {
    must(rawArtifactMin.includes(needle), `${ARTIFACT_MIN} is missing ${JSON.stringify(needle)} — run npm run build`);
  }
  return `${block.split('\n').length} lines of accordion.css in ${ARTIFACT}`;
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
  await check('seite build exits 0 with the Accordion page in the collection', () => {
    const result = runSeite(['build', '--dir', ROOT]);
    must(result.status === 0, `exit ${result.status}:\n${result.output}`);
    const problems = result.output.split('\n').filter((line) => /\b(broken|missing|error)\b/i.test(line));
    must(problems.length === 0, `the build mentions problems:\n${problems.join('\n')}`);
    return result.output.split('\n').find((line) => /Built\b/.test(line))?.trim() ?? 'clean';
  });

  await check('the component index lists the Accordion page (the collection picked it up)', () => {
    const index = fs.readFileSync(abs('dist/components/index.html'), 'utf8');
    must(
      /href="[^"]*\/components\/accordion"/.test(index),
      'dist/components/index.html does not link to the Accordion page — the collection did not list it',
    );
    return 'the index links /components/accordion without a trailing slash';
  });

  await check("the built page carries the raw fence and the demo layer's mount point", () => {
    must(fs.existsSync(abs(DOC_HTML)), `${DOC_HTML} was not built`);
    const html = fs.readFileSync(abs(DOC_HTML), 'utf8');
    must(/class="site-prose"/.test(html), `${DOC_HTML} lost its .site-prose body wrapper`);
    must(/<pre style="background-color:#2b303b/.test(html), `${DOC_HTML} has no raw seite fence`);
    for (const forbidden of ['role="tablist"', 'data-site-demo']) {
      must(!html.includes(forbidden), `${DOC_HTML} contains ${forbidden}: the demo UI must be built client-side`);
    }
    // seite highlights a fence, so `<details` is escaped and wrapped in spans: the claim is that the
    // example is carried as text, not that one exact byte sequence survives the highlighter.
    must(
      /&lt;[\s\S]{0,160}?details/.test(html) && html.includes('Shipping and delivery'),
      `${DOC_HTML} does not carry the accordion example as escaped text`,
    );
    const h2s = [...html.matchAll(/<h2\b[^>]*>/g)];
    must(h2s.length === 1 && /data-site-heading=/.test(h2s[0][0]), `${DOC_HTML} must render exactly the template's one H2`);
    return `${html.length}B, raw fence + one injected H2, no demo markup in the build output`;
  });
}

/* =================================== browser checks =================================== */

const BROWSER_CHECKS = [
  [
    'the closed panel is dressed: a 3px frame, the small tier, a summary with no border of its own',
    async (browser, server) =>
      withPage(browser, server.fixture, {}, async (page) => {
        const panel = await readPanel(page, 'first');
        must(panel.found, '#first is missing from the fixture');
        must(panel.open === false, 'the fixture panel must start closed');
        must(
          panel.details.borderWidth.every((width) => width === BORDER) && panel.details.borderStyle === 'solid',
          `the item frame must be ${BORDER} solid on four sides, read ${panel.details.borderWidth.join('/')} ${panel.details.borderStyle}`,
        );
        must(panel.details.borderColor === INK, `the frame must be ${INK}, read ${panel.details.borderColor}`);
        must(panel.details.radius === RADIUS, `square corners only: --bn-radius, read ${panel.details.radius}`);
        must(panel.details.background === SURFACE, `the item surface must be ${SURFACE}, read ${panel.details.background}`);
        must(panel.details.boxShadow === SHADOW_SM, `the item rests on the sm tier (${SHADOW_SM}), read ${panel.details.boxShadow}`);
        must(
          panel.summary.display === 'flex',
          `a summary is a flex row so the mark can sit at the end, read ${panel.summary.display}`,
        );
        must(panel.summary.fontWeight === HEADING_WEIGHT, `the summary must be set at ${HEADING_WEIGHT}, read ${panel.summary.fontWeight}`);
        must(panel.summary.cursor === 'pointer', `a summary is a control: cursor ${panel.summary.cursor}`);
        must(panel.summary.listStyleType === 'none', `the UA marker is replaced by the mark, read list-style ${panel.summary.listStyleType}`);
        must(
          panel.summary.borderWidth.every((width) => width === '0px'),
          `a summary owns no border (invariant 7), read ${panel.summary.borderWidth.join('/')}`,
        );
        must(
          panel.summary.padding.join('/') === '12px/12px/16px/16px',
          `the summary padding is 0.75rem 1rem, read ${panel.summary.padding.join('/')}`,
        );
        must(panel.mark.content !== 'none', 'the mark pseudo-element is not generated');
        must(
          panel.mark.width === INDICATOR_SIZE && panel.mark.height === INDICATOR_SIZE,
          `the mark's content box is calc(--bn-border-width * 3) = ${INDICATOR_SIZE}, read ${panel.mark.width}×${panel.mark.height}`,
        );
        must(
          panel.mark.borderWidth.every((width) => width === BORDER) && panel.mark.borderStyle === 'solid',
          `the mark keeps the structural border, read ${panel.mark.borderWidth.join('/')} ${panel.mark.borderStyle}`,
        );
        must(panel.mark.background === MAIN, `a closed mark is filled with --bn-main (${MAIN}), read ${panel.mark.background}`);
        must(
          panel.mark.translateX === 0 && panel.mark.translateY === 0 && panel.mark.rotateDeg === 0,
          `a closed mark sits still and square, read ${panel.mark.translate} / ${panel.mark.rotate}`,
        );
        return `frame ${BORDER} solid ${INK}, ${SHADOW_SM}, summary flex/${HEADING_WEIGHT}/no border, mark ${panel.mark.width} square in ${MAIN} at rest`;
      }),
  ],
  [
    'the open state is legible on its own: the mark turns 45° and travels by the lift, the panel arrives',
    async (browser, server) =>
      withPage(browser, server.fixture, {}, async (page) => {
        await page.click('#summary-one');
        const panel = await readPanel(page, 'first');
        must(panel.open === true, 'clicking the summary did not open the panel');
        must(panel.mark.rotateDeg === ROTATION_DEG, `the open mark must turn ${ROTATION_DEG}°, read ${panel.mark.rotate}`);
        must(
          panel.mark.translateX === -LIFT_PX && panel.mark.translateY === -LIFT_PX,
          `the open mark must travel by --_lift-x/--_lift-y (-${LIFT_PX}px each), read ${panel.mark.translate}`,
        );
        must(panel.mark.background === DANGER, `the open mark takes the danger accent (${DANGER}), read ${panel.mark.background}`);
        const separator = await page.evaluate(() => {
          const details = document.getElementById('first');
          const child = details.querySelector(':scope > summary + *');
          const style = getComputedStyle(child);
          const box = details.getBoundingClientRect();
          const childBox = child.getBoundingClientRect();
          return {
            exists: Boolean(child),
            borderBlockStartWidth: style.borderBlockStartWidth,
            borderBlockStartStyle: style.borderBlockStartStyle,
            borderBlockStartColor: style.borderBlockStartColor,
            touchesTheFrame: Math.abs(childBox.bottom - (box.bottom - 3)) < 0.51,
          };
        });
        must(separator.exists, 'the open panel has no content element');
        must(
          separator.borderBlockStartWidth === BORDER &&
            separator.borderBlockStartStyle === 'solid' &&
            separator.borderBlockStartColor === INK,
          `the panel's separator is one ${BORDER} line, read ${separator.borderBlockStartWidth} ${separator.borderBlockStartStyle} ${separator.borderBlockStartColor}`,
        );
        must(separator.touchesTheFrame, 'the panel does not reach the item frame (a gap would read as a double line)');
        return `open: mark ${panel.mark.translate} @ ${panel.mark.rotate} in ${DANGER}; separator ${separator.borderBlockStartWidth} solid ${INK}`;
      }),
  ],
  [
    'verification 2: opening moves no border width and no summary box — only the panel appears',
    async (browser, server) =>
      withPage(browser, server.fixture, {}, async (page) => {
        const before = await page.evaluate(() => {
          const details = document.getElementById('first');
          const summary = details.querySelector(':scope > summary');
          const second = document.getElementById('second');
          const rect = (element) => {
            const box = element.getBoundingClientRect();
            const round = (value) => Math.round(value * 100) / 100;
            return { x: round(box.x), y: round(box.y), width: round(box.width), height: round(box.height) };
          };
          return {
            details: rect(details),
            summary: rect(summary),
            second: rect(second),
            containerWidth: document.querySelector('main').clientWidth,
            documentScrollWidth: document.documentElement.scrollWidth,
            innerWidth: window.innerWidth,
          };
        });
        await page.click('#summary-one');
        const after = await page.evaluate(() => {
          const details = document.getElementById('first');
          const summary = details.querySelector(':scope > summary');
          const second = document.getElementById('second');
          const rect = (element) => {
            const box = element.getBoundingClientRect();
            const round = (value) => Math.round(value * 100) / 100;
            return { x: round(box.x), y: round(box.y), width: round(box.width), height: round(box.height) };
          };
          return {
            details: rect(details),
            summary: rect(summary),
            second: rect(second),
            containerWidth: document.querySelector('main').clientWidth,
            documentScrollWidth: document.documentElement.scrollWidth,
            innerWidth: window.innerWidth,
          };
        });
        const closed = await page.evaluate(() => {
          const details = document.getElementById('second');
          return { open: details.open };
        });
        must(closed.open === false, 'the control panel must stay closed');
        for (const side of ['x', 'y', 'width']) {
          must(
            Math.abs(before.summary[side] - after.summary[side]) < 0.01,
            `the summary's ${side} must not move on open: ${before.summary[side]} → ${after.summary[side]}`,
          );
        }
        must(
          Math.abs(before.summary.height - after.summary.height) < 0.01,
          `the summary must not grow on open: ${before.summary.height} → ${after.summary.height}`,
        );
        for (const side of ['x', 'y', 'width']) {
          must(
            Math.abs(before.details[side] - after.details[side]) < 0.01,
            `the item's ${side} must not move on open: ${before.details[side]} → ${after.details[side]}`,
          );
        }
        const grew = Math.round((after.details.height - before.details.height) * 100) / 100;
        must(grew > 0, 'the panel did not get taller — nothing opened');
        const shifted = Math.round((after.second.y - before.second.y) * 100) / 100;
        must(
          Math.abs(shifted - grew) < 0.51,
          `the next panel must shift by exactly the panel that appeared: +${shifted}px for ${grew}px of new panel`,
        );
        must(
          before.containerWidth === after.containerWidth,
          `the container width must not change on open: ${before.containerWidth} → ${after.containerWidth}`,
        );
        must(
          after.documentScrollWidth <= after.innerWidth,
          `opening must not widen the page: ${after.documentScrollWidth} > ${after.innerWidth}`,
        );
        // And the border widths, read directly on both elements, before and after.
        const widths = await page.evaluate(() => {
          const read = (element) => {
            const style = getComputedStyle(element);
            return [style.borderTopWidth, style.borderLeftWidth, style.borderRightWidth, style.borderBottomWidth];
          };
          const details = document.getElementById('first');
          const summary = details.querySelector(':scope > summary');
          return { details: read(details), summary: read(summary) };
        });
        for (const [name, list] of Object.entries(widths)) {
          must(
            list.every((width) => width === (name === 'details' ? BORDER : '0px')),
            `the ${name} border widths changed with the state: ${list.join('/')}`,
          );
        }
        return `summary ${before.summary.width}×${before.summary.height} unchanged, item width ${before.details.width} unchanged, next panel +${shifted}px = panel +${grew}px, borders ${widths.details.join('/')} / ${widths.summary.join('/')}`;
      }),
  ],
  [
    'verification: a real Tab reaches the summary, and Enter and Space both toggle it',
    async (browser, server) =>
      withPage(browser, server.fixture, {}, async (page) => {
        await page.evaluate(() => document.activeElement?.blur?.());
        await page.keyboard.press('Tab');
        const focused = await page.evaluate(() => ({
          id: document.activeElement?.id ?? '',
          tag: document.activeElement?.tagName?.toLowerCase() ?? '',
          focusVisible: document.activeElement?.matches?.(':focus-visible') ?? false,
        }));
        must(
          focused.id === 'summary-one' && focused.tag === 'summary' && focused.focusVisible,
          `one Tab must reach the first summary with :focus-visible, reached ${focused.tag}#${focused.id} (visible: ${focused.focusVisible})`,
        );
        const ring = await readPanel(page, 'first');
        must(
          ring.summary.outlineStyle === 'solid' &&
            ring.summary.outlineWidth === '3px' &&
            ring.summary.outlineOffset === '3px',
          `the focus ring must be a 3px solid outline offset by 3px, read ` +
            `${ring.summary.outlineWidth} ${ring.summary.outlineStyle} / offset ${ring.summary.outlineOffset}`,
        );
        must(ring.summary.outlineColor === RING, `the ring must be ${RING}, read ${ring.summary.outlineColor}`);

        const toggles = [];
        for (const key of ['Enter', 'Space']) {
          for (const expected of [true, false]) {
            await page.keyboard.press(key);
            const state = await page.evaluate(() => document.getElementById('first').open);
            must(
              state === expected,
              `${key} must ${expected ? 'open' : 'close'} the panel, read open=${state}`,
            );
            toggles.push(`${key}=${state ? 'open' : 'closed'}`);
          }
        }
        // The ring survives the toggle: a state that moves is still focusable and still marked.
        const after = await readPanel(page, 'first');
        must(after.summary.focusVisible === true, 'the summary lost :focus-visible after toggling');
        must(
          after.summary.outlineStyle === 'solid' && after.summary.outlineOffset === '3px',
          `the ring must survive the toggle, read ${after.summary.outlineStyle} / ${after.summary.outlineOffset}`,
        );
        return `Tab → summary, ${ring.summary.outlineWidth} ${ring.summary.outlineStyle} ${ring.summary.outlineColor} at offset ${ring.summary.outlineOffset}; ${toggles.join(', ')}`;
      }),
  ],
  [
    'verification 1: --bn-shadow-x on <html> rescales the mark’s travel and the item’s shadow together',
    async (browser, server) =>
      withPage(browser, server.fixture, {}, async (page) => {
        await page.click('#summary-one');
        const before = await readPanel(page, 'first');
        must(before.open === true, 'the panel is not open, so there is no travel to scale');
        must(
          before.mark.translateX === -LIFT_PX,
          `the baseline travel must be -${LIFT_PX}px, read ${before.mark.translate}`,
        );
        must(before.details.shadowOffset[0] === LIFT_PX, `the baseline sm tier is ${LIFT_PX}px, read ${before.details.boxShadow}`);

        // orchestrator §8: the override only rescales when it lands on <html>.
        await setRootToken(page, '--bn-shadow-x', '8px');
        await setRootToken(page, '--bn-shadow-y', '8px');
        const scaled = await readPanel(page, 'first');
        must(
          scaled.mark.translateX === -SCALED_LIFT_PX && scaled.mark.translateY === -SCALED_LIFT_PX,
          `the mark must travel by the rescaled lift (-${SCALED_LIFT_PX}px each), read ${scaled.mark.translate}`,
        );
        must(
          scaled.mark.rotateDeg === ROTATION_DEG,
          `the rotation is the state, not the scale: it must stay ${ROTATION_DEG}°, read ${scaled.mark.rotate}`,
        );
        must(
          scaled.details.boxShadow === SCALED_SM,
          `the item's shadow must rescale with the same token (${SCALED_SM}), read ${scaled.details.boxShadow}`,
        );
        // The closed control did not move: the change is the token, not a side effect of opening.
        const closedControl = await readPanel(page, 'second');
        must(
          closedControl.mark.translateX === 0 && closedControl.mark.translateY === 0,
          `a closed mark must stay at rest under the override, read ${closedControl.mark.translate}`,
        );
        // The whole geometry chain still describes the same object: the frame is untouched.
        must(
          scaled.details.borderWidth.every((width) => width === BORDER),
          `the frame must not move with the token, read ${scaled.details.borderWidth.join('/')}`,
        );
        // And the mark's layout box does not grow with the travel: the summary cannot be reflowed.
        must(
          scaled.summary.rect.width === before.summary.rect.width && scaled.summary.rect.height === before.summary.rect.height,
          `the summary must not reflow when the mark travels: ${before.summary.rect.width}×${before.summary.rect.height} → ` +
            `${scaled.summary.rect.width}×${scaled.summary.rect.height}`,
        );
        return `travel ${before.mark.translate} → ${scaled.mark.translate}, item shadow ${before.details.shadowOffset[0]}px → ${scaled.details.shadowOffset[0]}px, rotation ${scaled.mark.rotateDeg}° unchanged, summary box unchanged`;
      }),
  ],
  [
    'the motion guard: the mark transitions only where motion is accepted, and nothing else changes',
    async (browser, server) => {
      const full = await withPage(browser, server.fixture, { freeze: false }, async (page) => {
        const matches = await page.evaluate(() => matchMedia('(prefers-reduced-motion: no-preference)').matches);
        must(matches === true, 'the default context does not report prefers-reduced-motion: no-preference');
        const panel = await readPanel(page, 'first');
        const properties = panel.mark.transitionProperty.split(',').map((value) => value.trim());
        const durations = panel.mark.transitionDuration.split(',').map((value) => value.trim());
        for (const property of ['rotate', 'translate']) {
          must(properties.includes(property), `the mark must transition ${property}, read ${panel.mark.transitionProperty}`);
        }
        must(
          durations.every((value) => value === MOTION),
          `every transition must run for --bn-transition (${MOTION}), read ${panel.mark.transitionDuration}`,
        );
        return `${panel.mark.transitionProperty} over ${MOTION}`;
      });
      const reduce = await withPage(
        browser,
        server.fixture,
        { reducedMotion: 'reduce', freeze: false },
        async (page) => {
          const matches = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
          must(matches === true, 'the reducedMotion: reduce context did not reach the page');
          const panel = await readPanel(page, 'first');
          must(
            panel.mark.transitionDuration.split(',').every((value) => value.trim() === '0s'),
            `with reduced motion no transition may be declared, read ${panel.mark.transitionDuration}`,
          );
          must(
            panel.details.boxShadow === SHADOW_SM && panel.mark.background === MAIN,
            `reduced motion must change nothing but the motion, read ${panel.details.boxShadow} / ${panel.mark.background}`,
          );
          return panel.mark.transitionDuration;
        },
      );
      return `no-preference: ${full}; reduce: ${reduce} with the appearance untouched`;
    },
  ],
  [
    'verification 3: with JavaScript switched off, a click still opens the panel',
    async (browser, server) =>
      // The freeze is an init script, so it cannot run here — the context asks for reduced motion
      // instead, which declares no transition at all, so the mark lands in one step and the read is
      // not taken mid-animation. Both facts are part of the claim: no script, no motion, still open.
      withPage(browser, server.fixture, { javaScriptEnabled: false, reducedMotion: 'reduce' }, async (page) => {
        const scripts = await page.evaluate(() => document.querySelectorAll('script').length);
        must(scripts === 0, `the fixture must not load a script, found ${scripts}`);
        const reduced = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
        must(reduced === true, 'the reducedMotion: reduce context did not reach the page');
        const closed = await readPanel(page, 'first');
        must(closed.open === false, 'the panel must start closed');
        must(
          closed.mark.background === MAIN && closed.mark.rotateDeg === 0,
          `the closed mark must render with no script, read ${closed.mark.background} / ${closed.mark.rotate}`,
        );
        await page.click('#summary-one');
        const opened = await readPanel(page, 'first');
        must(opened.open === true, 'a click with JavaScript disabled did not open the panel');
        must(
          opened.mark.rotateDeg === ROTATION_DEG && opened.mark.translateX === -LIFT_PX,
          `the open mark must render with no script, read ${opened.mark.rotate} / ${opened.mark.translate}`,
        );
        must(
          opened.details.borderWidth.every((width) => width === BORDER) && opened.details.boxShadow === SHADOW_SM,
          'the frame and the shadow must be the shipped bytes, not a script',
        );
        return `no script: click opened the panel, mark ${opened.mark.rotate} @ ${opened.mark.translate}, frame ${opened.details.borderWidth.join('/')}`;
      }),
  ],
  [
    'the dark theme: the frame flips, the shadow flips with it, and the open mark stays readable',
    async (browser, server) =>
      withPage(browser, server.fixture, {}, async (page) => {
        await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
        await page.click('#summary-one');
        const panel = await readPanel(page, 'first');
        must(panel.details.background === DARK_SURFACE, `the dark item surface must be ${DARK_SURFACE}, read ${panel.details.background}`);
        must(panel.details.borderColor === DARK_INK, `the dark frame must be ${DARK_INK}, read ${panel.details.borderColor}`);
        must(
          panel.details.boxShadow === DARK_SM,
          `the dark hard shadow must flip to the dark ink (${DARK_SM}), read ${panel.details.boxShadow}`,
        );
        must(
          panel.summary.color === DARK_INK,
          `the dark summary ink must be ${DARK_INK}, read ${panel.summary.color}`,
        );
        const contrast = contrastRatio(panel.summary.color, DARK_SURFACE);
        must(
          contrast >= TEXT_CONTRAST_FLOOR,
          `the dark summary must keep at least ${TEXT_CONTRAST_FLOOR}:1, measured ${contrast}:1`,
        );
        must(
          panel.mark.background === DANGER && panel.mark.translateX === -LIFT_PX,
          `the mark keeps its state colours and travel in the dark, read ${panel.mark.background} / ${panel.mark.translate}`,
        );
        return `dark: surface ${DARK_SURFACE}, frame ${panel.details.borderColor}, shadow ${panel.details.boxShadow}, ink ${contrast}:1, mark ${panel.mark.background}`;
      }),
  ],
  [
    'the documentation page: the example runs in the preview panel, and a phone width never widens the page',
    async (browser, server) =>
      withPage(
        browser,
        server.docs,
        { viewport: { width: 375, height: 720 }, githubPages: true },
        async (page, issues) => {
          const state = await page.evaluate(() => {
            const panels = [...document.querySelectorAll('[data-site-demo] [role="tabpanel"]')];
            const index = panels.findIndex((panel) => panel.querySelectorAll(':scope > details').length >= 2);
            const panel = index === -1 ? panels[0] : panels[index];
            const details = panel?.querySelector('details') ?? null;
            const summary = details?.querySelector(':scope > summary') ?? null;
            const style = details ? getComputedStyle(details) : null;
            const mark = summary ? getComputedStyle(summary, '::after') : null;
            return {
              innerWidth: window.innerWidth,
              documentScrollWidth: document.documentElement.scrollWidth,
              hasDetails: Boolean(details),
              stackIndex: index,
              panels: panel?.querySelectorAll(':scope > details').length ?? 0,
              open: details?.open ?? null,
              borderTopWidth: style?.borderTopWidth ?? '',
              boxShadow: style?.boxShadow ?? '',
              summaryDisplay: summary ? getComputedStyle(summary).display : '',
              markWidth: mark?.width ?? '',
              authoredH2: document.querySelectorAll('.site-prose h2').length,
            };
          });
          must(state.hasDetails, 'the preview panel has no real <details>: the example is not runnable');
          must(state.stackIndex >= 0, `no preview panel stacks the multi-panel example, found ${state.panels} panel(s)`);
          must(state.panels >= 2, `the demo must show the multi-panel stack, found ${state.panels} panel(s)`);
          must(state.open === false, 'the demo panels must start closed so the reader can open one');
          must(
            state.borderTopWidth === BORDER && state.boxShadow === SHADOW_SM,
            `the demo must compute the library's frame and shadow, read ${state.borderTopWidth} / ${state.boxShadow}`,
          );
          must(state.summaryDisplay === 'flex', `the demo summary must be the library's flex row, read ${state.summaryDisplay}`);
          must(state.markWidth === INDICATOR_SIZE, `the demo mark must be the library's mark, read ${state.markWidth}`);
          const stack = page.locator('[data-site-demo] [role="tabpanel"]').nth(state.stackIndex);
          await stack.locator('details > summary').first().click();
          const opened = await stack.evaluate((panel) => {
            const details = panel.querySelector('details');
            const mark = getComputedStyle(details.querySelector(':scope > summary'), '::after');
            return { open: details.open, rotate: mark.rotate, translate: mark.translate };
          });
          must(opened.open === true, 'the documentation example did not open on a click');
          must(
            opened.rotate.startsWith('45deg') && /-2px/.test(opened.translate),
            `the documentation example must show the library's open mark, read ${opened.rotate} / ${opened.translate}`,
          );
          must(state.authoredH2 === 0, `the page body renders ${state.authoredH2} authored H2(s); the template owns the one H2`);
          must(
            state.documentScrollWidth <= state.innerWidth,
            `the documentation page must not scroll sideways at 375px: ${state.documentScrollWidth} > ${state.innerWidth}`,
          );
          must(
            issues.consoleErrors.length === 0 && issues.pageErrors.length === 0,
            `console: ${issues.consoleErrors.join(' | ')} page: ${issues.pageErrors.join(' | ')}`,
          );
          return `375px: scrollWidth ${state.documentScrollWidth} ≤ ${state.innerWidth}, ${state.panels} demo panels, frame ${state.borderTopWidth}, mark ${state.markWidth}, opened → ${opened.rotate} @ ${opened.translate}`;
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
