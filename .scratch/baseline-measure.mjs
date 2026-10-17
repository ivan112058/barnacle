#!/usr/bin/env node
/* Temporary instrument (ticket 17): reads the docs site's layout numbers from real Chrome.
 * Usage: node .scratch/baseline-measure.mjs <label>   → writes .scratch/baseline-<label>.json */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const BASE = '/barnacle';
const WIDTHS = [320, 375, 768, 1024, 1440];
const PAGES = [
  { key: 'components-index', url: 'components/' },
  { key: 'components-button', url: 'components/button' },
];

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
  if (!urlPath.startsWith(BASE)) { res.writeHead(404).end('outside'); return; }
  let target = urlPath.slice(BASE.length) || '/';
  if (target.endsWith('/')) target += 'index.html';
  const candidates = [target, `${target}.html`, path.join(target, 'index.html')];
  const file = candidates.map((c) => path.join(DIST, c)).find((c) => fs.existsSync(c) && fs.statSync(c).isFile());
  if (!file) { res.writeHead(404).end('not found'); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}${BASE}`;

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const out = { label: process.argv[2] ?? 'before', chrome: browser.version(), pages: {} };

for (const spec of PAGES) {
  out.pages[spec.key] = {};
  for (const width of WIDTHS) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    // The built pages reference the absolute production origin, so mirror it like verify-demo does.
    await context.route('https://ivan112058.github.io/barnacle/**', (route) => {
      const target = new URL(route.request().url()).pathname.replace(/^\/barnacle/, '') || '/';
      route.fulfill({ path: path.join(DIST, target === '/' ? 'index.html' : target) });
    });
    const page = await context.newPage();
    const issues = [];
    page.on('requestfailed', (r) => issues.push(`failed ${r.url()}`));
    page.on('pageerror', (e) => issues.push(`pageerror ${e.message}`));
    await page.goto(`${origin}/${spec.url}`, { waitUntil: 'load' });
    const reading = await page.evaluate(() => {
      const box = (el) => (el ? { x: Math.round(el.getBoundingClientRect().x), w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) } : null);
      const cards = [...document.querySelectorAll('.site-grid > .site-card, .site-grid > li, [data-site-column="card"]')];
      const tops = [...new Set(cards.map((c) => Math.round(c.getBoundingClientRect().top)))];
      const perRow = tops.length ? cards.filter((c) => Math.round(c.getBoundingClientRect().top) === tops[0]).length : 0;
      const prose = document.querySelector('.site-prose');
      const main = document.querySelector('.site-main');
      return {
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        bodyScrollWidth: document.body.scrollWidth,
        proseWidth: prose ? Math.round(prose.getBoundingClientRect().width) : null,
        proseMaxWidth: prose ? getComputedStyle(prose).maxWidth : null,
        mainBox: box(main),
        mainPadding: main ? `${getComputedStyle(main).paddingLeft} / ${getComputedStyle(main).paddingRight}` : null,
        headerBox: box(document.querySelector('.site-header')),
        footerBox: box(document.querySelector('.site-footer')),
        cardCount: cards.length,
        cardRows: tops.length,
        cardsPerRow: perRow,
        cardWidths: [...new Set(cards.map((c) => Math.round(c.getBoundingClientRect().width)))],
        firstCard: box(cards[0]),
        secondCardX: cards[1] ? Math.round(cards[1].getBoundingClientRect().x) : null,
        h1Box: box(document.querySelector('h1')),
        ledeBox: box(document.querySelector('.site-lede')),
        pagerBox: box(document.querySelector('.site-pager')),
        demoCount: document.querySelectorAll('[data-site-demo]').length,
      };
    });
    out.pages[spec.key][width] = reading;
    await context.close();
  }
}
await browser.close();
await new Promise((r) => server.close(r));
const file = path.join(ROOT, '.scratch', `baseline-${out.label}.json`);
fs.writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
console.log(`wrote ${file}`);
for (const [key, widths] of Object.entries(out.pages)) {
  for (const [width, r] of Object.entries(widths)) {
    console.log(`${key} @${width}: scrollW=${r.scrollWidth}/${r.innerWidth} overflow=${r.scrollWidth > r.innerWidth} prose=${r.proseWidth} cards=${r.cardCount} rows=${r.cardRows} perRow=${r.cardsPerRow} widths=${r.cardWidths.join(',')}`);
  }
}
