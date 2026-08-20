import test from 'node:test';
import assert from 'node:assert/strict';

import { ColorAutopilotTransition } from '../../lib/color_autopilot_transition.js';

function params(hues) {
  return Object.fromEntries(hues.map((h, index) => [
    `colorPalette${index + 1}`, { h, s: 1, v: 1 },
  ]));
}

test('transition state publishes bounded running frames and exact settlement', () => {
  let nowMs = 1000;
  const published = [];
  const from = params([0.1, 0.6, 0.1, 0.6, 0.1]);
  const target = params([0.6, 0.1, 0.6, 0.1, 0.6]);
  const transition = new ColorAutopilotTransition({
    now: () => nowMs,
    publish: state => published.push(state),
    resolveScope: () => 'live-five',
  });
  const id = transition.begin(from, target, 400);
  for (let elapsed = 40; elapsed <= 360; elapsed += 40) {
    nowMs = 1000 + elapsed;
    transition.update(id, params([0.1 + elapsed / 800, 0.6, 0.1, 0.6, 0.1]), elapsed / 400);
  }
  assert.equal(transition.state.status, 'running');
  assert.equal(transition.state.progress, 0.9);
  assert.equal(transition.state.scope, 'live-five');
  assert.equal(transition.state.paletteAuthority, 'session-five');
  nowMs = 1400;
  transition.settle(id, target);
  assert.equal(transition.state.status, 'settled');
  assert.equal(transition.state.progress, 1);
  assert.deepEqual(transition.state.params, target);
  assert.deepEqual(transition.state.palette, Object.values(target));
  assert.ok(published.length <= 6, `400 ms transition published ${published.length} frames`);
});

test('cancel and failure are immediate terminal engine states', () => {
  let nowMs = 0;
  const published = [];
  const transition = new ColorAutopilotTransition({
    now: () => nowMs,
    publish: state => published.push(state),
  });
  const from = params([0, 0.1, 0.2, 0.3, 0.4]);
  const target = params([0.5, 0.6, 0.7, 0.8, 0.9]);
  const first = transition.begin(from, target, 400);
  nowMs = 120;
  transition.update(first, from, 0.3);
  transition.cancel(from);
  assert.match(transition.state.status, /cancelled/);
  assert.equal(transition.state.active, false);
  assert.equal(transition.state.endedAtMs, 120);

  nowMs = 200;
  const second = transition.begin(from, target, 400);
  transition.fail(second, from, new Error('private palette write refused'));
  assert.equal(transition.state.status, 'failed');
  assert.equal(transition.state.failed, true);
  assert.equal(transition.state.error, 'private palette write refused');
  assert.equal(published.at(-1).status, 'failed');
});

test('snap settlement is still a start plus exact terminal readback', () => {
  const published = [];
  const target = params([0.2, 0.7, 0.2, 0.7, 0.2]);
  const transition = new ColorAutopilotTransition({ publish: state => published.push(state) });
  const id = transition.begin(null, target, 0);
  transition.settle(id, target);
  assert.deepEqual(published.map(state => state.status), ['running', 'settled']);
  assert.deepEqual(transition.state.targetParams, target);
  assert.deepEqual(transition.state.params, target);
});
