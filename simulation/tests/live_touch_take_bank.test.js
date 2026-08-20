import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const TakeState = require('../../CaptainPad/live_touch/touch_control_take_state.js');
const TakeBank = require('../../CaptainPad/live_touch/touch_control_take_bank.js');

class FakeClock {
  constructor() {
    this.time = 0;
    this.nextId = 1;
    this.jobs = [];
  }

  now = () => this.time;

  schedule = (fn, delay) => {
    const job = { id: this.nextId++, at: this.time + delay, fn, cancelled: false };
    this.jobs.push(job);
    return job.id;
  };

  cancel = (id) => {
    const job = this.jobs.find((candidate) => candidate.id === id);
    if (job) job.cancelled = true;
  };

  async flush() {
    for (let index = 0; index < 8; index++) await Promise.resolve();
  }

  async tick(milliseconds) {
    const target = this.time + milliseconds;
    while (true) {
      await this.flush();
      const next = this.jobs
        .filter((job) => !job.cancelled && job.at <= target)
        .sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!next) break;
      next.cancelled = true;
      this.time = next.at;
      next.fn();
    }
    this.time = target;
    await this.flush();
    while (true) {
      const next = this.jobs
        .filter((job) => !job.cancelled && job.at <= this.time)
        .sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!next) break;
      next.cancelled = true;
      next.fn();
      await this.flush();
    }
  }
}

function bankHarness(overrides = {}) {
  const clock = new FakeClock();
  const output = [];
  const states = [];
  const errors = [];
  let eligible = overrides.eligible ?? true;
  const bank = TakeBank.create({
    now: clock.now.bind(clock),
    schedule: clock.schedule.bind(clock),
    cancel: clock.cancel.bind(clock),
    buildEmitSample: (contactKey) => (sample, meta) => {
      output.push({
        at: clock.now(),
        contactKey,
        sample: { ...sample },
        meta: { ...meta },
      });
      return Promise.resolve({ status: 'ok' });
    },
    eligibility: () => (eligible ? { ok: true } : { ok: false, reason: 'ARM and lease are not confirmed' }),
    onState: (state) => states.push(JSON.parse(JSON.stringify(state))),
    onError: (error) => errors.push(error.message),
  });
  return {
    clock, output, states, errors, bank,
    setEligible(value) { eligible = value; },
  };
}

test('create bootstraps four slots before the first onState publish', () => {
  let publishCount = 0;
  const bank = TakeBank.create({
    buildEmitSample: () => () => Promise.resolve({ status: 'ok' }),
    onState: (state) => {
      publishCount += 1;
      assert.equal(state.slots.length, 4, 'onState must never run with a partial slot list');
      assert.ok(state.slots[state.selectedIndex], 'selected slot must exist on every publish');
    },
  });
  assert.equal(publishCount, 1, 'exactly one publish after all slots exist');
  assert.equal(bank.state().slots.length, 4);
});

test('take bank exposes four isolated slots with deterministic contact keys', () => {
  assert.deepEqual([0, 1, 2, 3].map(TakeBank.contactKeyFor), [
    'take-playback-0', 'take-playback-1', 'take-playback-2', 'take-playback-3',
  ]);
  const run = bankHarness();
  assert.equal(run.bank.state().slots.length, 4);
  run.bank.replaceTake(1, [[0, 0.2, 0.3, 1], [50, 0.4, 0.5, 0]]);
  assert.equal(run.bank.exportTake(1).length, 2);
  assert.deepEqual(run.bank.exportTake(0), []);
});

test('concurrent playback on two slots keeps separate contact keys and buffers', async () => {
  const run = bankHarness();
  run.bank.replaceTake(0, [[0, 0.1, 0.2, 1], [40, 0.2, 0.3, 0]]);
  run.bank.replaceTake(1, [[0, 0.7, 0.8, 1], [60, 0.8, 0.9, 0]]);
  run.bank.select(0);
  const first = run.bank.play(false);
  run.bank.select(1);
  const second = run.bank.play(false);
  await Promise.all([first, second]);
  await run.clock.tick(0);
  assert.deepEqual(
    run.output.filter(({ at }) => at === 0).map(({ contactKey, sample }) => [contactKey, sample.down]),
    [['take-playback-0', true], ['take-playback-1', true]],
  );
  await run.clock.tick(60);
  assert.deepEqual(
    run.output.map(({ contactKey, sample }) => [contactKey, sample.down]),
    [
      ['take-playback-0', true], ['take-playback-1', true],
      ['take-playback-0', false], ['take-playback-1', false],
    ],
  );
  assert.equal(run.bank.state().playingCount, 0);
});

test('recording is exclusive to one slot and refuses slot switches mid-rec', async () => {
  const run = bankHarness();
  await run.bank.startRecording();
  assert.throws(() => run.bank.select(1), /cannot switch slots while slot 1 is recording/);
  run.clock.time = 120;
  assert.equal(run.bank.recordPoint(0.2, 0.3, true), true);
  assert.equal(run.bank.stopRecording(), true);
  run.bank.select(2);
  assert.equal(run.bank.selectedIndex(), 2);
});

test('cleanup stops every active slot without mutating unrelated buffers', async () => {
  const run = bankHarness();
  run.bank.replaceTake(0, [[0, 0.1, 0.2, 1], [30, 0.2, 0.3, 0]]);
  run.bank.replaceTake(2, [[0, 0.5, 0.6, 1], [20, 0.6, 0.7, 0]]);
  run.bank.select(0);
  const first = run.bank.play(true);
  run.bank.select(2);
  const second = run.bank.play(true);
  await Promise.all([first, second]);
  await run.clock.tick(0);
  await run.bank.cleanup('lease-loss');
  await run.clock.tick(1000);
  assert.equal(run.output.filter(({ sample }) => sample.down).length, 2);
  assert.equal(run.output.filter(({ sample }) => !sample.down).length, 2);
  assert.equal(run.bank.exportTake(0).length, 2);
  assert.equal(run.bank.exportTake(2).length, 2);
  assert.equal(run.bank.state().playingCount, 0);
});

test('rapid play-stop-play on one slot cancels stale generations', async () => {
  const run = bankHarness();
  run.bank.replaceTake(0, [[0, 0.1, 0.2, 1], [100, 0.2, 0.3, 1], [200, 0.3, 0.4, 0]]);
  await run.bank.play(false);
  await run.clock.tick(0);
  await run.bank.stop('rapid-toggle');
  await run.clock.flush();
  const countAfterStop = run.output.length;
  await run.clock.tick(1000);
  assert.equal(run.output.length, countAfterStop, 'stopped generation emits no stale timer sample');
  await run.bank.play(false);
  await run.clock.tick(0);
  await run.clock.tick(200);
  assert.equal(run.bank.state().slots[0].phase, 'ready');
  assert.ok(run.output.length > countAfterStop, 'a fresh play generation emits a new first frame');
});

test('replaceAll restores every slot after an ordered cleanup', async () => {
  const run = bankHarness();
  run.bank.replaceTake(0, [[0, 0.1, 0.2, 1], [40, 0.2, 0.3, 0]]);
  await run.bank.play(true);
  await run.clock.tick(0);
  await run.bank.replaceAll([
    [[0, 0.9, 0.1, 1], [25, 0.8, 0.2, 0]],
    [],
    [[0, 0.3, 0.3, 1], [10, 0.4, 0.4, 0]],
    [],
  ]);
  assert.equal(run.bank.exportTake(0).length, 2);
  assert.deepEqual(run.bank.exportTake(1), []);
  assert.equal(run.bank.exportTake(2).length, 2);
  assert.equal(run.bank.state().playingCount, 0);
});

test('four concurrent loops mix with isolated contact keys', async () => {
  const run = bankHarness();
  const samples = [
    [[0, 0.1, 0.1, 1], [20, 0.2, 0.2, 0]],
    [[0, 0.3, 0.3, 1], [25, 0.4, 0.4, 0]],
    [[0, 0.5, 0.5, 1], [30, 0.6, 0.6, 0]],
    [[0, 0.7, 0.7, 1], [35, 0.8, 0.8, 0]],
  ];
  samples.forEach((take, index) => run.bank.replaceTake(index, take));
  const starts = [];
  for (let index = 0; index < 4; index++) {
    run.bank.select(index);
    starts.push(run.bank.play(true));
  }
  await Promise.all(starts);
  await run.clock.tick(0);
  assert.equal(run.bank.state().playingCount, 4);
  assert.deepEqual(
    new Set(run.output.filter(({ at }) => at === 0).map(({ contactKey }) => contactKey)),
    new Set(['take-playback-0', 'take-playback-1', 'take-playback-2', 'take-playback-3']),
  );
});

test('stop on one looping slot leaves the other slots running', async () => {
  const run = bankHarness();
  run.bank.replaceTake(0, [[0, 0.1, 0.2, 1], [40, 0.2, 0.3, 0]]);
  run.bank.replaceTake(1, [[0, 0.7, 0.8, 1], [50, 0.8, 0.9, 0]]);
  run.bank.select(0);
  await run.bank.play(true);
  run.bank.select(1);
  await run.bank.play(true);
  await run.clock.tick(0);
  assert.equal(run.bank.state().playingCount, 2);
  run.bank.select(0);
  await run.bank.stop('operator-stop');
  await run.clock.tick(0);
  assert.equal(run.bank.state().slots[0].phase, 'ready');
  assert.equal(run.bank.state().slots[1].phase, 'looping');
  assert.equal(run.bank.state().playingCount, 1);
});

test('clear on one slot does not mutate another slot buffer', async () => {
  const run = bankHarness();
  run.bank.replaceTake(0, [[0, 0.1, 0.2, 1], [40, 0.2, 0.3, 0]]);
  run.bank.replaceTake(1, [[0, 0.7, 0.8, 1], [50, 0.8, 0.9, 0]]);
  run.bank.select(0);
  await run.bank.clear();
  await run.clock.tick(0);
  assert.deepEqual(run.bank.exportTake(0), []);
  assert.equal(run.bank.exportTake(1).length, 2);
  assert.equal(run.bank.state().slots[1].phase, 'ready');
});
