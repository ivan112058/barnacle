(() => {
  // src/js/namespace.js
  var VERSION = "0.1.0";
  var mounted = /* @__PURE__ */ new WeakSet();
  function createNamespace(globalObject = globalThis, capabilities = {}) {
    const existing = globalObject.bn;
    if (existing && mounted.has(existing)) return existing;
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
    const bn2 = { version: VERSION, register, ...capabilities };
    mounted.add(bn2);
    globalObject.bn = bn2;
    return bn2;
  }

  // src/js/toast.js
  var DEFAULT_DURATION = 5e3;
  function parseTime(value) {
    if (typeof value !== "string") return 0;
    const first = value.split(",")[0].trim();
    const match = /^(-?[\d.]+)(ms|s)$/.exec(first);
    if (!match) return 0;
    const amount = Number(match[1]);
    return match[2] === "s" ? amount * 1e3 : amount;
  }
  function createToast(environment = {}) {
    const live = /* @__PURE__ */ new Map();
    let container = null;
    const documentOf = () => environment.document ?? globalThis.document;
    const viewOf = () => environment.window ?? globalThis.window;
    const schedule = (fn, ms) => (environment.setTimeout ?? globalThis.setTimeout)(fn, ms);
    const unschedule = (id) => (environment.clearTimeout ?? globalThis.clearTimeout)(id);
    function ensureContainer() {
      const document2 = documentOf();
      if (container && container.isConnected === false) container = null;
      if (container) return container;
      container = document2.createElement("div");
      container.className = "bn-toast-container";
      container.setAttribute("aria-live", "polite");
      (document2.body ?? document2.documentElement).appendChild(container);
      return container;
    }
    function build(message, settings) {
      const element = documentOf().createElement("div");
      element.className = "bn-toast";
      if (settings.variant) element.setAttribute("data-variant", String(settings.variant));
      if (message && typeof message === "object" && "nodeType" in message) element.appendChild(message);
      else if (message !== void 0 && message !== null) element.textContent = String(message);
      return element;
    }
    function place(element) {
      ensureContainer().appendChild(element);
      live.set(element, { timer: null, removal: null, closing: false });
      return element;
    }
    function detach(element) {
      const entry = live.get(element);
      if (!entry) return false;
      if (entry.timer !== null) unschedule(entry.timer);
      if (entry.removal !== null) unschedule(entry.removal);
      live.delete(element);
      if (typeof element.remove === "function") element.remove();
      else if (element.parentNode) element.parentNode.removeChild(element);
      if (live.size === 0 && container) {
        if (typeof container.remove === "function") container.remove();
        else if (container.parentNode) container.parentNode.removeChild(container);
        container = null;
      }
      return true;
    }
    function exitDelay(element) {
      const view = viewOf();
      if (!view || typeof view.getComputedStyle !== "function") return 0;
      const styles = view.getComputedStyle(element);
      return parseTime(styles ? styles.animationDuration : null);
    }
    function close(element) {
      const entry = live.get(element);
      if (!entry || entry.closing) return false;
      entry.closing = true;
      if (entry.timer !== null) {
        unschedule(entry.timer);
        entry.timer = null;
      }
      element.setAttribute("data-closing", "");
      const wait = exitDelay(element);
      if (wait > 0) entry.removal = schedule(() => detach(element), wait);
      else detach(element);
      return true;
    }
    function readDuration(settings) {
      const duration = settings.duration ?? DEFAULT_DURATION;
      if (typeof duration !== "number" || !Number.isFinite(duration) || duration < 0) {
        throw new TypeError(
          `barnacle: toast duration must be a finite number of milliseconds (got ${String(duration)})`
        );
      }
      return duration;
    }
    function toast2(message, settings = {}) {
      const duration = readDuration(settings);
      const element = place(build(message, settings));
      if (duration > 0) live.get(element).timer = schedule(() => close(element), duration);
      return element;
    }
    toast2.el = function el(message, settings = {}) {
      return place(build(message, settings));
    };
    toast2.clear = function clear() {
      let closed = 0;
      for (const element of [...live.keys()]) {
        if (close(element)) closed += 1;
      }
      return closed;
    };
    return toast2;
  }
  var toast = createToast();

  // src/js/index.js
  var isBrowser = typeof document !== "undefined" && typeof window !== "undefined";
  var bn = createNamespace(isBrowser ? window : {}, { toast });
  var index_default = bn;
})();
