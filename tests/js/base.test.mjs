// Tests for ticket 18 — `BnBase` and the `window.bn` surface.
//
// Run with an explicit path, never bare `node --test`:
//
//   node --test tests/js/base.test.mjs
//
// Bare `node --test` walks the whole working directory and would also pick up the
// browser harness under tests/browser/ (ticket 08), which needs Chrome and is not a
// pure-Node test. `--test-force-exit` is deliberately absent: this file opens no
// handles that outlive the run, so the process exits on its own.
//
// `class BnBase extends HTMLElement` cannot be evaluated in bare Node — there is no
// HTMLElement, no CustomEvent, no document. The stub below implements only what the
// modules under test touch, and every module is loaded with a *dynamic* import after
// the globals are installed (a static `import` would be hoisted above them).

import assert from 'node:assert/strict';
import test from 'node:test';

/* ------------------------------------ DOM stub ------------------------------------ */

/** `new CustomEvent(...)` stands in for the browser's; extends `Event` so a real `EventTarget`
 *  (Node has one) accepts it in `dispatchEvent`. */
class StubCustomEvent extends Event {
  constructor(type, init = {}) {
    super(type, init);
    this.detail = init.detail;
  }
}

/**
 * Elements keyed by tag name, so `document.createElement('bn-probe')` and
 * `customElements.define('bn-probe', Ctor)` speak about the same constructor.
 * `document.createElement` reads the registry lazily, which is why `upgrade` has to
 * simulate what the real parser does when an already-parsed element meets a later
 * `define()`.
 */
class StubHTMLElement extends EventTarget {
  constructor() {
    super();
    this._initCalls = 0;
    this._teardownCalls = 0;
    this.isConnected = false;
  }

  /** Convenience for the "disconnect and reconnect" test. */
  connect() {
    if (this.isConnected) return;
    this.isConnected = true;
    this.connectedCallback?.();
  }

  disconnect() {
    if (!this.isConnected) return;
    this.isConnected = false;
    this.disconnectedCallback?.();
  }
}

const definitions = new Map();

globalThis.HTMLElement = StubHTMLElement;
globalThis.CustomEvent = StubCustomEvent;
globalThis.customElements = {
  define(name, ctor) {
    if (definitions.has(name)) throw new Error(`duplicate definition of <${name}>`);
    definitions.set(name, ctor);
  },
  get(name) {
    return definitions.get(name);
  },
  upgrade() {},
};
globalThis.document = {
  readyState: 'complete',
  createElement(tag) {
    const ctor = definitions.get(tag);
    if (!ctor) throw new Error(`<${tag}> is not defined yet`);
    return new ctor();
  },
};

const { BnBase } = await import('../../src/js/base.js');
const { uid } = await import('../../src/js/uid.js');
const { resolveHandlerName, keydownIndex } = await import('../../src/js/keys.js');
const { createNamespace } = await import('../../src/js/namespace.js');

/* ------------------------------------ fixtures ------------------------------------ */

/**
 * The BaseElement lifecycle every barnacle element inherits: init after DOM ready,
 * repeat calls are free, teardown on disconnect, and `on<event>` methods picked up by
 * convention. The counters are the observable behaviour behind "binds once".
 */
class ProbeElement extends BnBase {
  events() {
    return ['click', 'keydown'];
  }

  init() {
    this._initCalls += 1;
    this.addEventListener('click', this);
  }

  teardown() {
    this._teardownCalls += 1;
    this.removeEventListener('click', this);
  }

  onClick() {
    this.clicks = (this.clicks ?? 0) + 1;
  }

  /** Records the raw event, then leaves the navigation keys to `BnBase.onKeydown`. */
  onKeydown(event) {
    this.lastKey = event.key;
    return super.onKeydown(event);
  }

  /** Deliberately defined, not inherited: `BnBase` does not own this name (see base.js). */
  keydown() {
    return false;
  }
}

function createProbe(name = 'bn-probe') {
  const element = new ProbeElement();
  element.connect();
  return element;
}

/** Registers the probe under a fresh tag so `document.createElement` can find it. */
function defineProbe(name) {
  customElements.define(name, ProbeElement);
  return name;
}

/* A bubbling, cancelable keyboard event; `Event.preventDefault` is the real one, so
 * `defaultPrevented` is the browser's own answer rather than a stub's. */
function keyEvent(key, init = {}) {
  const event = new StubCustomEvent('keydown', { bubbles: true, cancelable: true, ...init });
  event.key = key;
  return event;
}

/**
 * A stable snapshot of every listener a BnBase instance owns, including the `a`
 * handlers attached with `this.a(...)` (which are not registered on the element and so
 * would never show up through the DOM). Used to prove that a second `init()` — and the
 * listener bookkeeping itself — adds nothing.
 */
function listenerSnapshot(element) {
  const parts = [];
  for (const [type, entries] of element._listeners) {
    for (const entry of entries) {
      parts.push(`${type}:${entry.method?.name ?? 'handler'}`);
    }
  }
  return parts.sort();
}

/* ------------------------------------- uid() -------------------------------------- */

test('uid() never repeats itself and carries the requested prefix', () => {
  const ids = new Set();
  for (let i = 0; i < 200; i += 1) ids.add(uid('bn-'));

  assert.equal(ids.size, 200, 'uid() must be unique across 200 calls');
  for (const id of ids) {
    assert.match(id, /^bn-\d+$/, `uid("bn-") produced ${JSON.stringify(id)}`);
  }
  assert.match(uid(), /^bn-\d+$/, 'uid() must use the bn- prefix by default');
});

/* ------------------------------- handler-name mapping ------------------------------ */

test('resolveHandlerName maps an event in any spelling onto its on<Event> method', () => {
  const cases = [
    ['click', 'onClick'],
    ['keydown', 'onKeydown'],
    ['bn:select', 'onBnSelect'],
    ['bn-select', 'onBnSelect'],
    ['bn:before-open', 'onBnBeforeOpen'],
  ];
  for (const [event, method] of cases) {
    assert.equal(resolveHandlerName(event), method, `${event} → ${method}`);
  }
});

test('handleEvent dispatches to the on<event> method for the event type', () => {
  const element = new ProbeElement();

  element.handleEvent(new StubCustomEvent('click'));
  element.handleEvent(new StubCustomEvent('keydown', { detail: { key: 'x' } }));
  const typed = new StubCustomEvent('keydown');
  typed.key = 'ArrowDown';
  element.handleEvent(typed);

  assert.equal(element.clicks, 1, 'click must reach onClick');
  assert.equal(element.lastKey, 'ArrowDown', 'keydown must reach onKeydown with the event');
  assert.equal(
    element.handleEvent(new StubCustomEvent('pointermove')),
    undefined,
    'an event without a handler is a no-op, not a throw',
  );
});

/* ------------------------------------- lifecycle ----------------------------------- */

test('connectedCallback with a complete document initialises the element exactly once', () => {
  const element = new ProbeElement();
  assert.equal(element._initCalls, 0, 'a detached element must not initialise');

  element.connect();
  assert.equal(element._initCalls, 1);
  assert.equal(element.isConnected, true);

  const snapshot = listenerSnapshot(element);
  element.connect(); // a reconnect (or a second connectedCallback) must not re-init
  assert.equal(element._initCalls, 1, 'connectedCallback must be idempotent');
  assert.deepEqual(listenerSnapshot(element), snapshot, 'a reconnect must not rebind');
});

test('a second connect() binds no duplicate listener and does not double-handle', () => {
  const element = createProbe();
  const before = listenerSnapshot(element);
  const calls = element._initCalls;

  // The second connect() is a no-op: that is the public promise, not "init() ignores its
  // second call" — the subclass hook is never entered twice at all.
  element.connect();

  assert.equal(element._initCalls, calls, 'a second connect() must not run init() again');
  assert.deepEqual(listenerSnapshot(element), before, 'a second connect() must not add listeners');

  element.dispatchEvent(new StubCustomEvent('click', { bubbles: true }));
  assert.equal(element.clicks, 1, 'one dispatched click must reach onClick exactly once');
});

test('disconnectedCallback tears down, and a reconnect re-initialises without residue', () => {
  const element = createProbe();
  assert.ok(listenerSnapshot(element).length > 0, 'the probe binds listeners on init');

  element.disconnect();
  assert.equal(element._teardownCalls, 1, 'disconnectedCallback must call teardown()');
  assert.deepEqual(listenerSnapshot(element), [], 'teardown must leave no listener behind');

  element.connect();
  assert.equal(element._initCalls, 2, 'a reconnect initialises again');
  assert.equal(element._teardownCalls, 1);
  element.dispatchEvent(new StubCustomEvent('click'));
  assert.equal(element.clicks, 1, 'exactly one live click listener after the reconnect');
});

test('events() declares the types whose on<event> method exists, and only those', () => {
  class NarrowProbe extends BnBase {
    events() {
      // Three declarations: one implemented, one duplicated, one with no method at all.
      return ['click', 'pointerenter', 'click'];
    }

    onClick() {}
  }

  const element = new NarrowProbe();
  element.connect();

  assert.deepEqual(
    [...element._listeners.keys()].sort(),
    ['click'],
    'only declared types with an on<event> method may be bound',
  );
  assert.equal(element._listeners.get('click').length, 1, 'a duplicated declaration binds once');
});

test('when DOM ready is deferred, connectedCallback initialises after the event fires', async () => {
  const listeners = [];
  const realDocument = globalThis.document;

  globalThis.document = {
    readyState: 'loading',
    addEventListener(type, handler) {
      listeners.push({ type, handler });
    },
    removeEventListener() {},
    createElement: realDocument.createElement,
  };

  try {
    const element = new ProbeElement();
    element.connect();

    assert.equal(element._initCalls, 0, 'nothing may initialise before DOM ready');
    assert.deepEqual(
      listeners.map((entry) => entry.type),
      ['DOMContentLoaded'],
      'exactly one DOMContentLoaded listener may be registered',
    );

    globalThis.document.readyState = 'complete';
    listeners[0].handler({ type: 'DOMContentLoaded' });
    await element._readyPromise;
    assert.equal(element._initCalls, 1, 'the readiness callback must initialise once');

    // A reconnect must not queue a second DOMContentLoaded listener.
    element.disconnect();
    element.connect();
    await element._readyPromise;
    assert.deepEqual(
      listeners.map((entry) => entry.type),
      ['DOMContentLoaded'],
      'a reconnect must reuse the pending readiness promise',
    );
    assert.equal(element._initCalls, 2, 'and initialise again, exactly once');
  } finally {
    globalThis.document = realDocument;
  }
});

test('a listener added with a() is tracked and removed by teardown()', () => {
  const element = createProbe();
  let calls = 0;
  const extra = () => {
    calls += 1;
  };

  element.a('bn:extra', extra);
  element.a('bn:extra', extra); // the same handler twice is still one listener
  assert.ok(
    listenerSnapshot(element).includes('bn:extra:handler'),
    'a() must be visible in the listener bookkeeping',
  );

  element.dispatchEvent(new StubCustomEvent('bn:extra'));
  assert.equal(calls, 1, 'a duplicated a() must not deliver twice');

  element.disconnect();
  assert.deepEqual(listenerSnapshot(element), [], 'teardown() must unbind a() listeners too');
  element.dispatchEvent(new StubCustomEvent('bn:extra'));
  assert.equal(calls, 1, 'and must not deliver after teardown');
});

/* ------------------------------------ emitting ------------------------------------- */

test('emit() dispatches a bubbling, composed CustomEvent on the element', () => {
  const element = createProbe();
  const seen = [];
  element.addEventListener('bn:change', (event) => seen.push(event));

  const returned = element.emit('bn:change', { value: 'x' });

  assert.equal(seen.length, 1, 'the listener must receive the event');
  const [event] = seen;
  assert.ok(event instanceof StubCustomEvent, 'events are always CustomEvent (spec §9)');
  assert.equal(returned, event, 'emit() returns the event it dispatched');
  assert.equal(event.type, 'bn:change');
  assert.equal(event.bubbles, true, 'spec §9: bubbles must be true');
  assert.equal(event.composed, true, 'spec §9: composed must be true');
  assert.deepEqual(event.detail, { value: 'x' });
});

test('emit() defaults to an empty detail object', () => {
  const element = createProbe();
  const seen = [];
  element.addEventListener('bn:open', (event) => seen.push(event));

  element.emit('bn:open');

  assert.deepEqual(seen[0].detail, {});
});

/* ---------------------------------- keyboard seams --------------------------------- */

test('keydownIndex maps navigation keys onto the next index', () => {
  const cases = [
    ['ArrowRight', 0, 3, 1],
    ['ArrowRight', 2, 3, 2],
    ['ArrowLeft', 2, 3, 1],
    ['ArrowUp', 1, 3, 0],
    ['ArrowDown', 1, 3, 2],
    ['Home', 2, 3, 0],
    ['End', 0, 3, 2],
    ['PageDown', 1, 3, 2],
    ['PageUp', 1, 3, 0],
    ['Escape', 1, 3, -1],
    ['Enter', 1, 3, -1],
    ['a', 1, 3, -1],
  ];
  for (const [key, active, count, expected] of cases) {
    assert.equal(keydownIndex(key, active, count), expected, `${key} from ${active} of ${count}`);
  }
});

test('keydownIndex clamps instead of wrapping, and survives degenerate input', () => {
  assert.equal(keydownIndex('ArrowRight', 2, 3), 2, 'the last index is the end of the road');
  assert.equal(keydownIndex('ArrowLeft', 0, 3), 0, 'the first index is the start of the road');
  assert.equal(keydownIndex('Home', 5, 0), -1, 'an empty collection has nothing to select');
  assert.equal(keydownIndex('ArrowRight', 9, 3), 2, 'an out-of-range active index clamps');
  assert.equal(keydownIndex('ArrowRight', -4, 3), 1, 'a negative active index clamps');
});

/* ------------------------------------ onKeydown ------------------------------------ */

test('onKeydown calls keydown() and prevents default only for a navigation key', () => {
  const handled = [];
  const element = new ProbeElement();
  element.keydown = (key, event) => {
    handled.push([key, event.type]);
    return true;
  };

  const arrow = keyEvent('ArrowRight');
  element.onKeydown(arrow);
  assert.deepEqual(handled, [['ArrowRight', 'keydown']]);
  assert.equal(arrow.defaultPrevented, true, 'a handled navigation key must preventDefault');

  const letter = keyEvent('a');
  element.onKeydown(letter);
  assert.equal(handled.length, 1, 'a non-navigation key must not reach keydown()');
  assert.equal(letter.defaultPrevented, false);

  const escape = keyEvent('Escape');
  element.onKeydown(escape);
  assert.equal(handled.length, 1, 'Escape must not reach keydown()');
});

test('onKeydown handles every press and leaves auto-repeat to the component', () => {
  const element = new ProbeElement();
  const seen = [];
  element.keydown = (key, event) => {
    seen.push([key, event.repeat === true]);
    return true;
  };

  element.onKeydown(keyEvent('ArrowDown'));
  element.onKeydown(keyEvent('ArrowDown'));
  assert.deepEqual(
    seen,
    [
      ['ArrowDown', false],
      ['ArrowDown', false],
    ],
    'two distinct presses are two moves — holding an arrow key must keep moving',
  );

  const held = keyEvent('ArrowDown');
  held.repeat = true;
  element.onKeydown(held);
  assert.deepEqual(seen[2], ['ArrowDown', true], 'auto-repeat reaches the component with event.repeat set');
  assert.equal(held.defaultPrevented, true, 'a handled repeat still stops the page from scrolling');
});

test('onKeydown does not preventDefault when keydown() declines the key', () => {
  const element = new ProbeElement();
  element.keydown = () => false;

  const event = keyEvent('ArrowRight');
  element.onKeydown(event);
  assert.equal(event.defaultPrevented, false);
});

/* ------------------------------------ focus helpers -------------------------------- */

test('focusOnly makes exactly one element focusable (roving tabindex)', () => {
  const element = createProbe();
  const first = new StubHTMLElement();
  const second = new StubHTMLElement();
  const third = new StubHTMLElement();
  const items = [first, second, third];
  for (const item of items) item.tabIndex = 0;

  element.focusOnly(items, 1);

  assert.deepEqual(
    items.map((item) => item.tabIndex),
    [-1, 0, -1],
    'only the active item may stay in the tab order',
  );
  assert.equal(element.activeIndex(items, second), 1, 'activeIndex finds the active item');
  assert.equal(element.activeIndex(items, new StubHTMLElement()), -1, 'and -1 for a stranger');
});

/* ----------------------------------- id generation --------------------------------- */

test('uid() on the element and the id helper stay unique on the same page', () => {
  const a = createProbe();
  const b = createProbe();
  const ids = new Set([a.uid('bn-tab-'), b.uid('bn-tab-'), a.uid('bn-tab-'), uid()]);

  assert.equal(ids.size, 4, 'two elements and the module must never collide');
  for (const id of ids) assert.match(id, /^bn-tab-\d+$|^bn-\d+$/);
});

/* ------------------------------ window.bn (the surface) ----------------------------- */

test('createNamespace adds exactly one enumerable global and returns it', () => {
  const fakeWindow = { existing: true };

  const bn = createNamespace(fakeWindow);
  const added = Object.keys(fakeWindow).filter((key) => key !== 'existing');
  const descriptor = Object.getOwnPropertyDescriptor(fakeWindow, 'bn');

  assert.deepEqual(added, ['bn'], 'exactly one enumerable property may be added');
  assert.equal(fakeWindow.bn, bn);
  assert.equal(bn.version, '0.1.0');
  assert.deepEqual(
    Object.keys(bn).sort(),
    ['register', 'version'],
    'the surface stays narrow: no internal module may leak onto it',
  );
  for (const key of ['version', 'register']) {
    assert.ok(key in bn, `window.bn.${key} must exist`);
  }
  assert.equal(descriptor.enumerable, true, 'window.bn must be enumerable — it is the public door');
  assert.equal(descriptor.writable, true, 'window.bn must stay writable');
  assert.equal(descriptor.configurable, true, 'window.bn must stay configurable');
});

test('register() defines a custom element once and is idempotent for the same constructor', () => {
  class RegProbe extends BnBase {}
  class OtherProbe extends BnBase {}

  // A fresh fake window, so this test owns its registry and cannot collide with another test.
  const registry = new Map();
  const fakeWindow = {
    customElements: {
      define: (name, ctor) => registry.set(name, ctor),
      get: (name) => registry.get(name),
    },
  };
  const bn = createNamespace(fakeWindow);

  assert.equal(bn.register('bn-reg-probe', RegProbe), RegProbe);
  assert.equal(fakeWindow.customElements.get('bn-reg-probe'), RegProbe);
  assert.equal(
    bn.register('bn-reg-probe', RegProbe),
    RegProbe,
    're-registering the same constructor is a no-op (a bundle may evaluate twice)',
  );
  assert.throws(
    () => bn.register('bn-reg-probe', OtherProbe),
    /bn-reg-probe/,
    'a second, different constructor for the same name is an error',
  );
});

test('register() reports a missing registry instead of throwing something opaque', () => {
  const bn = createNamespace({});
  assert.throws(() => bn.register('bn-no-registry', class extends BnBase {}), /registry/i);
});

test('the package entry registers the elements and mounts window.bn', async () => {
  class EntryProbe extends BnBase {
    events() {
      return ['click'];
    }

    onClick() {}
  }

  globalThis.window = globalThis;
  const before = new Set(Object.keys(globalThis));

  try {
    // The dynamic import must run while the stub globals are installed.
    const entry = await import('../../src/js/index.js');
    const bn = entry.default;
    assert.equal(globalThis.bn, bn, 'the entry must mount the namespace it exports');
    assert.equal(typeof bn.register, 'function');

    const added = Object.keys(globalThis).filter((key) => !before.has(key) && key !== 'window');
    assert.deepEqual(added, ['bn'], 'the entry may add exactly one enumerable global');

    bn.register('bn-entry-probe', EntryProbe);
    assert.equal(globalThis.customElements.get('bn-entry-probe'), EntryProbe);
    const element = document.createElement('bn-entry-probe');
    element.connect();
    assert.deepEqual([...element._listeners.keys()], ['click']);
  } finally {
    delete globalThis.bn;
    delete globalThis.window;
  }
});
