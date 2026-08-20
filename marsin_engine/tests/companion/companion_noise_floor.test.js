/*
 * companion_noise_floor.test.js — the NOISE-FLOOR APPLY feedback contract
 * (operator request 2026-08-03: "calibrate → apply shows nothing").
 *
 * What these pin, in the order the operator experiences them:
 *   1. READ-BACK NORMALIZATION — an engine `/audio/config` bands block or the
 *      live analyzer's bands become the companion's gate state; a per-band
 *      null is the documented "inherit the global gate", anything else missing
 *      or non-finite THROWS (codex P0: never invent a number to display).
 *   2. EFFECTIVE gates + the always-visible summary line the MIC TUNE page
 *      prints next to the calibrate control (and re-prints after a reload).
 *   3. VERIFICATION — what was requested vs. what the read-back says is in
 *      force, so an apply that didn't land can never render as a success.
 *   4. The one-line operator copy for every outcome (set / mismatch / failed).
 *   5. (report 20260725_132) WHICH read-back is authoritative — including the
 *      REFUSED-write case, where the engine is still up and still holding its
 *      own gates, so it is re-read once rather than leaving the operator with a
 *      readout nothing upstream ever accepted.
 *
 * Run:  cd marsin_engine && node --test tests/companion/companion_noise_floor.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  NOISE_BANDS, normalizeGateBundle, effectiveGates, formatGateSummary,
  verifyGateApply, formatApplyMessage, resolveGateReadBack,
} from '../../audio/companion/noise_floor.js';

// A realistic engine PATCH /audio/config response body's `bands` block.
const ENGINE_BANDS = {
  lowMaxHz: 200, midMaxHz: 2000, attackMs: 12, releaseMs: 120,
  inputGain: 2.5, sourceSmoothHz: 12000,
  noiseGate: 0.04, lowGate: 0.061, midGate: 0.043, highGate: 0.18,
};

test('NOISE_BANDS is the three gated bands in UI order', () => {
  assert.deepEqual([...NOISE_BANDS], ['low', 'mid', 'high']);
});

test('normalizeGateBundle reads an engine bands block', () => {
  assert.deepEqual(normalizeGateBundle(ENGINE_BANDS), {
    noiseGate: 0.04, lowGate: 0.061, midGate: 0.043, highGate: 0.18,
  });
});

test('normalizeGateBundle treats an absent/null per-band gate as "inherit global"', () => {
  const bundle = normalizeGateBundle({ noiseGate: 0.05, midGate: null });
  assert.deepEqual(bundle, { noiseGate: 0.05, lowGate: null, midGate: null, highGate: null });
});

test('normalizeGateBundle THROWS on a missing or non-finite global gate', () => {
  assert.throws(() => normalizeGateBundle({ lowGate: 0.1 }), /bands\.noiseGate is missing/);
  assert.throws(() => normalizeGateBundle({ noiseGate: 'x' }), /bands\.noiseGate is not finite/);
  assert.throws(() => normalizeGateBundle(null), /expected a bands object/);
});

test('normalizeGateBundle THROWS on a non-finite per-band gate (never displayed as a number)', () => {
  assert.throws(() => normalizeGateBundle({ noiseGate: 0.04, highGate: NaN }),
    /bands\.highGate is not finite/);
});

test('effectiveGates resolves per-band inheritance to what is actually gating', () => {
  assert.deepEqual(effectiveGates({ noiseGate: 0.04, lowGate: 0.061, midGate: null, highGate: 0.18 }),
    { low: 0.061, mid: 0.04, high: 0.18, global: 0.04 });
});

test('formatGateSummary is the always-visible one-liner, 3 dp, effective values', () => {
  assert.equal(
    formatGateSummary({ noiseGate: 0.04, lowGate: 0.061, midGate: null, highGate: 0.18 }),
    'low 0.061 · mid 0.040 · high 0.180 · global 0.040',
  );
});

test('verifyGateApply passes when the read-back matches the request', () => {
  const applied = effectiveGates(normalizeGateBundle(ENGINE_BANDS));
  const v = verifyGateApply({ requested: { low: 0.061, mid: 0.043, high: 0.18 }, applied });
  assert.equal(v.ok, true);
  assert.deepEqual(v.mismatches, []);
});

test('verifyGateApply ignores bands that were not part of the apply', () => {
  const applied = effectiveGates(normalizeGateBundle(ENGINE_BANDS));
  assert.equal(verifyGateApply({ requested: { low: 0.061 }, applied }).ok, true);
});

test('verifyGateApply FAILS when the engine clamped the value (no silent success)', () => {
  // Asked for 0.999+ → engine clamps; the read-back must be reported, not hidden.
  const applied = { low: 0.999, mid: 0.043, high: 0.18, global: 0.04 };
  const v = verifyGateApply({ requested: { low: 1.4, mid: 0.043, high: 0.18 }, applied });
  assert.equal(v.ok, false);
  assert.deepEqual(v.mismatches, [{ band: 'low', requested: 1.4, applied: 0.999 }]);
});

test('verifyGateApply tolerates only the calibration rounding (3 dp)', () => {
  const base = { low: 0.061, mid: 0.043, high: 0.18, global: 0.04 };
  assert.equal(verifyGateApply({ requested: { low: 0.0612 }, applied: base }).ok, true);
  assert.equal(verifyGateApply({ requested: { low: 0.063 }, applied: base }).ok, false);
});

test('verifyGateApply THROWS on malformed inputs instead of guessing', () => {
  assert.throws(() => verifyGateApply({ requested: null, applied: {} }), /requested must be an object/);
  assert.throws(() => verifyGateApply({ requested: {}, applied: null }), /applied must be an object/);
  assert.throws(() => verifyGateApply({ requested: { low: 'x' }, applied: { low: 0.1 } }),
    /requested\.low is not finite/);
  assert.throws(() => verifyGateApply({ requested: { low: 0.1 }, applied: { low: undefined } }),
    /applied\.low is not finite/);
});

test('formatApplyMessage: success states the READ-BACK numbers and where they came from', () => {
  const applied = effectiveGates(normalizeGateBundle(ENGINE_BANDS));
  assert.equal(
    formatApplyMessage({ ok: true, source: 'engine', applied, mismatches: [] }),
    '✓ noise floor set (engine) — low 0.061 · mid 0.043 · high 0.180',
  );
});

test('formatApplyMessage: engine offline is labelled local-only, never a bare success', () => {
  const applied = { low: 0.061, mid: 0.043, high: 0.18, global: 0.04 };
  const text = formatApplyMessage({ ok: true, source: 'analyzer', applied, mismatches: [] });
  assert.match(text, /^✓ noise floor set \(local only\) — /);
});

test('formatApplyMessage: a failed PATCH reads as NOT SET', () => {
  const text = formatApplyMessage({
    ok: false, source: 'analyzer', error: 'engine PATCH failed: PATCH /audio/config → 400',
  });
  assert.equal(text, '✗ noise floor NOT set — engine PATCH failed: PATCH /audio/config → 400');
});

test('formatApplyMessage: a mismatch names the band, the ask and the truth', () => {
  const text = formatApplyMessage({
    ok: false, source: 'engine',
    mismatches: [{ band: 'high', requested: 0.18, applied: 0.04 }],
  });
  assert.equal(text, '✗ noise floor MISMATCH (engine) — high asked 0.180 got 0.040');
});

test('formatApplyMessage refuses to render an unsupported/incoherent outcome', () => {
  assert.throws(() => formatApplyMessage({ ok: true, source: 'nowhere', applied: {} }),
    /unknown source "nowhere"/);
  assert.throws(() => formatApplyMessage({ ok: false, source: 'engine' }),
    /requires an error or mismatches/);
  assert.throws(() => formatApplyMessage({ ok: true, source: 'engine' }),
    /requires the read-back gates/);
});

// ── 5. which read-back is authoritative (report 20260725_132) ────────────────
// `resolveGateReadBack` is the step companion_server.js's applyNoiseFloor runs
// between the PATCH and the verification. The gain path (input_gain.js
// `runGainApply`) already worked this way; these pin the same contract for the
// gates, including the REFUSED-write re-read that keeps the always-visible
// readout from contradicting a red "NOT set".

/** The analyzer's own bands (what is gating audio when there's no engine). */
const ANALYZER_BANDS = { ...ENGINE_BANDS, noiseGate: 0.04, lowGate: 0.04, midGate: 0.04, highGate: 0.04 };
const analyzerBands = () => ANALYZER_BANDS;

test('read-back prefers the engine\'s post-PATCH body when the write was taken', async () => {
  const r = await resolveGateReadBack({
    patchResult: { bands: ENGINE_BANDS }, engineLink: { connected: true }, readAnalyzerBands: analyzerBands,
  });
  assert.equal(r.source, 'engine');
  assert.equal(r.error, null);
  assert.deepEqual(r.effective, { low: 0.061, mid: 0.043, high: 0.18, global: 0.04 });
});

test('read-back falls to the live analyzer only when there is no engine truth', async () => {
  const r = await resolveGateReadBack({ patchResult: null, engineLink: null, readAnalyzerBands: analyzerBands });
  assert.equal(r.source, 'analyzer');
  assert.equal(r.error, null);
  assert.equal(formatGateSummary(r.gates), 'low 0.040 · mid 0.040 · high 0.040 · global 0.040');
});

test('a REFUSED write re-reads the engine ONCE and reconciles to its own gates', async () => {
  let reads = 0;
  const r = await resolveGateReadBack({
    patchResult: null,
    error: 'engine PATCH failed: "bands.lowGate": must be in [0, 0.999]',
    engineLink: {
      connected: true,
      fetchConfig: async () => { reads++; return { bands: ANALYZER_BANDS }; },
    },
    readAnalyzerBands: () => { throw new Error('must not read the analyzer when the engine answered'); },
  });
  assert.equal(reads, 1, 'one authoritative read, not a retry loop');
  assert.equal(r.source, 'engine');
  // The failure still stands — the re-read only fixes WHAT IS SHOWN, never the verdict.
  assert.equal(r.error, 'engine PATCH failed: "bands.lowGate": must be in [0, 0.999]');
  assert.deepEqual(r.effective, { low: 0.04, mid: 0.04, high: 0.04, global: 0.04 });
});

test('a refused write whose engine re-read ALSO fails reports both failures', async () => {
  const r = await resolveGateReadBack({
    patchResult: null,
    error: 'engine PATCH failed: PATCH /audio/config → 400',
    engineLink: { connected: true, fetchConfig: async () => { throw new Error('fetch failed'); } },
    readAnalyzerBands: analyzerBands,
  });
  assert.equal(
    r.error,
    'engine PATCH failed: PATCH /audio/config → 400; engine re-read failed: fetch failed',
  );
  assert.equal(r.source, 'analyzer', 'no engine answer → the analyzer is all that is left');
  assert.deepEqual(r.effective, { low: 0.04, mid: 0.04, high: 0.04, global: 0.04 });
});

test('a refused write against an engine with nothing to serve keeps the analyzer read-back', async () => {
  // fetchConfig resolving null is the engine's documented "audio not
  // initialized" (503) answer — there is no engine truth to reconcile to.
  const r = await resolveGateReadBack({
    patchResult: null,
    error: 'engine PATCH failed: PATCH /audio/config → 503',
    engineLink: { connected: true, fetchConfig: async () => null },
    readAnalyzerBands: analyzerBands,
  });
  assert.equal(r.source, 'analyzer');
  assert.equal(r.error, 'engine PATCH failed: PATCH /audio/config → 503');
});

test('a SUCCESSFUL write is never re-read (the post-PATCH body is already the truth)', async () => {
  let reads = 0;
  const r = await resolveGateReadBack({
    patchResult: { bands: ENGINE_BANDS },
    engineLink: { connected: true, fetchConfig: async () => { reads++; return null; } },
    readAnalyzerBands: analyzerBands,
  });
  assert.equal(reads, 0);
  assert.equal(r.source, 'engine');
});

test('a read-back we cannot trust yields no gates and an error, never a number', async () => {
  const r = await resolveGateReadBack({
    patchResult: { bands: { ...ENGINE_BANDS, noiseGate: 'x' } },
    engineLink: { connected: true }, readAnalyzerBands: analyzerBands,
  });
  assert.equal(r.gates, null);
  assert.equal(r.effective, null);
  assert.match(r.error, /^read-back failed: .*bands\.noiseGate is not finite/);
});

test('resolveGateReadBack demands its analyzer reader instead of silently no-oping', async () => {
  await assert.rejects(() => resolveGateReadBack({ patchResult: null }),
    /readAnalyzerBands must be a function/);
});
