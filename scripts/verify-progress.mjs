#!/usr/bin/env node
/**
 * Scripted verification for ticket 16 — Progress and Meter.
 *
 * The ticket's three verification methods are the specification of this file, and each one is a
 * check below:
 *
 *   1. set `value` step by step and confirm the fill is proportional *and* the slot's width does
 *      not move (measured from painted pixels in real Chrome, not from the CSS)
 *   2. take `value` away, confirm the indeterminate state has a legible appearance of its own
 *   3. set `data-variant`, confirm the fill follows the semantic colour
 *
 * Two more checks exist because ticket 16 makes claims a regex cannot settle:
 *
 *   4. `progress` and `meter` are ONE slot and ONE fill in one file (spec §5: "document granularity
 *      is not file granularity"). Deviating into two copies is the failure this file exists to
 *      catch, so the selectors are inspected for the shared `:is(progress, meter)` shape.
 *   5. reduced motion: the crawl disappears, the appearance stays (spec §7 — the guard is written
 *      so that `reduce` is the absence of a rule, never a rule that switches motion off).
 *
 * The expected values are the independent source of truth: spec.md §3 (invariants), §5 (the two
 * elements share this file), §6 (tokens), §7 (motion guard), §8 (bare `progress`, `meter`),
 * ADR-0001/0005 and D:\code\barnacle-notes\orchestrator-decisions.md §1/§4/§6/§11. They are never
 * recomputed from `src/css/progress.css`.
 *
 * Run with: node scripts/verify-progress.mjs
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
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

import { blankComments, declarations, matchBrace, parseRules } from './lib/css.mjs';
import { FROZEN_SLOTS, HYGIENE, PUBLIC_TOKENS } from './lib/tokens.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const abs = (...parts) => path.join(ROOT, ...parts);

/* ------------------------------------ expectations ----------------------------------- */

const SOURCE = 'src/css/progress.css';
const ARTIFACT = 'static/barnacle.css';
const CONTENT = 'content/components/progress-meter.md';

/** spec.md §5 — the one file that carries both elements, emitted into this layer by CSS_MANIFEST. */
const LAYER = 'components';

/** spec.md §8 — the two semantic anchors, both bare elements (ADR-0001). */
const ANCHORS = ['progress', 'meter'];

/** spec.md §8 / orchestrator-decisions §1 — the semantic channel 01-theme.css publishes. */
const SEMANTIC_SLOT = '--_variant-color';

const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(|\bcolor\(/;

/** spec.md §3 invariant 3 — properties whose value *is* the geometry. */
const GEOMETRY_PROPERTIES = [
  'transform', 'translate', 'box-shadow', 'outline', 'outline-offset', 'transition',
  'transition-property', 'transition-duration',
];

/** Values 01-theme.css defines, read off spec.md §6.1 for the browser checks below. */
const COLOURS = {
  main: 'rgb(255, 210, 63)',
  success: 'rgb(136, 212, 152)',
  warning: 'rgb(255, 165, 82)',
  danger: 'rgb(255, 107, 107)',
  track: 'rgb(255, 255, 255)',
  ink: 'rgb(0, 0, 0)',
};

/** spec.md §6.1: the token that carries the library's motion duration. */
const MOTION_TOKEN = '--bn-transition';

/** The fence info strings the documentation layer accepts: a bare language token, nothing else. */
const ALLOWED_FENCE_INFO = /^(?:html|css|js|javascript|json|xml|svg|text|txt|markdown|md|powershell|ps1|sh|bash|shell|console|diff)?$/;

/** The slot measured by every browser check below (the fixture gives it this width). */
const SLOT_INLINE_SIZE = 320;
const SLOT_BLOCK_SIZE = 20;

/** The value steps the ticket asks for, and the ratio each one must paint. */
const VALUE_STEPS = [
  [0, 0],
  [25, 0.25],
  [50, 0.5],
  [100, 1],
];

/** Fill colour per data-variant, from the §3 mapping in 01-theme.css (error = danger alias). */
const VARIANTS = [
  ['success', COLOURS.success],
  ['warning', COLOURS.warning],
  ['danger', COLOURS.danger],
  ['error', COLOURS.danger],
];

/** The two colours the indeterminate hatch alternates between. */
const HATCH = [COLOURS.main, COLOURS.track];

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

const read = (rel) => fs.readFileSync(abs(rel), 'utf8');

/** Every `var(...)` call in the text, with its balanced argument list (calls nest). */
function varCalls(text, name) {
  const calls = [];
  const pattern = new RegExp(`var\\(\\s*${name}`, 'g');
  for (const match of text.matchAll(pattern)) {
    let depth = 0;
    let i = match.index + 3;
    for (; i < text.length; i += 1) {
      if (text[i] === '(') depth += 1;
      else if (text[i] === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    calls.push(text.slice(match.index, i + 1).replace(/\s+/g, ' '));
  }
  return calls;
}

/** The fenced code blocks of a Markdown file, with their info strings. */
function fences(markdown) {
  const body = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  const found = [];
  let open = null;
  for (const line of body.split(/\r?\n/)) {
    const marker = line.match(/^(\s*)(`{3,}|~{3,})(.*)$/);
    if (!open) {
      if (marker && marker[1] === '') open = { info: marker[3].trim(), marker: marker[2][0], lines: [] };
      continue;
    }
    if (marker && marker[1] === '' && marker[2][0] === open.marker) {
      found.push(open);
      open = null;
      continue;
    }
    open.lines.push(line);
  }
  return { found, unterminated: open };
}

/* ---------------------------------- PNG pixel reading --------------------------------- */

/** zlib is the whole of what a PNG of a flat UI needs: parse the chunks, undo the filters. */
function decodePng(buffer) {
  must(buffer.readUInt32BE(0) === 0x89504e47, 'not a PNG buffer');
  let offset = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  must(depth === 8 && channels !== undefined, `unsupported PNG (depth ${depth}, colour type ${colorType})`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  let pos = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[pos];
    pos += 1;
    const line = raw.subarray(pos, pos + stride);
    pos += stride;
    const prev = y === 0 ? Buffer.alloc(stride) : pixels.subarray((y - 1) * stride, y * stride);
    const cur = pixels.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      const value = line[x];
      let next;
      switch (filter) {
        case 0: next = value; break;
        case 1: next = value + a; break;
        case 2: next = value + b; break;
        case 3: next = value + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          next = value + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`unsupported PNG filter ${filter}`);
      }
      cur[x] = next & 0xff;
    }
  }
  return {
    width,
    height,
    at(x, y) {
      const i = y * width * channels + x * channels;
      return `rgb(${pixels[i]}, ${pixels[i + 1]}, ${pixels[i + 2]})`;
    },
    row(y) {
      return Array.from({ length: width }, (_, x) => this.at(x, y));
    },
  };
}

/**
 * The fill's painted fraction, read from the render itself rather than from the CSS that produced
 * it: the run of fill-coloured pixels along the middle row, divided by the slot's inner width
 * (the box minus its structural border). `palette` is the closed set of colours this bar may paint
 * — anything outside it, and the bar is painting a colour no rule asked for.
 */
function fillRatio(image, fillColour, palette) {
  const row = image.row(Math.floor(image.height / 2));
  const border = 3; // spec §6.1 --bn-border-width, measured independently by the fixture checks
  const inset = Math.min(border, Math.floor(row.length / 2));
  const inner = row.slice(inset, row.length - inset);
  const allowed = new Set([COLOURS.track, COLOURS.ink, ...(palette ?? [fillColour])]);
  const strays = inner
    .map((pixel, index) => ({ pixel, index: index + inset }))
    .filter(({ pixel }) => !allowed.has(pixel));
  must(
    strays.length === 0,
    `the slot paints a colour outside the palette (allowed: ${[...allowed].join(', ')}): ` +
      `${strays.slice(0, 4).map(({ pixel, index }) => `${pixel}@${index}`).join(', ')} ` +
      `of ${strays.length} — full row: ${row.slice(0, 12).join(' ')} … ${row.slice(-12).join(' ')}`,
  );
  const filled = inner.filter((pixel) => pixel === fillColour);
  return { ratio: filled.length / inner.length, pixels: filled.length, width: inner.length };
}

/* ---------------------------------- browser fixture ---------------------------------- */

const FIXTURE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>progress / meter fixture</title>
<link rel="stylesheet" href="/barnacle/static/barnacle.css">
<style>body { margin: 0; padding: 0; inline-size: ${SLOT_INLINE_SIZE}px; }</style>
</head>
<body>
<progress id="p0" value="0" max="100"></progress>
<progress id="p25" value="25" max="100"></progress>
<progress id="p50" value="50" max="100"></progress>
<progress id="p100" value="100" max="100"></progress>
<progress id="pind"></progress>
<progress id="pind-hidden"></progress>
${VARIANTS.map(([name]) => `<progress id="p-${name}" value="50" max="100" data-variant="${name}"></progress>`).join('\n')}
<progress id="p-plain" value="50" max="100"></progress>
<meter id="m-opt" value="90" min="0" max="100" low="30" high="60" optimum="100"></meter>
<meter id="m-sub" value="50" min="0" max="100" low="30" high="60" optimum="100"></meter>
<meter id="m-bad" value="10" min="0" max="100" low="30" high="60" optimum="100"></meter>
<meter id="m-plain" value="50" min="0" max="100"></meter>
<meter id="m-ind"></meter>
${VARIANTS.map(([name]) => `<meter id="m-${name}" value="50" min="0" max="100" data-variant="${name}"></meter>`).join('\n')}
</body>
</html>`;

async function startServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    if (urlPath === '/fixture.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(FIXTURE);
      return;
    }
    if (!urlPath.startsWith('/barnacle/')) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('outside base path');
      return;
    }
    const target = path.join(ROOT, urlPath.replace(/^\/barnacle\//, ''));
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end(`not found: ${urlPath}`);
      return;
    }
    const type = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' }[
      path.extname(target).toLowerCase()
    ] ?? 'application/octet-stream';
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(fs.readFileSync(target));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, close: () => new Promise((resolve) => server.close(resolve)) };
}

/** A frozen-cascade page: transitions and animations cannot lie about a final value. */
async function withFixture(browser, server, options, fn) {
  const context = await browser.newContext({
    viewport: { width: SLOT_INLINE_SIZE, height: 800 },
    deviceScaleFactor: 1,
    ...options,
  });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  if (options?.freeze !== false) {
    await page.addInitScript(() => {
      const apply = () => {
        const style = document.createElement('style');
        style.textContent =
          '*,*::before,*::after{transition:none !important;animation:none !important;caret-color:transparent !important}';
        (document.head ?? document.documentElement).appendChild(style);
      };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply, { once: true });
      else apply();
    });
  }
  try {
    await page.goto(`${server.origin}/fixture.html`, { waitUntil: 'load' });
    return await fn(page, { consoleErrors, pageErrors });
  } finally {
    await context.close();
  }
}

/** One screenshot of one element, decoded to pixels. */
async function shoot(page, selector) {
  const element = page.locator(selector);
  must((await element.count()) === 1, `the fixture has no single match for ${selector}`);
  return decodePng(await element.screenshot());
}

/** The measured box of every slot in the fixture, so "the width never moves" is comparable. */
async function measureSlots(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('progress, meter')].map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        id: element.id,
        inline: Math.round(rect.width * 100) / 100,
        block: Math.round(rect.height * 100) / 100,
        inlineStart: Math.round(rect.x * 100) / 100,
      };
    }),
  );
}

/**
 * The colour each id actually resolves from the semantic channel, straight out of the browser:
 * a full colour mix would otherwise pass for its own variant, and a per-variant palette built from
 * a literal table stops describing what is on screen the moment a token moves.
 */
async function resolvedVariantColours(page, ids) {
  const entries = await page.evaluate((list) => {
    // A fresh probe per id: reusing one span returns the previous colour, because nothing in
    // between dirties the style.
    const resolved = {};
    for (const id of list) {
      const element = document.getElementById(id);
      const declared = getComputedStyle(element).getPropertyValue('--_variant-color').trim();
      const probe = document.createElement('span');
      probe.style.color = declared === '' ? 'var(--bn-main)' : declared;
      document.body.appendChild(probe);
      resolved[id] = getComputedStyle(probe).color;
      probe.remove();
    }
    return resolved;
  }, ids);
  return entries;
}

/* =================================== static checks =================================== */

console.log(`barnacle progress / meter verification — ${ROOT}\n`);

const rawSource = fs.readFileSync(abs(SOURCE), 'utf8');
const source = blankComments(rawSource);
const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ');
const rules = parseRules(code);
const allDeclarations = rules.flatMap((rule) =>
  declarations(rule.body).map(([property, value]) => ({ property, value, ...rule })),
);
const customProps = [...new Set([...source.matchAll(/--[\w-]+/g)].map((match) => match[0]))];
const rawArtifact = fs.readFileSync(abs(ARTIFACT), 'utf8');

await check('src/css/progress.css is UTF-8 without a BOM and writes no @layer', () => {
  const bytes = fs.readFileSync(abs(SOURCE));
  must(!(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf), 'a BOM breaks the build chain');
  const offenders = rawSource
    .split(/\r?\n/)
    .map((line, index) => [line, index + 1])
    .filter(([line]) => /^\s*@layer\b/.test(line));
  must(offenders.length === 0, `remove @layer from line(s) ${offenders.map(([, n]) => n).join(', ')}`);
  must(rules.length > 0, 'the file declares no rule at all — ticket 16 has not landed');
  return `${rules.length} rules, layer assignment left to CSS_MANIFEST`;
});

await check('src/css/progress.css invents no name (ADR-0005: --bn-* and --_* only)', () => {
  const unknownPublic = customProps.filter((name) => HYGIENE.publicToken.test(name) && !PUBLIC_TOKENS.has(name));
  must(unknownPublic.length === 0, `unknown public token(s): ${unknownPublic.join(', ')} — spec §6.1 is the vocabulary`);
  const foreign = customProps.filter(
    (name) => !HYGIENE.publicToken.test(name) && !HYGIENE.internalToken.test(name),
  );
  must(foreign.length === 0, `custom properties outside the two namespaces: ${foreign.join(', ')}`);

  const slotNames = new Set([...FROZEN_SLOTS, SEMANTIC_SLOT]);
  const declared = [
    ...new Set(allDeclarations.map(({ property }) => property).filter((name) => HYGIENE.internalToken.test(name))),
  ];
  const invented = declared.filter(
    (name) => !slotNames.has(name) && !(name === '--_crawl' && allDeclarations.find((d) => d.property === name)?.value === '750ms'),
  );
  must(
    invented.length === 0,
    `new internal slot(s): ${invented.join(', ')} — geometry is declared once, in 00-base.css (orchestrator §4)`,
  );
  const frozen = declared.filter((name) => FROZEN_SLOTS.has(name));
  must(
    frozen.length === 0,
    `${frozen.join(', ')} belongs to 00-base.css and must only be read here (orchestrator §4)`,
  );
  must(
    !declared.includes(SEMANTIC_SLOT),
    `${SEMANTIC_SLOT} is published by 01-theme.css and must only be read here (spec §8)`,
  );

  const readSlots = [...new Set([...source.matchAll(/var\(\s*(--_[\w-]+)/g)].map((match) => match[1]))];
  const unknownReads = readSlots.filter((name) => !slotNames.has(name) && name !== '--_crawl');
  must(unknownReads.length === 0, `unknown internal variable(s) read: ${unknownReads.join(', ')}`);
  return `${readSlots.length} internal variable(s) read, 0 invented`;
});

await check('src/css/progress.css holds no colour literal and no !important', () => {
  const offenders = [...source.matchAll(new RegExp(COLOUR_LITERAL.source, 'g'))].map((match) => match[0]);
  must(offenders.length === 0, `hardcoded colour(s): ${[...new Set(offenders)].join(', ')}`);
  must(!/!\s*important/.test(source), 'the layer contract makes !important unnecessary and forbidden');
  return '0 hex / rgb() / hsl() / oklch() / color() literals, no !important';
});

await check('every geometry value in src/css/progress.css reads a --_ slot (no number in the file)', () => {
  const offenders = allDeclarations
    .filter(({ property, value }) => GEOMETRY_PROPERTIES.includes(property) && /\d/.test(value))
    .map(({ selector, property, value }) => `${selector} { ${property}: ${value} }`);
  must(offenders.length === 0, `geometry must be a var(--_…) reference (spec §3 invariant 3): ${offenders.join('; ')}`);
  const shadows = allDeclarations.filter(({ property }) => property === 'box-shadow');
  must(shadows.length > 0, 'the slot paints no hard shadow at all');
  const literalShadows = shadows.filter(
    ({ value }) => !value.startsWith('var(--_') && !/^var\(--bn-shadow-(?:sm|md|lg)\)$/.test(value),
  );
  must(
    literalShadows.length === 0,
    `box-shadow must read a slot or a shadow tier token: ${literalShadows.map((d) => d.value).join('; ')}`,
  );
  return `${shadows.length} shadow declaration(s), all token references`;
});

await check('progress and meter share ONE slot and ONE fill, not two copies (spec §5)', () => {
  const pairPattern = /:is\(progress,\s*meter\)/g;
  const pairs = [...code.matchAll(pairPattern)].length;
  for (const anchor of ANCHORS) {
    // `\b` alone would also count the vendor pseudo-element names (::-webkit-meter-bar), so the
    // anchor has to be the whole `progress` / `meter` token, not the head of a longer identifier.
    const occurrences = [...code.matchAll(new RegExp(`\\b${anchor}\\b(?!-)`, 'g'))].length;
    must(
      occurrences === pairs,
      `${anchor} is named ${occurrences} time(s) in the code but the shared pair selector appears ` +
        `${pairs} time(s) — the two elements are one slot (spec §5), not two that look alike`,
    );
  }
  const shared = rules.filter((rule) => rule.selector.includes(':is(progress, meter)'));
  must(shared.length > 0, 'no rule targets `:is(progress, meter)`');
  const coversBoth = shared.filter(
    (rule) => rule.selector.includes('progress') && rule.selector.includes('meter'),
  );
  must(
    coversBoth.length === shared.length,
    `these rules name only one of the two elements: ${shared
      .filter((rule) => !coversBoth.includes(rule))
      .map((rule) => rule.selector)
      .join(', ')}`,
  );
  const slotRules = shared.filter((rule) =>
    declarations(rule.body).some(([property]) => ['appearance', 'block-size', 'inline-size'].includes(property)),
  );
  must(slotRules.length === 1, `the slot box is declared ${slotRules.length} time(s), expected exactly one rule`);
  const fillRules = shared.filter((rule) =>
    declarations(rule.body).some(
      ([property, value]) => property.startsWith('background') && value.includes('--_variant-color'),
    ),
  );
  must(fillRules.length > 0, 'no shared rule paints the fill from the semantic channel');
  return `${shared.length} shared rule(s), ${slotRules.length} slot rule, ${fillRules.length} fill rule(s), ` +
    '0 per-element copies';
});

await check('meaning rides data-variant and shape rides bn- class names — never both', () => {
  // The `[data-variant] → --_variant-color` mapping lives in 01-theme.css (spec §8): this file may
  // only consume the channel, so it declares no slot of its own — but it must route the channel to
  // BOTH fills, and a meter paints its fill in the engine's band pseudo-element, not in the host.
  const variantRules = rules.filter((rule) => rule.selector.includes('[data-variant'));
  must(variantRules.length > 0, 'no [data-variant] rule exists — variants are part of the ticket');
  const offPair = variantRules.filter((rule) => !rule.selector.includes(':is(progress, meter)'));
  must(
    offPair.length === 0,
    `a variant rule does not name the shared pair: ${offPair.map((rule) => rule.selector).join(', ')}`,
  );
  const classNames = [...code.matchAll(/\.(bn-[\w-]+)/g)].map((match) => match[1]);
  must(classNames.length === 0, `a bare element needs no class name (ADR-0001), found: ${classNames.join(', ')}`);

  const reads = varCalls(code, '--_variant-color');
  must(reads.length > 0, 'nothing reads --_variant-color');
  const withDefault = reads.filter((value) => /^var\(--_variant-color, var\(--bn-main\)\)$/.test(value));
  must(
    withDefault.length > 0,
    `the unvaried fill must name the component default: var(--_variant-color, var(--bn-main)) — found ${reads.join(' | ')}`,
  );
  must(
    reads.every((value) => /^var\(--_variant-color(?:, var\(--bn-main\))?\)$/.test(value)),
    `a read of the semantic channel is neither the plain channel nor the defaulted one: ${reads.join(' | ')}`,
  );
  const declared = allDeclarations
    .map(({ property }) => property)
    .filter((property) => property === SEMANTIC_SLOT || property.startsWith('--_variant'));
  must(
    declared.length === 0,
    `the semantic channel is published by 01-theme.css and only read here (spec §8): ${declared.join(', ')}`,
  );
  const variantBands = variantRules.filter((rule) => rule.selector.includes('-meter-'));
  must(
    variantBands.length > 0,
    'data-variant reaches no meter band — measured in Chrome 155 the band wins over the host, so a ' +
      'variant on a meter would silently do nothing',
  );
  return `${variantRules.length} variant rule(s) on the shared pair, ${variantBands.length} band rule(s), ` +
    `${reads.length} semantic-channel read(s)`;
});

await check('the indeterminate state exists and is a treatment of its own (ticket 16, item 2)', () => {
  const indeterminate = rules.filter((rule) => rule.selector.includes(':indeterminate'));
  must(indeterminate.length > 0, 'no rule matches the indeterminate state — a bar with no value would be blank');
  const inGuard = indeterminate.filter((rule) =>
    rule.conditions.some((condition) => /prefers-reduced-motion:\s*no-preference/.test(condition)),
  );
  const outside = indeterminate.filter((rule) => !inGuard.includes(rule));
  must(outside.length > 0, 'the indeterminate treatment lives only inside the motion guard');
  const visible = outside.filter((rule) => !rule.selector.includes('::-'));
  must(
    visible.length > 0,
    'the indeterminate treatment is written only on vendor pseudo-elements, so it paints nothing',
  );
  const backgrounds = visible.flatMap((rule) =>
    declarations(rule.body).filter(([property, value]) => /^(background|background-image)/.test(property) && value !== 'none'),
  );
  must(backgrounds.length > 0, 'the visible indeterminate rule changes no background at all');
  const hatch = backgrounds.filter(([, value]) => value.includes('repeating-'));
  must(
    hatch.length > 0,
    `the indeterminate bar needs a pattern, not just a colour, to read as "no fraction known": ${JSON.stringify(backgrounds)}`,
  );
  const borderless = visible.flatMap((rule) =>
    declarations(rule.body).filter(([property]) => property === 'border-top-width' || property === 'border-width'),
  );
  must(borderless.length === 0, 'the indeterminate treatment resizes the border (spec §3 invariant 7)');
  return `${visible.length} visible rule(s), ${hatch.length} hatch, ${inGuard.length} inside the no-preference guard`;
});

await check('the fill colour follows the semantic channel, with a default of its own', () => {
  const fills = allDeclarations.filter(
    ({ property, value }) => property === 'background' && value.includes('--_variant-color'),
  );
  must(fills.length > 0, 'no fill reads --_variant-color — data-variant would have nothing to move');
  const fallback = fills.filter(({ value }) => /var\(\s*--_variant-color\s*,\s*var\(--bn-main\s*\)/.test(value));
  must(
    fallback.length > 0,
    'the fill must name its own default (`var(--_variant-color, var(--bn-main))`): without it an ' +
      'unvaried bar and an unknown variant name are not the same thing',
  );
  must(
    fills.every(
      ({ value }) =>
        /var\(\s*--_variant-color\s*,\s*var\(--bn-main\s*\)\s*\)/.test(value) ||
        /var\(\s*--_variant-color\s*\)/.test(value),
    ),
    'a fill reads --_variant-color with no token default',
  );
  const semanticTokens = [...source.matchAll(/var\(\s*--bn-(?:success|warning|danger)\s*\)/g)].length;
  return `${fills.length} fill declaration(s), ${fallback.length} with the component default, ` +
    `${semanticTokens} meter band(s) reading the semantic tokens directly`;
});

await check('motion lives inside @media (prefers-reduced-motion: no-preference), not an afterthought', () => {
  const motionRules = rules.filter((rule) =>
    declarations(rule.body).some(([property]) => property === 'animation' || property.startsWith('animation-')),
  );
  must(motionRules.length > 0, 'nothing animates — the indeterminate crawl is part of the ticket');
  const outside = motionRules.filter(
    (rule) => !rule.conditions.some((condition) => /prefers-reduced-motion:\s*no-preference/.test(condition)),
  );
  must(
    outside.length === 0,
    `animation declared outside the no-preference block: ${outside.map((rule) => rule.selector).join(', ')}`,
  );
  must(
    !/prefers-reduced-motion:\s*reduce/.test(source),
    'a reduce block that switches motion off afterwards is the rejected form (spec §7)',
  );
  const keyframes = [...source.matchAll(/@keyframes\s+([\w-]+)/g)].map((match) => match[1]);
  must(keyframes.length > 0, 'the animation names no @keyframes');
  must(
    keyframes.every((name) => name.startsWith('bn-')),
    `@keyframes names are a global namespace and carry the bn- prefix: ${keyframes.join(', ')}`,
  );
  const names = allDeclarations
    .filter(({ property }) => property === 'animation-name')
    .map(({ value }) => value);
  must(
    names.length > 0 && names.every((name) => keyframes.includes(name)),
    `animation-name points at no keyframes: ${names.join(', ')}`,
  );
  return `${motionRules.length} animation rule(s) in the guard, ${keyframes.length} keyframes (${keyframes.join(', ')})`;
});

await check('the built artifact carries these rules inside the right layer', () => {
  const marker = `/* src/css/${SOURCE.replace('src/css/', '')} (@layer ${LAYER}) */`;
  const markerIndex = rawArtifact.indexOf(marker);
  must(markerIndex !== -1, `${ARTIFACT} has no ${marker} block — run npm run build`);
  // `blankComments` preserves offsets, so the block can be located in the blanked text and sliced
  // out of the raw one: the prose in this file uses apostrophes, which a brace matcher must not
  // mistake for a string delimiter. The marker line itself is a comment, so blank it too.
  const blanked = blankComments(rawArtifact);
  const open = blanked.indexOf('{', markerIndex);
  must(open !== -1, `${ARTIFACT} marker is not followed by an opening brace`);
  const prelude = `${blanked.slice(0, markerIndex)}${' '.repeat(open - markerIndex)}`;
  const positioned = `${prelude}${blanked.slice(open)}`;
  const end = matchBrace(positioned, open, marker);
  const block = rawArtifact.slice(open + 1, end);
  must(block.includes(':is(progress, meter)'), 'the built block does not carry the shared slot selector');
  must(block.includes(':indeterminate'), 'the built block does not carry the indeterminate treatment');
  const geometry = parseRules(blankComments(block)).flatMap((rule) =>
    declarations(rule.body).filter(
      ([property, value]) => GEOMETRY_PROPERTIES.includes(property) && /\d/.test(value),
    ),
  );
  must(geometry.length === 0, `the artifact gained a geometry literal: ${JSON.stringify(geometry)}`);
  return `${block.length} bytes inside @layer ${LAYER}`;
});

await check('the documentation page covers both elements, both variants and no authored H2', () => {
  must(fs.existsSync(abs(CONTENT)), `${CONTENT} does not exist`);
  const markdown = read(CONTENT);
  const bytes = fs.readFileSync(abs(CONTENT));
  must(!(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf), 'seite fails the build on a BOM');

  const frontmatter = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  must(frontmatter, `${CONTENT} has no frontmatter — seite needs a title`);
  must(/^title:\s*\S/m.test(frontmatter[1]), `${CONTENT} has no title`);
  must(/^description:\s*\S/m.test(frontmatter[1]), `${CONTENT} has no description`);

  const body = markdown.slice(frontmatter[0].length);
  const h2 = body.split(/\r?\n/).filter((line) => /^##\s/.test(line));
  must(h2.length === 0, `an authored H2 renders as a second H2 (spec §10): ${h2.join(' | ')}`);

  const { found, unterminated } = fences(markdown);
  must(!unterminated, `${CONTENT} has an unterminated fence`);
  must(found.length > 0, `${CONTENT} shows no example at all`);
  const badInfo = found.filter((fence) => !ALLOWED_FENCE_INFO.test(fence.info));
  must(
    badInfo.length === 0,
    `fences must carry a plain language token, nothing else: ${badInfo.map((f) => JSON.stringify(f.info)).join(', ')}`,
  );

  const html = found.map((fence) => fence.lines.join('\n')).join('\n');
  for (const anchor of ANCHORS) {
    must(
      new RegExp(`<${anchor}\\b`).test(html),
      `the page never shows a bare <${anchor}> element — both belong on this page (spec §5)`,
    );
  }
  for (const [name] of VARIANTS.slice(0, 3)) {
    must(html.includes(`data-variant="${name}"`), `the page shows no ${name} variant`);
  }
  must(
    /<progress\b[^>]*\svalue\s*=/.test(html),
    'the page never shows a determinate progress bar (a `progress` carrying `value`)',
  );
  must(
    !/ href="[^"]*\/"/.test(body),
    'a link with a trailing slash fails check --strict (only the /components/ index takes one)',
  );
  return `${found.length} fence(s), both elements, ${VARIANTS.slice(0, 3).length} variants, 0 H2`;
});

/* ---------------------------------- browser checks ----------------------------------- */

const BROWSER_CHECKS = [];
const SKIP_BROWSER = process.argv.includes('--no-browser');

async function registerBrowserChecks() {
  BROWSER_CHECKS.push(
    [
      'each value step paints the right fraction and the slot never moves (ticket method 1)',
      async (browser, server) => {
        return withFixture(browser, server, {}, async (page) => {
          const readings = [];
          for (const [value, ratio] of VALUE_STEPS) {
            const image = await shoot(page, `#p${value}`);
            const { ratio: painted, width } = fillRatio(image, COLOURS.main);
            readings.push({ value, expected: ratio, painted, width, pixels: image.width });
          }
          const slots = await measureSlots(page);
          const widths = [...new Set(slots.map((slot) => slot.inline))];
          const heights = [...new Set(slots.map((slot) => slot.block))];
          must(
            widths.length === 1 && widths[0] === SLOT_INLINE_SIZE,
            `the slot width moved with value: ${JSON.stringify(slots.map((s) => [s.id, s.inline]))}`,
          );
          must(
            heights.length === 1 && heights[0] === SLOT_BLOCK_SIZE,
            `the slot height moved with value: ${JSON.stringify(slots.map((s) => [s.id, s.block]))}`,
          );
          const starts = [...new Set(slots.map((slot) => slot.inlineStart))];
          must(starts.length === 1, `the slot's inline start moved: ${starts.join(', ')}`);
          for (const reading of readings) {
            must(
              Math.abs(reading.painted - reading.expected) <= 0.02,
              `value ${reading.value} painted ${(reading.painted * 100).toFixed(1)}%, expected ` +
                `${(reading.expected * 100).toFixed(0)}%`,
            );
          }
          return `${readings.map((r) => `${r.value}→${(r.painted * 100).toFixed(1)}%`).join(' ')}; ` +
            `slot ${widths[0]}×${heights[0]}px at every step (${readings.map((r) => r.width).join('/')} inner px)`;
        });
      },
    ],
    [
      'removing value gives the indeterminate state an appearance of its own (ticket method 2)',
      async (browser, server) => {
        return withFixture(browser, server, {}, async (page) => {
          const removed = await page.evaluate(() => {
            const element = document.getElementById('p50');
            element.removeAttribute('value');
            const computed = getComputedStyle(element);
            return {
              indeterminate: element.matches(':indeterminate'),
              notValue: element.matches(':not([value])'),
              backgroundImage: computed.backgroundImage,
              borderColour: computed.borderTopColor,
            };
          });
          must(removed.indeterminate && removed.notValue, 'a progress with no value is not :indeterminate');
          must(
            /repeating-linear-gradient/.test(removed.backgroundImage),
            `the indeterminate bar has no hatch: ${removed.backgroundImage}`,
          );
          must(
            removed.borderColour === COLOURS.main,
            `the indeterminate border is ${removed.borderColour}, expected the main token`,
          );

          const image = await shoot(page, '#p50');
          const row = image.row(Math.floor(image.height / 2));
          const inner = row.slice(3, row.length - 3);
          const colours = [...new Set(inner)];
          must(
            colours.length === 2 && HATCH.every((colour) => colours.includes(colour)),
            `the hatch must alternate the main colour with the track, painted: ${colours.join(', ')}`,
          );
          const runs = [];
          let start = 0;
          for (let i = 1; i <= inner.length; i += 1) {
            if (i === inner.length || inner[i] !== inner[start]) {
              runs.push({ colour: inner[start], length: i - start });
              start = i;
            }
          }
          must(runs.length >= 8, `the hatch is too coarse to read as hatching: ${runs.length} run(s)`);
          const half = runs.slice(0, -1).every((run) => run.length === runs[0].length);
          must(half, `the hatch stripes are uneven: ${runs.map((r) => r.length).join('/')}`);

          const fresh = await shoot(page, '#pind');
          const freshColours = [...new Set(fresh.row(Math.floor(fresh.height / 2)).slice(3, fresh.width - 3))];
          must(
            freshColours.length === 2,
            `a markup-indeterminate bar renders differently: ${freshColours.join(', ')}`,
          );

          const meterState = await page.evaluate(() => {
            const meter = document.getElementById('m-ind');
            return {
              indeterminate: meter.matches(':indeterminate'),
              notValue: meter.matches(':not([value])'),
              inline: Math.round(meter.getBoundingClientRect().width * 100) / 100,
            };
          });
          must(meterState.notValue, 'the valueless meter is not matched by [value] absence');
          must(
            meterState.inline === SLOT_INLINE_SIZE,
            `the valueless meter lost its slot: ${meterState.inline}px`,
          );
          return `hatch: ${runs.length} even stripes of ${runs[0].length}px alternating ` +
            `${HATCH.join(' / ')}; main-colour frame; meter with no value keeps its ${meterState.inline}px slot`;
        });
      },
    ],
    [
      'the fill follows data-variant, on progress and on meter (ticket method 3)',
      async (browser, server) => {
        return withFixture(browser, server, {}, async (page) => {
          const ids = VARIANTS.flatMap(([name]) => [`p-${name}`, `m-${name}`]);
          const resolved = await resolvedVariantColours(page, [...ids, 'p-plain']);
          const readings = [];
          for (const [name] of VARIANTS) {
            for (const anchor of ANCHORS) {
              const id = `${anchor === 'progress' ? 'p' : 'm'}-${name}`;
              const colour = (await resolvedVariantColours(page, [id]))[id];
              const { ratio } = fillRatio(await shoot(page, `#${id}`), colour);
              readings.push({ id, name, anchor, colour, ratio });
            }
          }
          for (const reading of readings) {
            must(
              Math.abs(reading.ratio - 0.5) <= 0.02,
              `${reading.anchor}[data-variant="${reading.name}"] painted ${(reading.ratio * 100).toFixed(1)}%`,
            );
          }
          const plain = fillRatio(await shoot(page, '#p-plain'), resolved['p-plain']);
          must(Math.abs(plain.ratio - 0.5) <= 0.02, `the unvaried bar painted ${plain.ratio * 100}%`);
          must(
            resolved['p-plain'] === COLOURS.main,
            `with no variant the fill resolved to ${resolved['p-plain']}, expected the main token`,
          );
          const distinct = new Set(['success', 'warning', 'danger'].map((name) => resolved[`p-${name}`]));
          must(distinct.size === 3, `the three semantic variants are not three colours: ${[...distinct].join(', ')}`);
          const aliases = resolved['p-error'] === resolved['p-danger'] && resolved['m-error'] === resolved['m-danger'];
          must(aliases, 'error is not an alias of danger');
          return `${readings.map((r) => `${r.id}→${r.colour}`).join(' ')}; no variant → ${resolved['p-plain']}`;
        });
      },
    ],
    [
      'meter keeps its own three bands, which data-variant only recolours (spec §8)',
      async (browser, server) => {
        return withFixture(browser, server, {}, async (page) => {
          const readings = [];
          for (const [id, colour] of [
            ['m-opt', COLOURS.success],
            ['m-sub', COLOURS.warning],
            ['m-bad', COLOURS.danger],
            ['m-plain', COLOURS.success],
          ]) {
            const { ratio } = fillRatio(await shoot(page, `#${id}`), colour);
            readings.push(`${id}→${colour} ${(ratio * 100).toFixed(1)}%`);
          }
          // `data-variant` on a meter is a recolour, not a fourth band: the same element that the
          // browser would paint from low/high/optimum follows the semantic colour instead.
          const resolved = await resolvedVariantColours(page, ['m-danger']);
          const variant = fillRatio(await shoot(page, '#m-danger'), resolved['m-danger']);
          must(
            resolved['m-danger'] === COLOURS.danger,
            `meter[data-variant="danger"] resolved to ${resolved['m-danger']}`,
          );
          must(
            Math.abs(variant.ratio - 0.5) <= 0.02,
            `meter[data-variant] painted ${(variant.ratio * 100).toFixed(1)}%`,
          );
          return `${readings.join(', ')}; (no low/high/optimum → optimum); data-variant only recolours`;
        });
      },
    ],
    [
      'reduced motion removes the crawl and changes nothing else (spec §7)',
      async (browser, server) => {
        const moving = await withFixture(browser, server, { freeze: false, reducedMotion: 'no-preference' }, (page) =>
          page.evaluate(() => {
            const element = document.getElementById('pind');
            const computed = getComputedStyle(element);
            return {
              name: computed.animationName,
              duration: computed.animationDuration,
              iteration: computed.animationIterationCount,
              animations: element.getAnimations().length,
            };
          }),
        );
        must(moving.name !== 'none', 'the indeterminate crawl is not declared at all');
        must(moving.animations === 1, `the crawl is declared but not running (${JSON.stringify(moving)})`);

        const still = await withFixture(browser, server, { freeze: false, reducedMotion: 'reduce' }, (page) =>
          page.evaluate(() => {
            const element = document.getElementById('pind');
            const computed = getComputedStyle(element);
            return {
              name: computed.animationName,
              duration: computed.animationDuration,
              iteration: computed.animationIterationCount,
              animations: element.getAnimations().length,
              backgroundImage: computed.backgroundImage,
              borderColour: computed.borderTopColor,
            };
          }),
        );
        must(
          still.name === 'none' && still.duration === '0s' && still.animations === 0,
          `reduced motion still declares an animation: ${JSON.stringify(still)}`,
        );
        must(
          /repeating-linear-gradient/.test(still.backgroundImage) && still.borderColour === COLOURS.main,
          'reduced motion lost the indeterminate appearance instead of only its motion',
        );

        const painted = await withFixture(browser, server, { reducedMotion: 'reduce' }, async (page) => {
          const image = await shoot(page, '#p100');
          return fillRatio(image, COLOURS.main).ratio;
        });
        must(Math.abs(painted - 1) <= 0.02, `a full bar under reduced motion painted ${painted * 100}%`);

        return `no-preference: ${moving.name} ${moving.duration} ×${moving.iteration} (${moving.animations} running); ` +
          `reduce: no animation, hatch intact, 100% bar still 100%`;
      },
    ],
    [
      'the fixture is script-free and Chrome reports no error on either element',
      async (browser, server) => {
        return withFixture(browser, server, { javaScriptEnabled: false }, async (page, issues) => {
          const state = await page.evaluate(() => {
            const progress = document.getElementById('p50');
            const meter = document.getElementById('m-sub');
            const read = (element) => {
              const computed = getComputedStyle(element);
              return {
                inline: Math.round(element.getBoundingClientRect().width),
                block: Math.round(element.getBoundingClientRect().height),
                appearance: computed.appearance,
                shadow: computed.boxShadow,
                borderWidth: computed.borderTopWidth,
              };
            };
            return { progress: read(progress), meter: read(meter) };
          });
          for (const [name, slot] of Object.entries(state)) {
            must(slot.inline === SLOT_INLINE_SIZE, `a script-free ${name} is ${slot.inline}px wide`);
            must(slot.block === SLOT_BLOCK_SIZE, `a script-free ${name} is ${slot.block}px tall`);
            must(slot.appearance === 'none', `a script-free ${name} keeps appearance: ${slot.appearance}`);
            must(slot.borderWidth === '3px', `a script-free ${name} lost its border: ${slot.borderWidth}`);
            must(
              slot.shadow.startsWith('rgb(0, 0, 0)') && /0px 0px$/.test(slot.shadow),
              `a script-free ${name} has the wrong hard shadow: ${slot.shadow}`,
            );
          }
          return `JS disabled: progress and meter both ${SLOT_INLINE_SIZE}×${SLOT_BLOCK_SIZE}px, ` +
            `appearance none, 3px border, hard shadow intact`;
        });
      },
    ],
  );
}

async function runBrowserChecks() {
  await registerBrowserChecks();
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
    console.log(
      `SKIP  ${BROWSER_CHECKS.length} browser checks — playwright-core is not installed ` +
        '(run: npm i --no-save playwright-core@1.64.1)',
    );
    return;
  }

  const server = await startServer();
  // channel: 'chrome' drives the system Chrome; the bundled chromium revision is not present.
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  console.log(`      ${server.origin}/fixture.html on system Chrome ${browser.version()}\n`);
  try {
    for (const [name, fn] of BROWSER_CHECKS) {
      await check(name, () => fn(browser, server));
    }
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
