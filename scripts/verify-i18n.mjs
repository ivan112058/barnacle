#!/usr/bin/env node
/*
 * scripts/verify-i18n.mjs — the bilingual site's checks (ticket 23).
 *
 * The four verification methods of the ticket, in order:
 *
 *   1. fences are byte-identical between an English page and its Chinese twin — checked twice, in
 *      content/ (the source of truth) and in dist/ (what the browser actually receives);
 *   2. the language switcher lands on the SAME page, not the homepage — checked statically for
 *      every built page (the link's target must exist and must be that page's counterpart) and,
 *      when a Chrome is available, by really clicking it;
 *   3. `<html lang>` and the head's hreflang/x-default links, plus the sitemap alternates;
 *   4. no translated class name, attribute name or token name in the Chinese pages.
 *
 * Static checks decide the exit code; the browser checks are SKIPped when playwright-core or a
 * Chrome binary is unavailable, exactly like scripts/verify-demo.mjs.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONTENT_DIR, SIDECAR_DIR, listMasters, renderPage, splitBody, splitFrontmatter, targetOf } from './i18n-zh.mjs';
import { listenOnFreePort } from './lib/server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const ZH = '/zh';
const DEFAULT_LANG = 'en';

const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
const exists = (...parts) => fs.existsSync(path.join(ROOT, ...parts));

/* ------------------------------------------------------------------ site configuration --- */

function seiteToml() {
  const text = read('seite.toml');
  const baseUrl = (text.match(/^base_url\s*=\s*"([^"]*)"/m) ?? [, ''])[1];
  const language = (text.match(/^language\s*=\s*"([^"]*)"/m) ?? [, ''])[1];
  const listed = [...text.matchAll(/\[\[collections\]\]([\s\S]*?)(?=\n\[|$)/g)]
    .map((match) => match[1])
    .filter((block) => /^listed\s*=\s*true\s*$/m.test(block))
    .map((block) => (block.match(/^name\s*=\s*"([^"]*)"/m) ?? [, ''])[1]);
  return { text, baseUrl, language, listed };
}

/* ------------------------------------------------------------------------ build output --- */

function htmlFiles(dir = DIST) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...htmlFiles(absolute));
    else if (entry.name.endsWith('.html')) out.push(path.relative(DIST, absolute).split(path.sep).join('/'));
  }
  return out.sort();
}

/** dist path → published URL path: "zh/components/index.html" → "/zh/components/", "index.html" → "/". */
function urlOf(htmlRel) {
  if (htmlRel === 'index.html') return '/';
  if (htmlRel.endsWith('/index.html')) return `/${htmlRel.slice(0, -'index.html'.length)}`;
  return `/${htmlRel.replace(/\.html$/, '')}`;
}

/** published URL path → dist path: "/zh/components/" → "zh/components/index.html". */
function fileOf(url) {
  if (url.endsWith('/')) return `${url.slice(1)}index.html`;
  return `${url.slice(1)}.html`;
}

/** Is this published URL one of the files seite wrote? */
const built = (url) => exists('dist', fileOf(url));

const isChinese = (url) => url === ZH || url.startsWith(`${ZH}/`);

/** The same page in the other language. */
function counterpart(url) {
  if (url === '/') return '/zh/';
  if (url === '/zh/' || url === '/zh') return '/';
  if (isChinese(url)) return url.slice(ZH.length);
  return `${ZH}${url}`;
}

/* ------------------------------------------------------------------------- the checks --- */

const CHECKS = [];
const check = (name, fn) => CHECKS.push([name, fn]);

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

/** All fenced blocks of a content file, or of both languages of a pair. */
function fencesOf(relPath) {
  const file = path.join(ROOT, relPath);
  return splitBody(splitFrontmatter(fs.readFileSync(file, 'utf8'), relPath).body, relPath).fences;
}

/** Every `<pre>…</pre>` of a built page, verbatim — the fence as the browser receives it. */
function presOf(htmlRel) {
  const html = fs.readFileSync(path.join(DIST, htmlRel), 'utf8');
  return [...html.matchAll(/<pre[\s>][\s\S]*?<\/pre>/g)].map((match) => match[0]);
}

const pairOf = (masterRel) => path.posix.join(CONTENT_DIR, masterRel.replace(/\.md$/, '.zh.md'));

/* ---- 1. configuration ------------------------------------------------------------------ */

check('seite.toml declares [languages.zh] — without it .zh.md silently publishes English pages at /button.zh', () => {
  const { text, language } = seiteToml();
  assert(language === DEFAULT_LANG, `[site] language must be "${DEFAULT_LANG}", found "${language}"`);
  assert(/^\[languages\.zh\]$/m.test(text), 'seite.toml has no [languages.zh] table');
  return '[site] language = "en", [languages.zh] present';
});

/* ---- 2. every English page has a Chinese twin, and every Chinese page is generated -------- */

check('every English content page has a Chinese twin, and every Chinese page is generated from a sidecar', () => {
  const masters = listMasters();
  const missingTwin = [];
  const missingSidecar = [];
  for (const masterRel of masters) {
    if (!exists(SIDECAR_DIR, masterRel)) missingSidecar.push(masterRel);
    if (!exists(targetOf(masterRel))) missingTwin.push(masterRel);
  }
  assert(missingSidecar.length === 0, `no sidecar under i18n/zh/ for: ${missingSidecar.join(', ')}`);
  assert(missingTwin.length === 0, `no generated Chinese page for: ${missingTwin.join(', ')}`);
  return `${masters.length} English pages, ${masters.length} Chinese pages, ${masters.length} sidecars`;
});

check('the committed Chinese pages are exactly what scripts/i18n-zh.mjs renders (idempotent, not hand-edited)', () => {
  const stale = [];
  for (const masterRel of listMasters()) {
    const target = targetOf(masterRel);
    if (!exists(target)) continue;
    if (fs.readFileSync(path.join(ROOT, target), 'utf8') !== renderPage(masterRel)) stale.push(target);
  }
  assert(stale.length === 0, `stale or hand-edited (run node scripts/i18n-zh.mjs): ${stale.join(', ')}`);
  return 're-rendering every page reproduces it byte for byte';
});

/* ---- 3. verification method 1 — the fences are the same bytes ---------------------------- */

check('verification 1: every fence is byte-identical between the English and the Chinese source page', () => {
  let pages = 0;
  let fences = 0;
  for (const masterRel of listMasters()) {
    const english = fencesOf(path.posix.join(CONTENT_DIR, masterRel));
    const chinese = fencesOf(path.posix.join(CONTENT_DIR, masterRel.replace(/\.md$/, '.zh.md')));
    assert(
      english.length === chinese.length,
      `${masterRel}: ${english.length} fences in English, ${chinese.length} in Chinese`,
    );
    for (let i = 0; i < english.length; i += 1) {
      assert(english[i] === chinese[i], `${masterRel}: fence #${i} differs between the two languages`);
    }
    pages += 1;
    fences += english.length;
  }
  return `${pages} page pairs, ${fences} fences, zero differences`;
});

check('verification 1: the built Chinese page carries the same <pre> markup as the English page', () => {
  let compared = 0;
  for (const htmlRel of htmlFiles()) {
    const url = urlOf(htmlRel);
    if (isChinese(url) || url.endsWith('404')) continue;
    const twin = counterpart(url);
    if (!built(twin)) continue;
    if (url.endsWith('/')) continue;
    const english = presOf(htmlRel);
    const chinese = presOf(fileOf(twin));
    assert(
      english.length === chinese.length,
      `${url}: ${english.length} <pre> blocks in English, ${chinese.length} in Chinese`,
    );
    for (let i = 0; i < english.length; i += 1) {
      assert(english[i] === chinese[i], `${url}: rendered fence #${i} differs (highlighting or escaping)`);
    }
    compared += 1;
  }
  return `${compared} page pairs compared in dist/, identical including seite's spans`;
});

/* ---- 4. verification method 2 — the switcher stays on the same page ---------------------- */

check('verification 2: every page links to its own counterpart (same page, other language) — never the homepage', () => {
  let pages = 0;
  for (const htmlRel of htmlFiles()) {
    const url = urlOf(htmlRel);
    const twin = counterpart(url);
    if (url.endsWith('404')) {
      assert(!/class="site-lang__item"/.test(fs.readFileSync(path.join(DIST, htmlRel), 'utf8')), `${url}: 404 page has a switcher`);
      continue;
    }
    const html = fs.readFileSync(path.join(DIST, htmlRel), 'utf8');
    const links = [...html.matchAll(/<a class="site-lang__item" href="([^"]+)"/g)].map((match) => match[1]);
    assert(links.length === 1, `${url}: ${links.length} switcher links, expected 1`);
    const { baseUrl } = seiteToml();
    assert(links[0] === `${baseUrl}${twin}`, `${url}: switcher points at ${links[0]}, expected ${baseUrl}${twin}`);
    assert(built(twin), `${url}: switcher target ${twin} is not in dist/`);
    assert((html.match(/class="site-lang__item site-lang__item--current"/g) ?? []).length === 1, `${url}: no current-language item`);
    pages += 1;
  }
  return `${pages} pages, each pointing at its counterpart`;
});

/* ---- 5. verification method 3 — lang attribute, head alternates, sitemap ----------------- */

check('verification 3: <html lang> is "en" on English pages and "zh" on Chinese pages', () => {
  const wrong = [];
  for (const htmlRel of htmlFiles()) {
    const html = fs.readFileSync(path.join(DIST, htmlRel), 'utf8');
    const found = (html.match(/<html lang="([^"]*)"/) ?? [, ''])[1];
    const expected = isChinese(urlOf(htmlRel)) ? 'zh' : 'en';
    if (found !== expected) wrong.push(`${htmlRel}: lang="${found}", expected "${expected}"`);
  }
  assert(wrong.length === 0, wrong.join('; '));
  return `${htmlFiles().length} built pages`;
});

check('verification 3: <head> carries hreflang en + zh + x-default pointing at the pair (seite does NOT emit these)', () => {
  const { baseUrl } = seiteToml();
  let pages = 0;
  for (const htmlRel of htmlFiles()) {
    const url = urlOf(htmlRel);
    if (url.endsWith('404')) continue;
    const html = fs.readFileSync(path.join(DIST, htmlRel), 'utf8');
    const head = (html.match(/<head>[\s\S]*?<\/head>/) ?? [html])[0];
    const alternates = [...head.matchAll(/<link rel="alternate" hreflang="([^"]*)" href="([^"]*)">/g)].map((match) => ({
      lang: match[1],
      href: match[2],
    }));
    assert(alternates.length === 3, `${url}: ${alternates.length} alternates, expected en+zh+x-default`);
    const by = Object.fromEntries(alternates.map((alternate) => [alternate.lang, alternate.href]));
    assert(by.en === `${baseUrl}${url.startsWith(ZH) ? counterpart(url) : url}`, `${url}: hreflang en = ${by.en}`);
    assert(by.zh === `${baseUrl}${url.startsWith(ZH) ? url : counterpart(url)}`, `${url}: hreflang zh = ${by.zh}`);
    assert(by['x-default'] === by.en, `${url}: x-default = ${by['x-default']}, expected the English URL`);
    // Ticket 23 asks for a third thing: all three must point at pages that were actually built, so a
    // section that grows a translation without a page cannot ship a hreflang to a 404.
    for (const [language, href] of Object.entries(by)) {
      const target = href.slice(baseUrl.length) || '/';
      assert(built(target), `${url}: hreflang ${language} points at ${target}, which is not in dist/`);
    }
    pages += 1;
  }
  return `${pages} pages with en / zh / x-default, each pointing at a built page`;
});

check('verification 3: sitemap.xml gets its alternates from seite automatically, including zh', () => {
  const { baseUrl } = seiteToml();
  const sitemap = read('dist', 'sitemap.xml');
  const entries = [...sitemap.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((match) => match[1]);
  let paired = 0;
  let withXDefault = 0;
  for (const htmlRel of htmlFiles()) {
    const url = urlOf(htmlRel);
    if (url.endsWith('404') || url.endsWith('/')) continue;
    const loc = `${baseUrl}${url}`;
    const entry = entries.find((candidate) => candidate.includes(`<loc>${loc}</loc>`));
    assert(entry, `sitemap has no entry for ${loc}`);
    assert(entry.includes(`hreflang="en"`) && entry.includes(`hreflang="zh"`), `sitemap entry for ${loc} has no en+zh alternate`);
    paired += 1;
    if (entry.includes('x-default')) withXDefault += 1;
  }
  return `${paired} sitemap entries carry en+zh (measured: x-default appears on the homepage pair only — ${withXDefault} non-homepage entries have it)`;
});

/* ---- 6. verification method 4 — nothing that is code got translated ---------------------- */

/*
 * A custom property is `--` followed by a name, so the character after the dashes is a letter or an
 * underscore (`--bn-main`, `--_border-rest`). `---` — a Markdown table's rule row, and nothing else
 * in these pages — therefore stops matching, which it has to: the table rules are punctuation, not
 * an identifier someone translated.
 */
const TOKEN_PATTERNS = [/--[A-Za-z_][A-Za-z0-9_-]*/g, /\bbn-[a-z0-9-]+\b/g, /\bdata-[a-z-]+\b/g];

function tokensOf(text) {
  const found = new Set();
  for (const pattern of TOKEN_PATTERNS) {
    for (const match of text.matchAll(pattern)) found.add(match[0]);
  }
  return found;
}

/**
 * Every identifier a Chinese page may legitimately name.
 *
 * Two sources, and both are needed. `src/css/**` and `static/*.css` are what the library actually
 * defines. The English master is the page's own vocabulary — and it has to be included whole (prose
 * as well as fences), because the English prose deliberately names identifiers that exist nowhere
 * in the stylesheet: `.bn-card` is the class the Card page explains it did NOT invent, `.bn-error`
 * is the class the Form page says does not exist, `bn-col-md-6` is a family the Layout page refuses
 * to ship, and `bn-tab-1` / `bn-tabpanel-2` are ids the Tabs element mints at runtime. A Chinese
 * translation of that prose must be allowed to write the same names; anything it invents beyond
 * them is still caught.
 */
function knownTokens() {
  const known = new Set();
  const add = (text) => {
    for (const token of tokensOf(text)) known.add(token);
  };
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (/\.(md|css|js|html)$/.test(entry.name)) add(fs.readFileSync(absolute, 'utf8'));
    }
  };
  walk(path.join(ROOT, 'src', 'css'));
  for (const name of fs.readdirSync(path.join(ROOT, 'static'))) {
    if (name.endsWith('.css')) add(read('static', name));
  }
  for (const masterRel of listMasters()) add(read(path.posix.join(CONTENT_DIR, masterRel)));
  return known;
}

check('verification 4: no Chinese page names a class, attribute or token the library does not define', () => {
  const known = knownTokens();
  const invented = [];
  for (const masterRel of listMasters()) {
    const prose = splitBody(
      splitFrontmatter(read(targetOf(masterRel)), targetOf(masterRel)).body,
      targetOf(masterRel),
    ).prose;
    for (const token of tokensOf(prose)) {
      if (!known.has(token)) invented.push(`${targetOf(masterRel)}: ${token}`);
    }
  }
  assert(invented.length === 0, `unknown identifiers in Chinese prose: ${invented.join(', ')}`);
  return 'every .bn-*, --bn-*, --_* and data-* name in the Chinese prose exists in src/css, static/*.css or the English page it translates';
});

check('verification 4: no identifier in a Chinese page contains a translated (non-ASCII) character', () => {
  // `--bn-主色` or `bn-按钮`: a Chinese character glued straight onto an identifier prefix.
  const translated = /(?:--_?|\bbn-)[^\s"'`()<>，。、；：]*[\u3000-\u9fff\uff00-\uffef][^\s"'`()<>，。、；：]*/g;
  const found = [];
  for (const masterRel of listMasters()) {
    const text = read(targetOf(masterRel));
    for (const match of text.matchAll(translated)) found.push(`${targetOf(masterRel)}: ${match[0]}`);
  }
  assert(found.length === 0, `translated identifiers: ${found.slice(0, 5).join(', ')}`);
  return 'no --/bn- identifier contains a CJK character';
});

/* ---- 7. the string table ----------------------------------------------------------------- */

/** Minimal reader for data/i18n.yaml: `<lang>:` → `  key:` → `    subkey:` (this site's shape). */
export function parseI18nTable(text) {
  const table = {};
  let lang = null;
  let group = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const language = /^([A-Za-z0-9_-]+):$/.exec(line);
    const nested = /^ {2}([A-Za-z0-9_-]+):$/.exec(line);
    const leaf = /^ {4}([A-Za-z0-9_-]+):/.exec(line);
    const value = /^ {2}([A-Za-z0-9_-]+):/.exec(line);
    if (language) {
      lang = language[1];
      table[lang] = {};
      group = null;
    } else if (nested && lang) {
      group = nested[1];
      table[lang][group] = {};
    } else if (leaf && lang && group) {
      table[lang][group][leaf[1]] = true;
    } else if (value && lang) {
      group = null;
      table[lang][value[1]] = true;
    }
  }
  return table;
}

const flatKeys = (branch) =>
  Object.entries(branch)
    .flatMap(([key, value]) => (value === true ? [key] : Object.keys(value).map((child) => `${key}.${child}`)))
    .sort();

check('data/i18n.yaml has exactly the same keys in en and zh', () => {
  const table = parseI18nTable(read('data', 'i18n.yaml'));
  assert(table.en && table.zh, 'data/i18n.yaml needs an en: block and a zh: block');
  const english = flatKeys(table.en);
  const chinese = flatKeys(table.zh);
  const missing = english.filter((key) => !chinese.includes(key));
  const extra = chinese.filter((key) => !english.includes(key));
  assert(missing.length === 0 && extra.length === 0, `missing in zh: ${missing.join(', ')} — extra in zh: ${extra.join(', ')}`);
  return `${english.length} keys in both languages`;
});

check('every collection the homepage renders has a label in both languages', () => {
  const table = parseI18nTable(read('data', 'i18n.yaml'));
  const missing = [];
  for (const name of seiteToml().listed) {
    for (const lang of ['en', 'zh']) {
      if (!table[lang]?.collections?.[name]) missing.push(`${lang}.collections.${name}`);
    }
  }
  assert(missing.length === 0, `missing labels: ${missing.join(', ')}`);
  return `${seiteToml().listed.join(', ')} labelled in en and zh`;
});

/* ------------------------------------------------ browser half of verification methods 1 & 2 --- */

const BROWSER_CHECKS = [];

/**
 * The switcher is an <a href> to a URL that static checks already prove exists and is the right
 * page, so the browser adds the one thing static analysis cannot: a real click, a real
 * navigation, and the demo layer speaking the page's language afterwards.
 */
BROWSER_CHECKS.push(
  [
    'clicking the switcher on a component page lands on the same page in Chinese, and the demo layer follows',
    async (browser, server) => {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await context.route('https://ivan112058.github.io/barnacle/**', (route) => {
        const url = new URL(route.request().url());
        let target = url.pathname.replace(/^\/barnacle/, '') || '/';
        if (target.endsWith('/')) target += 'index.html';
        const file = [target, `${target}.html`].map((candidate) => path.join(DIST, candidate)).find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
        if (file) route.fulfill({ path: file });
        else route.fulfill({ status: 404, body: 'not found' });
      });
      const page = await context.newPage();
      try {
        await page.goto(`${server.base}/components/button`, { waitUntil: 'load' });
        const before = await page.evaluate(() => ({
          lang: document.documentElement.lang,
          tabs: [...document.querySelectorAll('[data-site-demo] .site-demo__tab')].map((tab) => tab.textContent),
        }));
        assert(before.lang === 'en', `English page has lang="${before.lang}"`);
        assert(before.tabs.join(',') === 'Preview,Code,Preview,Code', `English tabs: ${before.tabs.join(',')}`);
        await Promise.all([page.waitForURL(/\/barnacle\/zh\/components\/button$/), page.click('.site-lang a.site-lang__item')]);
        await page.waitForLoadState('load');
        const after = await page.evaluate(() => ({
          path: location.pathname,
          lang: document.documentElement.lang,
          h1: document.querySelector('h1')?.textContent,
          tabs: [...document.querySelectorAll('[data-site-demo] .site-demo__tab')].map((tab) => tab.textContent),
          demos: document.querySelectorAll('[data-site-demo]').length,
          switcher: [...document.querySelectorAll('.site-lang .site-lang__item')].map((item) => item.textContent),
        }));
        assert(after.path === '/barnacle/zh/components/button', `landed on ${after.path}`);
        assert(after.lang === 'zh', `lang="${after.lang}" after the switch`);
        assert(after.h1 === '按钮', `h1 is "${after.h1}"`);
        assert(after.tabs.join(',') === '预览,代码,预览,代码', `Chinese tabs: ${after.tabs.join(',')}`);
        assert(after.demos === 2, `${after.demos} demo pairs after the switch, expected 2`);
        assert(after.switcher.join('|') === 'English|中文', `switcher reads ${after.switcher.join('|')}`);
        return `en /components/button → ${after.path} · h1=${after.h1} · tabs=${after.tabs.join(',')}`;
      } finally {
        await context.close();
      }
    },
  ],
  [
    'the switcher on the collection index and the homepage stays on the same page too',
    async (browser, server) => {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await context.route('https://ivan112058.github.io/barnacle/**', (route) => {
        const url = new URL(route.request().url());
        let target = url.pathname.replace(/^\/barnacle/, '') || '/';
        if (target.endsWith('/')) target += 'index.html';
        const file = [target, `${target}.html`].map((candidate) => path.join(DIST, candidate)).find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
        if (file) route.fulfill({ path: file });
        else route.fulfill({ status: 404, body: 'not found' });
      });
      const page = await context.newPage();
      try {
        const seen = [];
        for (const [from, to] of [
          ['/components/', '/barnacle/zh/components/'],
          ['/usage', '/barnacle/zh/usage'],
          ['/', '/barnacle/zh/'],
        ]) {
          await page.goto(`${server.base}${from}`, { waitUntil: 'load' });
          await Promise.all([
            page.waitForURL((url) => url.pathname === to),
            page.click('.site-lang a.site-lang__item'),
          ]);
          await page.waitForLoadState('load');
          assert(new URL(page.url()).pathname === to, `${from} landed on ${new URL(page.url()).pathname}, expected ${to}`);
          seen.push(`${from} → ${to}`);
        }
        return seen.join(' · ');
      } finally {
        await context.close();
      }
    },
  ],
  [
    'the English link on a Chinese page returns to the same page in English',
    async (browser, server) => {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await context.route('https://ivan112058.github.io/barnacle/**', (route) => {
        const url = new URL(route.request().url());
        let target = url.pathname.replace(/^\/barnacle/, '') || '/';
        if (target.endsWith('/')) target += 'index.html';
        const file = [target, `${target}.html`].map((candidate) => path.join(DIST, candidate)).find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
        if (file) route.fulfill({ path: file });
        else route.fulfill({ status: 404, body: 'not found' });
      });
      const page = await context.newPage();
      try {
        const seen = [];
        for (const [from, to, h1] of [
          ['/zh/components/button', '/barnacle/components/button', 'Button'],
          ['/zh/components/', '/barnacle/components/', 'Components'],
        ]) {
          await page.goto(`${server.base}${from}`, { waitUntil: 'load' });
          assert(await page.evaluate(() => document.documentElement.lang) === 'zh', `${from} is not Chinese`);
          await Promise.all([
            page.waitForURL((url) => url.pathname === to),
            page.click('.site-lang a.site-lang__item'),
          ]);
          await page.waitForLoadState('load');
          const landed = await page.evaluate(() => ({
            path: location.pathname,
            lang: document.documentElement.lang,
            h1: document.querySelector('h1')?.textContent,
          }));
          assert(landed.path === to, `${from} landed on ${landed.path}, expected ${to}`);
          assert(landed.lang === 'en', `${to} has lang="${landed.lang}"`);
          assert(landed.h1 === h1, `${to} h1 is "${landed.h1}"`);
          seen.push(`${from} → ${landed.path} · h1=${landed.h1}`);
        }
        return seen.join(' · ');
      } finally {
        await context.close();
      }
    },
  ],
);

/* ------------------------------------------------------------------------------ runner --- */

async function startServer() {
  const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain; charset=utf-8',
    '.xml': 'application/xml; charset=utf-8',
  };
  const server = http.createServer((request, response) => {
    const urlPath = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    if (!urlPath.startsWith('/barnacle')) {
      response.writeHead(404).end('outside base path');
      return;
    }
    let target = urlPath.slice('/barnacle'.length) || '/';
    if (target.endsWith('/')) target += 'index.html';
    const file = [target, `${target}.html`, path.join(target, 'index.html')]
      .map((candidate) => path.join(DIST, candidate))
      .find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
    if (!file) {
      response.writeHead(404).end(`not found: ${target}`);
      return;
    }
    response.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream' });
    response.end(fs.readFileSync(file));
  });
  const { port } = await listenOnFreePort(server);
  return {
    base: `http://127.0.0.1:${port}/barnacle`,
    close: () => new Promise((done) => server.close(done)),
  };
}

async function main() {
  let failures = 0;
  let skipped = 0;

  for (const [name, fn] of CHECKS) {
    try {
      const detail = await fn();
      console.log(`PASS  ${name}`);
      if (detail) console.log(`      ${detail}`);
    } catch (error) {
      failures += 1;
      console.log(`FAIL  ${name}\n      ${error.message}`);
    }
  }

  let chromium = null;
  try {
    ({ chromium } = await import('playwright-core'));
  } catch {
    chromium = null;
  }
  if (chromium && BROWSER_CHECKS.length > 0) {
    let browser = null;
    let server = null;
    try {
      browser = await chromium.launch({ channel: 'chrome', headless: true });
      server = await startServer();
      console.log(`      ${server.base} on system Chrome ${browser.version()}`);
    } catch (error) {
      console.log(`SKIP  browser checks — no Chrome available (${String(error.message).split('\n')[0]})`);
      skipped += BROWSER_CHECKS.length;
      browser = null;
    }
    if (browser && server) {
      for (const [name, fn] of BROWSER_CHECKS) {
        try {
          const detail = await fn(browser, server);
          console.log(`PASS  ${name}\n      ${detail}`);
        } catch (error) {
          failures += 1;
          console.log(`FAIL  ${name}\n      ${error.message}`);
        }
      }
    }
    if (server) await server.close();
    if (browser) await browser.close();
  } else {
    console.log(`SKIP  ${BROWSER_CHECKS.length} browser checks — playwright-core not installed`);
    skipped += BROWSER_CHECKS.length;
  }

  const total = CHECKS.length + BROWSER_CHECKS.length - skipped;
  console.log(`\n${total - failures}/${total} checks passed${skipped > 0 ? ` (${skipped} skipped)` : ''}`);
  return failures === 0 ? 0 : 1;
}

process.exitCode = await main();
