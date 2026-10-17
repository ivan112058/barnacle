#!/usr/bin/env node
/**
 * Scripted verification for ticket 11 — Switch.
 *
 * The three verification methods in `.scratch/barnacle-design/issues/11-switch.md` are the
 * specification of this file, and every checklist bullet of the ticket is a check below:
 *
 *   1. the switch is operated with the keyboard alone — Tab reaches it, the focus ring is visible,
 *      Space flips it
 *   2. before and after a toggle the computed border widths are read and must be identical
 *   3. with JavaScript disabled the switch still toggles
 *   plus: on and off are visually distinguishable, the thumb's travel is derived from the same
 *   token that draws its shadow (spec §3 invariant 3), and no state rule touches a box metric
 *   (spec §3 invariant 7).
 *
 * The expected values are the independent source of truth: spec.md §3 (invariants 1–7), §5 (the
 * file granularity — `switch` lives in `form.css`), §6.1/§6.2 (tokens), §7 (the interaction and
 * motion contract), §8 (Switch's semantic anchor is `input[role="switch"]`), §10 (a component page
 * has no authored H2), ADR-0001 (the element is the anchor), ADR-0003 (shadow tiers), ADR-0005
 * (`--bn-*` / `--_*` only), ADR-0006 (the layer contract) and
 * `D:\code\barnacle-notes\orchestrator-decisions.md` §4 (geometry has one source), §11 (file
 * ownership) and §13 (state rules stay in the component file). They are never recomputed from
 * `src/css/form.css`.
 *
 * Two properties of the browser half are deliberate:
 *
 *   - the measurements come from `static/barnacle.css`, the shipped bytes, served from `static/`
 *     only, so a green run cannot be measuring a source file the browser never loaded;
 *   - every hover/transition read happens with `transition` and `animation` frozen (a mid-transition
 *     read lies convincingly — browser-harness-findings §3.3), except the two checks that are
 *     *about* the transition declaration, which opt out with `{ freeze: false }`.
 *
 * Run with: npm run verify:switch   (or: node scripts/verify-switch.mjs)
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

const SOURCE = 'src/css/form.css';
const BASE_SOURCE = 'src/css/00-base.css';
const ARTIFACT = 'static/barnacle.css';
const ARTIFACT_MIN = 'static/barnacle.min.css';
const DOC_PAGE = 'content/components/switch.md';
const DOC_HTML = 'dist/components/switch.html';
const DOC_INDEX = 'dist/components/index.html';

/** spec §8 — Switch's semantic anchor, written the way its own ticket writes it. */
const ANCHOR = 'input[role="switch"]';

/**
 * spec §6.1 + the ticket's geometry, as computed values:
 *
 *   --bn-border-width 3px, --bn-shadow-x 4px, --_switch-h 1.75rem (28px)
 *   --_switch-gap      the structural border itself = 3px
 *   --_switch-travel   calc(4px * 3)     = 12px
 *   --_switch-thumb    calc(28px - 2·3px - 2·3px) = 16px
 *   inline-size        calc(28px + 12px) = 40px
 *   content box        40 − 2·3 = 34px, and 3 + 16 + 12 + 3 = 34, so the thumb's two gaps
 *                      (3px and 15px) swap exactly when the travel is applied.
 *   with --bn-shadow-x/y overridden to 8px: travel 24px, box 52px, content 46px, shadow 4px 4px
 *
 * These are worked out from spec §6.1, not read back out of the source file.
 */
const SWITCH = {
  border: '3px',
  radius: '0px',
  height: 28,
  thumb: 16,
  gap: 3,
  travel: 12,
  width: 40,
  content: 34,
  /** with --bn-shadow-x/y = 8px on <html>: travel = 3 × 8, so the box grows by the same 12px. */
  scaledTravel: 24,
  scaledWidth: 52,
  scaledContent: 46,
  scaledShadow: 'rgb(0, 0, 0) 4px 4px 0px 0px',
};

/** spec §6.1/§6.2 — the colours the harness reads, in Chrome's serialisation. */
const COLOR = {
  paper: 'rgb(255, 253, 245)',
  main: 'rgb(255, 210, 63)',
  ink: 'rgb(0, 0, 0)',
  ring: 'rgb(116, 185, 255)',
  darkPaper: 'rgb(26, 26, 26)',
  darkInk: 'rgb(255, 253, 245)',
  transparent: 'rgba(0, 0, 0, 0)',
};

/** ADR-0003: the thumb is a small piece resting in a channel, so it takes the small tier. */
const THUMB_SHADOW_SM = 'rgb(0, 0, 0) 2px 2px 0px 0px';

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

/** orchestrator-decisions §4 — the slots 00-base.css declares. A component only re-points them. */
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

/**
 * The switch's own internals (ADR-0005's `--_` namespace is for internals, and a component that
 * needs a derived length may carry one). Exactly three: the track's height, the gap, and the two
 * lengths that are computed from them — declared on the switch and nowhere else.
 */
const LOCAL_SLOTS = new Set([
  '--_switch-h',
  '--_switch-gap',
  '--_switch-travel',
  '--_switch-thumb',
]);

/**
 * The four declarations that make "the slide and the shadow have one source" a fact rather than a
 * coincidence: the travel is three shadow offsets, the box is the travel plus the track height, the
 * thumb fills the rest, and the gap is a fraction of the structural border. None is a length the
 * author can drift away from the token system. Each is named with the rule that must carry it, so
 * the check cannot be satisfied by the same property somewhere else in the file.
 */
const DERIVED = [
  { selector: 'input[role="switch"]', property: '--_switch-h', value: '1.75rem' },
  { selector: 'input[role="switch"]', property: '--_switch-gap', value: 'var(--bn-border-width)' },
  { selector: 'input[role="switch"]', property: '--_switch-travel', value: 'calc(var(--bn-shadow-x) * 3)' },
  {
    selector: 'input[role="switch"]',
    property: '--_switch-thumb',
    value: 'calc(var(--_switch-h) - var(--_switch-gap) * 2 - var(--bn-border-width) * 2)',
  },
  { selector: 'input[role="switch"]', property: 'inline-size', value: 'calc(var(--_switch-h) + var(--_switch-travel))' },
  { selector: 'input[role="switch"]', property: 'block-size', value: 'var(--_switch-h)' },
];

/** A dimension literal — the thing a token has to replace in a displacement or a shadow. */
const DIMENSION_LITERAL = /(?:^|[\s(,*/+-])(?:\d*\.)?\d+(?:px|rem|em|%|vw|vh|vmin|vmax|ch|ex|pt|pc|in|cm|mm|q)\b/i;

/** Hardcoded colour forms ADR-0005 keeps in 01-theme.css only. */
const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch|oklab|lch|lab|color)\(/;

/** spec §3 invariant 7 — a state rule may repaint and slide, never resize the box. */
const BOX_METRIC =
  /^(?:border|border-width|border-style|border-block-start|border-inline-start|border-(?:top|right|bottom|left)(?:-(?:width|style))?|padding|padding-\w+|margin|margin-\w+|inline-size|block-size|width|height|min-inline-size|max-inline-size|min-block-size|max-block-size|font-size|font-weight|line-height|box-sizing)$/;

const STATE_SELECTOR = /:(?:hover|active|focus-visible|focus|checked|disabled|indeterminate)\b/;

/** The properties a switch state may carry: paint, and the slide. Nothing else. */
const STATE_PROPERTIES = new Set([
  'background',
  'background-color',
  'color',
  'border-color',
  'border-inline-start-color',
  'border-block-start-color',
  'translate',
  'transform',
  'opacity',
  'cursor',
]);

/** spec §7 — motion is declared where the visitor accepts it, never switched off afterwards. */
const MOTION_GUARD = /prefers-reduced-motion:\s*no-preference/;

/** A fence info string must stay a bare language token (the demo layer's contract). */
const ALLOWED_FENCE_INFO =
  /^(?:html|css|js|javascript|json|xml|svg|text|txt|markdown|md|powershell|ps1|sh|bash|shell|console|diff)?$/;

/** The two section comments ticket 12 reads `form.css` for. They are the handoff. */
const HANDOFF_MARKERS = ['ticket 12', 'text-like', 'checkbox', 'radio', 'fieldset', 'label'];

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

function read(rel) {
  return fs.readFileSync(abs(rel), 'utf8');
}

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
 * Every `selector { body }` rule, flattened out of its at-rule wrappers while keeping the wrapper
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

const rulesOf = (raw) => parseRules(blankComments(raw));
const declarationsOf = (rules) =>
  rules.flatMap((rule) => declarations(rule.body).map(([property, value]) => ({ property, value, ...rule })));

/* -------------------------------- the documentation page ------------------------------- */

/**
 * Split a content file into frontmatter, prose and fences, the way seite reads it and the way
 * scripts/verify-demo.mjs dissects it: a fence is only a fence when its ``` sits at the start of a
 * line, and the info string is what an author wrote.
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
  return { frontmatter, prose: proseLines.join('\n'), fences, raw };
}

/** Prose with inline code spans removed: `<input>` in backticks is text, not markup. */
const withoutInlineCode = (prose) => prose.replace(/`[^`]*`/g, '``');

/* -------------------------------------- the page -------------------------------------- */

/**
 * The measurement page. The switch is the first focusable element on purpose: the keyboard check
 * presses Tab with nothing focused, and the browser's sequential focus navigation then has exactly
 * one candidate. Both anchors appear — the bare `input[type="checkbox"][role="switch"]` (which is
 * what spec §8 means) and the same control inside a `label`, so the click target a reader would
 * really use is measured too. No `<script>` anywhere: the no-JavaScript check is about the artifact.
 */
const FIXTURE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <link rel="icon" href="data:,">
    <title>barnacle switch harness</title>
    <link rel="stylesheet" href="/static/barnacle.css">
  </head>
  <body>
    <main>
      <p><label for="switch">Wi-Fi</label></p>
      <p><input id="switch" type="checkbox" role="switch"></p>
      <p>
        <label for="switch-on">Bluetooth</label>
        <input id="switch-on" type="checkbox" role="switch" checked>
      </p>
      <p>
        <label for="switch-bare">Airplane mode</label>
        <input id="switch-bare" type="checkbox" role="switch">
      </p>
      <p><input id="switch-disabled" type="checkbox" role="switch" disabled aria-label="Disabled"></p>
      <p><input id="plain" type="checkbox"></p>
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
 * prefix — the built site from `dist/` for the built-page checks.
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
    docs: `${origin}/docs/components/switch`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/**
 * A mid-transition read lies in a very believable way (browser-harness-findings §3.3), so freezing
 * is the default. It is registered before `goto`, because `addStyleTag` after load is already late.
 * A check that is *about* a transition declaration opts out with `{ freeze: false }`; with
 * JavaScript disabled there is no init script at all, and the switch must need none.
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

/** The built pages reference their assets through the deployed absolute base_url (spec §12). */
async function withPage(browser, url, options, fn) {
  const { freeze = true, githubPages = false, ...contextOptions } = options ?? {};
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...contextOptions });
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
      hint: 'check the fixture markup in scripts/verify-switch.mjs',
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
 * One snapshot of a switch and its thumb. The thumb is `::before`, so its box is read from the
 * pseudo-element's computed style and its position is put together here: the inset from the
 * padding edge plus the `translate` that the checked state applies. `left`/`right` are the two gaps
 * inside the content box — the whole point of the switch is that they swap, and that the travel
 * equals the leftover the channel has after the thumb and its two gaps.
 */
async function readSwitch(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { found: false };
    const cs = getComputedStyle(el);
    const thumb = getComputedStyle(el, '::before');
    const box = el.getBoundingClientRect();
    const number = (value) => {
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
    };
    const borderInline = number(cs.borderInlineStartWidth);
    const inlineSize = number(cs.inlineSize);
    const contentWidth = inlineSize - 2 * borderInline;
    const gap = number(thumb.insetInlineStart);
    const translateX = number(String(thumb.translate).split(/\s+/)[0]);
    const thumbWidth = number(thumb.inlineSize);
    return {
      found: true,
      checked: el.checked,
      boxWidth: Math.round(box.width * 100) / 100,
      boxHeight: Math.round(box.height * 100) / 100,
      borderTopWidth: cs.borderTopWidth,
      borderLeftWidth: cs.borderLeftWidth,
      borderRightWidth: cs.borderRightWidth,
      borderBottomWidth: cs.borderBottomWidth,
      borderTopColor: cs.borderTopColor,
      borderTopStyle: cs.borderTopStyle,
      borderRadius: cs.borderTopLeftRadius,
      background: cs.backgroundColor,
      display: cs.display,
      cursor: cs.cursor,
      focusVisible: el.matches(':focus-visible'),
      outlineStyle: cs.outlineStyle,
      outlineWidth: cs.outlineWidth,
      outlineColor: cs.outlineColor,
      outlineOffset: cs.outlineOffset,
      inlineSize,
      contentWidth,
      transitionDuration: cs.transitionDuration,
      transitionProperty: cs.transitionProperty,
      thumb: {
        content: thumb.content,
        width: thumbWidth,
        height: number(thumb.blockSize),
        background: thumb.backgroundColor,
        boxShadow: thumb.boxShadow,
        borderRadius: thumb.borderTopLeftRadius,
        translateX,
        gap,
        left: gap + translateX,
        right: contentWidth - (gap + translateX + thumbWidth),
        transitionDuration: thumb.transitionDuration,
        transitionProperty: thumb.transitionProperty,
      },
    };
  }, selector);
}

/** The travel the channel has left after the thumb and its two gaps — what the slide must be. */
const channelTravel = (snapshot) => snapshot.contentWidth - snapshot.thumb.width - 2 * snapshot.thumb.gap;

/**
 * Poll a switch until its computed state settles. Freezing needs an init script, and a
 * no-JavaScript context has none — so instead of reading a mid-transition value (which lies in a
 * very convincing way, browser-harness-findings §3.3) the check waits until the declared transition
 * has finished, comparing the property rather than sleeping past it blindly.
 */
async function settledSwitch(page, selector, predicate, timeout = 3000) {
  const deadline = Date.now() + timeout;
  let last = await readSwitch(page, selector);
  while (Date.now() < deadline && !predicate(last)) {
    await page.waitForTimeout(25);
    last = await readSwitch(page, selector);
  }
  return last;
}

/* ================================ static checks: the page ============================= */

console.log(`barnacle switch verification — ${ROOT}\n`);

const rawSource = read(SOURCE);
const source = blankComments(rawSource);
const rules = rulesOf(rawSource);
const allDeclarations = declarationsOf(rules);
const customProps = [...new Set([...source.matchAll(/--[\w-]+/g)].map((match) => match[0]))];

const rawArtifact = read(ARTIFACT);
const rawArtifactMin = fs.existsSync(abs(ARTIFACT_MIN)) ? read(ARTIFACT_MIN) : '';
const baseSource = read(BASE_SOURCE);

const docsRaw = fs.existsSync(abs(DOC_PAGE)) ? read(DOC_PAGE) : '';
const docs = dissect(docsRaw);
const demoFences = docs.fences.filter((fence) => fence.text.trim().startsWith('<'));

await check(`the Switch page exists as a component page (${DOC_PAGE})`, () => {
  must(docsRaw.length > 0, `${DOC_PAGE} is missing`);
  const bytes = fs.existsSync(abs(DOC_PAGE)) ? fs.readFileSync(abs(DOC_PAGE)) : Buffer.alloc(0);
  must(!(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf), 'a BOM makes seite fail the build');
  must(/^title:\s*".+"$/m.test(docs.frontmatter), 'the frontmatter has no quoted title');
  must(/^description:\s*".+"$/m.test(docs.frontmatter), 'the frontmatter has no quoted description');
  const headings = [...docs.prose.matchAll(/^(#{1,6})\s+(.*)$/gm)].map((match) => match[0]);
  const tooHigh = headings.filter((heading) => /^#{1,2}\s/.test(heading));
  must(
    tooHigh.length === 0,
    `a component page body starts at H3 — the template supplies the one H2 (spec §10): ${tooHigh.join(' | ')}`,
  );
  const badFences = docs.fences.filter((fence) => !ALLOWED_FENCE_INFO.test(fence.info) || fence.unterminated);
  must(
    badFences.length === 0,
    `every fence must be a plain language token and terminated: ${badFences.map((fence) => fence.info).join(', ')}`,
  );
  return `${headings.length} H3 heading(s), ${docs.fences.length} fence(s): ${docs.fences
    .map((fence) => fence.info || '<none>')
    .join(', ')}`;
});

await check('the example is runnable markup: a checkbox that announces itself as a switch', () => {
  must(demoFences.length > 0, 'no HTML fence exists, so the page has no Preview panel and no switch to press');
  const demo = demoFences[0].text;
  must(/<input\b[^>]*type="checkbox"/.test(demo), 'the example has no `<input type="checkbox">` — the native state is the point');
  must(/<input\b[^>]*role="switch"/.test(demo), 'the example has no `role="switch"`');
  must(/<label\b[^>]*\bfor="/.test(demo), 'the example has no label: a reader should be able to press the words, not only the box');
  must(!/<script\b/.test(demo), 'the example loads a script — the switch must be pure markup and CSS');
  const second = demoFences[1]?.text ?? '';
  return `${demo.split('\n').length} lines in the first example${second ? `, ${second.split('\n').length} in the second` : ''}`;
});

await check('the prose names the anchor, the state and the way out of a theme', () => {
  const prose = docs.prose;
  const anchors = ['input[role="switch"]', 'type="checkbox"', ':checked', 'Tab', 'Space'];
  const missing = anchors.filter((anchor) => !prose.includes(anchor));
  must(missing.length === 0, `the page never names ${missing.join(', ')}`);
  must(
    /no (?:script|JavaScript)/i.test(prose) || /without (?:script|JavaScript)/i.test(prose),
    'the page must say the switch needs no script',
  );
  const shortcode = prose.match(/\{\{[<%#]/);
  must(!shortcode, `the prose uses seite shortcode syntax (${shortcode?.[0]}) — authors write Markdown only`);
  const rawHtml = withoutInlineCode(prose).match(/<[a-zA-Z][^>]*>/);
  must(!rawHtml, `raw HTML outside a fence: ${rawHtml?.[0]} — the demo layer is the only renderer`);
  const links = [...docsRaw.matchAll(/\]\(([^)\s]+)\)/g)].map((match) => match[1]);
  const trailing = links.filter((href) => href.endsWith('/'));
  must(trailing.length === 0, `a root-relative link must not end in "/": ${trailing.join(', ')}`);
  const outside = links.filter((href) => /^https?:/.test(href));
  must(outside.length === 0, `an absolute link would leave the base path: ${outside.join(', ')}`);
  const lead = prose.split('\n').find((line) => line.trim() && !line.startsWith('>')) ?? '';
  must(lead.includes('input[role="switch"]'), `the lead sentence must name the anchor, read: ${lead.slice(0, 120)}`);
  return `anchor + state + keyboard documented, ${links.length} link(s), none trailing`;
});

/* =================================== static checks =================================== */

await check('src/css/form.css is UTF-8 without a BOM, writes no @layer, and keeps the handoff to ticket 12', () => {
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
  must(rules.length > 0, 'the file declares no rule at all — ticket 11 has not landed');
  const lower = rawSource.toLowerCase();
  const missing = HANDOFF_MARKERS.filter((marker) => !lower.includes(marker.toLowerCase()));
  must(
    missing.length === 0,
    `the file must keep the section map ticket 12 reads (missing: ${missing.join(', ')}) — the switch is not the whole file`,
  );
  return `${rules.length} rules; the form sections ticket 12 inherits are named`;
});

await check('the anchor is the role, not a class, and its styles live in form.css only (decision §13)', () => {
  const switchRules = rules.filter((rule) => rule.selector.includes('[role="switch"]') || rule.selector.includes("[role='switch']"));
  must(switchRules.length > 0, `no rule addresses ${ANCHOR} — the component has no anchor`);
  const wrongAnchor = switchRules.filter((rule) => !/(?:^|[\s,(>+~])input\[role="?switch"?\]/.test(rule.selector.replace(/'/g, '"')));
  must(
    wrongAnchor.length === 0,
    `every switch rule must hang off the input's role attribute: ${wrongAnchor.map((rule) => rule.selector).join(' | ')}`,
  );
  const invented = [...source.matchAll(/\.bn-[a-z0-9-]+/g)].map((match) => match[0]).filter((name) => /switch/i.test(name));
  must(invented.length === 0, `a class name was invented for a control that has an attribute: ${[...new Set(invented)].join(', ')} — ADR-0001`);
  const baseSwitch = rulesOf(baseSource).filter(
    (rule) => /\[role="switch"\]/.test(rule.selector) || /:checked\b/.test(rule.selector),
  );
  must(
    baseSwitch.length === 0,
    `a switch state rule was hoisted into 00-base.css (${baseSwitch.map((rule) => rule.selector).join(', ')}): ` +
      'state rules stay with the component that owns the state (decision §13)',
  );
  return `${switchRules.length} rule(s) on ${ANCHOR}, no bn- class, nothing in ${BASE_SOURCE}`;
});

await check('the file invents no name (ADR-0005: --bn-* and --_* only)', () => {
  const unknownPublic = customProps.filter((name) => HYGIENE.publicToken.test(name) && !PUBLIC_TOKENS.has(name));
  must(unknownPublic.length === 0, `unknown public token(s): ${unknownPublic.join(', ')} — spec §6.1 is the whole vocabulary`);
  const foreign = customProps.filter(
    (name) => !HYGIENE.publicToken.test(name) && !HYGIENE.internalToken.test(name),
  );
  must(foreign.length === 0, `custom properties outside the two namespaces: ${foreign.join(', ')}`);

  const declared = [...new Set(allDeclarations.map(({ property }) => property).filter((name) => HYGIENE.internalToken.test(name)))];
  const invented = declared.filter((name) => !FROZEN_SLOTS.has(name) && !LOCAL_SLOTS.has(name));
  must(
    invented.length === 0,
    `new internal slot(s): ${invented.join(', ')} — geometry is declared once in 00-base.css (orchestrator §4); ` +
      'a component may only add its own `--_switch-*` lengths',
  );
  const used = [...new Set([...source.matchAll(/var\(\s*(--_[\w-]+)/g)].map((match) => match[1]))];
  const unknown = used.filter((name) => !FROZEN_SLOTS.has(name) && !LOCAL_SLOTS.has(name));
  must(unknown.length === 0, `unknown internal variable(s) read: ${unknown.join(', ')}`);
  return `${declared.length} slot(s) declared (${declared.filter((n) => LOCAL_SLOTS.has(n)).length} local), ${used.length} read, 0 invented`;
});

await check('no !important, no colour literal, no switch on the outline', () => {
  must(!/!\s*important/.test(source), 'the layer contract makes !important unnecessary and forbidden');
  const offenders = [...source.matchAll(new RegExp(COLOUR_LITERAL.source, 'g'))].map((match) => match[0]);
  must(offenders.length === 0, `hardcoded colour(s): ${[...new Set(offenders)].join(', ')} — 01-theme.css owns every colour`);
  must(!/outline\s*:\s*(?:none|0)\b/.test(source), 'nothing may remove the focus ring (WCAG F78) — the base layer draws it');
  const rings = allDeclarations.filter(({ property }) => property === 'outline');
  const localRings = rings.filter(({ value }) => !value.includes('var(--_focus-ring)'));
  must(localRings.length === 0, `a restated ring must read the slot: ${localRings.map(({ value }) => value).join(', ')}`);
  return `0 colour literals, 0 !important, ${rings.length} outline declaration(s)`;
});

await check('the geometry derives from the tokens: the slide is the shadow offset, and nothing is a number', () => {
  for (const { selector, property, value } of DERIVED) {
    const rule = rules.find((candidate) => candidate.selector === selector);
    must(rule, `no rule with the selector ${JSON.stringify(selector)} — the switch has no shape`);
    const declared = new Map(declarations(rule.body));
    must(
      declared.get(property) === value,
      `${selector} { ${property} } must be ${JSON.stringify(value)} (derived from --bn-* / --_switch-*), ` +
        `found ${JSON.stringify(declared.get(property))}`,
    );
  }
  must(
    derivedChain('--_switch-travel'),
    'the travel must be a calc() over --bn-shadow-x: the thumb slides by the same offset its shadow is drawn with',
  );
  must(
    /--bn-shadow-sm:\s*calc\(var\(--bn-shadow-x\) \/ 2\)/.test(rawArtifact),
    `${ARTIFACT} does not derive --bn-shadow-sm from --bn-shadow-x — the thumb's shadow would not share the slide's source`,
  );
  const displacement = allDeclarations.filter(({ property }) => property === 'translate' || property === 'transform');
  must(displacement.length > 0, 'nothing is displaced — the thumb could not slide');
  const literals = displacement
    .filter(({ value }) => DIMENSION_LITERAL.test(value))
    .map(({ selector, property, value }) => `${selector} { ${property}: ${value} }`);
  must(
    literals.length === 0,
    `a displacement must read a token, never a distance (spec §3 invariant 3): ${literals.join('; ')}`,
  );
  const shadows = allDeclarations.filter(({ property }) => property === 'box-shadow');
  must(shadows.length > 0, 'the thumb paints no shadow at all');
  const badShadows = shadows.filter(({ value }) => DIMENSION_LITERAL.test(value) || !/^var\(--(?:bn|_)/.test(value));
  must(
    badShadows.length === 0,
    `a shadow must be a tier token (ADR-0003): ${badShadows.map(({ value }) => value).join('; ')}`,
  );
  return `${displacement.length} displacement(s) and ${shadows.length} shadow, all token-derived; travel = 3 × --bn-shadow-x`;
});

/** True when the value of `--_switch-travel` (or any slot) is a calc() over `--bn-shadow-x`. */
function derivedChain(slot) {
  const declaration = allDeclarations.find(({ property }) => property === slot);
  if (!declaration) return false;
  return /^calc\(var\(--bn-shadow-x\) \* \d+\)$/.test(declaration.value);
}

await check('a state rule may repaint and slide, never resize the box (spec §3 invariant 7)', () => {
  const stateRules = rules.filter((rule) => STATE_SELECTOR.test(rule.selector));
  must(stateRules.length > 0, 'the switch has no state rule — it could not tell on from off');
  const offenders = [];
  for (const rule of stateRules) {
    for (const [property, value] of declarations(rule.body)) {
      if (property.startsWith('--_')) continue; // a slot is the geometry channel, not a box metric
      if (BOX_METRIC.test(property) || (!STATE_PROPERTIES.has(property) && !property.startsWith('--bn-'))) {
        offenders.push(`${rule.selector} { ${property}: ${value} }`);
      }
    }
  }
  must(
    offenders.length === 0,
    `a state may only repaint and slide — a border that grows on hover or on toggle reflows the grid:\n  ${offenders.join('\n  ')}`,
  );
  const checked = stateRules.filter((rule) => /:checked\b/.test(rule.selector));
  must(checked.length > 0, 'no `:checked` rule exists — on and off would look the same');
  const painted = checked.flatMap((rule) => declarations(rule.body).map(([property]) => property));
  must(painted.includes('background'), 'the checked state never repaints the channel');
  must(
    checked.some((rule) => rule.selector.includes('::before') && /translate/.test(rule.body)),
    'the checked state never moves the thumb',
  );
  return `${stateRules.length} state rule(s): ${[...new Set(stateRules.flatMap((rule) => declarations(rule.body).map(([p]) => p)))].join(', ')}`;
});

await check('motion is declared inside @media (prefers-reduced-motion: no-preference) only', () => {
  const motionRules = rules.filter((rule) =>
    declarations(rule.body).some(([property]) => property === 'transition' || property.startsWith('transition-')),
  );
  must(motionRules.length > 0, 'the thumb slides with no transition at all — the movement would snap');
  const outside = motionRules.filter((rule) => !rule.conditions.some((condition) => MOTION_GUARD.test(condition)));
  must(
    outside.length === 0,
    `transition declared outside the no-preference block: ${outside.map((rule) => rule.selector).join(', ')}`,
  );
  must(
    !/prefers-reduced-motion:\s*reduce/.test(source),
    'a reduce block that switches motion off afterwards is the rejected form (spec §7)',
  );
  const animations = allDeclarations.filter(({ property }) => property === 'animation' || property.startsWith('animation-'));
  must(animations.length === 0, 'form.css declares an animation; a switch has only a transition to guard');
  const slides = allDeclarations
    .filter(({ property }) => property === 'transition')
    .filter(({ value }) => /var\(--_motion\)/.test(value));
  must(slides.length > 0, 'the transition is not timed by --_motion — the duration would be a number of its own');
  return `${motionRules.length} guarded transition rule(s), timed by --_motion, 0 reduce blocks`;
});

await check('the built artifact carries the switch inside @layer components', () => {
  must(rawArtifact.includes('/* src/css/form.css (@layer components) */'), `${ARTIFACT} has no form.css block — run npm run build`);
  const start = rawArtifact.indexOf('/* src/css/form.css');
  const end = rawArtifact.indexOf('/* src/css/table.css');
  must(end > start, `${ARTIFACT} lost the block after form.css — run npm run build`);
  const block = rawArtifact.slice(start, end);
  for (const needle of [
    'input[role="switch"]',
    '--_switch-travel: calc(var(--bn-shadow-x) * 3)',
    'inline-size: calc(var(--_switch-h) + var(--_switch-travel))',
    'translate: var(--_switch-travel)',
  ]) {
    must(block.includes(needle), `${ARTIFACT} form.css block is missing ${JSON.stringify(needle)}`);
  }
  must(/\[role="?switch"?\]/.test(rawArtifactMin), `${ARTIFACT_MIN} carries no switch selector — run npm run build`);
  return `${block.split('\n').length} lines of form.css in ${ARTIFACT}; the minified artifact keeps the anchor`;
});

/**
 * The text a built page's first seite code fence carries. seite paints the fence with one `<span>`
 * per token, so the only honest way to read it back is to strip the markup and decode the entities —
 * which is exactly what the demo layer does before it renders the preview.
 */
function firstFenceText(html) {
  const open = html.indexOf('<pre style="background-color:#2b303b');
  if (open === -1) return '';
  const close = html.indexOf('</pre>', open);
  const block = html.slice(open, close === -1 ? html.length : close);
  return block
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

await check('the docs page will render: seite build + the collection lists it', () => {
  if (process.argv.includes('--no-docs')) return 'skipped (--no-docs)';
  const seite = locateSeite();
  must(seite, 'the seite CLI was not found (set SEITE_BIN) — the built page cannot be checked');
  const result = runSeite(seite, ['build', '--dir', ROOT]);
  must(result.status === 0, `seite build exited ${result.status}:\n${result.output}`);
  must(fs.existsSync(abs(DOC_HTML)), `${DOC_HTML} was not built`);
  const html = read(DOC_HTML);
  must(/class="site-prose"/.test(html), `${DOC_HTML} lost its .site-prose body wrapper`);
  const fence = firstFenceText(html);
  must(fence.length > 0, `${DOC_HTML} has no raw seite fence — the demo layer would have nothing to render`);
  must(/<input\b[^>]*type="checkbox"/.test(fence), `${DOC_HTML} does not carry the example as escaped text`);
  must(/<input\b[^>]*role="switch"/.test(fence), `${DOC_HTML} does not carry the switch's role as escaped text`);
  const h2s = [...html.matchAll(/<h2\b[^>]*>/g)];
  must(h2s.length === 1 && /data-site-heading=/.test(h2s[0][0]), `${DOC_HTML} must render exactly the template's one H2`);
  const index = read(DOC_INDEX);
  must(
    /href="[^"]*\/components\/switch"/.test(index),
    `${DOC_INDEX} does not link to /components/switch — the collection did not list the page`,
  );
  return `${seite.version}: build clean, the fence is raw, the index links /components/switch`;
});

/* ================================ the built documentation page ============================= */

/** seite is not on PATH on this machine (spec §12): probe the documented locations. */
function locateSeite() {
  for (const candidate of [process.env.SEITE_BIN, 'D:\\sdk\\seite\\seite.exe', 'seite'].filter(Boolean)) {
    const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
    if (probe.status === 0) return { bin: candidate, version: (probe.stdout ?? '').trim() };
  }
  return null;
}

function runSeite(seite, args) {
  const result = spawnSync(seite.bin, args, {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120_000,
    env: { ...process.env, SEITE_YES: '1' },
  });
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() };
}

/* =================================== browser checks =================================== */

const BROWSER_CHECKS = [
  [
    'verification: a switch is dressed — a 3px square channel, a thumb and the small tier',
    async (browser, server) =>
      withPage(browser, server.fixture, {}, async (page) => {
        const off = await readSwitch(page, '#switch');
        must(off.found, '#switch is missing from the fixture');
        must(off.display === 'inline-block', `the switch must be an inline block, read ${off.display}`);
        must(off.borderTopStyle === 'solid', `the channel must be drawn, read ${off.borderTopStyle}`);
        must(off.borderTopWidth === SWITCH.border, `the border must be ${SWITCH.border}, read ${off.borderTopWidth}`);
        must(off.borderRadius === SWITCH.radius, `square corners are the point (spec §6.1), read ${off.borderRadius}`);
        must(off.boxWidth === SWITCH.width && off.boxHeight === SWITCH.height, `the box must be ${SWITCH.width}×${SWITCH.height}, read ${off.boxWidth}×${off.boxHeight}`);
        must(off.background === COLOR.paper, `an off switch shows the page's own ground, read ${off.background}`);
        must(off.cursor === 'pointer', `the channel must look pressable, read ${off.cursor}`);
        must(off.thumb.content === '""', `the thumb is not generated (::before content ${off.thumb.content})`);
        must(
          off.thumb.width === SWITCH.thumb && off.thumb.height === SWITCH.thumb,
          `the thumb must be ${SWITCH.thumb}px square, read ${off.thumb.width}×${off.thumb.height}`,
        );
        must(off.thumb.background === COLOR.ink, `the thumb is the page's ink, read ${off.thumb.background}`);
        must(off.thumb.boxShadow === THUMB_SHADOW_SM, `the thumb must take the sm tier, read ${off.thumb.boxShadow}`);
        must(off.thumb.translateX === 0, `an off switch's thumb sits at rest, read translate ${off.thumb.translateX}`);
        must(
          off.thumb.gap === SWITCH.gap && off.thumb.left === SWITCH.gap,
          `the thumb must sit ${SWITCH.gap}px inside the channel, read gap ${off.thumb.gap} / left ${off.thumb.left}`,
        );
        must(
          channelTravel(off) === SWITCH.travel,
          `the channel must leave exactly ${SWITCH.travel}px of travel, read ${channelTravel(off)}px ` +
            `(content ${off.contentWidth}, thumb ${off.thumb.width}, gaps ${off.thumb.gap})`,
        );
        return `${SWITCH.width}×${SWITCH.height} channel, ${SWITCH.thumb}px thumb, ${THUMB_SHADOW_SM}, travel ${SWITCH.travel}px`;
      }),
  ],
  [
    'verification: on and off are visually distinguishable, and a toggle moves nothing but the paint',
    async (browser, server) =>
      withPage(browser, server.fixture, {}, async (page) => {
        const off = await readSwitch(page, '#switch');
        await page.click('#switch');
        const on = await readSwitch(page, '#switch');
        must(on.checked === true, 'the click did not check the switch — the native state is gone');
        must(on.background === COLOR.main, `an on switch fills its channel with --bn-main, read ${on.background}`);
        must(
          on.background !== off.background || on.thumb.translateX !== off.thumb.translateX,
          'nothing changed between on and off — the two states look identical',
        );
        must(
          on.thumb.translateX === SWITCH.travel,
          `the thumb must travel exactly ${SWITCH.travel}px (three shadow offsets), read ${on.thumb.translateX}`,
        );
        must(
          on.thumb.left === SWITCH.gap + SWITCH.travel && on.thumb.right === SWITCH.gap,
          `the thumb must end ${SWITCH.gap}px from the far edge, read left ${on.thumb.left} / right ${on.thumb.right}`,
        );
        must(
          on.thumb.translateX === channelTravel(on),
          `the slide must spend the travel the channel has: ${on.thumb.translateX}px moved, ${channelTravel(on)}px available`,
        );
        must(
          on.thumb.background === COLOR.ink,
          `the thumb sits on a saturated fill, so it keeps the accent's ink in both themes, read ${on.thumb.background}`,
        );
        return `off ${off.background} → on ${on.background}; thumb 0 → ${on.thumb.translateX}px, gaps ${off.thumb.gap}/${off.thumb.right} → ${on.thumb.left}/${on.thumb.right}`;
      }),
  ],
  [
    'verification 2: a toggle does not change a border width or the box — measured either side',
    async (browser, server) =>
      withPage(browser, server.fixture, {}, async (page) => {
        const before = await readSwitch(page, '#switch-on');
        must(
          before.borderTopWidth === SWITCH.border,
          `the measured control is not dressed (${before.borderTopWidth}) — the widths below would compare a native widget`,
        );
        await page.click('#switch-on');
        const after = await readSwitch(page, '#switch-on');
        for (const property of ['borderTopWidth', 'borderLeftWidth', 'borderRightWidth', 'borderBottomWidth']) {
          must(
            before[property] === after[property],
            `${property} changed on toggle: ${before[property]} → ${after[property]} (spec §3 invariant 7)`,
          );
        }
        must(
          before.boxWidth === after.boxWidth && before.boxHeight === after.boxHeight,
          `the box changed size on toggle: ${before.boxWidth}×${before.boxHeight} → ${after.boxWidth}×${after.boxHeight}`,
        );
        must(
          before.contentWidth === after.contentWidth && before.inlineSize === after.inlineSize,
          `the content box changed on toggle: ${before.contentWidth} → ${after.contentWidth}`,
        );
        // A plain checkbox on the same page keeps the browser's own widget: the role is the anchor,
        // and nothing else is dressed by this file.
        const plain = await readStyles(page, '#plain', ['appearance']);
        must(plain.appearance === 'auto' || plain.appearance === 'checkbox', `a plain checkbox must stay native, read appearance ${plain.appearance}`);
        return `borders ${before.borderTopWidth}/${before.borderLeftWidth}/${before.borderRightWidth}/${before.borderBottomWidth} on and off; box ${before.boxWidth}×${before.boxHeight} unchanged; an unroled checkbox stays ${plain.appearance}`;
      }),
  ],
  [
    'verification 1 + 3: Tab reaches the switch, the ring is a 3px outline at a 3px offset, Space flips it',
    async (browser, server) =>
      withPage(browser, server.fixture, {}, async (page) => {
        await page.evaluate(() => document.activeElement?.blur?.());
        await page.keyboard.press('Tab');
        const focused = await page.evaluate(() => {
          const el = document.activeElement;
          return {
            id: el?.id ?? '',
            focusVisible: el?.matches?.(':focus-visible') ?? false,
            tag: el?.tagName ?? '<none>',
          };
        });
        must(focused.id === 'switch', `the first Tab must reach the switch, activeElement is ${focused.tag}#${focused.id}`);
        must(focused.focusVisible === true, 'the switch must match :focus-visible after a real Tab');
        const ring = await readSwitch(page, '#switch');
        must(ring.outlineStyle === 'solid', `the focus ring must be drawn, read outline-style ${ring.outlineStyle}`);
        must(ring.outlineWidth === '3px', `the ring must be 3px, read ${ring.outlineWidth}`);
        must(ring.outlineColor === COLOR.ring, `the ring must be --bn-ring, read ${ring.outlineColor}`);
        must(ring.outlineOffset === '3px', `the ring must stand 3px off the thick border, read ${ring.outlineOffset}`);
        const before = ring.checked;
        await page.keyboard.press('Space');
        const after = await readSwitch(page, '#switch');
        must(after.checked === !before, `Space must toggle the switch: ${before} → ${after.checked}`);
        must(
          after.thumb.translateX === (after.checked ? SWITCH.travel : 0),
          `the visual state must follow :checked after Space, read translate ${after.thumb.translateX}`,
        );
        must(after.focusVisible === true, 'the switch lost its focus indicator after Space');
        await page.keyboard.press('Space');
        const back = await readSwitch(page, '#switch');
        must(back.checked === before, `a second Space must toggle back: ${before} → ${back.checked}`);
        return `Tab → #switch, outline solid 3px ${COLOR.ring} at ${ring.outlineOffset}; Space ${before} → ${after.checked} → ${back.checked}`;
      }),
  ],
  [
    'verification 3: with JavaScript disabled the switch still toggles, and still does not resize',
    async (browser, server) =>
      withPage(browser, server.fixture, { javaScriptEnabled: false }, async (page) => {
        const scripts = await page.evaluate(() => document.querySelectorAll('script').length);
        must(scripts === 0, `the fixture must not load a script, found ${scripts}`);
        const before = await readSwitch(page, '#switch-bare');
        must(before.checked === false, 'the fixture switch must start off');
        await page.click('#switch-bare');
        // Park the pointer away from the control: the switch answers a hover with a colour wash, and
        // this check is about the resting state the mouse is not standing on.
        await page.mouse.move(1279, 899);
        // No init script can freeze a no-JavaScript page, so the state is waited for, not slept past.
        const after = await settledSwitch(
          page,
          '#switch-bare',
          (snapshot) => snapshot.checked && snapshot.background === COLOR.main && snapshot.thumb.translateX === SWITCH.travel,
        );
        must(after.checked === true, 'with no script the click did not toggle the switch — the state must be native');
        must(after.background === COLOR.main, `the on state must be painted with no script, read ${after.background}`);
        must(after.thumb.translateX === SWITCH.travel, `the thumb must move with no script, read ${after.thumb.translateX}`);
        must(
          before.borderTopWidth === after.borderTopWidth && before.borderLeftWidth === after.borderLeftWidth,
          `the border changed with no script: ${before.borderTopWidth}/${before.borderLeftWidth} → ${after.borderTopWidth}/${after.borderLeftWidth}`,
        );
        await page.click('#switch-bare');
        await page.mouse.move(1279, 899);
        const back = await settledSwitch(
          page,
          '#switch-bare',
          (snapshot) => !snapshot.checked && snapshot.background === COLOR.paper && snapshot.thumb.translateX === 0,
        );
        must(back.checked === false && back.background === COLOR.paper, 'a second click must switch it off with no script');
        must(back.thumb.translateX === 0, `a scriptless second click must put the thumb back, read ${back.thumb.translateX}`);
        return `no-script click ${before.checked} → ${after.checked} → ${back.checked}; ${after.borderTopWidth} borders unchanged on both sides`;
      }),
  ],
  [
    'the slide and the shadow share one token: overriding --bn-shadow-x moves both, and the box with them',
    async (browser, server) =>
      withPage(browser, server.fixture, {}, async (page) => {
        const before = await readSwitch(page, '#switch');
        must(before.thumb.boxShadow === THUMB_SHADOW_SM, `the thumb starts on the sm tier, read ${before.thumb.boxShadow}`);
        await page.evaluate(() => {
          document.documentElement.style.setProperty('--bn-shadow-x', '8px');
          document.documentElement.style.setProperty('--bn-shadow-y', '8px');
        });
        const scaled = await readSwitch(page, '#switch');
        must(
          scaled.thumb.width === SWITCH.thumb,
          `the thumb is not a shadow offset, so it must not grow: read ${scaled.thumb.width}`,
        );
        must(
          scaled.boxWidth === SWITCH.scaledWidth && scaled.contentWidth === SWITCH.scaledContent,
          `the channel must widen with the travel (${SWITCH.scaledWidth}×${SWITCH.scaledContent}), read ${scaled.boxWidth}×${scaled.contentWidth}`,
        );
        must(
          channelTravel(scaled) === SWITCH.scaledTravel,
          `the travel must scale with the token: expected ${SWITCH.scaledTravel}px, read ${channelTravel(scaled)}px`,
        );
        must(
          scaled.thumb.boxShadow === SWITCH.scaledShadow,
          `the thumb's shadow must scale with the same token, read ${scaled.thumb.boxShadow}`,
        );
        await page.click('#switch');
        const on = await readSwitch(page, '#switch');
        must(
          on.thumb.translateX === SWITCH.scaledTravel,
          `the slide must equal the scaled travel (${SWITCH.scaledTravel}px), read ${on.thumb.translateX}`,
        );
        must(
          on.thumb.left === SWITCH.gap + SWITCH.scaledTravel && on.thumb.right === SWITCH.gap,
          `the thumb must still land ${SWITCH.gap}px from the far edge, read left ${on.thumb.left} / right ${on.thumb.right}`,
        );
        return `--bn-shadow-x: 8px → shadow ${scaled.thumb.boxShadow}, travel ${channelTravel(scaled)}px, box ${scaled.boxWidth}px, slide ${on.thumb.translateX}px`;
      }),
  ],
  [
    'verification 1: the dark theme flips the channel and the thumb without touching the geometry',
    async (browser, server) =>
      withPage(browser, server.fixture, {}, async (page) => {
        await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
        const off = await readSwitch(page, '#switch');
        must(off.background === COLOR.darkPaper, `a dark off switch sits on the page's dark ground, read ${off.background}`);
        must(off.borderTopColor === COLOR.darkInk, `the dark channel is drawn in the light ink, read ${off.borderTopColor}`);
        must(off.thumb.background === COLOR.darkInk, `the dark thumb is the light ink, read ${off.thumb.background}`);
        must(off.thumb.boxShadow === 'rgb(255, 253, 245) 2px 2px 0px 0px', `the dark thumb's shadow must flip white, read ${off.thumb.boxShadow}`);
        await page.click('#switch');
        const on = await readSwitch(page, '#switch');
        must(on.background === COLOR.main, `the on channel keeps --bn-main in the dark theme, read ${on.background}`);
        must(on.thumb.background === COLOR.ink, `the thumb on a saturated fill stays black in both themes, read ${on.thumb.background}`);
        must(
          on.borderTopWidth === SWITCH.border && on.boxWidth === SWITCH.width,
          `the dark theme must not change the geometry: ${on.borderTopWidth}/${on.boxWidth}`,
        );
        return `dark: channel ${off.background}, thumb ${off.thumb.background} → ${on.thumb.background} on ${on.background}, box unchanged`;
      }),
  ],
  [
    'the motion guard: the slide is animated only where the visitor accepts motion',
    async (browser, server) => {
      const animated = await withPage(browser, server.fixture, { freeze: false }, async (page) => {
        const matches = await page.evaluate(() => matchMedia('(prefers-reduced-motion: no-preference)').matches);
        must(matches === true, 'the default context does not report prefers-reduced-motion: no-preference');
        const snapshot = await readSwitch(page, '#switch');
        const durations = String(snapshot.thumb.transitionDuration)
          .split(',')
          .map((value) => value.trim());
        must(
          durations.every((duration) => duration === '0.15s'),
          `with motion allowed the thumb must transition for --bn-transition (0.15s) per property, read ${snapshot.thumb.transitionDuration}`,
        );
        must(
          /translate/.test(snapshot.thumb.transitionProperty),
          `the transition must cover the slide, read ${snapshot.thumb.transitionProperty}`,
        );
        must(
          String(snapshot.transitionDuration).split(',').every((duration) => duration.trim() === '0.15s'),
          `the channel's fill must cross-fade with the same duration, read ${snapshot.transitionDuration}`,
        );
        return `${snapshot.thumb.transitionProperty} ${snapshot.thumb.transitionDuration}`;
      });
      const reduced = await withPage(browser, server.fixture, { freeze: false, reducedMotion: 'reduce' }, async (page) => {
        const matches = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
        must(matches === true, 'the reducedMotion: reduce context did not reach the page');
        const snapshot = await readSwitch(page, '#switch');
        const durations = String(snapshot.thumb.transitionDuration)
          .split(',')
          .map((value) => value.trim());
        must(
          durations.every((duration) => duration === '0s'),
          `with reduced motion no transition may be declared, read ${snapshot.thumb.transitionDuration}`,
        );
        await page.click('#switch');
        const on = await readSwitch(page, '#switch');
        must(
          on.checked === true && on.thumb.translateX === SWITCH.travel,
          `with reduced motion the switch must still toggle and move, read ${on.checked}/${on.thumb.translateX}`,
        );
        return `reduced: no transition, still toggles to ${on.thumb.translateX}px`;
      });
      return `no-preference: ${animated}; reduce: ${reduced}`;
    },
  ],
  [
    'the documentation page: the example switch really toggles, with no help from a library script',
    async (browser, server) => {
      if (process.argv.includes('--no-docs') || !fs.existsSync(abs(DOC_HTML))) {
        skips += 1;
        return 'skipped (--no-docs or no dist/)';
      }
      return withPage(browser, server.docs, { githubPages: true }, async (page, issues) => {
        await page.waitForSelector('[data-site-demo] .site-demo__panel--preview input[role="switch"]', { timeout: 10_000 });
        const pick = await page.evaluate(() => {
          const preview = document.querySelector('[data-site-demo] .site-demo__panel--preview');
          const switches = [...preview.querySelectorAll('input[role="switch"]')];
          return { count: switches.length, id: switches[0]?.id ?? '' };
        });
        must(pick.count > 0, 'the preview panel carries no switch — the demo layer did not render the fence');
        const target = pick.id ? `#${pick.id}` : '[data-site-demo] .site-demo__panel--preview input[role="switch"]';
        const before = await readSwitch(page, target);
        await page.click(target);
        const after = await readSwitch(page, target);
        must(after.checked === !before.checked, `the documented switch did not toggle: ${before.checked} → ${after.checked}`);
        must(
          after.background === COLOR.main,
          `the documented switch must show the on state, read ${after.background}`,
        );
        must(
          after.thumb.translateX === SWITCH.travel,
          `the documented switch must slide, read ${after.thumb.translateX}`,
        );
        must(issues.pageErrors.length === 0, `page errors: ${issues.pageErrors.join(' | ')}`);
        return `${pick.count} switch(es) in the preview, ${before.checked} → ${after.checked}, thumb ${before.thumb.translateX} → ${after.thumb.translateX}`;
      });
    },
  ],
];

/** Browser checks need playwright-core; without it they skip loudly, as the other verifiers do. */
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
