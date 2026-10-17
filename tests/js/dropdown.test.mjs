// Tests for ticket 19 — `<bn-dropdown>`, the popover-based menu.
//
// Run with an explicit path, never bare `node --test` (bare `node --test` walks the working
// directory and would also collect the browser harness under tests/browser/, which needs Chrome):
//
//   node --test tests/js/base.test.mjs tests/js/dropdown.test.mjs
//
// `class BnDropdown extends BnBase extends HTMLElement` cannot be evaluated in bare Node: there is
// no HTMLElement, no CustomEvent, no document and no popover API. The stub below implements only
// what the module under test touches, and the module is loaded with a *dynamic* import after the
// globals are installed (a static `import` would be hoisted above them) — the same technique
// ticket 18's tests use.
//
// What is stubbed and what is real:
//
//   * real: the `BnBase` lifecycle, `handleEvent` dispatch, `emit()`, `focusOnly()` — the whole
//     class under test runs unmodified.
//   * stubbed: the DOM tree (children / attributes / selectors), `document.getElementById`,
//     `document.activeElement`, and the popover API (`showPopover` / `hidePopover` / `:popover-open`
//     / the `toggle` event).
//
// The selectors the stub understands are the ones the documented markup contract uses: a tag name
// plus `.class`, `[attribute]` and `[attribute="value"]`. A component that reached for a selector
// the stub cannot honour raises instead of silently matching nothing, so the test cannot pass by
// accident.
//
// One deliberate difference from the browser: `toggle` is dispatched synchronously by the stub
// (the real one is queued as a task), and Node's `EventTarget` does not propagate an event to
// ancestors, so `bubbles` is asserted as the property `emit()` sets rather than by hearing the
// event on a parent.

import assert from 'node:assert/strict';
import test from 'node:test';

/* ------------------------------------ DOM stub ------------------------------------ */

/** `new CustomEvent(...)` stands in for the browser's; extends `Event` so the real `EventTarget`
 *  Node provides accepts it in `dispatchEvent`. */
class StubCustomEvent extends Event {
  constructor(type, init = {}) {
    super(type, init);
    this.detail = init.detail;
  }
}

/** `id` → element, which is what `document.getElementById` answers from. */
const ID_INDEX = new Map();

const COMPOUND = /\.[\w-]+|\[[^\]]*\]|:popover-open/g;

/**
 * Matches the compound selectors the markup contract needs. Anything richer (`:is(...)`, a
 * descendant combinator, a pseudo-class other than `:popover-open`) throws: a component may not
 * quietly depend on selector power the test cannot check.
 */
function matchesSelector(element, selector) {
  const text = String(selector).trim();
  let rest = text;

  const tag = rest.match(/^[a-zA-Z][a-zA-Z0-9-]*/);
  if (tag) {
    if (element.tagName !== tag[0].toUpperCase()) return false;
    rest = rest.slice(tag[0].length);
  }

  for (const part of rest.match(COMPOUND) ?? []) {
    if (part === ':popover-open') {
      if (!element._showing) return false;
      continue;
    }
    if (part.startsWith('.')) {
      if (!element._classes().includes(part.slice(1))) return false;
      continue;
    }
    const match = part.slice(1, -1).match(/^([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?$/);
    if (!match) throw new Error(`the stub cannot parse the selector ${JSON.stringify(selector)}`);
    const value = element.getAttribute(match[1]);
    if (value === null) return false;
    const wanted = match[2] ?? match[3] ?? match[4];
    if (wanted !== undefined && value !== wanted) return false;
  }

  const leftovers = rest.replace(COMPOUND, '').trim();
  if (leftovers !== '') {
    throw new Error(
      `the stub cannot match ${JSON.stringify(selector)} (unparsed: ${JSON.stringify(leftovers)}) — ` +
        'keep component selectors compound, or teach the stub the new form',
    );
  }
  return true;
}

class StubHTMLElement extends EventTarget {
  constructor(tagName = 'div') {
    super();
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.tabIndex = 0;
    this.textContent = '';
    this.isConnected = false;
    this.focused = 0;
    this._showing = false;
    // `style` exists so the anchoring hook is observable (and removable) in the tests.
    this.styleDeclarations = new Map();
    this.style = {
      setProperty: (name, value) => this.styleDeclarations.set(name, String(value)),
      removeProperty: (name) => this.styleDeclarations.delete(name),
      getPropertyValue: (name) => this.styleDeclarations.get(name) ?? '',
    };
  }

  /* ------------------------------------ tree ------------------------------------ */

  append(...nodes) {
    for (const node of nodes) {
      node.parentNode = this;
      this.children.push(node);
    }
    return this;
  }

  get classList() {
    const element = this;
    return { contains: (name) => element._classes().includes(name) };
  }

  _classes() {
    return (this.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
  }

  /* --------------------------------- attributes --------------------------------- */

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === 'id') ID_INDEX.set(String(value), this);
  }

  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === 'id' && ID_INDEX.get(String(name)) === this) ID_INDEX.delete(String(name));
  }

  /* ---------------------------- selectors and traversal -------------------------- */

  matches(selector) {
    return matchesSelector(this, selector);
  }

  closest(selector) {
    for (let node = this; node; node = node.parentNode) {
      if (matchesSelector(node, selector)) return node;
    }
    return null;
  }

  contains(node) {
    for (let walk = node; walk; walk = walk.parentNode) {
      if (walk === this) return true;
    }
    return false;
  }

  querySelectorAll(selector) {
    const found = [];
    const walk = (node) => {
      for (const child of node.children) {
        if (matchesSelector(child, selector)) found.push(child);
        walk(child);
      }
    };
    walk(this);
    return found;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  /* ----------------------------------- focus ------------------------------------ */

  focus() {
    this.focused += 1;
    stubDocument.activeElement = this;
  }

  blur() {
    if (stubDocument.activeElement === this) stubDocument.activeElement = null;
  }

  /* ------------------------------ the popover API -------------------------------- */

  showPopover() {
    if (this._showing) return;
    this._showing = true;
    this._toggle('open', 'closed');
  }

  hidePopover() {
    if (!this._showing) return;
    this._showing = false;
    this._toggle('closed', 'open');
  }

  _toggle(newState, oldState) {
    const event = new StubCustomEvent('toggle', {});
    event.newState = newState;
    event.oldState = oldState;
    this.dispatchEvent(event);
  }

  /* ---------------------------------- lifecycle ---------------------------------- */

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

const stubDocument = {
  readyState: 'complete',
  activeElement: null,
  body: null,
  getElementById: (id) => ID_INDEX.get(String(id)) ?? null,
  createElement(tag) {
    const ctor = definitions.get(tag);
    if (!ctor) throw new Error(`<${tag}> is not defined yet`);
    return new ctor();
  },
  addEventListener() {},
  removeEventListener() {},
};

globalThis.HTMLElement = StubHTMLElement;
globalThis.CustomEvent = StubCustomEvent;
globalThis.document = stubDocument;
// Anchor positioning is one feature in Chrome; the stub reports it as available so the anchoring
// hook is exercised here, and the real placement is measured in scripts/verify-dropdown.mjs.
globalThis.CSS = { supports: (condition) => /anchor-name|position-area|position-anchor/.test(condition) };
globalThis.customElements = {
  define(name, ctor) {
    if (definitions.has(name)) throw new Error(`duplicate definition of <${name}>`);
    definitions.set(name, ctor);
  },
  get: (name) => definitions.get(name),
  upgrade() {},
};
stubDocument.body = new StubHTMLElement('body');

const { BnDropdown } = await import('../../src/js/dropdown.js');

/* ------------------------------------ fixtures ------------------------------------ */

/** A fresh id per fixture: `popovertarget` is a document-wide reference. */
let menuCounter = 0;

function el(tag, attributes = {}) {
  const node = new StubHTMLElement(tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
}

/**
 * The documented markup contract, built in the stub:
 *
 *   <bn-dropdown>
 *     <button popovertarget="menu-1" aria-expanded="false">Menu</button>
 *     <menu popover id="menu-1">
 *       <li><button class="bn-dropdown-item" value="v1">One</button></li>
 *     </menu>
 *   </bn-dropdown>
 *
 * Every option below exists to break exactly one part of it, which is how the "no internal
 * structure, no error" cases are built.
 */
function buildDropdown(options = {}) {
  const {
    labels = ['One', 'Two', 'Three'],
    trigger = true,
    panel = true,
    popoverAttribute = true,
    popoverApi = true,
    idMatch = true,
    expanded = 'false',
  } = options;

  const root = new BnDropdown();
  const id = `menu-${(menuCounter += 1)}`;
  const target = idMatch ? id : `${id}-elsewhere`;

  let triggerNode = null;
  if (trigger) {
    triggerNode = el('button', expanded === null ? {} : { 'aria-expanded': expanded });
    triggerNode.textContent = 'Menu';
    triggerNode.setAttribute('popovertarget', target);
    root.append(triggerNode);
  }

  let panelNode = null;
  const itemNodes = [];
  if (panel) {
    panelNode = el('menu', popoverAttribute ? { popover: '', id } : { id });
    if (!popoverApi) {
      panelNode.showPopover = undefined;
      panelNode.hidePopover = undefined;
    }
    labels.forEach((label, index) => {
      const item = el('button', { class: 'bn-dropdown-item', value: `v${index + 1}` });
      item.textContent = label;
      panelNode.append(el('li').append(item));
      itemNodes.push(item);
    });
    root.append(panelNode);
  }

  root.connect();
  return { root, trigger: triggerNode, panel: panelNode, items: itemNodes, id };
}

/* ------------------------------------- helpers ------------------------------------ */

function keyEvent(key, init = {}) {
  const event = new StubCustomEvent('keydown', { bubbles: true, cancelable: true, ...init });
  event.key = key;
  return event;
}

/**
 * Node's `EventTarget` sets `target` to whoever dispatched, and never walks to ancestors. A click
 * on a menu item is therefore modelled by pinning `target` to the item and dispatching at the
 * element under test — which is what the bubbling path in a browser amounts to for the component.
 */
function clickEvent(target) {
  const event = new StubCustomEvent('click', { bubbles: true, cancelable: true, composed: true });
  Object.defineProperty(event, 'target', { value: target });
  return event;
}

/** Collects console output, so "quiet" is a measurement instead of a promise. */
function captureConsole(fn) {
  const calls = [];
  const original = { error: console.error, warn: console.warn };
  console.error = (...args) => calls.push(['error', ...args]);
  console.warn = (...args) => calls.push(['warn', ...args]);
  try {
    fn();
  } finally {
    console.error = original.error;
    console.warn = original.warn;
  }
  return calls;
}

function listen(root, type) {
  const seen = [];
  root.addEventListener(type, (event) => seen.push(event));
  return seen;
}

/* ------------------------------ the markup contract ------------------------------- */

test('init() finds the trigger and the panel the author wrote, and never builds one', () => {
  const { root, trigger, panel, items } = buildDropdown();

  assert.equal(root._panel, panel, 'the panel must be the author’s [popover], not a new node');
  assert.equal(root._trigger, trigger, 'the trigger must be the author’s [popovertarget]');
  assert.deepEqual(root.items(), items, 'the items must be the author’s .bn-dropdown-item nodes');
  assert.equal(panel.children.length, items.length, 'no item was created by the component');
  assert.equal(trigger.getAttribute('aria-expanded'), 'false', 'a closed dropdown starts collapsed');
  assert.deepEqual(
    [...root._listeners.keys()].sort(),
    ['click', 'focusout', 'keydown'],
    'BnBase binds the declared event types, and only those',
  );
});

/* --------------- verification 2: no internal structure, no error, no noise --------- */

test('a <bn-dropdown> with no [popovertarget] initialises quietly', () => {
  const calls = captureConsole(() => {
    const { root, panel } = buildDropdown({ trigger: false });

    assert.equal(root._panel, null, 'nothing may be adopted without a trigger');
    root.dispatchEvent(keyEvent('ArrowDown'));
    root.dispatchEvent(clickEvent(root));
  });

  assert.deepEqual(calls, [], 'a component that finds nothing must not complain about it');
});

test('a trigger pointing at nothing, or at a non-popover, initialises quietly', () => {
  const cases = [
    ['the referenced id does not exist', { panel: false }],
    ['the id points elsewhere', { idMatch: false }],
    ['the target has no [popover] attribute', { popoverAttribute: false }],
    ['the browser has no popover API', { popoverApi: false }],
  ];

  for (const [label, options] of cases) {
    const calls = captureConsole(() => {
      const { root, panel } = buildDropdown(options);

      assert.equal(root._panel, null, `${label}: nothing may be adopted`);
      assert.equal(root._isOpen(), false, `${label}: nothing may read as open`);
      root.dispatchEvent(keyEvent('ArrowDown'));
      root.dispatchEvent(clickEvent(panel ?? root));
    });
    assert.deepEqual(calls, [], `${label}: no console output`);
  }
});

test('a quietly-exited dropdown still answers teardown()', () => {
  const { root } = buildDropdown({ trigger: false });

  // disconnectedCallback must not throw on an element that never adopted anything.
  root.disconnect();
  assert.equal(root.isConnected, false);
});

/* ---------------------- verification 3: open / close events ------------------------ */

test('opening and closing emit bubbling, composed CustomEvents with the parts', () => {
  const { root, trigger, panel } = buildDropdown();
  const opened = listen(root, 'bn:open');
  const closed = listen(root, 'bn:close');

  panel.showPopover();
  panel.hidePopover();

  assert.equal(opened.length, 1, 'exactly one bn:open per open');
  assert.equal(closed.length, 1, 'exactly one bn:close per close');
  for (const event of [opened[0], closed[0]]) {
    assert.ok(event instanceof StubCustomEvent, 'events are always CustomEvent (spec §9)');
    assert.equal(event.bubbles, true, 'spec §9: bubbles must be true');
    assert.equal(event.composed, true, 'spec §9: composed must be true');
  }
  assert.deepEqual(opened[0].detail, { trigger, panel }, 'bn:open carries the two author nodes');
  assert.deepEqual(closed[0].detail, { trigger, panel }, 'bn:close carries the two author nodes');
});

test('the trigger reports the state, and teardown() restores what the author wrote', () => {
  const { root, trigger, panel } = buildDropdown();

  panel.showPopover();
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  panel.hidePopover();
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');

  // An author who wrote the attribute gets their value back; one who did not gets the attribute
  // removed rather than a stale "false" left behind by the component.
  const { root: bare, trigger: bareTrigger, panel: barePanel } = buildDropdown({ expanded: null });
  barePanel.showPopover();
  assert.equal(bareTrigger.getAttribute('aria-expanded'), 'true');
  bare.disconnect();
  assert.equal(bareTrigger.getAttribute('aria-expanded'), null, 'teardown must not leave residue');

  root.disconnect();
  assert.equal(trigger.getAttribute('aria-expanded'), 'false', 'teardown restores the author’s value');
  assert.equal(root._panel, null, 'teardown drops the adopted nodes');
});

/* ------------------ verification 1 + 3: keyboard navigation and focus -------------- */

test('opening moves focus to the first item and leaves exactly one tabbable item', () => {
  const { root, panel, items } = buildDropdown();

  panel.showPopover();

  assert.equal(stubDocument.activeElement, items[0], 'focus must enter the menu when it opens');
  assert.equal(root._isOpen(), true);
  assert.deepEqual(
    items.map((item) => item.tabIndex),
    [0, -1, -1],
    'roving tabindex: only the active item stays in the tab order',
  );
  assert.equal(items[0].focused, 1, 'the first item is focused exactly once');
});

test('ArrowDown / ArrowUp move through the items and wrap at the ends', () => {
  const { root, panel, items } = buildDropdown({ labels: ['One', 'Two', 'Three'] });
  panel.showPopover();

  root.dispatchEvent(keyEvent('ArrowDown'));
  assert.equal(stubDocument.activeElement, items[1], 'ArrowDown moves to the next item');
  assert.deepEqual(items.map((item) => item.tabIndex), [-1, 0, -1]);

  root.dispatchEvent(keyEvent('ArrowDown'));
  assert.equal(stubDocument.activeElement, items[2], 'ArrowDown reaches the last item');

  root.dispatchEvent(keyEvent('ArrowDown'));
  assert.equal(stubDocument.activeElement, items[0], 'ArrowDown wraps around the menu');

  root.dispatchEvent(keyEvent('ArrowUp'));
  assert.equal(stubDocument.activeElement, items[2], 'ArrowUp wraps back to the last item');

  const event = keyEvent('ArrowUp');
  root.dispatchEvent(event);
  assert.equal(stubDocument.activeElement, items[1]);
  assert.equal(event.defaultPrevented, true, 'a handled navigation key stops the page from scrolling');
});

test('Home and End jump to the ends, and a letter key is left alone', () => {
  const { root, panel, items } = buildDropdown();
  panel.showPopover();

  root.dispatchEvent(keyEvent('End'));
  assert.equal(stubDocument.activeElement, items[2], 'End selects the last item');

  root.dispatchEvent(keyEvent('Home'));
  assert.equal(stubDocument.activeElement, items[0], 'Home selects the first item');

  const letter = keyEvent('a');
  root.dispatchEvent(letter);
  assert.equal(stubDocument.activeElement, items[0], 'a letter key must not move the active item');
  assert.equal(letter.defaultPrevented, false, 'and must keep its native meaning');
});

test('navigation keys do nothing while the menu is closed', () => {
  const { root, items } = buildDropdown();
  const before = stubDocument.activeElement;

  root.dispatchEvent(keyEvent('ArrowDown'));

  assert.equal(stubDocument.activeElement, before, 'a closed menu must not steal focus');
  assert.deepEqual(items.map((item) => item.tabIndex), [0, 0, 0], 'and must not touch the tab order');
});

/* ---------------------- verification 1: Escape closes and returns focus ------------ */

test('Escape closes an open menu and hands focus back to the trigger', () => {
  const { root, trigger, panel, items } = buildDropdown();
  const closed = listen(root, 'bn:close');
  panel.showPopover();
  assert.equal(stubDocument.activeElement, items[0], 'the menu owns the focus before the press');

  const escape = keyEvent('Escape');
  root.dispatchEvent(escape);

  assert.equal(panel._showing, false, 'Escape closes the popover');
  assert.equal(root._isOpen(), false);
  assert.equal(escape.defaultPrevented, true, 'the component owns the close (no double dismissal)');
  assert.equal(closed.length, 1, 'closing announces itself once');
  assert.equal(stubDocument.activeElement, trigger, 'focus returns to the element that opened it');
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
});

test('Escape on a closed menu is a no-op', () => {
  const { root, trigger } = buildDropdown();
  const closed = listen(root, 'bn:close');
  stubDocument.activeElement = null;

  const escape = keyEvent('Escape');
  root.dispatchEvent(escape);

  assert.equal(closed.length, 0, 'no event is announced for a menu that was never open');
  assert.equal(escape.defaultPrevented, false, 'and the press stays the page’s business');
  assert.equal(stubDocument.activeElement, null, 'no focus is moved');
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
});

/* ---------------------------------- selection ------------------------------------- */

test('picking an item announces bn:select, closes the menu and returns focus', () => {
  const { root, trigger, panel, items } = buildDropdown();
  const selected = listen(root, 'bn:select');
  const closed = listen(root, 'bn:close');
  panel.showPopover();

  root.dispatchEvent(clickEvent(items[1]));

  assert.equal(selected.length, 1, 'one click on an item is one selection');
  assert.equal(selected[0].bubbles, true);
  assert.equal(selected[0].composed, true);
  assert.deepEqual(selected[0].detail, { value: 'v2', item: items[1] }, 'the value comes from the item');
  assert.equal(panel._showing, false, 'picking an item closes the menu');
  assert.equal(closed.length, 1);
  assert.equal(stubDocument.activeElement, trigger, 'focus returns to the trigger');
});

test('the value falls back to the item text, and a click elsewhere selects nothing', () => {
  const { root, panel, items } = buildDropdown();
  const selected = listen(root, 'bn:select');
  panel.showPopover();

  items[2].removeAttribute('value');
  root.dispatchEvent(clickEvent(items[2]));
  assert.equal(selected[0]?.detail.value, 'Three', 'without a value attribute the label is the value');

  panel.showPopover();
  root.dispatchEvent(clickEvent(root));
  root.dispatchEvent(clickEvent(panel));
  assert.equal(selected.length, 1, 'a click that is not on an item selects nothing');
});

test('a click that lands on a child of an item still selects that item', () => {
  const { root, panel, items } = buildDropdown();
  const selected = listen(root, 'bn:select');
  panel.showPopover();

  const span = new StubHTMLElement('span');
  span.textContent = 'sub';
  items[0].append(span);

  root.dispatchEvent(clickEvent(span));

  assert.equal(selected.length, 1, 'delegation must reach through the item’s own children');
  assert.equal(selected[0].detail.item, items[0]);
});

/* --------------------------- focus is not stolen on light dismiss ------------------ */

test('a close that happened away from the menu leaves focus where the visitor put it', () => {
  const { root, panel } = buildDropdown();
  const outside = el('button');
  panel.showPopover();

  // What a click outside amounts to: something else owns the focus, then the popover closes.
  stubDocument.activeElement = outside;
  panel.hidePopover();

  assert.equal(stubDocument.activeElement, outside, 'the trigger must not steal the focus back');
  assert.equal(root._isOpen(), false);
});

test('tabbing out of the menu closes it, without pulling focus back', () => {
  const { root, panel, items } = buildDropdown();
  const closed = listen(root, 'bn:close');
  panel.showPopover();

  const outside = el('button');
  stubDocument.activeElement = outside;
  const leave = new StubCustomEvent('focusout', { bubbles: true });
  leave.relatedTarget = outside;
  root.dispatchEvent(leave);

  assert.equal(panel._showing, false, 'focus leaving the menu must not leave it floating');
  assert.equal(closed.length, 1);
  assert.equal(stubDocument.activeElement, outside, 'the visitor keeps moving forwards');

  // Moving between two items is not leaving, and a move to "nowhere" (the panel's own padding)
  // belongs to the platform's light dismiss rather than to this component.
  panel.showPopover();
  const inside = new StubCustomEvent('focusout', { bubbles: true });
  inside.relatedTarget = items[1];
  root.dispatchEvent(inside);
  const nowhere = new StubCustomEvent('focusout', { bubbles: true });
  nowhere.relatedTarget = null;
  root.dispatchEvent(nowhere);
  assert.equal(panel._showing, true, 'neither an item-to-item move nor a move to nowhere closes it');
});

/* ------------------------------ anchoring the popover ------------------------------ */

test('the element names its own anchor, uniquely, and removes it again on teardown', () => {
  const first = buildDropdown();
  const second = buildDropdown();

  const firstAnchor = first.trigger.styleDeclarations.get('anchor-name');
  const secondAnchor = second.trigger.styleDeclarations.get('anchor-name');
  assert.match(firstAnchor ?? '', /^--bn-dropdown-\d+$/, 'the trigger must carry an anchor name');
  assert.match(secondAnchor ?? '', /^--bn-dropdown-\d+$/, 'and so must the second dropdown');
  assert.notEqual(firstAnchor, secondAnchor, 'two dropdowns may never share one anchor');
  assert.equal(first.panel.styleDeclarations.get('position-anchor'), firstAnchor);

  first.root.disconnect();
  assert.equal(first.trigger.styleDeclarations.has('anchor-name'), false, 'teardown must clean up');
  assert.equal(first.panel.styleDeclarations.has('position-anchor'), false);
  assert.equal(second.trigger.styleDeclarations.get('anchor-name'), secondAnchor, 'the other one stays');
});

/* ------------------------------ the bundle's registration -------------------------- */

test('the package entry registers <bn-dropdown>', async () => {
  globalThis.window = globalThis;
  try {
    const entry = await import('../../src/js/index.js');
    assert.equal(globalThis.customElements.get('bn-dropdown'), BnDropdown, '<bn-dropdown> must be registered');
    assert.equal(typeof entry.default.register, 'function', 'and mounted through window.bn');
  } finally {
    delete globalThis.bn;
    delete globalThis.window;
  }
});
