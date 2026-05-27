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
    /** Drive an event with whatever param values the test wants. */
    emit(changedKeys, params) {
      const ev = { changedKeys, state: { params } };
      for (const fn of [...subscribers]) fn(ev);
    },
    get writes() { return writes; },
    get subscriberCount() { return subscribers.length; },
  };
}

function paramSnap(overrides = {}) {
  return {
    tempoBpm:     { value: 120, ...(overrides.tempoBpm     || {}) },
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
  pc.emit(['tempoBpm'], paramSnap({ tempoBpm: { value: 120 } }));
  assert.equal(pc.writes.length, 1);
  assert.equal(pc.writes[0].key, 'speed');
  assert.equal(pc.writes[0].value, 0.5);
  assert.equal(pc.writes[0].source, 'bpm-sync');
});

test('bpm at min/max edges hit 0 and 1; out-of-range clamps', () => {
  const pc = fakePc();
  new BpmSpeedSync(pc).attach();
  pc.emit(['tempoBpm'], paramSnap({ tempoBpm: { value: 60 } }));
  assert.equal(pc.writes.at(-1).value, 0);
  pc.emit(['tempoBpm'], paramSnap({ tempoBpm: { value: 180 } }));
  assert.equal(pc.writes.at(-1).value, 1);
  pc.emit(['tempoBpm'], paramSnap({ tempoBpm: { value: 240 } }));
  assert.equal(pc.writes.at(-1).value, 1, 'over-max clamps to 1');
  pc.emit(['tempoBpm'], paramSnap({ tempoBpm: { value: 30 } }));
  assert.equal(pc.writes.at(-1).value, 0, 'under-min clamps to 0');
});

test('bpm=0 (no signal) does NOT write speed', () => {
  const pc = fakePc();
  new BpmSpeedSync(pc).attach();
  pc.emit(['tempoBpm'], paramSnap({ tempoBpm: { value: 0 } }));
  assert.equal(pc.writes.length, 0);
});

test('sync disabled → no writes even on bpm changes', () => {
  const pc = fakePc();
  new BpmSpeedSync(pc).attach();
  pc.emit(['tempoBpm'], paramSnap({ bpmSpeedSync: { value: 0 } }));
  assert.equal(pc.writes.length, 0);
});

test('events that do not touch tempoBpm are ignored', () => {
  const pc = fakePc();
  new BpmSpeedSync(pc).attach();
  pc.emit(['speed'], paramSnap());
  pc.emit(['stemsVocals'], paramSnap());
  assert.equal(pc.writes.length, 0);
});

test('min === max maps to fixed 0.5 (div-by-zero guard)', () => {
  const pc = fakePc();
  new BpmSpeedSync(pc).attach();
  pc.emit(['tempoBpm'], paramSnap({
    bpmSpeedMin: { value: 120 },
    bpmSpeedMax: { value: 120 },
    tempoBpm:    { value: 99  },
  }));
  assert.equal(pc.writes.length, 1);
  assert.equal(pc.writes[0].value, 0.5);
});

test('min > max is swapped at use-time', () => {
  const pc = fakePc();
  new BpmSpeedSync(pc).attach();
  pc.emit(['tempoBpm'], paramSnap({
    bpmSpeedMin: { value: 180 },
    bpmSpeedMax: { value: 60  },
    tempoBpm:    { value: 120 },
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
  pc.emit(['tempoBpm'], paramSnap());
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
