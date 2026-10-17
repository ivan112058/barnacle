/**
 * motion.test.mjs — spec §7: "the `prefers-reduced-motion` guard must be there, and the entry
 * animation is written inside the `no-preference` block rather than switched off afterwards."
 *
 * This is the one test that runs with `freeze: false`, and that is the whole point: the freeze
 * injects `transition: none !important`, so `transition-duration` would read `0s` no matter what
 * the artifact declares and the assertion would be green by construction. A guard test has to
 * read the declaration itself.
 *
 * It is also the one test that needs no freeze to read a hover end state: under reduced motion
 * there is no transition left to sample halfway through, so the value is final immediately.
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
  readComputed,
  readMedia,
  siteMounts,
  startStaticServer,
} from './harness.mjs';
import { GEOMETRY, SHADOW, TRANSFORM, TRANSITION_PROPERTIES } from './expectations.mjs';

const PAGE = 'button.html';

/** `"0.15s, 0.15s"` -> `"0.15s"`, so a repeated list is compared as the value it carries. */
const distinct = (list) => [...new Set(list.split(',').map((part) => part.trim()))].join(' | ');

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

describe('the reduced-motion guard (spec §7)', () => {
  test('spec §7 — the reduced-motion guard removes the motion and changes nothing else', async () => {
    const reduced = await newHarnessPage(browser, { reducedMotion: 'reduce', freeze: false });
    try {
      await navigate(reduced.page, server.url(PAGE));

      // Without this, every line below could be green because the context option never reached
      // the page — the harness would be "testing" the default context twice.
      assertValue({
        invariant: 'spec §7 — the reduced-motion context really reached the page',
        selector: '<page>',
        property: "matchMedia('(prefers-reduced-motion: reduce)').matches",
        expected: true,
        actual: await readMedia(reduced.page, '(prefers-reduced-motion: reduce)'),
      });

      const style = await readComputed(reduced.page, '#bare', [
        'transitionDuration',
        'animationName',
        'boxShadow',
      ]);
      assertValue({
        invariant: 'spec §7 — with reduced motion no transition is declared at all',
        selector: '#bare',
        property: 'transition-duration',
        expected: '0s',
        actual: distinct(style.transitionDuration),
        hint: 'the transition lives inside @media (prefers-reduced-motion: no-preference), so the reduced case is the absence of a rule',
      });
      assertValue({
        invariant: 'spec §7 — with reduced motion nothing animates',
        selector: '#bare',
        property: 'animation-name',
        expected: 'none',
        actual: style.animationName,
      });

      // The appearance must be untouched — same rest tier, same hover end state, just instantly.
      assertValue({
        invariant: 'spec §7 — reduced motion does not change the resting shadow',
        selector: '#bare',
        property: 'box-shadow',
        expected: SHADOW.md,
        actual: style.boxShadow,
      });
      await reduced.page.hover('#bare');
      await assertComputed(
        reduced.page,
        '#bare',
        'transform',
        TRANSFORM.hover,
        'spec §7 — reduced motion does not change where hover moves the object',
      );
      await assertComputed(
        reduced.page,
        '#bare',
        'boxShadow',
        SHADOW.lg,
        'spec §7 — reduced motion does not change the hover shadow',
      );

      assertNoPageIssues(reduced.issues, 'spec §7 — the reduced-motion page logs nothing');
    } finally {
      await reduced.close();
    }

    const full = await newHarnessPage(browser, { freeze: false });
    try {
      await navigate(full.page, server.url(PAGE));

      // The control for the assertions above: in the default context the motion must be there.
      // Without this half, "no transition" would also describe an artifact that simply forgot
      // to declare one anywhere.
      assertValue({
        invariant: 'spec §7 — the default context accepts motion (the control for the guard)',
        selector: '<page>',
        property: "matchMedia('(prefers-reduced-motion: no-preference)').matches",
        expected: true,
        actual: await readMedia(full.page, '(prefers-reduced-motion: no-preference)'),
      });

      const style = await readComputed(full.page, '#bare', ['transitionProperty', 'transitionDuration']);
      const properties = style.transitionProperty.split(',').map((part) => part.trim());
      assertValue({
        invariant: 'spec §7 — the transition covers the geometry and the two colours, and nothing else',
        selector: '#bare',
        property: 'transition-property',
        expected: TRANSITION_PROPERTIES.join(', '),
        actual: properties.join(', '),
        hint: 'the list is asserted exactly: a new transitioned property is a new decision, not a detail',
      });
      assertValue({
        invariant: `spec §7 — every transition runs for --bn-transition (${GEOMETRY.transition})`,
        selector: '#bare',
        property: 'transition-duration',
        expected: GEOMETRY.transition,
        actual: distinct(style.transitionDuration),
        hint: 'the duration comes from --bn-transition through the --_motion slot',
      });

      assertNoPageIssues(full.issues, 'spec §7 — the default page logs nothing');
    } finally {
      await full.close();
    }
  });
});
