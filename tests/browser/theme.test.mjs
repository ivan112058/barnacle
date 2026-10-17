/**
 * theme.test.mjs — the theme switch and the token hierarchy.
 *
 *   ADR-0004                 dark mode is an explicit switch; a system dark preference must not
 *                            switch anything
 *   spec §6 / ADR-0003       the three shadow tiers are derived from --bn-shadow-x/y, so one
 *                            token rescales the whole hierarchy
 *   orchestrator-decisions §8  a derived custom property is substituted on the element that
 *                            declares it, which fixes *where* the override has to go: `:root`
 *                            (`<html>`) for the shadow chain, and `<html>` for `data-theme`
 *
 * The wrapper case below is the negative control for the whole token story: the same override in
 * the same page, on the wrong element, must change nothing. Without it, "the token scales the
 * hierarchy" could quietly be true for reasons the documentation does not describe.
 *
 * Run: npm run test:browser   (build first: the assertions measure `static/`)
 */
import { after, before, describe, test } from 'node:test';

import {
  assertComputed,
  assertNoPageIssues,
  assertValue,
  launchChrome,
  navigate,
  newHarnessPage,
  readGeometry,
  readMedia,
  setRootToken,
  setTokenOn,
  siteMounts,
  startStaticServer,
} from './harness.mjs';
import { COLOR, SCALED, SHADOW } from './expectations.mjs';

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

describe('the theme and the token hierarchy', () => {
  test('ADR-0004 — a system dark preference must not switch the theme', async () => {
    // The context asks for dark; the page carries no `data-theme` anywhere. Nothing may change.
    const { page, issues, close } = await newHarnessPage(browser, { colorScheme: 'dark' });
    try {
      await navigate(page, server.url(PAGE));

      assertValue({
        invariant: 'ADR-0004 — the dark system preference really reached the page',
        selector: '<page>',
        property: "matchMedia('(prefers-color-scheme: dark)').matches",
        expected: true,
        actual: await readMedia(page, '(prefers-color-scheme: dark)'),
        hint: 'without this the assertion below could pass because the context option was ignored',
      });
      await assertComputed(page, 'body', 'backgroundColor', COLOR.paper, 'ADR-0004 — the page stays light with no data-theme');
      await assertComputed(page, 'body', 'color', COLOR.ink, 'ADR-0004 — the ink stays the light theme ink');
      await assertComputed(page, '#bare', 'boxShadow', SHADOW.md, 'ADR-0004 — the hard shadow stays the light theme shadow');

      assertNoPageIssues(issues, 'ADR-0004 — the dark-preference page logs nothing');
    } finally {
      await close();
    }
  });

  test('spec §6 — one token on <html> rescales every shadow tier, and only on <html>', async () => {
    const { page, issues, close } = await newHarnessPage(browser);
    try {
      await navigate(page, server.url(PAGE));

      // (a) The negative control. `#bare` sits inside `#wrapper`; a --bn-shadow-x written there
      // is inherited as an already-substituted string, so the shadow must not move. This is the
      // documented limit of the token system (orchestrator-decisions §8), asserted rather than
      // described, because "override the token" is otherwise reasonable advice that silently
      // does nothing.
      await setTokenOn(page, '#wrapper', '--bn-shadow-x', SCALED.token);
      await assertComputed(
        page,
        '#bare',
        'boxShadow',
        SHADOW.md,
        'orchestrator §8 — an override on a wrapper must not rescale the shadow chain',
      );

      // (b) One token, on documentElement. Every tier is derived from it, so the x offset of all
      // three moves: sm 4px, md 8px, lg 12px. (Only x is overridden here, which is why the
      // offsets are compared instead of the whole string — an override of one axis deliberately
      // makes the two axes differ. spec §3.2's equal-offset rule is asserted on the real tokens
      // in shadow.test.mjs, and on the symmetric override in (c).)
      await setRootToken(page, '--bn-shadow-x', SCALED.token);
      const sm = await readGeometry(page, '#outline');
      const md = await readGeometry(page, '#bare');
      assertValue({
        invariant: `spec §6 — one token rescales the sm tier (half of ${SCALED.token})`,
        selector: '#outline',
        property: 'box-shadow offset-x',
        expected: `${SCALED.offsets.sm}px`,
        actual: `${sm.shadowX}px`,
      });
      assertValue({
        invariant: `spec §6 — one token rescales the md tier (${SCALED.token})`,
        selector: '#bare',
        property: 'box-shadow offset-x',
        expected: `${SCALED.offsets.md}px`,
        actual: `${md.shadowX}px`,
      });
      assertValue({
        invariant: 'spec §6 — the lift token follows the same base',
        selector: '#bare',
        property: 'resolved --bn-shadow-lift',
        expected: `${SCALED.lift}px`,
        actual: `${md.lift}px`,
      });

      // (c) Both offsets, so the hierarchy is symmetric again: sm 4px, md 8px, lg 12px, read as
      // complete computed strings. `#code` is a <pre>, i.e. a base-layer consumer of the sm tier
      // rather than a button: the token is the single source for the whole library, not just for
      // the component that happens to be under test.
      await setRootToken(page, '--bn-shadow-y', SCALED.token);
      await assertComputed(page, '#outline', 'boxShadow', SCALED.sm, 'spec §6 — the sm tier after one token change');
      await assertComputed(page, '#code', 'boxShadow', SCALED.sm, 'spec §6 — a base-layer consumer reads the same scaled sm tier');
      await assertComputed(page, '#bare', 'boxShadow', SCALED.md, 'spec §6 — the md tier after one token change');

      await page.hover('#bare');
      const hovered = await readGeometry(page, '#bare');
      assertValue({
        invariant: 'spec §6 — the lg tier scales with the same token',
        selector: '#bare',
        property: 'box-shadow (hover)',
        expected: SCALED.lg,
        actual: hovered.shadow,
      });
      assertValue({
        invariant: 'spec §6 — the lift scales with the token too',
        selector: '#bare',
        property: 'resolved --bn-shadow-lift (hover)',
        expected: `${SCALED.lift}px`,
        actual: `${hovered.lift}px`,
      });

      assertNoPageIssues(issues, 'spec §6 — overriding a token logs nothing');
    } finally {
      await close();
    }
  });

  test('orchestrator §8 — data-theme on <html> flips the hard shadow, on <body> it cannot', async () => {
    // On <html>: the theme switch reaches the element that declares the derived chain, so the
    // hard shadow repaints in the dark ink and the page turns dark.
    const onHtml = await newHarnessPage(browser);
    try {
      await navigate(onHtml.page, server.url('theme-html-dark.html'));
      await assertComputed(onHtml.page, 'body', 'backgroundColor', COLOR.darkPaper, 'orchestrator §8 — html[data-theme="dark"] paints the dark page');
      await assertComputed(onHtml.page, '#bare', 'boxShadow', SHADOW.mdDark, 'orchestrator §8 — html[data-theme="dark"] repaints the hard shadow in the dark ink');
      await assertComputed(onHtml.page, '#bare', 'borderTopColor', COLOR.darkInk, 'orchestrator §8 — the structural border repaints with the shadow');
      assertNoPageIssues(onHtml.issues, 'orchestrator §8 — the dark-on-html page logs nothing');
    } finally {
      await onHtml.close();
    }

    // On <body>: `[data-theme="dark"]` matches the body, so the page *does* go dark — but
    // --bn-shadow-md and --bn-border-color were substituted with the light-theme strings on
    // :root and are inherited as finished strings. The button keeps the black shadow and the
    // black border, which is exactly why the documentation says the switch goes on <html>.
    const onBody = await newHarnessPage(browser);
    try {
      await navigate(onBody.page, server.url('theme-body-dark.html'));
      await assertComputed(onBody.page, 'body', 'backgroundColor', COLOR.darkPaper, 'orchestrator §8 — the switch on body does repaint the page');
      await assertComputed(onBody.page, '#bare', 'boxShadow', SHADOW.md, 'orchestrator §8 — but body[data-theme="dark"] cannot repaint the shadow chain');
      await assertComputed(onBody.page, '#bare', 'borderTopColor', COLOR.ink, 'orchestrator §8 — nor the structural border, which was also substituted on :root');
      assertNoPageIssues(onBody.issues, 'orchestrator §8 — the dark-on-body page logs nothing');
    } finally {
      await onBody.close();
    }
  });
});
