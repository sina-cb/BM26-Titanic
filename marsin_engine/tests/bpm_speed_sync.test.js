// BpmSpeedSync unit tests. Use a fake ParamCenter so we exercise
// just the mapping logic without standing up the whole CPC.
//
// Run:  cd marsin_engine && node --test tests/bpm_speed_sync.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BpmSpeedSync } from '../lib/bpm_speed_sync.js';

/** Minimal stub that quacks like ParamCenter from BpmSpeedSync's POV. */
function fakePc() {
  const subscribers = [];
  const writes = [];
  // Last param snapshot an emit() carried, so getCanonicalState() (used by
  // recompute()) can return the same `{ key: { value } }` shape.
  let lastParams = {};
  return {
    subscribe(fn) {
      subscribers.push(fn);
      return () => {
        const i = subscribers.indexOf(fn);
        if (i >= 0) subscribers.splice(i, 1);
      };
    },
    set(key, value, source, origin) {
      writes.push({ key, value, source, origin });
      return { status: 'ok' };
    },
    /** Canonical-state shape recompute() reads. */
    getCanonicalState() {
      return { params: lastParams };
    },
    /** Set the canonical params WITHOUT firing subscribers (e.g. a tap). */
    setParams(params) {
      lastParams = params;
    },
    /** Drive an event with whatever param values the test wants. */
    emit(changedKeys, params) {
      lastParams = params;
      const ev = { changedKeys, state: { params } };
      for (const fn of [...subscribers]) fn(ev);
    },
    get writes() { return writes; },
    get subscriberCount() { return subscribers.length; },
  };
}

function paramSnap(overrides = {}) {
  return {
    audioBpm:     { value: 120, ...(overrides.audioBpm     || {}) },
    bpmSpeedSync: { value: 1,   ...(overrides.bpmSpeedSync || {}) },
    bpmSpeedMin:  { value: 60,  ...(overrides.bpmSpeedMin  || {}) },
    bpmSpeedMax:  { value: 180, ...(overrides.bpmSpeedMax  || {}) },
  };
}

test('constructor rejects non-PC arg', () => {
  assert.throws(() => new BpmSpeedSync(null));
  assert.throws(() => new BpmSpeedSync({}));
});

test('bpm in the middle of [min,max] maps to 0.5', () => {
  const pc = fakePc();
  new BpmSpeedSync(pc).attach();
  pc.emit(['audioBpm'], paramSnap({ audioBpm: { value: 120 } }));
  assert.equal(pc.writes.length, 1);
  assert.equal(pc.writes[0].key, 'speed');
  assert.equal(pc.writes[0].value, 0.5);
  assert.equal(pc.writes[0].source, 'bpm-sync');
});

test('bpm at min/max edges hit 0 and 1; out-of-range clamps', () => {
  const pc = fakePc();
  new BpmSpeedSync(pc).attach();
  pc.emit(['audioBpm'], paramSnap({ audioBpm: { value: 60 } }));
  assert.equal(pc.writes.at(-1).value, 0);
  pc.emit(['audioBpm'], paramSnap({ audioBpm: { value: 180 } }));
  assert.equal(pc.writes.at(-1).value, 1);
  pc.emit(['audioBpm'], paramSnap({ audioBpm: { value: 240 } }));
  assert.equal(pc.writes.at(-1).value, 1, 'over-max clamps to 1');
  pc.emit(['audioBpm'], paramSnap({ audioBpm: { value: 30 } }));
  assert.equal(pc.writes.at(-1).value, 0, 'under-min clamps to 0');
});

test('bpm=0 (no signal) does NOT write speed', () => {
  const pc = fakePc();
  new BpmSpeedSync(pc).attach();
  pc.emit(['audioBpm'], paramSnap({ audioBpm: { value: 0 } }));
  assert.equal(pc.writes.length, 0);
});

test('sync disabled → no writes even on bpm changes', () => {
  const pc = fakePc();
  new BpmSpeedSync(pc).attach();
  pc.emit(['audioBpm'], paramSnap({ bpmSpeedSync: { value: 0 } }));
  assert.equal(pc.writes.length, 0);
});

test('events that do not touch audioBpm are ignored', () => {
  const pc = fakePc();
  new BpmSpeedSync(pc).attach();
  pc.emit(['speed'], paramSnap());
  pc.emit(['stemsVocals'], paramSnap());
  assert.equal(pc.writes.length, 0);
});

test('min === max maps to fixed 0.5 (div-by-zero guard)', () => {
  const pc = fakePc();
  new BpmSpeedSync(pc).attach();
  pc.emit(['audioBpm'], paramSnap({
    bpmSpeedMin: { value: 120 },
    bpmSpeedMax: { value: 120 },
    audioBpm:    { value: 99  },
  }));
  assert.equal(pc.writes.length, 1);
  assert.equal(pc.writes[0].value, 0.5);
});

test('min > max is swapped at use-time', () => {
  const pc = fakePc();
  new BpmSpeedSync(pc).attach();
  pc.emit(['audioBpm'], paramSnap({
    bpmSpeedMin: { value: 180 },
    bpmSpeedMax: { value: 60  },
    audioBpm:    { value: 120 },
  }));
  assert.equal(pc.writes[0].value, 0.5);
});

test('detach() removes the subscriber; no further writes', () => {
  const pc = fakePc();
  const bs = new BpmSpeedSync(pc);
  bs.attach();
  assert.equal(pc.subscriberCount, 1);
  bs.detach();
  assert.equal(pc.subscriberCount, 0);
  pc.emit(['audioBpm'], paramSnap());
  assert.equal(pc.writes.length, 0);
});

test('attach() is idempotent', () => {
  const pc = fakePc();
  const bs = new BpmSpeedSync(pc);
  bs.attach();
  bs.attach();
  bs.attach();
  assert.equal(pc.subscriberCount, 1);
});

// ── Source-agnostic tempo (arbitrated OSC OR tap) ──────────────────────────

test('with getTempoBpm, speed maps from the ARBITRATED tempo, not audioBpm', () => {
  // The arbitrated tempo (e.g. a tapped 180) drives speed even when the raw
  // audioBpm readout says something else (e.g. 120). This is the whole point
  // of source-agnosticism: SPEED follows the tapped clock.
  let arbitrated = 180;
  const pc = fakePc();
  new BpmSpeedSync(pc, { getTempoBpm: () => arbitrated }).attach();
  pc.emit(['audioBpm'], paramSnap({ audioBpm: { value: 120 } }));
  assert.equal(pc.writes.length, 1);
  assert.equal(pc.writes.at(-1).value, 1, '180 in [60,180] → 1 (uses arbitrated, not audioBpm 120)');
});

test('recompute() follows a tap that moved the tempo with no CPC event', () => {
  // A manual tap writes mixer.tempoBpm directly (no audioBpm event). The
  // engine calls recompute(); speed must update from the arbitrated value.
  let arbitrated = 0; // no tempo yet
  const pc = fakePc();
  const bs = new BpmSpeedSync(pc, { getTempoBpm: () => arbitrated });
  bs.attach();
  pc.setParams(paramSnap()); // bpmSpeedSync on, [60,180]
  bs.recompute();
  assert.equal(pc.writes.length, 0, 'no tempo → no write');
  arbitrated = 120; // operator tapped 120
  bs.recompute();
  assert.equal(pc.writes.length, 1);
  assert.equal(pc.writes.at(-1).value, 0.5);
});

test('recompute() is idempotent — no write when the mapped speed is unchanged', () => {
  let arbitrated = 120;
  const pc = fakePc();
  const bs = new BpmSpeedSync(pc, { getTempoBpm: () => arbitrated });
  bs.attach();
  pc.setParams(paramSnap());
  bs.recompute();
  bs.recompute();
  bs.recompute();
  assert.equal(pc.writes.length, 1, 'only the first recompute writes; the rest are no-ops');
});

test('recompute() does nothing when sync is disabled', () => {
  const pc = fakePc();
  const bs = new BpmSpeedSync(pc, { getTempoBpm: () => 120 });
  bs.attach();
  pc.setParams(paramSnap({ bpmSpeedSync: { value: 0 } }));
  bs.recompute();
  assert.equal(pc.writes.length, 0);
});

// ── Multiplicative speed SCALE (the audio_reactive energy arc, F1 fix) ───────
test('speed scale defaults to 1 (no attenuation) and getSpeedScale reflects it', () => {
  const pc = fakePc();
  const bs = new BpmSpeedSync(pc, { getTempoBpm: () => 120 });
  assert.equal(bs.getSpeedScale(), 1);
  pc.setParams(paramSnap()); // 120 in [60,180] → 0.5 * 1
  bs.attach();
  bs.recompute();
  assert.equal(pc.writes.at(-1).value, 0.5, 'scale 1 leaves the tempo mapping untouched');
});

test('a lower speed scale SAGS the mapped speed (calm → slower)', () => {
  const pc = fakePc();
  const bs = new BpmSpeedSync(pc, { getTempoBpm: () => 120 });
  bs.attach();
  pc.setParams(paramSnap()); // base 0.5
  bs.recompute();
  const full = pc.writes.at(-1).value;
  bs.setSpeedScale(0.4);
  bs.recompute();
  const calm = pc.writes.at(-1).value;
  assert.equal(calm, 0.2, '0.5 * 0.4 = 0.2');
  assert.ok(calm < full, 'a lower scale must lower the mapped speed');
});

test('setSpeedScale rejects out-of-range / non-finite (Codex P0, no silent clamp)', () => {
  const bs = new BpmSpeedSync(fakePc(), { getTempoBpm: () => 120 });
  assert.throws(() => bs.setSpeedScale(-0.1), RangeError);
  assert.throws(() => bs.setSpeedScale(1.5), RangeError);
  assert.throws(() => bs.setSpeedScale(NaN), RangeError);
  assert.throws(() => bs.setSpeedScale('x'), RangeError);
  bs.setSpeedScale(0); bs.setSpeedScale(1); bs.setSpeedScale(0.5); // valid ends OK
  assert.equal(bs.getSpeedScale(), 0.5);
});

test('speed scale is idempotent through recompute() (no churn on a settled scale)', () => {
  const pc = fakePc();
  const bs = new BpmSpeedSync(pc, { getTempoBpm: () => 120 });
  bs.attach();
  pc.setParams(paramSnap());
  bs.setSpeedScale(0.6);
  bs.recompute();
  const n = pc.writes.length;
  bs.recompute(); bs.recompute();
  assert.equal(pc.writes.length, n, 'a settled scale must not re-write speed');
});
