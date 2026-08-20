/**
 * wheel_guard.js — the mouse wheel SCROLLS the sim GUI. It never edits a value.
 *
 * OPERATOR ORDER (2026-07-29): "In the simulation GUI, disallow mouse scroll
 * from updating the parameters! I randomly accidentally set some values to 0
 * when I scroll in the menu."
 *
 * There were TWO independent ways a wheel tick could land on a value, and
 * killing either one alone leaves the bug alive:
 *
 *   1. **Our own controller handlers.** `modern_gui/controllers.js` carried
 *      lil-gui's wheel-to-value behaviour on both the fader track and the
 *      numeric input. The fader guard was `if (vertical && this._hasScrollBar)
 *      return` — i.e. it only yielded to the scroll when the ROOT children
 *      container happened to overflow at that instant. Any state where it did
 *      not (a short panel, a collapsed section, a docked pane sized to fit)
 *      turned every vertical tick over a fader into a value edit. Those
 *      handlers are DELETED, not guarded — see controllers.js.
 *
 *   2. **The browser itself.** Every numeric widget in this GUI is a real
 *      `<input type="number">` (MarsinGui's own `_initInput`, the DMX patch
 *      U/Addr boxes, the Controllers pane's port/universe/gap fields, the LED
 *      gamma boxes — 29 of them). Chrome steps a number input on wheel when it
 *      is FOCUSED, as a DEFAULT ACTION. No amount of `stopPropagation` touches
 *      a default action, so deleting JS handlers cannot fix this half. Since
 *      the operator's habit is click-a-field-then-scroll-on, this is the half
 *      that actually zeroed his values.
 *
 * This module owns half 2, and belt-and-braces for half 1, in ONE
 * capture-phase listener on `document`:
 *
 *   • **Blur** a guarded control that currently has focus. The default action
 *     is computed after dispatch completes, so a control blurred here is no
 *     longer the focused element when Chrome decides whether to step it. This
 *     is deliberately NOT `preventDefault()`: preventing the wheel's default
 *     is what would kill the scroll (requirement 1).
 *   • **Stop propagation** so no listener further down the tree — ours, or one
 *     added later by someone who did not read this file — can turn the tick
 *     into an edit. Propagation is not the scroll; the scroll survives. This
 *     covers the FADER too (`div.slider`), so half 1 is closed structurally and
 *     not merely by the current absence of a handler.
 *
 * WHAT IT DELIBERATELY DOES NOT TOUCH: wheel over a `<canvas>`. The 3D view's
 * OrbitControls zoom and the 2D Pixel Map's zoom-to-cursor are deliberate wheel
 * GESTURES on a canvas, not accidental edits of a value, and the guard only
 * engages when the event path contains one of GUARDED_SELECTORS — which a
 * canvas can never match.
 *
 * Deliberate editing is untouched: drag, click, and typing all still work; the
 * blur commits a half-typed value through the controller's own blur handler
 * rather than mutating it.
 *
 * Pure-ish DOM module: one exported installer, no THREE, no app state.
 */

// Controls the BROWSER itself mutates on wheel, as a default action.
// `input[type=number]` is the real offender (Chrome steps it when focused).
// `select` is included because Firefox changes the selected option on wheel and
// the sim is not Chrome-only by contract; `input[type=range]` because it is a
// value control and a future browser stepping it on wheel must not reopen this
// bug. These are the ones that must be BLURRED — see installWheelGuard.
export const NATIVE_STEPPING_SELECTORS = Object.freeze([
  'input[type=number]',
  'input[type=range]',
  'select',
]);

// Every value control the guard engages on. Superset of the native ones: it
// also covers MarsinGui's FADER, which is a `div.slider` (controllers.js
// `_initSlider`), not a native input. Nothing in the browser steps a div — the
// fader is here so the protection is STRUCTURAL rather than resting on "no
// wheel handler is currently attached". The handler that used to live there was
// deleted (controllers.js), and this makes re-adding one inert: the tick never
// reaches a descendant listener. `.fill` needs no entry of its own — it is a
// child of `.slider`, so `.slider` is already in the event path.
export const GUARDED_SELECTORS = Object.freeze([
  ...NATIVE_STEPPING_SELECTORS,
  '.slider',
]);

const GUARD_SELECTOR = GUARDED_SELECTORS.join(',');
const NATIVE_SELECTOR = NATIVE_STEPPING_SELECTORS.join(',');

/**
 * The guarded control a wheel event landed on, or null.
 *
 * Uses `composedPath()` when available so a control inside a shadow root is
 * still found, and falls back to `closest()` from the target. Returns null for
 * anything else — canvases, panel backgrounds, text inputs, buttons.
 *
 * @param {Event} event
 * @returns {Element|null}
 */
export function guardedControlFor(event) {
  if (!event) return null;
  const path = typeof event.composedPath === 'function' ? event.composedPath() : null;
  if (path) {
    for (const node of path) {
      if (node && node.nodeType === 1 && typeof node.matches === 'function'
        && node.matches(GUARD_SELECTOR)) {
        return node;
      }
    }
    return null;
  }
  const target = event.target;
  if (!target || target.nodeType !== 1 || typeof target.closest !== 'function') return null;
  return target.closest(GUARD_SELECTOR);
}

/**
 * Install the guard. Idempotent — a second call is a no-op, so a re-entrant GUI
 * rebuild cannot stack listeners.
 *
 * @param {Document|HTMLElement} [root=document] listener host (tests pass a stub)
 * @returns {{swallowed: number, uninstall: function}} live counter + teardown.
 *   `swallowed` is the number of wheel ticks that were denied a value edit —
 *   the before/after evidence, and what the harness asserts on.
 */
export function installWheelGuard(root = document) {
  if (root.__wheelGuardInstalled) return root.__wheelGuardInstalled;

  const state = { swallowed: 0, uninstall: null };

  const onWheel = (event) => {
    const control = guardedControlFor(event);
    if (!control) return;   // canvas zoom, panel scroll, anything else — untouched

    // Half 1: no descendant listener gets to turn this tick into an edit.
    // NOT preventDefault — the page must still scroll (operator requirement).
    event.stopPropagation();

    // Half 2: the browser's own stepping only applies to the FOCUSED control.
    // Dropping focus during dispatch is what disarms it; the control's own blur
    // handler commits whatever was typed, which is the honest outcome.
    //
    // ONLY for controls the browser actually steps. The fader is a plain div —
    // no browser mutates it, so blurring it would be a gratuitous focus loss
    // that breaks the keyboard-arrow editing path (requirement 3) for anyone who
    // tabs to a fader and then scrolls the panel.
    const doc = control.ownerDocument;
    if (doc && doc.activeElement === control
      && typeof control.matches === 'function' && control.matches(NATIVE_SELECTOR)
      && typeof control.blur === 'function') {
      control.blur();
    }

    state.swallowed += 1;
  };

  root.addEventListener('wheel', onWheel, { capture: true, passive: true });
  state.uninstall = () => {
    root.removeEventListener('wheel', onWheel, { capture: true });
    delete root.__wheelGuardInstalled;
  };
  root.__wheelGuardInstalled = state;
  return state;
}
