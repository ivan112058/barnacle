/**
 * `toast()` — transient messages, and the library's one *stateless* capability, which is why it
 * is a plain module instead of a custom element (spec §9: "只用自定义元素封装有内部状态与生命周期的
 * 组件；无状态能力用普通模块").
 *
 * Why no `<bn-toast>` element: spec §9 and ADR-0002 reserve elements for components that observe
 * their own markup and have a lifecycle across reconnects. A toast has none of that. It is created
 * by a JavaScript call, it lives for a few seconds, and it has exactly one piece of state — the
 * timer that will remove it — which belongs to the caller's call, not to the element. Wrapping it
 * in an element would buy nothing and cost the custom-element name, the shadow-DOM question and an
 * upgrade path. The three entries below are the whole API:
 *
 *   toast(message, options)   show one, auto-dismiss after `duration` (default 5000 ms)
 *   toast.el(message, opts)   build and show one, but never take it away: no timer
 *   toast.clear()             close every live toast, and report how many
 *
 * Layering and pointer behaviour live in `src/css/toast.css`: the container is a fixed,
 * `pointer-events: none` column, and each toast turns pointer events back on for itself. A toast
 * that is waiting to disappear therefore never swallows a click meant for the page underneath.
 *
 * Timing is fully injectable — every ambient dependency is an option — so the tests drive the
 * auto-dismiss with a fake clock instead of sleeping. `getComputedStyle` is only used to learn how
 * long the *exit animation* takes: with `prefers-reduced-motion: reduce` no animation is declared,
 * the computed duration is `0s`, and the toast goes immediately (spec §7: the animation lives
 * inside a `no-preference` block, and CSS is never asked to encode a JS timing value).
 */

/** The default auto-dismiss, in milliseconds. Documented on the Toast page. */
export const DEFAULT_DURATION = 5000;

/** `"150ms"` / `"0.15s"` → milliseconds. Anything else is "no wait". */
function parseTime(value) {
  if (typeof value !== 'string') return 0;
  const first = value.split(',')[0].trim();
  const match = /^(-?[\d.]+)(ms|s)$/.exec(first);
  if (!match) return 0;
  const amount = Number(match[1]);
  return match[2] === 's' ? amount * 1000 : amount;
}

/**
 * Builds one `toast()` function. Called once by the bundle (see the singleton at the bottom) and
 * once per test with a stub document and a fake clock.
 *
 * @param {object} [environment]
 * @param {Document} [environment.document] where the container is created; lazily resolved from
 *   `globalThis` when omitted, so importing this module never touches a DOM.
 * @param {Window} [environment.window] the view `getComputedStyle` comes from.
 * @param {Function} [environment.setTimeout] the scheduler; injected so tests need no clock.
 * @param {Function} [environment.clearTimeout] its counterpart.
 * @returns {Function} `toast(message, options)` with `.el` and `.clear` on it.
 */
export function createToast(environment = {}) {
  /** Every toast this instance owns, in creation order, with its pending timers. */
  const live = new Map();
  let container = null;

  const documentOf = () => environment.document ?? globalThis.document;
  const viewOf = () => environment.window ?? globalThis.window;
  const schedule = (fn, ms) => (environment.setTimeout ?? globalThis.setTimeout)(fn, ms);
  const unschedule = (id) => (environment.clearTimeout ?? globalThis.clearTimeout)(id);

  /* ------------------------------------ the container ----------------------------------- */

  /**
   * One container for the whole page, created on first use and removed again once the last toast
   * is gone — an empty fixed box left in the DOM forever is exactly the kind of residue a library
   * should not leave behind. `aria-live="polite"` (not `role="status"`): the toast stack is a live
   * region, and `[role="status"]` is already the Spinner/Skeleton anchor (orchestrator decision 3C)
   * — a `<div role="status">` here would be dressed as a spinner by `spinner.css`.
   */
  function ensureContainer() {
    const document = documentOf();
    // A framework that re-renders <body> can detach the container; a detached one would swallow
    // every later toast silently, so it is replaced rather than reused.
    if (container && container.isConnected === false) container = null;
    if (container) return container;

    container = document.createElement('div');
    container.className = 'bn-toast-container';
    container.setAttribute('aria-live', 'polite');
    // `body` may not exist yet if a script runs during parsing; the root element always does.
    (document.body ?? document.documentElement).appendChild(container);
    return container;
  }

  /* ------------------------------------- one toast -------------------------------------- */

  function build(message, settings) {
    const element = documentOf().createElement('div');
    element.className = 'bn-toast';
    if (settings.variant) element.setAttribute('data-variant', String(settings.variant));

    // Strings become text, never markup: a toast message is content, and `innerHTML` here would
    // make every message a potential injection point.
    if (message && typeof message === 'object' && 'nodeType' in message) element.appendChild(message);
    else if (message !== undefined && message !== null) element.textContent = String(message);

    return element;
  }

  /** Appends a built toast to the container and takes ownership of it. */
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

    if (typeof element.remove === 'function') element.remove();
    else if (element.parentNode) element.parentNode.removeChild(element);

    if (live.size === 0 && container) {
      if (typeof container.remove === 'function') container.remove();
      else if (container.parentNode) container.parentNode.removeChild(container);
      container = null;
    }
    return true;
  }

  /**
   * The exit animation's length, read from the element that is about to be animated. Under
   * `prefers-reduced-motion: reduce` the rule is not declared at all, so this is `0` and the
   * element goes on the spot — "no animation" must never mean "waits anyway".
   */
  function exitDelay(element) {
    const view = viewOf();
    if (!view || typeof view.getComputedStyle !== 'function') return 0;
    const styles = view.getComputedStyle(element);
    return parseTime(styles ? styles.animationDuration : null);
  }

  /**
   * Closes one toast: cancel its auto-dismiss timer, mark it `[data-closing]` so CSS can play the
   * exit animation, and remove it when that animation is over. Returns `false` for a toast that is
   * unknown or already closing, which is what makes `clear()` idempotent.
   */
  function close(element) {
    const entry = live.get(element);
    if (!entry || entry.closing) return false;

    entry.closing = true;
    if (entry.timer !== null) {
      unschedule(entry.timer);
      entry.timer = null;
    }
    element.setAttribute('data-closing', '');

    const wait = exitDelay(element);
    if (wait > 0) entry.removal = schedule(() => detach(element), wait);
    else detach(element);

    return true;
  }

  /** `duration` is validated before anything is built, so a bad argument leaves no toast behind. */
  function readDuration(settings) {
    const duration = settings.duration ?? DEFAULT_DURATION;
    if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0) {
      throw new TypeError(
        `barnacle: toast duration must be a finite number of milliseconds (got ${String(duration)})`,
      );
    }
    return duration;
  }

  /* -------------------------------------- the API --------------------------------------- */

  /**
   * Builds and shows a toast, and hands it back. The caller may keep the reference, but the
   * lifetime stays with the timer this call armed.
   *
   * @param {string|number|Node} [message] text (inserted as text) or a node to append.
   * @param {{variant?: string, duration?: number}} [settings] `variant` becomes `data-variant`;
   *   `duration` is milliseconds to stay, `0` to stay until cleared.
   * @returns {Element} the toast element.
   */
  function toast(message, settings = {}) {
    const duration = readDuration(settings);
    const element = place(build(message, settings));
    if (duration > 0) live.get(element).timer = schedule(() => close(element), duration);
    return element;
  }

  /**
   * The manual mode: build the toast, show it, and never take it away. No timer is armed, so the
   * caller decides when it goes — `toast.clear()` still closes it, because this instance owns it.
   *
   * @param {string|number|Node} [message]
   * @param {{variant?: string}} [settings]
   * @returns {Element} the toast element.
   */
  toast.el = function el(message, settings = {}) {
    return place(build(message, settings));
  };

  /**
   * Closes every live toast, waiting for the exit animation of each. Idempotent by construction:
   * a toast that is already closing is left alone, so a second call is a no-op that reports `0`.
   *
   * @returns {number} how many toasts this call started closing.
   */
  toast.clear = function clear() {
    let closed = 0;
    // Snapshot first: `close()` may remove entries from `live` synchronously (no animation).
    for (const element of [...live.keys()]) {
      if (close(element)) closed += 1;
    }
    return closed;
  };

  return toast;
}

/** The page-wide instance the bundle mounts as `window.bn.toast` (spec §9). */
export const toast = createToast();
