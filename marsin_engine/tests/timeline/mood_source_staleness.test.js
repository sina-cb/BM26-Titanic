// Unit tests for lib/timeline/mood_source.js — the mood STALENESS guard
// (report 20260725_10 build item 5 / §5 row 8).
//
// The failure being closed: the mood key is produced by the Audio Companion, a
// SEPARATE process. If it dies, the CPC does not go quiet — it FREEZES at the
// last value. A frozen `audioPartyStrong = 1` would pin the rig in party mode
// forever with nothing anywhere saying why.
//
// The guard's contract, pinned here:
//   - freshness is measured on the CPC WRITE REVISION, not the value (a 5 Hz
//     republish of the SAME value must read as alive)
//   - stale ⇒ mood forced CALM so the ambient default cue reclaims the deck
//   - stale is LOUD (console.error on the edge) and OBSERVABLE (stale /
//     staleForSec / rawValue / staleEpisodes on the read)
//   - it is NOT a silent fallback: rawValue still reports the frozen value we
//     are refusing
//
// Run:  cd marsin_engine && node --test tests/timeline/mood_source_staleness.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MoodSource } from '../../lib/timeline/mood_source.js';

/** Minimal CPC stand-in: a value + a write revision that only WRITES bump. */
function fakeCpc(key, value = 0) {
  return {
    _v: value,
    _rev: 0,
    _known: new Set([key]),
    isRegisteredKey(k) { return this._known.has(k); },
    get(k) {
      if (!this._known.has(k)) throw new Error(`unknown key ${k}`);
      return this._v;
    },
    getLastRevision(k) { return this._known.has(k) ? this._rev : null; },
    /** Simulate the companion republishing (same or new value). */
    publish(v) { this._v = v; this._rev++; },
  };
}

function silentLogger() {
  const calls = { error: [], warn: [] };
  return {
    calls,
    error: (m) => calls.error.push(m),
    warn: (m) => calls.warn.push(m),
  };
}

function build({ key = 'audioPartyStrong', staleSec = 10 } = {}) {
  const clock = { ms: 1_000_000 };
  const pc = fakeCpc(key);
  const logger = silentLogger();
  const ms = new MoodSource({
    paramCenter: pc, key, partyThreshold: 0.5, staleSec,
    nowFn: () => clock.ms, logger,
  });
  return { clock, pc, logger, ms };
}

test('a live 5 Hz republish of the SAME value reads FRESH (revision, not value)', () => {
  const { clock, pc, ms } = build();
  pc.publish(1);
  for (let i = 0; i < 200; i++) {   // 40 s at 5 Hz
    clock.ms += 200;
    pc.publish(1);                  // identical value, new write
    const r = ms.read();
    assert.equal(r.stale, false, `stale at t+${i * 200}ms while actively publishing`);
    assert.equal(r.party, 1);
    assert.equal(r.value, 1);
  }
});

test('a FROZEN party value drops to CALM once the staleness budget elapses', () => {
  const { clock, pc, logger, ms } = build({ staleSec: 10 });
  pc.publish(1);
  clock.ms += 200;
  assert.equal(ms.read().party, 1, 'precondition: party is live');

  // The companion dies here. The CPC keeps holding 1.
  clock.ms += 9_000;
  const stillFresh = ms.read();
  assert.equal(stillFresh.stale, false, 'inside the budget the value is still trusted');
  assert.equal(stillFresh.party, 1);

  clock.ms += 2_000;   // total ~11 s since the last write
  const r = ms.read();
  assert.equal(r.stale, true, 'past the budget the key is declared stale');
  assert.equal(r.party, 0, 'mood must be forced CALM → the ambient default cue reclaims the deck');
  assert.equal(r.value, 0);
  assert.equal(r.rawValue, 1, 'the FROZEN value stays visible — we report what we are refusing');
  assert.ok(r.staleForSec >= 10, `staleForSec ${r.staleForSec} should report the real age`);
  assert.equal(r.staleEpisodes, 1);
  assert.equal(logger.calls.error.length, 1, 'the stale edge must log LOUDLY, exactly once');
  assert.match(logger.calls.error[0], /MOOD SOURCE STALE/);
  assert.match(logger.calls.error[0], /CALM/);
});

test('the loud log fires on the EDGE only, not every tick', () => {
  const { clock, pc, logger, ms } = build({ staleSec: 5 });
  pc.publish(1);
  clock.ms += 200;
  ms.read();
  clock.ms += 10_000;
  for (let i = 0; i < 50; i++) { ms.read(); clock.ms += 1_000; }
  assert.equal(logger.calls.error.length, 1, 'one edge ⇒ one error line, not 50');
});

test('recovery is reported and the mood is trusted again', () => {
  const { clock, pc, logger, ms } = build({ staleSec: 5 });
  // NOTE the read right after the publish: freshness is learned by OBSERVING a
  // revision change, and the timeline reads every tick (1 s), so a write is
  // always observed long before the budget. A publish that is never read cannot
  // be dated — that is why the guard is a per-tick reader, not a one-shot check.
  pc.publish(1);
  clock.ms += 200;
  assert.equal(ms.read().stale, false, 'precondition: the source is live');
  clock.ms += 20_000;
  assert.equal(ms.read().stale, true);

  // The companion comes back.
  pc.publish(1);
  clock.ms += 200;
  const r = ms.read();
  assert.equal(r.stale, false);
  assert.equal(r.party, 1, 'a recovered source is trusted again immediately');
  assert.equal(logger.calls.warn.length, 1, 'recovery must be reported too');
  assert.match(logger.calls.warn[0], /RECOVERED/);

  // A second death is a second, separately-counted episode.
  clock.ms += 20_000;
  const r2 = ms.read();
  assert.equal(r2.stale, true);
  assert.equal(r2.staleEpisodes, 2, 'a flapping companion is visible after the fact');
  assert.equal(logger.calls.error.length, 2);
});

test('a key that was NEVER published goes stale from BOOT (no free pass at startup)', () => {
  const { clock, logger, ms } = build({ staleSec: 10 });
  // No publish at all — the companion never came up.
  assert.equal(ms.read().stale, false, 'inside the budget we simply have no data yet');
  clock.ms += 15_000;
  const r = ms.read();
  assert.equal(r.stale, true, 'a never-published key must age out, not read fresh forever');
  assert.equal(r.party, 0);
  assert.equal(r.rawValue, 0, 'the CPC default is still reported honestly');
  assert.equal(logger.calls.error.length, 1);
});

test('a MISCONFIGURED key (not registered) is stale immediately, with its own message', () => {
  const clock = { ms: 1_000_000 };
  const pc = fakeCpc('audioPartyStrong');
  const logger = silentLogger();
  const ms = new MoodSource({
    paramCenter: pc, key: 'audioPartyStrongTypo', partyThreshold: 0.5,
    staleSec: 10, nowFn: () => clock.ms, logger,
  });
  const r = ms.read();
  assert.equal(r.stale, true, 'an unregistered mood key is never trusted');
  assert.equal(r.party, 0);
  assert.equal(r.rawValue, null, 'null rawValue distinguishes "bad key" from "dead producer"');
  assert.match(logger.calls.error[0], /NOT REGISTERED/);
});

test('threshold semantics: value must reach partyThreshold', () => {
  const { clock, pc, ms } = build();
  pc.publish(0.49); clock.ms += 200;
  assert.equal(ms.read().party, 0);
  pc.publish(0.5); clock.ms += 200;
  assert.equal(ms.read().party, 1);
});

test('constructor validates its inputs loudly', () => {
  const pc = fakeCpc('audioPartyStrong');
  assert.throws(() => new MoodSource({ key: 'k', partyThreshold: 0.5 }), /paramCenter/);
  assert.throws(() => new MoodSource({ paramCenter: pc, partyThreshold: 0.5 }), /mood key/);
  assert.throws(() => new MoodSource({ paramCenter: pc, key: 'k' }), /partyThreshold/);
  assert.throws(() => new MoodSource({ paramCenter: pc, key: 'k', partyThreshold: 0.5, staleSec: 0 }),
    /staleSec must be a number > 0/);
});
