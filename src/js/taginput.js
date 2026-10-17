/**
 * `<bn-taginput>` — the one component in the library with real internal state (spec §8, §9).
 *
 * The author writes a field and, optionally, the list it starts with:
 *
 *   <bn-taginput value="Design, Code">
 *     <input type="text" placeholder="Add a tag…">
 *   </bn-taginput>
 *
 * The element decorates that subtree in the main document (ADR-0002, shallow DOM): it inserts one
 * chip per tag *before* the authored input and never replaces, clones or hides the field. With no
 * script the input is still an input — readable and typeable — and the stylesheet still draws the
 * field box; what is lost is only the chip behaviour (spec §3 invariant 6).
 *
 * The tag list is the state machine, and it lives in exactly one place: `_tags`, an ordered array
 * of strings. Everything else is a view of it —
 *
 *   - the chips in the DOM (`_render()` derives them from `_tags`; nothing reads state back out
 *     of the DOM, so a chip's glyph can never be mistaken for a tag),
 *   - the `value` attribute (normalised after every change, so `getAttribute('value')` and
 *     `tags()` always agree),
 *   - the `bn:change` event (`{ tags, added, removed, source }`).
 *
 * The rules of that state machine, written once here and documented on the TagInput page:
 *
 *   - **trim**: every tag is trimmed; `"  Design  "` becomes `"Design"`.
 *   - **empty**: an empty or whitespace-only value is not a tag and is silently dropped.
 *   - **de-duplicate, case-sensitively**: `Design` and `design` are two tags, `Design` twice is
 *     one. Exact equality is the comparison, so an identifier, a file name or a case-sensitive
 *     token survives the round trip unchanged.
 *   - **the comma is the delimiter**, wherever it appears: typing it, pasting a list, or passing
 *     a comma-joined string all mean "add these".
 *
 * Two keyboard behaviours make the field usable without a mouse: `Enter` and `,` commit what has
 * been typed, and `Backspace` on an empty field removes the last tag. Both are component keys, so
 * they are handled in `onKeydown` next to (not inside) the base class's navigation family; the
 * arrows / Home / End arithmetic is `keydownIndex` from keys.js, the same pure function the tabs
 * and the dropdown use.
 *
 * A field that the author did not provide is not an error: `init()` returns without a word, no
 * chip is created and no listener is bound (spec §9: an element that cannot enhance is quiet).
 */

import { BnBase } from './base.js';
import { keydownIndex } from './keys.js';

/** The delimiter that turns typed text into tags. Documented on the page and in the tests. */
export const TAG_DELIMITER = ',';

/** The class a generated chip carries: `.bn-badge` for the visual, `.bn-tag` for identification. */
const TAG_CLASS = 'bn-tag';

/** The class on a chip's remove button, so a click inside a chip is not a click on the chip. */
const REMOVE_CLASS = 'bn-taginput-remove';

/** The class `badge.css` dresses. A chip is a badge, so the visual is not restated here. */
const BADGE_CLASS = 'bn-badge';

/**
 * `true` while an input method (a Chinese/Japanese/Korean candidate list, a phone keyboard's
 * suggestion strip) owns the keyboard. `isComposing` is the standard flag on both `keydown` and
 * `input`; `keyCode === 229` is the older signal that some engines deliver for a key the IME
 * swallowed, and it arrives even for events whose `isComposing` never became true.
 *
 * The component must stay out of the way for exactly as long as this is true: keys belong to the
 * candidate list, and the field's value is a draft of a word, not a draft of a tag.
 *
 * @param {KeyboardEvent|InputEvent} event
 * @returns {boolean}
 */
function isComposing(event) {
  return event?.isComposing === true || event?.keyCode === 229;
}

/**
 * Parses anything the author or the caller can hand us into the canonical tag list:
 * trimmed, empties dropped, duplicates dropped (case-sensitively), order preserved.
 *
 * Accepted inputs, all of which mean the same thing: `"a, b"`, `["a", "b"]`, a mix of the two,
 * `null`/`undefined` (no tags), and non-strings (coerced with `String`). A member that itself
 * contains the delimiter is split, so `["a,b"]` and `"a,b"` agree.
 *
 * @param {unknown} value
 * @returns {string[]} a new array; the caller's array is never mutated or retained.
 */
export function normaliseTags(value) {
  const list = value == null ? [] : Array.isArray(value) ? value : [value];
  const seen = new Set();
  const tags = [];
  for (const item of list) {
    const text = item == null ? '' : String(item);
    for (const part of text.split(TAG_DELIMITER)) {
      const tag = part.trim();
      if (tag === '' || seen.has(tag)) continue;
      seen.add(tag);
      tags.push(tag);
    }
  }
  return tags;
}

export class BnTagInput extends BnBase {
  /* ------------------------------------ state ------------------------------------ */

  /** The tags, in order. The single source of truth; `null` until `init()` reads the markup. */
  _tags = null;

  /** `true` once the authored list has been read, so a reconnect never re-reads stale markup. */
  _tagsRead = false;

  /** The authored entry field, or `null` while the element is not enhanced. */
  _input = null;

  /** The input's authored `value`, restored on teardown. */
  _authoredInputValue = '';

  /** Whether the author had disabled the input themselves, so teardown can tell it apart. */
  _authoredInputDisabled = false;

  /* ---------------------------------- subclass contract --------------------------------- */

  /** `disabled` is the one attribute the element observes: the field and the chips follow it. */
  static get observedAttributes() {
    return ['disabled'];
  }

  /** A `disabled` toggled from script reaches the field and every chip's button. */
  attributeChangedCallback() {
    this._applyDisabled();
  }

  /** `click` removes a chip, `keydown` owns the field keys, `input` parses a pasted list. */
  events() {
    return ['click', 'keydown', 'input'];
  }

  /**
   * Enhances the authored subtree, or returns quietly when there is nothing to enhance. Idempotent:
   * every step writes what follows from `_tags`, so a second run changes nothing.
   */
  init() {
    const input = this.querySelector('input');
    if (!input) return;

    this._input = input;
    this._authoredInputDisabled = input.hasAttribute('disabled');
    this._authoredInputValue = input.getAttribute('value') ?? '';

    if (!this._tagsRead) {
      // Two places may carry the initial list, and the element's own attribute wins: a page with
      // no script reads the one written on the input, a page with one gets the same list as chips.
      const authored = this.getAttribute('value');
      this._tags = normaliseTags(authored ?? input.value);
      this._tagsRead = true;
    }

    this._render();
    this._applyDisabled();
    // The tags are chips now, so the field is a draft box again.
    this._input.value = '';
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
      if (this._authoredInputDisabled) this._input.setAttribute('disabled', '');
      else this._input.removeAttribute('disabled');
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
    return [...(this._tags ?? [])];
  }

  /**
   * Replaces the whole tag set. Idempotent: writing the set the component already holds changes
   * nothing, renders nothing and announces nothing.
   *
   * @param {string[]|string} value the new set; a comma-joined string is accepted too.
   * @returns {string[]} the set actually held afterwards.
   */
  setTags(value) {
    return this._commit(normaliseTags(value), 'api');
  }

  /**
   * Appends one value (or a comma-joined list). A duplicate, an empty value or pure whitespace is
   * ignored, so calling it twice with the same text is the same as calling it once.
   *
   * @param {unknown} value
   * @returns {string[]} the set actually held afterwards.
   */
  addTag(value) {
    return this._commit(normaliseTags([...(this._tags ?? []), value]), 'api');
  }

  /**
   * Removes the tag at `index` (0-based). An out-of-range index is a quiet no-op.
   *
   * @param {number} index
   * @returns {string[]} the set actually held afterwards.
   */
  removeTagAt(index) {
    if (!Number.isInteger(index) || index < 0 || index >= (this._tags?.length ?? 0)) return this.tags();
    return this._commit(this._tags.filter((_, position) => position !== index), 'api');
  }

  /** Empties the tag set. Writing an empty set is a no-op when it is already empty. */
  clearTags() {
    return this._commit([], 'api');
  }

  /* ------------------------------------ the chips --------------------------------------- */

  /** Every chip this element manages, in document order. */
  chips() {
    return [...this.querySelectorAll(`.${TAG_CLASS}`)];
  }

  /** The remove buttons of those chips, in the same order. */
  removeButtons() {
    return this.chips()
      .map((chip) => chip.querySelector(`.${REMOVE_CLASS}`))
      .filter(Boolean);
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
    const chip = globalThis.document.createElement('span');
    chip.className = `${BADGE_CLASS} ${TAG_CLASS}`;
    chip.setAttribute('data-variant', 'secondary');

    const label = globalThis.document.createTextNode(tag);

    const remove = globalThis.document.createElement('button');
    remove.setAttribute('type', 'button');
    remove.className = REMOVE_CLASS;
    remove.setAttribute('aria-label', `Remove ${tag}`);
    remove.textContent = '\u00d7';
    // A chip created while the field is disabled is born disabled: `_applyDisabled()` only walks
    // the chips that exist when it runs.
    if (this.hasAttribute('disabled')) remove.setAttribute('disabled', '');

    chip.append(label, remove);
    const parent = this._input.parentNode ?? this;
    parent.insertBefore(chip, this._input);
    return chip;
  }

  /** Publishes the current list into the `value` attribute, so it is inspectable from markup. */
  _reflect() {
    this.setAttribute('value', (this._tags ?? []).join(', '));
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
    // An input method owns the keyboard while its candidate list is open. `Enter` there accepts
    // the candidate and would otherwise commit half a word as a tag, and a comma typed inside a
    // composition is text, not the delimiter. `isComposing` is the standard signal; `keyCode 229`
    // is what some engines still deliver for the keys pressed while composing.
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

    // A focused remove button: Delete or Backspace takes the chip it belongs to. Enter and Space
    // are the button's own click, which `onClick` already handles.
    const button = this._removeButtonFrom(target);
    if (button) {
      if (key !== 'Delete' && key !== 'Backspace') return false;
      const index = this.removeButtons().indexOf(button);
      if (index < 0) return false;
      if (typeof event.preventDefault === 'function') event.preventDefault();
      this._removeAt(index, 'remove');
      return true;
    }

    if (target !== input) return false;

    if (key === 'Enter') {
      // An empty field keeps Enter's native meaning (submitting the form it sits in).
      if (input.value.trim() === '') return false;
      if (typeof event.preventDefault === 'function') event.preventDefault();
      this._commitField();
      return true;
    }

    if (key === TAG_DELIMITER) {
      // The comma is a delimiter, never a character in a tag, so it never reaches the field.
      if (typeof event.preventDefault === 'function') event.preventDefault();
      this._commitField();
      return true;
    }

    if (key === 'Backspace' && input.value === '') {
      if ((this._tags?.length ?? 0) === 0) return false;
      if (typeof event.preventDefault === 'function') event.preventDefault();
      this._removeAt(this._tags.length - 1, 'backspace');
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
      if (key === 'ArrowRight' && index === buttons.length - 1) {
        input.focus();
        return true;
      }
      const next = keydownIndex(key, index, buttons.length);
      if (next < 0 || next === index) return false;
      buttons[next].focus();
      return true;
    }

    if (target === input) {
      if (key !== 'ArrowLeft' || input.value !== '') return false;
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
      if (index >= 0) this._removeAt(index, 'remove');
      return;
    }

    const input = this._input;
    if (!input || this.hasAttribute('disabled')) return;
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
    // The intermediate `input` events of a composition carry candidate text, not typed text: the
    // delimiter in `"中, 文"` is part of the word being composed. The final event (fired after
    // `compositionend`, with `isComposing` false) is the one that commits.
    if (isComposing(event)) return;
    if (!input.value.includes(TAG_DELIMITER)) return;

    const parts = input.value.split(TAG_DELIMITER);
    const pending = parts.pop() ?? '';
    input.value = pending.trim();
    this._commit(normaliseTags([...(this._tags ?? []), ...parts]), 'input');
  }

  /** Empties the field into the tag list: the draft is consumed, never kept. */
  _commitField() {
    const input = this._input;
    if (!input) return;
    const text = input.value;
    input.value = '';
    this._commit(normaliseTags([...(this._tags ?? []), text]), 'input');
  }

  /** The remove button a node belongs to, or `null`. The chip's label is not one. */
  _removeButtonFrom(node) {
    let current = node ?? null;
    while (current && current !== this) {
      if (current.nodeType === 1 && String(current.className ?? '').split(/\s+/).includes(REMOVE_CLASS)) {
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
    // A removal the visitor asked for leaves the caret in the field, ready for the next tag. A
    // programmatic removal (`removeTagAt`) leaves focus wherever the caller put it.
    if (source !== 'api' && !this.hasAttribute('disabled')) this._input?.focus();
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
    this.emit('bn:change', { tags: [...next], added, removed, source });
    return this.tags();
  }

  /** The chips are buttons too: a disabled field disables every control inside it. */
  _applyDisabled() {
    const disabled = this.hasAttribute('disabled');
    if (this._input) {
      if (disabled) this._input.setAttribute('disabled', '');
      else if (!this._authoredInputDisabled) this._input.removeAttribute('disabled');
    }
    for (const button of this.removeButtons()) {
      if (disabled) button.setAttribute('disabled', '');
      else button.removeAttribute('disabled');
    }
  }
}
