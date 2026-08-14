/**
 * tests/effects/vintage_white_release.test.js
 *
 * vintageWhite RELEASE envelope (BM26 fire → lights sync).
 *
 * Vintage filament heads do not go dark the instant the flame stops, and the
 * pre-existing behavior — px.w slammed to 1.0 while on, untouched the frame
 * after — read as a hard cut. `vintageWhiteReleaseMs` ramps the white boost
 * 1.0 → 0 linearly after the effect goes off.
 *
 * What these tests pin:
 *   • release 0 (the default, and any engine with no fire-sync config) behaves
 *     EXACTLY as before — no ramp, no residue.
 *   • the ramp is linear, bounded, and retires itself at the end.
 *   • it only ever RAISES a pixel's white (it decays the boost; it never dims
 *     live pattern content).
 *   • a retrigger during the ramp snaps back to full and cancels the fade.
 *   • the setter refuses an out-of-range value instead of clamping it.
 *
 * Frame model matches engine.js: every tick rewrites model.pixels from the
 * mixer output and THEN calls applyPixels, so each `frame()` here starts from
 * freshly-written pixel values. The clock is injected, so nothing sleeps.
 *
 * Run:  node --test tests/effects/vintage_white_release.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { GlobalEffectsController } from '../../lib/global_effects_controller.js';

// One VintageLed head, plus a non-head pixel that must never be touched.
// `baseW` is what the pattern wrote into the head this frame.
function makePixels(baseW = 0) {
  return [
    { fixtureType: 'VintageLed', name: 'vintage_head_1', channels: { w: 1 }, w: baseW, r: 0, g: 0, b: 0 },
    { fixtureType: 'Par', name: 'par_1', channels: { r: 1, g: 1, b: 1 }, w: 0, r: 0.5, g: 0, b: 0 },
  ];
}

// Render one frame at nowMs and return the head's resulting white value.
function frame(c, nowMs, baseW = 0) {
  const px = makePixels(baseW);
  c.applyPixels(px, nowMs);
  assert.equal(px[1].w, 0, 'non-head pixels are never touched');
  return px[0].w;
}

test('release 0 keeps the historical instant-off behavior', () => {
  const c = new GlobalEffectsController();
  assert.equal(c.vintageWhiteReleaseMs, 0, 'inert unless something configures it');
  c.setEffect('vintageWhite', true);
  assert.equal(frame(c, 1000), 1.0);
  c.setEffect('vintageWhite', false);
  assert.equal(frame(c, 1001), 0, 'no ramp, no residue');
  assert.equal(c._vwFadeActive, false);
});

test('the release ramp is linear and retires itself at the end', () => {
  const c = new GlobalEffectsController();
  c.setVintageWhiteReleaseMs(400);
  c.setEffect('vintageWhite', true);
  assert.equal(frame(c, 0), 1.0);

  c.setEffect('vintageWhite', false);
  const t0 = c._vwFadeStartMs;
  assert.ok(Math.abs(frame(c, t0 + 100) - 0.75) < 1e-9, 'quarter through -> 0.75');
  assert.ok(Math.abs(frame(c, t0 + 200) - 0.5) < 1e-9, 'halfway -> 0.5');
  const almost = frame(c, t0 + 399);
  assert.ok(almost > 0 && almost < 0.01, 'almost out');
  assert.equal(frame(c, t0 + 400), 0, 'ramp is done');
  assert.equal(c._vwFadeActive, false, 'and the fade retires itself');
  // Frames after the ramp cost nothing and change nothing.
  assert.equal(frame(c, t0 + 900, 0.3), 0.3);
});

test('the ramp raises the head but never dims live pattern content', () => {
  const c = new GlobalEffectsController();
  c.setVintageWhiteReleaseMs(400);
  c.setEffect('vintageWhite', true);
  frame(c, 0);
  c.setEffect('vintageWhite', false);
  const t0 = c._vwFadeStartMs;
  // The pattern is writing a BRIGHTER white than the decaying boost: keep it.
  assert.equal(frame(c, t0 + 300, 0.9), 0.9, 'the pattern wins; the ramp only ever raises');
  // A dimmer pattern value is lifted to the boost instead.
  assert.ok(Math.abs(frame(c, t0 + 300, 0.1) - 0.25) < 1e-9);
});

test('a retrigger during the release snaps back to full and cancels the fade', () => {
  const c = new GlobalEffectsController();
  c.setVintageWhiteReleaseMs(400);
  c.setEffect('vintageWhite', true);
  frame(c, 0);
  c.setEffect('vintageWhite', false);
  const t0 = c._vwFadeStartMs;
  assert.ok(Math.abs(frame(c, t0 + 200) - 0.5) < 1e-9);

  c.setEffect('vintageWhite', true);    // fire again mid-release
  assert.equal(c._vwFadeActive, false, 'the fade is cancelled outright');
  assert.equal(frame(c, t0 + 210), 1.0, 'snapped back to full');

  // ...and the NEXT release starts a fresh full-length ramp.
  c.setEffect('vintageWhite', false);
  const t1 = c._vwFadeStartMs;
  assert.ok(t1 >= t0);
  assert.ok(Math.abs(frame(c, t1 + 200) - 0.5) < 1e-9);
});

test('setVintageWhiteReleaseMs REFUSES out-of-range values (never clamps)', () => {
  const c = new GlobalEffectsController();
  assert.throws(() => c.setVintageWhiteReleaseMs(-1), /\[0, 5000\]/);
  assert.throws(() => c.setVintageWhiteReleaseMs(5001), /\[0, 5000\]/);
  assert.throws(() => c.setVintageWhiteReleaseMs('400'), /\[0, 5000\]/);
  assert.equal(c.vintageWhiteReleaseMs, 0, 'nothing was applied');
  c.setVintageWhiteReleaseMs(5000);
  assert.equal(c.vintageWhiteReleaseMs, 5000);
  assert.equal(c.getStatus().vintageWhiteReleaseMs, 5000);
});

test('setting release to 0 mid-fade drops the ramp rather than freezing it', () => {
  const c = new GlobalEffectsController();
  c.setVintageWhiteReleaseMs(400);
  c.setEffect('vintageWhite', true);
  frame(c, 0);
  c.setEffect('vintageWhite', false);
  const t0 = c._vwFadeStartMs;
  c.setVintageWhiteReleaseMs(0);
  assert.equal(frame(c, t0 + 10), 0);
  assert.equal(c._vwFadeActive, false);
});

test('the release survives the bypass-dimmer flag it inherits while lit', () => {
  const c = new GlobalEffectsController();
  c.setVintageWhiteReleaseMs(400);
  c.setEffect('vintageWhiteBypassDimmer', true);
  c.setEffect('vintageWhite', true);
  const on = makePixels();
  c.applyPixels(on, 0);
  assert.equal(on[0].ignoreDimmerForW, true);
  c.setEffect('vintageWhite', false);
  const t0 = c._vwFadeStartMs;
  const fading = makePixels();
  c.applyPixels(fading, t0 + 100);
  assert.ok(Math.abs(fading[0].w - 0.75) < 1e-9);
  assert.equal(fading[0].ignoreDimmerForW, true,
    'the ramp keeps the same dimmer treatment it had while lit — otherwise the '
    + 'release would jump brightness at the moment the flame stops');
});
