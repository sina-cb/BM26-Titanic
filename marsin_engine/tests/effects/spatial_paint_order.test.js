// SPATIAL PAINT — the Touch Control pad's per-pixel stroke.
//
// These tests pin the two things that were actually broken on the rig, both of
// which passed every unit test at the time because neither was covered.
//
// 1. WHERE IT RUNS IN THE FRAME. The stroke started life registered on the
//    global-effects chain's 'end' anchor, inside applyMacros. engine.js repaints
//    operator-locked groups AFTER the whole chain ("POST-PAINT ... the ones no
//    effect may touch"), so paint wiped the stroke off every painted group.
//    MEASURED on the running rig: a red stroke lifting the composed output's
//    red from 1893 to 10345 (peak byte 255) collapsed to EXACTLY 0 the moment
//    all 24 groups were painted. That is an operator using the colour slots and
//    then drawing and seeing nothing — the reported "spatial mode does not
//    work". It now runs after the paint, as its own stage, so these tests pin
//    that applyMacros does NOT paint the stroke and applySpatialStage DOES.
//
// 2. THE BRUSH IS A SEGMENT. The pad coalesces to ~10 samples/sec and the
//    network adds gaps, so a fast finger delivers very few samples per stroke;
//    stamping a disc per sample paints a dotted line. Sweeping prev->target
//    keeps the trail continuous at ANY sample rate, down to one sample.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { GlobalEffectsController } from '../../lib/global_effects_controller.js';
import { applySpatialPaint } from '../../effects/spatial_paint.js';

/** A straight line of pixels along nz = 0.5, nx spanning 0..1. */
function line(n = 41) {
  return Array.from({ length: n }, (_, i) => ({
    nx: i / (n - 1), ny: 0.5, nz: 0.5, group: 'G',
    r: 0, g: 0, b: 0, w: 0, a: 0, u: 0,
  }));
}
const litCount = px => px.filter(p => p.r > 0.02).length;

function armedStroke(ctrl) {
  ctrl.setSpatialPaint({
    enabled: true, mode: 'trail', fade: 0.5, radius: 0.1, amount: 1,
    color: [1, 0, 0, 0, 0, 0], touch: true, targetX: 0.5, targetY: 0.5,
  });
}

test('applyMacros does NOT paint the stroke — it is not a chain stage', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  armedStroke(ctrl);
  const pixels = line();
  ctrl.applyMacros({ pixels, frameIndex: 1, nowMs: 1000, signals: {} });
  assert.equal(litCount(pixels), 0,
    'the stroke must not be applied inside applyMacros — engine.js repaints ' +
    'locked groups after the chain, which is what erased it');
});

test('applySpatialStage DOES paint the stroke', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  armedStroke(ctrl);
  const pixels = line();
  ctrl.applySpatialStage({ pixels, nowMs: 1000 });
  assert.ok(litCount(pixels) > 0, 'the dedicated stage must paint the stroke');
});

test('the stage is inert while disabled (zero cost when the pad is not in use)', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  const pixels = line();
  ctrl.applySpatialStage({ pixels, nowMs: 1000 });
  assert.equal(litCount(pixels), 0);
});

test('clear() wipes the heat immediately, not after a decay', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  armedStroke(ctrl);
  ctrl.applySpatialStage({ pixels: line(), nowMs: 1000 });
  assert.ok(ctrl.getSpatialPaint().energy > 0, 'stroke should be hot');
  ctrl.setSpatialPaint({ clear: true, touch: false });
  assert.equal(ctrl.getSpatialPaint().energy, 0, 'clear must zero the heat at once');
});

test('the brush sweeps prev->target, so one sample still paints a path', () => {
  const far = { radius: 0.08, amount: 1, touch: true, mode: 'trail',
                color6: [1, 1, 1, 0, 0, 0], decay: 1 };

  const point = line();
  applySpatialPaint({ ...far, pixels: point, heat: new Float32Array(41),
                      targetX: 0.85, targetY: 0.5 });

  const swept = line();
  applySpatialPaint({ ...far, pixels: swept, heat: new Float32Array(41),
                      targetX: 0.85, targetY: 0.5, prevX: 0.15, prevY: 0.5 });

  assert.ok(litCount(point) < 10, 'a point brush lights only its own disc');
  assert.ok(litCount(swept) > 25,
    `a swept brush lights the whole path (got ${litCount(swept)})`);
});

test('a stationary brush is byte-identical to the old point behaviour', () => {
  const common = { radius: 0.1, amount: 1, touch: true, mode: 'trail',
                   color6: [1, 1, 1, 0, 0, 0], decay: 1, targetX: 0.5, targetY: 0.5 };
  const a = line(); const b = line();
  applySpatialPaint({ ...common, pixels: a, heat: new Float32Array(41) });
  applySpatialPaint({ ...common, pixels: b, heat: new Float32Array(41), prevX: 0.5, prevY: 0.5 });
  a.forEach((p, i) => assert.equal(p.r, b[i].r, `pixel ${i} must be unchanged`));
});

// ── ERASE GOES FULLY OFF, AND THAT IS ONLY SAFE BECAUSE OF THREE PROPERTIES ──
// Operator ruling: erase wipes the lights right off so it can be used for
// swipes across the map. The never-black invariant is about the ship going dark
// by ACCIDENT (disarm, crash, stranded envelope) — this is a deliberate, local,
// self-healing gesture. These tests pin exactly that, so if any of the three
// properties is ever lost the failure lands here rather than on the playa.
test('ERASE at full power takes the light all the way off', () => {
  const pixels = [{ nx: 0.5, ny: 0.5, nz: 0.5, group: 'G', r: 1, g: 1, b: 1, w: 1, a: 1, u: 1 }];
  applySpatialPaint({
    pixels, heat: new Float32Array(1), targetX: 0.5, targetY: 0.5,
    radius: 0.2, amount: 1, touch: true, mode: 'erase',
    color6: [1, 1, 1, 0, 0, 0], decay: 1,
  });
  const p = pixels[0];
  assert.equal(p.r, 0, 'a full-power erase must reach zero, not a grey smear');
  assert.equal(p.g, 0); assert.equal(p.b, 0);
  assert.equal(p.w, 0, 'white too — a lingering white channel is a visible smear');
});

test('ERASE is LOCAL — pixels outside the brush are untouched', () => {
  const inside = { nx: 0.50, ny: 0.5, nz: 0.5, group: 'G', r: 1, g: 1, b: 1, w: 0, a: 0, u: 0 };
  const outside = { nx: 0.95, ny: 0.5, nz: 0.5, group: 'G', r: 1, g: 1, b: 1, w: 0, a: 0, u: 0 };
  applySpatialPaint({
    pixels: [inside, outside], heat: new Float32Array(2), targetX: 0.5, targetY: 0.5,
    radius: 0.15, amount: 1, touch: true, mode: 'erase',
    color6: [1, 1, 1, 0, 0, 0], decay: 1,
  });
  assert.equal(inside.r, 0, 'under the brush: off');
  assert.equal(outside.r, 1, 'outside the brush: completely untouched');
});

test('ERASE is TRANSIENT — the hull comes back on its own once the wipe cools', () => {
  const heat = new Float32Array(1);
  const fresh = () => [{ nx: 0.5, ny: 0.5, nz: 0.5, group: 'G', r: 1, g: 1, b: 1, w: 0, a: 0, u: 0 }];
  let pixels = fresh();
  applySpatialPaint({
    pixels, heat, targetX: 0.5, targetY: 0.5, radius: 0.2, amount: 1,
    touch: true, mode: 'erase', color6: [1, 1, 1, 0, 0, 0], decay: 1,
  });
  assert.equal(pixels[0].r, 0, 'wiped off while the finger is down');

  // finger lifted and moved away; the show keeps running underneath
  for (let i = 0; i < 40; i++) {
    pixels = fresh();
    applySpatialPaint({
      pixels, heat, targetX: 0.95, targetY: 0.95, radius: 0.2, amount: 1,
      touch: false, mode: 'erase', color6: [1, 1, 1, 0, 0, 0], decay: 0.75,
    });
  }
  assert.ok(pixels[0].r > 0.99,
    `the hull must recover with no further input (got ${pixels[0].r})`);
});

test('ERASE at low POWER only dims — POWER is the depth of the cut', () => {
  const pixels = [{ nx: 0.5, ny: 0.5, nz: 0.5, group: 'G', r: 1, g: 1, b: 1, w: 0, a: 0, u: 0 }];
  applySpatialPaint({
    pixels, heat: new Float32Array(1), targetX: 0.5, targetY: 0.5,
    radius: 0.2, amount: 0.5, touch: true, mode: 'erase',
    color6: [1, 1, 1, 0, 0, 0], decay: 1,
  });
  assert.ok(pixels[0].r > 0.4 && pixels[0].r < 0.6,
    `half power should half-dim, not black out (got ${pixels[0].r})`);
});

test('lifting the finger drops the sweep origin — no line across the hull', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  armedStroke(ctrl);                                   // painting at 0.5,0.5
  ctrl.applySpatialStage({ pixels: line(), nowMs: 1000 });

  ctrl.setSpatialPaint({ touch: false });              // finger up
  ctrl.applySpatialStage({ pixels: line(), nowMs: 1050 });

  // Touch down far away: nothing between the two points may light.
  ctrl.setSpatialPaint({ clear: true, touch: true, targetX: 0.95, targetY: 0.5 });
  const pixels = line();
  ctrl.applySpatialStage({ pixels, nowMs: 1100 });

  const midLit = pixels.slice(10, 30).filter(p => p.r > 0.02).length;
  assert.equal(midLit, 0,
    'a new touch must not draw a stroke from where the last one ended');
  assert.ok(pixels[40].r > 0.02, 'the new touch point itself must light');
});
