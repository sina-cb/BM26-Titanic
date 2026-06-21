// Unit tests for AUTO-CYCLE (round-2 #2, docs/39 §auto-cycle): a mixer
// overlay channel auto-advances its playlist on a timer, generalizing the
// deck Autopilot daemon to any overlay.
//
// The decision logic is pure + fake-clock-tested (no real sleeps):
//   - autoCycleDueDecision(channel, nowMs)  → 'skip'|'seed'|'wait'|'due'
//   - pickNextAutoCycleEntry(pl, autopilot, curEntryId) → next entry|null
//   - validateAutoCycleDelay(raw)           → API-boundary 400 contract
// Plus: the transient _autoCycleLastAdvanceMs is NEVER serialized (playlist
// round-trips whole; autopilot defaults fill on restore), and the exterior
// (active=false default) never changes.
//
// Run:  cd marsin_engine && node --test tests/auto_cycle.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PatternChannel } from '../lib/pattern_channel.js';
import { serializeChannel } from '../lib/state_manager.js';
import {
  validateAutoCycleDelay,
  autoCycleDueDecision,
  pickNextAutoCycleEntry,
} from '../lib/api_server.js';

// ── Helpers ───────────────────────────────────────────────────────────
function ch(playlist = null) {
  const c = new PatternChannel({ id: 'c1', name: 'C', pattern: 'p', handle: 1 });
  c.playlist = playlist;
  return c;
}
function activePlaylist({ delay_s = 30, shuffle = false, activeEntryId = 'e1' } = {}) {
  return {
    name: 'pl1',
    activeEntryId,
    cursor: 0,
    autopilot: { active: true, delay_s, shuffle },
  };
}
function pl(entries, name = 'pl1') {
  return { name, entries };
}

// ── Transient field default ───────────────────────────────────────────
test('_autoCycleLastAdvanceMs defaults to null (transient anchor)', () => {
  assert.equal(ch()._autoCycleLastAdvanceMs, null);
});

// ── autoCycleDueDecision: seed / wait / due ───────────────────────────
test('first active frame SEEDS, does not advance', () => {
  const c = ch(activePlaylist({ delay_s: 2 }));
  assert.equal(autoCycleDueDecision(c, 1000), 'seed');
});

test('after seeding, WAITS until delay_s elapses, then DUE (fake clock)', () => {
  const c = ch(activePlaylist({ delay_s: 2 }));
  // Simulate the tick seeding the anchor.
  c._autoCycleLastAdvanceMs = 1000;
  assert.equal(autoCycleDueDecision(c, 1000), 'wait');     // 0ms elapsed
  assert.equal(autoCycleDueDecision(c, 2999), 'wait');     // 1999ms < 2000
  assert.equal(autoCycleDueDecision(c, 3000), 'due');      // exactly 2000ms
  assert.equal(autoCycleDueDecision(c, 9999), 'due');      // well past
});

test('inactive autopilot never advances (SKIP)', () => {
  const c = ch(activePlaylist({ delay_s: 1 }));
  c.playlist.autopilot.active = false;
  c._autoCycleLastAdvanceMs = 0; // even with an old anchor
  assert.equal(autoCycleDueDecision(c, 1e9), 'skip');
});

test('no playlist / no playlist.name → SKIP (nothing to cycle)', () => {
  assert.equal(autoCycleDueDecision(ch(null), 1000), 'skip');
  const noName = ch({ name: null, activeEntryId: null, cursor: 0, autopilot: { active: true, delay_s: 1, shuffle: false } });
  assert.equal(autoCycleDueDecision(noName, 1000), 'skip');
});

test('delay_s floored to 1s in the due decision (stale 0 cannot strobe)', () => {
  const c = ch(activePlaylist({ delay_s: 0 }));
  c._autoCycleLastAdvanceMs = 0;
  assert.equal(autoCycleDueDecision(c, 999), 'wait');   // <1000ms
  assert.equal(autoCycleDueDecision(c, 1000), 'due');   // exactly 1s
});

// ── EXTERIOR IMMUNITY: active=false default never changes ──────────────
test('exterior channel (autopilot active defaults false) never advances', () => {
  // loadPlaylistEntry constructs autopilot {active:false,...} by default;
  // a channel that was never opted-in must report SKIP forever.
  const c = ch({ name: 'pl1', activeEntryId: 'e1', cursor: 0,
                 autopilot: { active: false, delay_s: 30, shuffle: false } });
  c._autoCycleLastAdvanceMs = 0;
  for (const t of [1000, 60000, 3600000]) {
    assert.equal(autoCycleDueDecision(c, t), 'skip');
  }
});

// ── pickNextAutoCycleEntry: sequential ─────────────────────────────────
test('sequential picks the next entry, wrapping', () => {
  const p = pl([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
  assert.equal(pickNextAutoCycleEntry(p, { shuffle: false }, 'a').id, 'b');
  assert.equal(pickNextAutoCycleEntry(p, { shuffle: false }, 'b').id, 'c');
  assert.equal(pickNextAutoCycleEntry(p, { shuffle: false }, 'c').id, 'a'); // wrap
});

test('sequential SKIPS _missing entries', () => {
  const p = pl([{ id: 'a' }, { id: 'b', _missing: true }, { id: 'c' }]);
  assert.equal(pickNextAutoCycleEntry(p, { shuffle: false }, 'a').id, 'c'); // b skipped
  assert.equal(pickNextAutoCycleEntry(p, { shuffle: false }, 'c').id, 'a');
});

test('pick returns null when no usable entries (all _missing)', () => {
  const p = pl([{ id: 'a', _missing: true }, { id: 'b', _missing: true }]);
  assert.equal(pickNextAutoCycleEntry(p, { shuffle: false }, 'a'), null);
});

test('pick returns null for empty / nullish playlist', () => {
  assert.equal(pickNextAutoCycleEntry(null, { shuffle: false }, 'a'), null);
  assert.equal(pickNextAutoCycleEntry(pl([]), { shuffle: false }, 'a'), null);
});

// ── pickNextAutoCycleEntry: shuffle ────────────────────────────────────
test('shuffle picks an entry DIFFERENT from current (across many draws)', () => {
  const p = pl([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]);
  for (let i = 0; i < 200; i++) {
    const next = pickNextAutoCycleEntry(p, { shuffle: true }, 'a');
    assert.notEqual(next.id, 'a', 'shuffle must never pick the current entry');
  }
});

test('shuffle with only the current entry usable replays it (no other choice)', () => {
  const p = pl([{ id: 'a' }, { id: 'b', _missing: true }]);
  assert.equal(pickNextAutoCycleEntry(p, { shuffle: true }, 'a').id, 'a');
});

// ── pickNextAutoCycleEntry: hold / loop (mirror deck gate) ─────────────
test('hold PARKS — returns null (overrides shuffle/sequential)', () => {
  const p = pl([{ id: 'a', hold: true }, { id: 'b' }]);
  assert.equal(pickNextAutoCycleEntry(p, { shuffle: false }, 'a'), null);
  assert.equal(pickNextAutoCycleEntry(p, { shuffle: true }, 'a'), null);
});

test('loop REPLAYS the same entry (overrides shuffle)', () => {
  const p = pl([{ id: 'a', loop: true }, { id: 'b' }, { id: 'c' }]);
  assert.equal(pickNextAutoCycleEntry(p, { shuffle: false }, 'a').id, 'a');
  assert.equal(pickNextAutoCycleEntry(p, { shuffle: true }, 'a').id, 'a');
});

test('stale/removed activeEntryId skips the hold/loop gate (sequential runs)', () => {
  const p = pl([{ id: 'a' }, { id: 'b' }]);
  // curEntryId 'zzz' not in list → findIndex -1 → next is index 0.
  assert.equal(pickNextAutoCycleEntry(p, { shuffle: false }, 'zzz').id, 'a');
});

// ── validateAutoCycleDelay: API boundary 400 contract ──────────────────
test('validateAutoCycleDelay rejects non-finite / ≤0 (→400), floors to 1s', () => {
  assert.equal(validateAutoCycleDelay(NaN).ok, false);
  assert.equal(validateAutoCycleDelay(Infinity).ok, false);
  assert.equal(validateAutoCycleDelay(null).ok, false);
  assert.equal(validateAutoCycleDelay(true).ok, false);
  assert.equal(validateAutoCycleDelay('').ok, false);
  assert.equal(validateAutoCycleDelay('oops').ok, false);
  assert.equal(validateAutoCycleDelay(0).ok, false);
  assert.equal(validateAutoCycleDelay(-5).ok, false);
  // Valid positives: floored to 1.
  assert.equal(validateAutoCycleDelay(0.5).value, 1);
  assert.equal(validateAutoCycleDelay(1).value, 1);
  assert.equal(validateAutoCycleDelay(30).value, 30);
  assert.equal(validateAutoCycleDelay('45').value, 45);
});

// ── Serialize round-trip via playlist; transient never serialized ──────
test('serializeChannel round-trips autopilot inside playlist', () => {
  const c = ch(activePlaylist({ delay_s: 12, shuffle: true }));
  const s = serializeChannel(c);
  assert.equal(s.playlist.autopilot.active, true);
  assert.equal(s.playlist.autopilot.delay_s, 12);
  assert.equal(s.playlist.autopilot.shuffle, true);
});

test('serializeChannel NEVER emits the transient _autoCycleLastAdvanceMs', () => {
  const c = ch(activePlaylist());
  c._autoCycleLastAdvanceMs = 123456; // dirty the anchor
  const s = serializeChannel(c);
  assert.equal('_autoCycleLastAdvanceMs' in s, false);
});

test('restore: a playlist missing autopilot loads, autopilot fills on first load', () => {
  // An old state file's playlist with no autopilot key round-trips as-is
  // (serializer copies playlist whole); the autopilot defaults are filled by
  // loadPlaylistEntry on the next load (active:false → exterior-immune).
  const oldPlaylist = { name: 'pl1', activeEntryId: 'e1', cursor: 0 };
  const c = ch(oldPlaylist);
  const s = serializeChannel(c);
  assert.equal(s.playlist.name, 'pl1');
  assert.equal(s.playlist.autopilot, undefined); // not invented by the serializer
  // A channel restored without autopilot reports SKIP (immune) until armed.
  assert.equal(autoCycleDueDecision(c, 1e9), 'skip');
});
