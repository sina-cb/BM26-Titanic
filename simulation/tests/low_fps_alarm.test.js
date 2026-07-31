/**
 * low_fps_alarm.test.js — the sustained-low-FPS latch driven by animate.js's
 * once-per-second frame count (src/core/low_fps_alarm.js), from report
 * `20260725_38` §4.3.
 *
 * The contract that matters: a hitch stays quiet, a sustained floor fires
 * EXACTLY once, and a recovery re-arms the run counter but never the alarm.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createLowFpsAlarm, LOW_FPS_THRESHOLD, LOW_FPS_SUSTAIN_SECONDS,
} from '../src/core/low_fps_alarm.js';

function feed(alarm, fps, seconds) {
  let fires = 0;
  for (let i = 0; i < seconds; i++) if (alarm.sample(fps)) fires++;
  return fires;
}

test('shipped thresholds match the measured healthy / broken bands', () => {
  // 59.9 FPS healthy vs 10-20 FPS on the iGPU: 20 separates them cleanly.
  assert.equal(LOW_FPS_THRESHOLD, 20);
  assert.equal(LOW_FPS_SUSTAIN_SECONDS, 10);
});

test('a healthy 60 FPS run never fires', () => {
  const alarm = createLowFpsAlarm(20, 10);
  assert.equal(feed(alarm, 60, 120), 0);
  assert.equal(alarm.fired, false);
  assert.equal(alarm.lowSeconds, 0);
});

test('the operator 10 FPS case fires exactly once, on the 10th second', () => {
  const alarm = createLowFpsAlarm(20, 10);
  assert.equal(feed(alarm, 10, 9), 0, 'must stay quiet for the first 9 seconds');
  assert.equal(alarm.sample(10), true, 'the 10th consecutive low second fires');
  assert.equal(feed(alarm, 10, 300), 0, 'and never fires again on this page');
  assert.equal(alarm.fired, true);
});

test('a short hitch (a scene rebuild, a dragged slider) stays quiet', () => {
  const alarm = createLowFpsAlarm(20, 10);
  for (let round = 0; round < 5; round++) {
    assert.equal(feed(alarm, 4, 9), 0);
    assert.equal(alarm.sample(60), false, 'recovery resets the run');
    assert.equal(alarm.lowSeconds, 0);
  }
  assert.equal(alarm.fired, false);
});

test('the threshold is exclusive — exactly 20 FPS is not "low"', () => {
  const alarm = createLowFpsAlarm(20, 10);
  assert.equal(feed(alarm, 20, 60), 0);
  assert.equal(alarm.lowSeconds, 0);
});

test('19 FPS (the iGPU windowed band) does count as low', () => {
  const alarm = createLowFpsAlarm(20, 10);
  assert.equal(feed(alarm, 19, 9), 0);
  assert.equal(alarm.sample(19), true);
});

test('a stalled tab (0 FPS) fires like any other sustained floor', () => {
  const alarm = createLowFpsAlarm(20, 10);
  assert.equal(feed(alarm, 0, 9), 0);
  assert.equal(alarm.sample(0), true);
});

test('recovery after firing does not re-arm the alarm', () => {
  const alarm = createLowFpsAlarm(20, 10);
  feed(alarm, 5, 10);
  assert.equal(alarm.fired, true);
  feed(alarm, 60, 30);
  assert.equal(feed(alarm, 5, 50), 0, 'a second slow spell must not spam the console');
});

test('bad construction args throw loudly instead of silently disabling the alarm', () => {
  assert.throws(() => createLowFpsAlarm(0, 10), /positive number/);
  assert.throws(() => createLowFpsAlarm(NaN, 10), /positive number/);
  assert.throws(() => createLowFpsAlarm(20, 0), /positive integer/);
  assert.throws(() => createLowFpsAlarm(20, 2.5), /positive integer/);
});

test('a non-finite frame count throws rather than being counted as "fine"', () => {
  const alarm = createLowFpsAlarm(20, 10);
  assert.throws(() => alarm.sample(NaN), /finite number/);
  assert.throws(() => alarm.sample(undefined), /finite number/);
});
