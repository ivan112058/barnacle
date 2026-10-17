/**
 * `BnBase` — the shallow-DOM custom element base (ticket 18, spec §9, ADR-0002).
 *
 * It exists so `<bn-dropdown>`, `<bn-tabs>` and `<bn-taginput>` do not each grow their own
 * lifecycle. Three rules are enforced here rather than repeated three times:
 *
 *   1. **Shallow DOM.** Nothing in this file (or the library) touches `attachShadow`.
 *      Components enhance the markup their author wrote, in the main document.
 *   2. **Init once, after DOM ready.** `connectedCallback` is called on every reconnect,
 *      so the initialisation is gated behind one promise. Calling it again is free.
 *   3. **Events are `CustomEvent` with `bubbles: true, composed: true`.** `emit()` is the
 *      only way a component announces anything.
 *
 * Subclass contract (tickets 19–22):
 *
 *   events()   → string[]        event types to bind on this (the `on<event>` methods)
 *   init()     → void            decorate the existing subtree; must not throw on nothing
 *   teardown() → void            undo init(), including listeners added with this.a(...)
 *   keydown(key, event) → boolean  handle a navigation key; true = handled
 *   onClick(event) …             one method per `on<event>` in events()
 *   change / input / select …    announce with this.emit('<type>', detail)
 *
 * For the roving-tabindex arithmetic itself, a component imports `keydownIndex` from
 * `./keys.js` directly — it is a pure function and does not belong on the instance:
 *
 *   import { keydownIndex } from './keys.js';
 *   keydown(key) {
 *     const next = keydownIndex(key, this.active, this.items().length);
 *     if (next < 0) return false;
 *     this.activate(next);
 *     return true;
 *   }
 */

import { NAVIGATION_KEYS, resolveHandlerName } from './keys.js';
import { uid } from './uid.js';

export class BnBase extends HTMLElement {
  constructor() {
    super();
    this._listeners = new Map();
    this._initialised = false;
    this._ready = false;
    this._readyPromise = null;
  }

  /* ---------------------------------- lifecycle ---------------------------------- */

  connectedCallback() {
    // A no-op in the deployed topology (`defer` means the document is already parsed); it is
    // the guard for a script that runs during parsing.
    this._whenReady().then(() => this._init());
    // When the document is ready there is nothing to await, so the element is live by the end
    // of its own connectedCallback and `_init`'s guard turns the queued call into a no-op.
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

    if (typeof document === 'undefined' || document.readyState !== 'loading') {
      this._ready = true;
      this._readyPromise = Promise.resolve();
      return this._readyPromise;
    }

    this._readyPromise = new Promise((resolve) => {
      document.addEventListener(
        'DOMContentLoaded',
        () => {
          this._ready = true;
          resolve();
        },
        { once: true },
      );
    });
    return this._readyPromise;
  }

  /** Runs the subclass `init()` and binds the conventional listeners — at most once. */
  _init() {
    if (this._initialised || !this._ready) return;
    // Set before running anything: a re-entrant call (a component that reconnects itself, or
    // `connect()` called twice in the same turn) must find the flag already raised.
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
  init() {}

  /** Undoes `init()`: remove the listeners added with `this.a(...)`. */
  teardown() {}

  /* ---------------------------------- listener API --------------------------------- */

  /**
   * The event types to bind: declared, de-duplicated, and only those whose `on<event>` method
   * actually exists. A declared type with no method is not a mistake worth throwing over — it
   * is how a subclass states intent it has not implemented yet.
   */
  _boundTypes() {
    return [...new Set(this.events())].filter((type) => {
      const method = this[resolveHandlerName(type)];
      return typeof method === 'function';
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
    if (typeof method !== 'function') return undefined;
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
    if (!NAVIGATION_KEYS.has(key)) return undefined;
    if (typeof this.keydown !== 'function') return undefined;

    const handled = this.keydown(key, event);
    if (handled && typeof event.preventDefault === 'function') event.preventDefault();
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
}
