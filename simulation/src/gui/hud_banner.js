/**
 * hud_banner.js — the one recipe for a persistent, DISMISSABLE HUD alert banner.
 *
 * Every persistent warning the sim floats over the 3D view (wrong GPU, multi-
 * client contention, BENCH MIRROR armed, engine blackout, patch/universe faults)
 * must be hideable by the operator (operator ruling 2026-09-14): a warning that
 * cannot be put away stops being a warning and becomes furniture. Two hide paths
 * exist, and this module owns the first:
 *
 *   1. the banner's own ✕ — dismisses THIS OCCURRENCE. The banner stays hidden
 *      while its condition persists (status re-pushes, the 10 s patch poll and
 *      re-renders must never resurrect it) and re-arms only when the condition
 *      clears and later returns, or when the occurrence changes (a different
 *      adapter, a different set of missing universes) — that is new information.
 *   2. the global `H` key (panel_visibility.js) — `hide_all` hides every banner
 *      and toast through a body class.
 *
 * Nothing here decides WHEN to warn — each banner keeps its own pure state
 * function — and dismissing never changes what the sim does (no blackout clear,
 * no disarm, no re-patch): it hides the words, not the condition. The banner
 * element stays `pointer-events:none` (it warns, it never blocks the UI); only
 * the ✕ takes the pointer.
 *
 * The dismissal latch is pure so Node unit tests cover it without a DOM
 * (`hud_banner.test.js`); the DOM factory is proved live (report `20260914_372`).
 */

/** Occurrence key used when a banner's state does not name one. */
export const DEFAULT_OCCURRENCE_KEY = 'default';

/** Class of every banner ✕ — styled once in style.css (`.hud-banner-close`). */
export const HUD_BANNER_CLOSE_CLASS = 'hud-banner-close';

/**
 * The occurrence a banner state describes. `state.key` (string/number) names
 * it; absent → DEFAULT_OCCURRENCE_KEY (the condition itself is the occurrence).
 * @param {{show: boolean, key?: string|number}|null|undefined} state
 * @returns {string}
 */
export function occurrenceKey(state) {
  if (!state || state.key === undefined || state.key === null) return DEFAULT_OCCURRENCE_KEY;
  return String(state.key);
}

/**
 * Pure dismissal reducer.
 * @param {{show: boolean, key?: string|number}|null|undefined} state — what the
 *        banner WANTS to do right now (its pure state function's output).
 * @param {string|null|undefined} dismissedKey — the occurrence the operator
 *        dismissed, or null.
 * @returns {{visible: boolean, dismissedKey: string|null}} what to render, and
 *          the latch to carry into the next call.
 */
export function reduceDismissal(state, dismissedKey) {
  // Condition cleared → nothing to show, and the latch re-arms so the NEXT
  // occurrence is shown again.
  if (!state || state.show !== true) return { visible: false, dismissedKey: null };
  const key = occurrenceKey(state);
  if (typeof dismissedKey === 'string' && dismissedKey === key) {
    return { visible: false, dismissedKey };
  }
  // A different occurrence supersedes an old dismissal.
  return { visible: true, dismissedKey: null };
}

/**
 * Stateful wrapper around reduceDismissal for banners that render their own DOM
 * (patch_manager's bars and pill, the engine-blackout card).
 */
export class DismissalLatch {
  constructor() {
    this._dismissedKey = null;
    this._lastState = null;
  }

  /**
   * Feed the banner's wanted state.
   * @param {{show: boolean, key?: string|number}|null|undefined} state
   * @returns {boolean} whether the banner should be visible now
   */
  apply(state) {
    this._lastState = state;
    const next = reduceDismissal(state, this._dismissedKey);
    this._dismissedKey = next.dismissedKey;
    return next.visible;
  }

  /**
   * Operator pressed ✕: hide the current occurrence (no-op while nothing is shown).
   * @returns {boolean} the visibility after dismissing (false when it applied)
   */
  dismiss() {
    if (this._lastState && this._lastState.show === true) {
      this._dismissedKey = occurrenceKey(this._lastState);
    }
    return this.visible;
  }

  get dismissed() {
    return this._dismissedKey !== null;
  }

  get visible() {
    return reduceDismissal(this._lastState, this._dismissedKey).visible;
  }
}

/**
 * Build the ✕ for a banner. Exported so banners with bespoke DOM (blackout card,
 * patch bars, unpatched pill) get the identical control.
 * @param {() => void} onDismiss
 * @param {string} [title] — tooltip + aria-label; say what dismissing does NOT do.
 * @returns {HTMLButtonElement}
 */
export function createDismissButton(onDismiss, title = 'Hide this warning (the condition is unchanged)') {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = HUD_BANNER_CLOSE_CLASS;
  btn.title = title;
  btn.setAttribute('aria-label', title);
  btn.textContent = '✕';
  btn.addEventListener('click', (event) => {
    // The bar-style banners dismiss on ANY click; the button must not fire twice.
    event.stopPropagation();
    onDismiss();
  });
  return btn;
}

/**
 * A lazily-mounted, dismissable, fixed-position HUD banner. Safe to construct at
 * module load (no DOM touched until the first `update` that has something to
 * show) and safe to update before <body> exists (defers via DOMContentLoaded).
 *
 * @param {{ id: string, cssText: string, role?: string, ariaLive?: string,
 *           closeTitle?: string }} spec — `cssText` is the banner's own look
 *        (position, palette). It MUST keep `pointer-events:none`; the ✕ opts
 *        back in on its own.
 * @returns {{ update: (state: {show: boolean, text?: string, key?: string|number}) => void,
 *             dismiss: () => void, isDismissed: () => boolean,
 *             element: () => HTMLElement|null }}
 */
export function createHudBanner({ id, cssText, role = 'alert', ariaLive = 'assertive', closeTitle }) {
  const latch = new DismissalLatch();
  let el = null;
  let textEl = null;
  let pendingState = { show: false };

  function dismiss() {
    latch.dismiss();
    if (el) el.style.display = latch.visible ? '' : 'none';
  }

  const mount = () => {
    el = document.createElement('div');
    el.id = id;
    el.setAttribute('role', role);
    el.setAttribute('aria-live', ariaLive);
    el.style.cssText = cssText;
    textEl = document.createElement('span');
    textEl.className = 'hud-banner-text';
    el.appendChild(textEl);
    el.appendChild(createDismissButton(dismiss, closeTitle));
    document.body.appendChild(el);
  };

  const render = () => {
    const visible = latch.apply(pendingState);
    if (!el && !visible) return; // never mounted = nothing to show, nothing to hide
    if (!el) mount();
    // Keep the words current even while dismissed: a probe reading the census
    // count, or the banner re-showing later, must never meet stale text.
    textEl.textContent = pendingState.text || '';
    el.style.display = visible ? '' : 'none';
  };

  function update(state) {
    pendingState = state && typeof state === 'object' ? state : { show: false };
    if (typeof document === 'undefined') return;
    if (document.body) render();
    else window.addEventListener('DOMContentLoaded', render, { once: true });
  }

  return {
    update,
    dismiss,
    isDismissed: () => latch.dismissed,
    element: () => el,
  };
}
