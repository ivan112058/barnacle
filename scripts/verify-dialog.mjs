#!/usr/bin/env node
/**
 * Scripted verification for ticket 14 — Dialog.
 *
 * The four verification methods in `.scratch/barnacle-design/issues/14-dialog.md` are the
 * specification of this file; each one is a check below, measured in real Chrome against the
 * shipped artifact (`static/barnacle.css`) instead of a hand pass:
 *
 *   1. open and close it, and watch the focus go and come back
 *   2. turn on "reduce motion" and confirm the entry animation is gone
 *   3. in the dark theme, confirm the overlay and the dialog are far enough apart
 *   4. with JavaScript disabled, confirm a `<dialog open>` still looks right
 *
 * The expected values are the independent source of truth: spec.md §3 (invariants 2–7), §5
 * (`animations.css` owns the keyframes, the guard and `::backdrop`), §6.1/§6.2 (tokens, including
 * `--bn-overlay`), §7 (the motion guard, and `hover` never changing a border width), §8 (the
 * anchor is the native `dialog`), ADR-0005 (`--bn-*` / `--_*` only) and
 * `D:\code\barnacle-notes\orchestrator-decisions.md` §4 (geometry has one source), §11
 * (`animations.css` belongs to this ticket) and §13 (the traps already paid for). They are never
 * recomputed from `src/css/dialog.css`.
 *
 * Run with: npm run verify:dialog   (or: node scripts/verify-dialog.mjs)
 * Options:  --no-browser  skip the real-Chrome checks (they need playwright-core)
 *
 * playwright-core is a devDependency of this repository (ticket 08 owns the browser harness);
 * without it the browser checks report SKIP and the static checks still gate the exit code.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { blankComments, declarations, matchBrace, parseRulesAndKeyframes } from './lib/css.mjs';
import { FROZEN_SLOTS, PUBLIC_TOKENS } from './lib/tokens.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const abs = (...parts) => path.join(ROOT, ...parts);

/* ------------------------------------ expectations ----------------------------------- */

/** The two source files this ticket owns (orchestrator-decisions §11). */
const FILES = ['dialog.css', 'animations.css'];

/** The one page this ticket adds (spec §10: one page per component, no authored H2). */
const DOC_PAGE = 'content/components/dialog.md';

const ARTIFACT = 'static/barnacle.css';

/** The keyframes ticket 19 published; this ticket adds a rule, not a second copy. */
const ENTRY_KEYFRAMES = 'bn-fade-in-up';

/** The overlay keyframes this ticket adds. */
const OVERLAY_KEYFRAMES = 'bn-fade-in';

/** ADR-0005: the two namespaces, and nothing else. */
const PUBLIC_PREFIX = /^--bn-[a-z0-9-]+$/;
const INTERNAL_PREFIX = /^--_[a-z0-9-]+$/;

/** Hardcoded colour forms ADR-0005 keeps in 01-theme.css only. */
const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(|\bcolor\(/;

/** spec §6.1 / §6.2 — the values the harness reads, in Chrome's serialisation. */
const COLOR = {
  ink: 'rgb(0, 0, 0)',
  paper: 'rgb(255, 253, 245)',
  darkPaper: 'rgb(26, 26, 26)',
  darkInk: 'rgb(255, 253, 245)',
  overlay: 'rgba(0, 0, 0, 0.8)',
};

/** spec §6.1 — the hard shadow tiers, with the lg tier this component floats on (1.5 × 4px). */
const SHADOW = {
  lg: 'rgb(0, 0, 0) 6px 6px 0px 0px',
  lgDark: 'rgb(255, 253, 245) 6px 6px 0px 0px',
  lgOffset: 6,
};

const BORDER_PX = '3px';
const RADIUS = '0px';

/**
 * The one WCAG number this file asserts: whatever separates the dialog from the masked page —
 * its surface in the light theme, its border and shadow in the dark one — has to clear the
 * non-text contrast floor. The reading is reported for both modes, not just pass/fail.
 */
const MIN_SEPARATION = 3;

/**
 * The one thing Chrome's own measurement changed in the plan: the platform supports the
 * declarative `command` / `commandfor` attributes, so an example can open and close a dialog with
 * no script at all. The check below re-measures that claim instead of trusting this comment, and
 * the documentation is written against what it finds.
 */
const DECLARATIVE = { attribute: 'command', value: 'show-modal', target: 'commandfor' };

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

const inNoPreference = (rule) =>
  rule.conditions.some((condition) => /prefers-reduced-motion:\s*no-preference/.test(condition));

const MOTION_PROPERTY = /^(?:animation|transition)(?:-|$)/;

/** Every rule of the two files, tagged with the file it came from. */
const sources = FILES.map((file) => {
  const raw = read(`src/css/${file}`);
  const source = blankComments(raw);
  const parsed = parseRulesAndKeyframes(source);
  // `file` rides on every rule, so a declaration can always say where it was written.
  const rules = parsed.rules.map((rule) => ({ ...rule, file }));
  return {
    file,
    raw,
    source,
    rules,
    keyframes: parsed.keyframes,
    declarations: rules.flatMap((rule) =>
      declarations(rule.body).map(([property, value]) => ({ property, value, ...rule })),
    ),
    customProps: [...new Set([...source.matchAll(/--[\w-]+/g)].map((match) => match[0]))],
  };
});

const dialogSource = sources.find((entry) => entry.file === 'dialog.css');
const animationsSource = sources.find((entry) => entry.file === 'animations.css');
const allDeclarations = sources.flatMap((entry) => entry.declarations);

/** Every `@keyframes` name in the whole library — reuse is visible, a copy is a second line. */
function keyframesAcrossLibrary() {
  const found = new Map();
  for (const file of fs.readdirSync(abs('src/css')).filter((name) => name.endsWith('.css'))) {
    const text = blankComments(read(`src/css/${file}`));
    for (const match of text.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)) {
      if (!found.has(match[1])) found.set(match[1], []);
      found.get(match[1]).push(file);
    }
  }
  return found;
}

/* --------------------------------- the docs page ------------------------------------- */

/** The frontmatter, the prose and the fences of a content file, in one pass. */
function dissect(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  must(lines[0] === '---', `${DOC_PAGE}: frontmatter must open on line 1`);
  const end = lines.indexOf('---', 1);
  must(end !== -1, `${DOC_PAGE}: frontmatter is never closed`);
  const frontmatter = lines.slice(1, end).join('\n');
  const prose = [];
  const fences = [];
  let open = null;
  for (const line of lines.slice(end + 1)) {
    const marker = /^```(.*)$/.exec(line);
    if (marker) {
      if (open) {
        fences.push({ info: open.info, text: open.lines.join('\n') });
        open = null;
      } else {
        open = { info: marker[1].trim(), lines: [] };
      }
      continue;
    }
    if (open) open.lines.push(line);
    else prose.push(line);
  }
  must(!open, `${DOC_PAGE}: a code fence is never closed`);
  return { frontmatter, prose: prose.join('\n'), fences };
}

/* =================================== static checks =================================== */

console.log(`barnacle dialog verification — ${ROOT}\n`);

await check('the two files this ticket owns are UTF-8 without a BOM, write no @layer, and are no longer stubs', () => {
  const report = [];
  for (const entry of sources) {
    const bytes = fs.readFileSync(abs(`src/css/${entry.file}`));
    must(
      !(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf),
      `${entry.file}: a BOM breaks the build chain and seite content checks`,
    );
    const offenders = entry.raw
      .split(/\r?\n/)
      .map((line, index) => [line, index + 1])
      .filter(([line]) => /^\s*@layer\b/.test(line));
    must(
      offenders.length === 0,
      `${entry.file}: remove @layer from line(s) ${offenders.map(([, n]) => n).join(', ')} — CSS_MANIFEST assigns the layer`,
    );
    must(entry.rules.length > 0, `${entry.file} declares no rule at all — ticket 14 has not landed`);
    report.push(`${entry.file}=${entry.rules.length} rule(s), ${entry.keyframes.length} keyframes`);
  }
  must(
    dialogSource.rules.some((rule) => /(^|[^\w-])dialog\b/.test(rule.selector)),
    'dialog.css does not address the native <dialog> element — that is the component’s anchor (spec §8)',
  );
  return report.join('; ');
});

await check('no invented names: --bn-* from spec §6.1 and --_* internals only, and no colour literal in dialog.css', () => {
  for (const entry of sources) {
    const unknownPublic = entry.customProps.filter(
      (name) => PUBLIC_PREFIX.test(name) && !PUBLIC_TOKENS.has(name),
    );
    must(
      unknownPublic.length === 0,
      `${entry.file}: unknown public token(s) ${unknownPublic.join(', ')} — spec §6.1 is the whole vocabulary`,
    );
    const foreign = entry.customProps.filter(
      (name) => !PUBLIC_PREFIX.test(name) && !INTERNAL_PREFIX.test(name),
    );
    must(foreign.length === 0, `${entry.file}: custom properties outside the two namespaces: ${foreign.join(', ')}`);
    const inventedSlots = entry.declarations
      .filter(({ property }) => property.startsWith('--_'))
      .filter(({ property }) => !FROZEN_SLOTS.has(property));
    must(
      inventedSlots.length === 0,
      `${entry.file}: declares internal slot(s) that are not part of the frozen block: ${inventedSlots
        .map(({ property }) => property)
        .join(', ')}`,
    );
    const unknownReads = [...entry.source.matchAll(/var\(\s*(--_[\w-]+)/g)]
      .map((match) => match[1])
      .filter((name) => !FROZEN_SLOTS.has(name));
    must(
      unknownReads.length === 0,
      `${entry.file}: reads a slot nobody declares: ${[...new Set(unknownReads)].join(', ')}`,
    );
  }
  const literals = [...dialogSource.source.matchAll(new RegExp(COLOUR_LITERAL.source, 'g'))].map((m) => m[0]);
  must(
    literals.length === 0,
    `dialog.css writes a colour down: ${[...new Set(literals)].join(', ')} — colours come from the tokens`,
  );
  for (const entry of sources) {
    must(
      !/url\(/.test(entry.source),
      `${entry.file}: the library ships no image and no webfont, so no url() belongs here`,
    );
  }
  return `${sources.length} files, ${new Set(allDeclarations.map((d) => d.property)).size} properties, 0 invented names, 0 colour literals`;
});

await check('the overlay is a token: dialog::backdrop paints --bn-overlay and does it unconditionally', () => {
  const backdrops = allDeclarations.filter(({ selector }) => /::backdrop/.test(selector));
  must(backdrops.length > 0, 'nothing styles ::backdrop — a modal would land on an undimmed page');
  const colour = backdrops.filter(({ property }) => property === 'background-color' || property === 'background');
  must(
    colour.length === 1,
    `exactly one of the two files should paint the backdrop (spec §5 gives ::backdrop to animations.css), found ${colour.length}`,
  );
  const [painted] = colour;
  must(
    /^var\(--bn-overlay\)$/.test(painted.value),
    `the backdrop must read --bn-overlay (spec §6.1), got ${painted.selector} { ${painted.property}: ${painted.value} }`,
  );
  must(
    painted.file === 'animations.css',
    `::backdrop belongs to animations.css (spec §5), found it in ${painted.file}`,
  );
  must(
    painted.conditions.length === 0,
    'the overlay is not motion: it must be painted outside any media query, or a visitor who asked for less motion loses it',
  );
  return `${painted.selector} { ${painted.value} }, unconditional, in ${painted.file}`;
});

await check('every animation is declared inside @media (prefers-reduced-motion: no-preference)', () => {
  const motion = allDeclarations.filter(({ property }) => MOTION_PROPERTY.test(property));
  must(motion.length > 0, 'nothing declares an animation — the dialog would arrive without one');
  const outside = motion.filter((declaration) => !inNoPreference(declaration));
  must(
    outside.length === 0,
    `motion declared outside the no-preference block: ${outside
      .map(({ file, selector, property }) => `${file} ${selector} { ${property} }`)
      .join('; ')}`,
  );
  const reduce = sources.filter((entry) => /prefers-reduced-motion:\s*reduce/.test(entry.source));
  must(
    reduce.length === 0,
    `a reduce block that switches motion off afterwards is the rejected form (spec §7): ${reduce
      .map((e) => e.file)
      .join(', ')}`,
  );
  // The trap orchestrator §13 recorded, as a check: a longhand `animation-duration: var(--token)`
  // is invalid at computed-value time and falls back to 0s — measured in Chrome 151/155. The token
  // carries two components (`150ms ease`), so it can only be spent in a shorthand.
  const brokenDuration = allDeclarations.filter(
    ({ property, value }) => property === 'animation-duration' && /var\(/.test(value),
  );
  must(
    brokenDuration.length === 0,
    `animation-duration cannot take a var() that expands to "150ms ease" (it computes to 0s): ${brokenDuration
      .map(({ file, selector }) => `${file} ${selector}`)
      .join('; ')}`,
  );
  return `${motion.length} motion declaration(s), all guarded; 0 reduce blocks; 0 var() durations`;
});

await check('the entry reuses the library’s keyframes instead of copying them (orchestrator §11/§13)', () => {
  const library = keyframesAcrossLibrary();
  must(
    library.get(ENTRY_KEYFRAMES)?.length === 1,
    `@keyframes ${ENTRY_KEYFRAMES} must be declared exactly once in src/css/ (found in ${(
      library.get(ENTRY_KEYFRAMES) ?? []
    ).join(', ')})`,
  );
  must(
    library.get(ENTRY_KEYFRAMES)[0] === 'animations.css',
    `@keyframes ${ENTRY_KEYFRAMES} lives in ${library.get(ENTRY_KEYFRAMES)[0]} — this ticket owns animations.css`,
  );
  const entry = animationsSource.rules.filter(
    (rule) =>
      // The backdrop rule is the overlay's fade; the dialog's own arrival is the bare [open] one.
      /dialog\[open\]\s*$/.test(rule.selector) &&
      declarations(rule.body).some(([property]) => MOTION_PROPERTY.test(property)),
  );
  must(entry.length === 1, `expected one animated rule for dialog[open], found ${entry.length}`);
  const animated = entry[0].body.replace(/\s+/g, ' ');
  must(
    animated.includes(`animation: ${ENTRY_KEYFRAMES} var(--_motion) both`),
    `the entry must reuse ${ENTRY_KEYFRAMES} and spend the frozen --_motion slot, got: ${animated.trim()}`,
  );
  // "Reuse, do not copy": the failure mode is a second @keyframes block with the same body. The
  // library's own entry animation must be the only place that body is written down.
  const normalise = (body) => body.replace(/\s+/g, ' ').trim();
  const canonical = normalise(
    animationsSource.keyframes.find((frames) => frames.name === ENTRY_KEYFRAMES).body,
  );
  const copies = sources
    .flatMap((entrySource) => entrySource.keyframes)
    .filter((frames) => frames.name !== ENTRY_KEYFRAMES && normalise(frames.body) === canonical);
  must(
    copies.length === 0,
    `a second @keyframes is a byte-identical copy of ${ENTRY_KEYFRAMES}: ${copies
      .map((frames) => frames.name)
      .join(', ')}`,
  );

  const overlay = animationsSource.keyframes.filter((frames) => frames.name === OVERLAY_KEYFRAMES);
  must(
    overlay.length === 1,
    `expected one @keyframes ${OVERLAY_KEYFRAMES} (the backdrop's fade) in animations.css, found ${overlay.length}`,
  );
  must(
    /opacity\s*:\s*0/.test(overlay[0].body),
    `@keyframes ${OVERLAY_KEYFRAMES} must fade the overlay in from transparent, got ${overlay[0].body
      .replace(/\s+/g, ' ')
      .trim()}`,
  );
  const backdropEntry = animationsSource.rules.filter(
    (rule) => /dialog\[open\]::backdrop/.test(rule.selector) && inNoPreference(rule),
  );
  must(backdropEntry.length === 1, `expected one guarded dialog[open]::backdrop rule, found ${backdropEntry.length}`);
  must(
    backdropEntry[0].body.replace(/\s+/g, ' ').includes(`animation: ${OVERLAY_KEYFRAMES} var(--_motion) both`),
    `the overlay's fade must use ${OVERLAY_KEYFRAMES} and --_motion, got ${backdropEntry[0].body
      .replace(/\s+/g, ' ')
      .trim()}`,
  );
  return `${ENTRY_KEYFRAMES} reused twice (dialog + dropdown), ${OVERLAY_KEYFRAMES} added once, both timed by --_motion`;
});

await check('dialog.css takes no geometry: the shadow is a tier, the border is the token, and no outline is removed', () => {
  const displacement = dialogSource.declarations.filter(
    ({ property }) => property === 'transform' || property === 'translate',
  );
  must(
    displacement.length === 0,
    `a dialog is a surface, not a control: it must not be displaced (spec §3 invariant 3): ${displacement
      .map(({ property, value }) => `${property}: ${value}`)
      .join('; ')}`,
  );
  const shadows = dialogSource.declarations.filter(({ property }) => property === 'box-shadow');
  must(shadows.length === 1, `expected one box-shadow in dialog.css, found ${shadows.length}`);
  must(
    shadows[0].value === 'var(--bn-shadow-lg)',
    `a floating surface takes the largest tier by reference (ADR-0003), got ${shadows[0].value}`,
  );
  must(
    !/\d/.test(shadows[0].value),
    `a shadow may not repeat an offset, a blur or a spread as a number (invariant 2): ${shadows[0].value}`,
  );
  const widths = dialogSource.declarations.filter(({ property }) => property === 'border-width');
  must(
    widths.length === 1 && widths[0].value === 'var(--bn-border-width)',
    `the structural border must read --bn-border-width, got ${JSON.stringify(widths.map((w) => w.value))}`,
  );
  const outlines = dialogSource.declarations.filter(({ property }) => /^outline/.test(property));
  must(
    outlines.length === 0,
    `the focus ring belongs to 00-base.css; a dialog rule may not restate or remove it (spec §7 bans outline: none): ${outlines
      .map(({ property, value }) => `${property}: ${value}`)
      .join('; ')}`,
  );
  must(
    dialogSource.declarations.some(
      ({ property, value }) => property === 'box-sizing' && value === 'border-box',
    ),
    'the dialog needs box-sizing: border-box — its max-block-size is a whole box, not a content box',
  );
  return `${shadows[0].value}, border var(--bn-border-width), 0 displacements, 0 outline rules`;
});

await check('the docs page names its anchor, starts at H3, and its example is a native dialog that opens and closes', () => {
  must(fs.existsSync(abs(DOC_PAGE)), `${DOC_PAGE} is missing — one page per component (spec §10)`);
  const text = read(DOC_PAGE);
  const { frontmatter, prose, fences } = dissect(text);
  for (const key of ['title:', 'description:']) {
    must(frontmatter.includes(key), `${DOC_PAGE}: frontmatter is missing ${key}`);
  }
  const headings = prose.split(/\r?\n/).filter((line) => /^#{1,2}\s/.test(line));
  must(headings.length === 0, `${DOC_PAGE}: a component page starts at H3 (spec §10): ${headings.join(' | ')}`);
  const lead = prose.split(/\r?\n/).find((line) => line.trim() && !line.startsWith('>')) ?? '';
  must(/dialog/.test(lead), `${DOC_PAGE}: the lead sentence must name the anchor dialog, read: ${lead.slice(0, 120)}`);
  const html = fences.filter((fence) => fence.info === 'html');
  must(html.length > 0, `${DOC_PAGE}: no html fence — the rendering layer turns those into Preview/Code pairs`);
  const badInfo = fences.map((fence) => fence.info).filter((info) => !/^(?:html|css|js|text|markdown)?$/.test(info));
  must(badInfo.length === 0, `${DOC_PAGE}: fence info must stay a bare language token: ${badInfo.join(', ')}`);
  const interactive = html.find((fence) => fence.text.includes(DECLARATIVE.target));
  must(
    interactive,
    `${DOC_PAGE}: the example must open the dialog with ${DECLARATIVE.target}="${DECLARATIVE.value}" — a <script> in a fence is inert in the preview panel`,
  );
  for (const needle of [
    `<dialog`,
    `${DECLARATIVE.attribute}="${DECLARATIVE.value}"`,
    `${DECLARATIVE.target}="`,
    '<form method="dialog">',
    'autofocus',
  ]) {
    must(interactive.text.includes(needle), `${DOC_PAGE}: the opening example is missing ${JSON.stringify(needle)}`);
  }
  must(
    /<button[^>]*autofocus|<button[^>]*autofocus[^>]*>/i.test(interactive.text),
    `${DOC_PAGE}: the documented focus convention is autofocus on a button inside the dialog`,
  );
  const staticExample = html.find((fence) => /<dialog[^>]*\sopen\b/.test(fence.text));
  must(
    staticExample,
    `${DOC_PAGE}: the page must show a <dialog open> — that is the no-script appearance the ticket asks for`,
  );
  const trailing = [...text.matchAll(/\]\(([^)]*)\)/g)].map((match) => match[1]).filter((url) => url.endsWith('/'));
  must(trailing.length === 0, `${DOC_PAGE}: a trailing slash is a broken link on this site: ${trailing.join(', ')}`);
  must(
    !/data-site-|site-demo/.test(prose),
    `${DOC_PAGE}: prose must not depend on the docs-site layer's own attributes`,
  );
  return `${html.length} html fence(s), ${fences.length} fence(s), declarative open + method="dialog" close + a static <dialog open>`;
});

await check('the built artifact carries this ticket’s block and its backdrop rule', () => {
  const artifact = read(ARTIFACT);
  const marker = '/* src/css/dialog.css (@layer components) */';
  must(artifact.includes(marker), `${ARTIFACT} has no ${marker} block — run npm run build`);
  for (const needle of [
    'dialog::backdrop',
    'background-color: var(--bn-overlay)',
    '@keyframes bn-fade-in',
    '@keyframes bn-fade-in-up',
    'box-shadow: var(--bn-shadow-lg)',
  ]) {
    must(artifact.includes(needle), `${ARTIFACT} is missing ${JSON.stringify(needle)} — run npm run build`);
  }
  const backdrops = [...artifact.matchAll(/::backdrop/g)].length;
  must(backdrops > 0, `${ARTIFACT} styles no ::backdrop`);
  return `${(artifact.length / 1024).toFixed(1)} kB artifact, ${backdrops} backdrop reference(s)`;
});

await check('package.json keeps its empty dependencies object and gains this ticket’s script', () => {
  const pkg = JSON.parse(read('package.json'));
  must(
    pkg.dependencies !== undefined && Object.keys(pkg.dependencies).length === 0,
    'package.json lost its empty "dependencies": {} — scripts/verify.mjs turns red on that (orchestrator §13)',
  );
  must(
    pkg.scripts?.['verify:dialog'] === 'node scripts/verify-dialog.mjs',
    `package.json must define verify:dialog = "node scripts/verify-dialog.mjs", read ${JSON.stringify(
      pkg.scripts?.['verify:dialog'],
    )}`,
  );
  return 'dependencies = {} and verify:dialog present';
});

/* -------------------------------------- the page -------------------------------------- */

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

/**
 * Two pages, because the two claims are about two different documents.
 *
 * `modal.html` is the example the documentation shows: a declarative trigger, a dialog with an
 * `autofocus` button that is *not* the first focusable element (so "the focus went into the
 * dialog" and "the focus went to the first thing" cannot both pass), and two ways to close — a
 * `command="close"` button and a `<form method="dialog">` submit. `static.html` is the no-script
 * page: an `open` dialog with a paragraph after it, so "it is in the flow" is measurable.
 */
const MODAL_FIXTURE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <link rel="icon" href="data:,">
    <title>barnacle dialog harness</title>
    <link rel="stylesheet" href="/static/barnacle.css">
  </head>
  <body>
    <main>
      <button id="trigger" type="button" commandfor="invite" command="show-modal">Invite someone</button>
      <p id="elsewhere">A paragraph of the page, behind the overlay.</p>

      <dialog id="invite" aria-labelledby="invite-title">
        <h3 id="invite-title">Invite someone</h3>
        <p>They get an email with a link that expires in 24 hours.</p>
        <form method="dialog">
          <button id="first-focusable" type="button">Copy the link</button>
          <button id="cancel" type="button" command="close" commandfor="invite">Cancel</button>
          <button id="confirm" type="submit" autofocus>Got it</button>
        </form>
      </dialog>
    </main>
  </body>
</html>
`;

const STATIC_FIXTURE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <link rel="icon" href="data:,">
    <title>barnacle dialog harness — no script</title>
    <link rel="stylesheet" href="/static/barnacle.css">
  </head>
  <body>
    <main>
      <p id="before">Before the dialog.</p>
      <dialog id="open-attribute" open>
        <h3>No script needed</h3>
        <p>An open dialog is in the document flow.</p>
      </dialog>
      <p id="after">After the dialog.</p>
    </main>
  </body>
</html>
`;

/** Serves the fixtures from memory and the published artifact from `static/`. */
async function startServer() {
  const staticRoot = abs('static');
  const pages = {
    '/modal.html': MODAL_FIXTURE,
    '/static.html': STATIC_FIXTURE,
    '/docs.html': `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><link rel="icon" href="data:,">
<title>barnacle dialog harness — docs panel</title>
<link rel="stylesheet" href="/static/barnacle.css"></head>
<body><div class="site-demo__panel--preview" id="panel"></div></body></html>
`,
  };
  const server = http.createServer((req, res) => {
    let urlPath;
    try {
      urlPath = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    } catch {
      res.writeHead(400).end('bad url');
      return;
    }
    if (Object.hasOwn(pages, urlPath)) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(pages[urlPath]);
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
  return {
    origin,
    url: (page) => `${origin}${page}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/**
 * A mid-transition read lies convincingly, so the freeze is registered before `goto`
 * (browser-harness-findings §3.3, tests/browser/README.md). Checks that are *about* an animation
 * opt out with `{ freeze: false }` — `animation: none` would make "is there an entry animation"
 * pass or fail by construction.
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
  '*,*::before,*::after,*::backdrop{transition:none !important;animation:none !important;caret-color:transparent !important}';

async function withPage(browser, server, options, fn) {
  const { freeze = true, page: which = '/modal.html', ...contextOptions } = options ?? {};
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...contextOptions });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  // A JS-disabled context must not receive an injected script either: the point of that check is
  // the document as a visitor without script sees it.
  if (freeze && contextOptions.javaScriptEnabled !== false) {
    await page.addInitScript(FREEZE_INIT, FREEZE_CSS);
  }
  try {
    await page.goto(server.url(which), { waitUntil: 'load' });
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

/** Every check reads through one snapshot, so a value cannot be sampled twice at two moments. */
async function readComputed(page, selector, properties, pseudo = null) {
  return page.evaluate(
    ([sel, props, pseudoElement]) => {
      const el = document.querySelector(sel);
      if (!el) return { found: false };
      const cs = getComputedStyle(el, pseudoElement);
      const out = { found: true };
      for (const property of props) out[property] = cs[property];
      return out;
    },
    [selector, properties, pseudo],
  );
}

async function expectStyle(page, selector, expectations, invariantPrefix = '', pseudo = null) {
  const properties = Object.keys(expectations);
  const actual = await readComputed(page, selector, properties, pseudo);
  if (!actual.found) {
    throw new StyleAssertionError({
      invariant: `${invariantPrefix}the element exists`,
      selector,
      property: '<existence>',
      expected: 'an element matching the selector',
      actual: '<element not found>',
      hint: 'check the selector against the fixture markup in scripts/verify-dialog.mjs',
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

/** Where the focus is, as one fact: the id, the tag, and whether it is inside a given element. */
async function readFocus(page) {
  return page.evaluate(() => {
    const active = document.activeElement;
    return {
      id: active?.id ?? '',
      tag: active?.tagName ?? '<none>',
      insideDialog: Boolean(active?.closest?.('dialog')),
      dialogOpen: [...document.querySelectorAll('dialog')].map((dialog) => dialog.open),
    };
  });
}

/**
 * The dialog's surface, its border, and the page as the overlay leaves it — plus the two WCAG
 * contrast ratios between them. The overlay is translucent, so the value that matters is the
 * composite of `::backdrop` over the page behind it, not the overlay's own colour.
 *
 * Runs in the page: it may not reference this module's scope (see tests/browser/harness.mjs on the
 * `ReferenceError` that produces).
 */
async function readPalette(page, selector) {
  return page.evaluate((sel) => {
    const dialog = document.querySelector(sel);
    if (!dialog) return { found: false };
    const parse = (value) => {
      const numbers = (value.match(/[\d.]+/g) ?? []).map(Number);
      return { rgb: numbers.slice(0, 3), alpha: numbers.length > 3 ? numbers[3] : 1 };
    };
    const linear = (channel) => {
      const s = channel / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    const luminance = ([r, g, b]) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
    const over = (paint, behind) =>
      paint.rgb.map((channel, index) => channel * paint.alpha + behind[index] * (1 - paint.alpha));
    const contrast = (a, b) => {
      const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return Number(((high + 0.05) / (low + 0.05)).toFixed(2));
    };
    const page = parse(getComputedStyle(document.body).backgroundColor);
    const backdrop = getComputedStyle(dialog, '::backdrop').backgroundColor;
    const masked = over(parse(backdrop), page.rgb);
    const surface = parse(getComputedStyle(dialog).backgroundColor).rgb;
    const border = parse(getComputedStyle(dialog).borderTopColor).rgb;
    return {
      found: true,
      backdrop,
      page: page.rgb.join(','),
      masked: masked.map((channel) => Math.round(channel)).join(','),
      surface: surface.join(','),
      border: border.join(','),
      surfaceRatio: contrast(surface, masked),
      borderRatio: contrast(border, masked),
    };
  }, selector);
}

const describePalette = (label, palette) =>
  `${label}: dialog rgb(${palette.surface}) vs masked page rgb(${palette.masked}) = ${palette.surfaceRatio}:1; ` +
  `ink rgb(${palette.border}) vs masked page = ${palette.borderRatio}:1; overlay ${palette.backdrop}`;

/* =================================== browser checks =================================== */

const BROWSER_CHECKS = [
  [
    'verification 1: a declarative trigger opens the modal, focus enters it, and closing puts focus back on the trigger',
    async (browser, server) =>
      withPage(browser, server, {}, async (page, issues) => {
        // The premise of the whole documented example: the platform supports the declarative
        // attributes, so an example can open a dialog with no script at all.
        const support = await page.evaluate(() => ({
          command: 'command' in HTMLButtonElement.prototype,
          dialogCommand: 'command' in HTMLDialogElement.prototype || 'showModal' in HTMLDialogElement.prototype,
          showModal: typeof HTMLDialogElement.prototype.showModal,
          modalPseudo: CSS.supports('selector(:modal)'),
        }));
        must(
          support.showModal === 'function',
          `the target browser has no HTMLDialogElement.showModal: ${JSON.stringify(support)}`,
        );
        must(
          support.modalPseudo,
          ':modal is not supported by this browser, so dialog:not(:modal) cannot be trusted',
        );
        must(support.command, `the browser does not support the declarative command attribute: ${JSON.stringify(support)}`);

        // Nothing is open, and the trigger is where a keyboard would leave it.
        const before = await readFocus(page);
        must(before.dialogOpen.every((open) => open === false), `a dialog is open before anything was clicked: ${before.dialogOpen}`);

        await page.click('#trigger');
        const opened = await page.evaluate(() => {
          const dialog = document.querySelector('#invite');
          return {
            open: dialog.open,
            modal: dialog.matches(':modal'),
            position: getComputedStyle(dialog).position,
            active: document.activeElement?.id,
            inside: Boolean(document.activeElement?.closest('dialog')),
          };
        });
        must(opened.open, 'clicking the declarative trigger did not open the dialog');
        must(opened.modal, 'the dialog is open but not modal — show-modal did not reach the top layer');
        must(opened.position === 'fixed', `a modal dialog must be fixed in the top layer, read ${opened.position}`);
        must(
          opened.inside,
          `focus did not enter the dialog; document.activeElement is ${JSON.stringify(opened.active)}`,
        );
        must(
          opened.active === 'confirm',
          `autofocus must win over document order: expected #confirm, got ${JSON.stringify(opened.active)}`,
        );

        // Closing through `<form method="dialog">` returns focus to whatever opened the dialog.
        await page.click('#confirm');
        const closedByForm = await readFocus(page);
        must(closedByForm.dialogOpen.every((open) => open === false), 'the dialog stayed open after the form was submitted');
        must(
          closedByForm.id === 'trigger',
          `focus must return to the trigger after the form closed the dialog, got ${JSON.stringify(closedByForm.id)}`,
        );

        // A `command="close"` button does the same, and so does Escape.
        await page.click('#trigger');
        await page.click('#cancel');
        const closedByCommand = await readFocus(page);
        must(closedByCommand.dialogOpen.every((open) => open === false), 'command="close" did not close the dialog');
        must(
          closedByCommand.id === 'trigger',
          `focus must return to the trigger after command="close", got ${JSON.stringify(closedByCommand.id)}`,
        );

        await page.click('#trigger');
        await page.keyboard.press('Escape');
        const closedByEscape = await readFocus(page);
        must(closedByEscape.dialogOpen.every((open) => open === false), 'Escape did not close the dialog');
        must(
          closedByEscape.id === 'trigger',
          `focus must return to the trigger after Escape, got ${JSON.stringify(closedByEscape.id)}`,
        );

        must(issues.consoleErrors.length === 0, `console errors: ${issues.consoleErrors.join(' | ')}`);
        must(issues.pageErrors.length === 0, `page errors: ${issues.pageErrors.join(' | ')}`);
        return `command/commandfor supported + :modal; autofocus beat document order (#confirm); form, command="close" and Escape each returned focus to #trigger`;
      }),
  ],
  [
    'verification 3: the border and the hard shadow sit above the overlay, and the overlay is --bn-overlay',
    async (browser, server) =>
      withPage(browser, server, {}, async (page) => {
        await page.click('#trigger');
        await expectStyle(
          page,
          '#invite',
          {
            boxShadow: SHADOW.lg,
            borderTopWidth: BORDER_PX,
            borderTopStyle: 'solid',
            borderTopColor: COLOR.ink,
            borderRadius: RADIUS,
            backgroundColor: COLOR.paper,
            color: COLOR.ink,
            position: 'fixed',
            paddingTop: '24px',
          },
          'open modal: ',
        );
        const geometry = await page.evaluate(() => {
          const dialog = document.querySelector('#invite');
          const cs = getComputedStyle(dialog);
          const lengths = (cs.boxShadow.match(/-?[\d.]+px/g) ?? []).map(Number.parseFloat);
          return {
            shadow: cs.boxShadow,
            lengths,
            backdrop: getComputedStyle(dialog, '::backdrop').backgroundColor,
            backdropOpacity: getComputedStyle(dialog, '::backdrop').opacity,
            dialogOpacity: cs.opacity,
          };
        });
        must(
          geometry.lengths.length === 4,
          `the hard shadow must keep all four lengths (invariant 2), read ${geometry.shadow}`,
        );
        must(
          geometry.lengths[2] === 0 && geometry.lengths[3] === 0,
          `the hard shadow must keep a zero blur and a zero spread (invariant 2), read ${geometry.shadow}`,
        );
        must(
          geometry.lengths[0] === SHADOW.lgOffset && geometry.lengths[0] === geometry.lengths[1],
          `the lg tier is 1.5 × the 4px offset on both axes, read ${geometry.shadow}`,
        );
        must(
          geometry.shadow.includes(COLOR.ink),
          `the shadow must be painted in the ink, not in the overlay's colour: ${geometry.shadow}`,
        );
        must(
          geometry.dialogOpacity === '1',
          `the backdrop must not dim the dialog itself, read dialog opacity ${geometry.dialogOpacity}`,
        );
        must(
          geometry.backdrop === COLOR.overlay && geometry.backdropOpacity === '1',
          `the backdrop must be --bn-overlay (${COLOR.overlay}) at full strength, read ${geometry.backdrop} / opacity ${geometry.backdropOpacity}`,
        );

        // And the token is the source, not a literal that happens to match today: move the token.
        const moved = await page.evaluate(() => {
          document.documentElement.style.setProperty('--bn-overlay', 'rgb(12 34 56 / 0.5)');
          return getComputedStyle(document.querySelector('#invite'), '::backdrop').backgroundColor;
        });
        must(
          moved === 'rgba(12, 34, 56, 0.5)',
          `overriding --bn-overlay on :root must move the backdrop; it stayed ${moved} (a literal would)`,
        );
        return `${SHADOW.lg} over ${COLOR.overlay}; --bn-overlay override → ${moved}; dialog opacity ${geometry.dialogOpacity}`;
      }),
  ],
  [
    'verification 2: the entry animation is declared only where motion is welcome',
    async (browser, server) => {
      // No freeze here: `animation: none !important` would answer the question by construction.
      const full = await withPage(browser, server, { freeze: false }, async (page) => {
        const reduceMatches = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
        must(reduceMatches === false, 'the default context reports a reduced-motion preference');
        await page.click('#trigger');
        const open = await page.evaluate(() => {
          const dialog = document.querySelector('#invite');
          const cs = getComputedStyle(dialog);
          const backdrop = getComputedStyle(dialog, '::backdrop');
          return {
            name: cs.animationName,
            duration: cs.animationDuration,
            fill: cs.animationFillMode,
            backdropName: backdrop.animationName,
            backdropDuration: backdrop.animationDuration,
            animations: dialog.getAnimations().map((animation) => animation.playState),
          };
        });
        // The replay: a closed dialog carries no animation, so the count after a second open is
        // evidence that the rule re-applied instead of staying pinned on a finished animation.
        await page.keyboard.press('Escape');
        const closed = await page.evaluate(() => ({
          open: document.querySelector('#invite').open,
          animations: document.querySelector('#invite').getAnimations().length,
        }));
        await page.click('#trigger');
        const reopened = await page.evaluate(() =>
          document.querySelector('#invite').getAnimations().map((animation) => animation.playState),
        );
        await page.keyboard.press('Escape');
        return { ...open, closed, reopened };
      });
      const reduced = await withPage(
        browser,
        server,
        { freeze: false, reducedMotion: 'reduce' },
        async (page) => {
          const reduceMatches = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
          must(reduceMatches === true, 'the reduced-motion context option never reached the page — the guard would be untested');
          await page.click('#trigger');
          return page.evaluate(() => {
            const dialog = document.querySelector('#invite');
            return {
              name: getComputedStyle(dialog).animationName,
              backdropName: getComputedStyle(dialog, '::backdrop').animationName,
              opacity: getComputedStyle(dialog).opacity,
              open: dialog.open,
            };
          });
        },
      );
      must(
        full.name === ENTRY_KEYFRAMES,
        `the dialog must arrive with @keyframes ${ENTRY_KEYFRAMES}, read ${full.name}`,
      );
      must(
        full.duration === '0.15s' && full.fill === 'both',
        `the entry must be timed by --bn-transition (150ms) and hold its end state, read ${full.duration} / ${full.fill} (a var() in a longhand duration computes to 0s — orchestrator §13)`,
      );
      must(
        full.backdropName === OVERLAY_KEYFRAMES,
        `the overlay must fade with @keyframes ${OVERLAY_KEYFRAMES}, read ${full.backdropName}`,
      );
      must(
        reduced.name === 'none' && reduced.backdropName === 'none',
        `with reduced motion the rule must be absent, not disabled: dialog ${reduced.name} / backdrop ${reduced.backdropName}`,
      );
      must(reduced.open && reduced.opacity === '1', 'the dialog must still open and be fully visible with reduced motion');
      must(
        full.animations.length >= 1,
        'the open dialog carries no animation at all — the entry rule never reached it',
      );
      must(
        full.closed.open === false && full.closed.animations === 0,
        `a closed dialog must carry no animation, read open=${full.closed.open} animations=${full.closed.animations}`,
      );
      must(
        full.reopened.length >= 1,
        'the re-opened dialog carries no animation — the entry plays once and never again',
      );
      return `motion: ${full.name} ${full.duration} + ${full.backdropName} ${full.backdropDuration}; closed → ${full.closed.animations} animation(s); reopen → ${full.reopened.length}; reduce: ${reduced.name} / ${reduced.backdropName}, still open and opaque`;
    },
  ],
  [
    'verification 4: with JavaScript disabled, <dialog open> is styled and sits in the document flow',
    async (browser, server) =>
      withPage(browser, server, { page: '/static.html', javaScriptEnabled: false }, async (page) => {
        await expectStyle(
          page,
          '#open-attribute',
          {
            display: 'block',
            position: 'relative',
            boxShadow: SHADOW.lg,
            borderTopWidth: BORDER_PX,
            borderTopColor: COLOR.ink,
            backgroundColor: COLOR.paper,
            color: COLOR.ink,
            borderRadius: RADIUS,
          },
          'no-script <dialog open>: ',
        );
        const layout = await page.evaluate(() => {
          const dialog = document.querySelector('#open-attribute').getBoundingClientRect();
          const after = document.querySelector('#after').getBoundingClientRect();
          return {
            dialog: [dialog.top, dialog.bottom, dialog.left, dialog.right].map(Math.round),
            afterTop: Math.round(after.top),
            overlaps: !(dialog.bottom <= after.top + 1 || dialog.top >= after.bottom - 1),
          };
        });
        must(
          !layout.overlaps,
          `a non-modal <dialog open> must take its place in the flow instead of covering the next paragraph: dialog ${layout.dialog.join(',')} vs paragraph top ${layout.afterTop}`,
        );
        must(
          layout.afterTop >= layout.dialog[1] - 1,
          `the paragraph after the dialog must start below it: dialog bottom ${layout.dialog[1]}, paragraph top ${layout.afterTop}`,
        );
        return `<dialog open>: block, in flow (${layout.dialog.join(',')}), ${SHADOW.lg}, next paragraph at ${layout.afterTop}`;
      }),
  ],
  [
    'verification 3: the overlay keeps its token value in both themes, and something separates the dialog from the masked page',
    async (browser, server) =>
      withPage(browser, server, {}, async (page) => {
        await page.click('#trigger');
        const light = await readPalette(page, '#invite');
        must(light.found, 'the dialog is not in the document');
        must(
          light.backdrop === COLOR.overlay,
          `the light overlay must be --bn-overlay (${COLOR.overlay}), read ${light.backdrop}`,
        );
        must(
          Math.max(light.surfaceRatio, light.borderRatio) >= MIN_SEPARATION,
          `nothing separates the dialog from the masked page in the light theme (${describePalette('light', light)}, floor ${MIN_SEPARATION}:1)`,
        );

        await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
        await expectStyle(
          page,
          '#invite',
          {
            backgroundColor: COLOR.darkPaper,
            borderTopColor: COLOR.darkInk,
            color: COLOR.darkInk,
            boxShadow: SHADOW.lgDark,
          },
          'dark modal: ',
        );
        const dark = await readPalette(page, '#invite');
        must(
          dark.backdrop === COLOR.overlay,
          `the dark theme must leave --bn-overlay alone (spec §6.2 does not retune it), read ${dark.backdrop}`,
        );
        must(
          Math.max(dark.surfaceRatio, dark.borderRatio) >= MIN_SEPARATION,
          `nothing separates the dialog from the masked page in the dark theme (${describePalette('dark', dark)}, floor ${MIN_SEPARATION}:1)`,
        );
        await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
        return `${describePalette('light', light)} || ${describePalette('dark', dark)} (floor ${MIN_SEPARATION}:1, darker of the two is the pair that carries the separation)`;
      }),
  ],
  [
    'the documented example works as written (injected the way the docs page injects a fence)',
    async (browser, server) =>
      withPage(browser, server, { page: '/docs.html' }, async (page, issues) => {
        const { fences } = dissect(read(DOC_PAGE));
        const example = fences.find((fence) => fence.info === 'html' && fence.text.includes(DECLARATIVE.target));
        must(example, `${DOC_PAGE}: no interactive html fence to inject`);
        // static/site.js parses the fence text into a template and appends the fragment: a <script>
        // in it would be inert, which is exactly why the example must be declarative.
        const injected = await page.evaluate((text) => {
          const template = document.createElement('template');
          template.innerHTML = text;
          document.querySelector('#panel').appendChild(template.content);
          const trigger = document.querySelector('#panel [commandfor]');
          const dialog = document.querySelector('#panel dialog');
          return {
            trigger: trigger?.tagName ?? '<none>',
            command: trigger?.getAttribute('command') ?? '',
            dialogId: dialog?.id ?? '',
            target: trigger?.getAttribute('commandfor') ?? '',
            autofocus: [...(dialog?.querySelectorAll('[autofocus]') ?? [])].length,
          };
        }, example.text);
        must(injected.trigger !== '<none>', 'the example has no declarative trigger');
        must(
          injected.command === DECLARATIVE.value,
          `the example's trigger must use command="${DECLARATIVE.value}", read ${JSON.stringify(injected.command)}`,
        );
        must(
          injected.target === injected.dialogId,
          `commandfor must name the dialog's id (${injected.dialogId}), read ${JSON.stringify(injected.target)}`,
        );
        must(injected.autofocus >= 1, 'the example documents autofocus but no element in it carries the attribute');

        await page.click('#panel [commandfor]');
        const opened = await page.evaluate(() => {
          const dialog = document.querySelector('#panel dialog');
          return {
            open: dialog?.open ?? false,
            modal: dialog?.matches(':modal') ?? false,
            focusInside: Boolean(document.activeElement?.closest('dialog')),
            focusId: document.activeElement?.id ?? '',
            focusTag: document.activeElement?.tagName ?? '',
            focusAutofocus: document.activeElement?.hasAttribute?.('autofocus') ?? false,
          };
        });
        must(opened.open && opened.modal, 'the documented example did not open as a modal dialog');
        must(opened.focusInside, `focus did not enter the documented dialog, it is on ${opened.focusTag}#${opened.focusId}`);
        must(
          opened.focusAutofocus,
          `the documented autofocus convention did not take effect: focus landed on ${opened.focusTag}#${opened.focusId}`,
        );

        await page.click('#panel dialog [type="submit"]');
        const closed = await page.evaluate(() => ({
          open: document.querySelector('#panel dialog')?.open ?? true,
          focusInside: Boolean(document.activeElement?.closest('dialog')),
          focusTag: document.activeElement?.tagName ?? '',
          focusCommand: document.activeElement?.getAttribute?.('commandfor') ?? null,
        }));
        must(!closed.open, 'the documented close button did not close the dialog');
        must(!closed.focusInside, 'focus stayed inside a dialog that is now closed');
        must(
          closed.focusTag === 'BUTTON' && closed.focusCommand,
          `focus must return to the documented trigger, it is on ${closed.focusTag}`,
        );
        must(issues.consoleErrors.length === 0, `console errors: ${issues.consoleErrors.join(' | ')}`);
        must(issues.pageErrors.length === 0, `page errors: ${issues.pageErrors.join(' | ')}`);
        return `injected via template.innerHTML → open, focus on ${opened.focusTag} (autofocus), closed by the submit button, focus back on ${closed.focusTag}`;
      }),
  ],
];

/** Browser checks need playwright-core; without it they skip loudly, exactly as ticket 08's do. */
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
  console.log(`      ${server.url('/modal.html')} on system Chrome ${browser.version()}\n`);
  try {
    for (const [name, fn] of BROWSER_CHECKS) await check(name, () => fn(browser, server));
  } finally {
    await browser.close();
    await server.close();
  }
}

await runBrowserChecks();

/* ====================================== summary ====================================== */

console.log(`\n${checks - failures.length}/${checks} checks passed${skips ? `, ${skips} skipped` : ''}`);
if (failures.length > 0) {
  console.log('\nfailed:');
  for (const name of failures) console.log(`  - ${name}`);
  process.exit(1);
}
