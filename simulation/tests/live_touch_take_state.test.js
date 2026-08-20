import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const TakeState = require('../../CaptainPad/live_touch/touch_control_take_state.js');

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

function harness(overrides = {}) {
  const clock = new FakeClock();
  const output = [];
  const states = [];
  const errors = [];
  let eligible = overrides.eligible ?? true;
  const machine = TakeState.create({
    now: clock.now,
    schedule: clock.schedule,
    cancel: clock.cancel,
    eligibility: () => (eligible ? { ok: true } : { ok: false, reason: 'ARM and lease are not confirmed' }),
    emitSample: overrides.emitSample || ((sample, meta) => {
      output.push({ at: clock.now(), sample: { ...sample }, meta: { ...meta } });
      return Promise.resolve({ status: 'ok' });
    }),
    onState: (state) => states.push({ ...state }),
    onError: (error) => errors.push(error.message),
  });
  return {
    clock, output, states, errors, machine,
    setEligible(value) { eligible = value; },
  };
}

test('strict TAKE validation is whole-buffer, monotonic, bounded and terminal-up', () => {
  const valid = TakeState.validateTake([
    [120, 0.2, 0.3, 1],
    [220, 0.4, 0.5, 0],
  ]);
  assert.deepEqual(valid, [
    { t: 0, u: 0.2, v: 0.3, down: true },
    { t: 100, u: 0.4, v: 0.5, down: false },
  ]);
  assert.throws(() => TakeState.validateTake([[10, 0.2, 0.3, 1]]), /explicit contact-up/);
  assert.throws(() => TakeState.validateTake([[10, 0.2, 0.3, 0], [9, 0.2, 0.3, 0]]), /non-monotonic/);
  assert.throws(() => TakeState.validateTake([[0, 1.2, 0.3, 0]]), /outside 0\.\.1/);
});

test('REC owns one buffer, first-contact time zero, explicit stop, and loud point cap', async () => {
  const run = harness();
  await run.machine.startRecording();
  run.clock.time = 500;
  assert.equal(run.machine.recordPoint(0.1, 0.2, true), true);
  run.clock.time = 650;
  assert.equal(run.machine.recordPoint(0.3, 0.4, true), true);
  assert.equal(run.machine.stopRecording(), true);
  assert.deepEqual(run.machine.exportTake(), [
    [0, 0.1, 0.2, 1],
    [150, 0.3, 0.4, 1],
    [150, 0.3, 0.4, 0],
  ]);
  assert.equal(run.machine.state().phase, 'ready');

  await run.machine.startRecording();
  for (let index = 0; index < TakeState.maxPoints; index++) {
    run.clock.time += 1;
    assert.equal(run.machine.recordPoint(0.5, 0.5, true), true);
  }
  assert.equal(run.machine.recordPoint(0.5, 0.5, true), false);
  assert.equal(run.machine.exportTake().length, TakeState.maxPoints);
  assert.equal(run.machine.exportTake().at(-1)[3], 0, 'cap forces an explicit terminal lift in-place');
  assert.match(run.errors.at(-1), /4000-point safety limit/);
});

test('PLAY uses the recorded absolute clock without per-gap clamping or accumulated drift', async () => {
  const run = harness();
  run.machine.replace([
    [0, 0.1, 0.2, 1],
    [100, 0.2, 0.3, 1],
    [2500, 0.3, 0.4, 0],
  ]);
  await run.machine.play(false);
  await run.clock.tick(0);
  await run.clock.tick(100);
  await run.clock.tick(2400);
  assert.deepEqual(run.output.map(({ at, sample }) => [at, sample.down]), [
    [0, true], [100, true], [2500, false],
  ]);
  assert.equal(run.machine.state().phase, 'ready');
});

test('LOOP settles contact-up before the next first point and never drops that point', async () => {
  const run = harness();
  run.machine.replace([[0, 0.1, 0.2, 1], [50, 0.2, 0.3, 0]]);
  await run.machine.play(true);
  await run.clock.tick(0);
  await run.clock.tick(50);
  assert.deepEqual(run.output.slice(0, 3).map(({ at, sample }) => [at, sample.down]), [
    [0, true], [50, false], [50, true],
  ]);
  assert.equal(run.machine.state().loopCount, 1);
  await run.machine.stop('test-stop');
  assert.deepEqual(run.output.slice(-2).map(({ sample }) => sample.down), [true, false]);
  assert.equal(run.machine.state().phase, 'ready');
});

test('switching LOOP to PLAY is generation-safe and ordered through a confirmed lift', async () => {
  const run = harness();
  run.machine.replace([[0, 0.1, 0.2, 1], [100, 0.2, 0.3, 0]]);
  await run.machine.play(true);
  await run.clock.tick(0);
  await run.machine.play(false);
  await run.clock.tick(0);
  assert.deepEqual(run.output.slice(0, 3).map(({ sample }) => sample.down), [true, false, true]);
  assert.equal(run.machine.state().phase, 'playing');
});

test('CLEAR keeps the buffer and settling UI until the ordered lift is acknowledged', async () => {
  const clock = new FakeClock();
  const output = [];
  let releaseLift;
  const machine = TakeState.create({
    now: clock.now, schedule: clock.schedule, cancel: clock.cancel,
    emitSample(sample, meta) {
      output.push({ sample: { ...sample }, meta: { ...meta } });
      if (meta.kind === 'settle') return new Promise((resolve) => { releaseLift = resolve; });
      return Promise.resolve();
    },
  });
  machine.replace([[0, 0.1, 0.2, 1], [100, 0.2, 0.3, 0]]);
  await machine.play(false);
  await clock.tick(0);
  const clearing = machine.clear();
  await clock.flush();
  assert.equal(machine.state().phase, 'settling');
  assert.equal(machine.state().count, 2, 'buffer remains truthful until output is safe');
  releaseLift();
  await clearing;
  assert.equal(machine.state().phase, 'empty');
  assert.deepEqual(machine.exportTake(), []);
  assert.deepEqual(output.map(({ sample }) => sample.down), [true, false]);
});

test('lost down acknowledgement still requires one confirmed lift before CLEAR settles', async () => {
  const clock = new FakeClock();
  const output = [];
  let releaseLift;
  const machine = TakeState.create({
    now: clock.now, schedule: clock.schedule, cancel: clock.cancel,
    emitSample(sample, meta) {
      output.push({ sample: { ...sample }, meta: { ...meta } });
      if (sample.down) return Promise.reject(new Error('down ACK lost'));
      return new Promise((resolve) => { releaseLift = resolve; });
    },
  });
  machine.replace([[0, 0.1, 0.2, 1], [100, 0.2, 0.3, 0]]);
  await machine.play(false);
  await clock.tick(0);
  const clearing = machine.clear();
  await clock.flush();

  assert.deepEqual(output.map(({ sample }) => sample.down), [true, false]);
  assert.equal(machine.state().phase, 'settling');
  assert.equal(machine.state().contactDown, true, 'lost ACK is conservatively treated as contact down');
  assert.equal(machine.state().count, 2, 'CLEAR retains the take until the lift ACK arrives');

  releaseLift();
  await clearing;
  await clock.flush();
  assert.equal(machine.state().contactDown, false);
  assert.equal(machine.state().count, 0);
  assert.equal(output.filter(({ sample }) => !sample.down).length, 1, 'exactly one recovery lift is emitted');
});

test('playback sample rejection cancels late frames and lifts before exposing terminal error', async () => {
  const clock = new FakeClock();
  const output = [];
  const errors = [];
  const machine = TakeState.create({
    now: clock.now, schedule: clock.schedule, cancel: clock.cancel,
    emitSample(sample, meta) {
      output.push({ sample: { ...sample }, meta: { ...meta } });
      if (meta.kind === 'playback' && meta.index === 1) {
        return Promise.reject(new Error('sample write rejected'));
      }
      return Promise.resolve();
    },
    onError(error) { errors.push(error.message); },
  });
  machine.replace([
    [0, 0.1, 0.2, 1],
    [50, 0.2, 0.3, 1],
    [100, 0.3, 0.4, 0],
  ]);
  await machine.play(false);
  await clock.tick(0);
  await clock.tick(50);
  await clock.flush();

  assert.deepEqual(output.map(({ sample }) => sample.down), [true, true, false]);
  assert.equal(machine.state().phase, 'error', 'error is published only after the recovery lift ACK');
  assert.equal(machine.state().contactDown, false);
  assert.match(errors.at(-1), /sample write rejected/);
  const countAfterRecovery = output.length;
  await clock.tick(1000);
  assert.equal(output.length, countAfterRecovery, 'generation cancellation prevents late playback frames');
});

test('PLAY/LOOP/REC refuse without connected ARM and lease eligibility', async () => {
  const run = harness({ eligible: false });
  run.machine.replace([[0, 0.1, 0.2, 0]]);
  await assert.rejects(run.machine.play(false), /ARM and lease are not confirmed/);
  await assert.rejects(run.machine.play(true), /ARM and lease are not confirmed/);
  await assert.rejects(run.machine.startRecording(), /ARM and lease are not confirmed/);
  assert.equal(run.machine.state().phase, 'error');
  assert.equal(run.output.length, 0);
});

test('lifecycle stop cancels stale scheduled generations and emits no late frame', async () => {
  const run = harness();
  run.machine.replace([[0, 0.1, 0.2, 1], [100, 0.2, 0.3, 1], [200, 0.3, 0.4, 0]]);
  await run.machine.play(false);
  await run.clock.tick(0);
  await run.machine.stop('background');
  const countAfterStop = run.output.length;
  await run.clock.tick(1000);
  assert.equal(run.output.length, countAfterStop, 'cancelled generation emits no stale timer sample');
  assert.equal(run.machine.state().contactDown, false);
});

test('settle cleanup emits one authoritative lift during clear', async () => {
  const run = harness();
  run.machine.replace([[0, 0.2, 0.2, 1], [40, 0.8, 0.8, 0]]);
  await run.machine.play(true);
  await run.clock.tick(0);
  const settleClear = run.machine.clear();
  assert.equal(run.machine.state().phase, 'settling');
  await settleClear;
  assert.equal(run.output.filter(({ meta }) => meta.kind === 'settle').length, 1);
  assert.equal(run.output.at(-1).sample.down, false);
  assert.equal(run.machine.state().phase, 'empty');
});
