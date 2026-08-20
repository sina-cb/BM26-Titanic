import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TIMING_SOURCE = fs.readFileSync(
  path.resolve(HERE, '../../../CaptainPad/live_touch/touch_control_color_transition_timing.js'),
  'utf8',
);
const WIRE_SOURCE = fs.readFileSync(
  path.resolve(HERE, '../../../CaptainPad/live_touch/touch_control_wire.js'),
  'utf8',
);
const PANEL_SOURCE = fs.readFileSync(
  path.resolve(HERE, '../../../CaptainPad/live_touch/touch_control.html'),
  'utf8',
);

function bootTiming() {
  function CustomEvent(name, init) {
    this.type = name;
    this.detail = init && init.detail ? init.detail : undefined;
  }
  const events = [];
  const context = {
    ColorTransitionTiming: undefined,
    CustomEvent,
    document: {
      dispatchEvent(event) {
        events.push(JSON.parse(JSON.stringify(event.detail || {})));
      },
    },
    window: null,
  };
  context.window = context;
  vm.runInNewContext(TIMING_SOURCE, context, {
    filename: 'touch_control_color_transition_timing.js',
  });
  return { timing: context.ColorTransitionTiming, events, context };
}

test('ColorTransitionTiming defaults to 0.8 s and clamps to 0.2..5.0 s', () => {
  const { timing } = bootTiming();
  assert.equal(timing.DEFAULT_MS, 800);
  assert.equal(timing.ms(), 800);
  assert.equal(timing.label(), '0.8s');
  assert.equal(timing.clampMs(50), 200);
  assert.equal(timing.clampMs(9000), 5000);
  assert.equal(timing.msFromNorm(0), 200);
  assert.equal(timing.msFromNorm(1), 5000);
  assert.equal(timing.normFromMs(800), 0.125);
  assert.equal(timing.movementFadeSpan(), 0.16);
});

test('ColorTransitionTiming publishes one sync event per changed write', () => {
  const { timing, events } = bootTiming();
  timing.setMs(1200, 'legacy-color');
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    ms: 1200,
    norm: timing.normFromMs(1200),
    label: '1.2s',
    source: 'legacy-color',
  });
  timing.setMs(1200, 'color-hub');
  assert.equal(events.length, 1, 'identical value must not republish');
  timing.setNorm(0.5, 'color-hub');
  assert.equal(events.length, 2);
  assert.equal(events[1].source, 'color-hub');
});

test('wire and panel contract expose the shared timing authority', () => {
  assert.match(PANEL_SOURCE, /touch_control_color_transition_timing\.js/);
  assert.match(PANEL_SOURCE, /id="chColorTransitionFader"/);
  assert.match(PANEL_SOURCE, /COLOR TRANSITION/);
  assert.match(PANEL_SOURCE, /colortransitiontiming/);
  assert.match(WIRE_SOURCE, /ColorTransitionTiming/);
  assert.match(WIRE_SOURCE, /colortransitiontiming/);
  assert.match(WIRE_SOURCE, /pushFadeToEngine/);
  assert.doesNotMatch(WIRE_SOURCE, /var FADE_MAX_MS = 5000;/);
});
