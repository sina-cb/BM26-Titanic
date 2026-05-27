// Unit tests for AudioCapture. We inject a fake spawn() so we never
// touch a real ffmpeg / mic during CI — the tests pump synthetic
// byte streams through the framing path and assert the resulting
// Int16Array frames + lifecycle events.
//
// Run:  cd marsin_engine && node --test tests/audio_capture.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { AudioCapture } from '../lib/audio_capture.js';

/** Build a fake child that AudioCapture can talk to. */
function makeFakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = (_sig) => {
    child.killed = true;
    // Mimic ffmpeg exiting on SIGTERM after a tick.
    queueMicrotask(() => child.emit('exit', 0, _sig || 'SIGTERM'));
  };
  return child;
}

/** Returns { spawnFn, lastChild, spawnCount }. */
function makeFakeSpawn() {
  const state = { spawnCount: 0, lastChild: null, lastArgs: null };
  const spawnFn = (_cmd, args) => {
    state.spawnCount++;
    state.lastChild = makeFakeChild();
    state.lastArgs = args;
    return state.lastChild;
  };
  return { spawnFn, state };
}

test('throws on missing onFrame', () => {
  assert.throws(() => new AudioCapture({ frameSamples: 512 }));
});

test('throws on bad frameSamples', () => {
  assert.throws(() => new AudioCapture({ onFrame: () => {}, frameSamples: 0 }));
  assert.throws(() => new AudioCapture({ onFrame: () => {}, frameSamples: -1 }));
  assert.throws(() => new AudioCapture({ onFrame: () => {}, frameSamples: 1.5 }));
});

test('throws on unsupported backend', () => {
  assert.throws(() => new AudioCapture({
    backend: 'sox', onFrame: () => {}, frameSamples: 512,
  }));
});

test('buildArgs includes the canonical flags', () => {
  const { spawnFn } = makeFakeSpawn();
  const cap = new AudioCapture({
    onFrame: () => {},
    frameSamples: 512,
    sampleRate: 48000,
    channels: 2,
    device: ':1',
    inputFormat: 'avfoundation',
    spawnFn,
  });
  const args = cap.buildArgs();
  assert.ok(args.includes('-f'));
  assert.ok(args.includes('avfoundation'));
  assert.ok(args.includes(':1'));
  assert.ok(args.includes('-ac') && args[args.indexOf('-ac') + 1] === '2');
  assert.ok(args.includes('-ar') && args[args.indexOf('-ar') + 1] === '48000');
  assert.ok(args.includes('s16le'));
  assert.equal(args[args.length - 1], '-', 'last arg pipes to stdout');
});

test('reframes mixed-size byte chunks into exact-size Int16Array frames', async () => {
  const { spawnFn, state } = makeFakeSpawn();
  const frames = [];
  const cap = new AudioCapture({
    onFrame: (i16) => frames.push(i16),
    frameSamples: 4,            // 4 samples * 1 chan * 2 bytes = 8 bytes/frame
    channels: 1,
    spawnFn,
  });
  cap.start();
  const c = state.lastChild;

  // Feed 6 bytes (incomplete frame).
  c.stdout.write(Buffer.from([1, 0, 2, 0, 3, 0]));
  assert.equal(frames.length, 0);

  // Feed 10 more bytes → 16 total = 2 frames, 0 leftover.
  c.stdout.write(Buffer.from([4, 0, 5, 0, 6, 0, 7, 0, 8, 0]));
  assert.equal(frames.length, 2);
  assert.equal(frames[0].length, 4);
  assert.deepEqual(Array.from(frames[0]), [1, 2, 3, 4]);
  assert.deepEqual(Array.from(frames[1]), [5, 6, 7, 8]);

  // Feed exactly 8 bytes → 1 more frame, 0 leftover.
  c.stdout.write(Buffer.from([9, 0, 10, 0, 11, 0, 12, 0]));
  assert.equal(frames.length, 3);
  assert.deepEqual(Array.from(frames[2]), [9, 10, 11, 12]);

  await cap.stop();
});

test('emits status lifecycle: starting → running → stopped', async () => {
  const { spawnFn, state } = makeFakeSpawn();
  const phases = [];
  const cap = new AudioCapture({
    onFrame: () => {},
    onStatus: (s) => phases.push(s.phase),
    frameSamples: 2,
    spawnFn,
  });
  cap.start();
  // 'starting' was emitted synchronously.
  state.lastChild.stdout.write(Buffer.from([0, 0, 0, 0]));   // → 'running'
  await cap.stop();                                          // → 'stopped'
  assert.ok(phases.includes('starting'));
  assert.ok(phases.includes('running'));
  assert.ok(phases.includes('stopped'));
});

test('exponential backoff doubles on unexpected exit, capped at 30s', () => {
  const { spawnFn, state } = makeFakeSpawn();
  const cap = new AudioCapture({
    onFrame: () => {},
    frameSamples: 2,
    spawnFn,
  });
  cap.start();
  assert.equal(state.spawnCount, 1);
  // Initial scheduled backoff.
  assert.equal(cap._backoffMs, 1000);
  // First unexpected exit → schedule restart, double backoff.
  state.lastChild.emit('exit', 1, null);
  assert.equal(cap._backoffMs, 2000);
  // After many failures the backoff should be capped at 30s.
  for (let i = 0; i < 20; i++) {
    cap._scheduleRestart();
  }
  assert.equal(cap._backoffMs, 30_000, 'backoff capped at 30s');
  // Clean up timers so the test process can exit.
  cap.stop();
});

test('stop() during pending restart cancels the timer and resolves', async () => {
  const { spawnFn, state } = makeFakeSpawn();
  const cap = new AudioCapture({
    onFrame: () => {},
    frameSamples: 2,
    spawnFn,
  });
  cap.start();
  // Trigger a restart schedule, then immediately stop.
  state.lastChild.emit('exit', 1, null);
  assert.ok(cap._restartTimer, 'restart scheduled');
  await cap.stop();
  assert.equal(cap._restartTimer, null, 'restart timer cleared on stop');
});

test('a throwing onFrame does not break framing of subsequent frames', () => {
  const { spawnFn, state } = makeFakeSpawn();
  let count = 0;
  const cap = new AudioCapture({
    onFrame: () => { count++; if (count === 1) throw new Error('boom'); },
    frameSamples: 2,
    spawnFn,
  });
  cap.start();
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    state.lastChild.stdout.write(Buffer.from([0, 0, 0, 0]));   // frame 1 — throws
    state.lastChild.stdout.write(Buffer.from([1, 0, 1, 0]));   // frame 2 — counted
    assert.equal(count, 2);
  } finally {
    console.warn = origWarn;
    cap.stop();
  }
});
