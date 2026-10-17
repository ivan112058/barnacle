#!/usr/bin/env node
/* Temporary evidence collector (ticket 17): screenshots of the re-laid-out pages at the five
 * measured viewports, plus the grid readings that go with them. */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(ROOT, '.scratch', 'shots');
fs.mkdirSync(OUT, { recursive: true });

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
  if (!urlPath.startsWith('/barnacle')) { res.writeHead(404).end('x'); return; }
  const relPath = urlPath.slice('/barnacle'.length) || '/';
  const candidates = [path.join(DIST, relPath), path.join(DIST, `${relPath}.html`), path.join(DIST, relPath, 'index.html'), path.join(DIST, `${relPath}index.html`)];
  const file = candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile());
  if (!file) { res.writeHead(404).end('x'); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}/barnacle`;

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = {};
for (const [key, rel] of [['index', 'components/'], ['button', 'components/button'], ['layout', 'components/layout'], ['utilities', 'components/utilities']]) {
  report[key] = {};
  for (const width of [320, 375, 768, 1024, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    await context.route('https://ivan112058.github.io/barnacle/**', (route) => {
      const target = new URL(route.request().url()).pathname.replace(/^\/barnacle/, '') || '/';
      route.fulfill({ path: path.join(DIST, target === '/' ? 'index.html' : target) });
    });
    const page = await context.newPage();
    await page.goto(`${origin}/${rel}`, { waitUntil: 'load' });
    await page.screenshot({ path: path.join(OUT, `${key}-${width}.png`), fullPage: width === 1024 });
    const reading = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('[data-site-column="card"]')];
      const tops = [...new Set(cards.map((c) => Math.round(c.getBoundingClientRect().top)))];
      const row = document.querySelector('.site-main .bn-row');
      return {
        docScroll: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        container: Math.round(document.querySelector('.site-main').getBoundingClientRect().width),
        tracks: row ? getComputedStyle(row).gridTemplateColumns.split(' ').filter(Boolean).length : 0,
        cards: cards.length,
        perRow: cards.filter((c) => Math.round(c.getBoundingClientRect().top) === tops[0]).length,
        cardWidth: cards.length ? Math.round(cards[0].getBoundingClientRect().width) : null,
        prose: Math.round(document.querySelector('.site-prose').getBoundingClientRect().width),
      };
    });
    report[key][width] = reading;
    await context.close();
  }
}
await browser.close();
await new Promise((r) => server.close(r));
fs.writeFileSync(path.join(ROOT, '.scratch', 'baseline-after.json'), `${JSON.stringify({ label: 'after', pages: report }, null, 2)}\n`);
console.log(JSON.stringify(report, null, 1));
console.log(`screenshots in ${OUT}`);
