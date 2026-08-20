/*
 * companion_input_gain.test.js — the INPUT-GAIN APPLY feedback contract
 * (follow-up to report 202607/20260725_129 §4: the gain calibration's "✓ Apply
 * gain" still fired a fire-and-forget setInputGain, so a rejected apply looked
 * exactly like a successful one).
 *
 * What these pin, in the order the operator experiences them:
 *   1. REQUEST VALIDATION — an out-of-range / non-numeric gain is REFUSED
 *      loudly before anything is written (codex P0: never clamp a bad request
 *      into a distorting value behind the operator's back).
 *   2. READ-BACK NORMALIZATION — an engine `/audio/config` bands block or the
 *      live analyzer's bands become the gain we display; missing, non-finite
 *      or out-of-range THROWS (never invent a number to display).
 *   3. The always-visible summary line the MIC TUNE page prints under the gain
 *      calibration (and re-prints after a reload).
 *   4. VERIFICATION — requested vs. what the read-back says is in force, so an
 *      apply that didn't land can never render as a success.
 *   5. The one-line operator copy for every outcome (set / local-only /
 *      mismatch / failed PATCH / incoherent).
 *   6. The APPLY-PATH OUTCOMES end to end, against a fake engine link: ok,
 *      engine PATCH fails, engine clamped the value (read-back mismatch),
 *      engine offline (local-only), and the verified profile save.
 *
 * Run:  cd marsin_engine && node --test tests/companion/companion_input_gain.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  GAIN_MIN, GAIN_MAX, GAIN_EPSILON,
  normalizeGainRequest, normalizeInputGain, formatGainSummary,
  verifyGainApply, formatGainApplyMessage, runGainApply,
} from '../../audio/companion/input_gain.js';
import { SOURCE_LABEL, sourceLabel } from '../../audio/companion/apply_readback.js';

// A realistic engine PATCH /audio/config response body's `bands` block.
const ENGINE_BANDS = {
  lowMaxHz: 200, midMaxHz: 2000, attackMs: 12, releaseMs: 120,
  inputGain: 2.5, sourceSmoothHz: 12000,
  noiseGate: 0.04, lowGate: 0.061, midGate: 0.043, highGate: 0.18,
};

// ── 1. the request guard ─────────────────────────────────────────────────────

test('gain bounds are the engine PATCH validator + analyzer bounds', () => {
  assert.equal(GAIN_MIN, 0);
  assert.equal(GAIN_MAX, 64);
});

test('normalizeGainRequest passes a legal gain through untouched', () => {
  assert.equal(normalizeGainRequest(2.5), 2.5);
  assert.equal(normalizeGainRequest(0), 0);
  assert.equal(normalizeGainRequest(64), 64);
});

test('normalizeGainRequest REFUSES an out-of-range / non-numeric gain (no silent clamp)', () => {
  assert.throws(() => normalizeGainRequest(70), /requested gain 70 is outside \[0, 64\]/);
  assert.throws(() => normalizeGainRequest(-1), /outside \[0, 64\]/);
  assert.throws(() => normalizeGainRequest(NaN), /must be a finite number/);
  assert.throws(() => normalizeGainRequest('2.5'), /must be a finite number/);
  assert.throws(() => normalizeGainRequest(undefined), /must be a finite number/);
});

// ── 2. read-back normalization ───────────────────────────────────────────────

test('normalizeInputGain reads the gain out of an engine bands block', () => {
  assert.equal(normalizeInputGain(ENGINE_BANDS), 2.5);
});

test('normalizeInputGain THROWS on a missing / non-finite / impossible gain', () => {
  assert.throws(() => normalizeInputGain({ noiseGate: 0.04 }), /bands\.inputGain is missing/);
  assert.throws(() => normalizeInputGain({ inputGain: null }), /bands\.inputGain is missing/);
  assert.throws(() => normalizeInputGain({ inputGain: 'x' }), /bands\.inputGain is not finite/);
  assert.throws(() => normalizeInputGain({ inputGain: NaN }), /bands\.inputGain is not finite/);
  assert.throws(() => normalizeInputGain({ inputGain: 999 }), /is outside \[0, 64\]/);
  assert.throws(() => normalizeInputGain(null), /expected a bands object/);
});

// ── 3. the always-visible readout ────────────────────────────────────────────

test('formatGainSummary is the always-visible one-liner, 2 dp so a clamp shows', () => {
  assert.equal(formatGainSummary(2.5), '×2.50');
  assert.equal(formatGainSummary(1), '×1.00');
  assert.equal(formatGainSummary(8.8271), '×8.83');
});

test('formatGainSummary THROWS rather than printing a non-number', () => {
  assert.throws(() => formatGainSummary(undefined), /must be a finite number/);
  assert.throws(() => formatGainSummary(NaN), /must be a finite number/);
});

// ── 4. verification ──────────────────────────────────────────────────────────

test('verifyGainApply passes when the read-back matches the request', () => {
  const v = verifyGainApply({ requested: 2.5, applied: normalizeInputGain(ENGINE_BANDS) });
  assert.equal(v.ok, true);
  assert.equal(v.mismatch, null);
});

test('verifyGainApply FAILS when the engine clamped the value (no silent success)', () => {
  const v = verifyGainApply({ requested: 60, applied: 16 });
  assert.equal(v.ok, false);
  assert.deepEqual(v.mismatch, { requested: 60, applied: 16 });
});

test('verifyGainApply tolerates only the calibration rounding (2 dp)', () => {
  assert.equal(verifyGainApply({ requested: 2.5, applied: 2.502 }).ok, true);
  assert.equal(verifyGainApply({ requested: 2.5, applied: 2.51 }).ok, false);
  assert.equal(GAIN_EPSILON, 5e-3);
});

test('verifyGainApply THROWS on malformed inputs instead of guessing', () => {
  assert.throws(() => verifyGainApply({ requested: 'x', applied: 1 }), /requested is not finite/);
  assert.throws(() => verifyGainApply({ requested: 1, applied: undefined }), /applied is not finite/);
});

// ── 5. the operator copy ─────────────────────────────────────────────────────

test('read-back provenance shares one vocabulary with the noise-floor apply', () => {
  assert.deepEqual({ ...SOURCE_LABEL }, { engine: 'engine', analyzer: 'local only' });
  assert.equal(sourceLabel('engine', 'ctx'), 'engine');
  assert.throws(() => sourceLabel('nowhere', 'ctx'), /ctx: unknown source "nowhere"/);
});

test('formatGainApplyMessage: success states the READ-BACK value and where it came from', () => {
  assert.equal(
    formatGainApplyMessage({ ok: true, source: 'engine', applied: 2.5, mismatch: null }),
    '✓ input gain set (engine) — ×2.50',
  );
});

test('formatGainApplyMessage: engine offline is labelled local-only, never a bare success', () => {
  assert.equal(
    formatGainApplyMessage({ ok: true, source: 'analyzer', applied: 8.83, mismatch: null }),
    '✓ input gain set (local only) — ×8.83',
  );
});

test('formatGainApplyMessage: a failed PATCH reads as NOT SET', () => {
  assert.equal(
    formatGainApplyMessage({
      ok: false, source: 'analyzer', error: 'engine PATCH failed: PATCH /audio/config → 400',
    }),
    '✗ input gain NOT set — engine PATCH failed: PATCH /audio/config → 400',
  );
});

test('formatGainApplyMessage: a mismatch names the ask and the truth', () => {
  assert.equal(
    formatGainApplyMessage({ ok: false, source: 'engine', mismatch: { requested: 60, applied: 16 } }),
    '✗ input gain MISMATCH (engine) — asked ×60.00 got ×16.00',
  );
});

test('formatGainApplyMessage refuses to render an incoherent outcome', () => {
  assert.throws(() => formatGainApplyMessage({ ok: true, source: 'nowhere', applied: 1 }),
    /unknown source "nowhere"/);
  assert.throws(() => formatGainApplyMessage({ ok: false, source: 'engine' }),
    /requires an error or a mismatch/);
  assert.throws(() => formatGainApplyMessage({ ok: true, source: 'engine' }),
    /requires the read-back gain/);
});

// ── 6. the apply path, end to end ────────────────────────────────────────────
// `runGainApply` IS the path companion_server.js's applyGainVerified runs (the
// server only supplies the side effects: apply-to-analyzer + broadcast, the
// real engine link, the live analyzer gain). Driving it here pins the ORDER —
// apply → await the PATCH → read the AUTHORITATIVE post-apply gain back →
// reconcile the local value to it → verify → one line — without a socket.

/** A stand-in for the companion's analyzer: `applyLocal` writes it, the read-back reads it. */
function fakeAnalyzer(startGain = 1) {
  const state = { gain: startGain, applied: [] };
  return {
    state,
    applyLocal: (g) => { state.gain = g; state.applied.push(g); },
    readAnalyzerGain: () => state.gain,
  };
}
const engineUp = (respond) => ({ connected: true, patch: async (p) => respond(p) });
/** An engine that refuses the write and still serves its own (unchanged) config. */
const engineRejecting = (message, ownGain = 1.48) => ({
  connected: true,
  patch: async () => { throw new Error(message); },
  fetchConfig: async () => ({ bands: { ...ENGINE_BANDS, inputGain: ownGain } }),
});

test('apply OK: the engine took it → confirmation carries the ENGINE read-back', async () => {
  const a = fakeAnalyzer();
  const r = await runGainApply({
    requested: 2.5, ...a,
    engineLink: engineUp((p) => ({ bands: { ...ENGINE_BANDS, inputGain: p.bands.inputGain } })),
  });
  assert.equal(r.ok, true);
  assert.equal(r.source, 'engine');
  assert.equal(r.gain, 2.5);
  assert.equal(r.error, null);
  assert.equal(r.text, '✓ input gain set (engine) — ×2.50');
  assert.deepEqual(a.state.applied, [2.5], 'no redundant re-apply when the engine agreed');
});

test('the local apply happens BEFORE the engine round-trip (analysis never blocks)', async () => {
  const a = fakeAnalyzer();
  let gainWhenPatchRan = null;
  await runGainApply({
    requested: 3, ...a,
    engineLink: engineUp(() => {
      gainWhenPatchRan = a.state.gain;
      return { bands: { ...ENGINE_BANDS, inputGain: 3 } };
    }),
  });
  assert.equal(gainWhenPatchRan, 3);
});

test('apply FAILS when the engine PATCH is rejected — loud, and never a ✓', async () => {
  const a = fakeAnalyzer();
  const r = await runGainApply({
    requested: 2.5, ...a,
    engineLink: engineRejecting('"bands.inputGain": must be in [0, 64]'),
  });
  assert.equal(r.ok, false);
  assert.equal(r.text, '✗ input gain NOT set — engine PATCH failed: "bands.inputGain": must be in [0, 64]');
  assert.doesNotMatch(r.text, /✓/);
});

test('a REFUSED write reconciles to the engine\'s own gain, so the readout cannot contradict the failure', async () => {
  const a = fakeAnalyzer(1.48);
  const r = await runGainApply({
    requested: 2.5, ...a, engineLink: engineRejecting('PATCH /audio/config → 400', 1.48),
  });
  assert.equal(r.ok, false);
  assert.equal(r.source, 'engine');
  assert.equal(r.gain, 1.48, 'the engine kept its own value — that is the truth to display');
  assert.deepEqual(a.state.applied, [2.5, 1.48], 'the optimistic local apply is rolled onto the engine truth');
  assert.equal(formatGainSummary(a.state.gain), '×1.48');
});

test('a refused write whose engine re-read ALSO fails says both things', async () => {
  const a = fakeAnalyzer();
  const r = await runGainApply({
    requested: 2.5, ...a,
    engineLink: {
      connected: true,
      patch: async () => { throw new Error('PATCH /audio/config → 400'); },
      fetchConfig: async () => { throw new Error('fetch failed'); },
    },
  });
  assert.equal(r.ok, false);
  assert.equal(
    r.text,
    '✗ input gain NOT set — engine PATCH failed: PATCH /audio/config → 400; engine re-read failed: fetch failed',
  );
});

test('apply FAILS when the read-back disagrees (engine clamped it) and the LIVE value follows the engine', async () => {
  const a = fakeAnalyzer();
  const r = await runGainApply({
    requested: 60, ...a,
    engineLink: engineUp(() => ({ bands: { ...ENGINE_BANDS, inputGain: 16 } })),
  });
  assert.equal(r.ok, false);
  assert.equal(r.gain, 16);
  assert.deepEqual(r.mismatch, { requested: 60, applied: 16 });
  assert.equal(r.text, '✗ input gain MISMATCH (engine) — asked ×60.00 got ×16.00');
  // The reconcile: what the operator is shown is the ENGINE's number, not ours.
  assert.deepEqual(a.state.applied, [60, 16]);
  assert.equal(formatGainSummary(a.state.gain), '×16.00');
});

test('apply FAILS when the engine answers with a gain we cannot trust', async () => {
  const a = fakeAnalyzer();
  const r = await runGainApply({
    requested: 2.5, ...a,
    engineLink: engineUp(() => ({ bands: { ...ENGINE_BANDS, inputGain: 'loud' } })),
  });
  assert.equal(r.ok, false);
  assert.equal(r.gain, null);
  assert.match(r.text, /^✗ input gain NOT set — read-back failed: .*bands\.inputGain is not finite/);
});

test('apply with NO engine is a success labelled local only (analyzer read-back)', async () => {
  const a = fakeAnalyzer();
  const r = await runGainApply({ requested: 4, ...a, engineLink: null });
  assert.equal(r.ok, true);
  assert.equal(r.source, 'analyzer');
  assert.equal(r.text, '✓ input gain set (local only) — ×4.00');
});

test('a DOWN engine link is not consulted, and the result says local only', async () => {
  const a = fakeAnalyzer();
  let patched = false;
  const r = await runGainApply({
    requested: 4, ...a,
    engineLink: { connected: false, patch: async () => { patched = true; return {}; } },
  });
  assert.equal(patched, false);
  assert.equal(r.source, 'analyzer');
  assert.equal(r.ok, true);
});

test('apply FAILS LOUD when the local analyzer refused the value (read-back catches it)', async () => {
  // A stubborn analyzer that ignores writes — the read-back must expose it
  // rather than echoing the requested number back as a success.
  const r = await runGainApply({
    requested: 4, engineLink: null,
    applyLocal: () => { /* write refused */ },
    readAnalyzerGain: () => 1,
  });
  assert.equal(r.ok, false);
  assert.equal(r.text, '✗ input gain MISMATCH (local only) — asked ×4.00 got ×1.00');
});

test('runGainApply refuses a bad request before touching the analyzer or the engine', async () => {
  const a = fakeAnalyzer();
  let patched = false;
  await assert.rejects(
    () => runGainApply({
      requested: 70, ...a,
      engineLink: engineUp(() => { patched = true; return {}; }),
    }),
    /requested gain 70 is outside \[0, 64\]/,
  );
  assert.deepEqual(a.state.applied, []);
  assert.equal(patched, false);
});

test('runGainApply demands its side effects instead of silently no-oping', async () => {
  await assert.rejects(() => runGainApply({ requested: 2 }), /applyLocal must be a function/);
  await assert.rejects(() => runGainApply({ requested: 2, applyLocal: () => {} }),
    /readAnalyzerGain must be a function/);
});

// The profile-save contract companion_server.js layers on top: it snapshots
// ONLY when the outcome is ok, so a profile can never record a refused gain.
test('save-to-profile only snapshots a gain the read-back proved landed', async () => {
  const prof = { name: 'deep playa', inputGain: 1 };
  const save = (outcome, live) => { if (outcome.ok) prof.inputGain = live; return outcome.ok; };

  const a = fakeAnalyzer();
  const ok = await runGainApply({
    requested: 2.5, ...a,
    engineLink: engineUp((p) => ({ bands: { ...ENGINE_BANDS, inputGain: p.bands.inputGain } })),
  });
  assert.equal(save(ok, a.state.gain), true);
  assert.equal(prof.inputGain, 2.5);

  const b = fakeAnalyzer(2.5);
  const failed = await runGainApply({
    requested: 6, ...b, engineLink: engineRejecting('engine down'),
  });
  assert.equal(save(failed, b.state.gain), false);
  assert.equal(prof.inputGain, 2.5, 'the profile must NOT record the refused gain');
});
