import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  SCHEME_IDS, SCHEME_BASE_S, MONO_STEPS, COMP_OFFSETS,
  SCHEME_MIN_V, SCHEME_ROTATION_MIN_V, GOLDEN_ANGLE_DEG,
  ANALOGOUS_STEPS, TRIADIC_STEPS, SPLIT_STEPS, TETRAD_STEPS,
  rotateHue, schemeFromSteps, generateScheme, SCHEME_TITLES,
} from '../../lib/color_schemes.js';

/**
 * ── THE PARITY REFERENCE TABLE (docs/59 §3, the `_217` lerpHue idiom) ───────
 *
 * The SAME literal lives in `CaptainPad/components/deck/colors_window_logic.test.ts`.
 * It is the whole reason two implementations of these generators are allowed to
 * exist: FOLLOW NOTE re-derives the ring INSIDE the engine on every committed
 * note change (a precomputed client ring cannot express a hue nobody has played
 * yet), while the COLORS window still stages rings on the glass. If the two
 * drifted by a float, the five swatches the operator picked from would stop
 * being the five colours on the ship.
 *
 * All 9 scheme ids × 3 base hues → the full five {h,s,v} triples, EXACT (no
 * epsilon): both sides run the identical arithmetic in the identical order, so
 * a tolerance would only hide the day one of them stops doing that. Change
 * either implementation and a test breaks on BOTH sides.
 *
 * The bases are chosen to exercise the three interesting cases: 0 (the wheel
 * origin, where a negative rotation must wrap), 0.25 (a clean quarter that
 * lands several generators on exact wheel fractions), and 0.61803 (an
 * irrational-looking hue with no symmetry, which catches an accidental
 * rounding or a reordered multiply).
 */
export const SCHEME_REFERENCE = {
  '0': {
    master: [{ h: 0, s: 0.95, v: 1 }, { h: 0, s: 0.95, v: 1 }, { h: 0, s: 0.95, v: 1 }, { h: 0, s: 0.95, v: 1 }, { h: 0, s: 0.95, v: 1 }],
    hue: [{ h: 0, s: 0.95, v: 1 }, { h: 0, s: 0.95, v: 0.78 }, { h: 0, s: 0.95, v: 0.58 }, { h: 0, s: 0.95, v: 0.4 }, { h: 0, s: 0.95, v: 0.25 }],
    complement: [{ h: 0, s: 0.95, v: 1 }, { h: 0.16666666666666666, s: 0.95, v: 1 }, { h: 0.08333333333333333, s: 0.95, v: 1 }, { h: 0.9166666666666666, s: 0.95, v: 1 }, { h: 0.8333333333333334, s: 0.95, v: 1 }],
    contrast: [{ h: 0, s: 0.95, v: 1 }, { h: 0.2, s: 0.95, v: 1 }, { h: 0.4, s: 0.95, v: 1 }, { h: 0.6, s: 0.95, v: 1 }, { h: 0.8, s: 0.95, v: 1 }],
    analogous: [{ h: 0, s: 0.95, v: 1 }, { h: 0.041666666666666664, s: 0.95, v: 1 }, { h: 0.9583333333333334, s: 0.95, v: 1 }, { h: 0.08333333333333333, s: 0.95, v: 1 }, { h: 0.9166666666666666, s: 0.95, v: 1 }],
    triadic: [{ h: 0, s: 0.95, v: 1 }, { h: 0.3333333333333333, s: 0.95, v: 1 }, { h: 0.6666666666666666, s: 0.95, v: 1 }, { h: 0, s: 0.95, v: 0.55 }, { h: 0.3333333333333333, s: 0.95, v: 0.55 }],
    split: [{ h: 0, s: 0.95, v: 1 }, { h: 0.4166666666666667, s: 0.95, v: 1 }, { h: 0.5833333333333334, s: 0.95, v: 1 }, { h: 0.4166666666666667, s: 0.95, v: 0.55 }, { h: 0.5833333333333334, s: 0.95, v: 0.55 }],
    tetrad: [{ h: 0, s: 0.95, v: 1 }, { h: 0.25, s: 0.95, v: 1 }, { h: 0.5, s: 0.95, v: 1 }, { h: 0.75, s: 0.95, v: 1 }, { h: 0, s: 0.95, v: 0.55 }],
    golden: [{ h: 0, s: 0.95, v: 1 }, { h: 0.3819444444444444, s: 0.95, v: 1 }, { h: 0.7638888888888888, s: 0.95, v: 1 }, { h: 0.14583333333333334, s: 0.95, v: 1 }, { h: 0.5277777777777778, s: 0.95, v: 1 }],
  },
  '0.25': {
    master: [{ h: 0.25, s: 0.95, v: 1 }, { h: 0.25, s: 0.95, v: 1 }, { h: 0.25, s: 0.95, v: 1 }, { h: 0.25, s: 0.95, v: 1 }, { h: 0.25, s: 0.95, v: 1 }],
    hue: [{ h: 0.25, s: 0.95, v: 1 }, { h: 0.25, s: 0.95, v: 0.78 }, { h: 0.25, s: 0.95, v: 0.58 }, { h: 0.25, s: 0.95, v: 0.4 }, { h: 0.25, s: 0.95, v: 0.25 }],
    complement: [{ h: 0.25, s: 0.95, v: 1 }, { h: 0.41666666666666663, s: 0.95, v: 1 }, { h: 0.3333333333333333, s: 0.95, v: 1 }, { h: 0.16666666666666652, s: 0.95, v: 1 }, { h: 0.08333333333333348, s: 0.95, v: 1 }],
    contrast: [{ h: 0.25, s: 0.95, v: 1 }, { h: 0.45, s: 0.95, v: 1 }, { h: 0.65, s: 0.95, v: 1 }, { h: 0.85, s: 0.95, v: 1 }, { h: 0.050000000000000044, s: 0.95, v: 1 }],
    analogous: [{ h: 0.25, s: 0.95, v: 1 }, { h: 0.2916666666666667, s: 0.95, v: 1 }, { h: 0.20833333333333348, s: 0.95, v: 1 }, { h: 0.3333333333333333, s: 0.95, v: 1 }, { h: 0.16666666666666652, s: 0.95, v: 1 }],
    triadic: [{ h: 0.25, s: 0.95, v: 1 }, { h: 0.5833333333333333, s: 0.95, v: 1 }, { h: 0.9166666666666666, s: 0.95, v: 1 }, { h: 0.25, s: 0.95, v: 0.55 }, { h: 0.5833333333333333, s: 0.95, v: 0.55 }],
    split: [{ h: 0.25, s: 0.95, v: 1 }, { h: 0.6666666666666667, s: 0.95, v: 1 }, { h: 0.8333333333333334, s: 0.95, v: 1 }, { h: 0.6666666666666667, s: 0.95, v: 0.55 }, { h: 0.8333333333333334, s: 0.95, v: 0.55 }],
    tetrad: [{ h: 0.25, s: 0.95, v: 1 }, { h: 0.5, s: 0.95, v: 1 }, { h: 0.75, s: 0.95, v: 1 }, { h: 0, s: 0.95, v: 1 }, { h: 0.25, s: 0.95, v: 0.55 }],
    golden: [{ h: 0.25, s: 0.95, v: 1 }, { h: 0.6319444444444444, s: 0.95, v: 1 }, { h: 0.01388888888888884, s: 0.95, v: 1 }, { h: 0.39583333333333337, s: 0.95, v: 1 }, { h: 0.7777777777777778, s: 0.95, v: 1 }],
  },
  '0.61803': {
    master: [{ h: 0.61803, s: 0.95, v: 1 }, { h: 0.61803, s: 0.95, v: 1 }, { h: 0.61803, s: 0.95, v: 1 }, { h: 0.61803, s: 0.95, v: 1 }, { h: 0.61803, s: 0.95, v: 1 }],
    hue: [{ h: 0.61803, s: 0.95, v: 1 }, { h: 0.61803, s: 0.95, v: 0.78 }, { h: 0.61803, s: 0.95, v: 0.58 }, { h: 0.61803, s: 0.95, v: 0.4 }, { h: 0.61803, s: 0.95, v: 0.25 }],
    complement: [{ h: 0.61803, s: 0.95, v: 1 }, { h: 0.7846966666666666, s: 0.95, v: 1 }, { h: 0.7013633333333333, s: 0.95, v: 1 }, { h: 0.5346966666666666, s: 0.95, v: 1 }, { h: 0.45136333333333334, s: 0.95, v: 1 }],
    contrast: [{ h: 0.61803, s: 0.95, v: 1 }, { h: 0.81803, s: 0.95, v: 1 }, { h: 0.01802999999999999, s: 0.95, v: 1 }, { h: 0.21802999999999995, s: 0.95, v: 1 }, { h: 0.4180299999999999, s: 0.95, v: 1 }],
    analogous: [{ h: 0.61803, s: 0.95, v: 1 }, { h: 0.6596966666666666, s: 0.95, v: 1 }, { h: 0.5763633333333333, s: 0.95, v: 1 }, { h: 0.7013633333333333, s: 0.95, v: 1 }, { h: 0.5346966666666666, s: 0.95, v: 1 }],
    triadic: [{ h: 0.61803, s: 0.95, v: 1 }, { h: 0.9513633333333333, s: 0.95, v: 1 }, { h: 0.2846966666666666, s: 0.95, v: 1 }, { h: 0.61803, s: 0.95, v: 0.55 }, { h: 0.9513633333333333, s: 0.95, v: 0.55 }],
    split: [{ h: 0.61803, s: 0.95, v: 1 }, { h: 0.0346966666666666, s: 0.95, v: 1 }, { h: 0.20136333333333334, s: 0.95, v: 1 }, { h: 0.0346966666666666, s: 0.95, v: 0.55 }, { h: 0.20136333333333334, s: 0.95, v: 0.55 }],
    tetrad: [{ h: 0.61803, s: 0.95, v: 1 }, { h: 0.86803, s: 0.95, v: 1 }, { h: 0.11803000000000008, s: 0.95, v: 1 }, { h: 0.3680300000000001, s: 0.95, v: 1 }, { h: 0.61803, s: 0.95, v: 0.55 }],
    golden: [{ h: 0.61803, s: 0.95, v: 1 }, { h: 0.9999744444444444, s: 0.95, v: 1 }, { h: 0.3819188888888889, s: 0.95, v: 1 }, { h: 0.7638633333333333, s: 0.95, v: 1 }, { h: 0.14580777777777776, s: 0.95, v: 1 }],
  },
};

// ── The parity table ────────────────────────────────────────────────────────

test('the parity reference table covers every scheme id at every base hue', () => {
  const bases = Object.keys(SCHEME_REFERENCE);
  assert.equal(bases.length, 3, 'three base hues');
  for (const base of bases) {
    assert.deepEqual(
      Object.keys(SCHEME_REFERENCE[base]).sort(), [...SCHEME_IDS].sort(),
      `base ${base} must reference every scheme id and no others`);
  }
});

for (const base of Object.keys(SCHEME_REFERENCE)) {
  for (const id of SCHEME_IDS) {
    test(`generateScheme('${id}', ${base}) matches the shared reference table EXACTLY`, () => {
      assert.deepEqual(generateScheme(id, Number(base)), SCHEME_REFERENCE[base][id]);
    });
  }
}

// ── The constants are the client's, verbatim ────────────────────────────────

test('the ported constants are the client values, unchanged', () => {
  assert.deepEqual(SCHEME_IDS, [
    'master', 'hue', 'complement', 'contrast',
    'analogous', 'triadic', 'split', 'tetrad', 'golden',
  ]);
  assert.equal(SCHEME_BASE_S, 0.95);
  assert.deepEqual(MONO_STEPS, [1.0, 0.78, 0.58, 0.40, 0.25]);
  assert.deepEqual(COMP_OFFSETS, [0, 60, 30, -30, -60]);
  assert.equal(SCHEME_MIN_V, 0.1);
  assert.equal(SCHEME_ROTATION_MIN_V, 0.25);
  assert.equal(GOLDEN_ANGLE_DEG, 137.5);
  assert.deepEqual(ANALOGOUS_STEPS, [[0, 1], [15, 1], [-15, 1], [30, 1], [-30, 1]]);
  assert.deepEqual(TRIADIC_STEPS, [[0, 1], [120, 1], [240, 1], [0, 0.55], [120, 0.55]]);
  assert.deepEqual(SPLIT_STEPS, [[0, 1], [150, 1], [210, 1], [150, 0.55], [210, 0.55]]);
  assert.deepEqual(TETRAD_STEPS, [[0, 1], [90, 1], [180, 1], [270, 1], [0, 0.55]]);
});

test('SCHEME_TITLES names every id, in row order', () => {
  assert.deepEqual(Object.keys(SCHEME_TITLES), [...SCHEME_IDS]);
  assert.equal(SCHEME_TITLES.triadic, 'TRIADIC');
});

// ── rotateHue ───────────────────────────────────────────────────────────────

test('rotateHue wraps a NEGATIVE rotation forward round the wheel', () => {
  assert.equal(rotateHue(0, -60), 300 / 360);
  assert.equal(rotateHue(0.5, -180), 0);
});

test('rotateHue wraps a rotation past a full turn', () => {
  assert.equal(rotateHue(0, 360), 0);
  assert.equal(rotateHue(0, 450), rotateHue(0, 90));
});

// ── The night-visibility floor ──────────────────────────────────────────────

test('schemeFromSteps clamps every brightness at the night-visibility floor', () => {
  const out = schemeFromSteps([[0, 0.01], [0, 1]], 0.3);
  assert.equal(out[0].v, SCHEME_ROTATION_MIN_V);
  assert.equal(out[1].v, 1);
  assert.equal(out[0].s, SCHEME_BASE_S);
});

test('the HUE ramp keeps its own (lower) Live Touch floor, not the rotation one', () => {
  // A port stays a port: quietly re-flooring MASTER/HUE at 0.25 would make the
  // Deck and Live Touch disagree about what those two generators mean.
  const ramp = generateScheme('hue', 0.4);
  assert.equal(ramp[4].v, 0.25);
  assert.equal(SCHEME_MIN_V, 0.1);
});

// ── Fail-loud boundaries (codex P0) ─────────────────────────────────────────

test('generateScheme THROWS on an unknown scheme id, naming it', () => {
  assert.throws(() => generateScheme('kaleidoscope', 0.2), /unknown scheme 'kaleidoscope'/);
});

test('generateScheme THROWS on a non-finite base hue rather than emitting NaN colours', () => {
  // The base arrives from the CPC in the follow-note loop. A NaN that got
  // through would become five NaN colours, an all-NaN tween, and a rig written
  // with NaN — a failure that looks like a dead pattern, not a dead feed.
  assert.throws(() => generateScheme('triadic', NaN), /base hue must be a number in \[0,1\]/);
  assert.throws(() => generateScheme('triadic', Infinity), /base hue must be a number in \[0,1\]/);
  assert.throws(() => generateScheme('triadic', '0.5'), /base hue must be a number in \[0,1\]/);
});

test('generateScheme THROWS on an OFF-WHEEL base hue instead of silently wrapping it', () => {
  // Deliberately NOT a wrap: `((h % 1) + 1) % 1` is not the identity on an
  // in-range hue (0.1 comes back 0.10000000000000009), so "normalizing" here
  // would put the engine's ring a float off the client's for exactly the hues
  // that look safest — and the parity table would be a lie.
  assert.throws(() => generateScheme('master', 1.25), /base hue must be a number in \[0,1\]/);
  assert.throws(() => generateScheme('master', -0.1), /base hue must be a number in \[0,1\]/);
});

test('every generator returns FIVE colours with channels on the unit cube', () => {
  for (const id of SCHEME_IDS) {
    const five = generateScheme(id, 0.37);
    assert.equal(five.length, 5, `${id} must yield five colours`);
    for (const c of five) {
      for (const ch of ['h', 's', 'v']) {
        assert.ok(typeof c[ch] === 'number' && c[ch] >= 0 && c[ch] <= 1,
          `${id}.${ch} must be in [0,1], got ${c[ch]}`);
      }
    }
  }
});

test('the module has NO CaptainPad imports — the engine boots without the app', () => {
  // The PROSE names CaptainPad (that is where the sibling implementation and
  // the twin of this table live, and saying so is the point). What must not
  // exist is a code path: any import at all. This module is pure arithmetic
  // over numbers, so the honest assertion is that it imports NOTHING.
  const src = fs.readFileSync(new URL('../../lib/color_schemes.js', import.meta.url), 'utf8');
  const imports = src.split('\n').filter((l) => /^\s*import\b/.test(l) || /\brequire\s*\(/.test(l));
  assert.deepEqual(imports, [], `color_schemes.js must import nothing, found: ${imports.join(' | ')}`);
});
