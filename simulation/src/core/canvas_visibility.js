/**
 * canvas_visibility.js — the SINGLE authority on whether the 3D render canvas
 * may be on screen.
 *
 * THE GHOST SHIP (operator report, iPad "2D Simulator" tab, prod stack running
 * the `2d_pixels` profile): a dark, unlit copy of the model, larger than and
 * sitting behind the live 2D Pixel Map.
 *
 * Mechanism, measured — not guessed:
 *   1. `animate.js` hides the 3D canvas when it enters a `headless` profile,
 *      but that latch is EDGE-triggered (`if (_headless !== _headlessLatched)`).
 *      It fires once, on the transition, and never again.
 *   2. `split_layout.js` installs a window `resize` listener that calls
 *      `applyLayout()`, whose not-engaged branch runs `placeCanvas(null, true)`
 *      — an UNCONDITIONAL `canvas.style.display = ''`.
 *   3. So any resize (an iPad WebView rotating, a layout settle, the keyboard,
 *      a divider drag) re-shows the full-window 3D canvas in `2d_pixels`, and
 *      the edge-triggered latch never takes it back. The canvas still holds the
 *      last 3D frame drawn before headless was entered: the dark ship.
 *
 * The fix is not another guard bolted onto one caller. It is this module: the
 * LAYOUT says whether it wants the canvas, the PROFILE says whether the canvas
 * may exist on screen at all, and `canvasDisplayFor` is the one place those two
 * are combined. Both `animate.js` and `split_layout.js` go through it, so a
 * third caller written tomorrow inherits the rule instead of reopening the bug.
 *
 * Pure and DOM-free on purpose (imports only the profile registry), so the
 * policy is unit-testable — see `tests/headless_canvas_visibility.test.js`.
 */

import { getProfileDef } from './profile_registry.js';

/**
 * Does this profile skip ALL per-frame 3D work? (`headless: true` in the
 * registry — today only `2d_pixels`.) A headless profile never calls
 * `composer.render()`, so anything on the 3D canvas is stale by definition.
 *
 * @param {string} profileId
 * @returns {boolean}
 */
export function isHeadlessProfile(profileId) {
  return getProfileDef(profileId).headless === true;
}

/**
 * The `style.display` value the 3D render canvas MUST carry.
 *
 * @param {string} profileId          the active lighting profile
 * @param {boolean} layoutWantsVisible what the layout (split_layout / the
 *   headless latch) is asking for
 * @returns {string} '' (visible, inherit the stylesheet) or 'none'
 */
export function canvasDisplayFor(profileId, layoutWantsVisible) {
  if (typeof layoutWantsVisible !== 'boolean') {
    throw new TypeError(
      '[canvas_visibility] layoutWantsVisible must be a boolean — ' +
      `got ${JSON.stringify(layoutWantsVisible)}. Refusing to guess whether the ` +
      '3D canvas should be on screen.'
    );
  }
  // The profile VETOES; it never grants. A headless profile is never visible,
  // whatever the layout wants.
  if (isHeadlessProfile(profileId)) return 'none';
  return layoutWantsVisible ? '' : 'none';
}

/**
 * Hide the 3D canvas AND wipe what is on it, so a headless profile can never
 * reveal a stale frame — belt (the veto above) and braces (nothing left to
 * show even if some future caller forces the canvas visible).
 *
 * `renderer.clear()` is the backend-agnostic wipe: three's WebGPURenderer
 * implements it on both its WebGPU and its WebGL2 backend.
 *
 * @param {{domElement: HTMLCanvasElement, clear: Function}} renderer
 * @param {string} profileId
 * @param {boolean} layoutWantsVisible
 */
export function applyCanvasVisibility(renderer, profileId, layoutWantsVisible) {
  const display = canvasDisplayFor(profileId, layoutWantsVisible);
  renderer.domElement.style.display = display;
  if (display === 'none') renderer.clear();
}
