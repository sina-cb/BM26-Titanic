import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LAYER_SETTING_IDS } from '../../lib/layer_surface_router.js';
import { PatternMixer } from '../../lib/pattern_mixer.js';

const SETTINGS = Object.values(LAYER_SETTING_IDS);
const HANDLE_BY_SETTING = Object.freeze({
  [LAYER_SETTING_IDS.DECK]: 1,
  [LAYER_SETTING_IDS.MIXER]: 2,
  [LAYER_SETTING_IDS.LIVE_TOUCH]: 3,
});
const LEVEL_BY_HANDLE = Object.freeze({ 1: 20, 2: 120, 3: 220 });

function makeHarness() {
  const beginCalls = [];
  const renderCalls = [];
  const wasmHost = {
    beginFrame(handle) {
      beginCalls.push(handle);
    },
    renderAll6ch(handle, buffer) {
      renderCalls.push(handle);
      buffer.fill(LEVEL_BY_HANDLE[handle]);
    },
    renderBlend6ch(_handle, _pixelCount, background, foreground, amount) {
      const out = new Uint8Array(background.length);
      for (let i = 0; i < out.length; i++) {
        out[i] = Math.round(background[i] + (foreground[i] - background[i]) * amount);
      }
      return out;
    },
    destroy() {},
  };
  const mixer = new PatternMixer({ wasmHost, pixelCount: 2, maxChannels: 3 });
  mixer.wantVisThisFrame = false;
  mixer.blendHandles.blend_screen = 99;
  mixer.setDeckChannel({
    id: 'deck', name: 'Deck', pattern: 'deck_pattern', handle: 1,
    mode: 'blend_screen', fader: 1, enabled: true,
  });
  mixer.addMixerChannel({
    id: 'mixer', name: 'Mixer', pattern: 'mixer_pattern', handle: 2,
    mode: 'blend_screen', fader: 1, enabled: true,
  });
  mixer.setLiveTouchChannel({
    id: 'live_touch', name: 'Live Touch', pattern: 'live_pattern', handle: 3,
    mode: 'blend_screen', fader: 1, enabled: true,
  });
  return { mixer, beginCalls, renderCalls };
}

for (const setting of SETTINGS) {
  test(`steady ${setting} begins and renders no other layer setting`, () => {
    const harness = makeHarness();
    harness.mixer.forceLayerSetting(setting, 'test');
    harness.mixer.beginFrame(1);
    harness.mixer.renderAll6ch();

    assert.deepEqual(new Set(harness.beginCalls), new Set([HANDLE_BY_SETTING[setting]]));
    assert.deepEqual(new Set(harness.renderCalls), new Set([HANDLE_BY_SETTING[setting]]));
  });
}

for (const from of SETTINGS) {
  for (const to of SETTINGS) {
    if (from === to) continue;
    test(`${from} -> ${to} renders exactly outgoing and incoming`, () => {
      const harness = makeHarness();
      harness.mixer.forceLayerSetting(from, 'test');
      harness.mixer.activateLayerSetting(to, { durationMs: 1000, reason: 'test' });
      harness.mixer.beginFrame(1);
      harness.mixer.renderAll6ch();

      const expected = new Set([HANDLE_BY_SETTING[from], HANDLE_BY_SETTING[to]]);
      assert.deepEqual(new Set(harness.beginCalls), expected);
      assert.deepEqual(new Set(harness.renderCalls), expected);
    });
  }
}

test('all directed pairs use the same byte-wise blend operation', () => {
  for (const from of SETTINGS) {
    for (const to of SETTINGS) {
      if (from === to) continue;
      const harness = makeHarness();
      harness.mixer.forceLayerSetting(from, 'test');
      harness.mixer.activateLayerSetting(to, { durationMs: 1000, reason: 'test' });
      harness.mixer.layerRouter.transition.progress = 0.5;

      const output = harness.mixer.renderAll6ch();
      const expected = Math.round(
        (LEVEL_BY_HANDLE[HANDLE_BY_SETTING[from]] + LEVEL_BY_HANDLE[HANDLE_BY_SETTING[to]]) / 2,
      );
      assert.ok(output.every(value => value === expected), `${from} -> ${to}`);
    }
  }
});

test('Live Touch processor runs only on the Live buffer before crossfade', () => {
  const harness = makeHarness();
  let processorCalls = 0;
  harness.mixer.setLiveTouchOutputProcessor(buffer => {
    processorCalls += 1;
    buffer.fill(60);
  });
  harness.mixer.forceLayerSetting(LAYER_SETTING_IDS.DECK, 'test');
  harness.mixer.activateLayerSetting(LAYER_SETTING_IDS.LIVE_TOUCH, {
    durationMs: 1000,
    reason: 'test',
  });
  harness.mixer.layerRouter.transition.progress = 0.5;

  const output = harness.mixer.renderAll6ch();
  assert.equal(processorCalls, 1);
  assert.ok(output.every(value => value === 40));
  assert.ok(harness.mixer.deckBuffer.every(value => value === 20));
});

test('a queued third setting is not begun or rendered in the current transaction', () => {
  const harness = makeHarness();
  harness.mixer.forceLayerSetting(LAYER_SETTING_IDS.DECK, 'test');
  harness.mixer.activateLayerSetting(LAYER_SETTING_IDS.MIXER, {
    durationMs: 1000,
    reason: 'test',
  });
  const queued = harness.mixer.activateLayerSetting(LAYER_SETTING_IDS.LIVE_TOUCH, {
    durationMs: 1000,
    reason: 'test',
  });
  assert.equal(queued.status, 'queued');

  harness.mixer.beginFrame(1);
  harness.mixer.renderAll6ch();

  const expected = new Set([HANDLE_BY_SETTING.deck, HANDLE_BY_SETTING.mixer]);
  assert.deepEqual(new Set(harness.beginCalls), expected);
  assert.deepEqual(new Set(harness.renderCalls), expected);
});

test('first canonical activation captures a restored legacy Deck as outgoing', () => {
  const harness = makeHarness();
  harness.mixer.viewFader = 0;
  harness.mixer.targetViewFader = 0;

  const result = harness.mixer.activateLayerSetting(LAYER_SETTING_IDS.LIVE_TOUCH, {
    durationMs: 1000,
    reason: 'test',
  });

  assert.equal(result.state.transition.from, LAYER_SETTING_IDS.DECK);
  assert.equal(result.state.transition.to, LAYER_SETTING_IDS.LIVE_TOUCH);
});
