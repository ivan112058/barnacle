/**
 * shadow.test.mjs — the hard shadow itself.
 *
 *   spec §3.2  the blur radius and the spread radius are always 0, the offsets are equal and positive
 *   spec §3.3  the displacement and the shadow offset share one origin (4px → 6px, +2px, lift 2px)
 *   spec §3.7  hover changes border *colour*, never border *width*
 *
 * Expected values live in `expectations.mjs`, derived from spec/ADR and never from the CSS.
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
  readGeometry,
  readHovered,
  siteMounts,
  startStaticServer,
} from './harness.mjs';
import { GEOMETRY, SHADOW, TRANSFORM } from './expectations.mjs';

const PAGE = 'button.html';
const BORDER_SIDES = ['borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth'];

/** @type {Awaited<ReturnType<typeof startStaticServer>>} */
let server;
/** @type {import('playwright-core').Browser} */
let browser;

before(async () => {
  server = await startStaticServer({ mounts: siteMounts() });
  browser = await launchChrome();
});

after(async () => {
  // Not optional: a live Chrome process keeps `node --test` from ever exiting, and
  // `--test-timeout` does not save it (only `--test-force-exit` does, which is why the npm
  // script carries that flag as a second line of defence).
  await browser?.close();
  await server?.close();
});

describe('the hard shadow (spec §3.2, §3.3, §3.7)', () => {
  test('spec §3.2 — the hard shadow keeps a zero blur and a zero spread', async () => {
    const { page, issues, close } = await newHarnessPage(browser);
    try {
      await navigate(page, server.url(PAGE));

      // The invariant itself is the two zeroes: any blur turns a hard shadow into a soft one,
      // which is the aesthetic this library exists to not have. Parsed rather than string
      // matched, so changing the offset base is not misreported as a blur failure — and
      // asserted *first*, so a shadow that grows a blur is reported as the broken invariant
      // rather than as a string that did not match.
      const geometry = await readGeometry(page, '#bare');
      assertValue({
        invariant: 'spec §3.2 — the hard shadow blur radius is 0',
        selector: '#bare',
        property: 'box-shadow blur',
        expected: 0,
        actual: geometry.shadowBlur,
      });
      assertValue({
        invariant: 'spec §3.2 — the hard shadow spread radius is 0',
        selector: '#bare',
        property: 'box-shadow spread',
        expected: 0,
        actual: geometry.shadowSpread,
      });
      assertValue({
        invariant: 'spec §3.2 — the two shadow offsets are equal and positive',
        selector: '#bare',
        property: 'box-shadow offset-x | offset-y',
        expected: 'both positive and equal',
        actual:
          geometry.shadowX > 0 && geometry.shadowX === geometry.shadowY
            ? 'both positive and equal'
            : `${geometry.shadowX}px vs ${geometry.shadowY}px`,
      });

      // The same requirement as one computed string: 4px/4px offsets, 0 blur, 0 spread.
      await assertComputed(
        page,
        '#bare',
        'boxShadow',
        SHADOW.md,
        'spec §3.2 — the resting button paints the 4px hard shadow with no blur and no spread',
      );
      // The same tier through the other two anchors of the shape: the class and an <a>.
      await assertComputed(page, '#classed', 'boxShadow', SHADOW.md, 'spec §3.2 — .bn-button paints the same hard shadow');
      await assertComputed(page, '#anchor', 'boxShadow', SHADOW.md, 'spec §3.2 — an <a class="bn-button"> paints the same hard shadow');
      // The sm tier, read from two independent consumers: a base-layer <pre> and .bn-outline.
      await assertComputed(page, '#code', 'boxShadow', SHADOW.sm, 'spec §3.2 — the sm tier keeps a zero blur and spread');
      await assertComputed(page, '#outline', 'boxShadow', SHADOW.sm, 'spec §3.2 — .bn-outline starts on the sm tier');

      assertNoPageIssues(issues, 'spec §3.2 — the page loads the artifact without an error');
    } finally {
      await close();
    }
  });

  test('spec §3.3 — hover lifts the object by exactly the amount the shadow grows', async () => {
    const { page, issues, close } = await newHarnessPage(browser);
    try {
      await navigate(page, server.url(PAGE));

      const rest = await readGeometry(page, '#bare');
      assertValue({
        invariant: 'spec §3.3 — the button starts undisplaced',
        selector: '#bare',
        property: 'transform',
        expected: TRANSFORM.none,
        actual: rest.transform,
      });

      await page.hover('#bare');
      // Anti-flake rule 3: one evaluate after the mouse move reads the whole end state, and the
      // snapshot carries `matches(':hover')` so a resting value cannot pass as a hover value.
      const hovered = await readGeometry(page, '#bare');
      assertValue({
        invariant: 'spec §3.3 — the hover state really applied (self-evidence, not a silent resting read)',
        selector: '#bare',
        property: "element.matches(':hover')",
        expected: true,
        actual: hovered.hovered,
        hint: 'the read would otherwise pass with the resting values',
      });

      // The equation, from three independent readings: the matrix, the shadow string, and the
      // token itself. All three are compared against the spec value (2px), never against each
      // other only, so a broken token cannot satisfy the check by agreeing with itself. Checked
      // before the exact strings so a broken --bn-shadow-lift is reported as the broken equation
      // rather than as a matrix that does not match.
      const shadowGrowth = hovered.shadowX - rest.shadowX;
      assertValue({
        invariant: 'spec §3.3 — the displacement distance is --bn-shadow-lift',
        selector: '#bare',
        property: 'translate-x (absolute)',
        expected: `${GEOMETRY.lift}px`,
        actual: `${Math.abs(hovered.translateX)}px`,
        hint: 'both the displacement and the shadow growth derive from --bn-shadow-x (spec §3.3)',
      });
      assertValue({
        invariant: 'spec §3.3 — the shadow grows by --bn-shadow-lift',
        selector: '#bare',
        property: 'box-shadow offset-x delta (md -> lg)',
        expected: `${GEOMETRY.lift}px`,
        actual: `${shadowGrowth}px`,
      });
      assertValue({
        invariant: 'spec §3.3 — --bn-shadow-lift resolves to the same number both sides use',
        selector: '#bare',
        property: 'resolved --bn-shadow-lift',
        expected: `${GEOMETRY.lift}px`,
        actual: `${hovered.lift}px`,
      });
      // "Lifting off the shadow": the shadow's position on the page does not move while the
      // object does, which is the whole point of the shared origin.
      assertValue({
        invariant: 'spec §3.3 — the shadow stays planted while the object lifts',
        selector: '#bare',
        property: 'shadow offset + translate-x (rest vs hover)',
        expected: `${rest.shadowX}px`,
        actual: `${hovered.shadowX + hovered.translateX}px`,
      });

      assertValue({
        invariant: 'spec §3.3 — hover displaces the object up and to the left',
        selector: '#bare',
        property: 'transform',
        expected: TRANSFORM.hover,
        actual: hovered.transform,
        hint: 'the object lifts towards the light: both offsets negative',
      });
      assertValue({
        invariant: 'spec §3.3 — the hover shadow is the lg tier',
        selector: '#bare',
        property: 'box-shadow',
        expected: SHADOW.lg,
        actual: hovered.shadow,
      });
      // §3.2 has to survive the hover as well.
      assertValue({
        invariant: 'spec §3.2 — the hovered shadow keeps a zero blur and spread',
        selector: '#bare',
        property: 'box-shadow blur | spread',
        expected: '0 | 0',
        actual: `${hovered.shadowBlur} | ${hovered.shadowSpread}`,
      });

      assertNoPageIssues(issues, 'spec §3.3 — hovering the artifact logs nothing');
    } finally {
      await close();
    }
  });

  test('spec §3.7 — hover may change a colour but never a border width', async () => {
    const { page, issues, close } = await newHarnessPage(browser);
    try {
      await navigate(page, server.url(PAGE));

      // Three shapes, three different tiers: the bare element (md), .bn-outline (sm) and
      // .bn-ghost (no shadow, transparent border). A width that moves reflows the grid, and no
      // amount of colour polish makes up for that.
      for (const selector of ['#bare', '#outline', '#ghost']) {
        const rest = await readComputed(page, selector, BORDER_SIDES);
        for (const side of BORDER_SIDES) {
          assertValue({
            invariant: `spec §3.7 — ${selector} keeps --bn-border-width at rest`,
            selector,
            property: side,
            expected: GEOMETRY.borderWidth,
            actual: rest[side],
          });
        }

        const hovered = await readHovered(page, selector, BORDER_SIDES);
        assertValue({
          invariant: 'spec §3.7 — the hover state really applied before the comparison',
          selector,
          property: "element.matches(':hover')",
          expected: 'true',
          actual: hovered[':hover'],
        });
        for (const side of BORDER_SIDES) {
          assertValue({
            invariant: `spec §3.7 — hover must not change ${side}`,
            selector,
            property: side,
            expected: rest[side],
            actual: hovered[side],
            hint: 'a state rule may repaint border-color and may move the object, never the box',
          });
        }
      }

      assertNoPageIssues(issues, 'spec §3.7 — the hover sweep logs nothing');
    } finally {
      await close();
    }
  });
});
