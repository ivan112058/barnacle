(() => {
  // src/js/namespace.js
  var VERSION = "0.1.0";
  function createNamespace(globalObject = globalThis) {
    const existing = globalObject.bn;
    if (existing && existing.installed === true) return existing;
    function register(name, ctor) {
      const registry = globalObject.customElements;
      if (!registry) throw new Error(`barnacle: bn.register('${name}') needs a CustomElementRegistry`);
      const defined = registry.get(name);
      if (defined) {
        if (defined === ctor) return ctor;
        throw new Error(
          `barnacle: <${name}> is already defined by another constructor; a custom element name may be registered once.`
        );
      }
      registry.define(name, ctor);
      return ctor;
    }
    const bn2 = { version: VERSION, register };
    Object.defineProperty(bn2, "installed", { value: true, enumerable: false });
    globalObject.bn = bn2;
    return bn2;
  }

  // src/js/index.js
  var isBrowser = typeof document !== "undefined" && typeof window !== "undefined";
  var bn = isBrowser ? createNamespace(window) : createNamespace({});
  var index_default = bn;
})();
