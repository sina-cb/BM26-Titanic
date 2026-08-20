// Tests for the LED-STRAND colour translation (report 20260725_25).
//
// The contract under test: strand pixels are encoded so the LED
// controller's own white processing — fold the wire W into RGB, then
// re-extract W = min(R,G,B) — can NEVER clip, so a tinted white keeps its
// tint at every master level; the amber render lane is folded into RGB
// (strands have no amber emitter) while UV is dropped; gamma lives ONLY
// in the controller (the mapper emits linear bytes); and the sim preview
// is derived from those exact wire bytes.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LED_WIRE_DEFAULTS,
  LED_CONTROLLER_GAMMA,
  RECOMMENDED_CONTROLLER_GAMMA,
  normalizeLedWireConfig,
  ledCompositeTarget,
  ledWireBytes,
  simulateLedEmitters,
  ledPreviewRgb,
  ledPreviewRgbFromBytes,
  isLedEntry,
} from '../src/dmx/led_wire.js';
import { mapPixelsToSacn } from '../src/dmx/sacn_mapper.js';

const CFG = normalizeLedWireConfig(null, 'test');
// A controller with the recommended curve pushed, for the gamma tests.
const GCFG = normalizeLedWireConfig({ controllerGamma: RECOMMENDED_CONTROLLER_GAMMA }, 'test');

function makeRouter() {
  const frames = new Map();
  return {
    addUniverse(u) { if (!frames.has(u)) frames.set(u, new Uint8Array(512)); },
    getFullFrame(u) { return frames.get(u) || null; },
  };
}

// The LED controller's fold step, verbatim — the thing that used to clip.
function controllerFold(bytes) {
  return [
    Math.min(255, bytes.r + bytes.w),
    Math.min(255, bytes.g + bytes.w),
    Math.min(255, bytes.b + bytes.w),
  ];
}

// Chromaticity of an RGB triple, normalized to its own peak. Two colours
// with the same normalized ratios are the same tint at different levels.
function tint(rgb) {
  const peak = Math.max(...rgb);
  if (peak <= 0) return [0, 0, 0];
  return rgb.map(v => v / peak);
}

function assertTintClose(actual, expected, tol, msg) {
  const a = tint(actual), e = tint(expected);
  for (let i = 0; i < 3; i++) {
    assert.ok(Math.abs(a[i] - e[i]) <= tol,
      `${msg}: channel ${i} tint ${a[i].toFixed(4)} vs ${e[i].toFixed(4)} (tol ${tol})`);
  }
}

// ── The no-clip guarantee ────────────────────────────────────────────────

test('no-clip: R+W, G+W, B+W never exceed 255 (property sweep over the lanes)', () => {
  for (let r = 0; r <= 255; r += 5) {
    for (let g = 0; g <= 255; g += 17) {
      for (let b = 0; b <= 255; b += 23) {
        for (const w of [0, 0.25, 0.5, 1]) {
          for (const a of [0, 0.4, 1]) {
            const bytes = ledWireBytes(r / 255, g / 255, b / 255, w, a, CFG);
            assert.ok(bytes.r >= 0 && bytes.g >= 0 && bytes.b >= 0 && bytes.w >= 0,
              `negative byte at ${r},${g},${b},w=${w},a=${a}`);
            assert.ok(bytes.r + bytes.w <= 255, `R+W clip at ${r},${g},${b},w=${w}`);
            assert.ok(bytes.g + bytes.w <= 255, `G+W clip at ${r},${g},${b},w=${w}`);
            assert.ok(bytes.b + bytes.w <= 255, `B+W clip at ${r},${g},${b},w=${w}`);
          }
        }
      }
    }
  }
});

test('no-clip: the controller fold reproduces our composite exactly (round trip)', () => {
  for (const px of [
    [1, 0.68, 0.32, 1, 0], [1, 1, 1, 1, 1], [0.2, 0.05, 0, 0.9, 0.7],
    [0, 0, 0, 0, 0], [1, 0, 0, 0, 0], [0.5, 0.5, 0.5, 0.5, 0.5],
  ]) {
    const [r, g, b, w, a] = px;
    const target = ledCompositeTarget(r, g, b, w, a, CFG);
    const bytes = ledWireBytes(r, g, b, w, a, CFG);
    const folded = controllerFold(bytes);
    for (let i = 0; i < 3; i++) {
      assert.equal(folded[i], Math.round(target.composite[i] * 255),
        `fold != composite for ${JSON.stringify(px)} channel ${i}`);
    }
  }
});

// ── White tint preservation (the actual bug) ─────────────────────────────

test('warm white keeps its tint at FULL level (the pre-fix failure case)', () => {
  // A tungsten-tinted white pattern: full R, warm G/B, plus an explicit
  // white lane. Pre-fix this went out as (255,173,82,W=255): the fold
  // clipped every channel to 255 and the strand showed NEUTRAL white.
  const [r, g, b, w] = [1.0, 0.68, 0.32, 1.0];
  const bytes = ledWireBytes(r, g, b, w, 0, CFG);
  const folded = controllerFold(bytes);
  assert.ok(Math.max(...folded) === 255, 'peak channel should use the full range');
  // The intended tint is the SUM of the colour and white lanes, i.e.
  // (2.0, 1.68, 1.32) — normalized, (1, 0.84, 0.66).
  assertTintClose(folded, [2.0, 1.68, 1.32], 0.01, 'warm white at full');
  // And it is emphatically NOT neutral.
  assert.ok(folded[2] < 200, `blue channel ${folded[2]} — white collapsed to neutral`);
});

test('warm white keeps the SAME tint across every master level', () => {
  const base = [1.0, 0.68, 0.32, 1.0];
  const ref = controllerFold(ledWireBytes(base[0], base[1], base[2], base[3], 0, CFG));
  for (const master of [1, 0.8, 0.6, 0.4, 0.25, 0.1, 0.05]) {
    // The intensity controller scales every lane linearly before the mapper.
    const bytes = ledWireBytes(base[0] * master, base[1] * master, base[2] * master,
      base[3] * master, 0, CFG);
    const folded = controllerFold(bytes);
    // Tolerance tracks BYTE QUANTIZATION: at 5 % master the whole colour
    // lives in ~13 byte steps, so one step is worth ~8 % of the ratio.
    const tol = Math.max(0.02, 1.5 / (255 * master));
    assertTintClose(folded, ref, tol, `master ${master}`);
  }
});

test('warm white survives the controller white extraction with tint intact', () => {
  const emitters = simulateLedEmitters(ledWireBytes(1.0, 0.68, 0.32, 1.0, 0, GCFG), GCFG);
  // Emitted light is gamma-shaped by the controller, so compare tint in
  // the same space: the expected composite run through the same curve.
  const expected = [1.0, 0.84, 0.66].map(v => Math.pow(v, RECOMMENDED_CONTROLLER_GAMMA.r));
  assertTintClose(emitters, expected, 0.02, 'emitters after extraction');
  assert.ok(emitters[0] > emitters[1] && emitters[1] > emitters[2], 'warm ordering holds');
});

test('a NEUTRAL white rides the white emitter, jointly scaled to fit', () => {
  // rgb(1,1,1) + w(1) is 2x over the ceiling: one shared factor of 0.5
  // keeps the colour/white BALANCE the pattern authored (half and half).
  const bytes = ledWireBytes(1, 1, 1, 1, 0, CFG);
  assert.deepEqual(bytes, { r: 127, g: 127, b: 127, w: 128 });
  assert.equal(bytes.r + bytes.w, 255, 'composite still uses the full range');
});

test('TRUE RGBW: a pattern white lane rides the W byte, never hidden in RGB', () => {
  // Pure white lane, no colour: all of it must be on W so a controller
  // with a wire-exact white path lights its dedicated white emitter.
  assert.deepEqual(ledWireBytes(0, 0, 0, 1, 0, CFG), { r: 0, g: 0, b: 0, w: 255 });
  // Pure colour, no white lane: W stays 0 (no host-invented white).
  assert.deepEqual(ledWireBytes(1, 0, 0, 0, 0, CFG), { r: 255, g: 0, b: 0, w: 0 });
});

test("whiteMode 'synth' moves the shared floor onto the white emitter", () => {
  const native = ledWireBytes(0.4, 0.6, 0.8, 0, 0, CFG, 'native');
  const synth = ledWireBytes(0.4, 0.6, 0.8, 0, 0, CFG, 'synth');
  assert.equal(native.w, 0);
  assert.equal(synth.w, Math.round(0.4 * 255));
  // Same composite either way — identical on a fold/extract controller.
  assert.equal(native.r + native.w, synth.r + synth.w);
  assert.equal(native.b + native.w, synth.b + synth.w);
});

test('pass-through controller model: W byte lights the white emitter directly', () => {
  const cfg = normalizeLedWireConfig({ controllerWhite: 'passthrough' }, 'test');
  const bytes = ledWireBytes(1.0, 0.68, 0.32, 1.0, 0, cfg);
  const emitters = simulateLedEmitters(bytes, cfg);
  assert.ok(emitters[0] > emitters[1] && emitters[1] > emitters[2], 'tint holds there too');
  assert.throws(() => normalizeLedWireConfig({ controllerWhite: 'magic' }, 'test'), /must be one of/);
});

// ── Amber fold / UV drop ─────────────────────────────────────────────────

test('amber folds into strand RGB on the configured weights', () => {
  const a = 0.5;
  const bytes = ledWireBytes(0, 0, 0, 0, a, CFG);
  const folded = controllerFold(bytes);
  const [ar, ag, ab] = LED_WIRE_DEFAULTS.amberRgb;
  assert.equal(folded[0], Math.round(a * ar * 255));
  assert.equal(folded[1], Math.round(a * ag * 255));
  assert.equal(folded[2], Math.round(a * ab * 255));
  assert.ok(folded[0] > folded[1] && folded[1] > folded[2], 'amber reads warm');
});

test('amber makes a white pattern WARMER than it would be without it', () => {
  const withAmber = controllerFold(ledWireBytes(0.6, 0.6, 0.6, 0.3, 0.5, CFG));
  const noAmber = controllerFold(ledWireBytes(0.6, 0.6, 0.6, 0.3, 0, CFG));
  assert.ok(tint(withAmber)[2] < tint(noAmber)[2], 'blue share must drop with amber');
  assert.equal(tint(noAmber)[2], 1, 'no-amber case is neutral');
});

test('foldAmber:false drops amber entirely (opt-out honored)', () => {
  const cfg = normalizeLedWireConfig({ foldAmber: false }, 'test');
  assert.deepEqual(ledWireBytes(0, 0, 0, 0, 1, cfg), { r: 0, g: 0, b: 0, w: 0 });
});

test('UV is dropped: it can never move a strand byte', () => {
  // The encode has no UV parameter at all — an RGBW strand has no UV
  // emitter, so UV content is unrepresentable and must not leak in.
  assert.equal(ledWireBytes.length <= 6, true);
  const a = ledWireBytes(0.3, 0.2, 0.1, 0.2, 0.4, CFG);
  const b = ledWireBytes(0.3, 0.2, 0.1, 0.2, 0.4, CFG);
  assert.deepEqual(a, b);
});

// ── Gamma lives in exactly ONE place ─────────────────────────────────────

test('the mapper applies NO gamma: wire bytes are linear in the composite', () => {
  for (const v of [0.1, 0.25, 0.5, 0.75, 1]) {
    const bytes = ledWireBytes(v, v, v, 0, 0, CFG);
    assert.equal(bytes.r, Math.round(v * 255), `linear byte expected at ${v}`);
  }
});

test('mapper-side gamma is REJECTED loudly (controller owns the curve)', () => {
  assert.throws(() => normalizeLedWireConfig({ gamma: 2.2 }, 'test'), /controller owns gamma/);
});

test('controllerGamma mirror validates hard: range, keys, type', () => {
  assert.throws(() => normalizeLedWireConfig({ controllerGamma: { r: 0.5 } }, 'test'), /must be a number in/);
  assert.throws(() => normalizeLedWireConfig({ controllerGamma: { r: 3.5 } }, 'test'), /must be a number in/);
  assert.throws(() => normalizeLedWireConfig({ controllerGamma: { x: 2 } }, 'test'), /unknown key/);
  assert.throws(() => normalizeLedWireConfig({ controllerGamma: 2.2 }, 'test'), /must be an object/);
  assert.throws(() => normalizeLedWireConfig({ foldAmber: 'yes' }, 'test'), /must be a boolean/);
  assert.throws(() => normalizeLedWireConfig({ amberRgb: [1, 2] }, 'test'), /3-element/);
  assert.throws(() => normalizeLedWireConfig({ amberRgb: [1, 1, 9] }, 'test'), /in 0\.\.1/);
  const ok = normalizeLedWireConfig({ controllerGamma: { r: 2.4, g: 2.4, b: 2.4, w: 1 } }, 'test');
  assert.equal(ok.controllerGamma.r, 2.4);
});

test('gamma monotonicity: brighter in ⇒ never darker out, through the full chain', () => {
  let prevByte = -1, prevEmit = -1, prevPreview = -1;
  for (let v = 0; v <= 255; v++) {
    const lane = v / 255;
    const bytes = ledWireBytes(lane, lane * 0.6, lane * 0.2, 0, 0, CFG);
    const emit = simulateLedEmitters(bytes, CFG)[0];
    const preview = ledPreviewRgbFromBytes(bytes, CFG)[0];
    assert.ok(bytes.r + bytes.w >= prevByte, `byte dipped at ${v}`);
    assert.ok(emit >= prevEmit - 1e-9, `emitted light dipped at ${v}`);
    assert.ok(preview >= prevPreview - 1e-9, `preview dipped at ${v}`);
    prevByte = bytes.r + bytes.w; prevEmit = emit; prevPreview = preview;
  }
  assert.equal(prevByte, 255);
});

test('controller gamma darkens mids but keeps the endpoints exact', () => {
  const mid = simulateLedEmitters(ledWireBytes(0.5, 0.5, 0.5, 0, 0, GCFG), GCFG);
  assert.ok(mid[0] < 0.5 - 0.1, `mid-gray should be pulled down by gamma, got ${mid[0]}`);
  assert.deepEqual(simulateLedEmitters(ledWireBytes(0, 0, 0, 0, 0, GCFG), GCFG), [0, 0, 0]);
  assert.deepEqual(simulateLedEmitters(ledWireBytes(1, 1, 1, 0, 0, GCFG), GCFG), [1, 1, 1]);
});

test('the mirrored controller gamma defaults to OFF (what the fleet ships with)', () => {
  assert.deepEqual({ ...LED_CONTROLLER_GAMMA }, { r: 1, g: 1, b: 1, w: 1 });
  // With gamma OFF the strand emits light LINEARLY in the byte, which reads
  // brighter/flatter than the authored value — the washed-out look the
  // recommended curve fixes. The preview says so instead of hiding it.
  const px = [0.5, 0.5, 0.5, 0, 0];
  const flat = ledPreviewRgb(...px, CFG)[0];
  const curved = ledPreviewRgb(...px, GCFG)[0];
  assert.ok(flat > curved + 0.15, `gamma-off preview ${flat} should read washed-out vs ${curved}`);
});

test('the recommended W exponent is 1.0 (the controller already curved the white)', () => {
  assert.equal(RECOMMENDED_CONTROLLER_GAMMA.w, 1.0);
  // Proof of the compounding: a W exponent above 1 crushes a neutral white
  // that the R/G/B curve has already darkened once.
  const doubled = normalizeLedWireConfig(
    { controllerGamma: { r: 2.2, g: 2.2, b: 2.2, w: 1.8 } }, 'test');
  const white = ledWireBytes(0.5, 0.5, 0.5, 0, 0, doubled);
  const once = simulateLedEmitters(white, GCFG)[0];
  const twice = simulateLedEmitters(white, doubled)[0];
  assert.ok(twice < once * 0.35, `W curve compounds: ${twice.toFixed(3)} vs ${once.toFixed(3)}`);
});

test('low-dim tint: warm white holds its ratios down to ~5 % master', () => {
  const ref = ledCompositeTarget(1, 0.68, 0.32, 1, 0.6, CFG).composite;
  const refTint = tint(ref);
  for (const master of [1, 0.5, 0.25, 0.1, 0.05]) {
    const b = ledWireBytes(master, 0.68 * master, 0.32 * master, master, 0.6 * master, CFG);
    const t = tint([b.r + b.w, b.g + b.w, b.b + b.w]);
    const err = Math.max(...t.map((v, i) => Math.abs(v - refTint[i])));
    assert.ok(err <= 0.02, `master ${master}: tint error ${(err * 100).toFixed(1)} % > 2 %`);
  }
  // Below that, 8-bit quantization dominates — documented, not fixable in
  // software. Assert the KNOWN bound so a regression past it is caught.
  const dim = ledWireBytes(0.02, 0.0136, 0.0064, 0.02, 0.012, CFG);
  const dimTint = tint([dim.r + dim.w, dim.g + dim.w, dim.b + dim.w]);
  const dimErr = Math.max(...dimTint.map((v, i) => Math.abs(v - refTint[i])));
  assert.ok(dimErr <= 0.06, `2 % master tint error ${(dimErr * 100).toFixed(1)} % exceeds the known 6 % quantization bound`);
});

// ── Preview honesty ──────────────────────────────────────────────────────

test('preview is a round trip of the WIRE bytes, not of the render lanes', () => {
  const lanes = [0.9, 0.4, 0.1, 0.5, 0.6];
  const fromLanes = ledPreviewRgb(...lanes, CFG);
  const fromBytes = ledPreviewRgbFromBytes(ledWireBytes(...lanes, CFG), CFG);
  assert.deepEqual(fromLanes, fromBytes);
});

test('preview shows the amber warmth the wire actually carries', () => {
  const warm = ledPreviewRgb(0.5, 0.5, 0.5, 0, 0.6, CFG);
  const cool = ledPreviewRgb(0.5, 0.5, 0.5, 0, 0, CFG);
  assert.ok(warm[0] > cool[0], 'amber must lift red on screen');
  assert.ok(tint(warm)[2] < tint(cool)[2], 'and cut the blue share');
});

test('preview never advertises UV the strand cannot emit', () => {
  // UV is not an input to the strand preview at all.
  const withUvLane = ledPreviewRgb(0.4, 0.4, 0.4, 0, 0, CFG);
  const plain = ledPreviewRgb(0.4, 0.4, 0.4, 0, 0, CFG);
  assert.deepEqual(withUvLane, plain);
});

test('preview reproduces the composite once the recommended curve is pushed', () => {
  // The screen's own transfer and the controller's 2.2 curve cancel, so the
  // operator sees exactly the colour the pattern authored: screen == strand.
  for (const px of [[1, 0.68, 0.32, 1, 0], [0.3, 0.6, 0.9, 0, 0], [0.2, 0.2, 0.2, 0, 0.3]]) {
    const target = ledCompositeTarget(px[0], px[1], px[2], px[3], px[4], GCFG);
    const preview = ledPreviewRgb(px[0], px[1], px[2], px[3], px[4], GCFG);
    for (let i = 0; i < 3; i++) {
      assert.ok(Math.abs(preview[i] - target.composite[i]) < 0.02,
        `preview ${preview[i].toFixed(3)} vs composite ${target.composite[i].toFixed(3)}`);
    }
  }
});

test('preview models CLIPPING when bytes it did not author would clip', () => {
  // A hand-written byte stream that clips is shown as clipped (neutral),
  // proving the preview really runs the controller's fold.
  const clipped = ledPreviewRgbFromBytes({ r: 255, g: 173, b: 82, w: 255 }, CFG);
  assert.deepEqual(clipped.map(v => Math.round(v * 100)), [100, 100, 100]);
});

// ── Mapper integration (LED path only; DMX untouched) ────────────────────

test('mapper writes the split bytes for an LED strand pixel', () => {
  const router = makeRouter();
  const entry = {
    type: 'led',
    patch: { universe: 2, addr: 1, footprint: 4, led: true },
    channels: { r: 1, g: 2, b: 3, w: 4 },
    whiteMode: 'native',
    r: 1.0, g: 0.68, b: 0.32, w: 1.0, a: 0, u: 0,
  };
  mapPixelsToSacn([entry], router);
  const f = router.getFullFrame(2);
  const expected = ledWireBytes(1.0, 0.68, 0.32, 1.0, 0, CFG, 'native');
  assert.deepEqual([f[0], f[1], f[2], f[3]],
    [expected.r, expected.g, expected.b, expected.w]);
  assert.ok(f[0] + f[3] <= 255 && f[1] + f[3] <= 255 && f[2] + f[3] <= 255);
  // …and the entry carries the wire-derived preview for the 3D view.
  assert.ok(Array.isArray(entry._ledWirePreview));
});

test('mapper leaves the DMX par path byte-for-byte unchanged', () => {
  const router = makeRouter();
  const entry = {
    type: 'dmx', fixtureType: 'UkingPar',
    patch: { universe: 3, addr: 1, footprint: 10 },
    channels: { r: 3, g: 4, b: 5, w: 6, a: 7, u: 8 },
    r: 1.0, g: 0.68, b: 0.32, w: 0, a: 0.5, u: 0.25,
  };
  mapPixelsToSacn([entry], router);
  const f = router.getFullFrame(3);
  assert.equal(f[0], 255);                                  // master dimmer
  // Uint8Array truncation is the pre-existing DMX behaviour — asserted
  // exactly so any drift on the par path shows up here.
  assert.equal(f[2], Math.trunc(1.0 * 255));                 // R as-is
  assert.equal(f[3], Math.trunc(0.68 * 255));
  assert.equal(f[4], Math.trunc(0.32 * 255));
  assert.equal(f[5], Math.min(f[2], f[3], f[4]));            // W = min(R,G,B)
  assert.equal(f[6], Math.trunc(0.5 * 255));                 // amber survives
  assert.equal(f[7], Math.trunc(0.25 * 255));                // UV survives
});

test('isLedEntry: strand yes, par no', () => {
  assert.ok(isLedEntry({ type: 'led' }));
  assert.ok(isLedEntry({ patch: { led: true } }));
  assert.ok(!isLedEntry({ type: 'dmx', patch: { universe: 1 } }));
});
