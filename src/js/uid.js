/**
 * Unique id generation — spec §9.
 *
 * Every barnacle element that needs an `id` (to wire `aria-controls`, `aria-labelledby`,
 * a popover target, …) asks here instead of inventing a name. One module-level counter
 * means two elements on the same page can never mint the same id, which is the whole
 * point: several instances of the same component used to collide on `"tabs-1"`.
 *
 * The module is DOM-free on purpose, so `node --test` can exercise it directly.
 */

const PREFIX = 'bn-';

let counter = 0;

/**
 * @param {string} [prefix] token-safe prefix; the `bn-` namespace (ADR-0005) is the default
 *   and the only prefix the library itself uses.
 * @returns {string} `<prefix><n>`, unique for the lifetime of the page.
 */
export function uid(prefix = PREFIX) {
  counter += 1;
  return `${prefix}${counter}`;
}
