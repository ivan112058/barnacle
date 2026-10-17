/**
 * `<bn-tabs>` — spec §8 (`含 JS` 4 之一, element `<bn-tabs>`), spec §9, ADR-0002 (shallow DOM).
 *
 * A tab set is an ARIA structure an author already knows how to write:
 *
 *   <bn-tabs>
 *     <div role="tablist" aria-label="Account">
 *       <button type="button" role="tab" aria-controls="panel-1" aria-selected="true">One</button>
 *       <button type="button" role="tab" aria-controls="panel-2">Two</button>
 *     </div>
 *     <div role="tabpanel" id="panel-1">…</div>
 *     <div role="tabpanel" id="panel-2">…</div>
 *   </bn-tabs>
 *
 * The element supplies only what ARIA cannot express: which tab is reachable by Tab
 * (roving tabindex), moving the selection with the arrows / Home / End, the `hidden`
 * bookkeeping on the panels, and the `aria-controls` / `aria-labelledby` pairs when the author
 * left the ids out. It never rewrites the author's markup into a different structure and never
 * touches `attachShadow` (ADR-0002) — it decorates the subtree that is already there.
 *
 * Two consequences worth stating, because they are the ticket's acceptance criteria:
 *
 *   1. **No script, no loss.** Hiding a panel is `init()`'s job, never the markup's, so a page
 *      whose script never runs shows every panel (spec §3 invariant 6). The stylesheet follows
 *      the same rule: it styles `[hidden]` and never hides a panel on its own.
 *   2. **The keyboard model is the base class's.** `events()` declares both listeners, `BnBase`
 *      binds them as `onClick` / `onKeydown`, `onKeydown` filters the navigation key family, and
 *      the arithmetic is `keydownIndex` from keys.js — a pure function that clamps at both ends
 *      and never wraps, which is what `role="tablist"` wants.
 *
 * Activation is automatic (the WAI-ARIA "follow focus" model): an arrow key moves focus and
 * selects in one step, so the tab a keyboard user is standing on is always the visible panel.
 */

import { BnBase } from './base.js';
import { keydownIndex } from './keys.js';

/** The three ARIA roles are the component's whole vocabulary; no other attribute is required. */
const TAB = '[role="tab"]';
const TABPANEL = '[role="tabpanel"]';

/** The page-unique id prefixes for the ids the component generates when an author omitted one. */
const TAB_ID = 'bn-tab-';
const PANEL_ID = 'bn-tabpanel-';

export class BnTabs extends BnBase {
  /* ---------------------------------- subclass contract --------------------------------- */

  events() {
    return ['click', 'keydown'];
  }

  /**
   * Wires the authored subtree up. Idempotent by construction: every step writes the state that
   * follows from the markup, so running it twice changes nothing. An element with no tabs is not
   * an error — it just has nothing to enhance.
   */
  init() {
    const tabs = this.tabs();
    if (tabs.length === 0) return;

    // The authored `hidden` values are the teardown target: `disconnectedCallback` has to put the
    // subtree back, and "back" is whatever the author wrote, not "all visible".
    this._authoredHidden = new Map(
      this.panels().map((panel) => [panel, panel.getAttribute('hidden')]),
    );

    this.link();

    const selected = tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true');
    this.activate(selected < 0 ? 0 : selected, { silent: true });
  }

  /** Undoes `init()`: the panels return to the state they were authored in. */
  teardown() {
    for (const [panel, hidden] of this._authoredHidden ?? []) {
      if (hidden === null) panel.removeAttribute('hidden');
      else panel.setAttribute('hidden', hidden);
    }
    this._authoredHidden = null;
    // Forgetting the active index is what lets a reconnect announce a switch again.
    this._active = undefined;
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
    const id = tab.getAttribute('aria-controls');
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
    const tabs = this.tabs();
    let current = node ?? null;
    while (current && current !== this) {
      if (tabs.includes(current)) return current;
      current = current.parentNode ?? null;
    }
    return null;
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

    const previous = this._active;
    const panels = this.panels();
    let activePanel = null;

    tabs.forEach((tab, position) => {
      const isSelected = position === active;
      tab.setAttribute('aria-selected', isSelected ? 'true' : 'false');

      const panel = this.panelFor(tab, position, panels);
      if (!panel) return;
      panel.hidden = !isSelected;
      if (isSelected) activePanel = panel;
    });

    this._active = active;
    if (focus) tabs[active].focus?.();

    // "Changing" tabs announces itself; re-selecting the current one does not. `init()` is
    // silent, so loading a page is not a switch either.
    if (!silent && previous !== active) {
      this.emit('bn:change', { index: active, tab: tabs[active], panel: activePanel });
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
      if (tab.getAttribute('aria-controls') !== panel.id) tab.setAttribute('aria-controls', panel.id);
      if (!panel.getAttribute('aria-labelledby')) panel.setAttribute('aria-labelledby', tab.id);
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
}
