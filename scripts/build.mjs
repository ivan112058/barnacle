#!/usr/bin/env node
/**
 * barnacle build chain — one command, four artifacts.
 *
 *   src/css/*.css   concatenated in CSS_MANIFEST order (each inside its layer)
 *                     -> static/barnacle.css     -> esbuild --minify -> static/barnacle.min.css
 *   src/js/index.js   esbuild --bundle --format=iife
 *                     -> static/barnacle.js      -> esbuild --minify -> static/barnacle.min.js
 *
 * Two contracts live here and nowhere else:
 *
 *   1. LAYER_ORDER is the cascade layer order (ADR-0006, a public contract).
 *      src/css/00-base.css must carry that exact declaration on line 1 — that is
 *      what makes "unlayered user styles always win" unconditional, and why the
 *      declaration must survive minification. New layers are appended, never inserted.
 *   2. CSS_MANIFEST is the concatenation order (spec §5). Every file is emitted
 *      inside its layer block, so a component file writes plain declarations and
 *      never its own `@layer`.
 *
 * Every failure throws, so the process exits non-zero and no half-built artifact
 * is published: a missing file, a wrong declaration, an unknown layer, a file
 * declaring its own layer, an esbuild warning, or ESM syntax leaking into the
 * IIFE bundle.
 */
import { build, formatMessagesSync } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Cascade layer order — public contract, ADR-0006. Append new layers at the end only. */
export const LAYER_ORDER = ['theme', 'base', 'components', 'animations', 'utilities'];

/** Must be line 1 of src/css/00-base.css, verbatim, and line 1 of the artifact. */
export const LAYER_DECLARATION = `@layer ${LAYER_ORDER.join(', ')};`;

/** The file that carries the declaration. It cannot be dropped from the manifest. */
const DECLARATION_FILE = '00-base.css';

/**
 * Concatenation order — spec.md §5, prefix is the order. `layer` is the block each
 * file is emitted into; component tickets edit their own file, never this list.
 */
export const CSS_MANIFEST = [
  { file: '00-base.css', layer: 'base' },
  { file: '01-theme.css', layer: 'theme' },
  { file: 'animations.css', layer: 'animations' },
  { file: 'button.css', layer: 'components' },
  { file: 'card.css', layer: 'components' },
  { file: 'badge.css', layer: 'components' },
  { file: 'alert.css', layer: 'components' },
  { file: 'form.css', layer: 'components' },
  { file: 'table.css', layer: 'components' },
  { file: 'dialog.css', layer: 'components' },
  { file: 'accordion.css', layer: 'components' },
  { file: 'progress.css', layer: 'components' },
  { file: 'spinner.css', layer: 'components' },
  { file: 'skeleton.css', layer: 'components' },
  { file: 'dropdown.css', layer: 'components' },
  { file: 'tabs.css', layer: 'components' },
  { file: 'taginput.css', layer: 'components' },
  { file: 'toast.css', layer: 'components' },
  { file: 'layout.css', layer: 'components' },
  { file: 'utilities.css', layer: 'utilities' },
];

export const JS_ENTRY = 'src/js/index.js';

export const ARTIFACTS = {
  css: 'static/barnacle.css',
  cssMin: 'static/barnacle.min.css',
  js: 'static/barnacle.js',
  jsMin: 'static/barnacle.min.js',
};

function fail(message) {
  throw new Error(message);
}

function sourcePath(file) {
  return path.join(ROOT, 'src/css', file);
}

/** Reads one manifest entry, validates it, and returns it ready for the artifact. */
function prepareSource(entry) {
  const rel = `src/css/${entry.file}`;
  if (!LAYER_ORDER.includes(entry.layer)) {
    fail(
      `${rel}: layer "${entry.layer}" is not in LAYER_ORDER (${LAYER_ORDER.join(', ')}). ` +
        'A new layer is appended at the end of LAYER_ORDER, never inserted.',
    );
  }

  let text;
  try {
    text = readFileSync(sourcePath(entry.file), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      fail(`${rel}: listed in CSS_MANIFEST but missing on disk — restore it or remove it from the manifest.`);
    }
    throw error;
  }

  // LF in the artifact regardless of the editor that wrote the source.
  const lines = text.replace(/\r\n/g, '\n').split('\n');

  if (entry.file === DECLARATION_FILE && lines[0] !== LAYER_DECLARATION) {
    fail(
      `${rel}: line 1 must be the layer declaration ${JSON.stringify(LAYER_DECLARATION)} ` +
        `but found ${JSON.stringify(lines[0] ?? '')}`,
    );
  }

  const body = entry.file === DECLARATION_FILE ? lines.slice(1) : lines;
  const offset = entry.file === DECLARATION_FILE ? 2 : 1;
  for (const [index, line] of body.entries()) {
    if (/^@layer\b/.test(line)) {
      fail(
        `${rel}:${index + offset}: remove this @layer — layer assignment lives in ` +
          `CSS_MANIFEST in scripts/build.mjs (this file is emitted into @layer ${entry.layer}).`,
      );
    }
  }

  return { rel, layer: entry.layer, css: body.join('\n').replace(/\s+$/, '') };
}

/**
 * The exact text of one file's block, marker comment included. `concatenateLayerBlocks` joins
 * these; verification reads them one at a time, so an audit can measure one source file without
 * re-implementing the build chain (ticket 09's `verify-interaction.mjs` does exactly that).
 */
export function layerBlock(source) {
  return [`/* ${source.rel} (@layer ${source.layer}) */`, `@layer ${source.layer} {`, source.css, '}'].join('\n');
}

/** Concatenates the layer blocks only — the declaration is handled separately. */
export function concatenateLayerBlocks(sources) {
  return `${sources.map(layerBlock).join('\n')}\n`;
}

/** The unminified artifact: line 1 is always the declaration. */
export function concatenateCss(sources) {
  return `${LAYER_DECLARATION}\n${concatenateLayerBlocks(sources)}`;
}

/**
 * ADR-0006 is checked on both artifacts: `head -1` of either one is the declaration,
 * byte for byte. The minified artifact is assembled as declaration + minified blocks
 * so that minification cannot bury it inside a single line.
 */
function assertDeclarationFirst(text, label) {
  const line = text.split('\n', 1)[0].replace(/\r$/, '');
  if (line !== LAYER_DECLARATION) {
    fail(`${label}: line 1 must be ${JSON.stringify(LAYER_DECLARATION)} but is ${JSON.stringify(line)}`);
  }
}

function describe(messages, kind) {
  if (!messages?.length) return [];
  return formatMessagesSync(messages, { kind, color: false });
}

async function esbuildRun(options) {
  try {
    return await build({ write: false, logLevel: 'silent', ...options });
  } catch (error) {
    const details = describe(error.errors, 'error');
    fail(`esbuild failed:\n${details.length > 0 ? details.join('\n') : error.message}`);
  }
}

/** Warnings are build failures: a warning here means a broken artifact could ship. */
function assertNoWarnings(results) {
  const messages = results.flatMap((result) => result.warnings ?? []);
  if (messages.length > 0) {
    fail(`esbuild reported ${messages.length} warning(s):\n${describe(messages, 'warning').join('\n')}`);
  }
}

/** An IIFE bundle that leaks module syntax breaks every plain <script> tag. */
function assertIife(text, label) {
  const statement = text.match(/^\s*(?:import|export)\b.*$/m);
  if (statement) {
    fail(`${label}: IIFE output contains module syntax: ${statement[0].trim()}`);
  }
}

function write(rel, contents) {
  const target = path.join(ROOT, rel);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, contents);
  return Buffer.byteLength(contents);
}

export async function buildAll() {
  const sources = CSS_MANIFEST.map(prepareSource);
  const blocks = concatenateLayerBlocks(sources);
  const css = concatenateCss(sources);
  assertDeclarationFirst(css, ARTIFACTS.css);

  const cssMin = await esbuildRun({
    stdin: { contents: blocks, resolveDir: ROOT, sourcefile: 'barnacle.css', loader: 'css' },
    minify: true,
  });
  const cssMinText = `${LAYER_DECLARATION}\n${cssMin.outputFiles[0].text}`;
  assertDeclarationFirst(cssMinText, ARTIFACTS.cssMin);

  const bundle = await esbuildRun({
    entryPoints: [path.join(ROOT, JS_ENTRY)],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    legalComments: 'none',
  });
  const js = bundle.outputFiles[0].text;
  assertIife(js, ARTIFACTS.js);

  // format: 'iife' on the minify pass too — otherwise the minifier is free to inline
  // the wrapper away, and an IIFE artifact that is not an IIFE is not what we promise.
  const jsMin = await esbuildRun({
    stdin: { contents: js, resolveDir: ROOT, sourcefile: 'barnacle.js', loader: 'js' },
    format: 'iife',
    minify: true,
  });
  const jsMinText = jsMin.outputFiles[0].text;
  assertIife(jsMinText, ARTIFACTS.jsMin);

  assertNoWarnings([cssMin, bundle, jsMin]);

  const written = [
    [ARTIFACTS.css, write(ARTIFACTS.css, css)],
    [ARTIFACTS.cssMin, write(ARTIFACTS.cssMin, cssMinText)],
    [ARTIFACTS.js, write(ARTIFACTS.js, js)],
    [ARTIFACTS.jsMin, write(ARTIFACTS.jsMin, jsMinText)],
  ];

  return { written, warnings: 0, files: sources.length };
}

const isMain = (() => {
  if (!process.argv[1]) return false;
  const invoked = path.resolve(process.argv[1]);
  const self = fileURLToPath(import.meta.url);
  return process.platform === 'win32' ? invoked.toLowerCase() === self.toLowerCase() : invoked === self;
})();

if (isMain) {
  try {
    const { written, files } = await buildAll();
    for (const [rel, bytes] of written) {
      console.log(`[barnacle] ${rel.padEnd(26)} ${String(bytes).padStart(6)} B`);
    }
    console.log(`[barnacle] build ok: ${written.length} artifacts from ${files} css files, 0 warnings, 0 errors`);
  } catch (error) {
    console.error(`[barnacle] build failed: ${error.message}`);
    process.exitCode = 1;
  }
}
