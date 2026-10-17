// Tests for ticket 20 — `<bn-tabs>`.
//
// Run with an explicit path, never bare `node --test`:
//
//   node --test tests/js/tabs.test.mjs
//
// Bare `node --test` walks the whole working directory and would also pick up the browser
// harness under tests/browser/ (ticket 08), which needs Chrome and is not a pure-Node test.
//
// `class BnTabs extends HTMLElement` cannot be evaluated in bare Node, so the minimal DOM stub
// below is installed *before* a dynamic `import(...)` of the module under test — a static import
// would be hoisted above the globals. The stub implements only what `tabs.js` touches: a shallow
// tree (`append`, `parentNode`, `querySelectorAll`) plus attributes, `id`, `hidden`, `tabIndex`
// and `focus`. `hidden` and `id` are accessors that reflect their attribute, as in the real DOM,
// because the component's whole contract is attribute bookkeeping.
//
// The three seams this file tests are the ones ticket 20 names: the `bn:change` detail shape, the
// roving tabindex, and the index arithmetic of the arrow / Home / End keys.

import assert from 'node:assert/strict';
import test from 'node:test';

/* ------------------------------------ DOM stub ------------------------------------ */

/** `new CustomEvent(...)` stands in for the browser's; extends `Event` so Node's `EventTarget`
 *  accepts it in `dispatchEvent`. */
class StubCustomEvent extends Event {
  constructor(type, init = {}) {
    super(type, init);
    this.detail = init.detail;
  }
}

/** The selectors the component uses, and nothing else. */
function matchesSelector(node, selector) {
  const attribute = selector.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/);
  if (!attribute) throw new Error(`stub: unsupported selector ${selector}`);
  const value = node.getAttribute(attribute[1]);
  return attribute[2] === undefined ? value !== null : value === attribute[2];
}

class StubHTMLElement extends EventTarget {
  constructor(tag = 'div') {
    super();
    this.tagName = tag.toUpperCase();
    this._attributes = new Map();
    this.childNodes = [];
    this.parentNode = null;
    this.isConnected = false;
    this.tabIndex = -1;
    this.focused = false;
  }

  /* ---- attributes (id and hidden reflect theirs, as the real DOM does) ---- */

  setAttribute(name, value) {
    const text = String(value);
    this._attributes.set(name, text);
    if (name === 'tabindex') this.tabIndex = Number(text);
  }

  getAttribute(name) {
    return this._attributes.has(name) ? this._attributes.get(name) : null;
  }

  hasAttribute(name) {
    return this._attributes.has(name);
  }

  removeAttribute(name) {
    this._attributes.delete(name);
    if (name === 'tabindex') this.tabIndex = -1;
  }

  get id() {
    return this.getAttribute('id') ?? '';
  }

  set id(value) {
    this.setAttribute('id', value);
  }

  get hidden() {
    return this.hasAttribute('hidden');
  }

  set hidden(value) {
    if (value) this.setAttribute('hidden', '');
    else this.removeAttribute('hidden');
  }

  /* ---- the shallow tree ---- */

  append(...nodes) {
    for (const node of nodes) {
      node.parentNode = this;
      this.childNodes.push(node);
    }
    return this;
  }

  querySelectorAll(selector) {
    const found = [];
    const visit = (node) => {
      for (const child of node.childNodes) {
        if (matchesSelector(child, selector)) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  /* ---- focus, tracked on the stub document so `document.activeElement` is honest ---- */

  focus() {
    const previous = globalThis.document.activeElement;
    if (previous) previous.focused = false;
    this.focused = true;
    globalThis.document.activeElement = this;
  }

  /* ---- lifecycle, exactly as the browser would drive it ---- */

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
  activeElement: null,
  createElement(tag) {
    const ctor = definitions.get(tag);
    if (!ctor) throw new Error(`<${tag}> is not defined yet`);
    return new ctor();
  },
};

const { BnTabs } = await import('../../src/js/tabs.js');

/** The stub document is shared by every test in this file, so focus starts from scratch. */
test.beforeEach(() => {
  globalThis.document.activeElement = null;
});

/* ------------------------------------ fixtures ------------------------------------ */

/** One element, attributes first: the fixture builder writes ARIA the way an author would. */
function node(tag, attributes = {}) {
  const element = new StubHTMLElement(tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  return element;
}

/**
 * The canonical author markup: a tablist of `<button role="tab">`, one panel each, and no
 * `hidden` anywhere — hiding a panel is the script's job, which is what keeps the page readable
 * with no script at all (spec §3 invariant 6).
 */
function createTabs(options = {}) {
  const { selected = 0, count = 3, controls = true, ids = true, preHidden = [] } = options;
  const tablist = node('div', { role: 'tablist', 'aria-label': 'Sections' });
  const tabs = [];
  const panels = [];

  for (let index = 0; index < count; index += 1) {
    const tab = node('button', { type: 'button', role: 'tab' });
    const panel = node('div', { role: 'tabpanel' });

    if (ids) {
      tab.id = `tab-${index}`;
      panel.id = `panel-${index}`;
    }
    if (controls) tab.setAttribute('aria-controls', `panel-${index}`);
    if (index === selected) tab.setAttribute('aria-selected', 'true');
    if (preHidden.includes(index)) panel.setAttribute('hidden', '');

    tablist.append(tab);
    tabs.push(tab);
    panels.push(panel);
  }

  const element = new BnTabs();
  element.append(tablist, ...panels);
  return { element, tabs, panels, tablist };
}

function connect(fixture) {
  fixture.element.connect();
  return fixture;
}

/** A bubbling, cancelable event whose `target` is `target` — the DOM half Node cannot model. */
function event(type, target, init = {}) {
  const dispatched = new StubCustomEvent(type, { bubbles: true, cancelable: true, ...init });
  Object.defineProperty(dispatched, 'target', { value: target, configurable: true });
  return dispatched;
}

const clickOn = (target) => event('click', target);

function keyOn(key, target) {
  const pressed = event('keydown', target);
  pressed.key = key;
  return pressed;
}

const selectedStates = (tabs) => tabs.map((tab) => tab.getAttribute('aria-selected'));
const tabIndexes = (tabs) => tabs.map((tab) => tab.tabIndex);
const hiddenStates = (panels) => panels.map((panel) => panel.hidden);

/* ------------------------------- init and the initial state ------------------------------- */

test('init selects the tab marked aria-selected in the markup and hides every other panel', () => {
  const { element, tabs, panels } = connect(createTabs({ selected: 1 }));

  assert.deepEqual(selectedStates(tabs), ['false', 'true', 'false'], 'the authored selection is kept');
  assert.deepEqual(tabIndexes(tabs), [-1, 0, -1], 'roving tabindex lands on the selected tab');
  assert.deepEqual(hiddenStates(panels), [true, false, true], 'only the selected panel stays visible');
});

test('init falls back to the first tab when the markup names no selection', () => {
  const { tabs, panels } = connect(createTabs({ selected: -1 }));

  assert.deepEqual(selectedStates(tabs), ['true', 'false', 'false']);
  assert.deepEqual(tabIndexes(tabs), [0, -1, -1]);
  assert.deepEqual(hiddenStates(panels), [false, true, true]);
});

test('an <bn-tabs> with no tabs is a quiet no-op', () => {
  const element = new BnTabs();
  const stray = node('div', { role: 'tabpanel' });
  element.append(stray);

  element.connect();
  assert.equal(stray.hidden, false, 'nothing may be hidden when there is nothing to select');
  assert.equal(element._initialised, true, 'the element still initialises — it just has no work');
  element.disconnect();
});

/* ------------------------------------ the bn:change event ---------------------------------- */

test('clicking a tab selects it and announces bn:change with the index, the tab and its panel', () => {
  const { element, tabs, panels } = connect(createTabs({ selected: 0 }));
  const seen = [];
  element.addEventListener('bn:change', (event_) => seen.push(event_));

  element.dispatchEvent(clickOn(tabs[2]));

  assert.equal(seen.length, 1, 'one switch, one event');
  const [announced] = seen;
  assert.equal(announced.type, 'bn:change');
  assert.equal(announced.bubbles, true, 'spec §9: bubbles must be true');
  assert.equal(announced.composed, true, 'spec §9: composed must be true');
  assert.deepEqual(Object.keys(announced.detail).sort(), ['index', 'panel', 'tab']);
  assert.equal(announced.detail.index, 2);
  assert.equal(announced.detail.tab, tabs[2], 'detail.tab is the selected tab element itself');
  assert.equal(announced.detail.panel, panels[2], 'detail.panel is the panel it controls');

  assert.deepEqual(tabIndexes(tabs), [-1, -1, 0]);
  assert.deepEqual(selectedStates(tabs), ['false', 'false', 'true']);
  assert.deepEqual(hiddenStates(panels), [true, true, false]);
});

test('re-selecting the tab that is already selected announces nothing', () => {
  const { element, tabs } = connect(createTabs({ selected: 0 }));
  const seen = [];
  element.addEventListener('bn:change', (event_) => seen.push(event_));

  element.dispatchEvent(clickOn(tabs[0]));

  assert.deepEqual(seen, [], 'bn:change means the selection moved');
});

test('the event bubbles out of the element, so a listener on an ancestor hears it', () => {
  const { element, tabs } = connect(createTabs({ selected: 0 }));
  const seen = [];
  element.addEventListener('bn:change', (event_) => seen.push(event_.detail.index));

  const event_ = clickOn(tabs[1]);
  const returned = element.dispatchEvent(event_);

  assert.equal(returned, true, 'an uncancelled event returns true from dispatchEvent');
  assert.deepEqual(seen, [1]);
});

/* ----------------------------------- keyboard navigation ---------------------------------- */

test('ArrowRight moves focus and selection to the next tab (automatic activation)', () => {
  const { element, tabs, panels } = connect(createTabs({ selected: 0 }));
  tabs[0].focus();

  const pressed = keyOn('ArrowRight', tabs[0]);
  element.dispatchEvent(pressed);

  assert.equal(pressed.defaultPrevented, true, 'a handled arrow key must not scroll the page');
  assert.equal(document.activeElement, tabs[1], 'focus follows the selection');
  assert.deepEqual(selectedStates(tabs), ['false', 'true', 'false']);
  assert.deepEqual(tabIndexes(tabs), [-1, 0, -1]);
  assert.deepEqual(hiddenStates(panels), [true, false, true]);
});

test('the arrow keys clamp at both ends instead of wrapping, and still stop the page scrolling', () => {
  const { element, tabs } = connect(createTabs({ selected: 0 }));
  const seen = [];
  element.addEventListener('bn:change', (event_) => seen.push(event_.detail.index));

  const left = keyOn('ArrowLeft', tabs[0]);
  element.dispatchEvent(left);
  assert.equal(left.defaultPrevented, true, 'the key is still ours to handle');
  assert.equal(tabs[0].getAttribute('aria-selected'), 'true', 'the first tab is the end of the road');
  assert.equal(document.activeElement, tabs[0]);

  // Reach the last tab through the component's own keyboard path, so the right-hand clamp is
  // measured from a state the component produced rather than from a programmatic focus().
  element.dispatchEvent(keyOn('End', tabs[0]));
  seen.length = 0;
  assert.equal(tabs[2].getAttribute('aria-selected'), 'true', 'End reached the last tab');

  const right = keyOn('ArrowRight', tabs[2]);
  element.dispatchEvent(right);
  assert.equal(right.defaultPrevented, true);
  assert.equal(tabs[2].getAttribute('aria-selected'), 'true', 'the last tab is the end of the road');
  assert.equal(document.activeElement, tabs[2]);

  assert.deepEqual(seen, [], 'clamping is not a selection change');
});

test('Home and End jump to the first and the last tab', () => {
  const { element, tabs, panels } = connect(createTabs({ selected: 1 }));

  element.dispatchEvent(keyOn('End', tabs[1]));
  assert.equal(document.activeElement, tabs[2]);
  assert.deepEqual(tabIndexes(tabs), [-1, -1, 0]);
  assert.deepEqual(hiddenStates(panels), [true, true, false]);

  element.dispatchEvent(keyOn('Home', tabs[2]));
  assert.equal(document.activeElement, tabs[0]);
  assert.deepEqual(tabIndexes(tabs), [0, -1, -1]);
  assert.deepEqual(hiddenStates(panels), [false, true, true]);
});

test('a key pressed inside a panel is left to the panel', () => {
  const { element, tabs, panels } = connect(createTabs({ selected: 1 }));

  const pressed = keyOn('ArrowRight', panels[1]);
  element.dispatchEvent(pressed);

  assert.equal(pressed.defaultPrevented, false, 'a panel may want the arrow keys for itself');
  assert.equal(tabs[1].getAttribute('aria-selected'), 'true', 'nothing moved');
  assert.equal(document.activeElement, null, 'and nothing was focused');
});

test('a non-navigation key reaches no handler at all', () => {
  const { element, tabs } = connect(createTabs({ selected: 0 }));
  const seen = [];
  element.addEventListener('bn:change', (event_) => seen.push(event_.detail.index));

  const pressed = keyOn('Escape', tabs[0]);
  element.dispatchEvent(pressed);

  assert.equal(pressed.defaultPrevented, false);
  assert.deepEqual(seen, []);
});

/* ------------------------------------ the ARIA wiring ------------------------------------- */

test('aria-controls and aria-labelledby are generated when the author left them out', () => {
  const { element, tabs, panels } = connect(createTabs({ ids: false, controls: false }));

  tabs.forEach((tab, index) => {
    assert.match(tab.id, /^bn-tab-\d+$/, 'a tab without an id gets a page-unique one');
    assert.match(panels[index].id, /^bn-tabpanel-\d+$/, 'and so does its panel');
    assert.equal(tab.getAttribute('aria-controls'), panels[index].id, 'the tab points at its panel');
    assert.equal(panels[index].getAttribute('aria-labelledby'), tab.id, 'and the panel points back');
  });
  assert.equal(new Set(tabs.map((tab) => tab.id)).size, tabs.length, 'ids never collide');
});

test('an authored aria-controls decides which panel a tab owns, not the document order', () => {
  const tabA = node('button', { type: 'button', role: 'tab', id: 'tab-a', 'aria-controls': 'panel-b', 'aria-selected': 'true' });
  const tabB = node('button', { type: 'button', role: 'tab', id: 'tab-b', 'aria-controls': 'panel-a' });
  const tablist = node('div', { role: 'tablist' });
  tablist.append(tabA, tabB);
  const panelA = node('div', { role: 'tabpanel', id: 'panel-a' });
  const panelB = node('div', { role: 'tabpanel', id: 'panel-b' });

  const element = new BnTabs();
  element.append(tablist, panelA, panelB);
  element.connect();

  assert.deepEqual(hiddenStates([panelA, panelB]), [true, false], 'tab-a owns panel-b');

  element.dispatchEvent(clickOn(tabB));
  assert.deepEqual(hiddenStates([panelA, panelB]), [false, true], 'tab-b owns panel-a');

  assert.equal(panelB.getAttribute('aria-labelledby'), 'tab-a', 'authored ids are left alone');
});

/* ------------------------------------ the lifecycle --------------------------------------- */

test('teardown puts the panels back the way init found them, and a reconnect re-initialises', () => {
  const { element, tabs, panels } = connect(createTabs({ selected: 1, preHidden: [2] }));
  assert.deepEqual(hiddenStates(panels), [true, false, true]);

  element.disconnect();
  assert.deepEqual(
    hiddenStates(panels),
    [false, false, true],
    'teardown restores the authored state: only the panel the author hid stays hidden',
  );

  element.connect();
  assert.deepEqual(hiddenStates(panels), [true, false, true], 're-init reapplies the selection');
  assert.deepEqual(tabIndexes(tabs), [-1, 0, -1], 'and the roving tabindex survives the round trip');
});

test('init runs once per connect and binds click and keydown through the base class', () => {
  const { element, tabs } = connect(createTabs({ selected: 0 }));

  assert.deepEqual([...element._listeners.keys()].sort(), ['click', 'keydown']);
  element.connect();
  assert.equal(element._listeners.get('click').length, 1, 'a second connect must not rebind');

  element.dispatchEvent(clickOn(tabs[1]));
  assert.equal(tabs[1].getAttribute('aria-selected'), 'true', 'exactly one live click listener');
});

/* --------------------------------- the package entry point -------------------------------- */

test('the package entry registers <bn-tabs>', async () => {
  globalThis.window = globalThis;
  try {
    await import('../../src/js/index.js');

    assert.equal(customElements.get('bn-tabs'), BnTabs, 'bn-tabs must be defined by the entry');
    assert.ok(document.createElement('bn-tabs') instanceof BnTabs, 'and upgrade-markup can find it');
  } finally {
    delete globalThis.window;
  }
});
