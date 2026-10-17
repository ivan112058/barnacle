#!/usr/bin/env node
/**
 * Scripted verification for ticket 17 — Layout and Utilities.
 *
 * The ticket's three verification methods are the specification of this file; each one is a
 * check below, made repeatable instead of a one-off manual pass:
 *
 *   1. scale the window from narrowest to widest and confirm the grid wraps correctly and
 *      never overflows horizontally (real Chrome, `document.documentElement.scrollWidth`)
 *   2. search the class names and confirm the utilities do not collide with the visual
 *      modifier names (.bn-outline / .bn-ghost / .bn-sm / .bn-lg / .bn-attached / .bn-icon …)
 *   3. confirm the docs site's components index and a component page were re-laid-out on the
 *      grid without a visual regression — the key readings (container width, cards per row,
 *      card widths) are the grid's own breakpoint contract, and the before/after numbers are
 *      recorded in the ticket Answer.
 *
 * The expected values are the independent source of truth: the ticket's deliverable list,
 * spec.md §5 (layout.css / utilities.css), §8 (Layout = .bn-container / .bn-row / .bn-col-*,
 * 12 columns and a breakpoint; Utilities = a *bounded* set), ADR-0005 (`bn-` / `--bn-` / `--_`)
 * and ADR-0006 (the utilities layer wins inside the library, unlayered user CSS wins outside
 * it). They are never recomputed from the stylesheets under test.
 *
 * Run with: node scripts/verify-layout.mjs
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
import { listenOnFreePort } from './lib/server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const abs = (...parts) => path.join(ROOT, ...parts);
const DIST = abs('dist');

/* ------------------------------------ expectations ----------------------------------- */

const GRID = {
  layoutFile: 'src/css/layout.css',
  utilitiesFile: 'src/css/utilities.css',
  /** The ticket: "栅格为 12 列". */
  columns: 12,
  /** The ticket: "断点行为明确且写进文档页" — four measurements have to be documented. */
  breakpointRem: 48,
  breakpointPx: 768,
  /** Must stay bounded: the ticket and the docs page both say "有界, 不做大而全". */
  maxUtilities: 28,
};

/** The docs site's own max content width (static/style.css `--site-width`), in rem. */
const SITE_WIDTH_REM = 62;

/** The prose measure (`--site-prose-measure` in static/style.css), in rem. */
const PROSE_MEASURE_REM = 46;

/**
 * The bounded utility set: 3 + 1 + 4 + 8 + 2 + 2 = 20 classes in five groups — one screen of
 * documentation, no numeric axis beyond a 2/4/8/16 scale, and no responsive prefixes.
 */
const UTILITY_GROUPS = [
  { name: 'text alignment', classes: ['bn-text-start', 'bn-text-center', 'bn-text-end'] },
  { name: 'visually hidden', classes: ['bn-visually-hidden'] },
  { name: 'layout combinations', classes: ['bn-stack', 'bn-cluster', 'bn-center', 'bn-between'] },
  {
    name: 'block spacing',
    classes: ['bn-mt-2', 'bn-mt-4', 'bn-mt-8', 'bn-mt-16', 'bn-mb-2', 'bn-mb-4', 'bn-mb-8', 'bn-mb-16'],
  },
  { name: 'sizing', classes: ['bn-w-full', 'bn-truncate'] },
  { name: 'list and text colour', classes: ['bn-list-none', 'bn-text-muted'] },
];

const UTILITY_CLASSES = UTILITY_GROUPS.flatMap((group) => group.classes);

/** Spacing is a 2/4/8/16 scale, never an arbitrary number. */
const SPACING_STEPS = { 2: '0.5rem', 4: '1rem', 8: '2rem', 16: '4rem' };

/**
 * The visual modifier names the ticket names explicitly, plus the other shape classes the
 * artifact already ships. The utility names must not collide with any of them: a utility that
 * took `.bn-sm` would silently redefine a button size.
 */
const VISUAL_MODIFIERS = [
  'bn-outline',
  'bn-ghost',
  'bn-sm',
  'bn-lg',
  'bn-attached',
  'bn-icon',
  'bn-button',
  'bn-button-group',
];

/** Templates that must place blocks with `.bn-row` / `.bn-col-*` (base.html supplies the container). */
const GRID_CONSUMER_TEMPLATES = [
  'templates/components-index.html',
  'templates/component.html',
  'templates/page.html',
  'templates/index.html',
];

const CONTENT_PAGES = ['content/components/layout.md', 'content/components/utilities.md'];

const SITE_CSS = 'static/style.css';

const ARTIFACTS = ['static/barnacle.css', 'static/barnacle.min.css'];

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

/**
 * The stylesheet text with comments removed. Every structural claim below is about *rules*:
 * a class name quoted inside a comment is documentation, not a selector, and these two files
 * are heavily commented on purpose.
 */
const withoutComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * Every `selector { body }` pair in a stylesheet, comments stripped.
 *
 * The match starts at a `}` *without consuming it* (`(?<=\})`), so two adjacent rules are two
 * matches. A pattern that consumes the brace silently skips every other rule — which is exactly
 * the failure mode this helper exists to prevent: `.bn-col-2` would go missing and the check
 * would report a real-looking gap.
 *
 * Selectors are compared literally: `.bn-col-1` must be matched by the rule *named* `.bn-col-1`,
 * never by an earlier rule whose selector happens to contain a matching substring.
 */
function rules(css) {
  return [...withoutComments(css).matchAll(/(?<=\}|^)\s*([^{}@][^{}]*?)\s*\{([^{}]*?)\}(?!\s*[;}])/g)].map((match) => ({
    selector: match[1].replace(/\s+/g, ' ').trim(),
    body: match[2],
  }));
}

/** The declaration body of the one rule whose selector is exactly `selector`, or null. */
function ruleBody(css, selector) {
  return rules(css).find((rule) => rule.selector === selector)?.body ?? null;
}

/** What `--_span` a `.bn-col-<n>` class writes, or null when the class has no single rule. */
function declaredSpan(css, className) {
  const body = ruleBody(css, `.${className}`);
  if (body === null) return null;
  const match = body.match(/--_span\s*:\s*(\d+)\s*;/);
  return match ? Number(match[1]) : null;
}

/** Every `.bn-*` class name a stylesheet *declares* (never one it merely mentions). */
function declaredClasses(css) {
  const names = new Set();
  for (const rule of rules(css)) {
    for (const cls of rule.selector.matchAll(/\.(bn-[a-z0-9-]+)/g)) names.add(cls[1]);
  }
  return [...names];
}

/** The one rule that names the whole `.bn-col-*` family and defaults `--_span`. */
function columnFamilyRule(css) {
  return (
    rules(css).find(
      (rule) =>
        /bn-col-1\b/.test(rule.selector) &&
        /bn-col-12\b/.test(rule.selector) &&
        /--_span\s*:/.test(rule.body),
    ) ?? null
  );
}

/* --------------------------------- markdown structure -------------------------------- */

/** Split a content file into frontmatter, prose and fences (same rule as verify-demo.mjs). */
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
      if (marker && marker[1] === '') open = { marker: marker[2], info: marker[3].trim(), lines: [] };
      else proseLines.push(line);
      continue;
    }
    if (marker && marker[1] === '' && marker[2][0] === open.marker[0] && marker[2].length >= open.marker.length) {
      fences.push({ info: open.info, text: open.lines.join('\n') });
      open = null;
      continue;
    }
    open.lines.push(line);
  }
  if (open) fences.push({ info: open.info, text: open.lines.join('\n'), unterminated: true });
  return { frontmatter, prose: proseLines.join('\n'), fences };
}

/** Prose with inline code spans removed: `<button>` in backticks is text, not markup. */
const proseWithoutInlineCode = (prose) => prose.replace(/`[^`]*`/g, '``');

/** A fence info string must stay a bare language token (ticket 04's rule, kept here). */
const ALLOWED_FENCE_INFO =
  /^(?:html|css|js|javascript|json|xml|svg|text|txt|markdown|md|powershell|ps1|sh|bash|shell|console|diff)?$/;

/* --------------------------------------- state --------------------------------------- */

const SEITE = locateSeite();
if (!SEITE) {
  console.error('seite CLI not found. Set SEITE_BIN or install seite 0.20.1.');
  process.exit(1);
}

const argv = process.argv.slice(2);
const SKIP_BUILD = argv.includes('--no-build');
const SKIP_BROWSER = argv.includes('--no-browser');

console.log(`barnacle layout verification — ${ROOT}`);
console.log(`CLI: ${SEITE.version} at ${SEITE.bin}\n`);

/* ============================== static: layout.css =================================== */

let layout = '';
let utilities = '';

await check(`${GRID.layoutFile} exists and the stylesheet is wired into the build`, () => {
  must(exists(GRID.layoutFile), `${GRID.layoutFile} is missing`);
  layout = read(GRID.layoutFile);
  must(layout.trim().length > 0, `${GRID.layoutFile} is still the empty placeholder`);
  must(/layout\.css/.test(read('scripts/build.mjs')), 'scripts/build.mjs does not list layout.css');
  return `${layout.length}B`;
});

await check('the grid is 12 columns, expressed once and reused by every column class', () => {
  const code = withoutComments(layout);
  const declared = code.match(/--_grid-columns\s*:\s*(\d+)\s*;/);
  must(declared, ':root does not declare --_grid-columns');
  must(Number(declared[1]) === GRID.columns, `--_grid-columns is ${declared[1]}, expected ${GRID.columns}`);
  const row = ruleBody(layout, '.bn-row');
  must(row !== null, 'layout.css has no .bn-row rule');
  must(/display\s*:\s*grid/.test(row), `.bn-row must use display: grid (found: ${row.trim().slice(0, 60)})`);
  must(
    /grid-template-columns\s*:\s*repeat\(\s*var\(--_grid-columns\)\s*,\s*minmax\(0\s*,\s*1fr\)\s*\)/.test(row),
    '.bn-row must template repeat(var(--_grid-columns), minmax(0, 1fr)) — minmax(0, …) is what lets ' +
      'a long unbreakable token shrink instead of widening the track',
  );
  must(/gap\s*:/.test(row), '.bn-row declares no gap: adjacent hard shadows would collide');
  return 'display: grid / repeat(12, minmax(0, 1fr)) driven by --_grid-columns';
});

await check('all twelve .bn-col-1 … .bn-col-12 classes exist with the right span', () => {
  const spans = {};
  for (let span = 1; span <= GRID.columns; span += 1) spans[span] = declaredSpan(layout, `bn-col-${span}`);
  const missing = Object.entries(spans).filter(([, value]) => value === null).map(([span]) => `bn-col-${span}`);
  must(missing.length === 0, `no --_span declaration for: ${missing.join(', ')}`);
  const wrong = Object.entries(spans)
    .filter(([span, value]) => Number(span) !== value)
    .map(([span, value]) => `bn-col-${span} declares ${value}`);
  must(wrong.length === 0, `columns are numbered wrong: ${wrong.join(', ')}`);
  return `1..${GRID.columns} all present, each writing its own --_span`;
});

await check('the column rule consumes --_span and never lets content widen a track', () => {
  const family = columnFamilyRule(layout);
  must(family, 'no single rule selects the whole .bn-col-* family and defaults --_span');
  must(
    /grid-column\s*:\s*span[^;]*var\(--_span\)/.test(family.body),
    `the column rule does not span var(--_span): ${family.body.trim().slice(0, 80)}`,
  );
  must(
    /min-inline-size\s*:\s*0/.test(family.body),
    'the column rule must set min-inline-size: 0 — a grid item defaults to min-content and would ' +
      'push the row wider than its container',
  );
  must(!/--_span\s*:\s*\d/.test(family.body), 'the shared rule must not hardcode a span');
  return `${family.selector.slice(0, 60)}…`;
});

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

await check('the breakpoint behaviour is explicit, in the column rule, at 768px / 48rem', () => {
  const clean = withoutComments(layout);
  const media = [...clean.matchAll(/@media\s*\(([^)]*)\)\s*\{([\s\S]*?)\n\s*\}/g)].map((match) => ({
    query: match[1].replace(/\s+/g, ' ').trim(),
    body: match[2],
  }));
  must(media.length > 0, 'layout.css declares no media query at all');
  const narrow = media.find((entry) => /max-(?:inline-size|width)/.test(entry.query));
  must(narrow, `no narrow-viewport media query: ${media.map((m) => m.query).join(' | ')}`);
  const rem = narrow.query.match(/(\d+(?:\.\d+)?)rem/);
  const px = narrow.query.match(/(\d+(?:\.\d+)?)px/);
  must(rem || px, `the breakpoint carries no length: ${narrow.query}`);
  const width = rem ? Number(rem[1]) * 16 : Number(px[1]);
  must(
    width === GRID.breakpointPx,
    `the narrow breakpoint is ${narrow.query} = ${width}px, expected ${GRID.breakpointPx}px (${GRID.breakpointRem}rem)`,
  );
  must(
    /--_span\s*:\s*var\(--_grid-columns\)/.test(narrow.body),
    'below the breakpoint every column must collapse to --_span: var(--_grid-columns)',
  );
  must(/bn-col-1/.test(narrow.body), 'the narrow media query must cover the .bn-col-* classes');
  return `${narrow.query} → every column spans all ${GRID.columns} columns (rem spelling is 48rem at the 16px root)`;
});

await check('nothing in layout.css or utilities.css escapes the naming and layering contract', () => {
  for (const file of [GRID.layoutFile, GRID.utilitiesFile]) {
    const text = read(file);
    const code = withoutComments(text);
    must(
      !/@layer/.test(code),
      `${file} declares an @layer — layer assignment lives in scripts/build.mjs (a mention in a ` +
        'comment is documentation and is not counted)',
    );
    must(
      !/!important/.test(code),
      `${file} uses !important; the utilities layer already wins inside the library, so it is not needed`,
    );
    for (const match of code.matchAll(/var\(\s*(--[a-z0-9-]+)/g)) {
      const name = match[1];
      must(
        name.startsWith('--bn-') || name.startsWith('--_'),
        `${file} reads ${name}: only --bn-* and --_* are allowed (ADR-0005)`,
      );
    }
    for (const match of code.matchAll(/(?:^|[^-\w])(--[a-z0-9-]+)\s*:/gm)) {
      const name = match[1];
      must(
        name.startsWith('--bn-') || name.startsWith('--_'),
        `${file} declares ${name}: only --bn-* and --_* are allowed (ADR-0005)`,
      );
    }
    const literal = code.match(/translate(?:[XY])?\(\s*-?\d/);
    must(!literal, `${file} hardcodes a displacement: ${literal?.[0]}`);
    const shadow = code.match(/box-shadow\s*:\s*[^v;]/);
    must(!shadow, `${file} hardcodes a shadow: ${shadow?.[0]}`);
  }
  return 'no @layer, no !important, only --bn-* / --_*, no displacement or shadow literals';
});

/* ============================= static: utilities.css ================================= */

await check('src/css/utilities.css declares exactly the documented, bounded utility set', () => {
  utilities = read(GRID.utilitiesFile);
  must(utilities.trim().length > 0, `${GRID.utilitiesFile} is still the empty placeholder`);
  const declared = declaredClasses(utilities);
  const missing = UTILITY_CLASSES.filter((name) => !declared.includes(name));
  must(missing.length === 0, `documented but not implemented: ${missing.map((n) => `.${n}`).join(', ')}`);
  const extra = declared.filter((name) => !UTILITY_CLASSES.includes(name));
  must(extra.length === 0, `implemented but not documented: ${extra.map((n) => `.${n}`).join(', ')}`);
  must(
    declared.length <= GRID.maxUtilities,
    `${declared.length} utility classes — the set is meant to be bounded (≤ ${GRID.maxUtilities})`,
  );
  return `${declared.length} classes in ${UTILITY_GROUPS.length} groups`;
});

await check('the spacing utilities are a 2/4/8/16 scale, never arbitrary pixel counts', () => {
  const problems = [];
  for (const [step, value] of Object.entries(SPACING_STEPS)) {
    for (const axis of ['mt', 'mb']) {
      const body = ruleBody(utilities, `.bn-${axis}-${step}`);
      if (body === null) {
        problems.push(`.bn-${axis}-${step} is missing`);
        continue;
      }
      const property = axis === 'mt' ? 'margin-block-start' : 'margin-block-end';
      if (!body.includes(`${property}: ${value}`)) {
        problems.push(`.bn-${axis}-${step} is not ${property}: ${value} (found: ${body.trim()})`);
      }
    }
  }
  const numbers = [...withoutComments(utilities).matchAll(/\.bn-m[bt]-(\d+)/g)].map((m) => m[1]);
  const stray = [...new Set(numbers)].filter((step) => !Object.keys(SPACING_STEPS).includes(step));
  must(stray.length === 0, `spacing steps outside 2/4/8/16: ${stray.join(', ')}`);
  must(problems.length === 0, `\n  ${problems.join('\n  ')}`);
  return 'mt/mb × 2/4/8/16 → 0.5rem / 1rem / 2rem / 4rem';
});

await check('the utility names do not collide with the visual modifier names', () => {
  const nameOf = (cls) => new RegExp(`\\.${cls}(?![\\w-])`);
  const collisions = VISUAL_MODIFIERS.filter((name) => nameOf(name).test(withoutComments(utilities)));
  must(
    collisions.length === 0,
    `utilities.css declares ${collisions.map((n) => `.${n}`).join(', ')} — those names are visual ` +
      'modifiers (shape/size), and a utility that took one would silently redefine a button',
  );
  // The same question asked of the whole library: a visual modifier name must not also appear
  // as a *utility* declaration in any other file.
  const otherFiles = fs
    .readdirSync(abs('src/css'))
    .filter((file) => file.endsWith('.css') && file !== 'utilities.css');
  const shadows = [];
  for (const file of otherFiles) {
    const clean = withoutComments(read(path.join('src/css', file)));
    for (const name of VISUAL_MODIFIERS) {
      for (const match of clean.matchAll(new RegExp(`\\.${name}(?![\\w-])\\s*\\{([^{}]*)\\}`, 'g'))) {
        void match;
      }
    }
    for (const cls of UTILITY_CLASSES) {
      if (new RegExp(`\\.${cls}(?![\\w-])\\s*\\{`).test(clean)) shadows.push(`.${cls} in src/css/${file}`);
    }
  }
  must(shadows.length === 0, `a utility class is declared twice: ${shadows.join(', ')}`);
  return `${VISUAL_MODIFIERS.length} modifier names unchecked-free; no utility declared in another file`;
});

/* ============================= static: the published artifact ======================== */

await check('the artifacts carry the grid and every utility class', () => {
  const missing = [];
  for (const artifact of ARTIFACTS) {
    const text = read(artifact);
    const names = ['bn-container', 'bn-row', ...UTILITY_CLASSES, ...Array.from({ length: GRID.columns }, (_, i) => `bn-col-${i + 1}`)];
    const absent = names.filter((name) => !text.includes(`.${name}`));
    if (absent.length > 0) missing.push(`${artifact}: ${absent.join(', ')}`);
  }
  must(missing.length === 0, `${missing.join('; ')}`);
  /*
   * The docs-site stylesheet's side of the namespace rule. Two claims, each asked in the form that
   * actually means something:
   *
   *   - it must never *read* a library token (`--bn-*`): the site has its own `--site-*` set and
   *     has to stay readable when the library is not loaded at all;
   *   - it must never *define* a library class. Naming one is a different act: the Button page's
   *     preview panel contains the library's own `.bn-button` anchors, so the site has to name what
   *     it wants to wrap (see the comment there). Comments are documentation and are stripped first.
   */
  const site = withoutComments(read(SITE_CSS));
  must(!/--bn-/.test(site), 'static/style.css must not read a library --bn-* token');
  const defined = [...site.matchAll(/(?:^|[},])\s*([^{},]*?)\s*\{/g)]
    .flatMap((match) => [...match[1].matchAll(/\.(bn-[a-z0-9-]+)/g)].map((m) => m[1]))
    .filter((name) => name !== 'bn-button');
  must(
    defined.length === 0,
    `static/style.css defines library classes it does not own: ${[...new Set(defined)].join(', ')}`,
  );
  return 'full + min css name every class; style.css reads no --bn-* token and defines no bn- class';
});

await check('the docs site is documented by two pages, authored to the site rules', () => {
  const problems = [];
  for (const file of CONTENT_PAGES) {
    if (!exists(file)) {
      problems.push(`${file} is missing`);
      continue;
    }
    const { frontmatter, prose, fences } = dissect(read(file));
    if (!/^title\s*:/m.test(frontmatter)) problems.push(`${file}: no title in frontmatter`);
    for (const line of prose.split(/\r?\n/)) {
      if (/^#{1,2}\s+/.test(line)) problems.push(`${file}: "${line.trim()}" (an H2 comes from the template)`);
    }
    if (/\{\{[<%#]/.test(prose)) problems.push(`${file}: uses shortcode syntax`);
    const tag = proseWithoutInlineCode(prose).match(/<[a-zA-Z][^>]*>/);
    if (tag) problems.push(`${file}: raw HTML outside a fence (${tag[0]})`);
    for (const marker of ['data-site-', 'site-demo']) {
      if (prose.includes(marker)) problems.push(`${file}: mentions ${marker} in prose`);
    }
    for (const fence of fences) {
      if (fence.unterminated) problems.push(`${file}: an unterminated fence`);
      if (!ALLOWED_FENCE_INFO.test(fence.info)) {
        problems.push(`${file}: fence info \`${fence.info}\` is not a plain language token`);
      }
    }
    for (const link of prose.matchAll(/\]\(([^)]+)\)/g)) {
      const target = link[1];
      if (/^https?:/.test(target)) continue;
      if (target.length > 1 && target.endsWith('/')) {
        problems.push(`${file}: link \`${target}\` has a trailing slash (seite reports broken links)`);
      }
    }
  }
  must(problems.length === 0, `\n  ${problems.join('\n  ')}`);
  return `${CONTENT_PAGES.length} pages: no H2, no trailing-slash links, plain fences only`;
});

await check('the layout page states the column count, the breakpoints and the implementation', () => {
  const { prose } = dissect(read('content/components/layout.md'));
  const documented = {
    'the three class families': ['bn-container', 'bn-row', 'bn-col-1', 'bn-col-12'].every((name) =>
      prose.includes(name),
    ),
    'the column count': /\b12\b/.test(prose),
    [`the breakpoint ${GRID.breakpointPx}px`]: prose.includes(String(GRID.breakpointPx)),
    [`the breakpoint ${GRID.breakpointRem}rem`]: prose.includes(`${GRID.breakpointRem}rem`),
    'the measured viewports': ['320', '375', '768', '1024', '1440'].every((width) => prose.includes(width)),
    'the implementation choice': /grid|--_span/.test(prose),
    'the gap / hard-shadow caveat': /gap|间隙/.test(prose),
  };
  const missing = Object.entries(documented).filter(([, ok]) => !ok).map(([what]) => what);
  must(missing.length === 0, `the layout page does not document: ${missing.join(', ')}`);
  return `${Object.keys(documented).length} documented facts`;
});

await check('the utilities page lists every class and states the boundary', () => {
  const { prose } = dissect(read('content/components/utilities.md'));
  const missing = UTILITY_CLASSES.filter((name) => !prose.includes(name));
  must(missing.length === 0, `the utilities page does not list: ${missing.map((n) => `.${n}`).join(', ')}`);
  const stray = [...new Set([...prose.matchAll(/\.bn-[a-z0-9-]+/g)].map((m) => m[0].slice(1)))].filter(
    (name) =>
      !UTILITY_CLASSES.includes(name) &&
      !/^bn-(container|row|col-\d+)$/.test(name) &&
      // The page may *name* the visual modifiers while explaining the boundary; what it may not
      // do is present a name the library does not ship.
      !VISUAL_MODIFIERS.includes(name),
  );
  must(
    stray.length === 0,
    `the utilities page names classes the library does not ship: ${stray.join(', ')} — internal ` +
      'variables are --_* and must not be written with a leading dot',
  );
  must(/utilities/i.test(prose), 'the page does not explain the utilities layer');
  must(
    /unlayered|未分层/i.test(prose),
    'the page does not explain that unlayered user CSS wins over the utilities layer (ADR-0006)',
  );
  return `${UTILITY_CLASSES.length} classes listed, layer + override story stated`;
});

/* ============================= static: the site eats the grid ======================== */

await check('the page shell carries the container and the four page templates lay out on the grid', () => {
  const problems = [];
  const details = [];
  const base = read('templates/base.html');
  if (/<main[^>]*bn-container/.test(base)) details.push('base.html=<main class="bn-container">');
  else problems.push('templates/base.html: the page shell does not carry .bn-container');
  for (const file of GRID_CONSUMER_TEMPLATES) {
    if (!exists(file)) {
      problems.push(`${file} is missing`);
      continue;
    }
    const html = read(file);
    const found = [];
    for (const [label, pattern] of [
      ['.bn-row', /bn-row/],
      ['.bn-col-*', /bn-col-\d+/],
    ]) {
      if (pattern.test(html)) found.push(label);
      else problems.push(`${file}: no ${label}`);
    }
    details.push(`${path.basename(file)}=${found.join('+') || 'none'}`);
  }
  must(problems.length === 0, `\n  ${problems.join('\n  ')}`);
  return details.join(' ');
});

await check('the docs-site width tokens line up with the grid so the chrome cannot misalign', () => {
  const site = read(SITE_CSS);
  const width = site.match(/--site-width\s*:\s*([0-9.]+)rem/);
  must(width, 'static/style.css no longer declares --site-width in rem');
  must(
    Number(width[1]) === SITE_WIDTH_REM,
    `--site-width is ${width[1]}rem; this ticket measured its before/after readings against ${SITE_WIDTH_REM}rem`,
  );
  must(
    /--site-pad\s*:\s*clamp\([0-9.]+rem,\s*[0-9.]+vw,\s*[0-9.]+rem\)/.test(site),
    '--site-pad must stay a clamp between two rem bounds: one value has to serve the header/footer ' +
      'gutter and the grid container padding without drifting apart',
  );
  const main = site.match(/\.site-main\s*\{([^{}]*)\}/);
  must(main, 'static/style.css has no .site-main rule');
  const handoff = site.match(/\.site-main\s*\{([^{}]*--_container-max[^{}]*)\}/);
  must(handoff, '.site-main does not feed the grid its width and padding');
  must(
    /--_container-max\s*:\s*var\(--site-width\)/.test(handoff[1]) &&
      /--_container-pad\s*:\s*var\(--site-pad\)/.test(handoff[1]),
    '.site-main does not hand the grid its own width and padding: the container would drift away ' +
      `from the header/footer alignment (found: ${handoff[1].trim().slice(0, 80)})`,
  );
  return `--site-width: ${width[1]}rem, --site-pad a bounded clamp, .site-main feeds --_container-max/--_container-pad`;
});

/* ============================== the site, built ====================================== */

await check('seite build exits 0 (dist/ current for the browser checks)', () => {
  if (SKIP_BUILD) {
    must(fs.existsSync(DIST), 'dist/ is missing and --no-build was passed');
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

await check('the built pages carry the grid: index, a component page and a plain page', () => {
  const problems = [];
  for (const file of ['dist/components/index.html', 'dist/components/button.html', 'dist/usage.html', 'dist/index.html']) {
    if (!fs.existsSync(abs(file))) {
      problems.push(`${file} was not built`);
      continue;
    }
    const html = read(file);
    for (const [label, pattern] of [
      ['.bn-container', /bn-container/],
      ['.bn-row', /bn-row/],
      ['.bn-col-*', /bn-col-\d+/],
    ]) {
      if (!pattern.test(html)) problems.push(`${file}: no ${label}`);
    }
  }
  must(problems.length === 0, `\n  ${problems.join('\n  ')}`);
  return 'index + component + plain page all render the grid';
});

/* ---------------------------------- browser checks ----------------------------------- */

const BROWSER_CHECKS = [];
const VIEWPORTS = [320, 375, 768, 1024, 1440];

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
 * Two mounts, the way tests/browser/harness.mjs does it: the fixtures at the site root (so the
 * grid fixture is served at `/barnacle/layout.html`) and dist/ under the same prefix (so the
 * built pages keep their production URLs), plus a route for the absolute production origin the
 * built pages reference for their assets — which also proves sub-path safety.
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
      path.join(ROOT, 'tests/browser/fixtures', relPath),
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
  await listenOnFreePort(server);
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

/**
 * How many cards fit in a row, derived from the grid's contract rather than from the template:
 * `.bn-col-<span>` at or above 768px, one full-width column below it.
 */
const expectedCardsPerRow = (cardSpan) => (width) =>
  width > GRID.breakpointPx ? Math.floor(GRID.columns / cardSpan) : 1;

const CARD_SPAN = 4; // templates/components-index.html lays the collection out as .bn-col-4 cards

function registerBrowserChecks() {
  BROWSER_CHECKS.push([
    'the grid fixture computes 12 equal tracks and the column classes span them',
    async (browser, server) => {
      return withPage(browser, server, 'layout.html', { viewport: { width: 1200, height: 900 } }, async (page) => {
        const state = await page.evaluate(() => {
          const rect = (selector) => {
            const box = document.querySelector(selector).getBoundingClientRect();
            return { x: Math.round(box.x), w: Math.round(box.width), right: Math.round(box.right) };
          };
          const tracks = getComputedStyle(document.querySelector('#row'))
            .gridTemplateColumns.split(' ')
            .filter(Boolean)
            .map((value) => Number(value.replace('px', '')));
          const gap = Math.round(
            Number.parseFloat(getComputedStyle(document.querySelector('#row')).columnGap),
          );
          const listNone = getComputedStyle(document.querySelector('#list-none'));
          const hidden = document.querySelector('#hidden').getBoundingClientRect();
          return {
            trackCount: tracks.length,
            trackWidths: tracks,
            gap,
            left: rect('#left'),
            right: rect('#right'),
            full: rect('#full'),
            thirdA: rect('#third-a'),
            thirdB: rect('#third-b'),
            quarter: rect('#quarter'),
            nestedLeft: rect('#nested-left'),
            nestedRight: rect('#nested-right'),
            nestedHost: rect('#nested-host'),
            nestedRow: rect('#nested-row'),
            nestedRowOverflow: getComputedStyle(document.querySelector('#nested-row')).overflowX,
            wideContent: rect('#wide-content'),
            wideContentOverflow: getComputedStyle(document.querySelector('#wide-content')).overflowX,
            wideContentContain: getComputedStyle(document.querySelector('#wide-content')).contain,
            container: rect('#container'),
            containerPad: Number.parseFloat(getComputedStyle(document.querySelector('#container')).paddingLeft),
            containerMax: getComputedStyle(document.querySelector('#container')).maxWidth,
            listNoneStyle: listNone.listStyleType,
            listNonePadding: listNone.paddingLeft,
            plainListStyle: getComputedStyle(document.querySelector('#plain-list')).listStyleType,
            hiddenBox: { w: Math.round(hidden.width), h: Math.round(hidden.height) },
            mutedColor: getComputedStyle(document.querySelector('#muted')).color,
            plainColor: getComputedStyle(document.querySelector('#plain')).color,
            centeredAlign: getComputedStyle(document.querySelector('#centered')).textAlign,
            betweenDisplay: getComputedStyle(document.querySelector('#between')).display,
            stackDirection: getComputedStyle(document.querySelector('#stack')).flexDirection,
            scrollWidth: document.documentElement.scrollWidth,
            innerWidth: window.innerWidth,
          };
        });

        must(state.trackCount === GRID.columns, `the row computes ${state.trackCount} tracks, expected ${GRID.columns}`);
        // Track widths differ in the last decimal by rounding; a tenth of a pixel is the tolerance.
        const widest = Math.max(...state.trackWidths);
        const narrowest = Math.min(...state.trackWidths);
        must(
          widest - narrowest <= 0.1,
          `the ${GRID.columns} tracks are not equal: ${narrowest}px … ${widest}px`,
        );
        must(
          state.left.w === state.right.w && state.right.x === state.left.right + state.gap,
          `.bn-col-6 must give two adjacent equal cells separated by the row gap ` +
            `(${JSON.stringify({ left: state.left, right: state.right, gap: state.gap })})`,
        );
        must(
          Math.abs(state.full.w - (state.right.right - state.left.x)) <= 1 && state.full.x === state.left.x,
          `.bn-col-12 must span the whole row (${state.full.w}px vs ${state.right.right - state.left.x}px)`,
        );
        must(
          state.thirdA.w === state.thirdB.w && state.quarter.w < state.thirdA.w,
          `.bn-col-4 (${state.thirdA.w}px) must be wider than .bn-col-3 (${state.quarter.w}px)`,
        );
        must(
          state.nestedLeft.w === state.nestedRight.w &&
            Math.abs(state.nestedRow.w - state.nestedHost.w) <= 1 &&
            Math.abs(state.nestedLeft.w - (state.nestedHost.w - state.gap) / 2) <= 2,
          `a nested .bn-row must reset the inherited span and lay its own children out across the ` +
            `${GRID.columns} columns (${JSON.stringify({
              host: state.nestedHost,
              row: state.nestedRow,
              left: state.nestedLeft,
              right: state.nestedRight,
              gap: state.gap,
            })})`,
        );
        must(
          state.nestedRowOverflow === 'visible',
          `a nested row must keep a usable overflow (found ${state.nestedRowOverflow}); containment ` +
            'belongs on the column, not on the grid it holds',
        );
        must(
          state.container.w <= 1200 && state.container.w >= 1200 - 2 * state.containerPad,
          `.bn-container must fit the viewport exactly at most, padding included ` +
            `(${state.container.w}px at a 1200px viewport, pad ${state.containerPad}px) — ` +
            'box-sizing: border-box is the declaration that makes this true',
        );
        must(
          state.wideContent.w < state.container.w,
          `a column holding an unbreakable token widened itself to ${state.wideContent.w}px instead of ` +
            `clipping (container ${state.container.w}px)`,
        );
        must(
          state.wideContentContain === 'paint' && state.wideContentOverflow === 'visible',
          `the column family must contain its own overflow through contain: paint while leaving ` +
            `overflow alone (contain: ${state.wideContentContain}, overflow: ${state.wideContentOverflow})`,
        );
        must(
          state.containerMax !== 'none' && Number.parseFloat(state.containerMax) > 0,
          `.bn-container has no max-inline-size (${state.containerMax})`,
        );
        must(
          state.listNoneStyle === 'none' && state.plainListStyle === 'square',
          `the utilities layer must beat base (list-style: ${state.listNoneStyle} vs ${state.plainListStyle})`,
        );
        must(state.listNonePadding === '0px', `.bn-list-none did not clear the padding (${state.listNonePadding})`);
        must(
          state.hiddenBox.w <= 1 && state.hiddenBox.h <= 1,
          `.bn-visually-hidden is not visually hidden (${JSON.stringify(state.hiddenBox)})`,
        );
        must(state.mutedColor !== state.plainColor, `.bn-text-muted did not change the text colour (${state.mutedColor})`);
        must(state.centeredAlign === 'center', `.bn-text-center computed ${state.centeredAlign}`);
        must(state.betweenDisplay === 'flex', `.bn-between computed display: ${state.betweenDisplay}`);
        must(state.stackDirection === 'column', `.bn-stack computed flex-direction: ${state.stackDirection}`);
        must(state.scrollWidth <= state.innerWidth, `the fixture overflows: ${state.scrollWidth} > ${state.innerWidth}`);
        return `${state.trackCount} equal tracks of ${narrowest}–${widest}px, utilities win over base, no overflow`;
      });
    },
  ]);

  BROWSER_CHECKS.push([
    'the grid collapses to one column below the breakpoint and restores above it',
    async (browser, server) => {
      return withPage(browser, server, 'layout.html', {}, async (page) => {
        const readings = [];
        for (const width of [320, 375, GRID.breakpointPx, GRID.breakpointPx + 1, 1440]) {
          await page.setViewportSize({ width, height: 900 });
          const reading = await page.evaluate(() => {
            const half = document.querySelector('#left').getBoundingClientRect();
            const whole = document.querySelector('#full').getBoundingClientRect();
            const row = document.querySelector('#row').getBoundingClientRect();
            return {
              width: window.innerWidth,
              collapsed: matchMedia('(max-width: 768px)').matches,
              halfWidth: Math.round(half.width),
              wholeWidth: Math.round(whole.width),
              gap: Math.round(Number.parseFloat(getComputedStyle(document.querySelector('#row')).columnGap)),
              halfX: Math.round(half.x),
              wholeX: Math.round(whole.x),
              rowWidth: Math.round(row.width),
              scrollWidth: document.documentElement.scrollWidth,
            };
          });
          readings.push(reading);
          // The measurement is against the *media query*, not against a number written here: the
          // width at which the collapse happens is the contract, and the browser states it.
          must(
            reading.collapsed === width <= GRID.breakpointPx,
            `max-width: 768px matches ${reading.collapsed} at ${width}px — the CSS breakpoint and the ` +
              'documented one disagree',
          );
          must(
            reading.scrollWidth <= reading.width,
            `overflow at ${width}px: scrollWidth ${reading.scrollWidth} > ${reading.width}`,
          );
          /*
           * `.bn-col-12` is the row's own full width as the grid laid it out, so it — and not the
           * row's own box — is the reference a half-width cell is compared against: measuring the
           * row instead mixes a sub-pixel gutter into the assertion.
           */
          if (reading.collapsed) {
            must(
              Math.abs(reading.halfWidth - reading.wholeWidth) <= 1 && reading.halfX === reading.wholeX,
              `below the breakpoint a .bn-col-6 must fill the row (cell ${reading.halfWidth}px vs a ` +
                `${GRID.columns}-column cell ${reading.wholeWidth}px at ${width}px)`,
            );
          } else {
            // Two six-column cells share a twelve-column line minus exactly one gutter.
            const expected = (reading.wholeWidth - reading.gap) / 2;
            must(
              Math.abs(reading.halfWidth - expected) <= 2 && reading.halfWidth < reading.wholeWidth,
              `above the breakpoint a .bn-col-6 must be half the row minus half a gutter ` +
                `(cell ${reading.halfWidth}px vs expected ${Math.round(expected)}px from a ` +
                `${GRID.columns}-column cell of ${reading.wholeWidth}px at ${width}px)`,
            );
          }
        }
        return readings
          .map((r) => `${r.width}px→${r.collapsed ? 'full' : 'half'} ${r.halfWidth} vs ${r.wholeWidth} (row ${r.rowWidth})`)
          .join(' | ');
      });
    },
  ]);

  BROWSER_CHECKS.push([
    'no docs page overflows horizontally from 320px to 1440px',
    async (browser, server) => {
      const report = [];
      for (const relPath of ['components/', 'components/button', 'components/layout', 'components/utilities', 'usage', '']) {
        await withPage(browser, server, relPath, {}, async (page) => {
          for (const width of VIEWPORTS) {
            await page.setViewportSize({ width, height: 900 });
            const reading = await page.evaluate(() => ({
              scrollWidth: document.documentElement.scrollWidth,
              innerWidth: window.innerWidth,
            }));
            report.push(`${relPath || 'home'}@${width}=${reading.scrollWidth}`);
            must(
              reading.scrollWidth <= reading.innerWidth,
              `${relPath || 'home'} overflows at ${width}px: scrollWidth ${reading.scrollWidth} > ${reading.innerWidth}`,
            );
          }
        });
      }
      return report.join(' ');
    },
  ]);

  BROWSER_CHECKS.push([
    'the components index is laid out by the grid at every width, without a regression',
    async (browser, server) => {
      return withPage(browser, server, 'components/', {}, async (page) => {
        const readings = [];
        for (const width of VIEWPORTS) {
          await page.setViewportSize({ width, height: 900 });
          const state = await page.evaluate(() => {
            const row = document.querySelector('.site-main .bn-row');
            const container = document.querySelector('.site-main');
            const cards = [...document.querySelectorAll('.site-main [data-site-column="card"]')];
            const tops = [...new Set(cards.map((card) => Math.round(card.getBoundingClientRect().top)))];
            return {
              width: window.innerWidth,
              rowTracks: row ? getComputedStyle(row).gridTemplateColumns.split(' ').filter(Boolean).length : 0,
              rowTemplate: row ? getComputedStyle(row).gridTemplateColumns : '',
              rowWidth: row ? Math.round(row.getBoundingClientRect().width) : 0,
              containerWidth: Math.round(container.getBoundingClientRect().width),
              cardCount: cards.length,
              cardsPerRow: cards.filter((card) => Math.round(card.getBoundingClientRect().top) === tops[0]).length,
              cardWidth: cards.length ? Math.round(cards[0].getBoundingClientRect().width) : 0,
              cardWidths: [...new Set(cards.map((card) => Math.round(card.getBoundingClientRect().width)))],
              linkHeightsByRow: tops.map((top) => [
                ...new Set(
                  cards
                    .filter((card) => Math.round(card.getBoundingClientRect().top) === top)
                    .map((card) => Math.round(card.querySelector('.site-card__link').getBoundingClientRect().height)),
                ),
              ]),
            };
          });
          readings.push(state);
          const expected = expectedCardsPerRow(CARD_SPAN)(width);
          must(state.rowTracks === GRID.columns, `the index row computes ${state.rowTracks} tracks at ${width}px`);
          must(state.cardCount > 0, 'the index page has no cards to lay out');
          must(
            state.cardsPerRow === expected,
            `${state.cardsPerRow} cards per row at ${width}px (a ${CARD_SPAN}-column card gives ${expected})`,
          );
          must(
            state.cardWidth * state.cardsPerRow + (state.cardsPerRow - 1) * 24 <= state.rowWidth + 1,
            `the cards are wider than the row at ${width}px (${state.cardWidth}×${state.cardsPerRow} > ${state.rowWidth})`,
          );
          must(
            state.cardWidths.length === 1,
            `cards are not all the same width at ${width}px: ${state.cardWidths.join(', ')}`,
          );
          const flatHeights = state.linkHeightsByRow.flat();
          must(
            flatHeights.length === state.linkHeightsByRow.length,
            `cards in one row are not equal height at ${width}px: ${JSON.stringify(state.linkHeightsByRow)}`,
          );
          must(
            state.containerWidth <= Math.min(state.width, SITE_WIDTH_REM * 16) + 1,
            `the container is wider than the site's own column at ${width}px (${state.containerWidth}px)`,
          );
        }
        return readings
          .map((r) => `${r.width}px: ${r.cardsPerRow}/row × ${r.cardWidth}px (container ${r.containerWidth})`)
          .join(' | ');
      });
    },
  ]);

  BROWSER_CHECKS.push([
    'the button component page keeps its readings and stays inside the viewport',
    async (browser, server) => {
      return withPage(browser, server, 'components/button', {}, async (page) => {
        const readings = [];
        for (const width of VIEWPORTS) {
          await page.setViewportSize({ width, height: 900 });
          const state = await page.evaluate(() => {
            const prose = document.querySelector('.site-prose');
            const row = document.querySelector('.site-main .bn-row');
            return {
              width: window.innerWidth,
              rowTracks: row ? getComputedStyle(row).gridTemplateColumns.split(' ').filter(Boolean).length : 0,
              containerWidth: Math.round(document.querySelector('.site-main').getBoundingClientRect().width),
              proseWidth: prose ? Math.round(prose.getBoundingClientRect().width) : 0,
              fences: document.querySelectorAll('.site-prose pre').length,
              demos: document.querySelectorAll('[data-site-demo]').length,
              tabs: document.querySelectorAll('[data-site-demo] [role="tab"]').length,
              scrollWidth: document.documentElement.scrollWidth,
              innerWidth: window.innerWidth,
            };
          });
          readings.push(state);
          must(state.rowTracks === GRID.columns, `the component page row computes ${state.rowTracks} tracks at ${width}px`);
          must(state.fences === 3, `the page's 3 fences became ${state.fences} during the re-layout`);
          must(state.demos === 2 && state.tabs === 4, `the two Preview/Code demos became ${state.demos}/${state.tabs}`);
          must(
            state.proseWidth <= PROSE_MEASURE_REM * 16 + 1,
            `the prose column grew past its readable measure at ${width}px (${state.proseWidth}px)`,
          );
          must(
            state.scrollWidth <= state.innerWidth,
            `components/button overflows at ${width}px: scrollWidth ${state.scrollWidth} > ${state.innerWidth}`,
          );
          must(state.containerWidth <= Math.min(width, SITE_WIDTH_REM * 16) + 1, `container too wide at ${width}px`);
        }
        return readings.map((r) => `${r.width}px: prose ${r.proseWidth}px, overflow ${r.scrollWidth > r.innerWidth}`).join(' | ');
      });
    },
  ]);
}

/**
 * Browser checks are mandatory for this ticket: every claim it makes about the grid is a claim
 * about computed layout. playwright-core is already a devDependency (ticket 08).
 */
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
