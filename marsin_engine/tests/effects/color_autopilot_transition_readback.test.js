import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ColorAutopilot } from '../../lib/color_autopilot.js';

function tmpCfg() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'colorap-transition-'));
  return path.join(dir, 'config.yaml');
}

test('transition readback is engine-clocked, bounded, cancellable, and exact', async () => {
  const transitions = [];
  let nowMs = 0;
  const queue = [];
  const resolve = (_entry, livePalette) => Object.fromEntries(
    livePalette.map((channel, index) => [`colorPalette${index + 1}`, { ...channel }]),
  );
  const ca = new ColorAutopilot(() => {}, tmpCfg(), {
    resolvePaletteFn: resolve,
    applyParamsFn: () => {},
    onTransition: transition => transitions.push(transition),
    resolveTransitionScopeFn: () => 'live-five',
    now: () => nowMs,
    scheduleFrame: (fn, ms) => { const h = { fn, at: nowMs + ms }; queue.push(h); return h; },
    clearFrame: (h) => { const i = queue.indexOf(h); if (i >= 0) queue.splice(i, 1); },
  });
  const advance = (ms) => {
    const target = nowMs + ms;
    for (;;) {
      const next = queue.filter(h => h.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      queue.splice(queue.indexOf(next), 1);
      nowMs = next.at;
      next.fn();
    }
    nowMs = target;
  };
  const states = [
    [0.1, 0.6, 0.1, 0.6, 0.1].map(h => ({ h, s: 1, v: 1 })),
    [0.6, 0.1, 0.6, 0.1, 0.6].map(h => ({ h, s: 1, v: 1 })),
  ];
  ca.setState(ColorAutopilot.validate({
    active: true,
    palettes: [{ c1: 0.1, c2: 0.6 }, { c1: 0.6, c2: 0.1 }],
    livePalettes: states,
    delay_s: 1,
    transitionMs: 400,
  }));
  ca.seedCurrentParams(resolve(null, states[0]));
  const run = ca.triggerNext();
  advance(200);
  assert.equal(ca.transition.status, 'running');
  assert.equal(ca.transition.progress, 0.5);
  assert.equal(ca.transition.scope, 'live-five');
  assert.deepEqual(ca.transition.palette, states[0]);
  advance(200);
  await run;
  assert.equal(ca.transition.status, 'settled');
  assert.equal(ca.transition.progress, 1);
  assert.deepEqual(ca.transition.params, resolve(null, states[0]));
  assert.ok(transitions.length <= 6, `400 ms tween must publish <=10 Hz plus terminals, got ${transitions.length}`);

  const second = ca.triggerNext();
  advance(120);
  ca.deactivate();
  await second;
  assert.equal(ca.transition.status, 'cancelled');
  assert.equal(ca.transition.active, false);
  assert.equal(ca.transition.cancelled, true);
});
