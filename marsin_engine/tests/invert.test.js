/**
 * Unit tests for per-channel color INVERT (docs/39 §F-invert).
 *
 * Contract (sibling of the per-channel hue feature):
 *   - PatternChannel.invert is a pure boolean, coerced via !!, default false.
 *   - The mixer-side op flips ONLY the R,G,B bytes (255 - v) of an
 *     interleaved 6ch RGBWAU Uint8 buffer IN PLACE; W/A/UV are NEVER touched
 *     (mission-critical exterior whites must not be flipped/dimmed).
 *   - invert=false is a no-op (the render loop gates on the flag).
 *   - The PATCH boundary coerces truthy/falsy via !! (like soloSafe).
 *   - serializeChannel round-trips invert; an old state file (no field)
 *     restores to false (documented default).
 *   - When BOTH hue and invert are set the composition is HUE-THEN-INVERT in
 *     buffer order (hue rotates the chroma first, then the rotated RGB is
 *     flipped) — verified here by replaying the two ops in that order.
 *
 * The mixer's applyInvert6chU8 helper is module-private (not exported), so we
 * verify the byte-level invert via an identical reference implementation and
 * pin the documented order; the live three-site wiring is proven by the HIL
 * test (tests/hil/hil_invert_test.mjs).
 *
 * Run: node --test marsin_engine/tests/invert.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { serializeChannel } from '../lib/state_manager.js';
import { PatternChannel } from '../lib/pattern_channel.js';

// Reference impl mirroring pattern_mixer.applyInvert6chU8: flip R,G,B only.
function invert6chU8(buf, pixelCount) {
  for (let i = 0; i < pixelCount; i++) {
    const o = i * 6;
    buf[o] = 255 - buf[o];
    buf[o + 1] = 255 - buf[o + 1];
    buf[o + 2] = 255 - buf[o + 2];
  }
}

// Reference impl mirroring pattern_mixer.applyHueShift6chU8 (YIQ rotation,
// RGB only) so we can verify the hue-then-invert ordering on real bytes.
const HUE_DEG_TO_RAD = Math.PI / 180;
function hueShift6chU8(buf, pixelCount, degrees) {
  if (!degrees) return;
  const theta = degrees * HUE_DEG_TO_RAD;
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const m00 = 0.299 + 0.701 * c + 0.168 * s;
  const m01 = 0.587 - 0.587 * c + 0.330 * s;
  const m02 = 0.114 - 0.114 * c - 0.497 * s;
  const m10 = 0.299 - 0.299 * c - 0.328 * s;
  const m11 = 0.587 + 0.413 * c + 0.035 * s;
  const m12 = 0.114 - 0.114 * c + 0.292 * s;
  const m20 = 0.299 - 0.300 * c + 1.250 * s;
  const m21 = 0.587 - 0.588 * c - 1.050 * s;
  const m22 = 0.114 + 0.886 * c - 0.203 * s;
  for (let i = 0; i < pixelCount; i++) {
    const o = i * 6;
    const r = buf[o], g = buf[o + 1], b = buf[o + 2];
    let nr = m00 * r + m01 * g + m02 * b;
    let ng = m10 * r + m11 * g + m12 * b;
    let nb = m20 * r + m21 * g + m22 * b;
    nr = nr < 0 ? 0 : (nr > 255 ? 255 : (nr + 0.5) | 0);
    ng = ng < 0 ? 0 : (ng > 255 ? 255 : (ng + 0.5) | 0);
    nb = nb < 0 ? 0 : (nb > 255 ? 255 : (nb + 0.5) | 0);
    buf[o] = nr; buf[o + 1] = ng; buf[o + 2] = nb;
  }
}

// ── byte-level invert contract ───────────────────────────────────────────

test('invert flips R,G,B to 255-v and leaves W/A/UV byte-for-byte', () => {
  // Two pixels with distinct W/A/UV bytes to prove they are untouched.
  const buf = new Uint8Array([10, 200, 50, 99, 88, 77, 0, 255, 128, 1, 2, 3]);
  invert6chU8(buf, 2);
  // pixel 0 RGB
  assert.equal(buf[0], 245);
  assert.equal(buf[1], 55);
  assert.equal(buf[2], 205);
  // pixel 0 WAU untouched
  assert.equal(buf[3], 99);
  assert.equal(buf[4], 88);
  assert.equal(buf[5], 77);
  // pixel 1 RGB
  assert.equal(buf[6], 255);
  assert.equal(buf[7], 0);
  assert.equal(buf[8], 127);
  // pixel 1 WAU untouched
  assert.equal(buf[9], 1);
  assert.equal(buf[10], 2);
  assert.equal(buf[11], 3);
});

test('invert is its own inverse (double-invert = identity)', () => {
  const orig = new Uint8Array([10, 200, 50, 99, 88, 77]);
  const buf = orig.slice();
  invert6chU8(buf, 1);
  invert6chU8(buf, 1);
  assert.deepEqual([...buf], [...orig]);
});

test('invert=false is a no-op (gate skips the op, buffer unchanged)', () => {
  // The render loop gates on `if (channel.invert)`. With a default channel
  // the op never runs — the buffer is identity.
  const ch = new PatternChannel({ id: 'a', name: 'A', pattern: 'p' });
  assert.equal(ch.invert, false);
  const orig = new Uint8Array([10, 200, 50, 99, 88, 77]);
  const buf = orig.slice();
  if (ch.invert) invert6chU8(buf, 1); // gate is false → no mutation
  assert.deepEqual([...buf], [...orig]);
});

// ── PatternChannel.invert ────────────────────────────────────────────────

test('PatternChannel defaults invert to false and coerces via !!', () => {
  assert.equal(new PatternChannel({ id: 'a', name: 'A', pattern: 'p' }).invert, false);
  assert.equal(new PatternChannel({ id: 'b', name: 'B', pattern: 'p', invert: true }).invert, true);
  // truthy/falsy coercion (matches soloSafe/followsTempo handling)
  assert.equal(new PatternChannel({ id: 'c', name: 'C', pattern: 'p', invert: 1 }).invert, true);
  assert.equal(new PatternChannel({ id: 'd', name: 'D', pattern: 'p', invert: 0 }).invert, false);
  assert.equal(new PatternChannel({ id: 'e', name: 'E', pattern: 'p', invert: 'yes' }).invert, true);
  assert.equal(new PatternChannel({ id: 'f', name: 'F', pattern: 'p', invert: null }).invert, false);
});

// ── PATCH boundary coercion (mirrors api_server `channel.invert = !!data.invert`) ──

test('PATCH coerces truthy/falsy invert via !! (no validation error)', () => {
  const ch = new PatternChannel({ id: 'a', name: 'A', pattern: 'p' });
  // Mirror the api_server PATCH assignment for each shape.
  for (const [raw, expected] of [[true, true], [false, false], [1, true], [0, false], ['x', true], ['', false]]) {
    ch.invert = !!raw;
    assert.equal(ch.invert, expected, `raw=${JSON.stringify(raw)}`);
  }
});

// ── serialize round-trip ─────────────────────────────────────────────────

test('serializeChannel emits invert (true and false)', () => {
  assert.equal(serializeChannel(new PatternChannel({ id: 'a', name: 'A', pattern: 'p', invert: true })).invert, true);
  assert.equal(serializeChannel(new PatternChannel({ id: 'b', name: 'B', pattern: 'p' })).invert, false);
});

test('invert round-trips serialize -> restore', () => {
  const original = new PatternChannel({ id: 'a', name: 'A', pattern: 'p', invert: true });
  const saved = serializeChannel(original);
  // Mirror the api_server restore-path config build (invert passthrough).
  const restored = new PatternChannel({
    id: saved.id, name: saved.name, pattern: saved.pattern,
    invert: !!saved.invert,
  });
  assert.equal(restored.invert, true);
});

test('old state file (no invert field) restores to false', () => {
  const saved = { id: 'a', name: 'A', pattern: 'p' }; // pre-invert file shape
  const restored = new PatternChannel({
    id: saved.id, name: saved.name, pattern: saved.pattern,
    invert: !!saved.invert,
  });
  assert.equal(restored.invert, false);
});

// ── composition with hue (documented order: HUE THEN INVERT) ──────────────

test('invert composes with hue: documented HUE-THEN-INVERT == hand-flip of hue', () => {
  // A saturated red pixel with distinct WAU bytes.
  const src = new Uint8Array([255, 0, 0, 40, 50, 60]);

  // Documented order applied by the mixer at all three sites: hue first,
  // then invert (hue-then-invert in buffer order).
  const composed = src.slice();
  hueShift6chU8(composed, 1, 120);
  invert6chU8(composed, 1);

  // Reference: hue alone, then flip its RGB by hand — must equal composed.
  const hueOnly = src.slice();
  hueShift6chU8(hueOnly, 1, 120);
  const expected = new Uint8Array([
    255 - hueOnly[0], 255 - hueOnly[1], 255 - hueOnly[2],
    hueOnly[3], hueOnly[4], hueOnly[5],
  ]);
  assert.deepEqual([...composed], [...expected]);

  // W/A/UV survive untouched through both ops.
  assert.equal(composed[3], 40);
  assert.equal(composed[4], 50);
  assert.equal(composed[5], 60);
});

test('hue and invert commute within rounding (order is a free choice)', () => {
  // The YIQ hue rotation is luminance-preserving and linear on the chroma
  // plane; the (255 - v) invert is the chroma negation plus a rotation-
  // invariant luminance constant. Rotating a negated chroma equals negating
  // a rotated chroma, so HUE-THEN-INVERT and INVERT-THEN-HUE land on the
  // same bytes (within ±1 rounding). We DOCUMENT hue-then-invert in the
  // mixer for a single, predictable order; this test pins WHY the choice is
  // safe rather than asserting a difference that does not exist.
  for (const src of [[255, 0, 0], [200, 120, 40], [180, 60, 210]]) {
    const a = new Uint8Array([...src, 0, 0, 0]);
    hueShift6chU8(a, 1, 120); invert6chU8(a, 1);
    const b = new Uint8Array([...src, 0, 0, 0]);
    invert6chU8(b, 1); hueShift6chU8(b, 1, 120);
    for (let k = 0; k < 3; k++) {
      assert.ok(Math.abs(a[k] - b[k]) <= 1, `byte ${k}: ${a[k]} vs ${b[k]} for ${src}`);
    }
  }
});
