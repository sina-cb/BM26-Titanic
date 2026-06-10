// Unit tests for Group Fixed Colors (docs/32).
// Run:  node --test tests/group_fixed_colors.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { GlobalEffectsController } from '../lib/global_effects_controller.js';
import { IntensityController } from '../lib/intensity_controller.js';
import { StateManager } from '../lib/state_manager.js';
import { applyGroupFixedColors } from '../effects/group_fixed_color.js';
import { topicForType, TOPICS } from '../lib/ws_topic_routing.js';

const RED6 = [1, 0, 0, 0, 0, 0];

function makePixels() {
  // Two groups + one group-less pixel, mirroring a real model mix.
  return [
    { group: 'BarLights',     sId: 1, r: 0.5, g: 0.4, b: 0.3, w: 0.2, a: 0.1, u: 0.05 },
    { group: 'BarLights',     sId: 1, r: 0.1, g: 0.2, b: 0.9, w: 0.0, a: 0.0, u: 0.00 },
    { group: 'VintageLights', sId: 2, r: 0.7, g: 0.6, b: 0.5, w: 0.4, a: 0.3, u: 0.20 },
    {                          sId: 0, r: 0.9, g: 0.9, b: 0.9, w: 0.9, a: 0.9, u: 0.90 },
  ];
}

// ── Validation (codex P0: fail loudly, never half-apply) ─────────────

test('setGroupFixedColor rejects bad group / color / brightness', () => {
  const c = new GlobalEffectsController();
  assert.throws(() => c.setGroupFixedColor('', RED6, 0.5), /non-empty string/);
  assert.throws(() => c.setGroupFixedColor(null, RED6, 0.5), /non-empty string/);
  assert.throws(() => c.setGroupFixedColor('BarLights', [1, 0, 0], 0.5), /6-element/);
  assert.throws(() => c.setGroupFixedColor('BarLights', [2, 0, 0, 0, 0, 0], 0.5), /out of range/);
  assert.throws(() => c.setGroupFixedColor('BarLights', RED6, 1.5), /out of range/);
  assert.throws(() => c.setGroupFixedColor('BarLights', RED6, -0.1), /out of range/);
  assert.throws(() => c.setGroupFixedColor('BarLights', RED6, NaN), /out of range/);
  assert.throws(() => c.setGroupFixedColor('BarLights', RED6, '0.5'), /out of range/);
  // Nothing half-applied after all those throws.
  assert.deepEqual(c.groupFixedColors, {});
});

test('setGroupFixedColor stores a defensive copy of the color', () => {
  const c = new GlobalEffectsController();
  const color = [...RED6];
  c.setGroupFixedColor('BarLights', color, 0.8);
  color[0] = 0;
  assert.equal(c.groupFixedColors.BarLights.color[0], 1);
  assert.equal(c.groupFixedColors.BarLights.brightness, 0.8);
});

test('clearGroupFixedColor is idempotent and reports removal', () => {
  const c = new GlobalEffectsController();
  c.setGroupFixedColor('BarLights', RED6, 0.8);
  assert.equal(c.clearGroupFixedColor('BarLights'), true);
  assert.equal(c.clearGroupFixedColor('BarLights'), false);
  assert.throws(() => c.clearGroupFixedColor(''), /non-empty string/);
});

// ── Pixel application ─────────────────────────────────────────────────

test('apply repaints ONLY the locked group at color × brightness', () => {
  const pixels = makePixels();
  applyGroupFixedColors({
    pixels,
    overrides: { BarLights: { color: RED6, brightness: 0.5 } },
  });
  for (const px of pixels.slice(0, 2)) {
    assert.equal(px.r, 0.5);
    assert.equal(px.g, 0);
    assert.equal(px.b, 0);
    assert.equal(px.w, 0);
    assert.equal(px.a, 0);
    assert.equal(px.u, 0);
  }
  // Other group + group-less pixel untouched.
  assert.equal(pixels[2].r, 0.7);
  assert.equal(pixels[3].r, 0.9);
});

test('brightness 0 locks the group dark (per-group blackout)', () => {
  const pixels = makePixels();
  const c = new GlobalEffectsController();
  c.setGroupFixedColor('VintageLights', [1, 1, 1, 1, 1, 1], 0);
  c.applyGroupFixedColors(pixels);
  assert.equal(pixels[2].r, 0);
  assert.equal(pixels[2].w, 0);
  assert.equal(pixels[0].r, 0.5); // unlocked group untouched
});

test('controller apply is a no-op with an empty table', () => {
  const pixels = makePixels();
  const before = JSON.parse(JSON.stringify(pixels));
  new GlobalEffectsController().applyGroupFixedColors(pixels);
  assert.deepEqual(pixels, before);
});

// ── Pipeline ordering (docs/32 §2.2) ──────────────────────────────────

test('lock wins over macros: color wash cannot repaint a locked group', () => {
  const pixels = makePixels();
  const c = new GlobalEffectsController({ engine: { fps: 40 } });
  c.setGroupFixedColor('BarLights', RED6, 1.0);
  // Full-strength replace wash over everything…
  c.setColorWash(true, 'emergency_red', 1.0, 'replace');
  c.colorWashConfig.color = [0, 1, 0, 0, 0, 0]; // force green to disambiguate
  c.applyMacros({ pixels, frameIndex: 0, nowMs: 0 });
  // …then the engine.js pipeline applies group locks AFTER macros.
  c.applyGroupFixedColors(pixels);
  assert.equal(pixels[0].r, 1);   // locked: red, not green
  assert.equal(pixels[0].g, 0);
  assert.equal(pixels[2].g, 1);   // unlocked group got the wash
});

test('blackout has the final say (apply point is pre-intensity)', () => {
  const pixels = makePixels();
  const gec = new GlobalEffectsController();
  const ic = new IntensityController();
  gec.setGroupFixedColor('BarLights', RED6, 1.0);
  ic.setBlackout(true);
  gec.applyGroupFixedColors(pixels);
  ic.apply(pixels); // engine.js order: locks first, intensity last
  for (const px of pixels) {
    assert.equal(px.r, 0);
    assert.equal(px.g, 0);
    assert.equal(px.b, 0);
  }
});

test('section dimmers scale a locked group (master trim on top)', () => {
  const pixels = makePixels();
  const gec = new GlobalEffectsController();
  const ic = new IntensityController();
  gec.setGroupFixedColor('BarLights', RED6, 1.0);
  ic.setSectionBrightness(1, 0.5);
  gec.applyGroupFixedColors(pixels);
  ic.apply(pixels);
  assert.equal(pixels[0].r, 0.5);
  assert.equal(pixels[2].r, 0.7); // section 2 untouched
});

test('panicStop leaves group locks alone (rig state, like dimmers)', () => {
  const c = new GlobalEffectsController();
  c.setGroupFixedColor('BarLights', RED6, 0.8);
  c.panicStop();
  assert.deepEqual(c.groupFixedColors.BarLights, { color: RED6, brightness: 0.8 });
});

// ── Status + persistence + WS routing ─────────────────────────────────

test('getStatus exposes a deep clone of the table', () => {
  const c = new GlobalEffectsController();
  c.setGroupFixedColor('BarLights', RED6, 0.8);
  const status = c.getStatus();
  assert.deepEqual(status.groupFixedColors.BarLights, { color: RED6, brightness: 0.8 });
  status.groupFixedColors.BarLights.brightness = 0;
  assert.equal(c.groupFixedColors.BarLights.brightness, 0.8);
});

test('applyGlobalsState restores persisted overrides through the validating setter', () => {
  const c = new GlobalEffectsController();
  const sm = Object.create(StateManager.prototype); // no disk I/O needed
  sm.applyGlobalsState(
    { groupFixedColors: { VintageLights: { color: RED6, brightness: 0.3 } } },
    null, null, c,
  );
  assert.deepEqual(c.groupFixedColors.VintageLights, { color: RED6, brightness: 0.3 });
  // A malformed persisted entry must throw, not half-apply.
  assert.throws(() => sm.applyGlobalsState(
    { groupFixedColors: { Bad: { color: [9, 9, 9, 9, 9, 9], brightness: 0.3 } } },
    null, null, c,
  ), /out of range/);
});

test('groupFixedColors broadcasts route to /ws/control', () => {
  assert.equal(topicForType('groupFixedColors'), TOPICS.CONTROL);
});
