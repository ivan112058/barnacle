/**
 * `<bn-dropdown>` — the menu, on the native popover API (spec §8 "Dropdown", §9 `dropdown.js`,
 * ADR-0002 shallow DOM).
 *
 * The element is an *enhancement*, not a component that builds itself. The author writes the
 * trigger and the panel; this file only adds the behaviour the platform does not have:
 *
 *   <bn-dropdown>
 *     <button popovertarget="menu-1" aria-expanded="false">Menu</button>
 *     <menu popover id="menu-1">
 *       <li><button class="bn-dropdown-item" value="rename">Rename</button></li>
 *     </menu>
 *   </bn-dropdown>
 *
 * Nothing is created, nothing is moved, nothing is hidden behind a shadow root: `[popover]` stays
 * a child of `<bn-dropdown>` while it is open (it is in the top layer, not out of the tree), which
 * is what lets `dropdown.css` reach it with a descendant selector.
 *
 * What the platform already does, and therefore what this file does *not* do:
 *
 *   - opening and closing on the trigger (`popovertarget` + `showPopover()`), including Escape and
 *     light dismiss on a click outside — measured in Chrome 155 in ticket 19's Answer;
 *   - `[popover]` is `display: none` while closed, so a closed menu has no tab stops.
 *
 * What it adds:
 *
 *   - **Keyboard navigation.** The arrow/Home/End family moves through `.bn-dropdown-item` with a
 *     roving tabindex (`BnBase.focusOnly`), wrapping at the ends, and always keeps exactly one item
 *     in the tab order. The arithmetic is `keydownIndex()` from `keys.js`; this file does no
 *     counting of its own. Escape is handled here rather than in `BnBase.onKeydown`, which owns the
 *     navigation keys only.
 *   - **Focus management.** The browser does not move focus into a popover it opened, so the first
 *     item is focused on open and, when the close was ours (Escape, picking an item), focus goes
 *     back to the trigger. A close that happened away from the menu (clicking outside) leaves focus
 *     where the visitor put it. Tab moves out of the last item to the next control and the menu
 *     closes with it, instead of being left floating.
 *   - **`aria-expanded`** on the trigger, which the native invoker never updates.
 *   - **Anchoring.** `position-area` places the panel under the trigger, but only while the popover
 *     knows its anchor. A click on the trigger gives it one implicitly; `showPopover()` from script
 *     does not (measured: the panel lands at the viewport origin). So the element names its own
 *     anchor from `uid()` — one unique name per instance — and the CSS degrades to the implicit
 *     anchor when the script never runs.
 *   - **Events** (spec §9: always `CustomEvent`, always `bubbles: true, composed: true`):
 *     `bn:open` / `bn:close` with `{ trigger, panel }`, and `bn:select` with `{ value, item }`.
 *     They are announced from the panel's `toggle` event, so every path — the trigger, Escape,
 *     light dismiss, a picked item — produces exactly one matching pair.
 *
 * When the markup is not there (no `[popovertarget]`, an id that resolves to nothing, a target that
 * is not a `[popover]`, or a browser without the API) `init()` returns without a word: no throw and
 * no console output (spec §9, ticket 19). Nothing is repaired and nothing is invented.
 */

import { BnBase } from './base.js';
import { keydownIndex } from './keys.js';

/** The three nodes the contract is written in terms of. Selectors stay compound and stable. */
const TRIGGER_SELECTOR = '[popovertarget]';
const PANEL_SELECTOR = '[popover]';
const ITEM_SELECTOR = '.bn-dropdown-item';

/** Anchor positioning shipped as one feature; if the browser cannot name an anchor it cannot
 *  resolve one either, and the panel would land at the viewport origin instead of the trigger. */
function supportsAnchorPositioning() {
  return typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('anchor-name: --bn-x');
}

export class BnDropdown extends BnBase {
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

    const target = trigger.getAttribute('popovertarget');
    const panel = target ? document.getElementById(target) : null;
    if (!panel || !panel.hasAttribute('popover')) return;
    // Feature detection, not a version check: without the API there is no behaviour to add, and the
    // trigger keeps whatever the platform does with the attribute (nothing, on old engines).
    if (typeof panel.showPopover !== 'function' || typeof panel.hidePopover !== 'function') return;

    this._trigger = trigger;
    this._panel = panel;
    this._activeIndex = -1;
    this._open = false;
    this._wantsFocusReturn = false;
    this._authorExpanded = trigger.getAttribute('aria-expanded');

    // The panel's own event. `toggle` neither bubbles nor composes (measured), so it cannot be
    // reached through the `events()` convention — and `this.a()` binds on this element only.
    this._onToggleListener = (event) => this._onPanelToggle(event);
    panel.addEventListener('toggle', this._onToggleListener);

    this._setAnchor();
  }

  /** Undoes `init()`, including what was written into the author's markup. */
  teardown() {
    if (this._panel && this._onToggleListener) {
      this._panel.removeEventListener('toggle', this._onToggleListener);
    }
    if (this._trigger) {
      if (this._authorExpanded === null) this._trigger.removeAttribute('aria-expanded');
      else this._trigger.setAttribute('aria-expanded', this._authorExpanded);
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
    return ['click', 'focusout', 'keydown'];
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
      if (typeof panel.matches === 'function') return panel.matches(':popover-open');
    } catch {
      /* fall through to the bookkeeping below */
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
    const open = event.newState === 'open';
    this._open = open;
    this._setExpanded(open);

    if (open) {
      // The platform does not move focus into a popover it opened, so a menu opened by any means
      // arrives with the first item ready to be walked.
      this._activate(0);
      this.emit('bn:open', { trigger: this._trigger, panel: this._panel });
      return;
    }

    if (this._wantsFocusReturn || this._panel?.contains?.(document.activeElement)) {
      this._trigger?.focus?.();
    }
    this._wantsFocusReturn = false;
    this.emit('bn:close', { trigger: this._trigger, panel: this._panel });
  }

  _setExpanded(open) {
    this._trigger?.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  /* ------------------------------------ anchoring --------------------------------- */

  /**
   * Names this instance's anchor so the CSS can resolve `position-area` however the popover was
   * opened. `uid()` is what keeps two dropdowns on one page from stealing each other's anchor.
   */
  _setAnchor() {
    if (!supportsAnchorPositioning() || !this._trigger?.style || !this._panel?.style) return;
    this._anchorName = this.uid('--bn-dropdown-');
    this._trigger.style.setProperty('anchor-name', this._anchorName);
    this._panel.style.setProperty('position-anchor', this._anchorName);
  }

  _clearAnchor() {
    if (!this._anchorName) return;
    this._trigger?.style?.removeProperty('anchor-name');
    this._panel?.style?.removeProperty('position-anchor');
    this._anchorName = null;
  }

  /* ---------------------------------- the keyboard -------------------------------- */

  /**
   * Escape first — `BnBase.onKeydown` owns the arrow/Home/End family, and Escape is not one of
   * them. Cancelling the keydown also cancels the platform's own close request, so the menu closes
   * once, through `_close()`, with the focus return that goes with it.
   */
  onKeydown(event) {
    if (event.key === 'Escape' && this._isOpen()) {
      this._close();
      if (typeof event.preventDefault === 'function') event.preventDefault();
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

    const current =
      Number.isInteger(this._activeIndex) && items[this._activeIndex]
        ? this._activeIndex
        : this.activeIndex(items, document.activeElement);
    // Nothing is active (a menu whose first item was never focused): any navigation key enters it.
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
    if (!item) return undefined;

    this.emit('bn:select', { value: this._valueOf(item), item });
    this._close();
    return item;
  }

  /** Tab out of the last item (or back past the first) closes the menu instead of leaving it
   *  floating. A move to nothing in particular — the panel's own padding, a click on a
   *  non-focusable area — is left to the platform's light dismiss. */
  onFocusout(event) {
    if (!this._isOpen()) return undefined;

    const next = event.relatedTarget;
    if (!next || next === document.body || this._panel.contains(next)) return undefined;

    this._close(false);
    return undefined;
  }

  /** The item a click landed in, reached through its own children (`delegation`). */
  _itemFrom(node) {
    if (!node || typeof node.closest !== 'function') return null;
    const item = node.closest(ITEM_SELECTOR);
    if (!item) return null;
    return this.items().includes(item) ? item : null;
  }

  /** The author's `value` when there is one, otherwise the label as written. */
  _valueOf(item) {
    const value = item.getAttribute('value');
    if (value !== null) return value;
    return (item.textContent ?? '').trim();
  }
}
