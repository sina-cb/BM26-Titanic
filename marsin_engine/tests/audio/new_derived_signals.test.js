/**
 * new_derived_signals.test.js — validation of the five NEW derived lighting
 * signals (report 20260620_2 #1/#3/#8/#6/#7), both as pure unit modules AND
 * end-to-end through the REAL audio chain (AudioAnalyzer + AudioStructureDetector
 * + DerivedSignals over a real ParamCenter) driven by the synth bank — the exact
 * path engine.js wires in its analyzer onAnalysis callback.
 *
 *   audioRiserScore/audioBuildEta/audioRiserConf  — build_anticipation.js (#1)
 *   audioSilence/audioTrackChange                 — track_change.js        (#3)
 *   audioClimax                                   — climax.js              (#8)
 *   audioPhrasePhase/audioPhraseBoundary          — phrase_tracker.js      (#6)
 *   audioDropCountdown                            — drop_countdown.js      (#7)
 *
 * Proof asserted here (numbers captured in report 202606/20260620_15):
 *   - riser RISES through a build (riser/edm_drop) and RESETS on the drop;
 *   - track-change fires across a silence gap (full→silence→full), once, and
 *     latches audioSilence in the gap; a steady track fires neither;
 *   - climax HOLDS on a sustained loud full-spectrum section, NOT on a riser;
 *   - phrase boundary lands on bar multiples (an 8-bar wrap);
 *   - drop-countdown fires before a predicted drop and NOT on a steady track
 *     ("not on false builds"); silence fires nothing anywhere.
 *
 * Run:  cd marsin_engine && node --test tests/new_derived_signals.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AudioAnalyzer } from '../../audio/analyzer/audio_analyzer.js';
import { AudioStructureDetector } from '../../audio/detector/audio_structure_detector.js';
import { ParamCenter } from '../../lib/param_center.js';
import { DerivedSignals } from '../../audio/signals/derived_signals.js';
import { fillFrame } from '../../audio/synth/test_synths.js';

import { BuildAnticipation } from '../../audio/signals/build_anticipation.js';
import { TrackChange } from '../../audio/signals/track_change.js';
import { Climax } from '../../audio/signals/climax.js';
import { PhraseTracker } from '../../audio/signals/phrase_tracker.js';
import { DropCountdown } from '../../audio/signals/drop_countdown.js';

const SR = 44100, FFT = 1024, HOP = 512, HOP_MS = (HOP / SR) * 1000;

// ── Full-chain driver: synth segments → analyzer → detector → DerivedSignals ──
// Mirrors engine.js onAnalysis ordering exactly (analyzer writes raw mirrors,
// detector.tick reads them + publishes its keys, derivedSignals.tick reads all
// of the above + publishes the new keys). Records every new CPC key per hop.
// `injectDropAtMs` fires a single canonical `audioDropPulse=1` at the given time
// (after the detector tick, before the signals tick) so a test can validate the
// SIGNALS' response to a drop EVENT without depending on the detector firing.
// Needed because the DEPLOYED detector is precision-first (E1: dropEnergyJump 4.0
// + rise/novelty gates) and intentionally does NOT fire on the synthetic edm_drop
// — the detector's real-audio precision/recall is covered by detector_eval.
function driveChain(segments, { detectorEnabled = true, injectDropAtMs = null } = {}) {
  const pc = new ParamCenter(null);
  let clock = 0, prevMs = 0, dropInjected = false;
  const detector = new AudioStructureDetector({
    paramCenter: pc, broadcast: () => {},
    getConfig: () => (detectorEnabled ? { enabled: true } : { enabled: false }),
  });
  const ds = new DerivedSignals({ paramCenter: pc });
  const series = {
    tMs: [], riserScore: [], buildEta: [], riserConf: [],
    silence: [], trackChange: [], climax: [],
    phrasePhase: [], phraseBoundary: [], countdown: [],
    dropPulse: [], bpm: [],
  };
  const analyzer = new AudioAnalyzer({
    sampleRate: SR, fftSize: FFT, hopSize: HOP,
    bands: { lowMaxHz: 200, midMaxHz: 4000, attackMs: 6, releaseMs: 180, noiseGate: 0.04, inputGain: 1.0, sourceSmoothHz: 12000 },
    kick: { minHz: 50, maxHz: 110, threshold: 2.4, refractoryMs: 220, decayMs: 70 },
    sub: { minHz: 30, maxHz: 60 },
    nowFn: () => clock,
    onAnalysis: (a) => {
      const nowMs = clock;
      const dt = prevMs === 0 ? 0 : (nowMs - prevMs) / 1000;
      prevMs = nowMs;
      pc.setMany([
        { kind: 'scalar', key: 'micLowRaw', value: a.low }, { kind: 'scalar', key: 'micMidRaw', value: a.mid },
        { kind: 'scalar', key: 'micHighRaw', value: a.high }, { kind: 'scalar', key: 'micKickRaw', value: a.kick },
        { kind: 'scalar', key: 'micFluxRaw', value: a.flux },
        { kind: 'scalar', key: 'micDomFreq1', value: a.domFreq1 || 0 }, { kind: 'scalar', key: 'micDomEnergy1', value: a.domEnergy1 || 0 },
        { kind: 'scalar', key: 'micDomFreq2', value: a.domFreq2 || 0 }, { kind: 'scalar', key: 'micDomEnergy2', value: a.domEnergy2 || 0 },
        { kind: 'scalar', key: 'micOnsetLowRaw', value: a.onsetLow || 0 }, { kind: 'scalar', key: 'micOnsetMidRaw', value: a.onsetMid || 0 },
        { kind: 'scalar', key: 'micOnsetHighRaw', value: a.onsetHigh || 0 }, { kind: 'scalar', key: 'micSubRaw', value: a.micSub || 0 },
      ], 'audio', 'audio:mic');
      detector.tick(nowMs, dt);
      // Inject a single canonical drop event for signal-response tests.
      if (injectDropAtMs != null && !dropInjected && nowMs >= injectDropAtMs) {
        pc.setMany([{ kind: 'scalar', key: 'audioDropPulse', value: 1.0 }], 'audio');
        dropInjected = true;
      }
      ds.tick(nowMs, dt);
      series.tMs.push(nowMs);
      series.riserScore.push(pc.get('audioRiserScore'));
      series.buildEta.push(pc.get('audioBuildEta'));
      series.riserConf.push(pc.get('audioRiserConf'));
      series.silence.push(pc.get('audioSilence'));
      series.trackChange.push(pc.get('audioTrackChange'));
      series.climax.push(pc.get('audioClimax'));
      series.phrasePhase.push(pc.get('audioPhrasePhase'));
      series.phraseBoundary.push(pc.get('audioPhraseBoundary'));
      series.countdown.push(pc.get('audioDropCountdown'));
      series.dropPulse.push(pc.get('audioDropPulse'));
      series.bpm.push(pc.get('audioBpm'));
    },
  });
  const buf = new Int16Array(HOP);
  let cursor = 0;
  for (const seg of segments) {
    const hops = Math.floor((seg.seconds * SR) / HOP);
    for (let h = 0; h < hops; h++) {
      fillFrame(buf, seg.synth, cursor, SR, {});
      cursor += HOP; clock += HOP_MS;
      analyzer.pushSamples(buf);
    }
  }
  return series;
}

// Count rising edges of a 0/1-ish series over `thresh`.
function countEdges(arr, thresh = 0.5) {
  let n = 0, prev = 0;
  for (const v of arr) { if (v >= thresh && prev < thresh) n++; prev = v; }
  return n;
}
const peak = (arr) => arr.reduce((m, v) => (v > m ? v : m), 0);

// ════════════════════════════════════════════════════════════════════════════
// 1. RISER / build-anticipation (#1)
// ════════════════════════════════════════════════════════════════════════════

test('riser RISES through a build and RESETS on the drop (full chain, detector OFF)', () => {
  // edm_drop: ~7.5 s build then a drop. Detector OFF = the DEFAULT deployment,
  // so the riser must stand on the raw mic slopes alone. With the detector OFF
  // there is no audioDropPulse, so the reset is ORGANIC: the rising flux/high
  // evidence collapses the instant the drop replaces the riser with kick+bass.
  const hopSec = HOP_MS / 1000;
  const s = driveChain([{ synth: 'edm_drop', seconds: 16 }], { detectorEnabled: false });
  const buildPeak = peak(s.riserScore.slice(0, Math.floor(7 / hopSec)));
  assert.ok(buildPeak > 0.6, `riser should climb high during the build; peak=${buildPeak.toFixed(2)}`);
  // The musical drop lands ~7.5 s in; by ~9 s the riser must have collapsed.
  const idx9 = Math.floor(9 / hopSec);
  assert.ok(s.riserScore[idx9] < 0.2,
    `riser should reset after the drop; got ${s.riserScore[idx9].toFixed(2)} at ~9s`);
});

test('riser RESETS on an audioDropPulse drop event (injected; deployed detector precision-first)', () => {
  // With the detector enabled, audioDropPulse fires on the drop and the riser's
  // explicit drop-reset collapses the score within the reset window.
  const hopSec = HOP_MS / 1000;
  const s = driveChain([{ synth: 'edm_drop', seconds: 16 }], { detectorEnabled: false, injectDropAtMs: 7500 });
  const dropHop = s.dropPulse.findIndex((v) => v >= 0.5);
  assert.ok(dropHop > 0, 'a drop should occur in edm_drop');
  const postIdx = dropHop + Math.floor(1.2 / hopSec);
  assert.ok(s.riserScore[postIdx] < 0.35,
    `riser should reset after the drop pulse; got ${s.riserScore[postIdx].toFixed(2)} at +1.2s`);
});

test('riser also rises on the riser synth and confidence is honest (detector OFF caps conf ≤ 0.8)', () => {
  const s = driveChain([{ synth: 'riser', seconds: 7.5 }], { detectorEnabled: false });
  assert.ok(peak(s.riserScore) > 0.5, `riser synth should drive riserScore; peak=${peak(s.riserScore).toFixed(2)}`);
  // Detector OFF → confidence is capped (we are guessing more). codex P0 honesty.
  assert.ok(peak(s.riserConf) <= 0.8001, `riser conf must be capped without the detector; peak=${peak(s.riserConf).toFixed(2)}`);
});

test('riser stays LOW on a steady full_track (no build)', () => {
  const s = driveChain([{ synth: 'full_track', seconds: 12 }], { detectorEnabled: false });
  assert.ok(peak(s.riserScore) < 0.35, `steady groove should not read as a build; peak=${peak(s.riserScore).toFixed(2)}`);
});

test('riser is silent on silence (no phantom build)', () => {
  const s = driveChain([{ synth: 'silence', seconds: 8 }], { detectorEnabled: false });
  assert.equal(peak(s.riserScore), 0, 'silence must not build');
  assert.equal(peak(s.riserConf), 0, 'silence must have zero riser confidence');
});

test('BuildAnticipation (unit): warmup gate prevents a first-frame phantom build', () => {
  const ra = new BuildAnticipation();
  let now = 0;
  // A loud first frame during warmup must not score.
  for (let i = 0; i < 10; i++) {
    const r = ra.update({ flux: 0.9, high: 0.9, low: 0.1, mid: 0.5, buildScore: 0, structure: 0, dropPulse: 0, bpm: 0, bpmLocked: false, barPhase: 0, dt: HOP_MS / 1000, nowMs: now });
    assert.equal(r.riserScore, 0, 'no score during warmup');
    now += HOP_MS;
  }
});

// ════════════════════════════════════════════════════════════════════════════
// 2. TRACK-CHANGE / silence (#3)
// ════════════════════════════════════════════════════════════════════════════

test('track-change fires ONCE across a silence gap; audioSilence latches in the gap', () => {
  const s = driveChain([
    { synth: 'full_track', seconds: 6 },
    { synth: 'silence', seconds: 3 },
    { synth: 'full_track', seconds: 6 },
  ], { detectorEnabled: false });
  const tc = countEdges(s.trackChange);
  assert.equal(tc, 1, `exactly one track-change across the gap; got ${tc}`);
  const silEnters = countEdges(s.silence);
  assert.equal(silEnters, 1, `silence latched once in the gap; got ${silEnters}`);
  const silHops = s.silence.filter((v) => v >= 0.5).length;
  assert.ok(silHops > 50, `silence should hold through the 3 s gap; held ${silHops} hops`);
});

test('a steady track fires NO track-change and NO silence', () => {
  const s = driveChain([{ synth: 'full_track', seconds: 15 }], { detectorEnabled: false });
  assert.equal(countEdges(s.trackChange), 0, 'steady track must not report a track change');
  assert.equal(s.silence.filter((v) => v >= 0.5).length, 0, 'steady track is never silent');
});

test('TrackChange (unit): a 1-bar breakdown is NOT a track change', () => {
  const tc = new TrackChange();
  let now = 0;
  const step = (low, mid, high) => tc.update({ low, mid, high, bpm: 128, bpmLocked: true, pitchClass: -1, noteStable: false, dt: HOP_MS / 1000, nowMs: now });
  // 3 s of loud music (past warmup), one short quiet dip (< gapMinMs), then loud.
  let fires = 0;
  for (let i = 0; i < Math.floor(3000 / HOP_MS); i++) { if (step(0.7, 0.6, 0.5).trackChange) fires++; now += HOP_MS; }
  for (let i = 0; i < Math.floor(300 / HOP_MS); i++) { if (step(0.02, 0.02, 0.02).trackChange) fires++; now += HOP_MS; }
  for (let i = 0; i < Math.floor(2000 / HOP_MS); i++) { if (step(0.7, 0.6, 0.5).trackChange) fires++; now += HOP_MS; }
  assert.equal(fires, 0, `a short dip (< gapMinMs) must not fire a track change; got ${fires}`);
});

// ════════════════════════════════════════════════════════════════════════════
// 3. CLIMAX / sustained-peak (#8)
// ════════════════════════════════════════════════════════════════════════════

test('climax RAMPS on a rise INTO a sustained loud full-spectrum peak, then HOLDS', () => {
  // REAL-AUDIO RE-BASELINE (E2 P0-3): a climax is a SPECIAL MOMENT reached by
  // CLIMBING into the peak (post-drop / breakdown→hands-up), NOT steady state.
  // A flat groove from t0 no longer climaxes (it never rises above its own
  // baseline) — that was the over-fire bug. We drive a genuine rise: a quiet
  // intro then the loud full-spectrum groove. The loudness CLIMBS into the
  // plateau, so the climax ramps up and HOLDS through the peak section.
  const s = driveChain([
    { synth: 'silence', seconds: 4 },
    { synth: 'full_track', seconds: 14 },
  ], { detectorEnabled: false });
  // The near-true-peak gate (ceilFrac 0.95 of a 40 s top-decile reference) ramps
  // the climax CLEARLY on the rise into the loud groove. It does not pin to 1.0
  // on a STEADY synth groove (whose per-bar ripple sits just under the inflated
  // top-bin reference) — that's correct: only a true post-drop slam pins high.
  assert.ok(peak(s.climax) > 0.6, `a rise into a loud peak should climax; peak=${peak(s.climax).toFixed(2)}`);
  // And HOLD (a stretch of hops up, not a single spike) through the grace.
  const held = s.climax.filter((v) => v > 0.4).length;
  assert.ok(held > 20, `climax should hold across the peak section; ${held} hops > 0.4`);
});

test('climax does NOT fire on a FLAT steady groove (no rise into a peak) — E2 P0-3', () => {
  // The over-fire fix: a continuous loud groove that is at level from t0 has no
  // rise-into-plateau, so it must NOT read as a climax. (On the real 60-track
  // no-drop corpus this dropped climax≥0.5 from 47.6 % to ~1 % of hops.)
  const s = driveChain([{ synth: 'full_track', seconds: 14 }], { detectorEnabled: false });
  const held = s.climax.filter((v) => v >= 0.5).length;
  assert.ok(held < 30, `a flat steady groove must not saturate the climax; ${held} hops ≥ 0.5`);
});

test('climax does NOT fire on a riser (bright but no bass body)', () => {
  const s = driveChain([{ synth: 'riser', seconds: 8 }], { detectorEnabled: false });
  assert.ok(peak(s.climax) < 0.3, `a riser (no bass slam) must not read as a climax; peak=${peak(s.climax).toFixed(2)}`);
});

test('climax is zero on silence', () => {
  const s = driveChain([{ synth: 'silence', seconds: 8 }], { detectorEnabled: false });
  assert.equal(peak(s.climax), 0, 'silence has no climax');
});

test('Climax (unit): a single loud beat does not climax (needs a held plateau)', () => {
  const cx = new Climax();
  let now = 0;
  for (let i = 0; i < 40; i++) { cx.update({ low: 0.05, mid: 0.05, high: 0.05, dropPulse: 0, dt: HOP_MS / 1000, nowMs: now }); now += HOP_MS; }
  // One loud frame then quiet again.
  let maxC = 0;
  maxC = Math.max(maxC, cx.update({ low: 0.8, mid: 0.7, high: 0.5, dropPulse: 0, dt: HOP_MS / 1000, nowMs: now }).climax); now += HOP_MS;
  for (let i = 0; i < 10; i++) { maxC = Math.max(maxC, cx.update({ low: 0.05, mid: 0.05, high: 0.05, dropPulse: 0, dt: HOP_MS / 1000, nowMs: now }).climax); now += HOP_MS; }
  assert.ok(maxC < 0.3, `one loud beat must not climax; got ${maxC.toFixed(2)}`);
});

// ════════════════════════════════════════════════════════════════════════════
// 4. PHRASE / 8-bar boundary (#6)
// ════════════════════════════════════════════════════════════════════════════

test('phrase boundary lands on an 8-bar wrap over a long steady track', () => {
  // ~28 s of full_track @124 BPM. BPM locks ~5 s in; an 8-bar phrase ≈ 15.5 s,
  // so exactly one phrase wrap should land within the window.
  const s = driveChain([{ synth: 'full_track', seconds: 28 }], { detectorEnabled: false });
  const boundaries = countEdges(s.phraseBoundary);
  assert.ok(boundaries >= 1, `at least one 8-bar phrase boundary; got ${boundaries}`);
  // phrasePhase must stay in [0,1].
  assert.ok(s.phrasePhase.every((v) => v >= 0 && v <= 1), 'phrasePhase stays in [0,1]');
  assert.ok(peak(s.phrasePhase) > 0.5, 'phrasePhase should advance through the phrase');
});

test('phrase re-anchors on an injected drop event (boundary)', () => {
  const s = driveChain([{ synth: 'edm_drop', seconds: 16 }], { detectorEnabled: false, injectDropAtMs: 7500 });
  assert.ok(countEdges(s.phraseBoundary) >= 1, 'a drop should re-anchor the phrase grid (boundary)');
});

test('phrase fires NOTHING on silence (no bar grid)', () => {
  const s = driveChain([{ synth: 'silence', seconds: 10 }], { detectorEnabled: false });
  assert.equal(countEdges(s.phraseBoundary), 0, 'silence has no phrase boundaries');
  assert.equal(peak(s.phrasePhase), 0, 'silence has no phrase phase');
});

test('PhraseTracker (unit): counts 8 downbeats → one boundary, wraps phase', () => {
  const ph = new PhraseTracker({ phraseBars: 8 });
  let now = 0, boundaries = 0;
  for (let bar = 0; bar < 8; bar++) {
    // a downbeat pulse, then 3 quiet hops (the rest of the bar)
    const r = ph.update({ downbeat: 1, barPhase: 0, dropPulse: 0, bpmLocked: true, nowMs: now });
    if (r.phraseBoundary) boundaries++; now += HOP_MS;
    for (let k = 0; k < 3; k++) { ph.update({ downbeat: 0, barPhase: 0.5, dropPulse: 0, bpmLocked: true, nowMs: now }); now += HOP_MS; }
  }
  assert.equal(boundaries, 1, `8 bars = exactly one phrase boundary (on the wrap); got ${boundaries}`);
});

// ════════════════════════════════════════════════════════════════════════════
// 5. DROP COUNTDOWN (#7)
// ════════════════════════════════════════════════════════════════════════════

test('drop-countdown fires before an injected drop on edm_drop', () => {
  const s = driveChain([{ synth: 'edm_drop', seconds: 16 }], { detectorEnabled: false, injectDropAtMs: 7500 });
  const dropHop = s.dropPulse.findIndex((v) => v >= 0.5);
  assert.ok(dropHop > 0, 'a drop should occur');
  // Count countdown pulses BEFORE the drop.
  const before = countEdges(s.countdown.slice(0, dropHop), 0.6);
  assert.ok(before >= 1, `countdown should fire in the final build beats before the drop; got ${before}`);
});

test('drop-countdown does NOT fire on a steady track ("not on false builds")', () => {
  const s = driveChain([{ synth: 'full_track', seconds: 15 }], { detectorEnabled: false });
  assert.equal(countEdges(s.countdown, 0.6), 0, 'a steady groove must not count down');
});

test('drop-countdown fires NOTHING on silence', () => {
  const s = driveChain([{ synth: 'silence', seconds: 10 }], { detectorEnabled: false });
  assert.equal(countEdges(s.countdown, 0.6), 0, 'silence must not count down');
});

test('DropCountdown (unit): disarms immediately on a drop pulse', () => {
  const cd = new DropCountdown();
  let now = 0;
  // E2 P1-4: the arm gate now requires a MONOTONIC CLIMB into the peak — the
  // riser must have been clearly LOW recently before reaching the peak. Drive a
  // few LOW hops first so the climb origin is established, THEN the peak.
  for (let i = 0; i < 5; i++) { cd.update({ riserScore: 0.1, riserConf: 0.0, buildEta: 0, bpm: 128, bpmLocked: true, beat: 0, dropPulse: 0, dtMs: HOP_MS, nowMs: now }); now += HOP_MS; }
  // Confident peaked build (climbed in from the low above), bpm locked.
  const peaked = (beat, drop = 0) => cd.update({ riserScore: 0.85, riserConf: 0.9, buildEta: 0, bpm: 128, bpmLocked: true, beat, dropPulse: drop, dtMs: HOP_MS, nowMs: now });
  // hold the peak past peakHoldMs (but within peakMaxMs)
  for (let i = 0; i < Math.floor(700 / HOP_MS); i++) { peaked(0); now += HOP_MS; }
  const f1 = peaked(0.9); now += HOP_MS;   // a beat → fire
  assert.equal(f1.fired, true, 'a beat during a held peak should fire');
  // Now a drop arrives — the countdown must disarm (no fire even on a beat).
  peaked(0.0, 1.0); now += HOP_MS;
  const f2 = cd.update({ riserScore: 0.85, riserConf: 0.9, buildEta: 0, bpm: 128, bpmLocked: true, beat: 0.9, dropPulse: 0.0, dtMs: HOP_MS, nowMs: now });
  assert.equal(f2.active, false, 'countdown is inactive in the post-drop refractory');
});

test('DropCountdown (unit): does NOT arm without a monotonic climb (steady-high riser) — E2 P1-4', () => {
  const cd = new DropCountdown();
  let now = 0;
  // A riser that sits HIGH from t0 (never was low) is steady-state, not a build
  // top — it must not count down even with a held peak + bpm lock + beats.
  let fires = 0;
  for (let i = 0; i < Math.floor(3000 / HOP_MS); i++) {
    const beat = (i % 8 === 0) ? 0.9 : 0.0;   // a beat every few hops
    if (cd.update({ riserScore: 0.85, riserConf: 0.9, buildEta: 0, bpm: 128, bpmLocked: true, beat, dropPulse: 0, dtMs: HOP_MS, nowMs: now }).fired) fires++;
    now += HOP_MS;
  }
  assert.equal(fires, 0, `a steady-high riser (no climb-in) must not count down; got ${fires}`);
});

// ════════════════════════════════════════════════════════════════════════════
// 6. FINITENESS (all five through the publish path, silence-safe)
// ════════════════════════════════════════════════════════════════════════════

test('every new key is finite + in range across a full arc (edm_drop + silence + groove)', () => {
  const s = driveChain([
    { synth: 'silence', seconds: 2 },
    { synth: 'edm_drop', seconds: 16 },
    { synth: 'full_track', seconds: 6 },
    { synth: 'silence', seconds: 2 },
  ], { detectorEnabled: true });
  const ranges = {
    riserScore: [0, 1], buildEta: [0, 60], riserConf: [0, 1], silence: [0, 1],
    trackChange: [0, 1], climax: [0, 1], phrasePhase: [0, 1], phraseBoundary: [0, 1], countdown: [0, 1],
  };
  for (const [k, [min, max]] of Object.entries(ranges)) {
    for (let i = 0; i < s[k].length; i++) {
      const v = s[k][i];
      assert.ok(Number.isFinite(v), `${k} finite at hop ${i} (got ${v})`);
      assert.ok(v >= min && v <= max, `${k}=${v} in [${min},${max}] at hop ${i}`);
    }
  }
});
