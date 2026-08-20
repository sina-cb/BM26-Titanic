// BpmTracker tempo-octave (half/double) tests.
//
// Drives the REAL AudioAnalyzer with deterministic test synths at known tempos
// and asserts the BpmTracker reports the correct metrical level — guarding the
// half/double-tempo (octave) disambiguation:
//   - a known-90 BPM 4-on-floor synth is NOT octave-doubled (~90, not ~180);
//   - a known-128 BPM synth reads ~128;
//   - genuine fast EDM tempos (120..174) are NOT octave-HALVED (the slow-tempo
//     recovery must not regress 4/4 dance tempos);
//   - genuinely FAST material (psytrance ~140-150, DnB ~170-174 — Burning Man
//     runs fast) is recovered, NOT halved: full_track @160/@170 reads ~160/~170,
//     guarding the skewed octave-preference fast-tempo fix (Adv-A report 22 P1-D);
//   - the two-sided tension holds: a slow 4-on-floor groove (kick_4floor @75,
//     the synthetic downtempo proxy) is NOT doubled to ~150;
//   - the histogram fold boundary (kick_4floor @80, just above histFoldLo=80) is
//     preserved (reads ~80, not folded up).
//
// Run:  cd marsin_engine && node --test tests/audio/bpm_tracker_octave.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AudioAnalyzer } from '../../audio/analyzer/audio_analyzer.js';
import {
  buildAudioAnalyzerOptions,
  buildBpmTrackerOptions,
} from '../../audio/config/audio_analysis_config.js';
import { BpmTracker } from '../../audio/signals/bpm_tracker.js';
import { SYNTHS } from '../../audio/synth/test_synths.js';
import { loadTrackedAudioAnalysisConfig } from '../helpers/tracked_audio_config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = path.resolve(__dirname, '..', '..');
// HERMETIC: tracked config.yaml only. These are octave gates on the REAL
// analyzer, and the first test below asserts what config.yaml declares — both
// claims are void if the operator's live scene state can move the input.
// See tests/helpers/tracked_audio_config.mjs.
const AUDIO = loadTrackedAudioAnalysisConfig(ENGINE_DIR);
const SR = AUDIO.capture.sampleRate;
const HOP = AUDIO.hopSize;

test('the shipped tracker config is exactly what config.yaml declares', () => {
  // This is a CONFIG ASSERTION, not a parity check: it pins the values the
  // detector actually runs on, so a config.yaml edit that silently narrows the
  // detector band or re-enables an optional behaviour fails here first.
  const tracker = new BpmTracker(buildBpmTrackerOptions(AUDIO));
  // 70, not 60 — the widened band cost fast tempos to wrong locks under mic
  // noise (A/B in the config.yaml comment). Changing this needs a re-run.
  assert.equal(tracker.p.minBpm, 70, 'detector band floor');
  assert.equal(tracker.p.maxBpm, 180, 'detector band ceiling');
  assert.equal(tracker.p.silenceResetEnabled, false);
  assert.equal(tracker.p.unlockVoteHops, 48, 'legacy unlock cadence remains unchanged');
  // hopsPerSec is DERIVED from capture.sampleRate / hopSize — never a constant.
  assert.equal(tracker.p.hopsPerSec, AUDIO.capture.sampleRate / AUDIO.hopSize);
});

test('the published-BPM slew ships ON (operator request: walk, never jump)', () => {
  const tracker = new BpmTracker(buildBpmTrackerOptions(AUDIO));
  assert.equal(tracker.p.outputSlewEnabled, true);
  assert.equal(tracker.p.outputSlewBpmPerSec, 16);
});

/** Render `durSec` of a named synth at `bpm`, return the mean BpmTracker bpm
 *  over the steady tail (last 8 s). */
function measureBpm(synthName, bpm, durSec = 28, trackerOverrides = {}) {
  const synth = SYNTHS[synthName];
  const tracker = new BpmTracker({ ...buildBpmTrackerOptions(AUDIO), ...trackerOverrides });
  let clockMs = 0;
  let lastMs = 0;
  const hopMs = (HOP / SR) * 1000;
  const reports = [];
  const analyzer = new AudioAnalyzer(buildAudioAnalyzerOptions(AUDIO, {
    nowFn: () => clockMs,
    onAnalysis: ({ flux, kick, low, mid, high }) => {
      const dt = lastMs === 0 ? 0 : (clockMs - lastMs) / 1000;
      lastMs = clockMs;
      const r = tracker.update(flux, kick, dt, Math.max(low, mid, high));
      reports.push({ tMs: clockMs, bpm: r.bpm });
    },
  }));
  const buf = new Int16Array(HOP);
  for (let n = 0; n < durSec * SR; n += HOP) {
    for (let i = 0; i < HOP; i++) {
      const sample = Math.max(-1, Math.min(1, synth.sample(n + i, SR, { ...synth.defaults, bpm })));
      buf[i] = Math.round(32767 * sample);
    }
    clockMs += hopMs;
    analyzer.pushSamples(buf);
  }
  const tail = reports.filter((r) => r.tMs >= (durSec - 8) * 1000);
  return tail.reduce((s, r) => s + r.bpm, 0) / tail.length;
}

test('a known-90 BPM 4-on-floor synth is not octave-doubled', () => {
  const meas = measureBpm('kick_4floor', 90);
  // Must read ~90, not ~180 (double) or ~45 (half).
  assert.ok(Math.abs(meas - 90) / 90 <= 0.06,
    `expected ~90 BPM, got ${meas.toFixed(1)} (octave error)`);
});

test('a known-128 BPM synth reads ~128', () => {
  const meas = measureBpm('full_track', 128);
  assert.ok(Math.abs(meas - 128) / 128 <= 0.05,
    `expected ~128 BPM, got ${meas.toFixed(1)}`);
});

// ── OPT-IN feature: silence reset ────────────────────────────────────────────
// `silenceResetEnabled` ships FALSE (asserted above). The two tests below cover
// the OPTIONAL behaviour an operator can turn on in config.yaml — they are
// explicitly NOT statements about the shipped production path.

test('[opt-in silenceResetEnabled] confirmed silence clears stale BPM and reacquires', () => {
  const tracker = new BpmTracker({ ...buildBpmTrackerOptions(AUDIO), silenceResetEnabled: true });
  let clockMs = 0;
  let lastMs = 0;
  const hopMs = (HOP / SR) * 1000;
  const rows = [];
  const analyzer = new AudioAnalyzer(buildAudioAnalyzerOptions(AUDIO, {
    nowFn: () => clockMs,
    onAnalysis: ({ flux, kick, low, mid, high }) => {
      const dt = lastMs === 0 ? 0 : (clockMs - lastMs) / 1000;
      lastMs = clockMs;
      const result = tracker.update(flux, kick, dt, Math.max(low, mid, high));
      rows.push({ t: clockMs / 1000, ...result });
    },
  }));
  const synth = SYNTHS.full_track;
  const totalSec = 30;
  const frame = new Int16Array(HOP);
  for (let n = 0; n < totalSec * SR; n += HOP) {
    for (let i = 0; i < HOP; i++) {
      const t = (n + i) / SR;
      const sample = t >= 15 && t < 18
        ? 0
        : synth.sample(n + i, SR, { ...synth.defaults, bpm: t < 15 ? 124 : 140 });
      frame[i] = Math.round(32767 * Math.max(-1, Math.min(1, sample)));
    }
    clockMs += hopMs;
    analyzer.pushSamples(frame);
  }
  const quiet = rows.find(row => row.t >= 15 && row.t < 18 && row.bpm === 0);
  assert.ok(quiet, 'expected a measured silence row');
  assert.ok(quiet.t - 15 <= 2, `silence reset took ${(quiet.t - 15).toFixed(2)}s`);
  assert.equal(quiet.bpm, 0);
  assert.equal(quiet.locked, false);
  assert.ok(quiet.confidence < 0.1, `silence confidence must collapse, got ${quiet.confidence}`);
  const reacquired = rows.find(row => row.t >= 18 && row.locked && Math.abs(row.bpm - 140) / 140 <= 0.02);
  assert.ok(reacquired, 'expected a new 140 BPM lock after silence');
  assert.ok(reacquired.t - 18 <= 7, `reacquisition took ${(reacquired.t - 18).toFixed(2)}s`);
});

test('[opt-in silenceResetEnabled] a caller that omits band activity FAILS LOUD', () => {
  // The reset is driven by band activity. A caller that enables the feature but
  // never supplies activity would leave it permanently, invisibly dead — that is
  // a contract violation, not a soft skip (codex P0).
  const tracker = new BpmTracker({ ...buildBpmTrackerOptions(AUDIO), silenceResetEnabled: true });
  assert.throws(() => tracker.update(0.2, 0.1, 0.01), /requires band activity/);
  assert.doesNotThrow(() => tracker.update(0.2, 0.1, 0.01, 0.5));
  // With the shipped setting the same call is legitimate (no activity needed).
  const shipped = new BpmTracker(buildBpmTrackerOptions(AUDIO));
  assert.doesNotThrow(() => shipped.update(0.2, 0.1, 0.01));
});

test('the tracker REFUSES to run without a derived hop rate (no baked constant)', () => {
  const opts = buildBpmTrackerOptions(AUDIO);
  delete opts.hopsPerSec;
  assert.throws(() => new BpmTracker(opts), /hopsPerSec/);
  assert.throws(() => new BpmTracker({ ...opts, hopsPerSec: 0 }), /hopsPerSec/);
});

test('genuine fast EDM tempos (120..174) are not octave-halved', () => {
  // The slow-tempo recovery must NOT pull a real fast dance tempo down an
  // octave. Sweep the EDM band on both a kick-only and a full-mix synth.
  for (const synth of ['kick_4floor', 'full_track']) {
    for (const bpm of [120, 124, 128, 132, 140, 150, 174]) {
      const meas = measureBpm(synth, bpm);
      assert.ok(Math.abs(meas - bpm) / bpm <= 0.05,
        `${synth} @ ${bpm}: got ${meas.toFixed(1)} (octave/metric error)`);
    }
  }
});

test('genuinely FAST material (160, 170) is recovered, not halved', () => {
  // Burning Man runs fast (psytrance ~140-150, DnB ~170-174). The skewed
  // octave-preference (octaveSigmaHi 0.60 / centre 128) must let a fast tempo
  // win its ×2 contest against the half so full_track @170 reads ~170, NOT ~85
  // (the pre-existing halving Adv-A flagged in report 22 P1-D).
  for (const bpm of [160, 170]) {
    const meas = measureBpm('full_track', bpm);
    assert.ok(Math.abs(meas - bpm) / bpm <= 0.05,
      `full_track @ ${bpm}: got ${meas.toFixed(1)} (fast tempo HALVED — octave-preference regression)`);
  }
});

test('a slow 4-on-floor groove is NOT doubled (downtempo recovery holds)', () => {
  // The fast-tempo fix must not re-break the slow side: a genuinely slow ~75 BPM
  // 4-on-floor (the synthetic proxy for the corpus downtempo DWK217→72 recovery)
  // must stay ~75, not double to ~150. The protection is the octaveAcRatio gate
  // (the autocorr at the double is far below the slow peak, so the perceptual
  // preference never gets to tip it).
  const meas = measureBpm('kick_4floor', 75);
  assert.ok(Math.abs(meas - 75) / 75 <= 0.06,
    `expected ~75 BPM (not doubled), got ${meas.toFixed(1)}`);
});

test('the histogram fold boundary (80, just above histFoldLo) is preserved', () => {
  // histFoldLo=80: a tempo at the fold boundary keeps its own octave and reads
  // ~80, not folded up. Guards the 95→80 boundary lowering from report 19.
  const meas = measureBpm('kick_4floor', 80);
  assert.ok(Math.abs(meas - 80) / 80 <= 0.05,
    `expected ~80 BPM at the fold boundary, got ${meas.toFixed(1)}`);
});

// ── Published-BPM slew ───────────────────────────────────────────────────────
// The slew only shapes the PUBLISHED value, so these drive it directly: with a
// silent input the period estimator never runs (it needs ~85% of the 6 s ring
// filled), so `tracker.bpm` — the exact model estimate — stays exactly where the
// test puts it and every published hop is attributable to the walk alone.
const HOP_DT = HOP / SR;

function slewTracker(overrides) {
  return new BpmTracker({
    ...buildBpmTrackerOptions(AUDIO),
    outputSlewEnabled: true,
    outputSlewBpmPerSec: 16,
    ...overrides,
  });
}

/** Publish `target` as the exact estimate and collect `hops` published values. */
function walk(tracker, target, hops) {
  tracker.bpm = target;
  const out = [];
  for (let i = 0; i < hops; i++) out.push(tracker.update(0, 0, HOP_DT).bpm);
  return out;
}

test('a BPM step walks to the new tempo at the configured rate, without overshoot', () => {
  const tracker = slewTracker();
  // First tempo of the session is ACQUISITION, not a change — published at once.
  assert.equal(walk(tracker, 124, 1)[0], 124);

  const seen = walk(tracker, 140, 200);
  const maxStep = 16 * HOP_DT;
  let prev = 124;
  for (const bpm of seen) {
    assert.ok(bpm >= prev, `published BPM must not backtrack: ${prev} → ${bpm}`);
    assert.ok(bpm - prev <= maxStep + 1e-9, `step ${(bpm - prev).toFixed(4)} exceeds ${maxStep}`);
    assert.ok(bpm <= 140 + 1e-9, `overshoot past the target: ${bpm}`);
    prev = bpm;
  }
  // 16 BPM at 16 BPM/s = 1.0 s of audio; 200 hops is ~2.3 s.
  assert.equal(seen[seen.length - 1], 140);
  const settleHops = seen.findIndex((bpm) => bpm === 140) + 1;
  assert.ok(Math.abs(settleHops * HOP_DT - 1.0) <= 2 * HOP_DT,
    `expected ~1.0 s to settle, took ${(settleHops * HOP_DT).toFixed(3)} s`);
});

test('the walk lands EXACTLY on the target (rate-limited, not asymptotic)', () => {
  const tracker = slewTracker();
  walk(tracker, 124, 1);
  // A tempo halving is the biggest legitimate jump; it must still arrive.
  const seen = walk(tracker, 62, Math.ceil(4.5 / HOP_DT));
  assert.equal(seen[seen.length - 1], 62);
  assert.ok(seen.every((bpm) => bpm >= 62 - 1e-9), 'downward walk must not undershoot');
});

test('the raw tracker estimate stays exact while the published value walks', () => {
  const tracker = slewTracker();
  walk(tracker, 124, 1);
  tracker.bpm = 140;
  const r = tracker.update(0, 0, HOP_DT);
  assert.ok(r.bpm < 140, 'published value must still be walking');
  assert.equal(r.bpmRaw, 140, 'raw estimate must be the exact, unsmoothed tempo');
});

test('outputSlewEnabled:false is exact passthrough (legacy behaviour)', () => {
  const tracker = slewTracker({ outputSlewEnabled: false });
  assert.equal(walk(tracker, 124, 1)[0], 124);
  const seen = walk(tracker, 140, 3);
  assert.deepEqual(seen, [140, 140, 140]);
});

test('an invalid slew setting is rejected by the tracker, live and at construction', () => {
  assert.throws(() => slewTracker({ outputSlewBpmPerSec: 0 }), /outputSlewBpmPerSec/);
  assert.throws(() => slewTracker({ outputSlewBpmPerSec: Number.NaN }), /outputSlewBpmPerSec/);
  assert.throws(() => slewTracker({ outputSlewEnabled: 'yes' }), /outputSlewEnabled/);
  const tracker = slewTracker();
  assert.throws(() => tracker.setOutputSlew({ enabled: true, bpmPerSec: -4 }), /outputSlewBpmPerSec/);
  assert.throws(() => tracker.setOutputSlew({ enabled: 1, bpmPerSec: 20 }), /outputSlewEnabled/);
  // A rejected retune leaves the live setting untouched.
  assert.equal(tracker.p.outputSlewBpmPerSec, 16);
  tracker.setOutputSlew({ enabled: true, bpmPerSec: 40 });
  assert.equal(tracker.p.outputSlewBpmPerSec, 40);
});

test('update() FAILS LOUD on non-finite flux/kick/dt (codex P0, no silent poison)', () => {
  // A NaN/Inf input must throw, not silently corrupt the whitening EMA /
  // autocorrelation ring / Kalman for the rest of the session.
  const tracker = new BpmTracker(buildBpmTrackerOptions(AUDIO));
  assert.throws(() => tracker.update(NaN, 0, 0.01), /non-finite/);
  assert.throws(() => tracker.update(0, Infinity, 0.01), /non-finite/);
  assert.throws(() => tracker.update(0, 0, NaN), /non-finite/);
  // A finite hop still works after the guard rejects bad input.
  assert.doesNotThrow(() => tracker.update(0.2, 0.1, 0.01));
});
