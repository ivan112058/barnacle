/**
 * focus.test.mjs — spec §7: the focus ring.
 *
 * "`outline` rather than `box-shadow`: an outline is painted outside `box-shadow`, so it cannot
 * cover the hard shadow, and `outline-offset` keeps a thick border from swallowing the
 * indicator."
 *
 * Two things are asserted at once, and both matter:
 *
 *   - a **real keyboard `Tab`** reaches the button — `element.focus()` would satisfy the style
 *     check while proving nothing about whether a keyboard user can get there at all;
 *   - the ring is a complete 3px/3px outline **and** the hard shadow is still painted, so
 *     neither indicator has eaten the other.
 *
 * There is deliberately no assertion on a `<div>`: a `<div>` is not focusable, so its computed
 * outline would be the UA default (`none`) and the test would pass or fail for reasons that have
 * nothing to do with the focus ring.
 *
 * Run: npm run test:browser   (build first: the assertions measure `static/`)
 */
import { after, before, describe, test } from 'node:test';

import {
  assertComputedAll,
  assertNoPageIssues,
  assertValue,
  launchChrome,
  navigate,
  newHarnessPage,
  readGeometry,
  siteMounts,
  startStaticServer,
  tabTo,
} from './harness.mjs';
import { FOCUS_RING, GEOMETRY, SHADOW } from './expectations.mjs';

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

describe('the focus ring (spec §7)', () => {
  test('spec §7 — a real Tab paints a 3px offset outline and the hard shadow survives it', async () => {
    const { page, issues, close } = await newHarnessPage(browser);
    try {
      await navigate(page, server.url(PAGE));

      // Throws with the invariant named unless a genuine Tab press lands on the element.
      await tabTo(page, '#bare');

      const geometry = await readGeometry(page, '#bare');
      assertValue({
        invariant: "spec §7 — the keyboard-focused button matches :focus-visible",
        selector: '#bare',
        property: "element.matches(':focus-visible')",
        expected: true,
        actual: geometry.focusVisible,
        hint: 'a mouse click does not match :focus-visible in Chrome; the ring is for keyboard users',
      });

      // One snapshot, every part of the contract: the outline is solid, 3px wide, offset 3px,
      // in --bn-ring — and the 4px hard shadow is still there underneath it.
      await assertComputedAll(
        page,
        '#bare',
        {
          outlineStyle: FOCUS_RING.outlineStyle,
          outlineWidth: FOCUS_RING.outlineWidth,
          outlineOffset: FOCUS_RING.outlineOffset,
          outlineColor: FOCUS_RING.outlineColor,
          boxShadow: SHADOW.md,
          borderTopWidth: GEOMETRY.borderWidth,
        },
        'spec §7 — the focus ring is an outline and the hard shadow survives it: ',
      );

      assertNoPageIssues(issues, 'spec §7 — focusing by keyboard logs nothing');
    } finally {
      await close();
    }
  });
});
