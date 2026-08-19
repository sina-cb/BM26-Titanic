import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');
const BRUSH_SCALE_PATH = path.join(REPO_ROOT, 'CaptainPad/live_touch/touch_control_brush_scale.js');
const PANEL_PATH = path.join(REPO_ROOT, 'CaptainPad/live_touch/touch_control.html');
const WIRE_PATH = path.join(REPO_ROOT, 'CaptainPad/live_touch/touch_control_wire.js');

const require = createRequire(import.meta.url);
const BrushScale = require(BRUSH_SCALE_PATH);
const panel = fs.readFileSync(PANEL_PATH, 'utf8');
const wire = fs.readFileSync(WIRE_PATH, 'utf8');

const ANCHOR_EXPECTATIONS = [
  ['XS', 0, 0.02],
  ['S', 0.025, 0.0275],
  ['M', 0.05, 0.035],
  ['L', 0.2, 0.08],
  ['XL', 0.35, 0.125],
];

test('brush scale exposes the exact monotonic anchor mapping and default M', () => {
  assert.equal(BrushScale.defaultSlider, 0.05);
  assert.equal(BrushScale.maxSlider, 0.35);
  ANCHOR_EXPECTATIONS.forEach(([label, slider, radius]) => {
    assert.equal(BrushScale.formatReadout(slider), label);
    assert.equal(BrushScale.padFracFromSlider(slider), radius);
    assert.equal(BrushScale.sliderFromPadFrac(radius), slider);
  });
});

test('brush scale interpolates linearly between anchors and refuses out-of-range values', () => {
  const mid = BrushScale.padFracFromSlider(0.125);
  assert.ok(mid > 0.035 && mid < 0.08, `midpoint radius ${mid} must sit between M and L`);
  assert.equal(BrushScale.clampSlider(0.9), 0.35);
  assert.throws(() => BrushScale.padFracFromSlider(0.36), /within 0\.\.0\.35/);
  assert.throws(() => BrushScale.padFracFromSlider(Number.NaN), /finite/);
});

test('legacy preset remap preserves physical radius intent', () => {
  assert.equal(BrushScale.remapLegacySlider(0.05), 0.05);
  assert.equal(BrushScale.padFracFromSlider(BrushScale.remapLegacySlider(0.05)), 0.035);
  assert.equal(BrushScale.remapLegacySlider(0.35), 0.35);
  assert.equal(BrushScale.padFracFromSlider(BrushScale.remapLegacySlider(0.35)), 0.125);
  assert.equal(BrushScale.remapLegacySlider(1), 0.35);
  assert.equal(BrushScale.padFracFromSlider(BrushScale.remapLegacySlider(1)), 0.125);
});

test('preset brushScaleVersion resolves current and legacy values loudly', () => {
  assert.equal(BrushScale.resolvePresetSlider(0.2, 1), 0.2);
  assert.equal(BrushScale.resolvePresetSlider(0.35, 1), 0.35);
  assert.equal(BrushScale.resolvePresetSlider(0.4, 1), 0.35);
  assert.equal(BrushScale.resolvePresetSlider(0.18, 0), BrushScale.remapLegacySlider(0.18));
  assert.throws(() => BrushScale.resolvePresetSlider(0.18, 99), /unsupported/);
});

test('panel and wire consume the shared brush scale module', () => {
  assert.match(panel, /touch_control_brush_scale\.js/);
  assert.match(panel, /scale\.padFracFromSlider/);
  assert.match(panel, /id="brushSize" data-value="0\.05"/);
  assert.match(panel, /id="brushSizeVal">M<\/span>/);
  assert.match(panel, /brushScaleVersion/);
  assert.match(panel, /TouchBrushScale\.resolvePresetSlider/);
  assert.match(wire, /padBrushWorldCanonical/);
});
