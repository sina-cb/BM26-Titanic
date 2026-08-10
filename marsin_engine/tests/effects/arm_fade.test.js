/**
 * arm_fade — the touch panel's ARM ENVELOPE.
 *
 * Arming the panel takes over the whole rig (source-locks the params, kills both
 * autopilots, disables every effect, snaps the overlay faders to zero) and every
 * one of those lands as a hard visual cut on a lit ship. The envelope lets the
 * panel fade the ship out, do the takeover invisibly, and fade back in on the
 * finished look. Disarm is the mirror.
 *
 * These tests pin the properties that make it safe to put a scalar in front of
 * the last stage before the wire:
 *   1. INERT BY DEFAULT   — 1 on construction, never persisted
 *   2. THE EARLY-RETURN TRAP — the multiply must run when no section brightness
 *                              has ever been set, which is the default path
 *   3. LANDS EXACTLY      — a ramp always arrives on target, even overshooting
 *                           the duration; it can never sit half-applied
 *   4. THROWS, NEVER COERCES — a silently clamped target is a silently wrong
 *                              house level (codex P0: no silent fallbacks)
 *   5. OUTRANKS THE BYPASS FLAGS — a dimmer-bypassing effect must not punch
 *                                  through a fading ship at full level
 *   6. BROADCASTABLE      — `armFade` is a registered WS type, so publishing it
 *                           cannot throw at runtime
 *
 * Run: node --test marsin_engine/tests/effects/arm_fade.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { IntensityController } from '../../lib/intensity_controller.js';
import { topicForType } from '../../lib/ws_topic_routing.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

function makePixels(n = 3, v = 1) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({ r: v, g: v, b: v, w: v, a: v, u: v });
  }
  return out;
}

test('inert by default — armFade is 1 and apply() leaves pixels untouched', () => {
  const ic = new IntensityController();
  assert.equal(ic.armFade, 1);
  assert.deepEqual(ic.getArmFade(), { armFade: 1, ramping: false });

  const px = makePixels(2, 0.7);
  ic.apply(px);
  assert.equal(px[0].r, 0.7);
  assert.equal(px[1].u, 0.7);
});

test('the early-return trap — the multiply runs with NO section brightness set', () => {
  // This is the whole reason the multiply sits above the sectionBrightness
  // bail-out. On the default path nothing has ever set a section brightness, so
  // a multiply placed after that early return would simply never execute and
  // the fade would silently do nothing.
  const ic = new IntensityController();
  assert.equal(Object.keys(ic.sectionBrightness).length, 0, 'precondition: default path');

  ic.startArmFade(0.5, 0);
  const px = makePixels(1, 1);
  ic.apply(px);

  assert.equal(px[0].r, 0.5);
  assert.equal(px[0].g, 0.5);
  assert.equal(px[0].b, 0.5);
  assert.equal(px[0].w, 0.5);
  assert.equal(px[0].a, 0.5);
  assert.equal(px[0].u, 0.5);
});

test('duration 0 snaps immediately and reports not ramping', () => {
  const ic = new IntensityController();
  const r = ic.startArmFade(0, 0);
  assert.equal(r.target, 0);
  assert.equal(ic.armFade, 0);
  assert.equal(ic.getArmFade().ramping, false);

  const px = makePixels(2, 1);
  ic.apply(px);
  assert.equal(px[0].r, 0);
  assert.equal(px[1].b, 0);
});

test('a ramp LANDS EXACTLY on target and self-clears', async () => {
  const ic = new IntensityController();
  ic.startArmFade(0, 80);
  assert.equal(ic.getArmFade().ramping, true);

  // Overshoot the duration deliberately: the ramp must clamp to the target
  // rather than run past it. A stuck-at-black Titanic is the worst outcome
  // there is, so "lands exactly" is the load-bearing property.
  await sleep(200);
  ic.apply(makePixels(1));

  assert.equal(ic.armFade, 0, 'landed exactly on target');
  assert.equal(ic.getArmFade().ramping, false, 'ramp self-cleared');
});

test('a ramp is monotonic and strictly between the endpoints mid-flight', async () => {
  const ic = new IntensityController();
  ic.startArmFade(0, 300);

  ic.apply(makePixels(1));
  const early = ic.armFade;
  await sleep(150);
  ic.apply(makePixels(1));
  const mid = ic.armFade;

  assert.ok(early <= 1 && early > 0, `early ${early} in (0,1]`);
  assert.ok(mid < early, `mid ${mid} below early ${early} — fading down`);
  assert.ok(mid > 0, `mid ${mid} has not arrived yet`);
});

test('THROWS on an invalid target or duration — never coerces', () => {
  const ic = new IntensityController();
  for (const bad of [-0.1, 1.1, NaN, Infinity, '1', null, undefined]) {
    assert.throws(() => ic.startArmFade(bad, 100), /target must be/,
      `target ${String(bad)} must throw`);
  }
  for (const bad of [-1, 10001, NaN, Infinity, '100', null, undefined]) {
    assert.throws(() => ic.startArmFade(1, bad), /durationMs must be/,
      `duration ${String(bad)} must throw`);
  }
  // A rejected call must not have disturbed the envelope.
  assert.equal(ic.armFade, 1);
});

test('the envelope outranks the ignoreDimmerFor* bypass flags', () => {
  // A bypassing effect (blastWhite, UV) would otherwise punch through at full
  // level and flash a "fading" ship white. Blackout ignores these flags too.
  const ic = new IntensityController();
  ic.startArmFade(0, 0);
  const px = makePixels(1, 1);
  px[0].ignoreDimmerForRGB = true;
  px[0].ignoreDimmerForW = true;
  px[0].ignoreDimmerForA = true;
  px[0].ignoreDimmerForU = true;

  ic.apply(px);
  assert.equal(px[0].r, 0, 'RGB bypass does not escape the arm envelope');
  assert.equal(px[0].w, 0, 'W bypass does not escape the arm envelope');
  assert.equal(px[0].u, 0, 'U bypass does not escape the arm envelope');
});

test('blackout still wins over a partially-faded envelope', () => {
  const ic = new IntensityController();
  ic.startArmFade(0.5, 0);
  ic.setBlackout(true);
  const px = makePixels(1, 1);
  ic.apply(px);
  assert.equal(px[0].r, 0);
  assert.equal(px[0].u, 0);
});

test('the envelope keeps advancing underneath a blackout', async () => {
  // tickArmFade() runs before the blackout early-return so the ramp does not
  // freeze mid-flight and resume from a stale position when blackout lifts.
  const ic = new IntensityController();
  ic.setBlackout(true);
  ic.startArmFade(0, 60);
  await sleep(160);
  ic.apply(makePixels(1));
  assert.equal(ic.armFade, 0, 'ramp advanced while blacked out');
});

test('armFade is a registered WS type — broadcasting it cannot throw', () => {
  // broadcastWs() routes by type and THROWS on an unclassified one, so an
  // unregistered type is a runtime 500 at the exact moment the operator arms.
  assert.doesNotThrow(() => topicForType('armFade'));
  assert.equal(typeof topicForType('armFade'), 'string');
});
