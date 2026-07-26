/**
 * Tests for src/core/color_transition.js — the OKLCH/OKLab perceptual
 * gradient + transition math behind the Lighting Engine gradient mode
 * (animate.js). The exhaustive math suite lives with the engine sibling
 * (marsin_engine/tests/effects/color_transition_math.test.js); this file
 * covers the sim-specific LUT contract and enforces that the two sibling
 * copies of the module never drift apart.
 *
 * Pure logic — no THREE, no DOM, no WebGL.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildGradientLut,
  makeRgbTransition,
  srgbToOklab,
} from '../src/core/color_transition.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('sibling copies (sim / marsin_engine) have byte-identical code bodies', () => {
  const simPath = path.join(__dirname, '..', 'src', 'core', 'color_transition.js');
  const enginePath = path.join(
    __dirname, '..', '..', 'marsin_engine', 'lib', 'color_transition.js');
  const body = p => {
    const text = fs.readFileSync(p, 'utf8');
    const end = text.indexOf('*/'); // strip the header doc (paths differ)
    assert.ok(end !== -1, `${p} has a header doc comment`);
    return text.slice(end + 2);
  };
  assert.equal(body(simPath), body(enginePath),
    'edit both sibling copies together — the math must stay identical');
});

test('LUT is Float32Array of size*3, endpoints exactly on the stops', () => {
  const lut = buildGradientLut(['#8cc0ff', '#cc8cff'], 1024);
  assert.ok(lut instanceof Float32Array);
  assert.equal(lut.length, 1024 * 3);
  assert.ok(Math.abs(lut[0] - 0x8c / 255) < 1e-6);
  assert.ok(Math.abs(lut[1] - 0xc0 / 255) < 1e-6);
  assert.ok(Math.abs(lut[2] - 1) < 1e-6);
  const last = 1023 * 3;
  assert.ok(Math.abs(lut[last] - 0xcc / 255) < 1e-6);
  assert.ok(Math.abs(lut[last + 1] - 0x8c / 255) < 1e-6);
  assert.ok(Math.abs(lut[last + 2] - 1) < 1e-6);
});

test('animate.js sampling contract: (phase*size)&mask stays in bounds for phase [0,1)', () => {
  const SIZE = 1024;
  const MASK = SIZE - 1;
  const lut = buildGradientLut(['#0000ff', '#ffff00'], SIZE);
  for (const phase of [0, 0.001, 0.25, 0.5, 0.9999999, 1 - 1e-12]) {
    const off = ((phase * SIZE) & MASK) * 3;
    assert.ok(off >= 0 && off + 2 < lut.length, `phase ${phase} → offset ${off}`);
    assert.ok(Number.isFinite(lut[off]));
  }
});

test('blue → yellow gradient stays chromatic (no gray trough like sRGB lerp)', () => {
  const lut = buildGradientLut(['#0000ff', '#ffff00'], 256);
  for (let i = 0; i < 256; i++) {
    const r = lut[i * 3], g = lut[i * 3 + 1], b = lut[i * 3 + 2];
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    assert.ok(spread > 0.15, `entry ${i}: spread ${spread} — should never look gray`);
  }
});

test('default sim stops build a smooth LUT: no adjacent-entry jumps', () => {
  // Perceptual smoothness proxy: consecutive LUT entries must differ by a
  // hair, never a step (banding). 1024 entries over a gentle 5-stop pastel
  // gradient → per-entry channel delta stays tiny.
  const lut = buildGradientLut(['#8cc0ff', '#a699ff', '#cc8cff', '#a699ff', '#8cc0ff'], 1024);
  for (let i = 1; i < 1024; i++) {
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(lut[i * 3 + c] - lut[(i - 1) * 3 + c]);
      assert.ok(d < 0.01, `entry ${i} ch${c}: step ${d} too large (banding)`);
    }
  }
});

test('gradient interpolation is perceptual: OKLab L advances near-uniformly', () => {
  // white → black through the LUT: lightness L should fall monotonically and
  // roughly evenly (each 1/8th of the LUT covers a similar ΔL share).
  const lut = buildGradientLut(['#ffffff', '#000000'], 257);
  const L = [];
  const out = new Float64Array(3);
  for (let i = 0; i <= 256; i += 32) {
    srgbToOklab(lut[i * 3], lut[i * 3 + 1], lut[i * 3 + 2], out);
    L.push(out[0]);
  }
  for (let i = 1; i < L.length; i++) {
    const step = L[i - 1] - L[i];
    assert.ok(step > 0, `L monotone falling at segment ${i}`);
    assert.ok(Math.abs(step - 1 / 8) < 0.02, `segment ${i}: ΔL ${step} ≈ 1/8`);
  }
});

test('transitions expose no NaN for the gradient editor hard cases', () => {
  const pairs = [
    [[0, 0, 1], [1, 1, 0]],
    [[1, 0, 0], [0, 1, 0]],
    [[1, 0, 0], [0, 0, 1]],
    [[1, 0, 1], [0.5, 0.5, 0.5]],
  ];
  const out = new Float64Array(3);
  for (const [from, to] of pairs) {
    const tr = makeRgbTransition(from, to);
    for (let i = 0; i <= 20; i++) {
      tr.sample(i / 20, out);
      for (let c = 0; c < 3; c++) {
        assert.ok(Number.isFinite(out[c]) && out[c] >= 0 && out[c] <= 1,
          `${from}→${to} t=${i / 20} ch${c}: ${out[c]}`);
      }
    }
  }
});
