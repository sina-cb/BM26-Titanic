// Unit tests for lib/color_transition.js — the OKLab/OKLCH perceptual
// interpolation core shared (as a synced sibling copy) with
// simulation/src/core/color_transition.js.
//
// Reference values: Björn Ottosson, https://bottosson.github.io/posts/oklab/
// (also reproduced in CSS Color Module Level 4 sample code).
//
// Run:  cd marsin_engine && node --test tests/effects/color_transition_math.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  srgbToOklab,
  oklabToSrgbGamutMapped,
  makeRgbTransition,
  makeHsvTransition,
  buildGradientLut,
  parseHexColor,
  hsvToRgb,
  rgbToHsv,
} from '../../lib/color_transition.js';

const lab = () => new Float64Array(3);
const rgb = () => new Float64Array(3);

function assertNear(actual, expected, tol, label) {
  assert.ok(Math.abs(actual - expected) <= tol,
    `${label}: ${actual} !≈ ${expected} (tol ${tol})`);
}

// ── Reference conversions ──────────────────────────────────────────────────

test('sRGB primaries match published OKLab reference values', () => {
  const cases = [
    // [r,g,b] → [L,a,b] (Ottosson's table, rounded to 6 decimals)
    [[1, 0, 0], [0.627955, 0.224863, 0.125846]],
    [[0, 1, 0], [0.866440, -0.233888, 0.179498]],
    [[0, 0, 1], [0.452014, -0.032457, -0.311528]],
  ];
  for (const [[r, g, b], [L, A, B]] of cases) {
    const out = srgbToOklab(r, g, b, lab());
    assertNear(out[0], L, 1e-4, `L of rgb(${r},${g},${b})`);
    assertNear(out[1], A, 1e-4, `a of rgb(${r},${g},${b})`);
    assertNear(out[2], B, 1e-4, `b of rgb(${r},${g},${b})`);
  }
});

test('white is L=1 achromatic; black is L=0', () => {
  const w = srgbToOklab(1, 1, 1, lab());
  assertNear(w[0], 1, 1e-5, 'white L');
  assertNear(w[1], 0, 1e-6, 'white a');
  assertNear(w[2], 0, 1e-6, 'white b');
  const k = srgbToOklab(0, 0, 0, lab());
  assertNear(k[0], 0, 1e-9, 'black L');
});

test('round trip sRGB → OKLab → sRGB is exact to 1e-5 on a full grid', () => {
  for (let r = 0; r <= 4; r++) {
    for (let g = 0; g <= 4; g++) {
      for (let b = 0; b <= 4; b++) {
        const c = [r / 4, g / 4, b / 4];
        const l = srgbToOklab(c[0], c[1], c[2], lab());
        const back = oklabToSrgbGamutMapped(l[0], l[1], l[2], rgb());
        for (let i = 0; i < 3; i++) {
          assertNear(back[i], c[i], 1e-5, `round trip rgb(${c}) ch${i}`);
        }
      }
    }
  }
});

test('gamut mapping: out-of-gamut OKLab returns finite sRGB in [0,1]', () => {
  // Deliberately hyper-chromatic points at several L / hue angles.
  for (let li = 1; li < 10; li++) {
    for (let hi = 0; hi < 12; hi++) {
      const L = li / 10;
      const h = (hi / 12) * 2 * Math.PI;
      const C = 0.5; // far beyond sRGB at every L
      const out = oklabToSrgbGamutMapped(L, C * Math.cos(h), C * Math.sin(h), rgb());
      for (let i = 0; i < 3; i++) {
        assert.ok(Number.isFinite(out[i]), `finite ch${i} at L=${L} h=${h}`);
        assert.ok(out[i] >= 0 && out[i] <= 1, `in range ch${i} at L=${L} h=${h}: ${out[i]}`);
      }
      // Chroma reduction must preserve SOME lightness ordering: not black/white.
      const l2 = srgbToOklab(out[0], out[1], out[2], lab());
      assertNear(l2[0], L, 0.02, `gamut-mapped L preserved at L=${L} h=${h}`);
    }
  }
});

// ── Transition semantics ───────────────────────────────────────────────────

test('sample(0)/sample(1) return the EXACT endpoints (no round-trip drift)', () => {
  const from = [0.123, 0.456, 0.789];
  const to = [0.9, 0.1, 0.4];
  for (const mode of ['oklch', 'oklab']) {
    const tr = makeRgbTransition(from, to, mode);
    assert.deepEqual(Array.from(tr.sample(0, rgb())), from, `${mode} t=0`);
    assert.deepEqual(Array.from(tr.sample(1, rgb())), to, `${mode} t=1`);
  }
});

test('red → blue (oklch) takes the short hue arc through magenta, not green', () => {
  const tr = makeRgbTransition([1, 0, 0], [0, 0, 1], 'oklch');
  const mid = tr.sample(0.5, rgb());
  assert.ok(mid[1] < Math.min(mid[0], mid[2]),
    `midpoint ${Array.from(mid)} should be magenta-family (green channel lowest)`);
});

test('blue → yellow (oklch) never collapses to gray like naive sRGB lerp', () => {
  // Naive sRGB midpoint of blue↔yellow is exactly gray (0.5,0.5,0.5).
  const tr = makeRgbTransition([0, 0, 1], [1, 1, 0], 'oklch');
  for (let i = 1; i < 10; i++) {
    const c = tr.sample(i / 10, rgb());
    const spread = Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);
    assert.ok(spread > 0.15, `t=${i / 10}: spread ${spread} stays chromatic`);
  }
});

test('achromatic endpoint adopts the other hue: white → red stays in the red family', () => {
  const tr = makeRgbTransition([1, 1, 1], [1, 0, 0], 'oklch');
  const hsv = new Float64Array(3);
  for (let i = 1; i < 10; i++) {
    const c = tr.sample(i / 10, rgb());
    rgbToHsv(c[0], c[1], c[2], hsv);
    if (hsv[1] > 0.05) { // once visibly chromatic, hue must be red-ish
      assert.ok(hsv[0] < 0.1 || hsv[0] > 0.9,
        `t=${i / 10}: hue ${hsv[0]} stays near red, no phantom hue bow`);
    }
  }
});

test('white → black is monotone in lightness and stays achromatic', () => {
  const tr = makeRgbTransition([1, 1, 1], [0, 0, 0], 'oklch');
  let prevL = Infinity;
  for (let i = 0; i <= 10; i++) {
    const c = tr.sample(i / 10, rgb());
    assertNear(c[0], c[1], 2e-3, `t=${i / 10} r≈g`);
    assertNear(c[1], c[2], 2e-3, `t=${i / 10} g≈b`);
    const L = srgbToOklab(c[0], c[1], c[2], lab())[0];
    assert.ok(L <= prevL + 1e-9, `t=${i / 10}: L ${L} monotone nonincreasing`);
    prevL = L;
  }
});

test('no NaN and always in [0,1] across 200 random pairs × 11 t values', () => {
  // Deterministic LCG so failures reproduce.
  let seed = 42;
  const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  for (let n = 0; n < 200; n++) {
    const from = [rand(), rand(), rand()];
    const to = [rand(), rand(), rand()];
    const mode = n % 2 === 0 ? 'oklch' : 'oklab';
    const tr = makeRgbTransition(from, to, mode);
    for (let i = 0; i <= 10; i++) {
      const c = tr.sample(i / 10, rgb());
      for (let ch = 0; ch < 3; ch++) {
        assert.ok(Number.isFinite(c[ch]) && c[ch] >= 0 && c[ch] <= 1,
          `pair ${n} (${mode}) t=${i / 10} ch${ch}: ${c[ch]}`);
      }
    }
  }
});

test('invalid inputs fail loudly', () => {
  assert.throws(() => makeRgbTransition([NaN, 0, 0], [0, 0, 0]), /finite/);
  assert.throws(() => makeRgbTransition([0, 0, 0], [1, 1, 1], 'lab'), /unknown mode/);
  assert.throws(() => buildGradientLut([], 256), /at least one stop/);
  assert.throws(() => buildGradientLut(['#ff0000'], 1), /size/);
  assert.throws(() => parseHexColor('#12345', rgb()), /invalid hex/);
  assert.throws(() => parseHexColor('#gggggg', rgb()), /invalid hex/);
});

// ── HSV transition (engine palette crossfade contract) ────────────────────

test('makeHsvTransition returns exact endpoint copies at t=0 and t=1', () => {
  const from = { h: 0.13, s: 0.7, v: 0.9 };
  const to = { h: 0.77, s: 1, v: 0.5 };
  const sample = makeHsvTransition(from, to);
  assert.deepEqual(sample(0), from);
  assert.deepEqual(sample(1), to);
  assert.deepEqual(sample(-1), from);
  assert.deepEqual(sample(2), to);
});

test('makeHsvTransition hue crosses the 0/1 seam on the short arc', () => {
  const sample = makeHsvTransition({ h: 0.95, s: 1, v: 1 }, { h: 0.05, s: 1, v: 1 });
  for (let i = 1; i < 10; i++) {
    const c = sample(i / 10);
    assert.ok(c.h > 0.85 || c.h < 0.15,
      `t=${i / 10}: hue ${c.h} stays near the red seam, never ~0.5`);
    assert.ok(Number.isFinite(c.s) && Number.isFinite(c.v), 'finite s/v');
  }
});

test('makeHsvTransition handles achromatic endpoints (s=0, v=0) without NaN', () => {
  const cases = [
    [{ h: 0, s: 0, v: 1 }, { h: 0.66, s: 1, v: 1 }],   // white → blue
    [{ h: 0.3, s: 1, v: 1 }, { h: 0, s: 0, v: 0 }],    // green → black
    [{ h: 0, s: 0, v: 0 }, { h: 0, s: 0, v: 1 }],      // black → white
  ];
  for (const [from, to] of cases) {
    const sample = makeHsvTransition(from, to);
    for (let i = 0; i <= 10; i++) {
      const c = sample(i / 10);
      for (const k of ['h', 's', 'v']) {
        assert.ok(Number.isFinite(c[k]) && c[k] >= 0 && c[k] <= 1,
          `${JSON.stringify(from)}→${JSON.stringify(to)} t=${i / 10} ${k}=${c[k]}`);
      }
    }
  }
});

test('hsvToRgb / rgbToHsv round trip', () => {
  const out = new Float64Array(3);
  const back = new Float64Array(3);
  for (let h = 0; h < 12; h++) {
    for (const s of [0.25, 0.6, 1]) {
      for (const v of [0.25, 0.6, 1]) {
        hsvToRgb(h / 12, s, v, out);
        rgbToHsv(out[0], out[1], out[2], back);
        assertNear(back[0], h / 12, 1e-9, `hue ${h / 12}`);
        assertNear(back[1], s, 1e-9, `sat ${s}`);
        assertNear(back[2], v, 1e-9, `val ${v}`);
      }
    }
  }
});

// ── Gradient LUT ───────────────────────────────────────────────────────────

test('buildGradientLut endpoints hit the stops exactly (float32 precision)', () => {
  const lut = buildGradientLut(['#ff0000', '#0000ff'], 256);
  assert.equal(lut.length, 256 * 3);
  assertNear(lut[0], 1, 1e-6, 'first r');
  assertNear(lut[1], 0, 1e-6, 'first g');
  assertNear(lut[2], 0, 1e-6, 'first b');
  assertNear(lut[255 * 3], 0, 1e-6, 'last r');
  assertNear(lut[255 * 3 + 2], 1, 1e-6, 'last b');
});

test('buildGradientLut multi-stop: middle stop lands at the segment boundary', () => {
  // 3 stops, size 257 → index 128 is exactly phase 0.5 = stop[1].
  const lut = buildGradientLut(['#000000', '#00ff00', '#ffffff'], 257);
  assertNear(lut[128 * 3], 0, 1e-6, 'mid r');
  assertNear(lut[128 * 3 + 1], 1, 1e-6, 'mid g');
  assertNear(lut[128 * 3 + 2], 0, 1e-6, 'mid b');
});

test('buildGradientLut single stop fills the LUT with that color', () => {
  const lut = buildGradientLut(['#336699'], 16);
  for (let i = 0; i < 16; i++) {
    assertNear(lut[i * 3], 0x33 / 255, 1e-6, `entry ${i} r`);
    assertNear(lut[i * 3 + 1], 0x66 / 255, 1e-6, `entry ${i} g`);
    assertNear(lut[i * 3 + 2], 0x99 / 255, 1e-6, `entry ${i} b`);
  }
});

test('buildGradientLut output is finite and in [0,1] everywhere (hard cases)', () => {
  const hard = [
    ['#0000ff', '#ffff00'], // blue → yellow
    ['#ff0000', '#00ff00'], // red → green
    ['#ff0000', '#0000ff'], // red → blue
    ['#ff00ff', '#808080'], // saturated → desaturated
    ['#8cc0ff', '#a699ff', '#cc8cff', '#a699ff', '#8cc0ff'], // sim default stops
  ];
  for (const stops of hard) {
    const lut = buildGradientLut(stops, 1024);
    for (let i = 0; i < lut.length; i++) {
      assert.ok(Number.isFinite(lut[i]) && lut[i] >= 0 && lut[i] <= 1,
        `${stops.join('→')} idx ${i}: ${lut[i]}`);
    }
  }
});

test('parseHexColor supports #rgb and #rrggbb', () => {
  const a = parseHexColor('#fff', rgb());
  assert.deepEqual(Array.from(a), [1, 1, 1]);
  const b = parseHexColor('#8CC0FF', rgb());
  assertNear(b[0], 0x8c / 255, 1e-9, 'r');
  assertNear(b[1], 0xc0 / 255, 1e-9, 'g');
  assertNear(b[2], 0xff / 255, 1e-9, 'b');
});
