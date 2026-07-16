/**
 * genre_classifier.test.js — validates the party-mode dance-genre classifier
 * (audio/signals/genre_classifier.js).
 *
 * v2 (2026-06-20, REAL-AUDIO RETUNE): the classifier's PROFILES + WEIGHTS were
 * re-anchored to MEASURED per-genre feature centroids from a real 60-track CC
 * dance-music corpus (see tools/genre_eval.mjs + report 20260620_18), and FOUR
 * engineered features were added (bassW, midW, tilt, fluxVar). The decision
 * logic (party gate, warmup, hysteresis, min-dwell, no-flicker) is UNCHANGED.
 *
 * These tests therefore split into two honest groups:
 *   (1) DECISION-LOGIC invariants — party gate, warmup, hysteresis, stability.
 *       These are exact and robust; they do not depend on the feature tuning.
 *   (2) FEATURE-SEPARATION sanity — scenarios whose BAND BALANCE + kick groove
 *       are set to match a genre's real centroid (so the engineered band-ratio
 *       features actually fire), asserting the right genre/family emerges.
 *       These are NOT exact-profile matches on synthetic priors (those did not
 *       survive the real-audio retune) — they assert that the discriminative
 *       axes the corpus search kept (kickReg, melodic ordering, midW, bassW,
 *       flux) separate the families the way the real-corpus eval shows.
 *
 * The corpus accuracy itself (23/36 = 63.9% at fft 2048) is measured by
 * tools/genre_eval.mjs against real audio in ~/tmp — not by this synthetic CI
 * test (which must run with no real-audio dependency).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GenreClassifier, GENRE_NAMES } from '../../audio/signals/genre_classifier.js';

const HOPS = 86.13;
const DT = 1 / HOPS;

// Drive the classifier for `seconds`. The caller sets the BAND BALANCE
// (low/mid/high) + flux explicitly so the engineered band-ratio features
// (bassW = low share, midW = mid share, tilt = high/(low+mid), fluxVar) take
// realistic per-genre values. kickBpm → a steady kick pulse train at that
// tempo; kickJitter perturbs the interval to model an IRREGULAR (low-kickReg)
// groove. noteFlipsPerSec → pitch-class changes per second (melodic content).
function runScenario(gc, opts, startMs = 0) {
  const { seconds, bpm, kickBpm = 0, low = 0.5, mid = 0.4, high = 0.2,
          flux = 0.3, noteFlipsPerSec = 0, party = true, kickJitter = 0 } = opts;
  let nowMs = startMs;
  const kickPeriodMs = kickBpm ? 60000 / kickBpm : Infinity;
  let nextKickMs = nowMs + kickPeriodMs;
  const flipPeriodMs = noteFlipsPerSec ? 1000 / noteFlipsPerSec : Infinity;
  let lastFlipMs = nowMs;
  let pc = 0;
  let out = { genre: 0, confidence: 0 };
  const totalHops = Math.round(seconds * HOPS);
  for (let i = 0; i < totalHops; i++) {
    nowMs += DT * 1000;
    let kick = 0;
    if (kickBpm && nowMs >= nextKickMs) {
      kick = 1;
      nextKickMs += kickPeriodMs * (1 + Math.sin(i) * kickJitter);
    }
    if (noteFlipsPerSec && (nowMs - lastFlipMs) >= flipPeriodMs) {
      pc = (pc + 5) % 12; lastFlipMs = nowMs;          // walk pitch classes
    }
    out = gc.update({
      nowMs, dt: DT, party,
      bpm, low, mid, high, flux,
      kick, pitchClass: noteFlipsPerSec ? pc : 0, noteStable: true,
    });
  }
  return { ...out, nowMs };
}

const FAMILY = {
  techno: [4, 5],                 // techno, melodic_techno
  house: [1, 2, 3],               // deep/melodic/tech house
  downtempo: [6],
};

// ── (1) Contract + decision-logic invariants (tuning-independent) ──────────

test('GENRE_NAMES is the frozen canonical 7-entry contract', () => {
  assert.deepEqual(GENRE_NAMES, ['ambient', 'deep_house', 'melodic_house',
    'tech_house', 'techno', 'melodic_techno', 'downtempo']);
  assert.equal(GENRE_NAMES.length, 7);
});

test('party gate: no party → ambient (0), confidence 0', () => {
  const gc = new GenreClassifier();
  const r = runScenario(gc, { seconds: 8, bpm: 130, kickBpm: 130, party: false });
  assert.equal(r.genre, 0);
  assert.equal(r.confidence, 0);
});

test('warmup: during the warmup window the genre stays ambient', () => {
  const gc = new GenreClassifier();
  // warmupMs default 5000 — sample at 3 s in.
  const r = runScenario(gc, { seconds: 3, bpm: 130, kickBpm: 130 });
  assert.equal(r.genre, 0);
});

test('a committed genre always carries confidence > 0 (argmax self-seed regression)', () => {
  // Regression guard for the old argmax self-seed bug (genre-1 wins → spread 0
  // → confidence structurally 0). Any committed party genre must report a real
  // spread-derived confidence > 0.
  const gc = new GenreClassifier();
  const r = runScenario(gc, { seconds: 14, bpm: 122, kickBpm: 122,
    low: 0.30, mid: 0.60, high: 0.22, flux: 0.35, noteFlipsPerSec: 2.5, kickJitter: 0.5 });
  assert.ok(r.genre >= 1, `expected a committed party genre, got ambient`);
  assert.ok(r.confidence > 0, 'a committed genre must carry confidence > 0');
});

test('hysteresis: a committed genre resets to ambient when party drops', () => {
  const gc = new GenreClassifier();
  const a = runScenario(gc, { seconds: 13, bpm: 125, kickBpm: 125,
    low: 0.55, mid: 0.30, high: 0.18, flux: 0.18, noteFlipsPerSec: 0.3 });
  assert.ok(a.genre >= 1, 'should have committed a party genre first');
  // party off for a few seconds → must bleed back to ambient.
  const b = runScenario(gc, { seconds: 3, bpm: 125, party: false }, a.nowMs);
  assert.equal(b.genre, 0);
});

test('stability: a steady section does not flicker genre hop-to-hop', () => {
  const gc = new GenreClassifier();
  // Run to commit on a firmly-separated section (the dry bass-forward
  // tech_house groove), then continue with the SAME steady input and count
  // changes — a committed genre must hold rock-steady, not flicker.
  const bpm = 125;
  const opts = { seconds: 10, bpm, kickBpm: bpm, low: 0.55, mid: 0.30,
    high: 0.18, flux: 0.18, noteFlipsPerSec: 0.3 };
  let { nowMs } = runScenario(gc, opts);
  let changes = 0, prev = gc.genre;
  const kickPeriodMs = 60000 / bpm; let nextKickMs = nowMs + kickPeriodMs;
  for (let i = 0; i < Math.round(6 * HOPS); i++) {
    nowMs += DT * 1000;
    let kick = 0; if (nowMs >= nextKickMs) { kick = 1; nextKickMs += kickPeriodMs; }
    gc.update({ nowMs, dt: DT, party: true, bpm, low: 0.55, mid: 0.30,
      high: 0.18, flux: 0.18, kick, pitchClass: 0, noteStable: true });
    if (gc.genre !== prev) { changes++; prev = gc.genre; }
  }
  assert.equal(changes, 0, 'steady section should not change genre at all');
});

// ── (2) Engineered-feature separation (anchored to real centroids) ─────────

test('tech_house groove (high bass share, dry/low-flux, regular kick) → tech_house (3)', () => {
  // tech_house's real signature: highest bassW (~0.38), LOWEST flux (~0.23),
  // lowest melodic. A bass-forward, dry, steady 4/4 must land on tech_house.
  const gc = new GenreClassifier();
  const r = runScenario(gc, { seconds: 13, bpm: 125, kickBpm: 125,
    low: 0.55, mid: 0.30, high: 0.18, flux: 0.18, noteFlipsPerSec: 0.3 });
  assert.equal(r.genre, 3, `expected tech_house, got ${GENRE_NAMES[r.genre]}`);
});

test('melodic_house (high mid share, irregular kick, busy melody) → melodic_house (2)', () => {
  // melodic_house's real signature: highest midW (~0.49), LOWEST kickReg
  // (~0.29 — loose groove), high melodic ordering. A mid-forward, loosely-
  // timed, melodic track must land on melodic_house.
  const gc = new GenreClassifier();
  const r = runScenario(gc, { seconds: 14, bpm: 122, kickBpm: 122,
    low: 0.30, mid: 0.60, high: 0.22, flux: 0.35, noteFlipsPerSec: 2.5, kickJitter: 0.5 });
  assert.equal(r.genre, 2, `expected melodic_house, got ${GENRE_NAMES[r.genre]}`);
});

test('melodic_techno (relentless fast steady kick) → techno family', () => {
  // melodic_techno's real signature: highest kickReg (~0.69) + kickDens (~0.97)
  // — a relentless fast metronomic kick. Must land in the techno family.
  const gc = new GenreClassifier();
  const r = runScenario(gc, { seconds: 13, bpm: 128, kickBpm: 140,
    low: 0.5, mid: 0.5, high: 0.36, flux: 0.3, noteFlipsPerSec: 0.5 });
  assert.ok(FAMILY.techno.includes(r.genre),
    `expected techno family, got ${r.genre} (${GENRE_NAMES[r.genre]})`);
  assert.ok(r.confidence > 0, 'a committed genre must carry confidence > 0');
});

test('family separation: bass-forward dry groove is NOT in the techno family', () => {
  // The bassW/flux axes must keep a bass-forward dry house groove OUT of the
  // techno family (the v1 failure mode collapsed everything onto techno).
  const gc = new GenreClassifier();
  const r = runScenario(gc, { seconds: 13, bpm: 124, kickBpm: 124,
    low: 0.55, mid: 0.30, high: 0.18, flux: 0.18, noteFlipsPerSec: 0.5 });
  assert.ok(FAMILY.house.includes(r.genre),
    `expected a house genre, got ${r.genre} (${GENRE_NAMES[r.genre]})`);
});
