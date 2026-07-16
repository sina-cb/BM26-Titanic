// Unit tests for the AUTOPILOT PROFILE seam (E1, autopilot profile improvement).
//
// The core contract: the `random` profile is BYTE-IDENTICAL to the legacy
// `pickNextAutoCycleEntry` for a seeded RNG sequence across all three pick
// modes (sequential / shuffle / group-locality). If these ever diverge, the
// "random == today" guarantee is broken and this test fails.
//
// Also pins the registry: AUTOPILOT_PROFILES list, the ONE documented default
// ('random'), normalize's absent→default / unknown→throw posture, and the
// profile factory. Plus the `random` profile's timer nextDelayMs mapping.
//
// Run:  cd marsin_engine && node --test tests/autopilot_profiles.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pickNextAutoCycleEntry } from '../../lib/autopilot_pick.js';
import {
  AUTOPILOT_PROFILES,
  AUTOPILOT_PROFILE_DEFAULT,
  normalizeAutopilotProfile,
  createAutopilotProfile,
} from '../../lib/autopilot_profiles/profile_registry.js';
import { RandomProfile } from '../../lib/autopilot_profiles/random_profile.js';

// ── Deterministic RNG so both callers see the IDENTICAL Math.random stream ──
// A tiny mulberry32 PRNG; we install it as Math.random for the duration of a
// comparison, restoring the real one after. Seeding the SAME sequence into both
// the legacy picker and the profile picker proves they make the same picks.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function withSeededRandom(seed, fn) {
  const real = Math.random;
  Math.random = mulberry32(seed);
  try {
    return fn();
  } finally {
    Math.random = real;
  }
}

function pl(n) {
  const entries = [];
  for (let i = 1; i <= n; i++) entries.push({ id: `e${i}`, pattern: `p${i}` });
  return { name: 'pl', entries };
}

// Drive `advances` picks from a starting entry, mutating a fresh groupRuntime,
// via the given picker fn. Returns the list of picked ids (deterministic under a
// seeded RNG). `pickFn` is (pl, ap, cur, gr) => entry|null.
function drive(pickFn, playlist, autopilot, startId, advances) {
  const gr = {};
  let cur = startId;
  const picks = [];
  for (let i = 0; i < advances; i++) {
    const e = pickFn(playlist, autopilot, cur, gr);
    if (!e) { picks.push(null); break; }
    picks.push(e.id);
    cur = e.id;
  }
  return picks;
}

// ── random profile == legacy picker (the load-bearing guarantee) ──────────
for (const mode of ['sequential', 'shuffle', 'group']) {
  test(`random profile picks == legacy pickNextAutoCycleEntry (${mode})`, () => {
    const playlist = pl(9);
    let ap;
    if (mode === 'sequential') ap = { active: true, shuffle: false };
    else if (mode === 'shuffle') ap = { active: true, shuffle: true };
    else ap = { active: true, shuffle: false, groupMode: true, groupSize: 3, groupDwell: 4 };

    const profile = new RandomProfile();
    const SEED = 0x1234abcd;
    const ADVANCES = 40;

    const legacy = withSeededRandom(SEED, () =>
      drive(pickNextAutoCycleEntry, playlist, ap, 'e1', ADVANCES));
    const viaProfile = withSeededRandom(SEED, () =>
      drive((p, a, c, g) => profile.pickNextEntry(p, a, c, g), playlist, ap, 'e1', ADVANCES));

    assert.deepEqual(viaProfile, legacy,
      `random profile diverged from the legacy picker in ${mode} mode`);
  });
}

test('random profile name is "random"', () => {
  assert.equal(new RandomProfile().name, 'random');
});

// ── random profile timing (nextDelayMs) ───────────────────────────────────
test('random profile nextDelayMs = delay_s * 1000 (timer-driven)', () => {
  const p = new RandomProfile();
  assert.equal(p.nextDelayMs({ delay_s: '30' }), 30000);
  assert.equal(p.nextDelayMs({ delay_s: 5 }), 5000);
  // Legacy floor: an unparseable delay maps to 30s (parseInt||30), never null.
  assert.equal(p.nextDelayMs({ delay_s: 'garbage' }), 30000);
  assert.equal(p.nextDelayMs({}), 30000);
});

// ── registry: list + default ──────────────────────────────────────────────
test('AUTOPILOT_PROFILES lists random first, then audio_reactive', () => {
  assert.deepEqual(AUTOPILOT_PROFILES, ['random', 'audio_reactive']);
});

test('AUTOPILOT_PROFILE_DEFAULT is random', () => {
  assert.equal(AUTOPILOT_PROFILE_DEFAULT, 'random');
});

// ── normalizeAutopilotProfile: absent → default; unknown → throw ───────────
test('normalize: absent/empty → documented default', () => {
  assert.equal(normalizeAutopilotProfile(undefined), 'random');
  assert.equal(normalizeAutopilotProfile(null), 'random');
  assert.equal(normalizeAutopilotProfile(''), 'random');
});

test('normalize: known names pass through', () => {
  assert.equal(normalizeAutopilotProfile('random'), 'random');
  assert.equal(normalizeAutopilotProfile('audio_reactive'), 'audio_reactive');
});

test('normalize: unknown value throws loudly (no silent coerce)', () => {
  assert.throws(() => normalizeAutopilotProfile('bogus'), /unknown autopilot profile/);
  assert.throws(() => normalizeAutopilotProfile(42), /unknown autopilot profile/);
  assert.throws(() => normalizeAutopilotProfile({}), /unknown autopilot profile/);
});

// ── createAutopilotProfile: factory + fresh instances ──────────────────────
test('createAutopilotProfile builds the named profile', () => {
  assert.equal(createAutopilotProfile('random').name, 'random');
  assert.equal(createAutopilotProfile('audio_reactive').name, 'audio_reactive');
  // Absent → default instance.
  assert.equal(createAutopilotProfile(undefined).name, 'random');
});

test('createAutopilotProfile returns a FRESH instance each call', () => {
  const a = createAutopilotProfile('random');
  const b = createAutopilotProfile('random');
  assert.notEqual(a, b, 'profiles must not be shared singletons (they hold state)');
});

test('createAutopilotProfile throws on unknown name', () => {
  assert.throws(() => createAutopilotProfile('nope'), /unknown autopilot profile/);
});

// ── profile interface shape (both profiles honor the frozen contract) ──────
for (const name of AUTOPILOT_PROFILES) {
  test(`${name} profile implements the profile interface`, () => {
    const p = createAutopilotProfile(name);
    assert.equal(typeof p.name, 'string');
    assert.equal(typeof p.attach, 'function');
    assert.equal(typeof p.detach, 'function');
    assert.equal(typeof p.nextDelayMs, 'function');
    assert.equal(typeof p.pickNextEntry, 'function');
    assert.equal(typeof p.validateState, 'function');
  });
}
