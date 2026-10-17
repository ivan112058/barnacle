/**
 * cascade.test.mjs — ADR-0006, the cascade layer contract.
 *
 * The artifact's line 1 is `@layer theme, base, components, animations, utilities;` and every
 * file is emitted inside its layer. The half of that contract which is easy to lose and
 * impossible to notice in review is the one that protects the *user*: an unlayered rule of
 * theirs beats everything the library ships, whatever the specificity.
 *
 * `browser-harness-findings.md` §9 lists this as the thing most worth verifying against the real
 * artifact, because the harness lab had no `@layer` in it at all. So the two pages here are the
 * same declaration on either side of the layer boundary:
 *
 *   fixtures/cascade.html          unlayered          -> the user's colour wins
 *   fixtures/cascade-layered.html  @layer components  -> the library's colour wins (specificity)
 *
 * Same declaration, opposite outcome: the difference can only be the layer.
 *
 * Run: npm run test:browser   (build first: the assertions measure `static/`)
 */
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

import {
  assertComputed,
  assertNoPageIssues,
  assertValue,
  launchChrome,
  navigate,
  newHarnessPage,
  ROOT,
  siteMounts,
  startStaticServer,
} from './harness.mjs';
import { ARTIFACT_HREF, COLOR, LAYER_NAMES, SHADOW } from './expectations.mjs';

const PAGE = 'button.html';

/** @type {Awaited<ReturnType<typeof startStaticServer>>} */
let server;
/** @type {import('playwright-core').Browser} */
let browser;

before(async () => {
  server = await startStaticServer({ mounts: siteMounts() });
  browser = await launchChrome();
});

after(async () => {
  await browser?.close();
  await server?.close();
});

describe('the cascade layer contract (ADR-0006)', () => {
  test('ADR-0006 — an unlayered user rule beats every layer the library ships', async () => {
    const { page, issues, close } = await newHarnessPage(browser);
    try {
      await navigate(page, server.url('cascade.html'));

      await assertComputed(
        page,
        '#unlayered',
        'backgroundColor',
        COLOR.userSurface,
        'ADR-0006 — an unlayered user rule wins over the components layer',
      );
      // The override is surgical: the layer contract hands the user one property, not the
      // component. If this ever fails, the library has stopped being layered at all.
      await assertComputed(
        page,
        '#unlayered',
        'boxShadow',
        SHADOW.md,
        'ADR-0006 — the layer contract does not switch the rest of the library off',
      );
      await assertNoPageIssues(issues, 'ADR-0006 — the cascade page logs nothing');
    } finally {
      await close();
    }
  });

  test('ADR-0006 — inside one layer, specificity decides (the control for the case above)', async () => {
    const { page, issues, close } = await newHarnessPage(browser);
    try {
      await navigate(page, server.url('cascade-layered.html'));

      // Byte-for-byte the same declaration as cascade.html, written inside @layer components.
      // The library's `:is(button, .bn-button)` is (0,1,0) and this `button` is (0,0,1), so the
      // library wins. Without this control, the result above could be explained by source order.
      await assertComputed(
        page,
        '#layered',
        'backgroundColor',
        COLOR.surface,
        'ADR-0006 — the same rule inside a layer loses to the layer\'s own specificity',
      );
      await assertNoPageIssues(issues, 'ADR-0006 — the layered-page control logs nothing');
    } finally {
      await close();
    }
  });

  test('ADR-0006 — the page really loaded the shipped artifact, from the site subpath', async () => {
    const { page, issues, close } = await newHarnessPage(browser);
    try {
      await navigate(page, server.url(PAGE));

      // Read back out of the live document: which stylesheet, in which order its layers were
      // declared, and which bundle mounted. Every other assertion in this directory assumes
      // these three things, so they are asserted rather than assumed.
      const loaded = await page.evaluate(() => {
        const link = document.querySelector('link[rel="stylesheet"]');
        const rules = [...link.sheet.cssRules];
        const statement = rules.find((rule) => rule.constructor.name === 'CSSLayerStatementRule');
        return {
          href: new URL(link.href).pathname,
          layers: statement ? Array.from(statement.nameList) : [],
          firstRuleIsLayerStatement: rules[0]?.constructor.name === 'CSSLayerStatementRule',
          bnVersion: window.bn?.version ?? null,
        };
      });

      assertValue({
        invariant: 'the stylesheet under test is the shipped artifact, served from the site subpath',
        selector: 'link[rel="stylesheet"]',
        property: 'href path',
        expected: ARTIFACT_HREF,
        actual: loaded.href,
        hint: 'a wrong path would leave every assertion reading UA defaults instead of the library',
      });
      assertValue({
        invariant: 'ADR-0006 — the loaded artifact declares the layer order, and declares it first',
        selector: 'link[rel="stylesheet"]',
        property: 'CSSLayerStatementRule.nameList',
        expected: LAYER_NAMES.join(', '),
        actual: loaded.firstRuleIsLayerStatement ? loaded.layers.join(', ') : `${loaded.layers.join(', ')} (not the first rule)`,
      });
      assertValue({
        invariant: 'the script under test is the built bundle, mounted where the library promises',
        selector: 'window.bn',
        property: 'window.bn.version',
        // The package version is the independent source of truth here: a stale bundle in
        // static/ would disagree with package.json.
        expected: JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version,
        actual: loaded.bnVersion,
      });

      await assertNoPageIssues(issues, 'ADR-0006 — the artifact provenance page logs nothing');
    } finally {
      await close();
    }
  });
});
