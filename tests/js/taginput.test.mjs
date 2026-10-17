// Tests for ticket 21 — `<bn-taginput>`.
//
// Run with an explicit path, never bare `node --test`:
//
//   node --test tests/js/taginput.test.mjs
//
// Bare `node --test` walks the whole working directory and would also pick up the browser
// harness under tests/browser/ (ticket 08), which needs Chrome and is not a pure-Node test.
//
// `class BnTagInput extends HTMLElement` cannot be evaluated in bare Node, so the minimal DOM
// stub below is installed *before* a dynamic `import(...)` of the module under test — a static
// import would be hoisted above the globals. The stub implements only what `taginput.js`
// touches: a shallow tree (`append`, `insertBefore`, `removeChild`, `querySelectorAll`), the
// attribute bookkeeping (`class`/`value`/`disabled` reflect, as in the real DOM), text nodes,
// and `focus()` tracked on the stub document so `document.activeElement` is honest.
//
// The state machine is the point of this file: parsing an add, removing one tag, Backspace on
// an empty field, de-duplication, empty/whitespace values, trimming, the read/write API, the
// `bn:change` detail, and what a teardown leaves behind.

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

/** A text node: just enough for a chip's label and a button's glyph. */
class StubTextNode {
  constructor(text) {
    this.nodeType = 3;
    this.nodeValue = String(text);
    this.parentNode = null;
    this.childNodes = [];
  }
}

/** `"a.b[c=d]"` → a predicate over the stub element; only the selectors the component uses. */
function matcher(selector) {
  const compound = selector.match(/^([a-z][\w-]*)?((?:\.[\w-]+|\[[^\]]+\])*)$/);
  if (!compound) throw new Error(`stub: unsupported selector ${selector}`);
  const tag = compound[1] ?? null;
  const conditions = [];
  for (const [token] of compound[2].matchAll(/\.[\w-]+|\[[^\]]+\]/g)) {
    if (token.startsWith('.')) {
      const name = token.slice(1);
      conditions.push((node) => nameOf(node).includes(name));
    } else {
      const attribute = token.slice(1, -1).match(/^([\w-]+)(?:="([^"]*)")?$/);
      if (!attribute) throw new Error(`stub: unsupported attribute selector ${token}`);
      const [, key, expected] = attribute;
      conditions.push((node) =>
        expected === undefined ? node.hasAttribute(key) : node.getAttribute(key) === expected,
      );
    }
  }
  return (node) =>
    node.nodeType === 1 &&
    (tag === null || node.tagName === tag.toUpperCase()) &&
    conditions.every((condition) => condition(node));
}

/** The class names of a stub element, the way `className` would report them. */
function nameOf(node) {
  const value = node.getAttribute('class');
  return value === null ? [] : value.split(/\s+/).filter(Boolean);
}

class StubHTMLElement extends EventTarget {
  constructor(tag = 'div') {
    super();
    this.nodeType = 1;
    this.tagName = tag.toUpperCase();
    this._attributes = new Map();
    this.childNodes = [];
    this.parentNode = null;
    this.isConnected = false;
    this.focused = false;
  }

  /* ---- attributes (`class`, `value` and `disabled` reflect, as the real DOM does) ---- */

  setAttribute(name, value) {
    this._attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this._attributes.has(name) ? this._attributes.get(name) : null;
  }

  hasAttribute(name) {
    return this._attributes.has(name);
  }

  removeAttribute(name) {
    this._attributes.delete(name);
  }

  get className() {
    return this.getAttribute('class') ?? '';
  }

  set className(value) {
    this.setAttribute('class', value);
  }

  get value() {
    return this.getAttribute('value') ?? '';
  }

  set value(text) {
    this.setAttribute('value', String(text));
  }

  get disabled() {
    return this.hasAttribute('disabled');
  }

  set disabled(state) {
    if (state) this.setAttribute('disabled', '');
    else this.removeAttribute('disabled');
  }

  /* ---- the shallow tree ---- */

  get firstChild() {
    return this.childNodes[0] ?? null;
  }

  get textContent() {
    return this.childNodes.map((child) => child.textContent ?? child.nodeValue ?? '').join('');
  }

  set textContent(text) {
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes = [];
    this.append(new StubTextNode(text));
  }

  append(...nodes) {
    for (const node of nodes) {
      node.parentNode = this;
      this.childNodes.push(node);
    }
    return this;
  }

  insertBefore(node, reference) {
    const index = reference ? this.childNodes.indexOf(reference) : -1;
    node.parentNode = this;
    if (index < 0) this.childNodes.push(node);
    else this.childNodes.splice(index, 0, node);
    return node;
  }

  removeChild(node) {
    const index = this.childNodes.indexOf(node);
    if (index < 0) throw new Error('stub: removeChild of a node that is not a child');
    this.childNodes.splice(index, 1);
    node.parentNode = null;
    return node;
  }

  remove() {
    this.parentNode?.removeChild(this);
  }

  querySelectorAll(selector) {
    const matches = matcher(selector);
    const found = [];
    const visit = (node) => {
      for (const child of node.childNodes) {
        if (matches(child)) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  contains(node) {
    let current = node;
    while (current) {
      if (current === this) return true;
      current = current.parentNode;
    }
    return false;
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
    return ctor ? new ctor() : new StubHTMLElement(tag);
  },
  createTextNode(text) {
    return new StubTextNode(text);
  },
};

const { normaliseTags, BnTagInput } = await import('../../src/js/taginput.js');

/** The stub document is shared by every test in this file, so focus starts from scratch. */
test.beforeEach(() => {
  globalThis.document.activeElement = null;
});

/* ------------------------------------ fixtures ------------------------------------ */

/** One element, attributes first: the fixture builder writes markup the way an author would. */
function node(tag, attributes = {}) {
  const element = new StubHTMLElement(tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  return element;
}

/**
 * The canonical author markup: the element carries the initial list in its `value` attribute and
 * the entry field is the `<input>` the author wrote. `noInput` is the tolerant case — an element
 * with nothing to enhance.
 */
function createTagInput(options = {}) {
  const { value = null, inputValue = null, disabled = false, noInput = false } = options;
  const element = new BnTagInput();
  if (value !== null) element.setAttribute('value', value);
  if (disabled) element.setAttribute('disabled', '');
  if (noInput) return { element, input: null };

  const input = node('input', { type: 'text' });
  if (inputValue !== null) input.setAttribute('value', inputValue);
  element.append(input);
  return { element, input };
}

function connect(fixture) {
  fixture.element.connect();
  return fixture;
}

const chipsOf = (element) => element.querySelectorAll('.bn-tag');
const removeButtonsOf = (element) => element.querySelectorAll('.bn-taginput-remove');
const labelsOf = (element) => removeButtonsOf(element).map((button) => button.getAttribute('aria-label'));

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

/** The component's `input` listener reads the field, so a test types by writing it, then firing. */
function type(input, text) {
  input.value = text;
  return event('input', input);
}

/* ------------------------------- the tag-list state machine ------------------------------- */

test('normaliseTags trims, drops empty values and keeps the first spelling of a duplicate', () => {
  assert.deepEqual(
    normaliseTags([' Design ', 'design', '', '   ', 'Code']),
    ['Design', 'design', 'Code'],
    'a value is trimmed, an empty one disappears, and de-duplication is case-sensitive',
  );
  assert.deepEqual(normaliseTags('One, Two ,, One'), ['One', 'Two'], 'a comma-joined string is parsed');
  assert.deepEqual(normaliseTags([null, undefined, 42]), ['42'], 'null/undefined drop, other values coerce');
  assert.deepEqual(normaliseTags(null), [], 'no value is no tag');
});

test('init renders the authored value as one chip per tag, before the entry field', () => {
  const { element, input } = connect(createTagInput({ value: 'Design, code, Design' }));
  const chips = chipsOf(element);

  assert.equal(chips.length, 2, 'a duplicate in the authored list renders once');
  assert.deepEqual(element.tags(), ['Design', 'code']);
  assert.equal(element.childNodes.length, 3, 'chip, chip, field — in that order');
  assert.equal(element.childNodes[2], input, 'the entry field stays the last child');
  assert.equal(element.getAttribute('value'), 'Design, code', 'the attribute reports the normalised list');
  assert.deepEqual(labelsOf(element), ['Remove Design', 'Remove code'], 'each chip has a named remove button');
  assert.ok(chips[0].className.includes('bn-badge'), 'a chip reuses the badge visual (badge.css)');
  assert.equal(input.value, '', 'the entry field starts empty: the tags live in the chips');
});

/* ----------------------------------- adding a tag ----------------------------------- */

test('Enter commits what was typed, clears the field and announces one bn:change', () => {
  const { element, input } = connect(createTagInput());
  const seen = [];
  element.addEventListener('bn:change', (announced) => seen.push(announced));

  input.value = '  Design  ';
  const pressed = keyOn('Enter', input);
  element.dispatchEvent(pressed);

  assert.deepEqual(element.tags(), ['Design'], 'the typed value is trimmed and becomes a tag');
  assert.equal(input.value, '', 'the field is a draft box: committing empties it');
  assert.equal(labelsOf(element)[0], 'Remove Design');
  assert.equal(pressed.defaultPrevented, true, 'Enter belongs to the field while it holds text');

  assert.equal(seen.length, 1, 'one add, one event');
  const [announced] = seen;
  assert.equal(announced.type, 'bn:change');
  assert.equal(announced.bubbles, true, 'spec §9: bubbles must be true');
  assert.equal(announced.composed, true, 'spec §9: composed must be true');
  assert.deepEqual(Object.keys(announced.detail).sort(), ['added', 'removed', 'source', 'tags']);
  assert.deepEqual(announced.detail.tags, ['Design']);
  assert.deepEqual(announced.detail.added, ['Design']);
  assert.deepEqual(announced.detail.removed, []);
  assert.equal(announced.detail.source, 'input');
});

test('the comma commits too, and a pasted list splits on it while the unfinished tail stays', () => {
  const { element, input } = connect(createTagInput({ value: 'Design' }));

  input.value = 'Code';
  const comma = keyOn(',', input);
  element.dispatchEvent(comma);
  assert.equal(comma.defaultPrevented, true, 'the delimiter is never typed into the field');
  assert.deepEqual(element.tags(), ['Design', 'Code']);
  assert.equal(input.value, '');

  // A paste arrives as one `input` event with the whole list; everything complete becomes a tag
  // and only the part after the last comma is left in the field.
  element.dispatchEvent(type(input, 'One, Two, Three'));
  assert.deepEqual(element.tags(), ['Design', 'Code', 'One', 'Two']);
  assert.equal(input.value, 'Three', 'the unfinished tail is still being typed — it is not a tag yet');
  assert.equal(chipsOf(element).length, 4);

  element.dispatchEvent(keyOn('Enter', input));
  assert.deepEqual(element.tags(), ['Design', 'Code', 'One', 'Two', 'Three']);
  assert.equal(input.value, '');
});

test('an empty or whitespace-only value commits nothing and leaves the key to the browser', () => {
  const { element, input } = connect(createTagInput({ value: 'Design' }));
  const seen = [];
  element.addEventListener('bn:change', (announced) => seen.push(announced));

  for (const draft of ['', '   ']) {
    input.value = draft;
    const pressed = keyOn('Enter', input);
    element.dispatchEvent(pressed);
    assert.equal(pressed.defaultPrevented, false, 'Enter may still submit the form it sits in');
  }
  assert.deepEqual(element.tags(), ['Design']);
  assert.deepEqual(seen, [], 'no change, no event');
});

test('a duplicate typed twice lands once and announces nothing the second time', () => {
  const { element, input } = connect(createTagInput({ value: 'Design' }));
  const seen = [];
  element.addEventListener('bn:change', (announced) => seen.push(announced));

  input.value = 'design';
  element.dispatchEvent(keyOn('Enter', input));
  assert.deepEqual(element.tags(), ['Design', 'design'], 'de-duplication is case-sensitive by design');

  input.value = 'design';
  element.dispatchEvent(keyOn('Enter', input));
  assert.deepEqual(element.tags(), ['Design', 'design'], 'the same spelling twice is still one tag');
  assert.equal(seen.length, 1, 'only the add that changed something was announced');
  assert.equal(input.value, '', 'the field still empties: the draft was consumed, not stored');
});

/* --------------------------------- removing a tag --------------------------------- */

test("a click on a chip's remove button takes that tag and gives the field its focus back", () => {
  const { element, input } = connect(createTagInput({ value: 'Design, Code, UI' }));
  const seen = [];
  element.addEventListener('bn:change', (announced) => seen.push(announced.detail));

  element.dispatchEvent(clickOn(removeButtonsOf(element)[1]));

  assert.deepEqual(element.tags(), ['Design', 'UI'], 'the clicked chip is the one removed');
  assert.deepEqual(labelsOf(element), ['Remove Design', 'Remove UI']);
  assert.equal(document.activeElement, input, 'the caret returns to the field after a removal');
  assert.deepEqual(seen, [{ tags: ['Design', 'UI'], added: [], removed: ['Code'], source: 'remove' }]);
});

test("a click on a chip's label is inert — the chip is a label, not a control", () => {
  const { element } = connect(createTagInput({ value: 'Design, Code' }));
  const seen = [];
  element.addEventListener('bn:change', (announced) => seen.push(announced));

  element.dispatchEvent(clickOn(chipsOf(element)[0]));

  assert.deepEqual(element.tags(), ['Design', 'Code']);
  assert.deepEqual(seen, []);
});

test('Delete on a focused remove button takes the chip it belongs to', () => {
  const { element, input } = connect(createTagInput({ value: 'Design, Code' }));
  const [button] = removeButtonsOf(element);
  button.focus();

  const pressed = keyOn('Delete', button);
  element.dispatchEvent(pressed);

  assert.equal(pressed.defaultPrevented, true);
  assert.deepEqual(element.tags(), ['Code']);
  assert.equal(document.activeElement, input, 'the focused control is gone, so the field takes over');
});

test('Backspace on an empty field removes the last tag, one press per tag', () => {
  const { element, input } = connect(createTagInput({ value: 'a, b, c' }));
  const sources = [];
  element.addEventListener('bn:change', (announced) => sources.push(announced.detail.source));
  const press = () => {
    const pressed = keyOn('Backspace', input);
    element.dispatchEvent(pressed);
    return pressed;
  };

  press();
  assert.deepEqual(element.tags(), ['a', 'b'], 'the last tag goes first');
  press();
  assert.deepEqual(element.tags(), ['a']);
  press();
  assert.deepEqual(element.tags(), [], 'the field is empty again');
  assert.deepEqual(sources, ['backspace', 'backspace', 'backspace']);

  const extra = press();
  assert.equal(extra.defaultPrevented, false, 'nothing is left to take, so Backspace is the browser’s');
  assert.deepEqual(element.tags(), []);
  assert.equal(sources.length, 3, 'an empty field with no tags announces nothing');
});

test('Backspace while the field holds text leaves the caret — and the tags — alone', () => {
  const { element, input } = connect(createTagInput({ value: 'Design, Code' }));

  input.value = 'Desig';
  const pressed = keyOn('Backspace', input);
  element.dispatchEvent(pressed);

  assert.equal(pressed.defaultPrevented, false, 'the caret is the field’s business while there is text');
  assert.deepEqual(element.tags(), ['Design', 'Code']);
});

/* ------------------------------- reading and writing the set ------------------------------- */

test('writing a set and reading it back agree, after trimming, dropping empties and de-duplicating', () => {
  const { element } = connect(createTagInput());
  const seen = [];
  element.addEventListener('bn:change', (announced) => seen.push(announced.detail));

  const applied = element.setTags([' Design ', 'design', 'Design', '', '   ', 'Code']);

  assert.deepEqual(applied, ['Design', 'design', 'Code'], 'the call returns the set actually held');
  assert.deepEqual(element.tags(), applied, 'a read after the write agrees with it, item for item');
  assert.equal(chipsOf(element).length, 3, 'the DOM holds one chip per tag');
  assert.equal(element.getAttribute('value'), 'Design, design, Code', 'and the attribute agrees too');
  assert.deepEqual(seen, [{ tags: ['Design', 'design', 'Code'], added: ['Design', 'design', 'Code'], removed: [], source: 'api' }]);

  assert.deepEqual(element.setTags(' one , TWO ,, one '), ['one', 'TWO'], 'a comma-joined string is a set');
  assert.deepEqual(element.setTags([]), [], 'an empty set clears the field');
  assert.equal(chipsOf(element).length, 0);
  assert.equal(element.getAttribute('value'), '', 'the cleared set is reflected as an empty value');
});

test('writing the set the field already holds changes nothing and announces nothing', () => {
  const { element } = connect(createTagInput({ value: 'Design, Code' }));
  const before = chipsOf(element);
  const seen = [];
  element.addEventListener('bn:change', (announced) => seen.push(announced));

  assert.deepEqual(element.setTags(['Design', 'Code']), ['Design', 'Code']);
  assert.deepEqual(seen, [], 'an idempotent write is silent');
  assert.equal(chipsOf(element)[0], before[0], 'and it does not re-render: the same chip nodes survive');

  // The same holds for the single-tag helpers and for clearing an empty field.
  assert.deepEqual(element.addTag('Design'), ['Design', 'Code'], 'a duplicate is not added again');
  assert.deepEqual(element.addTag('   '), ['Design', 'Code'], 'whitespace is not a tag');
  assert.deepEqual(element.removeTagAt(9), ['Design', 'Code'], 'an out-of-range index is a no-op');
  assert.deepEqual(element.removeTagAt(-1), ['Design', 'Code'], 'and so is a negative one');
  assert.deepEqual(seen, []);
});

test('addTag, removeTagAt and clearTags write through the same path and report their source', () => {
  const { element, input } = connect(createTagInput({ value: 'Design' }));
  const seen = [];
  element.addEventListener('bn:change', (announced) => seen.push(announced.detail));

  element.addTag('Code');
  assert.deepEqual(element.tags(), ['Design', 'Code']);
  assert.deepEqual(seen.at(-1), { tags: ['Design', 'Code'], added: ['Code'], removed: [], source: 'api' });

  element.removeTagAt(0);
  assert.deepEqual(element.tags(), ['Code']);
  assert.deepEqual(seen.at(-1), { tags: ['Code'], added: [], removed: ['Design'], source: 'api' });
  assert.equal(document.activeElement, null, 'a programmatic removal does not move the caret');

  element.clearTags();
  assert.deepEqual(element.tags(), []);
  assert.deepEqual(seen.at(-1), { tags: [], added: [], removed: ['Code'], source: 'api' });
  assert.equal(chipsOf(element).length, 0);
  assert.equal(input.value, '', 'the field is untouched by API writes: it only holds a draft');
});

test('tags() hands back a copy, so a caller cannot mutate the state machine', () => {
  const { element } = connect(createTagInput({ value: 'Design, Code' }));

  const read = element.tags();
  read.push('Injected');
  read[0] = 'Changed';

  assert.deepEqual(element.tags(), ['Design', 'Code']);
  assert.equal(chipsOf(element).length, 2);
});

test('the entry field can seed the list too, so the page reads without a script', () => {
  // Without the element attribute, the list is taken from the field's own value — the one place a
  // no-script reader can still see and edit it.
  const { element, input } = connect(createTagInput({ inputValue: 'Design, Code' }));

  assert.deepEqual(element.tags(), ['Design', 'Code']);
  assert.equal(element.getAttribute('value'), 'Design, Code');
  assert.equal(input.value, '', 'with a script, the same list is chips and the field is empty');

  element.disconnect();
  assert.equal(input.value, 'Design, Code', 'teardown gives the field its authored text back');
  assert.equal(chipsOf(element).length, 0, 'and leaves no generated node behind');
});

/* ------------------------------- moving between field and chips ------------------------------- */

test('ArrowLeft on an empty field steps back into the chips, and ArrowRight returns to the field', () => {
  const { element, input } = connect(createTagInput({ value: 'a, b, c' }));
  const buttons = removeButtonsOf(element);

  const left = keyOn('ArrowLeft', input);
  element.dispatchEvent(left);
  assert.equal(left.defaultPrevented, true);
  assert.equal(document.activeElement, buttons[2], 'the caret walks into the last chip');

  const right = keyOn('ArrowRight', buttons[2]);
  element.dispatchEvent(right);
  assert.equal(right.defaultPrevented, true);
  assert.equal(document.activeElement, input, 'and back out of it into the field');
});

test('the arrows and Home/End walk the remove buttons and clamp at both ends', () => {
  const { element } = connect(createTagInput({ value: 'a, b, c' }));
  const buttons = removeButtonsOf(element);

  buttons[0].focus();
  element.dispatchEvent(keyOn('ArrowRight', buttons[0]));
  assert.equal(document.activeElement, buttons[1]);
  element.dispatchEvent(keyOn('End', buttons[1]));
  assert.equal(document.activeElement, buttons[2]);
  element.dispatchEvent(keyOn('Home', buttons[2]));
  assert.equal(document.activeElement, buttons[0], 'Home jumps to the first chip');
  element.dispatchEvent(keyOn('ArrowLeft', buttons[0]));
  assert.equal(document.activeElement, buttons[0], 'the left end is the end of the road');
});

test('ArrowLeft in a field that holds text is the caret’s business, not the chips’', () => {
  const { element, input } = connect(createTagInput({ value: 'a, b' }));

  input.value = 'draft';
  const left = keyOn('ArrowLeft', input);
  element.dispatchEvent(left);

  assert.equal(left.defaultPrevented, false, 'a text field needs its caret keys');
  assert.equal(document.activeElement, null);
});

/* ------------------------------------ the lifecycle ---------------------------------------- */

test('an element with no entry field is a quiet no-op', () => {
  const { element } = connect(createTagInput({ value: 'a, b', noInput: true }));

  assert.equal(element._initialised, true, 'the element still initialises — it just has no work');
  assert.equal(element._input, null);
  assert.equal(element.querySelectorAll('.bn-tag').length, 0, 'and it creates nothing');

  assert.deepEqual(element.setTags(['x']), ['x'], 'the API still holds a set, it simply has no view');
  element.disconnect();
});

test('teardown removes the generated chips and the listeners, and a reconnect repaints the tags', () => {
  const { element, input } = connect(createTagInput({ value: 'Design, Code' }));
  assert.equal(chipsOf(element).length, 2);
  assert.deepEqual([...element._listeners.keys()].sort(), ['click', 'input', 'keydown']);

  element.disconnect();
  assert.equal(chipsOf(element).length, 0, 'no residue: the chips this element made are gone');
  assert.equal(element._listeners.size, 0, 'and every listener is unbound');
  assert.equal(input.parentNode, element, 'the author’s field is still there');

  element.connect();
  assert.deepEqual(element.tags(), ['Design', 'Code'], 'the state survives the round trip');
  assert.deepEqual(labelsOf(element), ['Remove Design', 'Remove Code']);
  assert.equal(element._listeners.get('click').length, 1, 'a second connect must not double-bind');
});

test('a disabled element disables the field and every remove button, and can be switched back', () => {
  const { element, input } = connect(createTagInput({ value: 'Design', disabled: true }));

  assert.equal(input.disabled, true, 'a disabled tag field cannot be typed into');
  removeButtonsOf(element).forEach((button) => assert.equal(button.disabled, true));

  element.removeAttribute('disabled');
  element.attributeChangedCallback('disabled', '', null);
  assert.equal(input.disabled, false);
  removeButtonsOf(element).forEach((button) => assert.equal(button.disabled, false));

  element.setAttribute('disabled', '');
  element.attributeChangedCallback('disabled', null, '');
  assert.equal(input.disabled, true);
  removeButtonsOf(element).forEach((button) => assert.equal(button.disabled, true));
  assert.deepEqual(element.tags(), ['Design'], 'disabling never destroys the tags');
});

/* --------------------------------- the package entry point -------------------------------- */

test('the package entry registers <bn-taginput>', async () => {
  globalThis.window = globalThis;
  try {
    await import('../../src/js/index.js');

    assert.equal(customElements.get('bn-taginput'), BnTagInput, 'bn-taginput must be defined by the entry');
    assert.ok(document.createElement('bn-taginput') instanceof BnTagInput);
  } finally {
    delete globalThis.window;
  }
});
