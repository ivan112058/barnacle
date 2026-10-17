#!/usr/bin/env node
/**
 * Scripted verification for ticket 21 — TagInput and its JavaScript.
 *
 * The five verification methods in `.scratch/barnacle-design/issues/21-taginput.md` are the
 * specification of this file, and each one is a check below:
 *
 *   1. the tag-list state machine, exercised through the public interface in real Chrome: adding
 *      by keyboard, removing one tag at a time, Backspace on an empty field, clearing;
 *   2. the keyboard alone: every one of those gestures, with the focus ring measured, and without
 *      a single `element.click()` in the path;
 *   3. a programmatic write followed by a read, in both directions, and an idempotent second write;
 *   4. the container's box (size and every border width) measured immediately before and after a
 *      removal, so "removing a tag must not change the frame" is a reading, not a claim;
 *   5. a listener on the document inspecting the `bn:change` detail, its bubble and its compose
 *      flags.
 *
 * Two more checks exist because the ticket makes claims a regex cannot settle:
 *
 *   6. with `javaScriptEnabled: false` the same markup is still a usable text field — readable,
 *      typeable, framed — and the chips are the only thing missing;
 *   7. the documented example is really interactive in the site's own preview panel (the preview
 *      injects the fence's HTML into the live page, so the artifact must enhance it there).
 *
 * The expected values are the independent source of truth: spec.md §3 (invariants), §6 (tokens),
 * §7 (the interaction contract), §8/§9 (the element and the JS architecture), `form.css`'s field
 * box as the same-source reference (ticket 12), ADR-0002 (shallow DOM), ADR-0005 (the two
 * namespaces) and D:\code\barnacle-notes\orchestrator-decisions.md §1/§4/§11/§13. They are never
 * recomputed from `src/css/taginput.css` or `src/js/taginput.js`.
 *
 * Run with: node scripts/verify-taginput.mjs
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
import { listenOnFreePort } from './lib/server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const abs = (...parts) => path.join(ROOT, ...parts);
const DIST = abs('dist');

/* ------------------------------------ expectations ----------------------------------- */

const SOURCE = 'src/css/taginput.css';
const FORM_SOURCE = 'src/css/form.css';
const SCRIPT = 'src/js/taginput.js';
const ENTRY = 'src/js/index.js';
const ARTIFACT = 'static/barnacle.css';
const JS_ARTIFACT = 'static/barnacle.js';
const CONTENT = 'content/components/taginput.md';
const PAGE = 'dist/components/taginput.html';

/** spec §9: the one event `<bn-taginput>` announces, and the payload ticket 21 specifies. */
const EVENT = 'bn:change';
const DETAIL_KEYS = ['added', 'removed', 'source', 'tags'];

/** The read/write interface the page documents. Names are the ticket's ("命名自定"). */
const API = ['tags', 'setTags', 'addTag', 'removeTagAt', 'clearTags'];

/** The gestures the ticket names, spelled as the state machine spells them. */
const SOURCES = ['api', 'backspace', 'input', 'remove'];

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
const STATE_SELECTOR = /:(?:hover|active|focus-visible|focus-within)\b/;

/** The fence info strings ticket 04's layer accepts: a bare language token, nothing else. */
const ALLOWED_FENCE_INFO = /^(?:html|css|js|javascript|json|xml|svg|text|txt|markdown|md|powershell|ps1|sh|bash|shell|console|diff)?$/;

/** Measured values (spec §6.1 + §7): 3px frame, sm rest → md hover, a 3px ring offset by 3px. */
const BORDER_PX = '3px';
const SHADOW_SM = 'rgb(0, 0, 0) 2px 2px 0px 0px';
const SHADOW_MD = 'rgb(0, 0, 0) 4px 4px 0px 0px';
const SECONDARY_SURFACE = 'rgb(255, 255, 255)';
const MAIN_SURFACE = 'rgb(255, 210, 63)';
const RING_COLOR = 'rgb(116, 185, 255)';

/** The chip's visual is `badge.css`'s: a chip rule may only arrange, never repaint. */
const CHIP_LAYOUT_PROPERTIES = new Set(['flex', 'max-inline-size', 'white-space', 'overflow-wrap']);

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
 * The measurement page. `#field` is the component under test, `#plain` is the same-source control
 * — a bare `<input type="text">`, dressed by `form.css` — so "the tag field is a Form field" is
 * checked by comparing two computed boxes rather than by trusting a comment.
 *
 * No `<script>` tag: the library is loaded with `addScriptTag`, so the fixture can never depend on
 * something the artifact does not do — and the same page, loaded with no script at all, is the
 * no-JavaScript probe.
 *
 * The first field carries two tags so the tab order and the chips' position are both real from the
 * first paint; the second one starts empty so an add can be measured from zero.
 */
const FIXTURE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <link rel="icon" href="data:,">
    <title>barnacle taginput harness</title>
    <link rel="stylesheet" href="/static/barnacle.css">
  </head>
  <body>
    <main>
      <bn-taginput id="field" value="Design, Code">
        <input id="entry" type="text" placeholder="Add a tag…">
      </bn-taginput>

      <bn-taginput id="empty">
        <input id="empty-entry" type="text" placeholder="Another field">
      </bn-taginput>

      <label for="plain">A plain Form field</label>
      <input id="plain" type="text" value="not a tag">
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
  await listenOnFreePort(server);
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    harness: `${origin}/harness.html`,
    docs: `${origin}/barnacle/components/taginput`,
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

/** One snapshot of the state machine plus the box that displays it. */
async function readField(page, selector) {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) return { found: false };
    const chips = [...root.querySelectorAll('.bn-tag')];
    const buttons = chips.map((chip) => chip.querySelector('.bn-taginput-remove'));
    const entry = root.querySelector('input');
    const box = root.getBoundingClientRect();
    const frame = getComputedStyle(root);
    const chipStyle = chips[0] ? getComputedStyle(chips[0]) : null;
    const buttonStyle = buttons[0] ? getComputedStyle(buttons[0]) : null;
    const entryStyle = entry ? getComputedStyle(entry) : null;
    return {
      found: true,
      tags: typeof root.tags === 'function' ? root.tags() : null,
      value: root.getAttribute('value'),
      chipTexts: chips.map((chip) => chip.firstChild?.nodeValue ?? ''),
      chipLabels: buttons.map((button) => button.getAttribute('aria-label')),
      chipCount: chips.length,
      buttonCount: buttons.length,
      entryValue: entry?.value ?? null,
      entryDisabled: entry?.disabled ?? null,
      buttonDisabled: buttons.map((button) => button?.disabled ?? null),
      rect: { width: box.width, height: box.height },
      border: {
        top: frame.borderTopWidth,
        right: frame.borderRightWidth,
        bottom: frame.borderBottomWidth,
        left: frame.borderLeftWidth,
      },
      frame: {
        boxShadow: frame.boxShadow,
        transform: frame.transform,
        outlineStyle: frame.outlineStyle,
        outlineWidth: frame.outlineWidth,
        outlineOffset: frame.outlineOffset,
        outlineColor: frame.outlineColor,
        borderColor: frame.borderColor,
        backgroundColor: frame.backgroundColor,
      },
      chip: chipStyle
        ? { boxShadow: chipStyle.boxShadow, transform: chipStyle.transform, borderColor: chipStyle.borderColor }
        : null,
      button: buttonStyle ? { boxShadow: buttonStyle.boxShadow, transform: buttonStyle.transform } : null,
      entryStyle: entryStyle
        ? {
            borderWidth: entryStyle.borderTopWidth,
            boxShadow: entryStyle.boxShadow,
            outlineStyle: entryStyle.outlineStyle,
            outlineWidth: entryStyle.outlineWidth,
            outlineOffset: entryStyle.outlineOffset,
            outlineColor: entryStyle.outlineColor,
          }
        : null,
      focusVisible: document.activeElement?.matches?.(':focus-visible') ?? false,
      activeIsEntry: document.activeElement === entry,
      activeIsButton: buttons.includes(document.activeElement),
    };
  }, selector);
}

/** The event log a listener on the document keeps, one entry per announced change. */
const EVENT_LOG = () => {
  window.__bnChanges = [];
  document.addEventListener('bn:change', (event) => {
    window.__bnChanges.push({
      type: event.type,
      isCustomEvent: event instanceof CustomEvent,
      bubbles: event.bubbles,
      composed: event.composed,
      keys: Object.keys(event.detail).sort(),
      detail: {
        tags: [...event.detail.tags],
        added: [...event.detail.added],
        removed: [...event.detail.removed],
        source: event.detail.source,
      },
      target: event.target?.id ?? null,
    });
  });
};

/* =================================== static checks =================================== */

console.log(`barnacle taginput verification — ${ROOT}\n`);

const rawSource = fs.readFileSync(abs(SOURCE), 'utf8');
const source = blankComments(rawSource);
const rules = parseRules(source);
const allDeclarations = rules.flatMap((rule) =>
  declarations(rule.body).map(([property, value]) => ({ property, value, ...rule })),
);
const customProps = [...new Set([...source.matchAll(/--[\w-]+/g)].map((match) => match[0]))];
const rawForm = fs.readFileSync(abs(FORM_SOURCE), 'utf8');
const rawScript = fs.readFileSync(abs(SCRIPT), 'utf8');
const script = blankComments(rawScript);
const rawEntry = fs.readFileSync(abs(ENTRY), 'utf8');
const markdown = fs.readFileSync(abs(CONTENT), 'utf8');
const rawArtifact = fs.readFileSync(abs(ARTIFACT), 'utf8');
const rawJsArtifact = fs.readFileSync(abs(JS_ARTIFACT), 'utf8');

/** The `value` a selector's rule declares for a property, or `undefined`. */
function declared(selector, property) {
  const wanted = selector.replace(/\s+/g, ' ').trim();
  const rule = rules.find((candidate) => candidate.selector.replace(/\s+/g, ' ').trim() === wanted);
  if (!rule) return undefined;
  return declarations(rule.body).find(([name]) => name === property)?.[1];
}

await check('src/css/taginput.css is UTF-8 without a BOM and writes no @layer', () => {
  const bytes = fs.readFileSync(abs(SOURCE));
  must(!(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf), 'a BOM breaks the build chain');
  const offenders = rawSource
    .split(/\r?\n/)
    .map((line, index) => [line, index + 1])
    .filter(([line]) => /^\s*@layer\b/.test(line));
  must(offenders.length === 0, `remove @layer from line(s) ${offenders.map(([, n]) => n).join(', ')}`);
  must(rules.length > 0, 'the file declares no rule at all — ticket 21 has not landed');
  return `${rules.length} rules, layer assignment left to CSS_MANIFEST`;
});

await check('src/css/taginput.css invents no name (ADR-0005: --bn-* and --_* only)', () => {
  const unknownPublic = customProps.filter((name) => HYGIENE.publicToken.test(name) && !PUBLIC_TOKENS.has(name));
  must(unknownPublic.length === 0, `unknown public token(s): ${unknownPublic.join(', ')} — spec §6.1 is the vocabulary`);
  const foreign = customProps.filter(
    (name) => !HYGIENE.publicToken.test(name) && !HYGIENE.internalToken.test(name),
  );
  must(foreign.length === 0, `custom properties outside the two namespaces: ${foreign.join(', ')}`);

  const declaredSlots = [
    ...new Set(allDeclarations.map(({ property }) => property).filter((name) => HYGIENE.internalToken.test(name))),
  ];
  const invented = declaredSlots.filter((name) => !FROZEN_SLOTS.has(name));
  must(invented.length === 0, `new internal slot(s): ${invented.join(', ')} — geometry is declared once, in 00-base.css`);

  const read_ = [...new Set([...source.matchAll(/var\(\s*(--_[\w-]+)/g)].map((match) => match[1]))];
  const unknownReads = read_.filter((name) => !FROZEN_SLOTS.has(name));
  must(unknownReads.length === 0, `unknown internal variable(s) read: ${unknownReads.join(', ')}`);
  return `${declaredSlots.length} frozen slots re-pointed, ${read_.length} read, 0 invented`;
});

await check('src/css/taginput.css holds no colour literal and no !important', () => {
  const offenders = [...source.matchAll(new RegExp(COLOUR_LITERAL.source, 'g'))].map((match) => match[0]);
  must(offenders.length === 0, `hardcoded colour(s): ${[...new Set(offenders)].join(', ')}`);
  must(!/!\s*important/.test(source), 'the layer contract makes !important unnecessary and forbidden');
  return '0 hex / rgb() / hsl() / oklch() / color() literals, no !important';
});

await check('the field is a Form field: the same frame, surface, radius and shadow tier as form.css', () => {
  // The reference is form.css's own text-field box, read as values rather than as a rule: ticket 12
  // owns the number, this ticket must not hold a second copy of it.
  const formField = rawForm.slice(rawForm.indexOf('input:not('), rawForm.indexOf('textarea {\n  min-block-size'));
  must(formField.includes('--_shadow-rest: var(--bn-shadow-sm)'), 'form.css no longer rests on the sm tier');
  must(/min-block-size:\s*2\.5rem/.test(formField), 'form.css no longer has the 2.5rem field floor');

  for (const [property, value] of [
    ['--_shadow-rest', 'var(--bn-shadow-sm)'],
    ['--_surface', 'var(--bn-secondary-background)'],
    ['border-width', 'var(--bn-border-width)'],
    ['border-radius', 'var(--bn-radius)'],
    ['border-color', 'var(--_border-rest)'],
    ['box-shadow', 'var(--_shadow-rest)'],
    ['min-block-size', '2.5rem'],
  ]) {
    const held = declared('bn-taginput', property);
    must(held === value, `the field's ${property} is ${JSON.stringify(held)}, expected ${JSON.stringify(value)} from form.css`);
  }
  // Hover raises the tier one step and moves nothing: a field is a typing target, not a button.
  const hover = rules.find((rule) => /bn-taginput:not\(\[disabled\]\):hover/.test(rule.selector));
  must(hover, 'no hover rule for the field');
  must(hover.conditions.some((condition) => /hover:\s*hover/.test(condition)), 'the hover rule must be guarded by (hover: hover)');
  const hoverDeclarations = new Map(declarations(hover.body));
  must(hoverDeclarations.get('--_shadow-rest') === 'var(--bn-shadow-md)', 'a hover must climb to the md tier');
  must(!hoverDeclarations.has('transform') && !hoverDeclarations.has('translate'), 'a field must not lift on hover');
  return 'frame, radius, surface, tier and floor all read the Form field’s own values';
});

await check('the chip is a badge: taginput.css arranges it and never repaints it', () => {
  const chipRules = rules.filter((rule) => /bn-taginput \.bn-tag\b/.test(rule.selector) && !rule.selector.includes('remove'));
  must(chipRules.length > 0, 'no rule dresses the chip inside the field');
  const offenders = chipRules.flatMap((rule) =>
    declarations(rule.body)
      .filter(([property]) => !CHIP_LAYOUT_PROPERTIES.has(property))
      .map(([property, value]) => `${rule.selector} { ${property}: ${value} }`),
  );
  must(
    offenders.length === 0,
    `a chip's visual belongs to badge.css; taginput.css may only arrange it: ${offenders.join('; ')}`,
  );
  must(rawScript.includes("'bn-badge'") || rawScript.includes('bn-badge'), 'the script no longer gives a chip the badge class');
  must(/bn-tag\b/.test(rawScript), 'the script no longer marks a chip .bn-tag');
  return `${chipRules.length} chip rule(s), layout only; the visual comes from the .bn-badge class`;
});

await check('no rule disables an outline, and the ring stays the base layer’s (WCAG F78)', () => {
  must(!/outline(?:-style)?\s*:\s*(?:none|0)\b/.test(source), 'the source contains `outline: none`');
  const removals = allDeclarations.filter(({ property }) =>
    ['outline', 'outline-style', 'outline-color', 'outline-width'].includes(property),
  );
  must(
    removals.length === 0,
    `taginput.css restates or removes the ring: ${removals.map(({ property, value }) => `${property}: ${value}`).join('; ')}`,
  );
  // One offset is allowed, and only for the entry field's ring: tighter than the library default,
  // because a field's padding is smaller than a card's (and it is the ring's own geometry, which
  // spec §7 fixes literally). It sits on a `:focus-visible` selector and never grows past it.
  const offsets = allDeclarations.filter(({ property }) => property === 'outline-offset');
  must(offsets.length > 0, 'the entry field expected a tighter ring offset; the rule is gone');
  for (const offset of offsets) {
    must(
      /^(?:\d+px|var\(--_focus-ring-offset\))$/.test(offset.value),
      `only the ring's own thickness may be a literal: outline-offset: ${offset.value}`,
    );
  }
  const offsetRules = rules.filter((rule) =>
    declarations(rule.body).some(([property]) => property === 'outline-offset'),
  );
  must(
    offsetRules.every((rule) => /:focus-visible/.test(rule.selector)),
    `an outline-offset outside a focus rule: ${offsetRules.map((rule) => rule.selector).join(', ')}`,
  );
  must(!/outline\s*:\s*none/.test(rawArtifact), 'the artifact contains `outline: none`');
  // The ring the visitor sees is the base layer's, so the file must not be the only ring around.
  const base = fs.readFileSync(abs('src/css/00-base.css'), 'utf8');
  must(/:focus-visible\s*{[^}]*outline:\s*var\(--_focus-ring\)/.test(blankComments(base)), 'the base layer stopped drawing the ring');
  return `${offsets.length} tighter offset(s) on the focused entry; no ring is declared, restated or removed`;
});

await check('every size is declared once and no state rule can change a box (spec §3 invariant 7)', () => {
  const stateRules = rules.filter((rule) => STATE_SELECTOR.test(rule.selector));
  must(stateRules.length > 0, 'no hover / focus-within state rule exists');
  for (const rule of stateRules) {
    for (const [property, value] of declarations(rule.body)) {
      if (property.startsWith('--_')) continue;
      must(
        STATE_PROPERTIES.has(property),
        `${rule.selector} { ${property}: ${value} } — a state may change a colour, never a box`,
      );
    }
  }
  const widths = allDeclarations.filter(({ property }) => property === 'border-width' || property === 'border');
  must(widths.length > 0, 'the field declares no border width at all');
  const badWidths = widths.filter(({ value }) => !value.includes('var(--bn-border-width)') && value !== '0');
  must(badWidths.length === 0, `every frame must read --bn-border-width: ${badWidths.map(({ value }) => value).join('; ')}`);
  const paddings = allDeclarations.filter(({ property }) => property === 'padding');
  for (const { value } of paddings) {
    must(!/\d+px/.test(value), `a padding in px is a copied number; use rem proportions: ${value}`);
  }
  return `${stateRules.length} state rules, colour-only; ${widths.length} frame declaration(s), all from the token`;
});

await check('every geometry value reads a --_ slot, and motion lives inside the no-preference guard', () => {
  // The ring's own thickness is the one number spec §7 fixes literally (and the check above keeps
  // it to the focused entry field only); everything else must be a slot reference.
  const offenders = allDeclarations
    .filter(({ property }) => GEOMETRY_PROPERTIES.includes(property) && property !== 'outline-offset')
    .filter(({ value }) => /\d/.test(value))
    .map(({ selector, property, value }) => `${selector} { ${property}: ${value} }`);
  must(offenders.length === 0, `geometry must be a var(--_…) reference (spec §3 invariant 3): ${offenders.join('; ')}`);

  const shadows = allDeclarations.filter(({ property }) => property === 'box-shadow');
  must(shadows.length > 0, 'no box-shadow is declared at all');
  const literalShadows = shadows.filter(({ value }) => value !== 'none' && !value.startsWith('var(--_'));
  must(literalShadows.length === 0, `box-shadow must read a slot: ${literalShadows.map(({ value }) => value).join('; ')}`);

  const translates = [...source.matchAll(/translate(?:X|Y|3d)?\(([^)]*)\)/g)].map((match) => match[1].trim());
  must(translates.length === 0, `taginput.css displaces something: ${translates.join('; ')} — a chip and a field never move`);

  const transitions = allDeclarations.filter(({ property }) => property.startsWith('transition'));
  must(transitions.length > 0, 'nothing declares a transition — the states would snap');
  const unguarded = rules
    .filter((rule) => declarations(rule.body).some(([property]) => property.startsWith('transition')))
    .filter((rule) => !rule.conditions.some((condition) => /prefers-reduced-motion:\s*no-preference/.test(condition)));
  must(unguarded.length === 0, `a transition outside the no-preference block: ${unguarded.map((rule) => rule.selector).join(', ')}`);
  must(!/prefers-reduced-motion:\s*reduce/.test(source), 'a reduce block that switches motion off afterwards is rejected');
  const durations = transitions.flatMap(({ value }) => value.split(',').filter((part) => /\d+(?:\.\d+)?m?s/.test(part)));
  must(durations.length === 0, `a duration is written as a number: ${durations.join('; ')}`);
  return `${shadows.length} shadow declaration(s), 0 literal, 0 displacement, every transition in the guard`;
});

await check('src/js/taginput.js is built on BnBase and keydownIndex, shallow and quiet', () => {
  must(/import\s*\{\s*BnBase\s*\}\s*from\s*'\.\/base\.js'/.test(rawScript), 'taginput.js does not import BnBase');
  must(/import\s*\{\s*keydownIndex\s*\}\s*from\s*'\.\/keys\.js'/.test(rawScript), 'taginput.js does not import keydownIndex');
  must(/extends BnBase/.test(rawScript), '<bn-taginput> must extend the shared base class');
  must(/events\(\)\s*\{[\s\S]*?return\s*\[[^\]]*'click'[^\]]*'keydown'[^\]]*'input'[^\]]*\]/.test(rawScript), 'events() must bind click, keydown and input');
  must(/this\.keydown\(|keydownIndex\(/.test(rawScript), 'the arrow arithmetic must go through keydownIndex');
  must(!/attachShadow/.test(script), 'ADR-0002: the library is shallow-DOM only');
  must(!/prefers-color-scheme/.test(script), 'a library convention must not be second-guessed in JS');
  must(!/innerHTML|insertAdjacentHTML/.test(script), 'the element must build nodes, not parse strings');
  // The tolerant path: no field, no work — and no throw, no console message.
  must(/const input = this\.querySelector\('input'\);\s*\n\s*if \(!input\) return;/.test(rawScript), 'init() must return quietly when there is no entry field');
  // The read/write interface the page documents.
  for (const method of API) {
    must(new RegExp(`\\n  ${method}\\(`).test(rawScript), `the documented method ${method}() is missing`);
  }
  for (const source of SOURCES) {
    must(rawScript.includes(`'${source}'`), `the detail source ${JSON.stringify(source)} is never produced`);
  }
  const emit = rawScript.match(/emit\(\s*'([\w:-]+)',\s*\{([^}]*)\}/);
  must(emit, 'no emit(...) call found in taginput.js');
  must(emit[1] === EVENT, `the event is named ${emit[1]}, expected ${EVENT}`);
  for (const key of DETAIL_KEYS) {
    must(new RegExp(`\\b${key}\\b`).test(emit[2]), `the ${EVENT} detail is missing ${key}`);
  }
  return `${EVENT} with detail {${DETAIL_KEYS.join(', ')}}; API ${API.join(', ')}; quiet on no field`;
});

await check('src/js/index.js registers <bn-taginput> and keeps the rest of the surface', () => {
  must(/import\s*\{\s*BnTagInput\s*\}\s*from\s*'\.\/taginput\.js'/.test(rawEntry), 'index.js does not import BnTagInput');
  must(/register\(\s*'bn-taginput'\s*,\s*BnTagInput\s*\)/.test(rawEntry), "index.js does not register 'bn-taginput'");
  must(/register\(\s*'bn-dropdown'/.test(rawEntry) && /register\(\s*'bn-tabs'/.test(rawEntry), 'a registration was dropped from index.js');
  return "bn.register('bn-taginput', BnTagInput), the other registrations untouched";
});

await check('the built artifacts carry the taginput block, its classes and its event', () => {
  const marker = '/* src/css/taginput.css (@layer components) */';
  must(rawArtifact.includes(marker), `${ARTIFACT} has no taginput.css block — run npm run build`);
  const block = rawArtifact.slice(rawArtifact.indexOf(marker), rawArtifact.indexOf('/* src/css/toast.css'));
  for (const needle of ['bn-taginput {', 'bn-taginput > input', 'bn-taginput .bn-tag', '.bn-taginput-remove']) {
    must(block.includes(needle), `${ARTIFACT} taginput block is missing ${JSON.stringify(needle)}`);
  }
  must(block.includes('prefers-reduced-motion: no-preference'), 'the motion guard is missing from the artifact');
  must(rawJsArtifact.includes(EVENT), `${JS_ARTIFACT} does not carry the ${EVENT} event name`);
  must(rawJsArtifact.includes('bn-tag'), `${JS_ARTIFACT} does not carry the chip class`);
  must(!rawJsArtifact.includes('attachShadow'), `${JS_ARTIFACT} calls attachShadow — ADR-0002 forbids it`);
  return `${block.split('\n').length} lines of taginput.css in ${ARTIFACT}`;
});

await check('content/components/taginput.md is a component page: no H2, plain fences, runnable example', () => {
  const body = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  const headings = body.split(/\r?\n/).filter((line) => /^#{1,2}\s/.test(line));
  must(headings.length === 0, `component pages start at H3 (spec §10): ${headings.join(' | ')}`);
  const trailing = [...body.matchAll(/\]\(([^)]*)\)/g)].map((match) => match[1]).filter((url) => url.endsWith('/'));
  must(trailing.length === 0, `a trailing slash is a broken link on this site: ${trailing.join(', ')}`);

  const blocks = fences(markdown);
  must(blocks.length >= 4, `expected the example, the API and the event fences, found ${blocks.length}`);
  const badInfo = blocks.filter((block) => !ALLOWED_FENCE_INFO.test(block.info));
  must(badInfo.length === 0, `fence info must be a bare language token: ${badInfo.map((block) => block.info).join(', ')}`);

  const examples = blocks.filter((block) => block.text.trim().startsWith('<'));
  must(examples.length >= 2, `expected both runnable examples, found ${examples.length}`);
  must(examples.some((block) => block.text.includes('<bn-taginput')), 'an example does not use <bn-taginput>');
  must(
    examples.every((block) => /<input\b/.test(block.text)),
    'every example must write the entry field the element enhances',
  );
  must(
    examples.every((block) => !/<script\b/i.test(block.text)),
    'a runnable example ships a <script>: the preview never executes it, so it would mislead',
  );

  // The page has to document what the ticket asks the page to document.
  for (const needle of [EVENT, ...API, ...DETAIL_KEYS, ...SOURCES.map((source) => `'${source}'`), 'case-sensitive', 'trim', 'Enter', 'Backspace', 'ArrowLeft', 'disabled', 'Without JavaScript']) {
    must(body.includes(needle), `the page does not mention ${JSON.stringify(needle)}`);
  }
  return `${blocks.length} fences (${examples.length} runnable), API + event detail + policy documented`;
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

  must(fs.existsSync(abs(PAGE)), `${PAGE} was not produced — content/components/taginput.md did not become a page`);
  const html = read(PAGE);
  // seite highlights the fence, so the escaped source is split across <span>s: remove the tags
  // before looking for the text a reader would copy.
  const plain = html.replace(/<[^>]+>/g, '');
  must(plain.includes('&lt;bn-taginput'), `${PAGE} does not keep the fence as escaped text (was it post-processed?)`);
  const live = [...html.matchAll(/<bn-taginput\b/g)];
  must(live.length === 0, `${PAGE} bakes the element markup into the HTML (${live.length} occurrence(s)): the preview is the renderer`);
  const h2 = [...html.matchAll(/<h2\b[^>]*>/g)].map((match) => match[0]);
  must(h2.length === 1 && /data-site-heading=/.test(h2[0]), `${PAGE} renders ${h2.length} H2s, expected only the template one`);
  const index = read('dist/components/index.html');
  must(index.includes('/components/taginput'), 'the components index does not link to the TagInput page');
  return 'dist/components/taginput.html built, 1 template H2, fences intact, index links it';
});

/* =================================== browser checks =================================== */

const BROWSER_CHECKS = [
  [
    'verification 1 & 2: keyboard alone adds, removes one at a time, Backspace-deletes and clears',
    async (browser, server) =>
      withPage(browser, server.harness, { libraries: ['/static/barnacle.js'] }, async (page, issues) => {
        await page.evaluate(EVENT_LOG);
        const stage = () => readField(page, '#field');
        must((await stage()).found, 'the fixture has no #field');

        // The chips sit before the field in the DOM, so the tab order walks through them first and
        // the field is the last stop of the component — no `focus()` call anywhere in this check.
        await page.keyboard.press('Tab');
        let state = await stage();
        must(state.activeIsButton, 'the first Tab must land on the first chip’s remove button');
        await page.keyboard.press('Tab');
        await page.keyboard.press('Tab');
        state = await stage();
        must(state.activeIsEntry, 'three Tabs must reach the entry field');
        must(state.focusVisible, 'reaching the field with the keyboard must paint :focus-visible');
        // The ring is the base layer's outline; only its offset is tighter (2px), because the entry
        // is a flex item inside a framed field and the chip's frame is 6px away.
        must(
          state.entryStyle.outlineStyle === 'solid' &&
            state.entryStyle.outlineWidth === '3px' &&
            state.entryStyle.outlineOffset === '2px' &&
            state.entryStyle.outlineColor === RING_COLOR,
          `the field's focus ring is incomplete: ${JSON.stringify(state.entryStyle)}`,
        );
        must(state.frame.borderColor === MAIN_SURFACE, 'a focused field must tint its frame with the accent');

        // Add by Enter.
        await page.keyboard.type('UI');
        await page.keyboard.press('Enter');
        state = await stage();
        must(state.chipCount === 3, `Enter did not add a chip (${state.chipCount})`);
        must(state.chipTexts.join() === 'Design,Code,UI', `the chip order is wrong: ${state.chipTexts.join()}`);
        must(state.entryValue === '', 'the field must be empty after committing');
        must(state.activeIsEntry, 'the visitor keeps typing after a commit');

        // Add by comma.
        await page.keyboard.type('Docs');
        await page.keyboard.press(',');
        state = await stage();
        must(state.chipCount === 4 && state.chipTexts.join() === 'Design,Code,UI,Docs', 'the comma did not commit');
        must(state.entryValue === '', 'the comma must never be typed into the field');

        // Remove one at a time from the keyboard: ArrowLeft walks into the last chip, Delete takes
        // it, and focus comes back to the field.
        await page.keyboard.press('ArrowLeft');
        state = await stage();
        must(state.activeIsButton, 'ArrowLeft on an empty field must walk into the last chip');
        await page.keyboard.press('Delete');
        state = await stage();
        must(state.chipCount === 3 && state.chipTexts.join() === 'Design,Code,UI', `Delete took the wrong chip: ${state.chipTexts.join()}`);
        must(state.activeIsEntry, 'focus must return to the field after a keyboard removal');

        // Backspace on the empty field takes the last tag, one press per tag.
        await page.keyboard.press('Backspace');
        await page.keyboard.press('Backspace');
        await page.keyboard.press('Backspace');
        state = await stage();
        must(state.chipCount === 0 && state.tags.length === 0, `Backspace did not empty the field: ${state.chipTexts.join()}`);
        await page.keyboard.press('Backspace');
        state = await stage();
        must(state.tags.length === 0, 'an empty field with no tags must stay empty');

        // Clearing what was typed by keyboard: the field is empty and focused again, and it still
        // accepts a tag.
        await page.keyboard.type('Last');
        await page.keyboard.press('Enter');
        state = await stage();
        must(state.chipCount === 1 && state.tags.join() === 'Last', 'the field still accepts a tag after being emptied');

        must(issues.consoleErrors.length === 0, `console errors: ${issues.consoleErrors.join(' | ')}`);
        must(issues.pageErrors.length === 0, `page errors: ${issues.pageErrors.join(' | ')}`);
        return '3 adds by keyboard, 1 Delete on a focused chip, 3 Backspaces, 1 re-add, ring visible';
      }),
  ],
  [
    'verification 4: removing a tag moves the box not at all — same size, same four border widths',
    async (browser, server) =>
      withPage(browser, server.harness, { libraries: ['/static/barnacle.js'] }, async (page) => {
        await page.evaluate(EVENT_LOG);
        const stage = () => readField(page, '#empty');

        // Fill the empty field from the API so the box under measurement holds three chips on one
        // row: a removal must not change a wrapped layout, so the comparison is about the frame.
        await page.evaluate(() => document.querySelector('#empty').setTags(['One', 'Two', 'Three']));
        const before = await stage();
        must(before.chipCount === 3, `expected three chips, found ${before.chipCount}`);

        // A click on a chip's remove button, at rest (no hover, no focus on the field).
        await page.locator('#empty .bn-taginput-remove').nth(1).click();
        const afterClick = await stage();
        must(afterClick.chipCount === 2, `the click did not remove a chip (${afterClick.chipCount})`);
        must(
          afterClick.rect.width === before.rect.width && afterClick.rect.height === before.rect.height,
          `removing a tag resized the field: ${JSON.stringify(before.rect)} → ${JSON.stringify(afterClick.rect)}`,
        );
        for (const side of ['top', 'right', 'bottom', 'left']) {
          must(
            afterClick.border[side] === BORDER_PX && before.border[side] === BORDER_PX,
            `the ${side} border moved with the removal: ${before.border[side]} → ${afterClick.border[side]}`,
          );
        }

        // The same measurement across a keyboard removal and a programmatic one.
        await page.evaluate(() => document.querySelector('#empty').setTags(['Alpha', 'Beta']));
        const beforeKey = await stage();
        await page.locator('#empty input').focus();
        await page.evaluate(() => document.querySelector('#empty input').focus());
        await page.evaluate(() => {
          const field = document.querySelector('#empty');
          field.querySelector('input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
        });
        const afterKey = await stage();
        must(afterKey.chipCount === 1, `the Backspace did not remove a chip (${afterKey.chipCount})`);
        must(
          afterKey.rect.width === beforeKey.rect.width && afterKey.rect.height === beforeKey.rect.height,
          `a Backspace removal resized the field: ${JSON.stringify(beforeKey.rect)} → ${JSON.stringify(afterKey.rect)}`,
        );
        must(afterKey.border.top === BORDER_PX && afterKey.border.left === BORDER_PX, 'the frame lost a width');

        await page.evaluate(() => document.querySelector('#empty').removeTagAt(0));
        const afterApi = await stage();
        must(afterApi.chipCount === 0, 'the programmatic removal did not clear the last chip');
        must(
          afterApi.rect.width === beforeKey.rect.width && afterApi.rect.height === beforeKey.rect.height,
          `an empty field must keep the box: ${JSON.stringify(beforeKey.rect)} → ${JSON.stringify(afterApi.rect)}`,
        );
        must(afterApi.border.top === BORDER_PX, 'the frame lost a width when the last chip went');
        return `${JSON.stringify(before.rect)} → ${JSON.stringify(afterApi.rect)}, border ${BORDER_PX} on all four sides throughout`;
      }),
  ],
  [
    'verification 3: a programmatic write and a read agree in both directions, and a repeat write is silent',
    async (browser, server) =>
      withPage(browser, server.harness, { libraries: ['/static/barnacle.js'] }, async (page) => {
        await page.evaluate(EVENT_LOG);
        const result = await page.evaluate(() => {
          const field = document.querySelector('#field');
          const events = () => window.__bnChanges.length;
          const first = field.setTags([' Design ', 'design', 'Design', '', '   ', 'Code']);
          const readAfter = field.tags();
          const attributeAfter = field.getAttribute('value');
          const chipsAfter = field.querySelectorAll('.bn-tag').length;
          const eventsAfterWrite = events();

          field.setTags(['Design', 'design', 'Code']);
          const eventsAfterRepeat = events();
          const chipsAfterRepeat = field.querySelectorAll('.bn-tag').length;

          const viaString = field.setTags(' one , TWO ,, one ');
          const readString = field.tags();
          const cleared = field.clearTags();
          const readCleared = field.tags();
          const chipsCleared = field.querySelectorAll('.bn-tag').length;
          const attributeCleared = field.getAttribute('value');

          const copy = field.tags();
          copy.push('Injected');
          const readAfterCopyMutated = field.tags();

          return {
            first,
            readAfter,
            attributeAfter,
            chipsAfter,
            eventsAfterWrite,
            eventsAfterRepeat,
            chipsAfterRepeat,
            viaString,
            readString,
            cleared,
            readCleared,
            chipsCleared,
            attributeCleared,
            readAfterCopyMutated,
          };
        });

        must(result.first.join('|') === 'Design|design|Code', `setTags normalised to ${result.first.join('|')}`);
        must(result.readAfter.join('|') === 'Design|design|Code', 'the read does not agree with the write');
        must(result.attributeAfter === 'Design, design, Code', `the attribute reads ${JSON.stringify(result.attributeAfter)}`);
        must(result.chipsAfter === 3, `expected three chips, found ${result.chipsAfter}`);
        must(result.eventsAfterWrite === 1, `expected one event for the write, found ${result.eventsAfterWrite}`);
        must(result.eventsAfterRepeat === 1, 'writing the set the field already holds must announce nothing');
        must(result.chipsAfterRepeat === 3, 'an idempotent write must not re-render');
        must(result.viaString.join('|') === 'one|TWO', `a comma-joined string wrote ${result.viaString.join('|')}`);
        must(result.readString.join('|') === 'one|TWO', 'the string write does not read back the same');
        must(result.cleared.length === 0 && result.readCleared.length === 0, 'the set did not clear');
        must(result.chipsCleared === 0, 'clearing left chips behind');
        must(result.attributeCleared === '', `a cleared set must reflect an empty value, got ${JSON.stringify(result.attributeCleared)}`);
        must(result.readAfterCopyMutated.join('|') === '', 'tags() handed back the live array');
        return 'setTags → tags() → value agree; repeat write silent; string form and clear agree too';
      }),
  ],
  [
    'verification 5: the bn:change detail, its flags and its target, heard on the document',
    async (browser, server) =>
      withPage(browser, server.harness, { libraries: ['/static/barnacle.js'] }, async (page) => {
        await page.evaluate(EVENT_LOG);
        const log = await page.evaluate(() => {
          const field = document.querySelector('#field');
          const entry = field.querySelector('input');

          entry.value = 'Extra';
          entry.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
          field.querySelector('.bn-taginput-remove').click();
          field.querySelector('input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
          field.setTags(['Design']);
          return window.__bnChanges;
        });

        must(log.length === 4, `expected four announced changes, heard ${log.length}`);
        for (const announced of log) {
          must(announced.type === EVENT, `wrong event type: ${announced.type}`);
          must(announced.isCustomEvent === true, 'the event must be a CustomEvent');
          must(announced.bubbles === true, 'spec §9: bubbles must be true');
          must(announced.composed === true, 'spec §9: composed must be true');
          must(announced.keys.join() === DETAIL_KEYS.join(), `the detail keys are ${announced.keys.join()}, expected ${DETAIL_KEYS.join()}`);
          must(announced.target === 'field', `the event was dispatched on ${announced.target}, not on the element`);
        }
        must(log[0].detail.source === 'input' && log[0].detail.added.join() === 'Extra', `the Enter event reads ${JSON.stringify(log[0].detail)}`);
        must(log[1].detail.source === 'remove' && log[1].detail.removed.length === 1, `the chip click reads ${JSON.stringify(log[1].detail)}`);
        must(log[2].detail.source === 'backspace' && log[2].detail.removed.length === 1, `the Backspace reads ${JSON.stringify(log[2].detail)}`);
        must(log[3].detail.source === 'api' && log[3].detail.tags.join() === 'Design', `the API write reads ${JSON.stringify(log[3].detail)}`);
        return `${log.length} events, all CustomEvent + bubbles + composed, keys {${DETAIL_KEYS.join(', ')}}, sources input/remove/backspace/api`;
      }),
  ],
  [
    'the field is the Form field, statically: same frame, same rest shadow, and nothing lifts',
    async (browser, server) =>
      withPage(browser, server.harness, { libraries: ['/static/barnacle.js'] }, async (page) => {
        const measured = await page.evaluate(() => {
          const field = document.querySelector('#field');
          const plain = document.querySelector('#plain');
          const read = (node) => {
            const style = getComputedStyle(node);
            return {
              borderWidth: style.borderTopWidth,
              borderRadius: style.borderTopLeftRadius,
              boxShadow: style.boxShadow,
              backgroundColor: style.backgroundColor,
              minHeight: style.minHeight,
              transform: style.transform,
            };
          };
          return { field: read(field), plain: read(plain), entry: read(field.querySelector('input')) };
        });

        must(measured.field.borderWidth === BORDER_PX, `the field frame is ${measured.field.borderWidth}`);
        must(measured.plain.borderWidth === BORDER_PX, 'the control field lost its frame');
        must(measured.field.borderRadius === measured.plain.borderRadius, `the radius differs: ${measured.field.borderRadius} vs ${measured.plain.borderRadius}`);
        must(measured.field.boxShadow === SHADOW_SM, `a tag field must rest on the sm tier: ${measured.field.boxShadow}`);
        must(measured.field.backgroundColor === SECONDARY_SURFACE, `the surface is ${measured.field.backgroundColor}`);
        must(measured.field.minHeight === measured.plain.minHeight, `the field floor differs: ${measured.field.minHeight} vs ${measured.plain.minHeight}`);
        must(measured.field.transform === 'none', 'the field must not be displaced at rest');
        must(measured.entry.borderWidth === '0px', `the inner input must lose its own frame, read ${measured.entry.borderWidth}`);
        must(measured.entry.boxShadow === 'none', 'the inner input must not paint a shadow');

        // Hover raises the tier and still moves nothing; a chip and its remove button stay put too.
        await page.locator('#field').hover();
        const hovered = await page.evaluate(() => {
          const field = document.querySelector('#field');
          const chip = document.querySelector('#field .bn-tag');
          return {
            shadow: getComputedStyle(field).boxShadow,
            transform: getComputedStyle(field).transform,
            chipShadow: getComputedStyle(chip).boxShadow,
            chipTransform: getComputedStyle(chip).transform,
            borderWidth: getComputedStyle(field).borderTopWidth,
          };
        });
        must(hovered.shadow === SHADOW_MD, `a hovered field must climb to md: ${hovered.shadow}`);
        must(hovered.transform === 'none', 'a hovered field must not move under the caret');
        must(hovered.borderWidth === BORDER_PX, `a hover changed the frame width: ${hovered.borderWidth}`);
        must(hovered.chipTransform === 'none', 'a chip must not lift');
        return `rest ${SHADOW_SM} → hover ${SHADOW_MD}, transform none throughout, frame ${BORDER_PX}`;
      }),
  ],
  [
    'the disabled state bars the field and every remove button, and keeps its contrast',
    async (browser, server) =>
      withPage(browser, server.harness, { libraries: ['/static/barnacle.js'] }, async (page) => {
        const before = await page.evaluate(() => {
          const field = document.querySelector('#empty');
          field.setAttribute('disabled', '');
          field.setTags(['One', 'Two']);
          const entry = field.querySelector('input');
          const button = field.querySelector('.bn-taginput-remove');
          return {
            entryDisabled: entry.disabled,
            buttonDisabled: button.disabled,
            borderWidth: getComputedStyle(field).borderTopWidth,
            chipCount: field.querySelectorAll('.bn-tag').length,
            tags: field.tags(),
          };
        });
        must(before.entryDisabled === true, 'a disabled tag field must disable its input');
        must(before.buttonDisabled === true, 'a disabled tag field must disable every remove button');
        must(
          before.chipCount === 2 && before.tags.join('|') === 'One|Two',
          `disabling must not destroy the tags: ${before.chipCount} chip(s) / ${JSON.stringify(before.tags)}`,
        );
        must(before.borderWidth === BORDER_PX, `a disabled field keeps its frame: ${before.borderWidth}`);

        await page.evaluate(() => {
          const field = document.querySelector('#empty');
          field.removeAttribute('disabled');
          field.setAttribute('value', 'One, Two');
          field.setTags(['One', 'Two']);
        });
        const after = await page.evaluate(() => {
          const field = document.querySelector('#empty');
          return {
            entryDisabled: field.querySelector('input').disabled,
            buttonDisabled: field.querySelector('.bn-taginput-remove').disabled,
          };
        });
        must(after.entryDisabled === false && after.buttonDisabled === false, 'removing the attribute must re-enable the field');
        return 'disabled → input + buttons disabled, tags kept, frame unchanged; re-enabled in both directions';
      }),
  ],
  [
    'verification 6: with javaScriptEnabled: false the markup is still a readable, typeable text field',
    async (browser, server) =>
      withPage(
        browser,
        server.harness,
        { javaScriptEnabled: false },
        async (page) => {
          const before = await page.evaluate(() => {
            const field = document.querySelector('#field');
            const entry = document.querySelector('#entry');
            const style = getComputedStyle(field);
            return {
              chips: document.querySelectorAll('.bn-tag').length,
              buttons: document.querySelectorAll('.bn-taginput-remove').length,
              entryVisible: entry.getBoundingClientRect().height > 0,
              entryReadable: getComputedStyle(entry).color !== 'rgba(0, 0, 0, 0)',
              entryBorder: getComputedStyle(entry).borderTopWidth,
              frame: { top: style.borderTopWidth, shadow: style.boxShadow },
              text: field.textContent.trim(),
            };
          });
          must(before.chips === 0 && before.buttons === 0, 'without a script nothing may be generated');
          must(before.entryVisible, 'the authored field must be visible');
          must(before.entryReadable, 'the authored field must keep readable ink');
          must(before.entryBorder === '0px', 'the field looks like a tag field even without the script');
          must(before.frame.top === BORDER_PX && before.frame.shadow === SHADOW_SM, 'the field box must not depend on the script');

          await page.locator('#entry').click();
          await page.keyboard.type('Design, Code');
          const typed = await page.evaluate(() => ({
            value: document.querySelector('#entry').value,
            chips: document.querySelectorAll('.bn-tag').length,
            box: document.querySelector('#field').getBoundingClientRect().height,
          }));
          must(typed.value === 'Design, Code', `typing without a script lost the text: ${JSON.stringify(typed.value)}`);
          must(typed.chips === 0, 'a script is required for chips, and only chips');
          must(typed.box > 0, 'the field box collapsed without a script');
          return 'no chips, the authored input keeps the text and the 3px frame with the sm tier';
        },
      ),
  ],
  [
    'the documented example is interactive in the site’s own preview panel',
    async (browser, server) =>
      withPage(browser, server.docs, { libraries: [] }, async (page, issues) => {
        const preview = page.locator('[data-site-demo]').first().locator('.site-demo__panel--preview');
        const field = preview.locator('bn-taginput');
        await field.waitFor();

        const initial = await page.evaluate(() => {
          const root = document.querySelector('[data-site-demo] .site-demo__panel--preview bn-taginput');
          return {
            chips: root.querySelectorAll('.bn-tag').length,
            tags: root.tags(),
            frame: getComputedStyle(root).borderTopWidth,
            entryVisible: root.querySelector('input').getBoundingClientRect().height > 0,
            demos: document.querySelectorAll('[data-site-demo]').length,
            fields: document.querySelectorAll('[data-site-demo] bn-taginput').length,
          };
        });
        must(initial.demos >= 2, `expected both examples to render as demos, found ${initial.demos}`);
        must(initial.fields >= 2, `expected two live <bn-taginput> elements, found ${initial.fields}`);
        must(
          initial.chips === 2 && initial.tags.join('|') === 'Design|Code',
          `the example's initial tags are ${initial.chips} chip(s) / ${JSON.stringify(initial.tags)}`,
        );
        must(initial.frame === BORDER_PX && initial.entryVisible, 'the previewed field is not styled like the library field');

        await field.locator('input').click();
        await page.keyboard.type('Preview');
        await page.keyboard.press('Enter');
        const added = await page.evaluate(() => {
          const root = document.querySelector('[data-site-demo] .site-demo__panel--preview bn-taginput');
          return { chips: root.querySelectorAll('.bn-tag').length, tags: root.tags() };
        });
        must(
          added.chips === 3 && added.tags.join('|') === 'Design|Code|Preview',
          `typing in the preview did not add a tag: ${added.chips} chip(s) / ${JSON.stringify(added.tags)}`,
        );

        await page.locator('[data-site-demo] .site-demo__panel--preview bn-taginput .bn-taginput-remove').first().click();
        const removed = await page.evaluate(() => {
          const root = document.querySelector('[data-site-demo] .site-demo__panel--preview bn-taginput');
          return { chips: root.querySelectorAll('.bn-tag').length, tags: root.tags() };
        });
        must(removed.chips === 2 && !removed.tags.includes('Design'), `clicking a chip's × in the preview did nothing: ${removed.tags.join()}`);

        const disabled = await page.evaluate(() => {
          const fields = [...document.querySelectorAll('[data-site-demo] bn-taginput')];
          const second = fields[1];
          return {
            disabled: second.hasAttribute('disabled'),
            entryDisabled: second.querySelector('input').disabled,
            buttons: [...second.querySelectorAll('.bn-taginput-remove')].map((button) => button.disabled),
          };
        });
        must(disabled.disabled && disabled.entryDisabled, 'the second example must be a disabled field');
        must(disabled.buttons.every(Boolean), 'a disabled example must have disabled remove buttons');

        must(issues.consoleErrors.length === 0, `console errors: ${issues.consoleErrors.join(' | ')}`);
        must(issues.pageErrors.length === 0, `page errors: ${issues.pageErrors.join(' | ')}`);
        return `${initial.fields} live fields; typed + Enter and clicked × in the preview; disabled example honoured; 0 errors`;
      }),
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
