/**
 * Unit tests for E10 Frost Sparkle (effects/frost_sparkle.js).
 *
 * Contract:
 *   - createSparkleState({rng?}) → explicit state (lazy spark array + clock).
 *   - applyFrostSparkle spawns glints into a lazy per-pixel energy array,
 *     draws them additively into px.w ONLY (survives downstream hue/invert),
 *     and decays each frame.
 *   - R/G/B/A/U are NEVER written on a black frame beyond the W glint.
 *   - enabled=false is a no-op; resetSparkle clears live glints.
 *   - audioDensity adds signals.micHigh; signals absent/undefined ⇒ 0, never throws.
 *   - Missing pixels/state throws (Codex P0).
 *
 * Determinism: tests inject an rng.
 *
 * Run: node --test marsin_engine/tests/frost_sparkle.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyFrostSparkle,
  createSparkleState,
  resetSparkle,
} from '../../effects/frost_sparkle.js';

function blackPx() {
  return { r: 0, g: 0, b: 0, w: 0, a: 0, u: 0 };
}
function blackFrame(n) {
  return Array.from({ length: n }, blackPx);
}

// An rng that walks a fixed script, then returns 0 forever.
function scriptedRng(values) {
  let i = 0;
  return () => (i < values.length ? values[i++] : 0);
}

test('spawns a glint into px.w and touches no other channel on a black frame', () => {
  // density high enough to spawn exactly 1 on a 4-px frame: expected = 1*4*1 = 4.
  // First rng() consumed for the fractional spawn check (expected is integer 4 → frac 0,
  // so no fractional draw), then 4 index picks.
  const st = createSparkleState({ rng: scriptedRng([0.0, 0.25, 0.5, 0.75]) });
  const p = blackFrame(4);
  applyFrostSparkle({
    pixels: p, state: st, enabled: true, nowMs: 0, density: 1, decayMs: 200, intensity: 1,
  });
  // With expected=4 (integer), toSpawn=4 → every pixel gets a glint at peak 1.
  for (const px of p) {
    assert.equal(px.w, 1, 'glint lands in W');
    assert.equal(px.r, 0);
    assert.equal(px.g, 0);
    assert.equal(px.b, 0);
    assert.equal(px.a, 0);
    assert.equal(px.u, 0);
  }
  assert.equal(st.activeCount, 4);
});

test('a spawned glint decays over subsequent frames and clears to 0', () => {
  const st = createSparkleState({ rng: scriptedRng([0.1]) }); // 1 index pick at idx 0
  const p = blackFrame(1);
  // expected = 1*1*1 = 1 (integer) → 1 spawn at idx floor(0.1*1)=0. Drawn at
  // full peak this frame; the ARRAY energy is decayed for future frames.
  applyFrostSparkle({ pixels: p, state: st, enabled: true, nowMs: 0, density: 1, decayMs: 50 });
  assert.equal(p[0].w, 1);
  // After the spawn frame the stored energy is already partially decayed
  // (exp(-25/50) ≈ 0.606) but still alive.
  assert.ok(st.spark[0] > 0 && st.spark[0] < 1, `expected partial energy, got ${st.spark[0]}`);

  // Next frame: density 0 so no new spawns; the stored energy decays further.
  const before = st.spark[0];
  applyFrostSparkle({ pixels: p, state: st, enabled: true, nowMs: 25, density: 0, decayMs: 50 });
  assert.ok(st.spark[0] < before, `energy should keep decaying (${st.spark[0]} !< ${before})`);

  // Keep decaying until dead; the array cell must reach exactly 0 and
  // activeCount drop to 0.
  for (let t = 50; t <= 1000 && st.activeCount > 0; t += 25) {
    applyFrostSparkle({ pixels: p, state: st, enabled: true, nowMs: t, density: 0, decayMs: 50 });
  }
  assert.equal(st.activeCount, 0);
  assert.equal(st.spark[0], 0);
});

test('enabled=false is a no-op (no spawn, no pixel touch)', () => {
  const st = createSparkleState({ rng: scriptedRng([0.1, 0.2, 0.3]) });
  const p = blackFrame(3);
  applyFrostSparkle({ pixels: p, state: st, enabled: false, nowMs: 0, density: 1 });
  for (const px of p) assert.equal(px.w, 0);
  assert.equal(st.spark, null); // never even allocated
});

test('resetSparkle clears all live glints (panicStop path)', () => {
  const st = createSparkleState({ rng: scriptedRng([0.1, 0.4, 0.7]) });
  const p = blackFrame(3);
  applyFrostSparkle({ pixels: p, state: st, enabled: true, nowMs: 0, density: 1, decayMs: 500 });
  assert.ok(st.activeCount > 0);
  resetSparkle(st);
  assert.equal(st.activeCount, 0);
  for (let i = 0; i < st.spark.length; i++) assert.equal(st.spark[i], 0);
});

test('audioDensity adds signals.micHigh SCALED x0.15 to the spawn density', () => {
  // density 0, micHigh=1 → effective density 0.15 (scaled — unscaled it was a
  // full-rig white flash 5x the Blizzard ceiling; R2 guard 2026-07-10). With
  // the scripted rng only 0.0 < 0.15 ⇒ exactly 1 of 4 px spawns.
  const st = createSparkleState({ rng: scriptedRng([0.0, 0.25, 0.5, 0.75]) });
  const p = blackFrame(4);
  applyFrostSparkle({
    pixels: p, state: st, enabled: true, nowMs: 0,
    density: 0, decayMs: 200, audioDensity: true, signals: { micHigh: 1 },
  });
  assert.equal(st.activeCount, 1);
});

test('audioDensity is safe when signals is undefined (treats micHigh as 0)', () => {
  const st = createSparkleState({ rng: scriptedRng([]) });
  const p = blackFrame(4);
  // density 0 + no signals ⇒ 0 spawns, no throw.
  assert.doesNotThrow(() =>
    applyFrostSparkle({
      pixels: p, state: st, enabled: true, nowMs: 0,
      density: 0, audioDensity: true, /* signals omitted */
    })
  );
  assert.equal(st.activeCount, 0);
});

test('audioDensity is safe when signals lacks micHigh', () => {
  const st = createSparkleState({ rng: scriptedRng([]) });
  const p = blackFrame(2);
  assert.doesNotThrow(() =>
    applyFrostSparkle({
      pixels: p, state: st, enabled: true, nowMs: 0,
      density: 0, audioDensity: true, signals: { micLow: 0.5 },
    })
  );
  assert.equal(st.activeCount, 0);
});

test('glint adds onto existing W without clobbering it, and clamps to 1', () => {
  const st = createSparkleState({ rng: scriptedRng([0.0]) });
  const p = [{ r: 0.2, g: 0.3, b: 0.4, w: 0.7, a: 0.1, u: 0.05 }];
  // expected = 1*1*1 = 1 spawn at idx 0, peak intensity 0.6 → w = 0.7 + 0.6 = 1.3 → clamp 1.
  applyFrostSparkle({ pixels: p, state: st, enabled: true, nowMs: 0, density: 1, intensity: 0.6 });
  assert.equal(p[0].w, 1);
  // RGB / A / U preserved.
  assert.equal(p[0].r, 0.2);
  assert.equal(p[0].a, 0.1);
  assert.equal(p[0].u, 0.05);
});

test('zero density with an empty field skips the pixel loop (no glints appear)', () => {
  const st = createSparkleState({ rng: scriptedRng([]) });
  const p = blackFrame(5);
  applyFrostSparkle({ pixels: p, state: st, enabled: true, nowMs: 0, density: 0 });
  for (const px of p) assert.equal(px.w, 0);
  assert.equal(st.activeCount, 0);
});

test('reallocates the spark array when the pixel count changes', () => {
  const st = createSparkleState({ rng: scriptedRng([0.1]) });
  applyFrostSparkle({ pixels: blackFrame(3), state: st, enabled: true, nowMs: 0, density: 0 });
  assert.equal(st.spark.length, 3);
  applyFrostSparkle({ pixels: blackFrame(7), state: st, enabled: true, nowMs: 10, density: 0 });
  assert.equal(st.spark.length, 7);
});

test('throws on missing pixels or state (Codex P0)', () => {
  const st = createSparkleState();
  assert.throws(() => applyFrostSparkle({ state: st, enabled: true, nowMs: 0, density: 1 }));
  assert.throws(() => applyFrostSparkle({ pixels: blackFrame(1), enabled: true, nowMs: 0, density: 1 }));
});
