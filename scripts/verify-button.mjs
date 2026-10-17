#!/usr/bin/env node
/**
 * Scripted verification for ticket 07 — Button and the interaction contract.
 *
 * The five verification methods in
 * `.scratch/barnacle-design/issues/07-button-and-interaction-contract.md` are the specification of
 * this file; each one is a check below, measured in real Chrome against the shipped artifact
 * (`static/barnacle.css`) instead of a hand pass:
 *
 *   1. hover and press move the button by exactly the same distance the shadow grows, so the
 *      object really lifts off its shadow (and the shadow stays planted)
 *   2. keyboard Tab reaches the button and the focus ring is complete and coexists with the hard
 *      shadow (neither swallows the other)
 *   3. with the system set to reduced motion the transitions are gone and the appearance is not
 *   4. the computed border width is identical before and after hover
 *   5. (08 owns the permanent harness) — this file is the ticket-07 form of it
 *
 * The expected values are the independent source of truth: spec.md §3 (invariants), §6 (tokens),
 * §7 (the interaction contract, including "4px → 6px, +2px, lift 2px"), §8 (Button semantics),
 * ADR-0001/0003/0005/0006 and `D:\code\barnacle-notes\orchestrator-decisions.md` §1/§3/§4.
 * They are never recomputed from `src/css/button.css`.
 *
 * Run with: npm run verify:button   (or: node scripts/verify-button.mjs)
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
import { FROZEN_SLOTS, HYGIENE, PUBLIC_TOKENS } from './lib/tokens.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const abs = (...parts) => path.join(ROOT, ...parts);

/* ------------------------------------ expectations ----------------------------------- */

const SOURCE = 'src/css/button.css';
const ARTIFACT = 'static/barnacle.css';

/**
 * spec.md §7 + §6.1, read as computed values: the md tier is `--bn-shadow-x/y` (4px) with a zero
 * blur and a zero spread (spec §3 invariant 2), the lg tier is 1.5× (6px), and the sm tier is
 * half (2px). Colour is `--bn-shadow-color` = `--bn-border-color` = #000000 in the light theme.
 */
const SHADOW = {
  none: 'none',
  sm: 'rgb(0, 0, 0) 2px 2px 0px 0px',
  md: 'rgb(0, 0, 0) 4px 4px 0px 0px',
  lg: 'rgb(0, 0, 0) 6px 6px 0px 0px',
};

/** spec §6.1 --bn-shadow-lift = calc(--bn-shadow-x / 2) = 2px; it must equal the hover delta. */
const LIFT_PX = 2;
/** spec §6.1 --bn-press = 3px, deliberately not equal to the 4px resting shadow offset (decision E). */
const PRESS_PX = 3;

const HOVER_TRANSFORM = 'matrix(1, 0, 0, 1, -2, -2)';
const PRESS_TRANSFORM = 'matrix(1, 0, 0, 1, 3, 3)';
/** A hovered ghost has its lift slots zeroed, so the matrix stays the identity — never `none`. */
const IDENTITY_TRANSFORM = 'matrix(1, 0, 0, 1, 0, 0)';

/** spec §6.1 --bn-border-width, --bn-radius, --bn-main, --bn-foreground, --bn-ring. */
const BORDER_PX = '3px';
const RADIUS = '0px';
const MAIN_SURFACE = 'rgb(255, 210, 63)';
const SECONDARY_SURFACE = 'rgb(255, 255, 255)';
const INK = 'rgb(0, 0, 0)';
const TRANSPARENT = 'rgba(0, 0, 0, 0)';
const RING_COLOR = 'rgb(116, 185, 255)';
/** spec §6.1 --bn-danger = --bn-pink; --bn-transition. */
const DANGER_SURFACE = 'rgb(255, 107, 107)';
const MOTION = '0.15s';

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
  'transform',
  'box-shadow',
  'border-color',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'background',
  'background-color',
  'color',
  'outline',
  'outline-offset',
  'outline-color',
  'opacity',
  'cursor',
  'text-decoration-color',
]);

/** The `bn-` names ticket 07 introduces; later component tickets reuse them (decision B). */
const REQUIRED_CLASSES = [
  '.bn-button',
  '.bn-outline',
  '.bn-ghost',
  '.bn-sm',
  '.bn-lg',
  '.bn-icon',
  '.bn-button-group',
  '.bn-attached',
];

/**
 * The one internal variable a component may read without declaring it: 01-theme.css maps
 * `data-variant` onto `--_variant-color` (spec §8), and the component only spends it.
 */
const SEMANTIC_SLOT = '--_variant-color';

/** Hardcoded colour forms ADR-0005 keeps in 01-theme.css only. */
const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(|\bcolor\(/;

const STATE_SELECTOR = /:(?:hover|active|focus-visible)\b/;

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

/* -------------------------------------- the page -------------------------------------- */

/**
 * The measurement page. `#target` is a BARE `<button>` and is the first focusable element, so one
 * keyboard Tab reaches it (spec §8 / ADR-0001: the element is the anchor, a class is not needed).
 * Everything else on the page exists to cover the second axis: `data-variant` for meaning, `bn-`
 * class names for appearance (orchestrator §1).
 *
 * No `<script>` tag anywhere in it, which is the point of the no-JavaScript check.
 */
const FIXTURE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <link rel="icon" href="data:,">
    <title>barnacle button harness</title>
    <link rel="stylesheet" href="/static/barnacle.css">
  </head>
  <body>
    <main>
      <button id="target" type="button">Press me</button>
      <button id="classed" class="bn-button" type="button">Press me too</button>
      <a id="anchor" class="bn-button" href="#anchor">An anchor with the shape</a>
      <a id="link" href="#link">A plain link</a>

      <button id="outline" class="bn-outline" type="button">Outline</button>
      <button id="ghost" class="bn-ghost" type="button">Ghost</button>
      <button id="danger" data-variant="danger" type="button">Delete</button>
      <button id="secondary" data-variant="secondary" type="button">Cancel</button>

      <button id="small" class="bn-sm" type="button">Small</button>
      <button id="large" class="bn-lg" type="button">Large</button>
      <button id="icon" class="bn-icon" type="button" aria-label="Add">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1v14M1 8h14" stroke="currentColor" stroke-width="2"/></svg>
      </button>

      <button id="disabled" type="button" disabled>Disabled</button>
      <button id="aria" type="button" aria-disabled="true">Aria disabled</button>

      <menu id="group" class="bn-button-group">
        <button type="button">One</button><button type="button">Two</button>
      </menu>
      <menu id="attached" class="bn-button-group bn-attached">
        <button type="button">One</button><button type="button">Two</button>
      </menu>
    </main>
  </body>
</html>
`;

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * Serves the fixture from memory and the published artifact from `static/`. Nothing from
 * `src/` is reachable, so a browser check can only ever be measuring the shipped bytes.
 */
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

/**
 * A mid-transition read lies in a very believable way: 30/30 reads after `hover()` return the
 * value from *before* the transition (browser-harness-findings §3.3). Freezing is not optional,
 * and it must be registered before `goto` — `addStyleTag` after load is too late.
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
async function withPage(browser, server, options, fn) {
  const { freeze = true, ...contextOptions } = options ?? {};
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...contextOptions });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  // Freezing is what makes a post-hover read trustworthy, but it overwrites `transition`, so a
  // check that is *about* the transition declaration opts out with { freeze: false }. With
  // JavaScript disabled there is no init script to run and none is needed: nothing transitions at
  // rest.
  if (freeze && contextOptions.javaScriptEnabled !== false) {
    await page.addInitScript(FREEZE_INIT, FREEZE_CSS);
  }
  try {
    await page.goto(server.url, { waitUntil: 'load' });
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
      hint: 'check the fixture markup in scripts/verify-button.mjs',
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
 * The geometry of one button, read in a single snapshot: the shadow's four lengths, the transform
 * matrix, the resolved `--bn-shadow-lift`, and which interaction states actually match. The
 * `matches()` flags are the self-evidence that a "passing" rest read is not a silent no-op.
 */
async function readGeometry(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { found: false };
    const cs = getComputedStyle(el);
    const shadow = cs.boxShadow;
    const lengths = (shadow.match(/-?[\d.]+px/g) ?? []).map((value) => parseFloat(value));
    const matrix = cs.transform;
    const parts = matrix.startsWith('matrix(') ? matrix.slice(7, -1).split(',').map(Number) : [];
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;inline-size:var(--bn-shadow-lift)';
    document.body.appendChild(probe);
    const lift = parseFloat(getComputedStyle(probe).inlineSize);
    probe.remove();
    return {
      found: true,
      hovered: el.matches(':hover'),
      pressed: el.matches(':active'),
      focusVisible: el.matches(':focus-visible'),
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

/** Reaches the element with a real keyboard Tab — `element.focus()` skips the tab order entirely. */
async function tabTo(page, selector) {
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('Tab');
  const reached = await page.evaluate((sel) => document.activeElement === document.querySelector(sel), selector);
  must(reached, `keyboard Tab did not reach ${selector} (activeElement is ${await page.evaluate(() => document.activeElement?.tagName)})`);
}

/* =================================== static checks =================================== */

console.log(`barnacle button verification — ${ROOT}\n`);

const rawSource = fs.readFileSync(abs(SOURCE), 'utf8');
const source = blankComments(rawSource);
const rules = parseRules(source);
const allDeclarations = rules.flatMap((rule) =>
  declarations(rule.body).map(([property, value]) => ({ property, value, ...rule })),
);
const customProps = [...new Set([...source.matchAll(/--[\w-]+/g)].map((match) => match[0]))];

const rawArtifact = fs.readFileSync(abs(ARTIFACT), 'utf8');

await check('src/css/button.css is UTF-8 without a BOM and writes no @layer', () => {
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
  must(rules.length > 0, 'the file declares no rule at all — ticket 07 has not landed');
  return `${rules.length} rules, layer assignment left to the manifest`;
});

await check('src/css/button.css invents no name (ADR-0005: --bn-* and --_* only)', () => {
  const unknownPublic = customProps.filter((name) => HYGIENE.publicToken.test(name) && !PUBLIC_TOKENS.has(name));
  must(
    unknownPublic.length === 0,
    `unknown public token(s): ${unknownPublic.join(', ')} — spec §6.1 is the whole vocabulary`,
  );
  const foreign = customProps.filter(
    (name) => !HYGIENE.publicToken.test(name) && !HYGIENE.internalToken.test(name),
  );
  must(foreign.length === 0, `custom properties outside the two namespaces: ${foreign.join(', ')}`);

  // A component *overrides* the frozen geometry slots and *reads* those plus the semantic channel
  // 01-theme.css publishes (spec §8). Anything else would be a second source of geometry.
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
  const unknownReads = read.filter((name) => !FROZEN_SLOTS.has(name) && name !== SEMANTIC_SLOT);
  must(unknownReads.length === 0, `unknown internal variable(s) read: ${unknownReads.join(', ')}`);
  const declaredSemantic = declared.filter((name) => name === SEMANTIC_SLOT);
  must(
    declaredSemantic.length === 0,
    `${SEMANTIC_SLOT} is published by 01-theme.css and must only be read here (spec §8)`,
  );
  return `${declared.length} frozen slots overridden, ${read.length} read (${SEMANTIC_SLOT} included), 0 invented`;
});

await check('src/css/button.css holds no colour literal (colours come from 01-theme.css)', () => {
  const offenders = [...source.matchAll(new RegExp(COLOUR_LITERAL.source, 'g'))].map((match) => match[0]);
  must(offenders.length === 0, `hardcoded colour(s): ${[...new Set(offenders)].join(', ')}`);
  must(!/!\s*important/.test(source), 'the layer contract makes !important unnecessary and forbidden');
  return '0 hex / rgb() / hsl() / oklch() / color() literals, no !important';
});

await check('no rule anywhere disables an outline without a replacement (WCAG F78)', () => {
  const offenders = rules.filter((rule) =>
    declarations(rule.body).some(
      ([property, value]) =>
        (property === 'outline' || property === 'outline-style') && /^(none|0)\b/.test(value),
    ),
  );
  must(offenders.length === 0, `outline disabled on ${offenders.map((rule) => rule.selector).join(', ')}`);
  must(
    !/outline(?:-style)?\s*:\s*(?:none|0)\b/.test(source),
    'the source contains `outline: none` — the focus ring must never be removed',
  );
  return 'no outline: none in the source or the artifact';
});

await check('every geometry value in src/css/button.css reads a --_ slot (no number in the file)', () => {
  const offenders = allDeclarations
    .filter(({ property, value }) => GEOMETRY_PROPERTIES.includes(property) && /\d/.test(value))
    .map(({ selector, property, value }) => `${selector} { ${property}: ${value} }`);
  must(
    offenders.length === 0,
    `geometry must be a var(--_…) reference (spec §3 invariant 3): ${offenders.join('; ')}`,
  );
  const shadows = allDeclarations.filter(({ property }) => property === 'box-shadow');
  must(shadows.length > 0, 'no box-shadow is declared at all');
  const literalShadows = shadows.filter(({ value }) => !value.startsWith('var(--_'));
  must(literalShadows.length === 0, `box-shadow must read a slot: ${literalShadows.map((d) => d.value).join('; ')}`);
  const translates = [...source.matchAll(/translate\(([^)]*)\)/g)].map((match) => match[1].trim());
  must(translates.length > 0, 'no translate() is declared at all');
  const badTranslates = translates.filter((args) => !args.startsWith('var(--_'));
  must(badTranslates.length === 0, `translate() arguments must be slots: ${badTranslates.join('; ')}`);

  // The slots themselves are the other half of the same rule: a component may re-point a slot at
  // a token, or zero it on purpose (the ghost and the attached group), and nothing else. Writing
  // a length straight into a slot would put the number back into the component file.
  const badSlots = allDeclarations
    .filter(({ property }) => property.startsWith('--_'))
    .filter(({ property, value }) => {
      if (value.startsWith('var(--')) return false;
      if (value === 'transparent') return false; // a border colour, i.e. no colour at all
      if (value === 'none' && property.startsWith('--_shadow')) return false;
      if (value === '0' && /^--_(?:lift|press)-[xy]$/.test(property)) return false;
      return true;
    })
    .map(({ selector, property, value }) => `${selector} { ${property}: ${value} }`);
  must(
    badSlots.length === 0,
    `a slot may only be pointed at a token or zeroed on purpose: ${badSlots.join('; ')}`,
  );
  return `${shadows.length} shadows, ${translates.length} translate() calls, all slot references`;
});

await check('the border box is declared once and no state rule can change it (spec §3 invariant 7)', () => {
  const stateRules = rules.filter(isStateRule);
  must(stateRules.length > 0, 'no :hover / :active / :focus-visible rule exists');
  const offenders = [];
  for (const rule of stateRules) {
    for (const [property, value] of declarations(rule.body)) {
      if (property.startsWith('--_')) continue; // slot overrides are the geometry channel
      if (!STATE_PROPERTIES.has(property)) offenders.push(`${rule.selector} { ${property}: ${value} }`);
    }
  }
  must(
    offenders.length === 0,
    `a state rule may only change colour / geometry, never a box metric: ${offenders.join('; ')}`,
  );
  const widths = allDeclarations.filter(({ property }) => property === 'border-width' || property === 'border');
  const badWidths = widths.filter(({ value }) => !value.includes('var(--bn-border-width)'));
  must(
    badWidths.length === 0,
    `every border width must read --bn-border-width (one structural value): ${badWidths
      .map(({ selector, property, value }) => `${selector} { ${property}: ${value} }`)
      .join('; ')}`,
  );
  return `${stateRules.length} state rules declare only ${[...new Set(stateRules.flatMap((rule) => declarations(rule.body).map(([p]) => p)))].join(', ')}`;
});

await check('motion lives inside @media (prefers-reduced-motion: no-preference), not an afterthought', () => {
  const motionRules = rules.filter((rule) =>
    declarations(rule.body).some(([property]) => property === 'transition' || property.startsWith('transition-')),
  );
  must(motionRules.length > 0, 'nothing declares a transition — the interaction would be instant everywhere');
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
    'button.css declares an animation; ticket 07 has no entry animation to guard',
  );
  return `${motionRules.length} transition rule(s), 0 reduce blocks`;
});

await check('meaning rides data-variant and shape rides bn- class names — never both', () => {
  const variantRules = rules.filter((rule) => rule.selector.includes('[data-variant'));
  must(variantRules.length > 0, 'no [data-variant] rule exists — variants are part of the ticket');
  const layoutInsideVariant = variantRules
    .flatMap((rule) => declarations(rule.body).map(([property, value]) => ({ rule, property, value })))
    .filter(({ property }) => !property.startsWith('--_') && property !== 'color');
  must(
    layoutInsideVariant.length === 0,
    `[data-variant] may only publish the semantic colour channel, found: ${layoutInsideVariant
      .map(({ rule, property, value }) => `${rule.selector} { ${property}: ${value} }`)
      .join('; ')}`,
  );
  const semanticLiterals = [...source.matchAll(/--bn-(?:success|warning|danger)\b/g)].map((match) => match[0]);
  must(
    semanticLiterals.length === 0,
    `a component must read --_variant-color, not the semantic token: ${[...new Set(semanticLiterals)].join(', ')}`,
  );
  must(/var\(--_variant-color/.test(source), 'no rule reads --_variant-color');
  return `${variantRules.length} variant rules publishing only --_ slots and colour`;
});

await check('the ticket-07 bn- vocabulary is present and named as decided (ADR-0005 + §3 B)', () => {
  const missing = REQUIRED_CLASSES.filter((name) => !source.includes(name));
  must(missing.length === 0, `missing class name(s): ${missing.join(', ')}`);
  return REQUIRED_CLASSES.join(' ');
});

await check('the built artifact carries these rules inside @layer components', () => {
  must(
    rawArtifact.includes('/* src/css/button.css (@layer components) */'),
    `${ARTIFACT} has no button.css block — run npm run build`,
  );
  const block = rawArtifact.slice(
    rawArtifact.indexOf('/* src/css/button.css'),
    rawArtifact.indexOf('/* src/css/card.css'),
  );
  for (const needle of ['transform: translate(var(--_lift-x), var(--_lift-y))', 'box-shadow: var(--_shadow-rest)']) {
    must(block.includes(needle), `${ARTIFACT} button block is missing ${JSON.stringify(needle)}`);
  }
  return `${block.split('\n').length} lines of button.css in ${ARTIFACT}`;
});

/* =================================== browser checks =================================== */

const BROWSER_CHECKS = [
  [
    'verification 1: a resting button is the 4px hard shadow with a zero blur and spread',
    async (browser, server) =>
      withPage(browser, server, {}, async (page, issues) => {
        await expectStyle(
          page,
          '#target',
          {
            boxShadow: SHADOW.md,
            transform: 'none',
            borderTopWidth: BORDER_PX,
            borderRightWidth: BORDER_PX,
            borderBottomWidth: BORDER_PX,
            borderLeftWidth: BORDER_PX,
            borderTopStyle: 'solid',
            borderTopColor: INK,
            borderRadius: RADIUS,
            backgroundColor: MAIN_SURFACE,
            color: INK,
            cursor: 'pointer',
            display: 'inline-flex',
          },
          'resting bare <button>: ',
        );
        const geometry = await readGeometry(page, '#target');
        must(
          geometry.shadowLengths === 4 && geometry.shadowBlur === 0 && geometry.shadowSpread === 0,
          `the hard shadow must keep a zero blur and spread (spec §3 invariant 2), read ${geometry.shadow}`,
        );
        // The same shape through the class, and through an <a> (decision A: bare `a` is a link).
        await expectStyle(page, '#classed', { boxShadow: SHADOW.md, transform: 'none' }, '.bn-button: ');
        await expectStyle(
          page,
          '#anchor',
          { boxShadow: SHADOW.md, transform: 'none', textDecorationLine: 'none' },
          'a.bn-button: ',
        );
        await expectStyle(
          page,
          '#link',
          { boxShadow: 'none', transform: 'none', textDecorationLine: 'underline' },
          'bare <a> (decision A): ',
        );
        must(issues.consoleErrors.length === 0, `console errors: ${issues.consoleErrors.join(' | ')}`);
        must(issues.pageErrors.length === 0, `page errors: ${issues.pageErrors.join(' | ')}`);
        return `${geometry.shadow}; bare a stays a link`;
      }),
  ],
  [
    'verification 1: hover lifts the button by --bn-shadow-lift and the shadow grows by exactly that',
    async (browser, server) =>
      withPage(browser, server, {}, async (page) => {
        const rest = await readGeometry(page, '#target');
        await page.hover('#target');
        const hovered = await readGeometry(page, '#target');
        must(hovered.hovered === true, 'the page does not report :hover after page.hover() — the read would be a silent no-op');
        must(
          hovered.transform === HOVER_TRANSFORM,
          `hover transform must be translate(${HOVER_TRANSFORM.slice(7, -1)}) (left and up), read ${hovered.transform}`,
        );
        must(
          hovered.shadow === SHADOW.lg,
          `hover shadow must be the lg tier, read ${hovered.shadow}`,
        );
        const deltaX = hovered.shadowX - rest.shadowX;
        const deltaY = hovered.shadowY - rest.shadowY;
        must(
          deltaX === LIFT_PX && deltaY === LIFT_PX,
          `the shadow must grow by --bn-shadow-lift (${LIFT_PX}px): ${rest.shadowX}px → ${hovered.shadowX}px`,
        );
        must(
          hovered.lift === LIFT_PX,
          `--bn-shadow-lift resolves to ${hovered.lift}px, expected ${LIFT_PX}px`,
        );
        must(
          hovered.shadowBlur === 0 && hovered.shadowSpread === 0,
          `the hover shadow must keep a zero blur and spread, read ${hovered.shadow}`,
        );
        // "Really lifting off": the shadow's page position is unchanged while the button moves.
        must(
          rest.shadowX + 0 === hovered.shadowX + hovered.translateX &&
            rest.shadowY + 0 === hovered.shadowY + hovered.translateY,
          `the shadow must stay planted: rest offset ${rest.shadowX}px vs ${hovered.shadowX}px offset at translate(${hovered.translateX}, ${hovered.translateY})`,
        );
        return `translate(${hovered.translateX}, ${hovered.translateY}) + ${rest.shadowX}px → ${hovered.shadowX}px = lift ${hovered.lift}px, shadow planted`;
      }),
  ],
  [
    'verification 1: pressing falls toward the shadow and collapses it',
    async (browser, server) =>
      withPage(browser, server, {}, async (page) => {
        await page.hover('#target');
        await page.mouse.down();
        const pressed = await readGeometry(page, '#target');
        await page.mouse.up();
        must(pressed.pressed === true, 'the page does not report :active while the mouse button is down');
        must(
          pressed.transform === PRESS_TRANSFORM,
          `the press must move down-right by --bn-press (${PRESS_PX}px), read ${pressed.transform}`,
        );
        must(
          pressed.translateX > 0 && pressed.translateY > 0,
          `the press must move toward the shadow (positive offsets), read (${pressed.translateX}, ${pressed.translateY})`,
        );
        must(pressed.shadow === SHADOW.none, `the press must collapse the shadow, read ${pressed.shadow}`);
        must(
          pressed.translateX === PRESS_PX && pressed.translateY === PRESS_PX,
          `--bn-press is ${PRESS_PX}px (decision E: it is deliberately smaller than the 4px shadow offset)`,
        );
        return `translate(${pressed.translateX}, ${pressed.translateY}) with box-shadow: none`;
      }),
  ],
  [
    'verification 2: keyboard Tab paints a complete focus ring without swallowing the hard shadow',
    async (browser, server) =>
      withPage(browser, server, {}, async (page) => {
        await tabTo(page, '#target');
        await expectStyle(
          page,
          '#target',
          {
            outlineStyle: 'solid',
            outlineWidth: '3px',
            outlineOffset: '3px',
            outlineColor: RING_COLOR,
            boxShadow: SHADOW.md,
            borderTopWidth: BORDER_PX,
            transform: 'none',
          },
          'focus-visible: ',
        );
        const geometry = await readGeometry(page, '#target');
        must(geometry.focusVisible === true, 'the keyboard-focused button does not match :focus-visible');
        return `outline: 3px solid ${RING_COLOR}, offset 3px, hard shadow ${geometry.shadow} intact`;
      }),
  ],
  [
    'verification 4: the computed border width is identical before and after hover',
    async (browser, server) =>
      withPage(browser, server, {}, async (page) => {
        const FIELDS = ['borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth'];
        const samples = {};
        // The keyboard sample comes first, while the page has never seen the mouse: a click moves
        // Chrome's sequential-focus starting point, so a later Tab would start from the button
        // instead of from the top of the document.
        await tabTo(page, '#target');
        samples.focus = await readStyles(page, '#target', FIELDS);
        samples.rest = await readStyles(page, '#target', FIELDS);
        await page.hover('#target');
        samples.hover = await readStyles(page, '#target', FIELDS);
        await page.mouse.down();
        samples.press = await readStyles(page, '#target', FIELDS);
        await page.mouse.up();
        for (const selector of ['#outline', '#ghost', '#danger', '#small', '#large', '#disabled', '#aria']) {
          await page.hover(selector).catch(() => {});
          samples[selector] = await readStyles(page, selector, FIELDS);
        }
        const drift = [];
        for (const [state, values] of Object.entries(samples)) {
          for (const field of FIELDS) {
            if (values[field] !== BORDER_PX) drift.push(`${state}.${field} = ${values[field]}`);
          }
        }
        must(
          drift.length === 0,
          `the border width must never move (spec §3 invariant 7): ${drift.join(', ')}`,
        );
        must(
          samples.rest.borderTopWidth === samples.hover.borderTopWidth,
          'hover changed borderTopWidth',
        );
        return `${Object.keys(samples).length} states × 4 sides all at ${BORDER_PX}`;
      }),
  ],
  [
    'the appearance axis: outline keeps the planted-shadow equation one tier down, ghost has no geometry',
    async (browser, server) =>
      withPage(browser, server, {}, async (page) => {
        const rest = await readGeometry(page, '#outline');
        must(rest.shadow === SHADOW.sm, `a resting .bn-outline uses the sm tier, read ${rest.shadow}`);
        await expectStyle(
          page,
          '#outline',
          { backgroundColor: TRANSPARENT, borderTopColor: INK, color: INK, borderTopWidth: BORDER_PX },
          '.bn-outline: ',
        );
        await page.hover('#outline');
        const hovered = await readGeometry(page, '#outline');
        must(hovered.shadow === SHADOW.md, `a hovered .bn-outline rises to the md tier, read ${hovered.shadow}`);
        must(
          hovered.shadowX - rest.shadowX === LIFT_PX && hovered.lift === LIFT_PX,
          `.bn-outline must also grow its shadow by exactly the lift: ${rest.shadowX}px → ${hovered.shadowX}px`,
        );
        must(
          rest.shadowX + 0 === hovered.shadowX + hovered.translateX,
          `the outline shadow must stay planted: ${rest.shadowX} + 0 vs ${hovered.shadowX} + ${hovered.translateX}`,
        );
        await expectStyle(
          page,
          '#outline',
          { backgroundColor: MAIN_SURFACE, color: INK },
          '.bn-outline:hover: ',
        );

        await expectStyle(page, '#ghost', { boxShadow: 'none' }, '.bn-ghost at rest: ');
        await page.hover('#ghost');
        const ghost = await readGeometry(page, '#ghost');
        must(ghost.shadow === SHADOW.none, `a hovered ghost must not paint a shadow, read ${ghost.shadow}`);
        must(
          ghost.transform === IDENTITY_TRANSFORM,
          `a hovered ghost zeroes its lift slots, so its matrix stays the identity, read ${ghost.transform}`,
        );
        await expectStyle(page, '#ghost', { backgroundColor: MAIN_SURFACE }, '.bn-ghost:hover: ');
        return `outline ${rest.shadowX}px → ${hovered.shadowX}px (shadow planted), ghost ${ghost.shadow}`;
      }),
  ],
  [
    'the meaning axis: data-variant repaints the surface and nothing else',
    async (browser, server) =>
      withPage(browser, server, {}, async (page) => {
        await expectStyle(
          page,
          '#danger',
          {
            backgroundColor: DANGER_SURFACE,
            color: INK,
            boxShadow: SHADOW.md,
            borderTopWidth: BORDER_PX,
            borderTopColor: INK,
          },
          'data-variant="danger": ',
        );
        await expectStyle(
          page,
          '#secondary',
          { backgroundColor: SECONDARY_SURFACE, color: INK, boxShadow: SHADOW.md },
          'data-variant="secondary": ',
        );
        // The size axis is appearance, so it is a class — and it must not touch the border box.
        await expectStyle(
          page,
          '#small',
          { fontSize: '14px', paddingTop: '6px', paddingLeft: '12px', borderTopWidth: BORDER_PX },
          '.bn-sm: ',
        );
        await expectStyle(
          page,
          '#large',
          { fontSize: '18px', paddingTop: '14px', paddingLeft: '28px', borderTopWidth: BORDER_PX },
          '.bn-lg: ',
        );
        await expectStyle(page, '#target', { fontSize: '16px', paddingTop: '10px' }, 'default size: ');
        const icon = await page.locator('#icon').boundingBox();
        must(
          Math.round(icon.width) === 40 && Math.round(icon.height) === 40,
          `.bn-icon must stay square (40×40), read ${Math.round(icon.width)}×${Math.round(icon.height)}`,
        );
        return `danger ${DANGER_SURFACE}, secondary ${SECONDARY_SURFACE}, sm/lg 14/18px, icon 40×40`;
      }),
  ],
  [
    'the disabled states keep their structure and cannot be lifted',
    async (browser, server) =>
      withPage(browser, server, {}, async (page) => {
        for (const selector of ['#disabled', '#aria']) {
          await expectStyle(
            page,
            selector,
            {
              cursor: 'not-allowed',
              opacity: '0.6',
              color: INK,
              boxShadow: SHADOW.md,
              borderTopWidth: BORDER_PX,
            },
            `${selector}: `,
          );
          await page.hover(selector);
          const hovered = await readGeometry(page, selector);
          must(
            hovered.transform === 'none',
            `${selector} must not lift on hover (a disabled control cannot be picked up), read ${hovered.transform}`,
          );
        }
        return 'no lift on hover, structure (border + shadow) retained at 60% opacity';
      }),
  ],
  [
    'the button group lays out in a row, and the attached form overlaps its borders into one line',
    async (browser, server) =>
      withPage(browser, server, {}, async (page) => {
        await expectStyle(
          page,
          '#group',
          { display: 'flex', columnGap: '12px', rowGap: '12px' },
          '.bn-button-group: ',
        );
        const group = await page.locator('#group button').all();
        const [first, second] = [await group[0].boundingBox(), await group[1].boundingBox()];
        must(
          Math.round(second.x - (first.x + first.width)) === 12,
          `group buttons must be separated by more than the largest shadow (12px), read ${Math.round(second.x - (first.x + first.width))}px`,
        );
        const attached = await page.locator('#attached button').all();
        const [a, b] = [await attached[0].boundingBox(), await attached[1].boundingBox()];
        const seam = Math.round(b.x - (a.x + a.width));
        must(
          seam === -3,
          `attached buttons must overlap by exactly --bn-border-width (3px) so the seam is one line, read ${seam}px`,
        );
        await expectStyle(
          page,
          '#attached button',
          { boxShadow: 'none' },
          '.bn-attached button: ',
        );
        return `gap 12px; attached seam ${seam}px (single border), no individual shadows`;
      }),
  ],
  [
    'verification 3: reduced motion removes the transitions and leaves the appearance alone',
    async (browser, server) => {
      const reduce = await withPage(browser, server, { reducedMotion: 'reduce', freeze: false }, async (page) => {
        const matches = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
        must(matches === true, 'the reducedMotion: reduce context did not reach the page');
        const durations = (await readStyles(page, '#target', ['transitionDuration'])).transitionDuration;
        must(
          durations.split(',').every((value) => value.trim() === '0s'),
          `with reduced motion no transition may be declared, read transition-duration: ${durations}`,
        );
        // Appearance must be untouched: the same rest shadow, and the same hover end state —
        // reachable instantly because there is no transition left to freeze.
        await expectStyle(page, '#target', { boxShadow: SHADOW.md }, 'reduced motion at rest: ');
        await page.hover('#target');
        await expectStyle(
          page,
          '#target',
          { transform: HOVER_TRANSFORM, boxShadow: SHADOW.lg },
          'reduced motion on hover: ',
        );
        return durations;
      });
      const full = await withPage(browser, server, { freeze: false }, async (page) => {
        const matches = await page.evaluate(() => matchMedia('(prefers-reduced-motion: no-preference)').matches);
        must(matches === true, 'the default context does not report prefers-reduced-motion: no-preference');
        const style = await readStyles(page, '#target', ['transitionProperty', 'transitionDuration', 'transitionTimingFunction']);
        const properties = style.transitionProperty.split(',').map((value) => value.trim());
        for (const wanted of ['transform', 'box-shadow']) {
          must(
            properties.includes(wanted) && properties.length === 4,
            `the transition must cover transform, box-shadow, background-color and border-color, read ${style.transitionProperty}`,
          );
        }
        const durations = style.transitionDuration.split(',').map((value) => value.trim());
        must(
          durations.every((value) => value === MOTION),
          `every transition must run for --bn-transition (${MOTION}), read ${style.transitionDuration}`,
        );
        return `${style.transitionProperty} over ${MOTION}`;
      });
      return `reduce: ${reduce}; no-preference: ${full}`;
    },
  ],
  [
    'verification 5: with JavaScript disabled the appearance is complete and only the script is missing',
    async (browser, server) =>
      withPage(browser, server, { javaScriptEnabled: false }, async (page) => {
        const scripts = await page.evaluate(() => document.querySelectorAll('script').length);
        must(scripts === 0, `the fixture must not load a script, found ${scripts}`);
        await expectStyle(
          page,
          '#target',
          { boxShadow: SHADOW.md, borderTopWidth: BORDER_PX, backgroundColor: MAIN_SURFACE, borderRadius: RADIUS },
          'no-JavaScript bare <button>: ',
        );
        await expectStyle(page, '#danger', { backgroundColor: DANGER_SURFACE }, 'no-JavaScript variant: ');
        await expectStyle(page, '#ghost', { boxShadow: 'none' }, 'no-JavaScript ghost: ');
        await expectStyle(page, '#group', { display: 'flex' }, 'no-JavaScript group: ');
        await expectStyle(page, '#disabled', { cursor: 'not-allowed' }, 'no-JavaScript disabled: ');
        await tabTo(page, '#target');
        await expectStyle(
          page,
          '#target',
          { outlineStyle: 'solid', outlineWidth: '3px', outlineOffset: '3px', boxShadow: SHADOW.md },
          'no-JavaScript focus ring: ',
        );
        return 'rest geometry, variants, group, disabled state and the focus ring all render with no script';
      }),
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
        '(run: npm i --no-save playwright-core@1.64.1)',
    );
    return;
  }
  const server = await startServer();
  // channel: 'chrome' drives the system Chrome; the bundled chromium revision is not present.
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  console.log(`      ${server.url} on system Chrome ${browser.version()}\n`);
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
