// Tests for ticket 22 — `toast()` and the narrowed `window.bn` surface.
//
// Run with an explicit path, never bare `node --test`:
//
//   node --test tests/js/toast.test.mjs
//
// Bare `node --test` walks the whole working directory and would also pick up browser
// tests (ticket 08) that need Chrome.
//
// Two seams are under test, both public:
//
//   1. `createToast()` — the factory behind `bn.toast`. Every ambient dependency (the
//      document, the view for `getComputedStyle`, the two timer functions) is injectable,
//      so the auto-dismiss duration is driven by a fake clock and *nothing here sleeps*.
//   2. `createNamespace(global, capabilities)` — the surface may grow only by declaration.
//
// The module is imported *statically*, which is itself a contract: `toast.js` touches no
// global at import time (spec §9's "plain module" has no element to upgrade and no
// connectedCallback to wait for). The test file therefore installs no globals at all — the
// DOM it hands the factory is a local stub, smaller than the one in base.test.mjs (which
// needs `HTMLElement` on globalThis for `class extends HTMLElement`).

import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_DURATION, createToast, toast as singleton } from '../../src/js/toast.js';
import { createNamespace } from '../../src/js/namespace.js';

/* ------------------------------------ DOM stub ------------------------------------ */

/** The smallest element the toast module can be handed: children, attributes, text. */
class StubElement {
  constructor(tag) {
    this.nodeType = 1;
    this.tagName = String(tag).toUpperCase();
    this.childNodes = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.ownText = '';
  }

  get className() {
    return this.attributes.get('class') ?? '';
  }

  set className(value) {
    this.attributes.set('class', String(value));
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  get textContent() {
    return this.ownText + this.childNodes.map((child) => child.textContent).join('');
  }

  set textContent(value) {
    this.childNodes = [];
    this.ownText = String(value);
  }

  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    this.childNodes.push(child);
    child.parentNode = this;
    return child;
  }

  removeChild(child) {
    const index = this.childNodes.indexOf(child);
    if (index >= 0) this.childNodes.splice(index, 1);
    child.parentNode = null;
    return child;
  }

  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }

  /** A detached element is not connected; the container check rides on this. */
  get isConnected() {
    let node = this;
    while (node.parentNode) node = node.parentNode;
    return node === this.ownerDocument;
  }
}

/** A document object: `body`, `documentElement`, `createElement`. */
function stubDocument() {
  const document = new StubElement('#document');
  document.ownerDocument = document;
  document.body = document.appendChild(new StubElement('body'));
  document.documentElement = document.appendChild(new StubElement('html'));
  document.createElement = (tag) => {
    const element = new StubElement(tag);
    element.ownerDocument = document;
    return element;
  };
  return document;
}

/** Every created element, in creation order — the assertions read like the DOM would. */
function elementsIn(root, className) {
  const found = [];
  const walk = (node) => {
    for (const child of node.childNodes) {
      if (child.className === className) found.push(child);
      walk(child);
    }
  };
  walk(root);
  return found;
}

/* ----------------------------------- fake clock ----------------------------------- */

/**
 * An injected timer pair, so "the toast disappears after N ms" is asserted without waiting
 * N ms. `delays` is the set of pending delays — the independent evidence that the configured
 * duration reached the scheduler.
 */
function fakeClock() {
  let nextId = 1;
  let elapsed = 0;
  const pending = new Map();

  return {
    setTimeout(fn, ms) {
      const id = nextId;
      nextId += 1;
      pending.set(id, { fn, ms, at: elapsed + ms });
      return id;
    },
    clearTimeout(id) {
      pending.delete(id);
    },
    /** The delays every pending timer was scheduled with. */
    get delays() {
      return [...pending.values()].map((timer) => timer.ms);
    },
    get size() {
      return pending.size;
    },
    /** Advances the clock by `ms` and fires everything now due, earliest first. */
    advance(ms) {
      elapsed += ms;
      for (const [id, timer] of [...pending].sort((a, b) => a[1].at - b[1].at)) {
        if (timer.at <= elapsed) {
          pending.delete(id);
          timer.fn();
        }
      }
    },
  };
}

/** A view whose `getComputedStyle` reports the exit animation's duration. */
function stubView(animationDuration = null) {
  return {
    getComputedStyle() {
      return animationDuration === null ? {} : { animationDuration };
    },
  };
}

/** A toast instance wired to a fresh document and fake clock. */
function harness(options = {}) {
  const document = stubDocument();
  const clock = fakeClock();
  const toast = createToast({
    document,
    window: options.window ?? {},
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  });
  return { document, clock, toast };
}

/* ------------------------------ the three entries --------------------------------- */

test('the module exports the three entries with the documented arity', () => {
  assert.equal(typeof singleton, 'function', 'the module exports a ready-made toast()');
  assert.equal(typeof singleton.el, 'function', 'toast.el must exist');
  assert.equal(typeof singleton.clear, 'function', 'toast.clear must exist');
  assert.equal(singleton.length, 1, 'toast(message) — options is optional, so arity is 1');
  assert.equal(singleton.el.length, 1, 'toast.el(message [, options]) — arity is 1');
  assert.equal(singleton.clear.length, 0, 'toast.clear() takes no argument');
  assert.equal(DEFAULT_DURATION, 5000, 'the documented default auto-dismiss is 5000 ms');
});

test('importing the module needs no DOM at all', () => {
  // The static import at the top of this file already proved it; this states the contract.
  assert.equal(typeof globalThis.document, 'undefined', 'this file must install no document global');
  assert.equal(typeof globalThis.window, 'undefined', 'this file must install no window global');
});

/* ---------------------------------- creating one ---------------------------------- */

test('toast(message) shows the message in a single shared container', () => {
  const { document, toast } = harness();

  const element = toast('Saved.');
  const second = toast('Saved again.');

  const containers = elementsIn(document.body, 'bn-toast-container');
  assert.equal(containers.length, 1, 'one container serves every toast');
  assert.equal(containers[0].parentNode, document.body, 'the container hangs off <body>');
  assert.equal(containers[0].getAttribute('aria-live'), 'polite', 'the stack is a live region');
  assert.deepEqual(
    elementsIn(document.body, 'bn-toast'),
    [element, second],
    'toasts are appended in call order',
  );
  assert.equal(element.className, 'bn-toast');
  assert.equal(element.textContent, 'Saved.');
});

test('the message is text, never markup', () => {
  const { toast } = harness();

  const element = toast('<b>not bold</b>');

  assert.equal(element.textContent, '<b>not bold</b>', 'the message is inserted as text');
  assert.equal(element.childNodes.length, 0, 'no element may be parsed out of the message');
});

test('a message may be an element instead of a string', () => {
  const { document, toast } = harness();
  const paragraph = document.createElement('p');
  paragraph.textContent = 'Rich content.';

  const element = toast(paragraph);

  assert.equal(element.childNodes[0], paragraph, 'a node message is appended, not stringified');
  assert.equal(element.textContent, 'Rich content.');
});

test('variant rides data-variant, and its absence means no attribute', () => {
  const { toast } = harness();

  assert.equal(toast('plain').getAttribute('data-variant'), null);
  assert.equal(toast('careful', { variant: 'warning' }).getAttribute('data-variant'), 'warning');
  assert.equal(toast('gone', { variant: 'danger' }).getAttribute('data-variant'), 'danger');
  assert.equal(
    toast('error is an alias', { variant: 'error' }).getAttribute('data-variant'),
    'error',
    'the alias is passed through; 01-theme.css maps it',
  );
});

test('toast.el() hands over the element and leaves the lifetime to the caller', () => {
  const { clock, document, toast } = harness();

  const element = toast.el('Mine to keep.');

  assert.equal(element.className, 'bn-toast');
  assert.equal(element.textContent, 'Mine to keep.');
  assert.deepEqual(elementsIn(document.body, 'bn-toast'), [element], 'el() shows the toast');
  assert.deepEqual(clock.delays, [], 'el() arms no auto-dismiss timer');
  clock.advance(60_000);
  assert.deepEqual(elementsIn(document.body, 'bn-toast'), [element], 'and it stays until cleared');
});

/* ------------------------------------ timing -------------------------------------- */

test('the auto-dismiss fires at the default duration, not before', () => {
  const { clock, document, toast } = harness();

  toast('Default');

  assert.deepEqual(clock.delays, [DEFAULT_DURATION], 'the default duration reached the scheduler');
  clock.advance(DEFAULT_DURATION - 1);
  assert.equal(elementsIn(document.body, 'bn-toast').length, 1, 'still up one millisecond early');
  clock.advance(1);
  assert.equal(elementsIn(document.body, 'bn-toast').length, 0, 'gone at the configured moment');
});

test('duration is configurable per toast', () => {
  const { clock, document, toast } = harness();

  toast('Quick', { duration: 1200 });
  toast('Slow', { duration: 9000 });

  assert.deepEqual(clock.delays, [1200, 9000]);
  clock.advance(1200);
  assert.deepEqual(
    elementsIn(document.body, 'bn-toast').map((element) => element.textContent),
    ['Slow'],
    'only the short-lived toast went',
  );
});

test('duration 0 keeps the toast until it is cleared', () => {
  const { clock, document, toast } = harness();

  toast('Until you say so', { duration: 0 });

  assert.deepEqual(clock.delays, [], 'no timer is armed for 0');
  clock.advance(3_600_000);
  assert.equal(elementsIn(document.body, 'bn-toast').length, 1);
});

test('a duration that is not a finite number of milliseconds throws and shows nothing', () => {
  const { clock, document, toast } = harness();

  for (const duration of [-1, Number.NaN, Number.POSITIVE_INFINITY, 'soon']) {
    assert.throws(() => toast('bad', { duration }), TypeError, `duration ${String(duration)}`);
  }
  assert.equal(elementsIn(document.body, 'bn-toast').length, 0, 'a rejected call leaves no toast');
  assert.equal(
    elementsIn(document.body, 'bn-toast-container').length,
    0,
    'and does not create the container either',
  );
  assert.deepEqual(clock.delays, []);
});

test('the exit animation is awaited before the element is removed', () => {
  // The documented reason JS reads the computed duration: under reduced motion the animation
  // is not declared, `animation-duration` computes to 0s, and the toast goes immediately.
  const { clock, document, toast } = harness({ window: stubView('0.15s') });

  toast('Fading', { duration: 1000 });
  clock.advance(1000);

  const [element] = elementsIn(document.body, 'bn-toast');
  assert.ok(element, 'the toast is still in the document while it animates out');
  assert.equal(element.getAttribute('data-closing'), '', 'the exit is marked for CSS');
  assert.deepEqual(clock.delays, [150], 'removal is scheduled for the animation duration');

  clock.advance(150);
  assert.equal(elementsIn(document.body, 'bn-toast').length, 0);
});

test('without an animation the toast leaves on the spot', () => {
  const { clock, document, toast } = harness({ window: stubView('0s') });

  toast('Instant', { duration: 1000 });
  clock.advance(1000);

  assert.equal(elementsIn(document.body, 'bn-toast').length, 0);
  assert.deepEqual(clock.delays, [], 'nothing is left pending');
});

/* ------------------------------------- clear -------------------------------------- */

test('clear() empties the stack, removes the container and is idempotent', () => {
  const { document, clock, toast } = harness();

  toast('One', { duration: 0 });
  toast('Two', { duration: 0 });

  assert.equal(toast.clear(), 2, 'clear() reports how many toasts it closed');
  assert.equal(elementsIn(document.body, 'bn-toast').length, 0, 'the stack is empty');
  assert.equal(
    elementsIn(document.body, 'bn-toast-container').length,
    0,
    'an empty container does not linger in the DOM',
  );

  assert.equal(toast.clear(), 0, 'a second clear() closes nothing and does not throw');
  assert.equal(toast.clear(), 0, 'and a third is the same no-op');
  assert.deepEqual(clock.delays, [], 'no timer survives a clear');
});

test('clear() cancels the auto-dismiss timers it replaces', () => {
  const { clock, document, toast } = harness();

  toast('One', { duration: 1000 });
  toast('Two', { duration: 2000 });
  assert.equal(clock.size, 2);

  assert.equal(toast.clear(), 2);

  assert.equal(clock.size, 0, 'both pending timers were unscheduled');
  clock.advance(5000);
  assert.equal(elementsIn(document.body, 'bn-toast').length, 0, 'and nothing reappears later');
});

test('clear() with nothing to clear is a no-op that touches no DOM', () => {
  const { document, toast } = harness();

  assert.equal(toast.clear(), 0);
  assert.equal(document.body.childNodes.length, 0, 'clear() must not build a container');
});

test('a second clear() does not re-close a toast that is already animating out', () => {
  const { clock, document, toast } = harness({ window: stubView('0.15s') });
  toast('Fading', { duration: 0 });

  assert.equal(toast.clear(), 1, 'the first call closes it');
  assert.deepEqual(clock.delays, [150], 'one removal is scheduled');
  assert.equal(toast.clear(), 0, 'the second call finds it already closing');
  assert.deepEqual(clock.delays, [150], 'and schedules no second removal');

  clock.advance(150);
  assert.equal(elementsIn(document.body, 'bn-toast').length, 0);
});

test('a toast whose container a framework detached is put back in the document', () => {
  const { document, toast } = harness();

  toast('First', { duration: 0 });
  const [container] = elementsIn(document.body, 'bn-toast-container');
  document.body.removeChild(container);

  const second = toast('Second', { duration: 0 });

  const containers = elementsIn(document.body, 'bn-toast-container');
  assert.equal(containers.length, 1, 'a fresh container is attached rather than reusing the orphan');
  assert.equal(second.parentNode, containers[0]);
  assert.notEqual(containers[0], container);
});

/* ------------------------------ the narrowed surface ------------------------------- */

test('createNamespace mounts exactly the declared capabilities', () => {
  const fakeWindow = { existing: true };
  const capability = () => {};

  const bn = createNamespace(fakeWindow, { toast: capability });

  assert.deepEqual(
    Object.keys(bn).sort(),
    ['register', 'toast', 'version'],
    'the surface is the declared capabilities plus the two the namespace owns',
  );
  assert.equal(bn.toast, capability);
  assert.deepEqual(
    Object.getOwnPropertyNames(bn).sort(),
    ['register', 'toast', 'version'],
    'no hidden marker: the installed flag lives outside the object',
  );
  assert.deepEqual(
    Object.keys(fakeWindow).filter((key) => key !== 'existing'),
    ['bn'],
    'still exactly one enumerable global',
  );
});

test('createNamespace with no capabilities stays as narrow as ticket 18 left it', () => {
  const bn = createNamespace({});

  assert.deepEqual(Object.keys(bn).sort(), ['register', 'version']);
});

test('createNamespace mounts once per global object', () => {
  const fakeWindow = {};
  const first = createNamespace(fakeWindow, { toast: () => {} });
  const second = createNamespace(fakeWindow, { toast: () => {} });

  assert.equal(second, first, 'a second mount returns the live surface, not a rebuilt one');
  assert.equal(fakeWindow.bn, first);
});
