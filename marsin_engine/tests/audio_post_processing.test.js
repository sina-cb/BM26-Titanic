// Unit tests for the shared per-signal post-processing framework
// (lib/audio_post_processing.js).
//
// This module is the seed of the per-signal node chain (docs/29) and is
// used by BOTH the analyzer (mic side) and the OSC listener (stems
// side). Behavior here is load-bearing for both — any divergence means
// the operator's knobs behave differently for mic vs stems, which is
// exactly the class of bug the shared module exists to prevent. Pin
// every property of the contract.
//
// Run:  cd marsin_engine && node --test tests/audio_post_processing.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  processSignal,
  processAndPair,
  applyGain,
  GAIN_BY_KEY,
} from '../lib/audio_post_processing.js';

/** Minimal CPC stand-in matching the real ParamCenter.get contract:
 *  unknown key throws (Codex P0 — no silent fallback). */
function makeParamCenter(initial = {}) {
  const store = { ...initial };
  return {
    _store: store,
    get(key) {
      if (!(key in store)) throw new Error(`ParamCenter.get: unknown key ${key}`);
      return store[key];
    },
    set(key, v) { store[key] = v; },
  };
}

// ── GAIN_BY_KEY map ──────────────────────────────────────────────────────

test('GAIN_BY_KEY exports the canonical signalKey → gainKey map for mic + stems', () => {
  // Pinning the exact set so adding a new gainable live key requires
  // an intentional change to this test (which forces the contributor
  // to also add it to the CPC registry).
  assert.deepEqual(
    Object.keys(GAIN_BY_KEY).sort(),
    ['micHigh', 'micKick', 'micLow', 'micMid', 'stemsBass', 'stemsDrums', 'stemsVocals'],
  );
  assert.equal(GAIN_BY_KEY.micLow,      'micLowGain');
  assert.equal(GAIN_BY_KEY.stemsBass,   'stemsBassGain');
  assert.equal(GAIN_BY_KEY.stemsVocals, 'stemsVocalsGain');
});

test('GAIN_BY_KEY is frozen (no accidental runtime mutation)', () => {
  assert.ok(Object.isFrozen(GAIN_BY_KEY));
  assert.throws(() => { GAIN_BY_KEY.micLow = 'somethingElse'; });
});

// ── processSignal — core contract ────────────────────────────────────────

test('identity: gain 1.0 × raw 0.5 → 0.5 (V1 pipeline = gain × clamp)', () => {
  const pc = makeParamCenter({ micLowGain: 1.0 });
  assert.equal(processSignal(pc, 'micLow', 0.5), 0.5);
});

test('linear scaling: gain 2.0 × raw 0.4 → 0.8', () => {
  const pc = makeParamCenter({ micLowGain: 2.0 });
  // 2 * 0.4 is exactly representable in IEEE-754.
  assert.equal(processSignal(pc, 'micLow', 0.4), 0.8);
});

test('clamping: gain 5.0 × raw 0.4 → clamp at 1.0 (NOT 2.0, NOT NaN)', () => {
  const pc = makeParamCenter({ stemsBassGain: 5.0 });
  const out = processSignal(pc, 'stemsBass', 0.4);
  assert.equal(out, 1.0, `expected clamp to 1.0, got ${out}`);
});

test('zero gain: gain 0.0 × raw 0.7 → 0.0', () => {
  const pc = makeParamCenter({ micKickGain: 0.0 });
  assert.equal(processSignal(pc, 'micKick', 0.7), 0);
});

test('zero raw: gain 1.5 × raw 0.0 → 0.0', () => {
  const pc = makeParamCenter({ micLowGain: 1.5 });
  assert.equal(processSignal(pc, 'micLow', 0.0), 0);
});

// ── Codex P0 — no silent fallback ────────────────────────────────────────

test('Codex P0: unknown signalKey throws (programmer error — never identity)', () => {
  const pc = makeParamCenter({ micLowGain: 1.0 });
  assert.throws(
    () => processSignal(pc, 'notARealSignal', 0.5),
    /unknown signalKey "notARealSignal"/,
    'processSignal must throw on a signalKey not in GAIN_BY_KEY — silent identity is the bug we exist to prevent',
  );
});

test('Codex P0: missing gainKey in paramCenter throws (propagates paramCenter.get error)', () => {
  // micLow is a valid signalKey, but micLowGain absent from the
  // paramCenter — processSignal must propagate the get() throw.
  const pc = makeParamCenter({ stemsBassGain: 1.0 });  // micLowGain absent
  assert.throws(
    () => processSignal(pc, 'micLow', 0.5),
    /unknown key micLowGain/,
    'processSignal must propagate paramCenter.get throw, never silently fall back to gain 1.0',
  );
});

test('Codex P0: processSignal does not catch — a throwing paramCenter surfaces immediately', () => {
  const exploding = { get() { throw new Error('shutdown'); } };
  assert.throws(() => processSignal(exploding, 'micLow', 0.5), /shutdown/);
});

// ── Defensive output clamping ────────────────────────────────────────────

test('negative-input safety: raw -0.1 clamps to 0 (defensive — shouldn\'t happen)', () => {
  // Live-key contract says raw ∈ [0, 1], but a future op upstream of
  // gain might emit signed values; pinning the output to [0, 1]
  // protects downstream consumers regardless of input pathology.
  const pc = makeParamCenter({ micLowGain: 1.0 });
  assert.equal(processSignal(pc, 'micLow', -0.1), 0);
});

test('negative gain × positive raw → 0 (clamp, no negative leak)', () => {
  // A negative gain is illegal per CPC range [0, 2], but if one ever
  // slips through (registry override bug, persisted bad value) the
  // helper must still produce a normalized value.
  const pc = makeParamCenter({ micLowGain: -1.5 });
  assert.equal(processSignal(pc, 'micLow', 0.5), 0);
});

test('NaN gain × raw → 0 (no NaN leak into CPC live keys)', () => {
  const pc = makeParamCenter({ micLowGain: Number.NaN });
  assert.equal(processSignal(pc, 'micLow', 0.5), 0);
});

test('Infinity gain × positive raw → 1 (clamp at ceiling, not Infinity)', () => {
  const pc = makeParamCenter({ micLowGain: Number.POSITIVE_INFINITY });
  // gained = +Infinity, which is > 0 and not < 1 → returns 1 by contract.
  assert.equal(processSignal(pc, 'micLow', 0.5), 1);
});

// ── Cross-signal independence ────────────────────────────────────────────

test('processSignal reads ONLY the requested signal\'s gainKey (no cross-key leakage)', () => {
  const pc = makeParamCenter({
    micLowGain: 1.0, micMidGain: 2.0, micHighGain: 0.5,
  });
  assert.equal(processSignal(pc, 'micLow',  0.3), 0.3);
  assert.equal(processSignal(pc, 'micMid',  0.3), 0.6);
  assert.equal(processSignal(pc, 'micHigh', 0.3), 0.15);
});

test('mid-stream gain change takes effect on the very next call (no caching)', () => {
  // Regression for "operator twists knob → meter must move now".
  // processSignal reads paramCenter EVERY call; a cached gain would
  // break the operator's feedback loop.
  const pc = makeParamCenter({ stemsBassGain: 1.0 });
  assert.equal(processSignal(pc, 'stemsBass', 0.4), 0.4);
  pc.set('stemsBassGain', 1.5);
  // 1.5 * 0.4 ≈ 0.6 (binary-float fuzz on the trailing bit).
  const out = processSignal(pc, 'stemsBass', 0.4);
  assert.ok(Math.abs(out - 0.6) < 1e-9, `expected ~0.6 after gain change, got ${out}`);
});

// ── processAndPair (raw + post helper) ───────────────────────────────────

test('processAndPair returns the raw input alongside the post-processed value', () => {
  const pc = makeParamCenter({ micLowGain: 2.0 });
  const { raw, post } = processAndPair(pc, 'micLow', 0.3);
  assert.equal(raw,  0.3);
  assert.equal(post, 0.6);
});

test('processAndPair raw is unchanged even when post is clamped', () => {
  // Important contract for the SIGNAL DIAGNOSTICS panel — operator
  // needs to SEE that raw was above 1.0 even when post is clipped.
  const pc = makeParamCenter({ micLowGain: 5.0 });
  const { raw, post } = processAndPair(pc, 'micLow', 0.4);
  assert.equal(raw,  0.4, 'raw must pass through untouched, even when post saturates');
  assert.equal(post, 1.0);
});

// ── applyGain — back-compat / deprecated alias ───────────────────────────

test('applyGain (deprecated) still works: gain 2.0 × raw 0.4 → 0.8', () => {
  // The deprecated API takes the gainKey directly instead of the
  // signalKey — kept for back-compat with any external importer that
  // hasn't migrated to processSignal yet.
  const pc = makeParamCenter({ micLowGain: 2.0 });
  assert.equal(applyGain(pc, 'micLowGain', 0.4), 0.8);
});

test('applyGain (deprecated): same clamp + defensive contract as processSignal', () => {
  const pc = makeParamCenter({ stemsBassGain: 5.0 });
  assert.equal(applyGain(pc, 'stemsBassGain', 0.4), 1.0);
  pc.set('stemsBassGain', Number.NaN);
  assert.equal(applyGain(pc, 'stemsBassGain', 0.5), 0);
});

test('applyGain (deprecated): unknown gainKey throws (Codex P0 unchanged)', () => {
  const pc = makeParamCenter({ micLowGain: 1.0 });
  assert.throws(
    () => applyGain(pc, 'micMidGain', 0.5),
    /unknown key micMidGain/,
  );
});
