/**
 * genre_eval_harness.test.mjs — guards the REAL genre-eval harness machinery
 * (tools/genre_eval.mjs runWav) without depending on the ~/tmp real-audio
 * corpus. Synthesizes a deterministic loud 4-on-the-floor clip, runs it through
 * the EXACT engine chain the harness wires (analyzer → postproc → detector →
 * derivedSignals), and asserts the chain produces a valid, finite party genre.
 *
 * This proves the harness is wired correctly (party latches under --force-party,
 * audioGenre lands in the party range 1..6, the feature vector is finite) so a
 * corpus run's numbers are trustworthy. The genre VALUE on synthetic audio is
 * not asserted (that is what the real corpus is for) — only that the pipeline
 * yields a well-formed published genre.
 *
 * Run:  cd marsin_engine && node --test tests/genre_eval_harness.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runWav, GENRE_NAMES } from '../tools/genre_eval.mjs';

const SR = 44100;
// Deployed product FFT size (config.yaml audio.fftSize = 2048, Wave D1; the
// same value run_analysis.mjs + tools/genre_eval.mjs default to). The harness
// must exercise the chain at the SHIPPED resolution — testing 1024 (the old
// value here) guarded a configuration the engine no longer runs and could mask
// a 2048-only regression.
const PRODUCT_FFT_SIZE = 2048;

/** Deterministic loud 4-on-the-floor clip: ~128 BPM kick + steady bass tone. */
function synthFourOnFloor({ seconds = 18, bpm = 128 } = {}) {
  const n = Math.floor(seconds * SR);
  const samples = new Int16Array(n);
  const beatSec = 60 / bpm;
  const kickDurSec = 0.09;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    // Steady low bass drone (~60 Hz) — keeps the loudness gate latched.
    let v = 0.35 * Math.sin(2 * Math.PI * 60 * t);
    // Kick: a decaying ~55 Hz thump on each beat.
    const phase = t % beatSec;
    if (phase < kickDurSec) {
      const env = Math.exp(-phase / 0.03);
      v += 0.6 * env * Math.sin(2 * Math.PI * 55 * phase);
    }
    // A little high-band hiss so the bands are all populated.
    v += 0.05 * (Math.sin(2 * Math.PI * 8000 * t));
    samples[i] = Math.max(-32768, Math.min(32767, Math.round(v * 30000)));
  }
  return samples;
}

test('genre-eval harness: force-party latches and publishes a valid party genre', () => {
  const samples = synthFourOnFloor();
  const r = runWav(samples, SR, { forceParty: true, fftSize: PRODUCT_FFT_SIZE });

  assert.ok(r.perHop.length > 100, `expected many hops, got ${r.perHop.length}`);
  assert.equal(r.partyEverOn, true, 'force-party should latch the party gate');

  // Published genre must be a valid index, and a PARTY genre (1..6) on loud music.
  assert.ok(Number.isInteger(r.tailVoteGenre), `genre index not an int: ${r.tailVoteGenre}`);
  assert.ok(r.tailVoteGenre >= 1 && r.tailVoteGenre <= GENRE_NAMES.length - 1,
    `genre out of party range: ${r.tailVoteGenre} (${GENRE_NAMES[r.tailVoteGenre]})`);

  // Feature centroid must be finite and in [0,1] (normalized features).
  // The classifier's feature vector is the v3 15-dim layout: 8 original
  // (bpm,kickReg,kickDens,lowMid,sparkle,sparkleVar,melodic,flux) + 4 v2
  // engineered (bassW,midW,tilt,fluxVar) + 3 v3 chroma harmonic-axis features
  // (tonalStab,chromaFlux,chromaTilt) added in the chroma building-block slice.
  assert.equal(r.meanFeat.length, 15, 'feature vector should have 15 dims (v3 chroma)');
  for (const f of r.meanFeat) {
    assert.ok(Number.isFinite(f), `non-finite feature: ${f}`);
    assert.ok(f >= -1e-6 && f <= 1 + 1e-6, `feature out of [0,1]: ${f}`);
  }
  assert.ok(r.meanConf >= 0 && r.meanConf <= 1, `conf out of [0,1]: ${r.meanConf}`);
});

test('genre-eval harness: without force-party, a SILENT clip never latches party (genre stays ambient)', () => {
  const samples = new Int16Array(Math.floor(8 * SR)); // all zeros = silence
  const r = runWav(samples, SR, { forceParty: false, fftSize: PRODUCT_FFT_SIZE });
  assert.equal(r.partyEverOn, false, 'silence must not latch party');
  // Genre is ambient (0) outside party mode — the classifier publishes 0.
  assert.equal(r.tailVoteGenre, 0, `silent clip should publish ambient (0), got ${r.tailVoteGenre}`);
});
