/**
 * The `window.bn` surface — spec §9: "`window.bn` 面越窄越好——IIFE 下无法具名导出，全局
 * 命名空间是唯一出口."
 *
 * The IIFE bundle has no module exports, so this object is the only door between the library
 * and a page. It is kept deliberately thin: a version string, the registration hook the bundle
 * uses for its custom elements, and whatever capabilities `index.js` declares by name — spec §9
 * lists exactly one, `toast` (ticket 22). There is no `BnBase`, no `uid`, no `keydownIndex` on
 * it: internal implementation does not leak into the global namespace. A capability that is not
 * passed in is not on the surface, so the audit is a diff against the spec table rather than a
 * reading of every module.
 *
 * Two properties of the returned object matter:
 *
 *   1. It has no own property beyond the declared surface. "Already mounted" is tracked in a
 *      module-private `WeakSet`, not in an `installed` flag on the object — an undeclared own
 *      property is exactly the kind of extra exit this ticket exists to remove.
 *   2. It is a plain, enumerable, writable property of the global object: it is the public door,
 *      not a locked vault.
 *
 * The factory takes the global object as an argument so the whole surface is testable in
 * `node --test` without a browser.
 */

/** spec/ticket 18: the surface starts at the package version and grows only by declaration. */
export const VERSION = '0.1.0';

/** The global objects already carrying a surface, so mounting twice is a no-op. */
const mounted = new WeakSet();

/**
 * @param {object} [globalObject] the object to mount on; defaults to `globalThis`.
 * @param {Record<string, unknown>} [capabilities] the abilities this ticket declares, keyed by
 *   the name they take on `window.bn`; merged verbatim and in declaration order.
 * @returns {{version: string, register(name: string, ctor: Function): Function}} the mounted
 *   surface. Mounting twice on the same object is a no-op that returns the first instance,
 *   and the whole thing is one enumerable property — `window.bn`.
 */
export function createNamespace(globalObject = globalThis, capabilities = {}) {
  const existing = globalObject.bn;
  if (existing && mounted.has(existing)) return existing;

  /**
   * Defines a custom element once, and only once. Re-registering the same constructor is a
   * no-op (a bundle can be evaluated twice); re-registering a different one is an error, because
   * that silently strands every already-constructed instance on the old class.
   */
  function register(name, ctor) {
    const registry = globalObject.customElements;
    if (!registry) throw new Error(`barnacle: bn.register('${name}') needs a CustomElementRegistry`);

    const defined = registry.get(name);
    if (defined) {
      if (defined === ctor) return ctor;
      throw new Error(
        `barnacle: <${name}> is already defined by another constructor; ` +
          'a custom element name may be registered once.',
      );
    }

    registry.define(name, ctor);
    return ctor;
  }

  const bn = { version: VERSION, register, ...capabilities };
  mounted.add(bn);

  globalObject.bn = bn;
  return bn;
}
