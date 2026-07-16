// Regression tests for the AudioCapture give-up path (incident 2026-07-08):
// a capture config that can NEVER work (e.g. a bogus `capture.device`
// restored from a polluted audio_state.yaml → ffmpeg "Malformed dshow
// input string" on every spawn) used to spin the restart/backoff loop
// forever with no terminal signal. The engine must instead get ONE loud
// final `errorCode: 'capture_failed_repeatedly'` status (enabled: false,
// error naming the real ffmpeg cause) and keep rendering — the process
// must never die, silently or otherwise, over a mic.
//
// Run:  cd marsin_engine && node --test tests/audio_capture_give_up.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { AudioCapture } from '../../audio/capture/audio_capture.js';

/** Fake ffmpeg child (same shape as audio_capture.test.js's helper). */
function makeFakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = (_sig) => {
    child.killed = true;
    queueMicrotask(() => child.emit('exit', 0, _sig || 'SIGTERM'));
  };
  return child;
}

/**
 * spawnFn whose children die instantly with exit code 1 after writing
 * `stderrLine` — models ffmpeg's "Malformed dshow input string" crash.
 */
function makeAlwaysFailingSpawn(stderrLine) {
  const state = { spawnCount: 0 };
  const spawnFn = () => {
    state.spawnCount++;
    const child = makeFakeChild();
    queueMicrotask(() => {
      if (stderrLine) child.stderr.write(`${stderrLine}\n`);
      queueMicrotask(() => child.emit('exit', 1, null));
    });
    return child;
  };
  return { spawnFn, state };
}

function makeCapture(spawnFn, statuses, max = 3) {
  return new AudioCapture({
    onFrame: () => {},
    onStatus: (s) => statuses.push(s),
    frameSamples: 512,
    device: 'test',           // the exact bogus device from the incident
    inputFormat: 'dshow',
    platform: 'win32',
    spawnFn,
    maxConsecutiveFailures: max,
    restartBackoffInitialMs: 1, // run the whole loop in milliseconds
  });
}

/** Poll until pred() or timeout. */
async function until(pred, timeoutMs = 3000) {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > timeoutMs) throw new Error('timed out waiting for condition');
    await new Promise(r => setTimeout(r, 5));
  }
}

test('repeated instant ffmpeg failure ends in ONE terminal capture_failed_repeatedly status', async () => {
  const { spawnFn, state } = makeAlwaysFailingSpawn(
    '[dshow @ 000001] Malformed dshow input string.',
  );
  const statuses = [];
  // Squash the intentional loud console.error so test output stays clean.
  const origError = console.error;
  const origWarn = console.warn;
  console.error = () => {};
  console.warn = () => {};
  try {
    const cap = makeCapture(spawnFn, statuses, 3);
    cap.start();
    await until(() => statuses.some(s => s.errorCode === 'capture_failed_repeatedly'));

    const terminal = statuses.filter(s => s.errorCode === 'capture_failed_repeatedly');
    assert.equal(terminal.length, 1, 'exactly one terminal give-up status');
    const t = terminal[0];
    assert.equal(t.phase, 'error');
    assert.equal(t.enabled, false, 'terminal status must report audio disabled');
    assert.match(t.error, /Malformed dshow input string/,
      'the real ffmpeg stderr cause must travel with the terminal status');
    assert.equal(t.consecutiveFailures, 3);

    // The give-up must actually STOP the loop: exactly max spawns, no
    // pending restart timer, and no further spawns after settling.
    assert.equal(state.spawnCount, 3, 'no respawn after the failure budget is spent');
    assert.equal(cap._restartTimer, null, 'no restart timer left armed');
    await new Promise(r => setTimeout(r, 50));
    assert.equal(state.spawnCount, 3, 'still no respawn after settling');
  } finally {
    console.error = origError;
    console.warn = origWarn;
  }
});

test('a delivered frame resets the consecutive-failure budget', async () => {
  // Sequence: child #1 dies instantly (1 failure), child #2 streams a full
  // PCM frame (goes 'running' → budget refunded) then dies, children #3+
  // die instantly. With MAX=2, the give-up therefore needs 2 NEW failures
  // AFTER the good child: spawns = 1 (bad) + 1 (good) + 1 (bad) = 3.
  // Without the refund, child #2's death would already be failure #2 and
  // the loop would give up after only 2 spawns.
  const state = { spawnCount: 0 };
  const MAX = 2;
  const spawnFn = () => {
    state.spawnCount++;
    const child = makeFakeChild();
    if (state.spawnCount === 2) {
      queueMicrotask(() => {
        child.stdout.write(Buffer.alloc(512 * 2)); // one full 512-sample s16 frame
        setTimeout(() => child.emit('exit', 1, null), 10);
      });
    } else {
      queueMicrotask(() => child.emit('exit', 1, null));
    }
    return child;
  };
  const statuses = [];
  const origError = console.error;
  const origWarn = console.warn;
  console.error = () => {};
  console.warn = () => {};
  try {
    const cap = makeCapture(spawnFn, statuses, MAX);
    cap.start();
    await until(() => statuses.some(s => s.errorCode === 'capture_failed_repeatedly'));
    assert.ok(statuses.some(s => s.phase === 'running'), 'child #2 must have gone running');
    assert.equal(state.spawnCount, 3,
      'the running frame must refund the failure budget before the final bad streak');
  } finally {
    console.error = origError;
    console.warn = origWarn;
  }
});

test('give-up emits enabled:false so the engine onStatus path disables audio', async () => {
  // Pin the exact contract engine.js relies on (its onStatus handler nulls
  // audioState.capture/analyzer on errorCode === 'capture_failed_repeatedly'
  // and the broadcast carries enabled:false): every NON-terminal status says
  // enabled:true; only the terminal one flips it.
  const { spawnFn } = makeAlwaysFailingSpawn('boom');
  const statuses = [];
  const origError = console.error;
  const origWarn = console.warn;
  console.error = () => {};
  console.warn = () => {};
  try {
    const cap = makeCapture(spawnFn, statuses, 2);
    cap.start();
    await until(() => statuses.some(s => s.errorCode === 'capture_failed_repeatedly'));
    for (const s of statuses) {
      if (s.errorCode === 'capture_failed_repeatedly') assert.equal(s.enabled, false);
      else assert.equal(s.enabled, true);
    }
  } finally {
    console.error = origError;
    console.warn = origWarn;
  }
});
