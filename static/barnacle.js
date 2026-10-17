(() => {
  // src/js/keys.js
  var NAVIGATION_KEYS = /* @__PURE__ */ new Set([
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "Home",
    "End",
    "PageUp",
    "PageDown"
  ]);
  var FORWARD = /* @__PURE__ */ new Set(["ArrowRight", "ArrowDown", "PageDown"]);
  var BACKWARD = /* @__PURE__ */ new Set(["ArrowLeft", "ArrowUp", "PageUp"]);
  var cap = (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  function resolveHandlerName(type, prefix = "on") {
    const words = String(type).split(/[-:]+/).filter(Boolean).map(cap);
    return `${prefix}${words.join("")}`;
  }
  function keydownIndex(key, activeIndex, count, options = {}) {
    const { wrap = false } = options;
    if (!Number.isInteger(count) || count <= 0) return -1;
    const last = count - 1;
    const clamp = (index) => Math.min(last, Math.max(0, index));
    const active = clamp(Number.isInteger(activeIndex) ? activeIndex : 0);
    if (key === "Home") return 0;
    if (key === "End") return last;
    const step = FORWARD.has(key) ? 1 : BACKWARD.has(key) ? -1 : 0;
    if (step === 0) return -1;
    const next = active + step;
    if (next < 0 || next > last) return wrap ? (next + count) % count : active;
    return next;
  }

  // src/js/uid.js
  var PREFIX = "bn-";
  var counter = 0;
  function uid(prefix = PREFIX) {
    counter += 1;
    return `${prefix}${counter}`;
  }

  // src/js/base.js
  var BnBase = class _BnBase extends HTMLElement {
    constructor() {
      super();
      this._listeners = /* @__PURE__ */ new Map();
      this._initialised = false;
      this._ready = false;
      this._readyPromise = null;
    }
    /* ---------------------------------- lifecycle ---------------------------------- */
    connectedCallback() {
      this._whenReady().then(() => this._init());
      if (this._ready) this._init();
    }
    disconnectedCallback() {
      this._teardown();
    }
    /**
     * The readiness gate. Resolves once the document is parsed; a component's listeners are
     * bound from its `then`, so a script that runs before parsing never binds to a subtree that
     * is not there yet. The promise is created once per element, so a reconnect cannot queue a
     * second `DOMContentLoaded` listener.
     */
    _whenReady() {
      if (this._readyPromise) return this._readyPromise;
      if (typeof document === "undefined" || document.readyState !== "loading") {
        this._ready = true;
        this._readyPromise = Promise.resolve();
        return this._readyPromise;
      }
      this._readyPromise = new Promise((resolve) => {
        document.addEventListener(
          "DOMContentLoaded",
          () => {
            this._ready = true;
            resolve();
          },
          { once: true }
        );
      });
      return this._readyPromise;
    }
    /** Runs the subclass `init()` and binds the conventional listeners — at most once. */
    _init() {
      if (this._initialised || !this._ready) return;
      this._initialised = true;
      for (const type of this._boundTypes()) {
        this.addEventListener(type, this);
        if (!this._listeners.has(type)) this._listeners.set(type, []);
        this._listeners.get(type).push({ method: null, handler: this });
      }
      this.init();
    }
    /** Unbinds everything and hands control back to the subclass `teardown()`. Never fails on an
     *  element that was never initialised. */
    _teardown() {
      if (!this._initialised) return;
      for (const [type, entries] of this._listeners) {
        for (const entry of entries) this.removeEventListener(type, entry.handler);
      }
      this._listeners.clear();
      this._initialised = false;
      this.teardown();
    }
    /* ------------------------------- subclass overrides ------------------------------ */
    /** @returns {string[]} the event types this component binds; default: none. */
    events() {
      return [];
    }
    /** Decorates the existing shallow subtree. Must return quietly when nothing matches. */
    init() {
    }
    /** Undoes `init()`: remove the listeners added with `this.a(...)`. */
    teardown() {
    }
    /* ---------------------------------- listener API --------------------------------- */
    /**
     * The event types to bind: declared, de-duplicated, and only those whose `on<event>` method
     * actually exists. A declared type with no method is not a mistake worth throwing over — it
     * is how a subclass states intent it has not implemented yet.
     */
    _boundTypes() {
      return [...new Set(this.events())].filter((type) => {
        const method = this[resolveHandlerName(type)];
        return typeof method === "function";
      });
    }
    /**
     * Binds one extra listener, tracked so `teardown()` can remove it. `this.a('x', fn)` is how a
     * component subscribes at runtime (a timer callback, a document-level signal, a child node).
     */
    a(type, handler) {
      const entries = this._listeners.get(type);
      if (entries?.some((entry) => entry.handler === handler)) return handler;
      this.addEventListener(type, handler);
      if (entries) entries.push({ method: null, handler });
      else this._listeners.set(type, [{ method: null, handler }]);
      return handler;
    }
    /** Dispatches `type` to its `on<event>` method, if the subclass defines one. */
    handleEvent(event) {
      const method = this[resolveHandlerName(event.type)];
      if (typeof method !== "function") return void 0;
      return method.call(this, event);
    }
    /* ---------------------------------- event dispatch -------------------------------- */
    /**
     * Announces a component event. Always a `CustomEvent`, always `bubbles: true,
     * composed: true` (spec §9) so a listener on any ancestor — and outside a shadow root —
     * hears it.
     *
     * @param {string} type the event type, e.g. `'bn:select'`.
     * @param {object} [detail] payload; defaults to `{}`.
     * @returns {CustomEvent}
     */
    emit(type, detail = {}) {
      const event = new CustomEvent(type, { detail, bubbles: true, composed: true });
      this.dispatchEvent(event);
      return event;
    }
    /* --------------------------------- keyboard navigation ---------------------------- */
    /** `true` when `key` moves the active item; `false` means the component's business. */
    static isNavigationKey(key) {
      return NAVIGATION_KEYS.has(key);
    }
    /**
     * The one keyboard entry point bound by convention: `events()` includes `'keydown'` and
     * `BnBase` fields the arrow/Home/End family. A component only implements `keydown(key,
     * event)` → `boolean`, and for a roving tabindex that is normally
     * `const next = keydownIndex(key, active, items.length)`.
     *
     * Keys outside the navigation family are left alone (so `Escape`, `Enter` and `Tab` keep
     * their native meaning). Auto-repeat is delivered, not swallowed: `event.repeat` is on the
     * event, and a component that must ignore a held key can check it.
     */
    onKeydown(event) {
      const { key } = event;
      if (!_BnBase.isNavigationKey(key)) return void 0;
      if (typeof this.keydown !== "function") return void 0;
      const handled = this.keydown(key, event);
      if (handled && typeof event.preventDefault === "function") event.preventDefault();
      return handled;
    }
    /*
     * The subclass hook `onKeydown` calls for a navigation key — `keydown(key, event)` returning
     * `true` to say "handled". There is deliberately no default implementation of it on `BnBase`:
     * if the base class owned the name, a component that assigns `element.keydown = …` at runtime
     * would be permanently shadowed by the inherited method. Components that want keyboard support
     * declare it, and `onKeydown` checks for it before doing anything.
     */
    /**
     * Roving tabindex: exactly one item stays in the tab order. Out-of-range indices fall
     * back to the first item so a stale `activeIndex` can never make a list unreachable.
     *
     * @param {Array<HTMLElement>} items
     * @param {number} activeIndex
     * @returns {number} the index actually applied, or `-1` for an empty list.
     */
    focusOnly(items, activeIndex) {
      if (!items || items.length === 0) return -1;
      const index = Math.min(items.length - 1, Math.max(0, activeIndex));
      items.forEach((item, i) => {
        if (item) item.tabIndex = i === index ? 0 : -1;
      });
      return index;
    }
    /** The index of `node` inside `items`, or `-1`. */
    activeIndex(items, node) {
      return items ? items.indexOf(node) : -1;
    }
    /* --------------------------------------- ids -------------------------------------- */
    /** A page-unique id, for `aria-controls` / `aria-labelledby` / popover targets. */
    uid(prefix) {
      return uid(prefix);
    }
  };

  // src/js/dropdown.js
  var TRIGGER_SELECTOR = "[popovertarget]";
  var ITEM_SELECTOR = ".bn-dropdown-item";
  function supportsAnchorPositioning() {
    return typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("anchor-name: --bn-x");
  }
  var BnDropdown = class extends BnBase {
    /* ------------------------------------ state ------------------------------------ */
    /** The adopted nodes, `null` until `init()` finds a complete markup contract. */
    _trigger = null;
    _panel = null;
    _onToggleListener = null;
    _anchorName = null;
    /** The item the roving tabindex is on, `-1` when none is. */
    _activeIndex = -1;
    /** The last state the panel's `toggle` event reported. */
    _open = false;
    /** `true` when the pending close was ours, and the trigger should take the focus back. */
    _wantsFocusReturn = false;
    /* ---------------------------------- lifecycle ---------------------------------- */
    /**
     * Binds the behaviour to the author's subtree, or returns quietly when there is nothing to
     * enhance. Every failure mode below is a `return`, never a throw and never a console message.
     */
    init() {
      const trigger = this.querySelector(TRIGGER_SELECTOR);
      if (!trigger) return;
      const target = trigger.getAttribute("popovertarget");
      const panel = target ? document.getElementById(target) : null;
      if (!panel || !panel.hasAttribute("popover")) return;
      if (typeof panel.showPopover !== "function" || typeof panel.hidePopover !== "function") return;
      this._trigger = trigger;
      this._panel = panel;
      this._activeIndex = -1;
      this._open = false;
      this._wantsFocusReturn = false;
      this._authorExpanded = trigger.getAttribute("aria-expanded");
      this._onToggleListener = (event) => this._onPanelToggle(event);
      panel.addEventListener("toggle", this._onToggleListener);
      this._setAnchor();
    }
    /** Undoes `init()`, including what was written into the author's markup. */
    teardown() {
      if (this._panel && this._onToggleListener) {
        this._panel.removeEventListener("toggle", this._onToggleListener);
      }
      if (this._trigger) {
        if (this._authorExpanded === null) this._trigger.removeAttribute("aria-expanded");
        else this._trigger.setAttribute("aria-expanded", this._authorExpanded);
      }
      this._clearAnchor();
      this._trigger = null;
      this._panel = null;
      this._onToggleListener = null;
      this._activeIndex = -1;
      this._open = false;
      this._wantsFocusReturn = false;
    }
    /** The declared bindings; `onClick`, `onFocusout` and `onKeydown` are the handlers. */
    events() {
      return ["click", "focusout", "keydown"];
    }
    /* --------------------------------- read the tree -------------------------------- */
    /** @returns {HTMLElement[]} the author's items, in document order (empty when there are none). */
    items() {
      if (!this._panel) return [];
      return [...this._panel.querySelectorAll(ITEM_SELECTOR)];
    }
    /** `true` while the panel is showing. The pseudo-class is the truth; the toggle event is the
     *  fallback for an engine that does not know it (the attribute would then be decoration). */
    _isOpen() {
      const panel = this._panel;
      if (!panel) return false;
      try {
        if (typeof panel.matches === "function") return panel.matches(":popover-open");
      } catch {
      }
      return this._open === true;
    }
    /* ---------------------------------- open / close -------------------------------- */
    /**
     * Closes the menu because something inside it asked to. Unlike a light dismiss, this one owns the
     * focus: the trigger takes it back when the popover hides — unless the close happened because
     * focus had already left the menu (`returnFocus: false`), where taking it back would drag the
     * visitor backwards.
     */
    _close(returnFocus = true) {
      if (!this._panel || !this._isOpen()) return false;
      this._wantsFocusReturn = returnFocus;
      this._panel.hidePopover();
      return true;
    }
    /**
     * One reaction to every state change, whoever caused it: the native invoker, Escape, a click
     * outside, or `_close()`. Announcing from here is what makes `bn:open` / `bn:close` symmetrical.
     */
    _onPanelToggle(event) {
      const open = event.newState === "open";
      this._open = open;
      this._setExpanded(open);
      if (open) {
        this._activate(0);
        this.emit("bn:open", { trigger: this._trigger, panel: this._panel });
        return;
      }
      if (this._wantsFocusReturn || this._panel?.contains?.(document.activeElement)) {
        this._trigger?.focus?.();
      }
      this._wantsFocusReturn = false;
      this.emit("bn:close", { trigger: this._trigger, panel: this._panel });
    }
    _setExpanded(open) {
      this._trigger?.setAttribute("aria-expanded", open ? "true" : "false");
    }
    /* ------------------------------------ anchoring --------------------------------- */
    /**
     * Names this instance's anchor so the CSS can resolve `position-area` however the popover was
     * opened. `uid()` is what keeps two dropdowns on one page from stealing each other's anchor.
     */
    _setAnchor() {
      if (!supportsAnchorPositioning() || !this._trigger?.style || !this._panel?.style) return;
      this._anchorName = this.uid("--bn-dropdown-");
      this._trigger.style.setProperty("anchor-name", this._anchorName);
      this._panel.style.setProperty("position-anchor", this._anchorName);
    }
    _clearAnchor() {
      if (!this._anchorName) return;
      this._trigger?.style?.removeProperty("anchor-name");
      this._panel?.style?.removeProperty("position-anchor");
      this._anchorName = null;
    }
    /* ---------------------------------- the keyboard -------------------------------- */
    /**
     * Escape first — `BnBase.onKeydown` owns the arrow/Home/End family, and Escape is not one of
     * them. Cancelling the keydown also cancels the platform's own close request, so the menu closes
     * once, through `_close()`, with the focus return that goes with it.
     */
    onKeydown(event) {
      if (event.key === "Escape" && this._isOpen()) {
        this._close();
        if (typeof event.preventDefault === "function") event.preventDefault();
        return true;
      }
      return super.onKeydown(event);
    }
    /**
     * The navigation half of the contract: `BnBase.onKeydown` calls this only for arrow / Home / End
     * / page keys, and `preventDefault`s the press when it returns `true`.
     *
     * @returns {boolean} `true` when the key was spent on the menu.
     */
    keydown(key) {
      if (!this._isOpen()) return false;
      const items = this.items();
      if (items.length === 0) return false;
      const current = Number.isInteger(this._activeIndex) && items[this._activeIndex] ? this._activeIndex : this.activeIndex(items, document.activeElement);
      if (current < 0) return this._activate(0) >= 0;
      const next = keydownIndex(key, current, items.length, { wrap: true });
      if (next < 0) return false;
      this._activate(next);
      return true;
    }
    /** Focuses one item and leaves it the only tab stop (`BnBase.focusOnly` does the arithmetic). */
    _activate(index) {
      const items = this.items();
      if (items.length === 0) return -1;
      const applied = this.focusOnly(items, index);
      this._activeIndex = applied;
      items[applied]?.focus?.();
      return applied;
    }
    /* ----------------------------------- selection ---------------------------------- */
    /** A click on an item picks it: announce it, then close the way an in-menu close always does. */
    onClick(event) {
      const item = this._itemFrom(event.target);
      if (!item) return void 0;
      this.emit("bn:select", { value: this._valueOf(item), item });
      this._close();
      return item;
    }
    /** Tab out of the last item (or back past the first) closes the menu instead of leaving it
     *  floating. A move to nothing in particular — the panel's own padding, a click on a
     *  non-focusable area — is left to the platform's light dismiss. */
    onFocusout(event) {
      if (!this._isOpen()) return void 0;
      const next = event.relatedTarget;
      if (!next || next === document.body || this._panel.contains(next)) return void 0;
      this._close(false);
      return void 0;
    }
    /** The item a click landed in, reached through its own children (`delegation`). */
    _itemFrom(node) {
      if (!node || typeof node.closest !== "function") return null;
      const item = node.closest(ITEM_SELECTOR);
      if (!item) return null;
      return this.items().includes(item) ? item : null;
    }
    /** The author's `value` when there is one, otherwise the label as written. */
    _valueOf(item) {
      const value = item.getAttribute("value");
      if (value !== null) return value;
      return (item.textContent ?? "").trim();
    }
  };

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
  var hasDom = typeof document !== "undefined" && typeof window !== "undefined";
  var bn = hasDom ? createNamespace(window) : createNamespace({});
  if (typeof customElements !== "undefined") {
    bn.register("bn-dropdown", BnDropdown);
  }
  var index_default = bn;
})();
