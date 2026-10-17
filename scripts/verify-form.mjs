#!/usr/bin/env node
/**
 * Scripted verification for ticket 12 — Form.
 *
 * The four verification methods in `.scratch/barnacle-design/issues/12-form.md` are the
 * specification of this file, and every checklist bullet of the ticket is a check below:
 *
 *   1. no control wears an error state before the user has interacted with it
 *   2. typing an illegal value and blurring turns the error state on, per control class
 *   3. border widths are identical before and after validation, and before and after focus
 *   4. a real Tab reaches every control and paints the library's ring
 *   plus the measurement the ticket asks for: `:user-invalid` support in the target browser.
 *
 * The expected values are the independent source of truth: spec.md §3 (invariants), §5 (the file
 * granularity — `switch` lives in `form.css`), §6.1/§6.2 (tokens), §7 (the interaction and motion
 * contract), §8 (Form's anchor is the bare elements), §10 (a component page has no authored H2),
 * ADR-0001 (the element is the anchor), ADR-0003 (shadow tiers), ADR-0005 (`--bn-*` / `--_*` only),
 * ADR-0006 (the layer contract) and `D:\code\barnacle-notes\orchestrator-decisions.md` §1 (the
 * meaning axis is `data-variant`), §4 (geometry has one source) and §13 (state rules stay in the
 * component file). They are never recomputed from `src/css/form.css`.
 *
 * Three properties of the browser half are deliberate:
 *
 *   - the measurements come from `static/barnacle.css`, the shipped bytes, served from `static/`
 *     only, so a green run cannot be measuring a source file the browser never loaded;
 *   - every value is read with `transition` and `animation` frozen (a mid-transition read lies
 *     convincingly — browser-harness-findings §3.3);
 *   - the "no error at load" check compares each under-filled control against a *valid twin of the
 *     same type* rather than against a remembered colour, so the baseline is the legal state of the
 *     same control and cannot drift from the theme.
 *
 * The error state is reached the way a user reaches it — `fill`, `selectOption`, `click`, then a
 * real `Tab` — never by dispatching a synthetic event or by writing `aria-invalid` on the controls
 * under test. The author-marked path (`[aria-invalid="true"]`, `[data-variant="danger"]`) has its
 * own pair of controls, because that is a different promise: it is the server-side verdict, and it
 * is allowed to paint without any interaction at all.
 *
 * Run with: npm run verify:form   (or: node scripts/verify-form.mjs)
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
const DOC_PAGE = 'content/components/form.md';
const DOC_HTML = 'dist/components/form.html';
const DOC_INDEX = 'dist/components/index.html';

/**
 * spec §6.1/§6.2 — the values the harness measures against, in Chrome's serialisation. A text field
 * is 1rem/1.5 with 8px 12px padding and a 3px frame: 24 + 16 + 6 = 46px tall, and its floor is the
 * button's 2.5rem. The boxes are 1.25rem square with the same frame.
 */
const FORM = {
  border: '3px',
  radius: '0px',
  ringRadius: '50%',
  fontSize: '16px',
  lineHeight: '24px',
  fieldHeight: 46,
  textareaMin: 96,
  boxSize: 20,
  markCell: 9.1,
  padding: '8px 12px',
  fieldsetPadding: '16px',
  labelGap: '6px',
  labelLead: '12px',
};

const COLOR = {
  paper: 'rgb(255, 253, 245)',
  secondary: 'rgb(255, 255, 255)',
  ink: 'rgb(0, 0, 0)',
  main: 'rgb(255, 210, 63)',
  danger: 'rgb(255, 107, 107)',
  ring: 'rgb(116, 185, 255)',
  darkPaper: 'rgb(26, 26, 26)',
  darkSecondary: 'rgb(38, 38, 38)',
  darkInk: 'rgb(255, 253, 245)',
  transparent: 'rgba(0, 0, 0, 0)',
};

/** The resting and hover tiers of the fourty (ADR-0003: a field rests at sm, a button at md). */
const SM = 'rgb(0, 0, 0) 2px 2px 0px 0px';
const MD = 'rgb(0, 0, 0) 4px 4px 0px 0px';

/**
 * The wash the error state puts on the surface: 10% of --bn-danger over the page's secondary
 * surface. Computed here from the spec §6.1 tokens, independently of the stylesheet, and compared
 * with a tolerance because Chrome serialises a `color-mix()` result in its own colour space.
 */
const ERROR_WASH = [255, 240.2, 240.2];

/** ADR-0005: the two namespaces, and nothing else. */
const PUBLIC_TOKEN = /^--bn-[a-z0-9-]+$/;
const INTERNAL_SLOT = /^--_[a-z0-9-]+$/;

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

/**
 * orchestrator-decisions §4 — the sixteen slots `00-base.css` declares. This file may re-point them
 * and may not add one of its own: ticket 11's own assertion fixes the `--_` vocabulary of form.css
 * to these sixteen plus the switch's four locals, and this script would otherwise be the only place
 * that noticed a new one appearing.
 */
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

/** Ticket 11's four local lengths, which the switch declares and nobody else may re-use. */
const SWITCH_SLOTS = new Set(['--_switch-h', '--_switch-gap', '--_switch-travel', '--_switch-thumb']);

/** spec §3 invariant 7 — a state may repaint a border, never resize it. */
const BOX_METRIC =
  /^(?:border|border-width|border-style|border-block-start|border-inline-start|border-(?:top|right|bottom|left)(?:-(?:width|style))?|padding|padding-\w+|margin|margin-\w+|inline-size|block-size|width|height|min-inline-size|max-inline-size|min-block-size|max-block-size|font-size|font-weight|line-height|box-sizing)$/;

/** The properties a validation rule may spend: paint, and nothing that could reflow the grid. */
const PAINT_ONLY = new Set(['border-color', 'background-color', 'background', 'color', 'outline-color']);

/** A dimension literal — the thing a token has to replace in a displacement or a shadow. */
const DIMENSION_LITERAL = /(?:^|[\s(,*/+-])(?:\d*\.)?\d+(?:px|rem|em|%|vw|vh|vmin|vmax|ch|ex|pt|pc|in|cm|mm|q)\b/i;

/** Hardcoded colour forms ADR-0005 keeps in 01-theme.css only. */
const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch|oklab|lch|lab|color)\(/;

/** A fence info string must stay a bare language token (the demo layer's contract). */
const ALLOWED_FENCE_INFO =
  /^(?:html|css|js|javascript|json|xml|svg|text|txt|markdown|md|powershell|ps1|sh|bash|shell|console|diff)?$/;

/** The section map the file must keep: ticket 11's switch first, then the four form sections. */
const SECTIONS = [
  { number: 2, marker: '2. Text-like controls' },
  { number: 3, marker: '3. checkbox / radio' },
  { number: 4, marker: '4. fieldset / legend / label' },
  { number: 5, marker: '5. Validation' },
];

/**
 * The controls the fixture walks, in document order. Hardcoded on purpose: this is the order the
 * fixture is authored in, not a list read back from the DOM, so a control that silently stops
 * being reachable makes the check fail instead of quietly shrinking the walk.
 * `#f-name-disabled` is in the fixture and absent here: a disabled control must not be reachable.
 */
const TAB_ORDER = [
  'f-email',
  'f-email-ok',
  'f-name',
  'f-name-ok',
  'f-plan',
  'f-plan-ok',
  'f-note',
  'f-note-ok',
  'f-accept',
  'f-accept-ok',
  'f-radio',
  'f-radio-ok',
  'f-switch',
  'f-switch-ok',
  'f-aria',
  'f-variant',
];

/**
 * The pairs the "no error before interaction" check compares: (under-filled, legal twin, label,
 * the properties that must agree). A box's fill is *not* one of them: a checked box is legitimately
 * yellow, which is the state the twin is in, not an error. Every paint an error state could touch —
 * the four border colours, the shadow, and the outline's colour — is compared for every control.
 */
const PAINT_PROPERTIES = [
  'borderTopColor',
  'borderRightColor',
  'borderBottomColor',
  'borderLeftColor',
  'boxShadow',
  'outlineColor',
];
const TWINS = [
  ['#f-email', '#f-email-ok', 'input[type="email"]', [...PAINT_PROPERTIES, 'background', 'color']],
  ['#f-name', '#f-name-ok', 'input[type="text"]', [...PAINT_PROPERTIES, 'background', 'color']],
  ['#f-plan', '#f-plan-ok', 'select', [...PAINT_PROPERTIES, 'background', 'color']],
  ['#f-note', '#f-note-ok', 'textarea', [...PAINT_PROPERTIES, 'background', 'color']],
  ['#f-accept', '#f-accept-ok', 'input[type="checkbox"]', PAINT_PROPERTIES],
  ['#f-radio', '#f-radio-ok', 'input[type="radio"]', PAINT_PROPERTIES],
  ['#f-switch', '#f-switch-ok', 'input[role="switch"]', PAINT_PROPERTIES],
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

/* --------------------------------- CSS source reading --------------------------------- */

const read = (rel) => fs.readFileSync(abs(rel), 'utf8');

/** Comment bodies become spaces of the same length: prose about a rule is not a rule. */
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

/** Every `selector { body }` rule, flattened out of its at-rule wrappers into `conditions`. */
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
      i = semi + 1;
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

/** `property: value` pairs declared directly in a rule body. */
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

/** A selector list split on top-level commas — the unit a specificity is compared per element. */
function selectorList(selector) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of selector) {
    if (ch === '(' || ch === '[') depth += 1;
    else if (ch === ')' || ch === ']') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** The subject of a complex selector: the last compound, i.e. the element the rule styles. */
function subjectOf(selector) {
  let depth = 0;
  let cut = 0;
  for (let i = 0; i < selector.length; i += 1) {
    const ch = selector[i];
    if (ch === '(' || ch === '[') depth += 1;
    else if (ch === ')' || ch === ']') depth -= 1;
    else if (depth === 0 && (ch === '>' || ch === '+' || ch === '~' || ch === ' ')) {
      const rest = selector.slice(i).trim();
      if (rest && !')[+~>'.includes(rest[0])) cut = i;
    }
  }
  return selector.slice(cut).trim();
}

const ruleBody = (rules, predicate) => rules.find((rule) => predicate(rule.selector));

/* -------------------------------- the documentation page ------------------------------- */

/** Split a content file into frontmatter, prose and fences, the way seite reads it. */
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
 * The measurement page. Every control has a twin in a legal state (a value, a check) except the
 * disabled one and the two author-marked ones, which exist to prove the other half of the contract:
 * a control the server marked `aria-invalid` or `data-variant="danger"` is painted without waiting
 * for an interaction, and a disabled control is never painted and never reachable.
 *
 * There is no `<form>` wrapper: `:user-invalid` is a property of the control, not of a submission,
 * and a page with no form cannot navigate when a stray Enter is pressed.
 */
const FIXTURE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <link rel="icon" href="data:,">
    <title>barnacle form harness</title>
    <link rel="stylesheet" href="/static/barnacle.css">
  </head>
  <body>
    <main>
      <h1 id="neutral">Form harness</h1>

      <fieldset id="f-group">
        <legend id="f-legend">Account</legend>

        <label for="f-email">Email</label>
        <input id="f-email" type="email" required>

        <label for="f-email-ok">Email, filled in</label>
        <input id="f-email-ok" type="email" required value="ada@example.com">

        <label for="f-name">Name</label>
        <input id="f-name" type="text" required>

        <label for="f-name-ok">Name, filled in</label>
        <input id="f-name-ok" type="text" required value="Ada">

        <label for="f-plan">Plan</label>
        <select id="f-plan" required>
          <option value="">Pick one</option>
          <option value="pro">Pro</option>
        </select>

        <label for="f-plan-ok">Plan, chosen</label>
        <select id="f-plan-ok" required>
          <option value="pro">Pro</option>
        </select>

        <label for="f-note">Note</label>
        <textarea id="f-note" required></textarea>

        <label for="f-note-ok">Note, written</label>
        <textarea id="f-note-ok" required>Ready.</textarea>

        <input id="f-name-disabled" type="text" required disabled aria-label="Disabled name">

        <p>
          <input id="f-accept" type="checkbox" required>
          <label for="f-accept">Accept the terms</label>
        </p>
        <p>
          <input id="f-accept-ok" type="checkbox" required checked>
          <label for="f-accept-ok">Accepted</label>
        </p>
        <p>
          <input id="f-radio" type="radio" name="one" required>
          <label for="f-radio">One</label>
        </p>
        <p>
          <input id="f-radio-ok" type="radio" name="two" required checked>
          <label for="f-radio-ok">Two</label>
        </p>
        <p>
          <input id="f-switch" type="checkbox" role="switch" required>
          <label for="f-switch">Notifications</label>
        </p>
        <p>
          <input id="f-switch-ok" type="checkbox" role="switch" required checked>
          <label for="f-switch-ok">Notifications, on</label>
        </p>
      </fieldset>

      <label for="f-aria">Server marked this one</label>
      <input id="f-aria" type="text" aria-invalid="true">

      <label for="f-variant">A danger variant</label>
      <input id="f-variant" type="text" data-variant="danger">
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

/** Serves the in-memory fixture, the published artifact, and the built site under `/docs/`. */
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
    docs: `${origin}/docs/components/form`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** Freezing is registered before `goto`; a read after load is already too late to be honest. */
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

/** One snapshot of a control: its box, its paint, its pseudo-element mark and its validity. */
async function readControl(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { found: false };
    const cs = getComputedStyle(el);
    const mark = getComputedStyle(el, '::before');
    const box = el.getBoundingClientRect();
    const round = (value) => Math.round(Number.parseFloat(value) * 100) / 100;
    return {
      found: true,
      tag: el.tagName,
      id: el.id,
      invalid: el.matches(':invalid'),
      userInvalid: el.matches(':user-invalid'),
      userValid: el.matches(':user-valid'),
      focusVisible: el.matches(':focus-visible'),
      checked: el.checked ?? null,
      disabled: el.disabled ?? null,
      value: String(el.value ?? ''),
      boxWidth: round(box.width),
      boxHeight: round(box.height),
      borderTopWidth: cs.borderTopWidth,
      borderRightWidth: cs.borderRightWidth,
      borderBottomWidth: cs.borderBottomWidth,
      borderLeftWidth: cs.borderLeftWidth,
      borderTopColor: cs.borderTopColor,
      borderRightColor: cs.borderRightColor,
      borderBottomColor: cs.borderBottomColor,
      borderLeftColor: cs.borderLeftColor,
      borderTopLeftRadius: cs.borderTopLeftRadius,
      background: cs.backgroundColor,
      color: cs.color,
      boxShadow: cs.boxShadow,
      outlineStyle: cs.outlineStyle,
      outlineWidth: cs.outlineWidth,
      outlineColor: cs.outlineColor,
      outlineOffset: cs.outlineOffset,
      fontSize: cs.fontSize,
      lineHeight: cs.lineHeight,
      paddingTop: cs.paddingTop,
      paddingInline: `${cs.paddingInlineStart} ${cs.paddingInlineEnd}`,
      appearance: cs.appearance,
      display: cs.display,
      backgroundImage: cs.backgroundImage,
      cursor: cs.cursor,
      opacity: cs.opacity,
      mark: {
        content: mark.content,
        width: round(mark.inlineSize),
        height: round(mark.blockSize),
        background: mark.backgroundColor,
        transform: mark.transform,
        clipPath: mark.clipPath,
        borderRadius: mark.borderTopLeftRadius,
      },
    };
  }, selector);
}

/** Chrome serialises a computed colour as `rgb()`, `rgba()`, or `color(srgb …)` — read all three. */
function parseColor(value) {
  const text = String(value).trim();
  const rgb = text.match(/^rgba?\(([^)]+)\)$/);
  if (rgb) {
    const parts = rgb[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return parts.slice(0, 3);
  }
  const srgb = text.match(/^color\(srgb\s+([^)]+)\)$/);
  if (srgb) {
    const parts = srgb[1].split(/[\s/]+/).filter(Boolean).map(Number);
    return parts.slice(0, 3).map((channel) => channel * 255);
  }
  return null;
}

/** Channel-wise comparison with a tolerance: a `color-mix()` result is not an exact `rgb()`. */
function sameColor(actual, expected, tolerance = 1) {
  const parsed = parseColor(actual);
  if (!parsed) return false;
  return parsed.every((channel, index) => Math.abs(channel - expected[index]) <= tolerance);
}

/**
 * Poll a control until its frame settles, for the context where freezing cannot run: with
 * JavaScript disabled there is no init script, and a mid-transition read returns the value from
 * *before* the blur, which is a very convincing lie (browser-harness-findings §3.3).
 */
async function settledControl(page, selector, expectedBorder, timeout = 3000) {
  const deadline = Date.now() + timeout;
  let last = null;
  while (Date.now() < deadline) {
    last = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      const cs = getComputedStyle(el);
      return {
        userInvalid: el.matches(':user-invalid'),
        border: cs.borderTopColor,
        focusedRing: document.activeElement?.matches?.(':focus-visible') === true,
      };
    }, selector);
    if (last.border === expectedBorder) return last;
    await page.waitForTimeout(25);
  }
  return last;
}

const NEEDS_DETAIL = (label, expected, actual) =>
  `${label}: expected ${JSON.stringify(expected)}, read ${JSON.stringify(actual)}`;

/* ================================ static checks: the page ============================= */

console.log(`barnacle form verification — ${ROOT}\n`);

const rawSource = read(SOURCE);
const source = blankComments(rawSource);
const rules = rulesOf(rawSource);
const allDeclarations = declarationsOf(rules);
const baseRules = rulesOf(read(BASE_SOURCE));

const rawArtifact = read(ARTIFACT);
const rawArtifactMin = fs.existsSync(abs(ARTIFACT_MIN)) ? read(ARTIFACT_MIN) : '';

const docsRaw = fs.existsSync(abs(DOC_PAGE)) ? read(DOC_PAGE) : '';
const docs = dissect(docsRaw);
const demoFences = docs.fences.filter((fence) => fence.text.trim().startsWith('<'));

await check('src/css/form.css is UTF-8 without a BOM, writes no @layer, and keeps its five sections', () => {
  const bytes = fs.readFileSync(abs(SOURCE));
  must(!(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf), 'a BOM breaks the build chain');
  const offenders = rawSource
    .split(/\r?\n/)
    .map((line, index) => [line, index + 1])
    .filter(([line]) => /^\s*@layer\b/.test(line));
  must(offenders.length === 0, `remove @layer from line(s) ${offenders.map(([, n]) => n).join(', ')}`);
  // Ticket 11's section 1 must survive ticket 12 untouched: the switch is the file's first section.
  must(rules.length > 0, 'the file declares no rule at all');
  const switchRule = rules.find((rule) => rule.selector === 'input[role="switch"]');
  must(switchRule, 'the switch rule from ticket 11 is gone — section 1 is not ticket 12\'s to rewrite');
  const declared = new Map(declarations(switchRule.body));
  must(
    declared.get('inline-size') === 'calc(var(--_switch-h) + var(--_switch-travel))' &&
      declared.get('border-width') === 'var(--bn-border-width)',
    'the switch rule lost its own geometry — section 1 was edited',
  );
  const missing = SECTIONS.filter(({ marker }) => !rawSource.includes(marker));
  must(missing.length === 0, `the section map lost ${missing.map(({ marker }) => marker).join(', ')}`);
  return `${rules.length} rules, the switch intact, sections 2-5 present`;
});

await check('no rule dresses a bare `input`, so the switch keeps its own box (handoff from ticket 11)', () => {
  const SCOPE = /:not\((?=[^)]*\[type=)/;
  const offenders = [];
  for (const rule of rules) {
    // A rule that reaches a text field's box must scope the input types away; anything else (the
    // switch's own rules, a cursor-only rule) is out of this check's scope by construction.
    const scopes = selectorList(rule.selector);
    const boxes = declarations(rule.body).filter(([property]) =>
      /^(?:display|inline-size|block-size|padding|padding-\w+|border|border-\w+|background|background-color|box-shadow|font-size|font-family|font-weight|line-height|min-block-size|appearance|box-sizing)$/.test(
        property,
      ),
    );
    if (boxes.length === 0) continue;
    for (const selector of scopes) {
      // Only the element the rule actually styles matters: `:is(input…) + label` styles a label.
      const subject = subjectOf(selector);
      if (!/(?:^|[\s,(>+~])input(?![\w-])/.test(subject)) continue;
      if (/\[role=("|')?switch/.test(subject)) continue; // section 1's own rules
      if (SCOPE.test(subject)) continue;
      offenders.push(`${selector} { ${boxes.map(([property]) => property).join(', ')} }`);
    }
  }
  must(
    offenders.length === 0,
    `a box is declared for a bare input, which would reach the switch: ${offenders.join('; ')}`,
  );
  const scoped = rules.filter((rule) => /input:not\(/.test(rule.selector)).length;
  return `${scoped} scoped rule(s); every unscoped input rule is the switch's own`;
});

await check('the validation state is `:user-invalid` only — never a bare `:invalid`', () => {
  const selectors = rules.map((rule) => rule.selector).join('\n');
  const bare = selectors.match(/(^|[^-\w]):invalid\b/g) ?? [];
  must(
    bare.length === 0,
    `a bare :invalid selector is in the file (${bare.length}×) — it paints every required field red at load`,
  );
  const userInvalid = selectors.match(/:user-invalid\b/g) ?? [];
  must(userInvalid.length >= 3, `:user-invalid must drive the text controls, the boxes and the switch, found ${userInvalid.length}`);
  // The fallback the ticket asks for when a browser lacks the selector: the author-marked half.
  must(/\[aria-invalid="true"\]/.test(selectors), 'no [aria-invalid="true"] rule — a server verdict could not paint');
  return `0 bare :invalid, ${userInvalid.length} :user-invalid selectors, aria-invalid and data-variant present`;
});

await check('the error is semantic (data-variant / aria-invalid), never an appearance class', () => {
  const errorSelectors = rules
    .filter((rule) => /:user-invalid|aria-invalid|data-variant/.test(rule.selector))
    .map((rule) => rule.selector);
  must(errorSelectors.length >= 3, `expected at least three error selectors, found ${errorSelectors.length}`);
  const variants = new Set(
    [...source.matchAll(/\[data-variant="([^"]+)"\]/g)].map((match) => match[1]),
  );
  must(
    [...variants].every((name) => ['danger', 'error', 'success', 'warning'].includes(name)),
    `a data-variant value outside the semantic axis is used on a control: ${[...variants].join(', ')}`,
  );
  must(variants.has('danger') && variants.has('error'), 'the danger/error alias pair is not honoured');
  const classes = [...source.matchAll(/\.bn-[a-z0-9-]+/g)].map((match) => match[0]);
  must(
    classes.length === 0,
    `an error state is carried by a class (${[...new Set(classes)].join(', ')}) — meaning rides data-variant (invariant 4)`,
  );
  return `${errorSelectors.length} semantic error selector(s), variants ${[...variants].join('/')}, 0 bn- classes`;
});

await check('a validation rule may repaint, never resize (spec §3 invariant 7)', () => {
  const validationRules = rules.filter((rule) => /:user-invalid|aria-invalid|data-variant/.test(rule.selector));
  const offenders = [];
  for (const rule of validationRules) {
    for (const [property, value] of declarations(rule.body)) {
      if (property.startsWith('--_')) continue;
      if (BOX_METRIC.test(property) || !PAINT_ONLY.has(property)) {
        offenders.push(`${rule.selector} { ${property}: ${value} }`);
      }
    }
  }
  must(
    offenders.length === 0,
    `a validation state may only paint — a border that grows on error reflows the grid: ${offenders.join('; ')}`,
  );
  const widths = validationRules.flatMap((rule) =>
    declarations(rule.body).filter(([property]) => /width|padding|size/.test(property)),
  );
  must(widths.length === 0, `a validation rule carries a box metric: ${widths.map(([p]) => p).join(', ')}`);
  return `${validationRules.length} validation rule(s), paint only (${[
    ...new Set(validationRules.flatMap((rule) => declarations(rule.body).map(([property]) => property))),
  ].join(', ')})`;
});

await check('the file invents no name and declares no new --_ slot (ADR-0005, orchestrator §4)', () => {
  const customProps = [...new Set([...source.matchAll(/--[\w-]+/g)].map((match) => match[0]))];
  const unknownPublic = customProps.filter((name) => PUBLIC_TOKEN.test(name) && !PUBLIC_TOKENS.has(name));
  must(unknownPublic.length === 0, `unknown public token(s): ${unknownPublic.join(', ')} — spec §6.1 is the vocabulary`);
  const foreign = customProps.filter((name) => !PUBLIC_TOKEN.test(name) && !INTERNAL_SLOT.test(name));
  must(foreign.length === 0, `custom properties outside the two namespaces: ${foreign.join(', ')}`);

  const declared = [...new Set(allDeclarations.map(({ property }) => property).filter((name) => INTERNAL_SLOT.test(name)))];
  const invented = declared.filter((name) => !FROZEN_SLOTS.has(name) && !SWITCH_SLOTS.has(name));
  must(
    invented.length === 0,
    `new internal slot(s): ${invented.join(', ')} — geometry is declared once in 00-base.css, and ticket 11's ` +
      'assertion fixes this file\'s vocabulary',
  );
  const readSlots = [...new Set([...source.matchAll(/var\(\s*(--_[\w-]+)/g)].map((match) => match[1]))];
  const unknownSlots = readSlots.filter((name) => !FROZEN_SLOTS.has(name) && !SWITCH_SLOTS.has(name));
  must(unknownSlots.length === 0, `unknown internal variable(s) read: ${unknownSlots.join(', ')}`);
  return `${declared.length} --_ slot(s) declared (${declared.filter((n) => SWITCH_SLOTS.has(n)).length} the switch's), ${readSlots.length} read`;
});

await check('no colour literal, no forbidden keyword, and the ring is never removed', () => {
  must(!/!\s*important/.test(rawSource), 'the raw file names the forbidden keyword (verify-theme scans the artifact)');
  const offenders = [...source.matchAll(new RegExp(COLOUR_LITERAL.source, 'g'))].map((match) => match[0]);
  must(offenders.length === 0, `hardcoded colour(s): ${[...new Set(offenders)].join(', ')} — 01-theme.css owns every colour`);
  must(!/outline\s*:\s*(?:none|0)\b/.test(source), 'nothing may remove the focus ring (WCAG F78)');
  const rings = allDeclarations.filter(({ property }) => property === 'outline');
  must(rings.length === 0, 'form.css restates the focus ring — the base layer already draws it for every element');
  // The ring must exist where it is measured, and the measured rule is the base layer's.
  const baseRing = baseRules.find((rule) => rule.selector === ':focus-visible');
  must(baseRing, `${BASE_SOURCE} lost the global :focus-visible rule`);
  const ring = new Map(declarations(baseRing.body));
  must(ring.get('outline') === 'var(--_focus-ring)', 'the base ring no longer reads --_focus-ring');
  must(ring.get('outline-offset') === 'var(--_focus-ring-offset)', 'the base ring no longer reads --_focus-ring-offset');
  return '0 colour literals, 0 forbidden keyword, the ring inherited from the base layer';
});

await check('geometry: the frame, the tier and the sizes all read the token system', () => {
  const field = ruleBody(rules, (selector) => /^input:not\(/.test(selector) && !/:hover|:disabled|:is\(:user-invalid/.test(selector));
  must(field, 'the text-control rule was not found');
  const declared = new Map(declarations(field.body));
  const expected = [
    ['border-width', 'var(--bn-border-width)'],
    ['border-radius', 'var(--bn-radius)'],
    ['border-style', 'solid'],
    ['box-shadow', 'var(--_shadow-rest)'],
    ['min-block-size', '2.5rem'],
    ['font-size', '1rem'],
    ['line-height', '1.5'],
    ['inline-size', '100%'],
    ['box-sizing', 'border-box'],
  ];
  for (const [property, value] of expected) {
    must(declared.get(property) === value, `${NEEDS_DETAIL(`the field's ${property}`, value, declared.get(property))}`);
  }
  must(
    declared.get('--_shadow-rest') === 'var(--bn-shadow-sm)',
    'a field rests on the sm tier (ADR-0003), read ' + declared.get('--_shadow-rest'),
  );
  const boxes = ruleBody(rules, (selector) => /^:is\(input\[type="checkbox"\], input\[type="radio"\]\):not/.test(selector) && !/::before|:checked|:disabled|:user-invalid/.test(selector));
  must(boxes, 'the checkbox/radio rule was not found');
  const box = new Map(declarations(boxes.body));
  for (const [property, value] of [
    ['inline-size', '1.25rem'],
    ['block-size', '1.25rem'],
    ['appearance', 'none'],
    ['box-sizing', 'border-box'],
    ['border-width', 'var(--bn-border-width)'],
  ]) {
    must(box.get(property) === value, NEEDS_DETAIL(`the box's ${property}`, value, box.get(property)));
  }
  const group = ruleBody(rules, (selector) => selector === 'fieldset');
  must(group, 'fieldset is not dressed');
  const groupDeclared = new Map(declarations(group.body));
  for (const [property, value] of [
    ['border-width', 'var(--bn-border-width)'],
    ['padding', '1rem'],
    ['box-shadow', 'var(--bn-shadow-sm)'],
    ['min-inline-size', '0'],
  ]) {
    must(groupDeclared.get(property) === value, NEEDS_DETAIL(`the fieldset's ${property}`, value, groupDeclared.get(property)));
  }
  // A displacement or a shadow may never be a number (invariant 3).
  const geometric = allDeclarations.filter(({ property }) => ['transform', 'translate', 'box-shadow'].includes(property));
  const literals = geometric.filter(({ value }) => DIMENSION_LITERAL.test(value));
  must(
    literals.length === 0,
    `a displacement or a shadow is written as a number: ${literals.map(({ value }) => value).join('; ')}`,
  );
  return `the field, the box and the group all read --bn-* / --_; ${geometric.length} geometric declaration(s), 0 literals`;
});

await check('the built artifact carries the form sections inside @layer components', () => {
  must(rawArtifact.includes('/* src/css/form.css (@layer components) */'), `${ARTIFACT} has no form.css block — run npm run build`);
  const start = rawArtifact.indexOf('/* src/css/form.css');
  const end = rawArtifact.indexOf('/* src/css/table.css');
  must(end > start, `${ARTIFACT} lost the block after form.css — run npm run build`);
  const block = rawArtifact.slice(start, end);
  for (const needle of [
    ':user-invalid',
    '[data-variant="danger"]',
    'input[type="radio"]:not(input[role="switch"])',
    'clip-path: polygon(',
    'min-inline-size: 0',
  ]) {
    must(block.includes(needle), `${ARTIFACT} form.css block is missing ${JSON.stringify(needle)}`);
  }
  must(/:user-invalid/.test(rawArtifactMin), `${ARTIFACT_MIN} carries no :user-invalid selector — run npm run build`);
  must(
    /transition:border-color var\(--_motion\),background-color var\(--_motion\)/.test(rawArtifactMin),
    `${ARTIFACT_MIN} lost the field's guarded transition`,
  );
  return `${block.split('\n').length} lines of form.css in ${ARTIFACT}; the minified artifact keeps :user-invalid`;
});

await check(`the Form page exists as a component page (${DOC_PAGE})`, () => {
  must(docsRaw.length > 0, `${DOC_PAGE} is missing`);
  const bytes = fs.readFileSync(abs(DOC_PAGE));
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
  must(badFences.length === 0, `every fence must be a plain language token and terminated: ${badFences.map((f) => f.info).join(', ')}`);
  return `${headings.length} H3 heading(s), ${docs.fences.length} fence(s): ${docs.fences.map((f) => f.info || '<none>').join(', ')}`;
});

await check('the page shows every control class and the validation story in runnable markup', () => {
  must(demoFences.length >= 3, `expected at least three HTML examples, found ${demoFences.length}`);
  const demos = demoFences.map((fence) => fence.text).join('\n');
  for (const needle of [
    'type="email"',
    'type="text"',
    '<select',
    '<textarea',
    'type="checkbox"',
    'type="radio"',
    '<fieldset',
    '<legend',
    '<label',
    'required',
  ]) {
    must(demos.includes(needle), `no example contains ${JSON.stringify(needle)}`);
  }
  must(/:user-invalid|user-invalid/.test(docs.prose), 'the prose never names :user-invalid');
  must(/data-variant/.test(docs.prose), 'the prose never names the meaning axis (data-variant)');
  must(/aria-invalid/.test(docs.prose), 'the prose never names the server-side verdict (aria-invalid)');
  must(
    /no (?:script|JavaScript)|without (?:a )?script/i.test(docs.prose),
    'the page must say the controls need no script',
  );
  const shortcode = docs.prose.match(/\{\{[<%#]/);
  must(!shortcode, `the prose uses seite shortcode syntax (${shortcode?.[0]}) — authors write Markdown only`);
  const rawHtml = withoutInlineCode(docs.prose).match(/<[a-zA-Z][^>]*>/);
  must(!rawHtml, `raw HTML outside a fence: ${rawHtml?.[0]} — the demo layer is the only renderer`);
  const links = [...docsRaw.matchAll(/\]\(([^)\s]+)\)/g)].map((match) => match[1]);
  const trailing = links.filter((href) => href.endsWith('/'));
  must(trailing.length === 0, `a link must not end in "/": ${trailing.join(', ')}`);
  const outside = links.filter((href) => /^https?:/.test(href));
  must(outside.length === 0, `an absolute link would leave the base path: ${outside.join(', ')}`);
  const lead = docs.prose.split('\n').find((line) => line.trim() && !line.startsWith('>')) ?? '';
  must(
    /`input`|`select`|`textarea`|`label`|`fieldset`/.test(lead),
    `the lead sentence must name the element, read: ${lead.slice(0, 120)}`,
  );
  return `${demoFences.length} runnable example(s), ${links.length} link(s), none trailing`;
});

/**
 * The text a built page's first seite code fence carries. seite paints the fence with one `<span>`
 * per token, so the only honest way to read it back is to strip the markup and decode the entities
 * — which is exactly what the demo layer does before it renders the preview.
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
  must(fence.includes('<fieldset'), `${DOC_HTML} does not carry the example as escaped text`);
  must(fence.includes('type="email"'), `${DOC_HTML} does not carry the email field as escaped text`);
  must(/user-invalid/.test(html), `${DOC_HTML} does not carry the :user-invalid sentence`);
  const h2s = [...html.matchAll(/<h2\b[^>]*>/g)];
  must(h2s.length === 1 && /data-site-heading=/.test(h2s[0][0]), `${DOC_HTML} must render exactly the template's one H2`);
  const index = read(DOC_INDEX);
  must(/href="[^"]*\/components\/form"/.test(index), `${DOC_INDEX} does not link to /components/form`);
  return `${seite.version}: build clean, the fence is raw (${fence.split('\n').length} lines), the index links /components/form`;
});

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
    'method 1: at load no control wears an error state — compared with its own legal twin',
    async (browser, server) =>
      withPage(browser, server.fixture, {}, async (page) => {
        // The trap is real, and it is why this check exists: the required controls *are* :invalid
        // from the first paint, and a bare :invalid rule would have painted every one of them.
        const load = await page.evaluate(() =>
          [...document.querySelectorAll('input, select, textarea')].map((el) => ({
            id: el.id,
            invalid: el.matches(':invalid'),
            userInvalid: el.matches(':user-invalid'),
          })),
        );
        const invalidAtLoad = load.filter((entry) => entry.invalid && entry.id);
        must(
          invalidAtLoad.length >= 6,
          `the fixture is not exercising the trap: only ${invalidAtLoad.length} control(s) are :invalid at load`,
        );
        must(
          invalidAtLoad.every((entry) => entry.userInvalid === false),
          `a control matches :user-invalid on load: ${invalidAtLoad.filter((e) => e.userInvalid).map((e) => e.id).join(', ')}`,
        );

        const painted = [];
        for (const [empty, twin, label, properties] of TWINS) {
          const a = await readControl(page, empty);
          const b = await readControl(page, twin);
          must(a.found && b.found, `${label}: a control is missing from the fixture`);
          for (const property of properties) {
            must(
              a[property] === b[property],
              `${label}: ${empty} differs from its legal twin on ${property} (${a[property]} vs ${b[property]}) — ` +
                'an error state is showing before any interaction',
            );
          }
          painted.push(`${label} ${a.borderTopColor}`);
        }

        // The legal state itself is the theme's, not a leftover: black frame, secondary surface,
        // the page's ink, and the sm tier (ADR-0003). A box paints no shadow at all.
        const field = await readControl(page, '#f-email-ok');
        must(field.borderTopColor === COLOR.ink, `a valid field's frame must be the page's ink, read ${field.borderTopColor}`);
        must(field.background === COLOR.secondary, `a valid field sits on the secondary surface, read ${field.background}`);
        must(field.color === COLOR.ink, `a valid field's text is the page's ink, read ${field.color}`);
        must(field.boxShadow === SM, `a field rests on the sm tier, read ${field.boxShadow}`);
        must(field.borderTopWidth === FORM.border, `the frame is ${FORM.border}, read ${field.borderTopWidth}`);
        must(field.borderTopLeftRadius === FORM.radius, `square corners (spec §6.1), read ${field.borderTopLeftRadius}`);
        must(field.fontSize === FORM.fontSize, `a field is 1rem, read ${field.fontSize}`);
        must(field.lineHeight === FORM.lineHeight, `a field's line-height is 1.5, read ${field.lineHeight}`);
        must(
          field.boxHeight === FORM.fieldHeight,
          `a field is ${FORM.fieldHeight}px tall (24 + 16 + 6), read ${field.boxHeight}`,
        );
        must(field.paddingInline === '12px 12px', `the field's inline padding is 12px, read ${field.paddingInline}`);

        const box = await readControl(page, '#f-accept-ok');
        must(
          box.boxWidth === FORM.boxSize && box.boxHeight === FORM.boxSize,
          `a box is ${FORM.boxSize}px square (border-box), read ${box.boxWidth}x${box.boxHeight}`,
        );
        must(box.boxShadow === 'none', `a box paints no shadow at rest, read ${box.boxShadow}`);
        must(box.background === COLOR.main, `a checked box is filled with --bn-main, read ${box.background}`);
        must(
          box.mark.transform === 'none' && box.mark.content === '""',
          `a checked box shows its mark, read ${box.mark.transform} / ${box.mark.content}`,
        );
        const unchecked = await readControl(page, '#f-accept');
        must(
          /^matrix\(0, 0, 0, 0,/.test(unchecked.mark.transform),
          `an unchecked box hides its mark with scale(0), read ${unchecked.mark.transform}`,
        );
        must(unchecked.background === COLOR.secondary, `an unchecked box is white, read ${unchecked.background}`);
        const radio = await readControl(page, '#f-radio-ok');
        must(
          radio.borderTopLeftRadius === FORM.ringRadius,
          `a radio is round, read ${radio.borderTopLeftRadius}`,
        );

        // The author-marked path is the opposite promise: it paints with no interaction at all.
        const marked = await readControl(page, '#f-aria');
        must(marked.borderTopColor === COLOR.danger, `aria-invalid="true" must paint without interaction, read ${marked.borderTopColor}`);
        must(sameColor(marked.background, ERROR_WASH, 2), `the aria-invalid wash is 10% danger, read ${marked.background}`);
        const variant = await readControl(page, '#f-variant');
        must(
          variant.borderTopColor === COLOR.danger,
          `data-variant="danger" must paint a control, read ${variant.borderTopColor}`,
        );

        // And a disabled control never wears one. The platform bars it from constraint validation
        // altogether, so it is not even `:invalid` — the frame, not the state, is what is asserted.
        const disabled = await readControl(page, '#f-name-disabled');
        must(disabled.disabled === true, '#f-name-disabled must be disabled');
        must(disabled.invalid === false, 'a disabled control is barred from constraint validation, so it is not :invalid');
        must(
          disabled.borderTopColor === COLOR.ink,
          `a disabled field must not be painted as an error, read ${disabled.borderTopColor}`,
        );
        must(disabled.cursor === 'not-allowed', `a disabled field must not look pressable, read ${disabled.cursor}`);
        must(disabled.opacity === '0.6', `a disabled field fades to 0.6, read ${disabled.opacity}`);

        return `${invalidAtLoad.length} control(s) :invalid at load, all unpainted; twins agree on 8 properties: ${painted.join(', ')}`;
      }),
  ],
  [
    'methods 1+2: `:user-invalid` is supported here, and only after a real value plus a real blur',
    async (browser, server) =>
      withPage(browser, server.fixture, {}, async (page) => {
        const supported = await page.evaluate(() => CSS.supports('selector(:user-invalid)'));
        must(supported === true, 'CSS.supports("selector(:user-invalid)") is false — the fallback would have to carry the state');
        const validSupported = await page.evaluate(() => CSS.supports('selector(:user-valid)'));
        const before = await readControl(page, '#f-email');
        must(before.invalid === true && before.userInvalid === false, 'the email starts :invalid and not :user-invalid');

        await page.fill('#f-email', 'not-an-email');
        const typed = await readControl(page, '#f-email');
        await page.keyboard.press('Tab'); // a real focus move: the field is blurred by the keyboard
        const blurred = await readControl(page, '#f-email');
        must(blurred.userInvalid === true, 'typing a bad address and leaving the field must match :user-invalid');
        must(blurred.borderTopColor === COLOR.danger, `the frame must turn to --bn-danger, read ${blurred.borderTopColor}`);
        must(
          sameColor(blurred.background, ERROR_WASH, 2),
          `the surface takes a 10% danger wash, read ${blurred.background}`,
        );
        must(
          blurred.boxShadow === SM,
          `the error must not restate the shadow (it was substituted on :root), read ${blurred.boxShadow}`,
        );

        // A legal value takes the state away again, without a reload.
        await page.fill('#f-email', 'ada@example.com');
        await page.keyboard.press('Tab');
        const fixed = await readControl(page, '#f-email');
        must(fixed.userInvalid === false, 'a corrected field must stop matching :user-invalid');
        must(fixed.borderTopColor === COLOR.ink, `a corrected field returns to the page's ink, read ${fixed.borderTopColor}`);
        must(fixed.background === COLOR.secondary, `a corrected field returns to the secondary surface, read ${fixed.background}`);

        // Programmatic interaction is not interaction: setting the attribute is not typing.
        const untouched = await readControl(page, '#f-name');
        must(untouched.userInvalid === false, 'an untouched required field must not match :user-invalid');
        return `CSS.supports(:user-invalid)=${supported}, :user-valid=${validSupported}; ${typed.userInvalid} typed → ${blurred.userInvalid} blurred → ${fixed.userInvalid} corrected; border ${before.borderTopColor} → ${blurred.borderTopColor} → ${fixed.borderTopColor}`;
      }),
  ],
  [
    'method 2: every control class turns the error on after an illegal value and a blur',
    async (browser, server) =>
      withPage(browser, server.fixture, {}, async (page) => {
        const observed = [];
        const expectError = async (selector, label, { interaction = true } = {}) => {
          const snapshot = await readControl(page, selector);
          if (interaction) {
            must(snapshot.userInvalid === true, `${label} (${selector}) did not match :user-invalid`);
          }
          must(
            snapshot.borderTopColor === COLOR.danger,
            `${label}: the frame must be --bn-danger, read ${snapshot.borderTopColor}`,
          );
          observed.push(`${label}: ${snapshot.borderTopColor}`);
          return snapshot;
        };

        // a text field cleared after typing it
        await page.fill('#f-name', 'Ada');
        await page.fill('#f-name', '');
        await page.keyboard.press('Tab');
        await expectError('#f-name', 'input[required] cleared');

        // a multi-line field cleared after typing it
        await page.fill('#f-note', 'Ready.');
        await page.fill('#f-note', '');
        await page.keyboard.press('Tab');
        const note = await expectError('#f-note', 'textarea[required] cleared');
        must(
          note.background === COLOR.secondary || sameColor(note.background, ERROR_WASH, 2),
          `the textarea's wash did not apply, read ${note.background}`,
        );

        // A required select is reached with the keyboard: Chrome does not count a programmatic
        // value change as a user interaction, and `:user-invalid` is a statement about the user.
        await page.focus('#f-plan');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('ArrowUp');
        await page.keyboard.press('Tab');
        await expectError('#f-plan', 'select[required] emptied');

        // a required checkbox checked and then unchecked
        await page.click('#f-accept');
        await page.click('#f-accept');
        await page.keyboard.press('Tab');
        const box = await expectError('#f-accept', 'input[type="checkbox"][required] unchecked');
        must(box.boxShadow === 'none', `an errored box keeps no shadow, read ${box.boxShadow}`);
        must(
          box.background === COLOR.secondary,
          `an errored box says it with its frame alone, read ${box.background}`,
        );

        // a required switch: the same frame, from section 1's control
        await page.click('#f-switch');
        await page.click('#f-switch');
        await page.keyboard.press('Tab');
        const toggle = await expectError('#f-switch', 'input[role="switch"][required] off');
        must(
          toggle.boxWidth === 40 && toggle.boxHeight === 28,
          `the errored switch must keep its own geometry, read ${toggle.boxWidth}x${toggle.boxHeight}`,
        );

        // The platform cannot uncheck a radio, so a required radio group's error state is reached
        // through the author-marked path instead — the fallback half of the same rule. That is why
        // this row asserts the paint without asserting `:user-invalid`.
        await page.evaluate(() => document.querySelector('#f-radio-ok').setAttribute('aria-invalid', 'true'));
        const radio = await expectError('#f-radio-ok', 'input[type="radio"] with aria-invalid', { interaction: false });
        must(radio.borderTopLeftRadius === FORM.ringRadius, `an errored radio is still round, read ${radio.borderTopLeftRadius}`);

        must(observed.length === 6, `expected six error states, observed ${observed.length}`);
        return observed.join(' | ');
      }),
  ],
  [
    'method 3: a border width never changes — not on error, not on focus, on any of the four sides',
    async (browser, server) =>
      withPage(browser, server.fixture, {}, async (page) => {
        const controls = TAB_ORDER.map((id) => `#${id}`);
        const widths = async (selector) => {
          const snapshot = await readControl(page, selector);
          return [
            snapshot.borderTopWidth,
            snapshot.borderRightWidth,
            snapshot.borderBottomWidth,
            snapshot.borderLeftWidth,
          ];
        };
        const atRest = new Map();
        for (const selector of controls) atRest.set(selector, await widths(selector));

        // Focus every control with the keyboard and read again while it is focused.
        await page.evaluate(() => document.activeElement?.blur?.());
        const focusedReadings = new Map();
        for (let step = 0; step < controls.length; step += 1) {
          await page.keyboard.press('Tab');
          const id = await page.evaluate(() => document.activeElement?.id ?? '');
          const selector = `#${id}`;
          must(atRest.has(selector), `Tab reached #${id}, which is not a form control in the walk`);
          focusedReadings.set(selector, await widths(selector));
        }
        for (const [selector, reading] of focusedReadings) {
          must(
            reading.join() === atRest.get(selector).join(),
            `${selector}: a border width changed on focus (${atRest.get(selector).join('/')} → ${reading.join('/')})`,
          );
        }

        // Force every under-filled control into its error state and read a third time.
        await page.fill('#f-email', 'not-an-email');
        await page.fill('#f-name', 'Ada');
        await page.fill('#f-name', '');
        await page.fill('#f-note', 'Ready.');
        await page.fill('#f-note', '');
        await page.focus('#f-plan');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('ArrowUp');
        await page.click('#f-accept');
        await page.click('#f-accept');
        await page.click('#f-switch');
        await page.click('#f-switch');
        await page.evaluate(() => document.activeElement?.blur?.());
        await page.mouse.move(1279, 899);

        const errored = [];
        for (const [selector, selectorRest] of [
          ['#f-email', atRest.get('#f-email')],
          ['#f-name', atRest.get('#f-name')],
          ['#f-note', atRest.get('#f-note')],
          ['#f-plan', atRest.get('#f-plan')],
          ['#f-accept', atRest.get('#f-accept')],
          ['#f-switch', atRest.get('#f-switch')],
        ]) {
          const snapshot = await readControl(page, selector);
          must(snapshot.userInvalid === true, `${selector} is not in its error state, so this row measures nothing`);
          const reading = [
            snapshot.borderTopWidth,
            snapshot.borderRightWidth,
            snapshot.borderBottomWidth,
            snapshot.borderLeftWidth,
          ];
          must(
            reading.join() === selectorRest.join(),
            `${selector}: a border width changed on error (${selectorRest.join('/')} → ${reading.join('/')})`,
          );
          errored.push(`${selector} ${reading.join('/')}`);
        }

        return `${controls.length} control(s) × 4 sides identical at rest and focused; ${errored.length} identical again in error (${errored[0]} …)`;
      }),
  ],
  [
    'method 4: a real Tab walks every control in order, and each one paints the library ring',
    async (browser, server) =>
      withPage(browser, server.fixture, {}, async (page) => {
        await page.evaluate(() => document.activeElement?.blur?.());
        const visited = [];
        for (let step = 0; step < TAB_ORDER.length; step += 1) {
          await page.keyboard.press('Tab');
          const focused = await page.evaluate(() => {
            const el = document.activeElement;
            return {
              id: el?.id ?? '',
              tag: el?.tagName ?? '<none>',
              focusVisible: el?.matches?.(':focus-visible') ?? false,
              disabled: el?.disabled ?? false,
            };
          });
          must(focused.focusVisible === true, `#${focused.id} did not match :focus-visible after a real Tab`);
          must(focused.disabled === false, `Tab landed on a disabled control (#${focused.id})`);
          const snapshot = await readControl(page, `#${focused.id}`);
          must(snapshot.outlineStyle === 'solid', `#${focused.id}: the ring is not drawn (outline-style ${snapshot.outlineStyle})`);
          must(snapshot.outlineWidth === '3px', `#${focused.id}: the ring must be 3px, read ${snapshot.outlineWidth}`);
          must(snapshot.outlineColor === COLOR.ring, `#${focused.id}: the ring must be --bn-ring, read ${snapshot.outlineColor}`);
          must(snapshot.outlineOffset === '3px', `#${focused.id}: the ring must clear the frame by 3px, read ${snapshot.outlineOffset}`);
          visited.push(focused.id);
        }
        must(
          visited.join() === TAB_ORDER.join(),
          `the Tab walk differs from the authored order:\n    expected ${TAB_ORDER.join(', ')}\n    visited  ${visited.join(', ')}`,
        );
        // One more Tab must leave the controls (nothing else in the fixture is focusable).
        await page.keyboard.press('Tab');
        const after = await page.evaluate(() => document.activeElement?.id ?? '');
        must(after === '', `the walk did not end after ${TAB_ORDER.length} Tab presses (landed on #${after})`);
        return `${visited.length} control(s) in order, each with a solid 3px ${COLOR.ring} ring at a 3px offset; a disabled and a hidden control are unreachable`;
      }),
  ],
  [
    'the size and typography of a field are the system\'s, and the group has its own frame',
    async (browser, server) =>
      withPage(browser, server.fixture, {}, async (page) => {
        const fieldset = await page.evaluate(() => {
          const el = document.querySelector('#f-group');
          const cs = getComputedStyle(el);
          const legend = getComputedStyle(document.querySelector('#f-legend'));
          const label = getComputedStyle(document.querySelector('label[for="f-email"]'));
          const between = getComputedStyle(document.querySelector('label[for="f-name"]'));
          const beside = getComputedStyle(document.querySelector('label[for="f-accept"]'));
          return {
            border: cs.borderTopWidth,
            radius: cs.borderTopLeftRadius,
            padding: cs.paddingTop,
            background: cs.backgroundColor,
            shadow: cs.boxShadow,
            legendWeight: legend.fontWeight,
            legendFamily: legend.fontFamily,
            legendSize: legend.fontSize,
            labelDisplay: label.display,
            labelWeight: label.fontWeight,
            labelMargin: label.marginBlockEnd,
            firstLabelStart: label.marginBlockStart,
            betweenLabelStart: between.marginBlockStart,
            besideDisplay: beside.display,
            besideMargin: beside.marginBlockEnd,
          };
        });
        must(fieldset.border === FORM.border, `the group frame is ${FORM.border}, read ${fieldset.border}`);
        must(fieldset.radius === FORM.radius, `the group has square corners, read ${fieldset.radius}`);
        must(fieldset.padding === FORM.fieldsetPadding, `the group's padding is 16px, read ${fieldset.padding}`);
        must(fieldset.background === COLOR.secondary, `the group sits on the secondary surface, read ${fieldset.background}`);
        must(fieldset.shadow === SM, `the group takes the sm tier (ADR-0003), read ${fieldset.shadow}`);
        must(fieldset.legendWeight === '700', `the group title is the heading weight, read ${fieldset.legendWeight}`);
        must(
          fieldset.legendFamily === fieldset.legendFamily.toLowerCase() || fieldset.legendFamily.length > 0,
          'the group title has no font family',
        );
        must(fieldset.legendSize === FORM.fontSize, `the group title is body size, read ${fieldset.legendSize}`);
        must(fieldset.labelDisplay === 'inline-block', `a field label is an inline block, read ${fieldset.labelDisplay}`);
        must(fieldset.labelWeight === '700', `a label is the heading weight, read ${fieldset.labelWeight}`);
        must(fieldset.labelMargin === FORM.labelGap, `a label sits 6px off its field, read ${fieldset.labelMargin}`);
        // The rhythm: 12px above a label (it separates fields), except right under a legend, where
        // the legend's own gap already does the work.
        must(
          fieldset.betweenLabelStart === FORM.labelLead,
          `a label after a field takes ${FORM.labelLead} above it, read ${fieldset.betweenLabelStart}`,
        );
        must(
          fieldset.firstLabelStart === '0px',
          `the first label of a group must not double the legend's gap, read ${fieldset.firstLabelStart}`,
        );
        must(
          fieldset.besideDisplay === 'inline' && fieldset.besideMargin === '0px',
          `a label beside a box keeps the inline flow, read ${fieldset.besideDisplay}/${fieldset.besideMargin}`,
        );

        const select = await readControl(page, '#f-plan-ok');
        must(select.appearance === 'none', `the popup list must lose the platform chrome, read ${select.appearance}`);
        must(
          /linear-gradient/.test(select.backgroundImage) && select.backgroundImage.includes('rgb(0, 0, 0)'),
          `the chevron must be drawn in the page's ink, read ${select.backgroundImage.slice(0, 60)}`,
        );
        must(select.cursor === 'pointer', `the popup list must look pressable, read ${select.cursor}`);
        must(select.borderTopWidth === FORM.border, `the popup list keeps the frame, read ${select.borderTopWidth}`);

        const textarea = await readControl(page, '#f-note-ok');
        must(textarea.boxHeight >= FORM.textareaMin, `a multi-line field is at least 96px, read ${textarea.boxHeight}`);
        return `group ${fieldset.border}/${fieldset.radius}/${fieldset.padding} ${fieldset.shadow}; label ${fieldset.labelWeight}/${fieldset.labelMargin}; select ${select.appearance}; textarea ${textarea.boxHeight}px`;
      }),
  ],
  [
    'the dark theme flips the surfaces and the ink, and the error keeps its meaning',
    async (browser, server) =>
      withPage(browser, server.fixture, {}, async (page) => {
        await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
        const field = await readControl(page, '#f-email-ok');
        must(field.background === COLOR.darkSecondary, `a dark field sits on the dark surface, read ${field.background}`);
        must(field.color === COLOR.darkInk, `a dark field's text is the light ink, read ${field.color}`);
        must(field.borderTopColor === COLOR.darkInk, `a dark field's frame is the light ink, read ${field.borderTopColor}`);
        must(field.boxShadow === 'rgb(255, 253, 245) 2px 2px 0px 0px', `a dark field's shadow flips white, read ${field.boxShadow}`);
        const box = await readControl(page, '#f-accept');
        must(box.background === COLOR.darkSecondary, `an unchecked dark box sits on the dark surface, read ${box.background}`);
        const group = await page.evaluate(() => getComputedStyle(document.querySelector('#f-group')).backgroundColor);
        must(group === COLOR.darkSecondary, `the dark group's surface is the dark secondary, read ${group}`);

        await page.fill('#f-email-ok', 'not-an-email');
        await page.keyboard.press('Tab');
        const error = await readControl(page, '#f-email-ok');
        must(error.userInvalid === true, 'the dark field did not enter its error state');
        must(error.borderTopColor === COLOR.danger, `the error frame keeps --bn-danger in the dark, read ${error.borderTopColor}`);
        must(
          sameColor(error.background, [0.1 * 255 + 0.9 * 38, 0.1 * 107 + 0.9 * 38, 0.1 * 107 + 0.9 * 38], 2),
          `the dark error wash mixes with the dark surface, read ${error.background}`,
        );
        return `dark: field ${field.background}/${field.color}, box ${box.background}, group ${group}, error ${error.borderTopColor} on ${error.background}`;
      }),
  ],
  [
    'the documentation page: the live example shows a field error after a real interaction',
    async (browser, server) => {
      if (process.argv.includes('--no-docs') || !fs.existsSync(abs(DOC_HTML))) {
        skips += 1;
        return 'skipped (--no-docs or no dist/)';
      }
      return withPage(browser, server.docs, { githubPages: true }, async (page, issues) => {
        await page.waitForSelector('[data-site-demo] .site-demo__panel--preview input', { timeout: 10_000 });
        const pick = await page.evaluate(() => {
          const preview = document.querySelector('[data-site-demo] .site-demo__panel--preview');
          return {
            inputs: preview.querySelectorAll('input').length,
            selects: preview.querySelectorAll('select').length,
            textareas: preview.querySelectorAll('textarea').length,
            fieldsets: preview.querySelectorAll('fieldset').length,
            labels: preview.querySelectorAll('label').length,
            firstText: [...preview.querySelectorAll('input')].find((el) => el.type !== 'checkbox' && el.type !== 'radio')?.id ?? '',
          };
        });
        must(pick.fieldsets > 0, 'the preview carries no fieldset — the group was not rendered');
        must(pick.labels > 0, 'the preview carries no label');
        must(pick.textareas > 0, 'the preview carries no textarea');
        must(pick.inputs > 0, 'the preview carries no input');
        const target = pick.firstText ? `#${pick.firstText}` : '[data-site-demo] .site-demo__panel--preview input[type="email"]';
        const before = await readControl(page, target);
        must(before.found, 'the preview has no text field to type into');
        must(before.borderTopColor === COLOR.ink, `the preview field starts in the legal state, read ${before.borderTopColor}`);
        await page.fill(target, 'not-an-email');
        await page.keyboard.press('Tab');
        const after = await readControl(page, target);
        must(after.userInvalid === true, 'the documented field did not match :user-invalid after a real blur');
        must(after.borderTopColor === COLOR.danger, `the documented field did not turn red, read ${after.borderTopColor}`);
        must(issues.pageErrors.length === 0, `page errors: ${issues.pageErrors.join(' | ')}`);
        return `preview: ${pick.fieldsets} fieldset(s), ${pick.labels} label(s), ${pick.inputs} input(s); the field went ${before.borderTopColor} → ${after.borderTopColor}`;
      });
    },
  ],
  [
    'with no script the controls are still dressed and still validate (invariant 6)',
    async (browser, server) =>
      withPage(browser, server.fixture, { javaScriptEnabled: false }, async (page) => {
        const field = await page.evaluate(() => {
          const el = document.querySelector('#f-email-ok');
          const cs = getComputedStyle(el);
          const box = getComputedStyle(document.querySelector('#f-accept'));
          return {
            border: cs.borderTopWidth,
            shadow: cs.boxShadow,
            boxSize: document.querySelector('#f-accept').getBoundingClientRect().width,
            boxAppearance: box.appearance,
            boxDisplay: box.display,
          };
        });
        must(field.border === FORM.border, `with no script the frame is still ${FORM.border}, read ${field.border}`);
        must(field.shadow === SM, `with no script the field still rests on sm, read ${field.shadow}`);
        must(field.boxSize === FORM.boxSize, `with no script the box is still ${FORM.boxSize}px, read ${field.boxSize}`);
        must(field.boxAppearance === 'none', `with no script the box is still redrawn, read ${field.boxAppearance}`);
        // The state is the browser's own: typing and leaving the field needs no script at all.
        // `page.fill` injects nothing but still drives the DOM through the protocol's script world;
        // with JavaScript switched off the honest way to type is the keyboard.
        await page.keyboard.press('Tab'); // the first Tab from the document reaches #f-email
        await page.keyboard.type('not-an-email');
        await page.keyboard.press('Tab');
        const error = await settledControl(page, '#f-email', COLOR.danger);
        must(error.userInvalid === true, 'with no script the field did not validate on blur');
        must(error.border === COLOR.danger, `with no script the error frame is still painted, read ${error.border}`);
        must(error.focusedRing === true, 'with no script the ring did not follow the keyboard');
        return `no script: frame ${field.border}, tier ${field.shadow}, box ${field.boxSize}px redrawn; error ${error.border} on blur`;
      }),
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
        '(run: npx --yes playwright-core@1.64.1 --version, or: npm i --no-save playwright-core@1.64.1)',
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
