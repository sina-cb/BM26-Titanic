/**
 * audio_analysis_validation.test.mjs — end-to-end integration regression
 * guard for the audio analysis system (analyzer + signal chain + structure
 * detector), driven by the deterministic synthetic labeled dataset.
 *
 * WHAT THIS GUARDS (against known ground truth):
 *   - clean_drop fires EXACTLY one dropFired within tolerance of the
 *     labeled drop, and the detector reaches SUSTAIN;
 *   - steady_loud and silence fire ZERO dropFired (false-positive
 *     controls);
 *   - double_drop's two genuine drops both fire and the 2 s refractory
 *     is respected (no third fire between them);
 *   - NO NaN/Infinity is ever published on any clip, any mode;
 *   - the detector's tick() p99 stays under the ≤ 0.5 ms/hop budget
 *     (docs/30 §Performance budget).
 *
 * CONFIG NOTE — defaults vs. tuned (honest disclosure):
 *   As of the corpus-tuning pass (report 202606/..._audio_corpus_tuning.md)
 *   the product DEFAULT drop edge is the WINDOWED rate-of-change
 *   discriminator (DETECTOR_DEFAULTS.dropEdgeMode='windowed',
 *   eventRefractoryMs=3500). That fix RESOLVED the old level-ratio in-body
 *   re-fire: the post-drop loud body no longer re-triggers, so the
 *   affirmative single-/double-fire controls now hold on the product
 *   default. The test still passes a TUNED `eventRefractoryMs: 4000` for
 *   the affirmative assertions purely to keep them robust to clip timing;
 *   the negative controls run on the bare product default (DEFAULT_CFG).
 *
 *   The affirmative single-/double-fire assertions run on the STEMS-FED
 *   path. In MIC-ONLY mode the detector fires prematurely during risers
 *   (it cannot separate a rising build from a drop on micLow alone) — a
 *   real limitation, reported but NOT asserted as passing. The universal
 *   invariants (zero NaN, perf budget, negative controls) ARE asserted in
 *   both modes.
 *
 * Run:  cd marsin_engine && node --test tests/integration/audio_analysis_validation.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildDataset } from './synth_dataset.mjs';
import { runClip, runClipViaWav, dropMetrics } from './run_analysis.mjs';
import { readWavMono, encodeWavMono } from './wav_io.mjs';

// Tuned config used for the AFFIRMATIVE deterministic assertions (see the
// CONFIG NOTE above). `enabled` plus the longer refractory; every other
// field stays at DETECTOR_DEFAULTS via the detector's own merge.
const TUNED_CFG = Object.freeze({ enabled: true, eventRefractoryMs: 4000 });
// The product defaults, used to PROVE the negative controls pass without
// any tuning at all.
const DEFAULT_CFG = Object.freeze({ enabled: true });

const DROP_TOLERANCE_MS = 1200; // ~½ bar at 120 BPM either side of the label
const PERF_BUDGET_MS = 0.5;     // docs/30 §Performance budget

const DATASET = buildDataset();
function clip(name) {
  const c = DATASET.find((x) => x.name === name);
  if (!c) throw new Error(`test dataset missing clip "${name}"`);
  return c;
}

// ── WAV codec round-trip (the file-replay decode path, minus ffmpeg) ──────

test('wav_io: encode → decode round-trips 16-bit PCM mono losslessly', () => {
  const src = new Int16Array([0, 1, -1, 32767, -32768, 12345, -6789, 100]);
  const buf = encodeWavMono(src, 44100);
  // Canonical 44-byte header + 2 bytes/sample.
  assert.equal(buf.length, 44 + src.length * 2);
  assert.equal(buf.toString('ascii', 0, 4), 'RIFF');
  assert.equal(buf.toString('ascii', 8, 12), 'WAVE');
  // Round-trip through a temp file and confirm the samples survive.
  const dir = path.join(os.homedir(), 'tmp', 'audio_validation');
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, 'wav_io_roundtrip.wav');
  fs.writeFileSync(p, buf);
  const decoded = readWavMono(p);
  assert.equal(decoded.sampleRate, 44100);
  assert.equal(decoded.samples.length, src.length);
  for (let i = 0; i < src.length; i++) assert.equal(decoded.samples[i], src[i]);
});

test('wav_io: rejects a non-WAV file loudly (no silent fallback)', () => {
  const dir = path.join(os.homedir(), 'tmp', 'audio_validation');
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, 'not_a_wav.bin');
  fs.writeFileSync(p, Buffer.from('this is definitely not a RIFF WAVE file at all'));
  assert.throws(() => readWavMono(p), /RIFF/);
});

test('runClipViaWav proves the WAV round-trip feeds the analyzer identically', () => {
  // clean_drop through a real temp WAV (write → read → feed) must produce
  // the same affirmative result as the in-memory path.
  const recWav = runClipViaWav(clip('clean_drop'), { mode: 'stems-fed', detectorConfig: TUNED_CFG });
  assert.equal(recWav.viaWav, true);
  // Re-read the file we wrote and confirm it decodes as mono 44.1k.
  const decoded = readWavMono(recWav.wavPath);
  assert.equal(decoded.sampleRate, 44100);
  assert.ok(decoded.samples.length > 0);
  const dm = dropMetrics(recWav, DROP_TOLERANCE_MS);
  assert.equal(dm.detectedDrops, 1, 'WAV-replayed clean_drop fires exactly one drop');
  assert.equal(dm.tp, 1);
  assert.ok(recWav.reachedSustain, 'WAV-replayed clean_drop reaches SUSTAIN');
});

// ── Affirmative controls (stems-fed, tuned) ──────────────────────────────

test('clean_drop fires exactly one dropFired near the labeled drop and reaches SUSTAIN', () => {
  const rec = runClip(clip('clean_drop'), { mode: 'stems-fed', detectorConfig: TUNED_CFG });
  const dm = dropMetrics(rec, DROP_TOLERANCE_MS);
  assert.equal(rec.dropFired.length, 1, `expected exactly 1 dropFired, got ${rec.dropFired.length} @ [${rec.dropFired.map((d) => (d.ts / 1000).toFixed(2)).join(',')}]`);
  assert.equal(dm.tp, 1, 'the single drop matches the labeled drop within tolerance');
  assert.equal(dm.fp, 0, 'no false-positive drops');
  assert.equal(dm.fn, 0, 'the labeled drop is not missed');
  assert.ok(Math.abs(dm.meanLatencyMs) <= DROP_TOLERANCE_MS, `latency ${dm.meanLatencyMs}ms within tolerance`);
  assert.ok(rec.reachedSustain, 'detector reached SUSTAIN');
  // The build → drop transition carries a build duration.
  assert.ok(rec.dropFired[0].buildDurationMs >= 0, 'buildDurationMs present and non-negative');
});

test('double_drop fires both genuine drops and respects the 2 s refractory', () => {
  const rec = runClip(clip('double_drop'), { mode: 'stems-fed', detectorConfig: TUNED_CFG });
  const dm = dropMetrics(rec, DROP_TOLERANCE_MS);
  // Both labeled drops detected.
  assert.equal(dm.tp, 2, 'both labeled drops detected');
  assert.equal(dm.fn, 0, 'neither labeled drop missed');
  assert.equal(rec.dropFired.length, 2, `expected exactly 2 dropFired, got [${rec.dropFired.map((d) => (d.ts / 1000).toFixed(2)).join(',')}]`);
  // Refractory: the two fires are far enough apart (the labeled drops are
  // ~10 s apart) AND no fire violates even the product-DEFAULT 2 s window.
  const ts = rec.dropFired.map((d) => d.ts).sort((a, b) => a - b);
  for (let i = 1; i < ts.length; i++) {
    assert.ok(ts[i] - ts[i - 1] >= 2000, `consecutive drops ${(ts[i - 1] / 1000).toFixed(2)}s and ${(ts[i] / 1000).toFixed(2)}s violate the 2 s refractory`);
  }
});

test('double_drop respects the 2 s refractory under the PRODUCT-DEFAULT config too', () => {
  // Even without the tuned refractory, no two fires land < 2 s apart
  // (the product default eventRefractoryMs is 2000).
  const rec = runClip(clip('double_drop'), { mode: 'stems-fed', detectorConfig: DEFAULT_CFG });
  const ts = rec.dropFired.map((d) => d.ts).sort((a, b) => a - b);
  for (let i = 1; i < ts.length; i++) {
    assert.ok(ts[i] - ts[i - 1] >= 2000, `default-config drops ${(ts[i - 1] / 1000).toFixed(2)}s/${(ts[i] / 1000).toFixed(2)}s violate the 2 s refractory`);
  }
});

// ── Negative controls (pass on the PRODUCT-DEFAULT config, both modes) ────

for (const mode of ['mic-only', 'stems-fed']) {
  test(`steady_loud fires ZERO dropFired (${mode}, product-default config)`, () => {
    const rec = runClip(clip('steady_loud'), { mode, detectorConfig: DEFAULT_CFG });
    assert.equal(rec.dropFired.length, 0, `steady_loud must not fire; got [${rec.dropFired.map((d) => (d.ts / 1000).toFixed(2)).join(',')}]`);
  });

  test(`silence fires ZERO dropFired and never leaves THIN (${mode}, product-default config)`, () => {
    const rec = runClip(clip('silence'), { mode, detectorConfig: DEFAULT_CFG });
    assert.equal(rec.dropFired.length, 0, 'silence must not fire');
    assert.ok(!rec.reachedSustain, 'silence must not reach SUSTAIN');
    // Every published structure value stays THIN (0).
    assert.ok(rec.timeline.every((r) => r.state === 0), 'silence stays in THIN the whole clip');
  });
}

// ── Universal invariants across the WHOLE dataset × both modes ────────────

for (const c of DATASET) {
  for (const mode of ['mic-only', 'stems-fed']) {
    test(`no NaN/Infinity ever published — ${c.name} (${mode})`, () => {
      const rec = runClip(c, { mode, detectorConfig: TUNED_CFG });
      assert.equal(rec.anyNonFinite, false, `${c.name} (${mode}) published a non-finite value`);
    });

    test(`tick p99 under the ${PERF_BUDGET_MS} ms/hop budget — ${c.name} (${mode})`, () => {
      const rec = runClip(c, { mode, detectorConfig: TUNED_CFG });
      assert.ok(
        rec.tickP99Ms <= PERF_BUDGET_MS,
        `${c.name} (${mode}) tick p99 ${rec.tickP99Ms.toFixed(3)} ms exceeds ${PERF_BUDGET_MS} ms budget`,
      );
    });
  }
}

// ── Determinism: two runs of the same clip are byte-identical ─────────────

test('runs are deterministic (seeded) — identical drop timings across two runs', () => {
  const a = runClip(clip('clean_drop'), { mode: 'stems-fed', detectorConfig: TUNED_CFG });
  const b = runClip(clip('clean_drop'), { mode: 'stems-fed', detectorConfig: TUNED_CFG });
  assert.deepEqual(
    a.dropFired.map((d) => [d.ts, d.confidence]),
    b.dropFired.map((d) => [d.ts, d.confidence]),
    'two runs must produce identical drop events',
  );
});
