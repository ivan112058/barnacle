/**
 * Keyboard seams — spec §9 (`BnBase`: lifecycle, `handleEvent`, `on<event>` dispatch,
 * keyboard navigation, event dispatch, id generation).
 *
 * All of the arithmetic lives here as pure functions, so the two hard parts of a roving
 * tabindex implementation, "which index does this key move to" and "which method handles
 * this event", are testable without a browser. `base.js` does the DOM half only.
 */

/** Keys that mean "move the active item". Everything else belongs to the component. */
export const NAVIGATION_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

const FORWARD = new Set(['ArrowRight', 'ArrowDown', 'PageDown']);
const BACKWARD = new Set(['ArrowLeft', 'ArrowUp', 'PageUp']);

const cap = (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();

/**
 * `"click"` → `"onClick"`, `"bn:select"` → `"onBnSelect"`, `"bn:before-open"` →
 * `"onBnBeforeOpen"`. The convention is `on` + the event type in PascalCase, with `-` and
 * `:` as word separators.
 *
 * @param {string} type an event type, in any of the spellings components legitimately use.
 * @param {string} [prefix] the class convention prefix; always `"on"` here, but tests may
 *   ask for the post-prefix name directly.
 * @returns {string} the method name a `BnBase` subclass is expected to define.
 */
export function resolveHandlerName(type, prefix = 'on') {
  const words = String(type)
    .split(/[-:]+/)
    .filter(Boolean)
    .map(cap);
  return `${prefix}${words.join('')}`;
}

/**
 * The next active index for a navigation key.
 *
 * @param {string} key `event.key` (`'ArrowRight'`, `'Home'`, …).
 * @param {number} activeIndex the currently active index.
 * @param {number} count how many items exist.
 * @param {{wrap?: boolean}} [options] `wrap: true` turns the ends into a cycle; the
 *   default clamps, which is what `role=tablist` and `role=listbox` both want.
 * @returns {number} the index to activate, or `-1` when the key is not ours to handle
 *   (including any key pressed on an empty collection).
 */
export function keydownIndex(key, activeIndex, count, options = {}) {
  const { wrap = false } = options;
  if (!Number.isInteger(count) || count <= 0) return -1;

  const last = count - 1;
  const clamp = (index) => Math.min(last, Math.max(0, index));
  const active = clamp(Number.isInteger(activeIndex) ? activeIndex : 0);

  if (key === 'Home') return 0;
  if (key === 'End') return last;

  const step = FORWARD.has(key) ? 1 : BACKWARD.has(key) ? -1 : 0;
  if (step === 0) return -1;

  const next = active + step;
  if (next < 0 || next > last) return wrap ? (next + count) % count : active;
  return next;
}
