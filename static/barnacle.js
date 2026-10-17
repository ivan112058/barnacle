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
  var BnBase = class extends HTMLElement {
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
        this._listeners.get(type).push({ handler: this });
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
      if (entries) entries.push({ handler });
      else this._listeners.set(type, [{ handler }]);
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
      if (!NAVIGATION_KEYS.has(key)) return void 0;
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
    /**
     * The member of `items` that `node` belongs to — `node` itself, or the nearest ancestor of it
     * that is one of the members — or `null` when `node` is outside every one of them.
     *
     * The walk stops at `this`, so a listener bound on the element cannot mistake a click on the
     * component itself (or on a panel, in a tab set) for a click on a tab or a chip. Both
     * `<bn-tabs>` and `<bn-taginput>` need exactly this, over their own member list.
     *
     * @param {Array<HTMLElement>} items
     * @param {Node|null} node
     * @returns {HTMLElement|null}
     */
    memberFrom(items, node) {
      let current = node ?? null;
      while (current && current !== this) {
        if (items.includes(current)) return current;
        current = current.parentNode ?? null;
      }
      return null;
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
    /** What the author wrote in `aria-expanded`, so `teardown()` can put it back (`null`: nothing). */
    _authorExpanded = null;
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
      this._authorExpanded = null;
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

  // src/js/tabs.js
  var TAB = '[role="tab"]';
  var TABPANEL = '[role="tabpanel"]';
  var TAB_ID = "bn-tab-";
  var PANEL_ID = "bn-tabpanel-";
  var BnTabs = class extends BnBase {
    /* ---------------------------------- subclass contract --------------------------------- */
    events() {
      return ["click", "keydown"];
    }
    /**
     * Wires the authored subtree up. Idempotent by construction: every step writes the state that
     * follows from the markup, so running it twice changes nothing. An element with no tabs is not
     * an error — it just has nothing to enhance.
     */
    init() {
      const tabs = this.tabs();
      if (tabs.length === 0) return;
      this._authoredHidden = new Map(
        this.panels().map((panel) => [panel, panel.getAttribute("hidden")])
      );
      this.link();
      const selected = tabs.findIndex((tab) => tab.getAttribute("aria-selected") === "true");
      this.activate(selected < 0 ? 0 : selected, { silent: true });
    }
    /** Undoes `init()`: the panels return to the state they were authored in. */
    teardown() {
      for (const [panel, hidden] of this._authoredHidden ?? []) {
        if (hidden === null) panel.removeAttribute("hidden");
        else panel.setAttribute("hidden", hidden);
      }
      this._authoredHidden = null;
      this._activeIndex = void 0;
    }
    /* ------------------------------------- the seams -------------------------------------- */
    /** Every `role="tab"` inside this element, in document order. */
    tabs() {
      return [...this.querySelectorAll(TAB)];
    }
    /** Every `role="tabpanel"` inside this element. Panels may be anywhere; only `aria-controls` pairs them. */
    panels() {
      return [...this.querySelectorAll(TABPANEL)];
    }
    /**
     * The panel a tab owns: the one named by `aria-controls` when that id exists, otherwise the
     * panel in the corresponding document position. Order is the fallback, never the rule, so an
     * author who links explicitly gets the panel they named.
     *
     * @param {HTMLElement} tab
     * @param {number} index the tab's position
     * @param {Array<HTMLElement>} [panels] an already-read panel list, to avoid a second query
     * @returns {HTMLElement|null}
     */
    panelFor(tab, index, panels = this.panels()) {
      const id = tab.getAttribute("aria-controls");
      if (id) {
        const named = panels.find((panel) => panel.id === id);
        if (named) return named;
      }
      return panels[index] ?? null;
    }
    /**
     * The tab a DOM node belongs to, or `null`. Used by both listeners so a click or a key press
     * that happened inside a panel is never mistaken for one on a tab.
     */
    tabFrom(node) {
      return this.memberFrom(this.tabs(), node);
    }
    /* -------------------------------------- selection ------------------------------------- */
    /**
     * Makes tab `index` the selected one: roving tabindex, `aria-selected`, `hidden` on every other
     * panel, and optionally focus. Indices are clamped to the ends by `focusOnly`.
     *
     * @param {number} index
     * @param {{focus?: boolean, silent?: boolean}} [options] `focus: true` moves keyboard focus to
     *   the tab (automatic activation); `silent: true` sets the state without announcing it, which
     *   is what `init()` needs.
     * @returns {number} the index actually applied, or `-1` when there is no tab to select.
     */
    activate(index, options = {}) {
      const { focus = false, silent = false } = options;
      const tabs = this.tabs();
      if (tabs.length === 0) return -1;
      const active = this.focusOnly(tabs, index);
      if (active < 0) return -1;
      const previous = this._activeIndex;
      const panels = this.panels();
      let activePanel = null;
      tabs.forEach((tab, position) => {
        const isSelected = position === active;
        tab.setAttribute("aria-selected", isSelected ? "true" : "false");
        const panel = this.panelFor(tab, position, panels);
        if (!panel) return;
        panel.hidden = !isSelected;
        if (isSelected) activePanel = panel;
      });
      this._activeIndex = active;
      if (focus) tabs[active].focus?.();
      if (!silent && previous !== active) {
        this.emit("bn:change", { index: active, tab: tabs[active], panel: activePanel });
      }
      return active;
    }
    /**
     * Gives every tab/panel pair the ids and back-references that `aria-controls` and
     * `aria-labelledby` need, generating ids only where the author left one out. Authored ids are
     * never rewritten, so a deep link or a test that knows the id keeps working.
     */
    link() {
      const panels = this.panels();
      this.tabs().forEach((tab, index) => {
        const panel = this.panelFor(tab, index, panels);
        if (!panel) return;
        if (!tab.id) tab.id = this.uid(TAB_ID);
        if (!panel.id) panel.id = this.uid(PANEL_ID);
        if (tab.getAttribute("aria-controls") !== panel.id) tab.setAttribute("aria-controls", panel.id);
        if (!panel.getAttribute("aria-labelledby")) panel.setAttribute("aria-labelledby", tab.id);
      });
    }
    /* -------------------------------------- listeners ------------------------------------- */
    /** A click on a tab selects it. Focus is the browser's business here — the button takes it. */
    onClick(event) {
      const tab = this.tabFrom(event?.target);
      if (!tab) return;
      this.activate(this.activeIndex(this.tabs(), tab), { focus: false });
    }
    /**
     * The navigation keys, handled only when they were pressed on a tab. A key pressed anywhere
     * else (in a panel, on a control inside a panel) is left alone: the arrows belong to whatever
     * has focus, and `BnBase.onKeydown` has already filtered out every non-navigation key.
     *
     * @param {string} key
     * @param {KeyboardEvent} event
     * @returns {boolean} `true` when the key was ours, which makes the base class `preventDefault`
     *   it — including at the ends, where the selection stays put but the page must still not
     *   scroll.
     */
    keydown(key, event) {
      const tabs = this.tabs();
      const tab = this.tabFrom(event?.target);
      if (!tab) return false;
      const next = keydownIndex(key, this.activeIndex(tabs, tab), tabs.length);
      if (next < 0) return false;
      this.activate(next, { focus: true });
      return true;
    }
  };

  // src/js/taginput.js
  var TAG_DELIMITER = ",";
  var TAG_CLASS = "bn-tag";
  var REMOVE_CLASS = "bn-taginput-remove";
  var BADGE_CLASS = "bn-badge";
  function isComposing(event) {
    return event?.isComposing === true || event?.keyCode === 229;
  }
  function normaliseTags(value) {
    const list = value == null ? [] : Array.isArray(value) ? value : [value];
    const seen = /* @__PURE__ */ new Set();
    const tags = [];
    for (const item of list) {
      const text = item == null ? "" : String(item);
      for (const part of text.split(TAG_DELIMITER)) {
        const tag = part.trim();
        if (tag === "" || seen.has(tag)) continue;
        seen.add(tag);
        tags.push(tag);
      }
    }
    return tags;
  }
  var BnTagInput = class extends BnBase {
    /* ------------------------------------ state ------------------------------------ */
    /** The tags, in order. The single source of truth; `null` until `init()` reads the markup. */
    _tags = null;
    /** `true` once the authored list has been read, so a reconnect never re-reads stale markup. */
    _tagsRead = false;
    /** The authored entry field, or `null` while the element is not enhanced. */
    _input = null;
    /** The input's authored `value`, restored on teardown. */
    _authoredInputValue = "";
    /** Whether the author had disabled the input themselves, so teardown can tell it apart. */
    _authoredInputDisabled = false;
    /* ---------------------------------- subclass contract --------------------------------- */
    /** `disabled` is the one attribute the element observes: the field and the chips follow it. */
    static get observedAttributes() {
      return ["disabled"];
    }
    /** A `disabled` toggled from script reaches the field and every chip's button. */
    attributeChangedCallback() {
      this._applyDisabled();
    }
    /** `click` removes a chip, `keydown` owns the field keys, `input` parses a pasted list. */
    events() {
      return ["click", "keydown", "input"];
    }
    /**
     * Enhances the authored subtree, or returns quietly when there is nothing to enhance. Idempotent:
     * every step writes what follows from `_tags`, so a second run changes nothing.
     */
    init() {
      const input = this.querySelector("input");
      if (!input) return;
      this._input = input;
      this._authoredInputDisabled = input.hasAttribute("disabled");
      this._authoredInputValue = input.getAttribute("value") ?? "";
      if (!this._tagsRead) {
        const authored = this.getAttribute("value");
        this._tags = normaliseTags(authored ?? input.value);
        this._tagsRead = true;
      }
      this._render();
      this._applyDisabled();
      this._input.value = "";
      this._reflect();
    }
    /**
     * Undoes `init()`: the chips this element created are removed and the entry field is put back
     * the way the author wrote it. The tag list itself is kept, so moving the element in the DOM
     * does not lose what the visitor typed.
     */
    teardown() {
      for (const chip of this.chips()) chip.parentNode?.removeChild(chip);
      if (this._input) {
        this._input.value = this._authoredInputValue;
        if (this._authoredInputDisabled) this._input.setAttribute("disabled", "");
        else this._input.removeAttribute("disabled");
      }
      this._input = null;
    }
    /* --------------------------------------- the API -------------------------------------- */
    /**
     * The current tags, in order.
     *
     * @returns {string[]} a copy — mutating it cannot change the component.
     */
    tags() {
      return [...this._tags ?? []];
    }
    /**
     * Replaces the whole tag set. Idempotent: writing the set the component already holds changes
     * nothing, renders nothing and announces nothing.
     *
     * @param {string[]|string} value the new set; a comma-joined string is accepted too.
     * @returns {string[]} the set actually held afterwards.
     */
    setTags(value) {
      return this._commit(normaliseTags(value), "api");
    }
    /**
     * Appends one value (or a comma-joined list). A duplicate, an empty value or pure whitespace is
     * ignored, so calling it twice with the same text is the same as calling it once.
     *
     * @param {unknown} value
     * @returns {string[]} the set actually held afterwards.
     */
    addTag(value) {
      return this._commit(normaliseTags([...this._tags ?? [], value]), "api");
    }
    /**
     * Removes the tag at `index` (0-based). An out-of-range index is a quiet no-op.
     *
     * @param {number} index
     * @returns {string[]} the set actually held afterwards.
     */
    removeTagAt(index) {
      if (!Number.isInteger(index) || index < 0 || index >= (this._tags?.length ?? 0)) return this.tags();
      return this._commit(this._tags.filter((_, position) => position !== index), "api");
    }
    /** Empties the tag set. Writing an empty set is a no-op when it is already empty. */
    clearTags() {
      return this._commit([], "api");
    }
    /* ------------------------------------ the chips --------------------------------------- */
    /** Every chip this element manages, in document order. */
    chips() {
      return [...this.querySelectorAll(`.${TAG_CLASS}`)];
    }
    /** The remove buttons of those chips, in the same order. */
    removeButtons() {
      return this.chips().map((chip) => chip.querySelector(`.${REMOVE_CLASS}`)).filter(Boolean);
    }
    /** The chip a node belongs to, or `null` when it is not inside one. */
    chipFrom(node) {
      return this.memberFrom(this.chips(), node);
    }
    /* ------------------------------------ rendering --------------------------------------- */
    /**
     * Rebuilds the chips from `_tags`. Focus is preserved where it still makes sense: a remove
     * button that was just removed hands the caret back to the entry field, and a visitor typing in
     * the field keeps typing.
     */
    _render() {
      if (!this._input) return;
      const active = globalThis.document?.activeElement ?? null;
      const activeChip = this.chipFrom(active);
      for (const chip of this.chips()) chip.parentNode?.removeChild(chip);
      for (const tag of this._tags ?? []) this._insertChip(tag);
      if (activeChip && !this.chipFrom(active)) this._input.focus();
    }
    /** One chip: the badge's visual, a text node, and a named remove button. */
    _insertChip(tag) {
      const chip = globalThis.document.createElement("span");
      chip.className = `${BADGE_CLASS} ${TAG_CLASS}`;
      chip.setAttribute("data-variant", "secondary");
      const label = globalThis.document.createTextNode(tag);
      const remove = globalThis.document.createElement("button");
      remove.setAttribute("type", "button");
      remove.className = REMOVE_CLASS;
      remove.setAttribute("aria-label", `Remove ${tag}`);
      remove.textContent = "\xD7";
      if (this.hasAttribute("disabled")) remove.setAttribute("disabled", "");
      chip.append(label, remove);
      const parent = this._input.parentNode ?? this;
      parent.insertBefore(chip, this._input);
      return chip;
    }
    /** Publishes the current list into the `value` attribute, so it is inspectable from markup. */
    _reflect() {
      this.setAttribute("value", (this._tags ?? []).join(", "));
    }
    /* ------------------------------------ the keys ---------------------------------------- */
    /**
     * The keyboard entry point. The base class's navigation family (arrows / Home / End) is handled
     * by `keydown()` first, so the index arithmetic stays in keys.js; the component keys — `Enter`,
     * the delimiter and `Backspace` — are handled here because `BnBase.onKeydown` only fields the
     * navigation keys (spec §9: a component decides what its own keys mean).
     *
     * @param {KeyboardEvent} event
     * @returns {boolean} `true` when the component used the key (the base class then prevents the
     *   browser default, which is how `Enter` stops submitting the form and `Backspace` stops
     *   navigating back).
     */
    onKeydown(event) {
      if (isComposing(event)) return false;
      if (super.onKeydown(event)) return true;
      return this._handleKey(event);
    }
    /** The three component keys, and the remove button's own Delete/Backspace. */
    _handleKey(event) {
      const input = this._input;
      if (!input) return false;
      const { key } = event;
      const target = event.target ?? null;
      const button = this._removeButtonFrom(target);
      if (button) {
        if (key !== "Delete" && key !== "Backspace") return false;
        const index = this.removeButtons().indexOf(button);
        if (index < 0) return false;
        if (typeof event.preventDefault === "function") event.preventDefault();
        this._removeAt(index, "remove");
        return true;
      }
      if (target !== input) return false;
      if (key === "Enter") {
        if (input.value.trim() === "") return false;
        if (typeof event.preventDefault === "function") event.preventDefault();
        this._commitField();
        return true;
      }
      if (key === TAG_DELIMITER) {
        if (typeof event.preventDefault === "function") event.preventDefault();
        this._commitField();
        return true;
      }
      if (key === "Backspace" && input.value === "") {
        if ((this._tags?.length ?? 0) === 0) return false;
        if (typeof event.preventDefault === "function") event.preventDefault();
        this._removeAt(this._tags.length - 1, "backspace");
        return true;
      }
      return false;
    }
    /**
     * The arrow / Home / End ring: the remove buttons in order, plus the entry field as the last
     * stop. From an empty field, `ArrowLeft` steps back into the chips (so a keyboard user can walk
     * in without a mouse); from a field that holds text the arrow keeps its caret meaning.
     *
     * @param {string} key
     * @param {KeyboardEvent} event
     * @returns {boolean} `true` when focus moved.
     */
    keydown(key, event) {
      const input = this._input;
      if (!input) return false;
      const buttons = this.removeButtons();
      const target = event?.target ?? null;
      const button = this._removeButtonFrom(target);
      if (button) {
        const index = buttons.indexOf(button);
        if (index < 0) return false;
        if (key === "ArrowRight" && index === buttons.length - 1) {
          input.focus();
          return true;
        }
        const next = keydownIndex(key, index, buttons.length);
        if (next < 0 || next === index) return false;
        buttons[next].focus();
        return true;
      }
      if (target === input) {
        if (key !== "ArrowLeft" || input.value !== "") return false;
        const last = buttons.length - 1;
        if (last < 0) return false;
        buttons[last].focus();
        return true;
      }
      return false;
    }
    /* ------------------------------------ the clicks -------------------------------------- */
    /**
     * A click on a remove button takes that chip; a click on the field itself puts the caret back in
     * the entry field; a click on a chip's label is inert (the chip is a label, not a control).
     */
    onClick(event) {
      const button = this._removeButtonFrom(event?.target);
      if (button) {
        const index = this.removeButtons().indexOf(button);
        if (index >= 0) this._removeAt(index, "remove");
        return;
      }
      const input = this._input;
      if (!input || this.hasAttribute("disabled")) return;
      if (event?.target === input) return;
      if (this.chipFrom(event?.target)) return;
      input.focus();
    }
    /**
     * A pasted list arrives as one `input` event. Everything up to the last delimiter is committed
     * and only the unfinished tail stays in the field, so pasting `"One, Two"` adds `One` and leaves
     * `Two` ready to be confirmed or extended.
     */
    onInput(event) {
      const input = this._input;
      if (!input || event?.target !== input) return;
      if (isComposing(event)) return;
      if (!input.value.includes(TAG_DELIMITER)) return;
      const parts = input.value.split(TAG_DELIMITER);
      const pending = parts.pop() ?? "";
      input.value = pending.trim();
      this._commit(normaliseTags([...this._tags ?? [], ...parts]), "input");
    }
    /** Empties the field into the tag list: the draft is consumed, never kept. */
    _commitField() {
      const input = this._input;
      if (!input) return;
      const text = input.value;
      input.value = "";
      this._commit(normaliseTags([...this._tags ?? [], text]), "input");
    }
    /** The remove button a node belongs to, or `null`. The chip's label is not one. */
    _removeButtonFrom(node) {
      let current = node ?? null;
      while (current && current !== this) {
        if (current.nodeType === 1 && String(current.className ?? "").split(/\s+/).includes(REMOVE_CLASS)) {
          return current;
        }
        current = current.parentNode ?? null;
      }
      return null;
    }
    /** Removes one tag by position, keeping the announcement's source honest. */
    _removeAt(index, source) {
      if (!Number.isInteger(index) || index < 0 || index >= (this._tags?.length ?? 0)) return;
      this._commit(this._tags.filter((_, position) => position !== index), source);
      if (source !== "api" && !this.hasAttribute("disabled")) this._input?.focus();
    }
    /* ---------------------------------- state changes ------------------------------------ */
    /**
     * The one write path: compares the incoming list with the held one, and only renders, reflects
     * and announces when something actually changed. `added`/`removed` are computed against the
     * previous list, so a listener can tell an add from a remove without diffing.
     *
     * @param {string[]} next
     * @param {'input'|'remove'|'backspace'|'api'} source
     * @returns {string[]} the set held afterwards.
     */
    _commit(next, source) {
      const before = this._tags ?? [];
      const same = next.length === before.length && next.every((tag, index) => tag === before[index]);
      if (same) return this.tags();
      const added = next.filter((tag) => !before.includes(tag));
      const removed = before.filter((tag) => !next.includes(tag));
      this._tags = next;
      this._tagsRead = true;
      this._render();
      this._reflect();
      this.emit("bn:change", { tags: [...next], added, removed, source });
      return this.tags();
    }
    /** The chips are buttons too: a disabled field disables every control inside it. */
    _applyDisabled() {
      const disabled = this.hasAttribute("disabled");
      if (this._input) {
        if (disabled) this._input.setAttribute("disabled", "");
        else if (!this._authoredInputDisabled) this._input.removeAttribute("disabled");
      }
      for (const button of this.removeButtons()) {
        if (disabled) button.setAttribute("disabled", "");
        else button.removeAttribute("disabled");
      }
    }
  };

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
  var hasDom = typeof document !== "undefined" && typeof window !== "undefined";
  var bn = hasDom ? createNamespace(window, { toast }) : createNamespace({}, { toast });
  if (typeof customElements !== "undefined") {
    bn.register("bn-dropdown", BnDropdown);
    bn.register("bn-tabs", BnTabs);
    bn.register("bn-taginput", BnTagInput);
  }
  var index_default = bn;
})();
