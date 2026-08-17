/**
 * headless_canvas_visibility.test.js — the "dark ghost ship" regression.
 *
 * Operator report (iPad "2D Simulator" tab, prod stack on `2d_pixels`): a dark,
 * unlit copy of the model, larger than and sitting behind the live 2D Pixel Map.
 *
 * Measured mechanism (not guessed — reproduced in a scratch sim on :7869):
 *   - `animate.js` hides the 3D canvas on the headless EDGE only
 *     (`if (_headless !== _headlessLatched)`), so it fires exactly once.
 *   - `split_layout.js` runs `applyLayout()` on every window `resize`, whose
 *     not-engaged branch called `placeCanvas(null, true)` — an unconditional
 *     `canvas.style.display = ''`.
 *   - Probe transcript, booting `pixel_mapping` then switching to `2d_pixels`:
 *       after entering 2d_pixels: {"inline":"none", ...}
 *       after same-size resize  : {"inline":"",     ...}   ← ghost on screen
 *     and a screenshot with the map panel hidden showed the stale unlit hull.
 *
 * The fix is `src/core/canvas_visibility.js`: the layout ASKS, the profile
 * VETOES, and both callers go through the same function. These tests pin the
 * veto (so no future caller can re-show a headless canvas) and the clear-on-hide
 * (so there is nothing left to reveal even if one tries).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isHeadlessProfile, canvasDisplayFor, applyCanvasVisibility,
} from '../src/core/canvas_visibility.js';
import { LIGHTING_PROFILES } from '../src/core/profile_registry.js';

// ── Which profiles are headless ─────────────────────────────────────────────

test('2d_pixels is the headless profile; the 3D profiles are not', () => {
  assert.equal(isHeadlessProfile('2d_pixels'), true);
  for (const id of ['edit', 'pixel_mapping', 'emissive', 'full']) {
    assert.equal(isHeadlessProfile(id), false, `${id} renders 3D`);
  }
});

test('headlessness is read from the registry, not from a hardcoded list', () => {
  // If someone adds a second headless profile, the veto must cover it for free.
  for (const [id, def] of Object.entries(LIGHTING_PROFILES)) {
    assert.equal(isHeadlessProfile(id), def.headless === true, id);
  }
});

// ── The veto ────────────────────────────────────────────────────────────────

test('a headless profile hides the canvas even when the layout asks for it', () => {
  // THE BUG, as one line: split_layout's resize path asks for `true`.
  assert.equal(canvasDisplayFor('2d_pixels', true), 'none');
});

test('a headless profile hides the canvas when the layout also wants it hidden', () => {
  assert.equal(canvasDisplayFor('2d_pixels', false), 'none');
});

test('a 3D profile still obeys the layout in both directions', () => {
  for (const id of ['edit', 'pixel_mapping', 'emissive', 'full']) {
    assert.equal(canvasDisplayFor(id, true), '', `${id} visible`);
    assert.equal(canvasDisplayFor(id, false), 'none', `${id} hidden (mapMax)`);
  }
});

test('leaving the headless profile restores the canvas — the ghost fix is not a one-way door', () => {
  assert.equal(canvasDisplayFor('2d_pixels', true), 'none');
  assert.equal(canvasDisplayFor('full', true), '');
});

test('a non-boolean layout request fails loudly instead of being guessed at', () => {
  assert.throws(() => canvasDisplayFor('2d_pixels', 'yes'), TypeError);
  assert.throws(() => canvasDisplayFor('full', undefined), TypeError);
  assert.throws(() => canvasDisplayFor('full', 1), TypeError);
});

// ── The clear ───────────────────────────────────────────────────────────────

function fakeRenderer() {
  const calls = { clears: 0 };
  return {
    calls,
    domElement: { style: { display: 'block' } },
    clear() { calls.clears++; },
  };
}

test('entering headless hides the canvas AND wipes the stale frame', () => {
  const r = fakeRenderer();
  applyCanvasVisibility(r, '2d_pixels', true);
  assert.equal(r.domElement.style.display, 'none');
  assert.equal(r.calls.clears, 1, 'the last 3D frame must not survive as a ghost');
});

test('a visible 3D canvas is never cleared out from under the render loop', () => {
  const r = fakeRenderer();
  applyCanvasVisibility(r, 'full', true);
  assert.equal(r.domElement.style.display, '');
  assert.equal(r.calls.clears, 0);
});

test('a layout-hidden 3D canvas (mapMax) is cleared too', () => {
  const r = fakeRenderer();
  applyCanvasVisibility(r, 'emissive', false);
  assert.equal(r.domElement.style.display, 'none');
  assert.equal(r.calls.clears, 1);
});

// ── The regression, replayed ────────────────────────────────────────────────

test('the measured sequence: enter 2d_pixels, then resize — the canvas stays hidden', () => {
  const r = fakeRenderer();

  // 1. animate.js latches into headless.
  applyCanvasVisibility(r, '2d_pixels', true);
  assert.equal(r.domElement.style.display, 'none');

  // 2. A window resize fires split_layout.applyLayout() → placeCanvas(null, true).
  //    Before the fix this line was `display = visible ? '' : 'none'` and the
  //    ghost appeared here. The latch is edge-triggered and never took it back.
  r.domElement.style.display = canvasDisplayFor('2d_pixels', true);
  assert.equal(r.domElement.style.display, 'none', 'a resize must not resurrect the 3D canvas');

  // 3. Ten more resizes change nothing.
  for (let i = 0; i < 10; i++) {
    r.domElement.style.display = canvasDisplayFor('2d_pixels', true);
  }
  assert.equal(r.domElement.style.display, 'none');

  // 4. The operator switches back to a 3D profile: it all comes back.
  applyCanvasVisibility(r, 'pixel_mapping', true);
  assert.equal(r.domElement.style.display, '');
});
