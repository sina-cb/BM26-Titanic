/**
 * tests/scheduled_tasks.test.js
 *
 * Unit coverage for the engine-owned scheduler v3 (docs/31). Each
 * task binds to a library (effectId, presetId, params?). Uses fake
 * timers (injected `nowFn`) + a fake dispatch sink + a fake library
 * so the tests run in milliseconds without touching real time, the
 * controller, or the GEM slot pool.
 *
 * Run:  node --test tests/scheduled_tasks.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';

import yaml from 'js-yaml';

import {
  ScheduledTaskService,
  ScheduledTaskValidationError,
  ON_DURATION_PRESETS_MS,
  INTERVAL_PRESETS_MS,
} from '../lib/scheduled_tasks.js';

// ── helpers ──────────────────────────────────────────────────────────

/**
 * Minimal fake library covering toggle, hold, trigger, and burst
 * behaviors. The scheduler only reads `presets[id].defaultBehavior`
 * and `presets[id].params` — no apply() needed because dispatch is
 * mocked via the `dispatch` sink.
 */
function makeFakeLibrary() {
  return {
    hazer: {
      id: 'hazer',
      behaviorTypes: ['toggle'],
      presets: {
        default: { label: 'Hazer', defaultBehavior: 'toggle', params: { intensity: 0.5 } },
        loud:    { label: 'Hazer Loud', defaultBehavior: 'toggle', params: { intensity: 1.0 } },
      },
    },
    laser: {
      id: 'laser',
      behaviorTypes: ['hold'],
      presets: {
        burst: { label: 'Laser Burst', defaultBehavior: 'hold', params: { width: 0.3 } },
      },
    },
    drop: {
      id: 'drop',
      behaviorTypes: ['trigger'],
      presets: {
        white: { label: 'White Drop', defaultBehavior: 'trigger', params: { intensity: 1.0 } },
      },
    },
    bigBurst: {
      id: 'bigBurst',
      behaviorTypes: ['burst'],
      presets: {
        slam: { label: 'Slam', defaultBehavior: 'burst', params: { hz: 20 } },
      },
    },
    // Singleton-flagged effect for collision-enforcement tests. Two
    // enabled scheduler rows on this effectId must be rejected — the
    // real-rig analog is `strobe` / `fogger` / `colorWash` etc., each
    // of which has only one controller state slot.
    siren: {
      id: 'siren',
      behaviorTypes: ['toggle'],
      singleton: true,
      presets: {
        slow: { label: 'Siren Slow', defaultBehavior: 'toggle', params: { hz: 0.5 } },
        fast: { label: 'Siren Fast', defaultBehavior: 'toggle', params: { hz: 1.5 } },
      },
    },
  };
}

function makeClock(startMs = 1_000_000) {
  const state = { now: startMs };
  return {
    now: () => state.now,
    advance: (deltaMs) => { state.now += deltaMs; return state.now; },
    set: (ms) => { state.now = ms; },
  };
}

function makeTempStateDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `scheduler_${label}_`));
}

function newService({ stateDir, clock, library, idSeq = ['id-1', 'id-2', 'id-3', 'id-4'] } = {}) {
  const broadcasts = [];
  const dispatched = [];
  let i = 0;
  const svc = new ScheduledTaskService({
    stateDir,
    slotManager: null, // v3 doesn't use it for dispatch — library + sink only
    library: library || makeFakeLibrary(),
    broadcast: (msg) => broadcasts.push(msg),
    dispatch: (args) => dispatched.push({ ...args, params: { ...args.params } }),
    nowFn: () => clock.now(),
    randomIdFn: () => idSeq[i++ % idSeq.length],
    tickMs: 250, // doesn't fire — tests drive _tickOnce directly
  });
  return { svc, broadcasts, dispatched };
}

// ── 1. create persists to yaml ───────────────────────────────────────

test('create task writes yaml with effectId/presetId/params (no slotId)', () => {
  const clock = makeClock();
  const stateDir = makeTempStateDir('persist');
  const { svc, broadcasts } = newService({ stateDir, clock });

  const task = svc.create({
    label: 'Hazer',
    effectId: 'hazer',
    presetId: 'default',
    params: { intensity: 0.9 },
    enabled: true,
    mode: 'duration',
    onDurationMs: 10_000,
    intervalMs: 60_000,
  });
  assert.equal(task.label, 'Hazer');
  assert.equal(task.effectId, 'hazer');
  assert.equal(task.presetId, 'default');
  assert.deepEqual(task.params, { intensity: 0.9 });
  assert.equal(task.status, 'armed');
  assert.equal(task.nextFireAtMs, clock.now() + 60_000);

  const onDisk = yaml.load(fs.readFileSync(path.join(stateDir, 'scheduled_tasks.yaml'), 'utf8'));
  assert.equal(onDisk.scheduledTasks.length, 1);
  const row = onDisk.scheduledTasks[0];
  assert.deepEqual(Object.keys(row).sort(),
    ['effectId', 'enabled', 'id', 'intervalMs', 'label', 'mode', 'onDurationMs', 'params', 'presetId']);
  assert.equal(row.id, 'id-1');
  assert.equal(row.effectId, 'hazer');
  assert.equal(row.presetId, 'default');
  assert.deepEqual(row.params, { intensity: 0.9 });
  assert.equal(row.slotId, undefined);
  // Broadcast emitted
  assert.equal(broadcasts.length, 1);
  assert.equal(broadcasts[0].type, 'scheduledTasks');
  assert.equal(broadcasts[0].tasks.length, 1);
});

test('create without label defaults to "<effectId> / <presetId>"', () => {
  const clock = makeClock();
  const { svc } = newService({ stateDir: makeTempStateDir('default-label'), clock });
  const task = svc.create({
    effectId: 'hazer', presetId: 'default', enabled: true, mode: 'duration',
    onDurationMs: 10_000, intervalMs: 60_000,
  });
  assert.equal(task.label, 'hazer / default');
});

test('create without params yields params:null and yaml omits the field', () => {
  const clock = makeClock();
  const stateDir = makeTempStateDir('no-params');
  const { svc } = newService({ stateDir, clock });
  svc.create({
    label: 'x', effectId: 'hazer', presetId: 'default', enabled: true, mode: 'duration',
    onDurationMs: 10_000, intervalMs: 60_000,
  });
  const onDisk = yaml.load(fs.readFileSync(path.join(stateDir, 'scheduled_tasks.yaml'), 'utf8'));
  assert.equal(onDisk.scheduledTasks[0].params, undefined);
});

// ── 2. enabled task fires after intervalMs ───────────────────────────

test('tick fires ON action (activate) after intervalMs for toggle behavior', () => {
  const clock = makeClock();
  const stateDir = makeTempStateDir('fire-toggle');
  const { svc, dispatched } = newService({ stateDir, clock });

  svc.create({
    label: 'Hazer', effectId: 'hazer', presetId: 'default', enabled: true, mode: 'duration',
    onDurationMs: 10_000, intervalMs: 60_000,
  });
  dispatched.length = 0;

  svc._tickOnce(clock.now() + 1_000);
  assert.equal(dispatched.length, 0);

  clock.advance(60_000);
  svc._tickOnce(clock.now());
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].effectId, 'hazer');
  assert.equal(dispatched[0].presetId, 'default');
  assert.equal(dispatched[0].action, 'activate');

  const t = svc.list()[0];
  assert.equal(t.status, 'firing');
  assert.equal(t.firingUntilMs, clock.now() + 10_000);
  assert.equal(t.lastFiredAtMs, clock.now());
});

// ── 3. toggle/hold send OFF after onDurationMs ───────────────────────

test('tick sends OFF (deactivate) after onDurationMs for toggle, re-arms', () => {
  const clock = makeClock();
  const { svc, dispatched } = newService({ stateDir: makeTempStateDir('off'), clock });
  svc.create({
    label: 'Hazer', effectId: 'hazer', presetId: 'default', enabled: true, mode: 'duration',
    onDurationMs: 10_000, intervalMs: 60_000,
  });
  clock.advance(60_000);
  svc._tickOnce(clock.now());
  assert.equal(dispatched.at(-1).action, 'activate');

  clock.advance(5_000);
  svc._tickOnce(clock.now());
  assert.equal(dispatched.length, 1);

  clock.advance(5_000);
  svc._tickOnce(clock.now());
  assert.equal(dispatched.length, 2);
  assert.equal(dispatched.at(-1).action, 'deactivate');

  // Interval is the wait gap between OFF and the next ON — NOT the
  // period from one ON to the next. With duration=10s and interval=60s
  // the schedule is: 60s wait → 10s on → 60s wait → 10s on → ...
  // So nextFireAtMs is now (== lastStoppedAtMs) + intervalMs.
  const stoppedAt = clock.now();
  const t = svc.list()[0];
  assert.equal(t.status, 'armed');
  assert.equal(t.firingUntilMs, null);
  assert.equal(t.lastStoppedAtMs, stoppedAt);
  assert.equal(t.nextFireAtMs, stoppedAt + 60_000);
});

test('hold preset uses down/up rather than activate/deactivate', () => {
  const clock = makeClock();
  const { svc, dispatched } = newService({ stateDir: makeTempStateDir('hold'), clock });
  svc.create({
    label: 'Hold', effectId: 'laser', presetId: 'burst', enabled: true, mode: 'duration',
    onDurationMs: 2_000, intervalMs: 30_000,
  });
  clock.advance(30_000);
  svc._tickOnce(clock.now());
  assert.equal(dispatched.at(-1).action, 'down');

  clock.advance(2_000);
  svc._tickOnce(clock.now());
  assert.equal(dispatched.at(-1).action, 'up');
});

// ── 4. trigger/burst tasks do NOT send OFF ───────────────────────────

test('trigger task fires once (trigger) and sends NO OFF on duration close', () => {
  const clock = makeClock();
  const { svc, dispatched } = newService({ stateDir: makeTempStateDir('trigger'), clock });
  svc.create({
    label: 'Drop', effectId: 'drop', presetId: 'white', enabled: true, mode: 'duration',
    onDurationMs: 2_000, intervalMs: 30_000,
  });
  clock.advance(30_000);
  svc._tickOnce(clock.now());
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched.at(-1).action, 'trigger');

  clock.advance(2_000);
  svc._tickOnce(clock.now());
  // Only ONE dispatch ever — no OFF for trigger.
  assert.equal(dispatched.length, 1, 'trigger must NOT send OFF after onDurationMs');

  const t = svc.list()[0];
  assert.equal(t.status, 'armed');
  assert.equal(t.firingUntilMs, null);
});

test('burst task fires once (trigger) and sends NO OFF on duration close', () => {
  const clock = makeClock();
  const { svc, dispatched } = newService({ stateDir: makeTempStateDir('burst'), clock });
  svc.create({
    label: 'Slam', effectId: 'bigBurst', presetId: 'slam', enabled: true, mode: 'duration',
    onDurationMs: 2_000, intervalMs: 30_000,
  });
  clock.advance(30_000);
  svc._tickOnce(clock.now());
  assert.equal(dispatched.at(-1).action, 'trigger');
  assert.equal(dispatched.length, 1);

  clock.advance(2_000);
  svc._tickOnce(clock.now());
  assert.equal(dispatched.length, 1, 'burst must NOT send OFF after onDurationMs');
});

// ── 5. disabling sends OFF immediately (toggle/hold), no-op for trig ─

test('PATCH enabled:false on firing toggle task sends OFF immediately', () => {
  const clock = makeClock();
  const { svc, dispatched } = newService({ stateDir: makeTempStateDir('disable-toggle'), clock });
  const t = svc.create({
    label: 'Hazer', effectId: 'hazer', presetId: 'default', enabled: true, mode: 'duration',
    onDurationMs: 10_000, intervalMs: 60_000,
  });
  clock.advance(60_000);
  svc._tickOnce(clock.now());
  assert.equal(svc.list()[0].status, 'firing');

  svc.patch(t.id, { enabled: false });
  assert.equal(dispatched.at(-1).action, 'deactivate');
  const after = svc.list()[0];
  assert.equal(after.status, 'disabled');
  assert.equal(after.firingUntilMs, null);
  assert.equal(after.nextFireAtMs, null);
});

test('PATCH enabled:false on firing trigger task does NOT dispatch OFF', () => {
  const clock = makeClock();
  const { svc, dispatched } = newService({ stateDir: makeTempStateDir('disable-trigger'), clock });
  const t = svc.create({
    label: 'Drop', effectId: 'drop', presetId: 'white', enabled: true, mode: 'duration',
    onDurationMs: 10_000, intervalMs: 30_000,
  });
  clock.advance(30_000);
  svc._tickOnce(clock.now());
  assert.equal(dispatched.length, 1);
  assert.equal(svc.list()[0].status, 'firing');

  svc.patch(t.id, { enabled: false });
  assert.equal(dispatched.length, 1, 'no OFF dispatch for trigger behavior on disable');
  const after = svc.list()[0];
  assert.equal(after.status, 'disabled');
  assert.equal(after.firingUntilMs, null);
});

// ── 6. deleting sends OFF immediately (toggle/hold), no-op for trig ──

test('DELETE on firing toggle task sends OFF immediately', () => {
  const clock = makeClock();
  const { svc, dispatched } = newService({ stateDir: makeTempStateDir('del-toggle'), clock });
  const t = svc.create({
    label: 'Hazer', effectId: 'hazer', presetId: 'default', enabled: true, mode: 'duration',
    onDurationMs: 10_000, intervalMs: 60_000,
  });
  clock.advance(60_000);
  svc._tickOnce(clock.now());
  assert.equal(svc.list()[0].status, 'firing');

  svc.delete(t.id);
  assert.equal(dispatched.at(-1).action, 'deactivate');
  assert.equal(svc.list().length, 0);
});

test('DELETE on firing trigger task does NOT dispatch OFF', () => {
  const clock = makeClock();
  const { svc, dispatched } = newService({ stateDir: makeTempStateDir('del-trigger'), clock });
  const t = svc.create({
    label: 'Drop', effectId: 'drop', presetId: 'white', enabled: true, mode: 'duration',
    onDurationMs: 10_000, intervalMs: 30_000,
  });
  clock.advance(30_000);
  svc._tickOnce(clock.now());
  assert.equal(dispatched.length, 1);

  svc.delete(t.id);
  assert.equal(dispatched.length, 1, 'no OFF dispatch for trigger behavior on delete');
  assert.equal(svc.list().length, 0);
});

// ── 7. engine restart does not replay missed fires ───────────────────

test('reload from disk does not replay missed fires (firingUntilMs null)', () => {
  const clock = makeClock();
  const stateDir = makeTempStateDir('restart');
  const { svc: svc1 } = newService({ stateDir, clock });
  svc1.create({
    label: 'Hazer', effectId: 'hazer', presetId: 'default', enabled: true, mode: 'duration',
    onDurationMs: 10_000, intervalMs: 60_000,
  });

  // 5 h of "downtime"
  clock.advance(5 * 3600 * 1000);

  const { svc: svc2, dispatched } = newService({ stateDir, clock });
  svc2.loadFromDisk();

  const t = svc2.list()[0];
  assert.equal(t.status, 'armed');
  assert.equal(t.firingUntilMs, null);
  assert.equal(t.nextFireAtMs, clock.now() + 60_000);

  svc2._tickOnce(clock.now());
  assert.equal(dispatched.length, 0);
});

test('loadFromDisk on missing yaml file yields empty list, creates nothing', () => {
  const clock = makeClock();
  const stateDir = makeTempStateDir('empty');
  const { svc } = newService({ stateDir, clock });
  svc.loadFromDisk();
  assert.equal(svc.list().length, 0);
  assert.equal(fs.existsSync(path.join(stateDir, 'scheduled_tasks.yaml')), false);
});

// ── 8. missing effect/preset at fire time -> status='error' ──────────

test('missing effectId at fire time -> status="error", no dispatch', () => {
  const clock = makeClock();
  // Build a "stale" task in YAML pointing at an effect that's not in
  // the library. loadFromDisk validates at boot, so we have to insert
  // via create() against a library that DOES contain it, then swap
  // the library out from under the service.
  const stateDir = makeTempStateDir('miss-effect');
  const libWith = makeFakeLibrary();
  const clock1 = makeClock();
  const { svc: svc1 } = newService({ stateDir, clock: clock1, library: libWith });
  svc1.create({
    label: 'Ghost', effectId: 'hazer', presetId: 'default', enabled: true, mode: 'duration',
    onDurationMs: 10_000, intervalMs: 60_000,
  });

  // Fresh service over the same dir with a library that LACKS 'hazer'.
  // Need to allow loadFromDisk to succeed though — loadFromDisk validates
  // bindings. So instead we'll mutate the live service's library.
  const { svc, dispatched } = newService({ stateDir, clock, library: libWith });
  svc.loadFromDisk();
  // Now drop the effect after load.
  delete svc.library.hazer;

  clock.advance(60_000);
  svc._tickOnce(clock.now());
  assert.equal(dispatched.length, 0, 'must not dispatch when effect missing');
  const t = svc.list()[0];
  assert.equal(t.status, 'error');
  assert.match(t.lastError, /effect 'hazer' missing/);
  assert.equal(t.nextFireAtMs, clock.now() + 60_000);
});

test('missing presetId at fire time -> status="error", no dispatch', () => {
  const clock = makeClock();
  const stateDir = makeTempStateDir('miss-preset');
  const lib = makeFakeLibrary();
  const { svc: svc1 } = newService({ stateDir, clock: makeClock(), library: lib });
  svc1.create({
    label: 'Ghost', effectId: 'hazer', presetId: 'loud', enabled: true, mode: 'duration',
    onDurationMs: 10_000, intervalMs: 60_000,
  });

  const { svc, dispatched } = newService({ stateDir, clock, library: lib });
  svc.loadFromDisk();
  delete svc.library.hazer.presets.loud;

  clock.advance(60_000);
  svc._tickOnce(clock.now());
  assert.equal(dispatched.length, 0);
  const t = svc.list()[0];
  assert.equal(t.status, 'error');
  assert.match(t.lastError, /preset 'hazer\/loud' missing/);
});

// ── 9. concurrent same-effect instances fire independently ──────────

test('two tasks with same effectId+presetId fire independently', () => {
  const clock = makeClock();
  const stateDir = makeTempStateDir('concurrent');
  const { svc, dispatched } = newService({ stateDir, clock });
  svc.create({
    label: 'A', effectId: 'hazer', presetId: 'default', enabled: true, mode: 'duration',
    onDurationMs: 10_000, intervalMs: 60_000,
  });
  svc.create({
    label: 'B', effectId: 'hazer', presetId: 'default', enabled: true, mode: 'duration',
    onDurationMs: 10_000, intervalMs: 60_000,
  });

  clock.advance(60_000);
  svc._tickOnce(clock.now());
  // Both tasks fire on the same tick → two ON dispatches.
  const ons = dispatched.filter(d => d.action === 'activate');
  assert.equal(ons.length, 2, 'two independent ON dispatches expected');
  assert.equal(ons[0].effectId, 'hazer');
  assert.equal(ons[1].effectId, 'hazer');
});

// ── 10. task.params merged over preset params at dispatch time ──────

test('task.params merge over preset params (task overrides win)', () => {
  const clock = makeClock();
  const { svc, dispatched } = newService({ stateDir: makeTempStateDir('merge'), clock });
  svc.create({
    label: 'Hazer Loud', effectId: 'hazer', presetId: 'default',
    params: { intensity: 0.95, extra: 'tag' },
    enabled: true, mode: 'duration', onDurationMs: 10_000, intervalMs: 60_000,
  });
  clock.advance(60_000);
  svc._tickOnce(clock.now());
  // The dispatch sink receives `params` as the per-task overrides
  // (the slot manager does the actual merge with preset.params). The
  // sink contract documented in scheduled_tasks.js: dispatch receives
  // { effectId, presetId, action, params, behavior, nowMs, frameIndex }.
  // Assert the override map made it through verbatim.
  assert.deepEqual(dispatched.at(-1).params, { intensity: 0.95, extra: 'tag' });
});

test('task without params dispatches with params: {} (preset defaults used downstream)', () => {
  const clock = makeClock();
  const { svc, dispatched } = newService({ stateDir: makeTempStateDir('no-merge'), clock });
  svc.create({
    label: 'Hazer', effectId: 'hazer', presetId: 'default', enabled: true, mode: 'duration',
    onDurationMs: 10_000, intervalMs: 60_000,
  });
  clock.advance(60_000);
  svc._tickOnce(clock.now());
  assert.deepEqual(dispatched.at(-1).params, {});
});

// ── Validation rejections ────────────────────────────────────────────

test('POST without effectId is rejected with 400-equivalent error', () => {
  const { svc } = newService({ stateDir: makeTempStateDir('no-eff'), clock: makeClock() });
  assert.throws(() => svc.create({
    presetId: 'default', enabled: true, mode: 'duration',
    onDurationMs: 10_000, intervalMs: 60_000,
  }), (err) => err instanceof ScheduledTaskValidationError && /effectId/.test(err.message));
});

test('POST without presetId is rejected', () => {
  const { svc } = newService({ stateDir: makeTempStateDir('no-pre'), clock: makeClock() });
  assert.throws(() => svc.create({
    effectId: 'hazer', enabled: true, mode: 'duration',
    onDurationMs: 10_000, intervalMs: 60_000,
  }), (err) => err instanceof ScheduledTaskValidationError && /presetId/.test(err.message));
});

test('POST with unknown effectId rejected with library-binding error', () => {
  const { svc } = newService({ stateDir: makeTempStateDir('unk-eff'), clock: makeClock() });
  assert.throws(() => svc.create({
    effectId: 'nope', presetId: 'default', enabled: true, mode: 'duration',
    onDurationMs: 10_000, intervalMs: 60_000,
  }), (err) => err instanceof ScheduledTaskValidationError && /unknown effectId 'nope'/.test(err.message));
});

test('POST with unknown presetId rejected with library-binding error', () => {
  const { svc } = newService({ stateDir: makeTempStateDir('unk-pre'), clock: makeClock() });
  assert.throws(() => svc.create({
    effectId: 'hazer', presetId: 'nope', enabled: true, mode: 'duration',
    onDurationMs: 10_000, intervalMs: 60_000,
  }), (err) => err instanceof ScheduledTaskValidationError && /unknown presetId 'nope'/.test(err.message));
});

test('PATCH of effectId without presetId rejected', () => {
  const clock = makeClock();
  const { svc } = newService({ stateDir: makeTempStateDir('patch-eff-only'), clock });
  const t = svc.create({
    label: 'x', effectId: 'hazer', presetId: 'default', enabled: true, mode: 'duration',
    onDurationMs: 10_000, intervalMs: 60_000,
  });
  assert.throws(() => svc.patch(t.id, { effectId: 'laser' }),
    (err) => err instanceof ScheduledTaskValidationError && /effectId and presetId must be patched together/.test(err.message));
});

test('PATCH of presetId without effectId rejected', () => {
  const clock = makeClock();
  const { svc } = newService({ stateDir: makeTempStateDir('patch-pre-only'), clock });
  const t = svc.create({
    label: 'x', effectId: 'hazer', presetId: 'default', enabled: true, mode: 'duration',
    onDurationMs: 10_000, intervalMs: 60_000,
  });
  assert.throws(() => svc.patch(t.id, { presetId: 'loud' }),
    (err) => err instanceof ScheduledTaskValidationError && /effectId and presetId must be patched together/.test(err.message));
});

test('PATCH of both effectId and presetId together succeeds', () => {
  const clock = makeClock();
  const { svc } = newService({ stateDir: makeTempStateDir('patch-pair'), clock });
  const t = svc.create({
    label: 'x', effectId: 'hazer', presetId: 'default', enabled: true, mode: 'duration',
    onDurationMs: 10_000, intervalMs: 60_000,
  });
  const r = svc.patch(t.id, { effectId: 'laser', presetId: 'burst' });
  assert.equal(r.effectId, 'laser');
  assert.equal(r.presetId, 'burst');
});

test('PATCH params updates per-task overrides', () => {
  const clock = makeClock();
  const { svc } = newService({ stateDir: makeTempStateDir('patch-params'), clock });
  const t = svc.create({
    label: 'x', effectId: 'hazer', presetId: 'default', enabled: true, mode: 'duration',
    onDurationMs: 10_000, intervalMs: 60_000,
  });
  const r = svc.patch(t.id, { params: { intensity: 0.42 } });
  assert.deepEqual(r.params, { intensity: 0.42 });
});

test('off-preset onDurationMs is rejected (no clamping)', () => {
  const { svc } = newService({ stateDir: makeTempStateDir('off1'), clock: makeClock() });
  assert.throws(() => svc.create({
    label: 'x', effectId: 'hazer', presetId: 'default', enabled: true, mode: 'duration',
    onDurationMs: 9_999, intervalMs: 60_000,
  }), (err) => err instanceof ScheduledTaskValidationError && /onDurationMs must be one of/.test(err.message));
});

test('off-preset intervalMs is rejected (no clamping)', () => {
  const { svc } = newService({ stateDir: makeTempStateDir('off2'), clock: makeClock() });
  assert.throws(() => svc.create({
    label: 'x', effectId: 'hazer', presetId: 'default', enabled: true, mode: 'duration',
    onDurationMs: 10_000, intervalMs: 45_000,
  }), (err) => err instanceof ScheduledTaskValidationError && /intervalMs must be one of/.test(err.message));
});

test('mode !== "duration" is rejected', () => {
  const { svc } = newService({ stateDir: makeTempStateDir('mode'), clock: makeClock() });
  assert.throws(() => svc.create({
    label: 'x', effectId: 'hazer', presetId: 'default', enabled: true, mode: 'trigger',
    onDurationMs: 10_000, intervalMs: 60_000,
  }), (err) => err instanceof ScheduledTaskValidationError && /mode must be 'duration'/.test(err.message));
});

test('PATCH rejects unknown / runtime fields', () => {
  const clock = makeClock();
  const { svc } = newService({ stateDir: makeTempStateDir('patch-runtime'), clock });
  const t = svc.create({
    label: 'x', effectId: 'hazer', presetId: 'default', enabled: true, mode: 'duration',
    onDurationMs: 10_000, intervalMs: 60_000,
  });
  assert.throws(() => svc.patch(t.id, { firingUntilMs: 0 }),
    (err) => err instanceof ScheduledTaskValidationError && /not patchable/.test(err.message));
  assert.throws(() => svc.patch(t.id, { id: 'x' }),
    (err) => err instanceof ScheduledTaskValidationError && /not patchable/.test(err.message));
  assert.throws(() => svc.patch(t.id, { mode: 'duration' }),
    (err) => err instanceof ScheduledTaskValidationError && /not patchable/.test(err.message));
});

test('params shape: non-object rejected', () => {
  const { svc } = newService({ stateDir: makeTempStateDir('p-shape'), clock: makeClock() });
  assert.throws(() => svc.create({
    label: 'x', effectId: 'hazer', presetId: 'default',
    params: [1, 2, 3],
    enabled: true, mode: 'duration', onDurationMs: 10_000, intervalMs: 60_000,
  }), (err) => err instanceof ScheduledTaskValidationError && /params must be an object/.test(err.message));
});

test('params shape: nested object value rejected', () => {
  const { svc } = newService({ stateDir: makeTempStateDir('p-nested'), clock: makeClock() });
  assert.throws(() => svc.create({
    label: 'x', effectId: 'hazer', presetId: 'default',
    params: { color: { r: 1, g: 0 } },
    enabled: true, mode: 'duration', onDurationMs: 10_000, intervalMs: 60_000,
  }), (err) => err instanceof ScheduledTaskValidationError && /params\.color/.test(err.message));
});

// ── fire-now / stop ──────────────────────────────────────────────────

test('fire-now opens an ON window immediately and rebases the schedule', () => {
  const clock = makeClock();
  const { svc, dispatched } = newService({ stateDir: makeTempStateDir('firenow'), clock });
  const t = svc.create({
    label: 'Hazer', effectId: 'hazer', presetId: 'default', enabled: true, mode: 'duration',
    onDurationMs: 10_000, intervalMs: 60_000,
  });
  clock.advance(5_000);
  const r = svc.fireNow(t.id);
  assert.equal(dispatched.at(-1).action, 'activate');
  assert.equal(r.status, 'firing');
  assert.equal(r.firingUntilMs, clock.now() + 10_000);
  clock.advance(10_000);
  svc._tickOnce(clock.now());
  const after = svc.list()[0];
  assert.equal(after.status, 'armed');
  // After the duration closes, the next fire is one full interval gap
  // away from the OFF time (lastStoppedAtMs), not from lastFiredAtMs.
  assert.equal(after.nextFireAtMs, after.lastStoppedAtMs + 60_000);
});

test('stop force-closes the ON window without disabling', () => {
  const clock = makeClock();
  const { svc, dispatched } = newService({ stateDir: makeTempStateDir('stop'), clock });
  const t = svc.create({
    label: 'Hazer', effectId: 'hazer', presetId: 'default', enabled: true, mode: 'duration',
    onDurationMs: 10_000, intervalMs: 60_000,
  });
  clock.advance(60_000);
  svc._tickOnce(clock.now());
  clock.advance(2_000);
  const r = svc.stop(t.id);
  assert.equal(dispatched.at(-1).action, 'deactivate');
  assert.equal(r.firingUntilMs, null);
  assert.equal(r.enabled, true);
  assert.equal(r.status, 'armed');
});

test('stop on a non-firing task is idempotent', () => {
  const clock = makeClock();
  const { svc, dispatched } = newService({ stateDir: makeTempStateDir('stop-idle'), clock });
  const t = svc.create({
    label: 'Hazer', effectId: 'hazer', presetId: 'default', enabled: true, mode: 'duration',
    onDurationMs: 10_000, intervalMs: 60_000,
  });
  const r = svc.stop(t.id);
  assert.equal(dispatched.length, 0);
  assert.equal(r.status, 'armed');
});

// ── preset constants sanity ─────────────────────────────────────────

test('preset constants match docs/31 v3 design', () => {
  assert.deepEqual([...ON_DURATION_PRESETS_MS],
    [1_000, 2_000, 5_000, 10_000, 15_000, 30_000, 60_000, 120_000, 180_000, 240_000, 300_000, 600_000]);
  assert.deepEqual([...INTERVAL_PRESETS_MS],
    [5_000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000, 900_000, 1_800_000, 3_600_000]);
});

// ── reload validates persisted rows (codex P0) ───────────────────────

test('loadFromDisk throws on hand-edited off-preset value', () => {
  const clock = makeClock();
  const stateDir = makeTempStateDir('handedit');
  fs.writeFileSync(path.join(stateDir, 'scheduled_tasks.yaml'), yaml.dump({
    scheduledTasks: [{
      id: 'x', label: 'Hand', effectId: 'hazer', presetId: 'default',
      enabled: true, mode: 'duration',
      onDurationMs: 13_337, intervalMs: 60_000,
    }],
  }));
  const { svc } = newService({ stateDir, clock });
  assert.throws(() => svc.loadFromDisk(), /onDurationMs must be one of/);
});

// ── 11. legacy v2 yaml with slotId-bound rows is dropped with a warn ─

test('loadFromDisk drops legacy slotId-bound rows with a one-shot warning', () => {
  const clock = makeClock();
  const stateDir = makeTempStateDir('legacy-v2');
  fs.writeFileSync(path.join(stateDir, 'scheduled_tasks.yaml'), yaml.dump({
    scheduledTasks: [
      // Pure legacy v2 row: slotId, no effectId/presetId.
      { id: 'legacy-1', label: 'Legacy Hazer', slotId: 10, enabled: true,
        mode: 'duration', onDurationMs: 10_000, intervalMs: 60_000 },
      // Valid v3 row alongside.
      { id: 'v3-1', label: 'V3 Hazer', effectId: 'hazer', presetId: 'default',
        enabled: true, mode: 'duration', onDurationMs: 10_000, intervalMs: 60_000 },
    ],
  }));

  // Capture console.warn.
  const warns = [];
  const origWarn = console.warn;
  console.warn = (...args) => warns.push(args.join(' '));
  try {
    const { svc } = newService({ stateDir, clock });
    svc.loadFromDisk();
    assert.equal(svc.list().length, 1, 'only the v3 row survives');
    assert.equal(svc.list()[0].id, 'v3-1');
  } finally {
    console.warn = origWarn;
  }
  assert.equal(warns.length, 1, 'one warning per dropped legacy row');
  assert.match(warns[0], /dropping legacy slotId-bound row/);
  assert.match(warns[0], /"legacy-1"/);
});

// ── singleton enforcement (controller has only one slot per effect) ──

test('create rejects 2nd enabled task on singleton effect (same preset)', () => {
  const clock = makeClock();
  const stateDir = makeTempStateDir('singleton-create-same');
  const { svc } = newService({ stateDir, clock });
  svc.create({
    effectId: 'siren', presetId: 'slow', enabled: true, mode: 'duration',
    onDurationMs: 5_000, intervalMs: 30_000,
  });
  assert.throws(
    () => svc.create({
      effectId: 'siren', presetId: 'slow', enabled: true, mode: 'duration',
      onDurationMs: 5_000, intervalMs: 30_000,
    }),
    /singleton.*already scheduled/i,
  );
  assert.equal(svc.list().length, 1);
});

test('create rejects 2nd enabled task on singleton effect (different preset)', () => {
  const clock = makeClock();
  const stateDir = makeTempStateDir('singleton-create-diff');
  const { svc } = newService({ stateDir, clock });
  svc.create({
    effectId: 'siren', presetId: 'slow', enabled: true, mode: 'duration',
    onDurationMs: 5_000, intervalMs: 30_000,
  });
  assert.throws(
    () => svc.create({
      effectId: 'siren', presetId: 'fast', enabled: true, mode: 'duration',
      onDurationMs: 5_000, intervalMs: 30_000,
    }),
    /singleton.*already scheduled/i,
  );
});

test('create allows 2nd singleton task if it is disabled', () => {
  const clock = makeClock();
  const stateDir = makeTempStateDir('singleton-create-disabled');
  const { svc } = newService({ stateDir, clock });
  svc.create({
    effectId: 'siren', presetId: 'slow', enabled: true, mode: 'duration',
    onDurationMs: 5_000, intervalMs: 30_000,
  });
  const second = svc.create({
    effectId: 'siren', presetId: 'fast', enabled: false, mode: 'duration',
    onDurationMs: 5_000, intervalMs: 30_000,
  });
  assert.equal(svc.list().length, 2);
  assert.equal(second.enabled, false);
});

test('PATCH rejects enabling a row that would collide with existing singleton task', () => {
  const clock = makeClock();
  const stateDir = makeTempStateDir('singleton-patch-enable');
  const { svc } = newService({ stateDir, clock });
  svc.create({
    effectId: 'siren', presetId: 'slow', enabled: true, mode: 'duration',
    onDurationMs: 5_000, intervalMs: 30_000,
  });
  const disabled = svc.create({
    effectId: 'siren', presetId: 'fast', enabled: false, mode: 'duration',
    onDurationMs: 5_000, intervalMs: 30_000,
  });
  assert.throws(
    () => svc.patch(disabled.id, { enabled: true }),
    /singleton.*already scheduled/i,
  );
  assert.equal(svc.get(disabled.id).enabled, false, 'disabled row stays disabled after rejection');
});

test('PATCH allows toggling self enabled→disabled→enabled (no self-collision)', () => {
  const clock = makeClock();
  const stateDir = makeTempStateDir('singleton-self');
  const { svc } = newService({ stateDir, clock });
  const t = svc.create({
    effectId: 'siren', presetId: 'slow', enabled: true, mode: 'duration',
    onDurationMs: 5_000, intervalMs: 30_000,
  });
  svc.patch(t.id, { enabled: false });
  // The row was the conflict against itself — disabling then re-enabling
  // must NOT trip the singleton check against the same task.
  const result = svc.patch(t.id, { enabled: true });
  assert.equal(result.enabled, true);
});

test('PATCH rejects effectId swap that lands on an already-scheduled singleton', () => {
  const clock = makeClock();
  const stateDir = makeTempStateDir('singleton-patch-swap');
  const { svc } = newService({ stateDir, clock });
  svc.create({
    effectId: 'siren', presetId: 'slow', enabled: true, mode: 'duration',
    onDurationMs: 5_000, intervalMs: 30_000,
  });
  const other = svc.create({
    effectId: 'hazer', presetId: 'default', enabled: true, mode: 'duration',
    onDurationMs: 5_000, intervalMs: 30_000,
  });
  assert.throws(
    () => svc.patch(other.id, { effectId: 'siren', presetId: 'fast' }),
    /singleton.*already scheduled/i,
  );
});

// ── interval gap semantics: wait-then-fire, independent of duration ──

test('interval is the GAP between OFF and next ON (not period from ON to ON)', () => {
  // Operator request 2026-05-28: with duration=5s + interval=5s the
  // schedule must be 5s wait → 5s on → 5s wait → 5s on → ...
  // Pre-fix it was 5s wait → 3s on → 2s wait → 3s on → ... (interval
  // measured start-to-start, eaten by the duration).
  const clock = makeClock();
  const { svc, dispatched } = newService({ stateDir: makeTempStateDir('gap-sem'), clock });
  svc.create({
    label: 'Hazer', effectId: 'hazer', presetId: 'default', enabled: true, mode: 'duration',
    onDurationMs: 5_000, intervalMs: 5_000,
  });

  // First fire after one full interval of wait.
  clock.advance(5_000);
  svc._tickOnce(clock.now());
  assert.equal(dispatched.length, 1, 'ON #1');
  assert.equal(dispatched.at(-1).action, 'activate');

  // Halfway through the ON window — no new dispatch.
  clock.advance(2_500);
  svc._tickOnce(clock.now());
  assert.equal(dispatched.length, 1, 'still inside ON #1');

  // End of ON #1: OFF fires.
  clock.advance(2_500);
  svc._tickOnce(clock.now());
  assert.equal(dispatched.length, 2);
  assert.equal(dispatched.at(-1).action, 'deactivate');
  const t1 = svc.list()[0];
  assert.equal(t1.nextFireAtMs, clock.now() + 5_000,
    'nextFireAtMs = lastStoppedAtMs + intervalMs (5s wait, not 0)');

  // 2.5 s into the GAP — no ON yet.
  clock.advance(2_500);
  svc._tickOnce(clock.now());
  assert.equal(dispatched.length, 2, 'still inside the OFF gap, not firing again');

  // End of the 5 s wait gap: ON #2 fires.
  clock.advance(2_500);
  svc._tickOnce(clock.now());
  assert.equal(dispatched.length, 3, 'ON #2 fires after a FULL interval gap');
  assert.equal(dispatched.at(-1).action, 'activate');
});

test('stop() reschedules next fire = lastStoppedAtMs + intervalMs', () => {
  const clock = makeClock();
  const { svc, dispatched } = newService({ stateDir: makeTempStateDir('stop-gap'), clock });
  const created = svc.create({
    label: 'Hazer', effectId: 'hazer', presetId: 'default', enabled: true, mode: 'duration',
    onDurationMs: 10_000, intervalMs: 30_000,
  });
  // Fire it via fire-now to avoid waiting one interval.
  svc.fireNow(created.id);
  assert.equal(dispatched.length, 1);
  // Operator hits STOP 3 s into the 10 s ON window.
  clock.advance(3_000);
  const stoppedAt = clock.now();
  svc.stop(created.id);
  const t = svc.list()[0];
  assert.equal(t.firingUntilMs, null);
  assert.equal(t.lastStoppedAtMs, stoppedAt);
  assert.equal(t.nextFireAtMs, stoppedAt + 30_000,
    'stop() recomputes nextFireAtMs from lastStoppedAtMs, not lastFiredAtMs');
});

test('loadFromDisk force-disables 2nd singleton row when YAML has conflicts', () => {
  const clock = makeClock();
  const stateDir = makeTempStateDir('singleton-load');
  fs.writeFileSync(path.join(stateDir, 'scheduled_tasks.yaml'), yaml.dump({
    scheduledTasks: [
      { id: 'a', label: 'A', effectId: 'siren', presetId: 'slow', enabled: true,
        mode: 'duration', onDurationMs: 5_000, intervalMs: 30_000 },
      { id: 'b', label: 'B', effectId: 'siren', presetId: 'fast', enabled: true,
        mode: 'duration', onDurationMs: 5_000, intervalMs: 30_000 },
    ],
  }));
  const warns = [];
  const origWarn = console.warn;
  console.warn = (...args) => warns.push(args.join(' '));
  try {
    const { svc } = newService({ stateDir, clock });
    svc.loadFromDisk();
    const tasks = svc.list();
    assert.equal(tasks.length, 2, 'both tasks survive load');
    const a = tasks.find(t => t.id === 'a');
    const b = tasks.find(t => t.id === 'b');
    assert.equal(a.enabled, true, 'first singleton row stays enabled');
    assert.equal(b.enabled, false, 'second singleton row force-disabled');
    assert.equal(b.status, 'disabled');
  } finally {
    console.warn = origWarn;
  }
  assert.ok(warns.some(w => /singleton collision/.test(w)), 'warns about singleton collision');
});
