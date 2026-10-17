#!/usr/bin/env node
/*
 * scripts/i18n-zh.mjs — build content/**\/<name>.zh.md from the English master + a Chinese sidecar.
 *
 * Why this exists (ticket 23): the Chinese page and the English page must share ONE copy of every
 * example source. Ticket 04 forbids new syntax in content files (authors write standard Markdown
 * fences and nothing else), seite does not process Tera inside a Markdown body (measured: a
 * `{% include %}` in a body comes out verbatim), and a custom shortcode only gets
 * {page{title,slug,collection,tags}, site{title,base_url,language,contact}, t, ...arguments} —
 * no page content, no data/ — so the only place a fence can be shared is the build:
 *
 *   content/components/button.md          English master. Owns every fence verbatim.
 *   i18n/zh/components/button.md          Chinese sidecar: frontmatter + Chinese prose, with
 *                                         `<!-- fence:0 -->` standing in for the master's fence #0.
 *   content/components/button.zh.md       GENERATED. Never edited by hand.
 *
 * Usage:
 *   node scripts/i18n-zh.mjs            write every generated page
 *   node scripts/i18n-zh.mjs --check    exit 1 if a generated page is missing, stale, orphaned or
 *                                       hand-edited (this is what CI runs, after writing)
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export const CONTENT_DIR = 'content';
export const SIDECAR_DIR = join('i18n', 'zh');
export const LANG_SUFFIX = '.zh.md';

/** `<!-- fence:0 -->` — the whole line stands in for the English master's fence #0. */
const PLACEHOLDER = /^[ \t]*<!--[ \t]*fence:(\d+)[ \t]*-->[ \t]*$/;
/** An opening fence: up to three spaces of indent, then three or more backticks or tildes. */
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})[ \t]*(.*)$/;

const banner = (sidecarRel) =>
  `# 本文件由 scripts/i18n-zh.mjs 从 ${sidecarRel} 生成，请勿手改；要改译文请改那边。`;

/** Split `---\n…\n---\n` off the front of a file. Line endings are normalised to \n. */
export function splitFrontmatter(text, file) {
  const normalised = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (!normalised.startsWith('---\n')) {
    throw new Error(`${file}: expected a YAML frontmatter block starting with "---"`);
  }
  const close = normalised.indexOf('\n---', 4);
  if (close === -1) throw new Error(`${file}: unterminated frontmatter (no closing "---")`);
  const afterClose = normalised.indexOf('\n', close + 4);
  return {
    frontmatter: normalised.slice(4, close),
    body: afterClose === -1 ? '' : normalised.slice(afterClose + 1),
  };
}

/**
 * Split a Markdown body into its fenced blocks and the prose around them.
 *
 * `fences[i]` is block i exactly as written — opening line, body lines, closing line, each with its
 * trailing newline — so the Chinese page can receive the English bytes unchanged. `prose` is the
 * body with each fence replaced by an empty line, which is what the token checks in
 * scripts/verify-i18n.mjs look at.
 */
export function splitBody(body, file) {
  const lines = body.split('\n');
  const fences = [];
  const prose = [];
  let i = 0;
  while (i < lines.length) {
    const open = FENCE_OPEN.exec(lines[i]);
    if (!open) {
      prose.push(lines[i]);
      i += 1;
      continue;
    }
    const marker = open[1];
    const closeRe = new RegExp(`^ {0,3}${marker[0] === '`' ? '`' : '~'}{${marker.length},}[ \\t]*$`);
    let j = i + 1;
    while (j < lines.length && !closeRe.test(lines[j])) j += 1;
    if (j === lines.length) throw new Error(`${file}: fence opened on line ${i + 1} is never closed`);
    fences.push(`${lines.slice(i, j + 1).join('\n')}\n`);
    prose.push('');
    i = j + 1;
  }
  return { fences, prose: prose.join('\n') };
}

/** Every English master, as a path relative to content/ ("components/button.md"). */
export function listMasters() {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.md') && !entry.name.endsWith(LANG_SUFFIX)) {
        out.push(relative(CONTENT_DIR, path).split(sep).join('/'));
      }
    }
  };
  walk(CONTENT_DIR);
  return out.sort();
}

/** Render one page: content/<masterRel> + i18n/zh/<masterRel> → the .zh.md text. */
export function renderPage(masterRel) {
  const masterPath = join(CONTENT_DIR, masterRel);
  const sidecarPath = join(SIDECAR_DIR, masterRel.split('/').join(sep));

  const master = splitFrontmatter(readFileSync(masterPath, 'utf8'), masterPath);
  const { fences } = splitBody(master.body, masterPath);

  const sidecar = splitFrontmatter(readFileSync(sidecarPath, 'utf8'), sidecarPath);
  const bodyLines = sidecar.body.split('\n').map((line) => {
    if (FENCE_OPEN.test(line)) {
      throw new Error(
        `${sidecarPath}: the sidecar must not contain a fence — the examples are shared with the ` +
          `English page. Use <!-- fence:N --> instead.`,
      );
    }
    const placeholder = PLACEHOLDER.exec(line);
    if (!placeholder) return line;
    const index = Number(placeholder[1]);
    if (!Number.isInteger(index) || index < 0 || index >= fences.length) {
      throw new Error(
        `${sidecarPath}: <!-- fence:${index} --> has no counterpart — ${masterPath} has ` +
          `${fences.length} fence(s) (0…${fences.length - 1}).`,
      );
    }
    return `\u0000${index}\u0000`;
  });

  // Every fence must be referenced exactly once: a partial page would silently drop examples.
  const used = bodyLines.flatMap((line) => [...line.matchAll(/\u0000(\d+)\u0000/g)].map((m) => Number(m[1])));
  const missing = fences.map((_, index) => index).filter((index) => !used.includes(index));
  const duplicated = [...new Set(used.filter((index, at) => used.indexOf(index) !== at))];
  if (missing.length > 0) {
    throw new Error(
      `${sidecarPath}: fence(s) ${missing.join(', ')} of ${masterPath} are never referenced; ` +
        `every fence needs exactly one <!-- fence:N --> placeholder.`,
    );
  }
  if (duplicated.length > 0) {
    throw new Error(`${sidecarPath}: fence(s) ${duplicated.join(', ')} are referenced twice.`);
  }

  const body = bodyLines
    .join('\n')
    // The placeholder line is replaced by the fence *without* its trailing newline: the sidecar
    // already supplies the line break, so a placeholder surrounded by blank lines lands with
    // exactly one blank line on each side — the shape the English master has.
    .replace(/\u0000(\d+)\u0000/g, (_, index) => fences[Number(index)].replace(/\n$/, ''));
  const frontmatter = sidecar.frontmatter.replace(/^\n+|\n+$/g, '');
  return `---\n${banner(masterRel)}\n${frontmatter}\n---\n\n${body.replace(/^\n+/, '')}`;
}

/** The generated target path for a master, relative to the working directory. */
export const targetOf = (masterRel) =>
  join(CONTENT_DIR, masterRel.split('/').join(sep)).replace(/\.md$/, LANG_SUFFIX);

function main(argv) {
  const check = argv.includes('--check');
  const masters = listMasters();
  const problems = [];
  let written = 0;
  let current = 0;

  for (const masterRel of masters) {
    const target = targetOf(masterRel);
    const sidecar = join(SIDECAR_DIR, masterRel.split('/').join(sep));
    if (!existsSync(sidecar)) continue; // untranslated master: nothing to generate
    let expected;
    try {
      expected = renderPage(masterRel);
    } catch (error) {
      problems.push(error.message);
      continue;
    }
    const actual = existsSync(target) ? readFileSync(target, 'utf8') : null;
    if (actual === expected) {
      current += 1;
      continue;
    }
    if (check) {
      problems.push(`${target}: ${actual === null ? 'missing — run node scripts/i18n-zh.mjs' : 'stale — the sidecar changed, run node scripts/i18n-zh.mjs'}`);
      continue;
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, expected, 'utf8');
    written += 1;
  }

  // A hand-written .zh.md is exactly what ticket 23 forbids: two copies of the examples. Every
  // Chinese page in content/ must be one this script owns, and every one of them needs its sidecar.
  for (const chinese of listChinese()) {
    if (!existsSync(join(SIDECAR_DIR, chinese.sidecar))) {
      problems.push(`${chinese.target}: hand-written Chinese page — it must be generated from i18n/zh/${chinese.sidecar}`);
    }
    if (!existsSync(join(CONTENT_DIR, chinese.sidecar.split('/').join(sep)))) {
      problems.push(`${chinese.target}: Chinese page without an English master (expected content/${chinese.sidecar})`);
    }
  }
  for (const sidecarRel of listSidecars()) {
    if (!existsSync(join(CONTENT_DIR, sidecarRel.split('/').join(sep)))) {
      problems.push(`${join(SIDECAR_DIR, sidecarRel)}: sidecar without an English master (expected ${join(CONTENT_DIR, sidecarRel)})`);
    }
  }

  if (problems.length > 0) {
    for (const problem of problems) console.error(`✗ ${problem}`);
    console.error(`\n${problems.length} problem(s).`);
    return 1;
  }
  console.log(
    check
      ? `✓ every generated Chinese page matches its sidecar (${current} checked)`
      : `✓ generated ${written} Chinese page(s), ${current} already up to date`,
  );
  return 0;
}

function listSidecars() {
  if (!existsSync(SIDECAR_DIR)) return [];
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.md')) out.push(relative(SIDECAR_DIR, path).split(sep).join('/'));
    }
  };
  walk(SIDECAR_DIR);
  return out.sort();
}

/** Every *.zh.md under content/, with the sidecar/master path it should correspond to. */
function listChinese() {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(LANG_SUFFIX)) {
        const rel = relative(CONTENT_DIR, path).split(sep).join('/');
        out.push({ target: join(CONTENT_DIR, rel.split('/').join(sep)), sidecar: rel.replace(/\.zh\.md$/, '.md') });
      }
    }
  };
  walk(CONTENT_DIR);
  return out.sort((a, b) => a.target.localeCompare(b.target));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
