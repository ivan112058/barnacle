/**
 * The `window.bn` surface — spec §9: "`window.bn` 面越窄越好——IIFE 下无法具名导出，全局
 * 命名空间是唯一出口."
 *
 * The IIFE bundle has no module exports, so this object is the only door between the library
 * and a page. It is kept deliberately thin: a version string and the registration hook that
 * `index.js` itself uses. There is no `BnBase`, no `uid`, no `keydownIndex` on it — internal
 * implementation does not leak into the global namespace (ticket 22 audits the final shape).
 *
 * The factory takes the global object as an argument so the whole surface is testable in
 * `node --test` without a browser.
 */

/** spec/ticket 18: the surface starts at the package version and grows only by declaration. */
export const VERSION = '0.1.0';

/**
 * @param {object} [globalObject] the object to mount on; defaults to `globalThis`.
 * @returns {{version: string, register(name: string, ctor: Function): Function}} the mounted
 *   surface. Mounting twice on the same object is a no-op that returns the first instance,
 *   and the whole thing is one enumerable property — `window.bn`.
 */
export function createNamespace(globalObject = globalThis) {
  const existing = globalObject.bn;
  if (existing && existing.installed === true) return existing;

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

  const bn = { version: VERSION, register };
  Object.defineProperty(bn, 'installed', { value: true, enumerable: false });

  globalObject.bn = bn;
  return bn;
}
