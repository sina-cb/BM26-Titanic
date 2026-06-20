/**
 * genre_classifier.test.js — validates the party-mode dance-genre classifier
 * (audio/signals/genre_classifier.js).
 *
 * The classifier is driven by the signals the engine already derives (BPM,
 * kick pulse train → density/regularity, band balance + high-band variance,
 * note-change rate). These tests drive it with deterministic raw-signal
 * SCENARIOS that mimic each genre's character and assert sensible, stable
 * classification — NOT brittle exact-profile matches. Genre detection is a
 * coarse "feel" signal (operator: "simple genre detection"), so the genre-
 * family assertions are intentionally robust (e.g. a techno-like scenario must
 * land in the TECHNO family, not necessarily the exact techno index).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GenreClassifier, GENRE_NAMES } from '../audio/signals/genre_classifier.js';

const HOPS = 86.13;
const DT = 1 / HOPS;

// Drive the classifier for `seconds`, returning the final {genre,confidence}.
// kickBpm → a steady one-hop kick pulse train at that tempo (regular 4-floor).
// dark → low/steady high band; brightVar → alternating high band (hat groove).
// noteFlipsPerSec → pitch-class changes per second (melodic content).
function runScenario(gc, opts, startMs = 0) {
  const { seconds, bpm, kickBpm = 0, dark = false, brightVar = false,
          noteFlipsPerSec = 0, party = true } = opts;
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
    if (kickBpm && nowMs >= nextKickMs) { kick = 1; nextKickMs += kickPeriodMs; }
    let high = dark ? 0.04 : 0.35;
    if (brightVar) high = (i % 8 < 4) ? 0.55 : 0.05;  // offbeat-hat-like variance
    if (noteFlipsPerSec && (nowMs - lastFlipMs) >= flipPeriodMs) {
      pc = (pc + 5) % 12; lastFlipMs = nowMs;          // walk pitch classes
    }
    out = gc.update({
      nowMs, dt: DT, party,
      bpm, low: 0.5, mid: 0.4, high, flux: 0.2,
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

test('GENRE_NAMES is the frozen canonical 7-entry contract', () => {
  assert.deepEqual(GENRE_NAMES, ['ambient', 'deep_house', 'melodic_house',
    'tech_house', 'techno', 'melodic_techno', 'downtempo']);
  assert.equal(GENRE_NAMES.length, 7);
});

test('party gate: no party → ambient (0), confidence 0', () => {
  const gc = new GenreClassifier();
  const r = runScenario(gc, { seconds: 8, bpm: 130, kickBpm: 130, dark: true, party: false });
  assert.equal(r.genre, 0);
  assert.equal(r.confidence, 0);
});

test('warmup: during the warmup window the genre stays ambient', () => {
  const gc = new GenreClassifier();
  // warmupMs default 5000 — sample at 3 s in.
  const r = runScenario(gc, { seconds: 3, bpm: 130, kickBpm: 130, dark: true });
  assert.equal(r.genre, 0);
});

test('techno-like scenario (130bpm, dark, steady kick, non-melodic) → techno family', () => {
  const gc = new GenreClassifier();
  const r = runScenario(gc, { seconds: 12, bpm: 130, kickBpm: 130, dark: true, noteFlipsPerSec: 0 });
  assert.ok(FAMILY.techno.includes(r.genre),
    `expected techno family, got ${r.genre} (${GENRE_NAMES[r.genre]})`);
  assert.ok(r.confidence > 0, 'a committed genre must carry confidence > 0');
});

test('downtempo-like scenario (102bpm, sparse kick, moving roots) → downtempo (6)', () => {
  const gc = new GenreClassifier();
  // BPM well below the 4/4 band is the strongest single cue (weight 2.2). Like
  // all non-techno genres, downtempo has MELODIC content (moving chord roots) —
  // `melodic≈0` is techno's exclusive signature, so feed note changes here.
  const r = runScenario(gc, { seconds: 12, bpm: 102, kickBpm: 90, dark: true, noteFlipsPerSec: 1.6 });
  assert.equal(r.genre, 6, `expected downtempo, got ${GENRE_NAMES[r.genre]}`);
});

test('house-like scenario (123bpm, bright + melodic) → NOT techno/downtempo', () => {
  const gc = new GenreClassifier();
  const r = runScenario(gc, { seconds: 12, bpm: 123, kickBpm: 123, dark: false, noteFlipsPerSec: 1.2 });
  assert.ok(FAMILY.house.includes(r.genre),
    `expected a house genre, got ${r.genre} (${GENRE_NAMES[r.genre]})`);
});

test('tech_house-like scenario (offbeat-hat variance) → tech_house (3)', () => {
  const gc = new GenreClassifier();
  const r = runScenario(gc, { seconds: 12, bpm: 125, kickBpm: 125, brightVar: true, noteFlipsPerSec: 1.6 });
  // sparkleVar is the tech_house signature (weight 2.0); a bright offbeat-hat
  // groove should pull it to tech_house specifically.
  assert.equal(r.genre, 3, `expected tech_house, got ${GENRE_NAMES[r.genre]}`);
});

test('hysteresis: a committed genre resets to ambient when party drops', () => {
  const gc = new GenreClassifier();
  const a = runScenario(gc, { seconds: 12, bpm: 102, kickBpm: 90, dark: true, noteFlipsPerSec: 1.6 });
  assert.equal(a.genre, 6);
  // party off for a few seconds → must bleed back to ambient.
  const b = runScenario(gc, { seconds: 3, bpm: 102, party: false }, a.nowMs);
  assert.equal(b.genre, 0);
});

test('stability: a steady section does not flicker genre hop-to-hop', () => {
  const gc = new GenreClassifier();
  // Run to commit, then continue and count changes over the next 6 s.
  let { nowMs } = runScenario(gc, { seconds: 10, bpm: 130, kickBpm: 130, dark: true });
  let changes = 0, prev = gc.genre;
  const kickPeriodMs = 60000 / 130; let nextKickMs = nowMs + kickPeriodMs;
  for (let i = 0; i < Math.round(6 * HOPS); i++) {
    nowMs += DT * 1000;
    let kick = 0; if (nowMs >= nextKickMs) { kick = 1; nextKickMs += kickPeriodMs; }
    gc.update({ nowMs, dt: DT, party: true, bpm: 130, low: 0.5, mid: 0.4, high: 0.04, flux: 0.2, kick, pitchClass: 0, noteStable: true });
    if (gc.genre !== prev) { changes++; prev = gc.genre; }
  }
  assert.equal(changes, 0, 'steady section should not change genre at all');
});
