import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { PatternMixer } from '../../lib/pattern_mixer.js';

function makeHost() {
  const destroyed = [];
  const blendCalls = [];
  const framePhases = new Map();
  const renderCalls = [];
  return {
    destroyed,
    blendCalls,
    framePhases,
    renderCalls,
    destroy(handle) { destroyed.push(handle); },
    beginFrame(handle, phaseSeconds) {
      const phases = framePhases.get(handle.id) || [];
      phases.push(phaseSeconds);
      framePhases.set(handle.id, phases);
    },
    getExports() { return []; },
    renderAll6ch(handle, output) {
      renderCalls.push(handle.id);
      output.fill(handle.value);
      return output;
    },
    renderBlend6ch(handle, _pixelCount, from, to, progress, output = null) {
      blendCalls.push({ handle, progress });
      const target = output || new Uint8Array(from.length);
      for (let i = 0; i < target.length; i++) {
        target[i] = Math.round(from[i] + (to[i] - from[i]) * progress);
      }
      return target;
    },
  };
}

function makeMixer(host) {
  const mixer = new PatternMixer({ wasmHost: host, pixelCount: 1, maxChannels: 2 });
  mixer.blendHandles.trans_crossfade = { id: 'trans_crossfade' };
  mixer.setLiveTouchChannel({
    id: 'live_touch',
    name: 'Live Touch',
    pattern: 'pattern_a',
    handle: { id: 'a', value: 20 },
  });
  mixer.forceLayerSetting('live_touch', 'test');
  return mixer;
}

test('Live Touch base swap retains A, uses exact trans_crossfade/500ms, then atomically lands B', () => {
  const host = makeHost();
  const mixer = makeMixer(host);
  const active = mixer.getLiveTouchChannel();
  const incomingHandle = { id: 'b', value: 180 };
  const incoming = mixer.prepareLiveTouchPatternSwap({
    newHandle: incomingHandle,
    patternName: 'pattern_b',
  });
  incoming.localControls = { sliderLevel: 0.42 };

  let completed = null;
  const events = [];
  mixer.onLiveTouchPatternSwapChange = event => events.push(event);
  const transitionId = mixer.startLiveTouchPatternSwap({
    onComplete: event => { completed = event; },
  });
  const pending = mixer.getLiveTouchPatternTransitionState();
  assert.equal(active.pattern, 'pattern_a', 'A remains authoritative while B is pending');
  assert.equal(pending.id, transitionId);
  assert.equal(pending.fromPattern, 'pattern_a');
  assert.equal(pending.toPattern, 'pattern_b');
  assert.equal(pending.durationMs, 500);
  assert.equal(pending.mode, 'trans_crossfade');
  assert.equal(events[0].event, 'started');
  assert.equal(events[0].pattern, 'pattern_a');
  assert.equal(events[0].transition.toPattern, 'pattern_b');

  mixer.updateLiveTouchPatternSwap(mixer._liveTouchSwapTransition.startTime + 501);

  assert.equal(active.pattern, 'pattern_b');
  assert.equal(active.handle, incomingHandle);
  assert.deepEqual(active.localControls, { sliderLevel: 0.42 });
  assert.equal(mixer.getLiveTouchPatternTransitionState(), null);
  assert.deepEqual(completed, { pattern: 'pattern_b', transitionId });
  assert.equal(events.at(-1).event, 'completed');
  assert.equal(events.at(-1).pattern, 'pattern_b');
  assert.equal(events.at(-1).transition, null);
  assert.ok(host.destroyed.some(handle => handle.id === 'a'), 'outgoing A is retained until landing');
});

test('Live Touch crossfade advances on its 500ms clock and rejects overlap without corrupting A', () => {
  const host = makeHost();
  const mixer = makeMixer(host);
  mixer.prepareLiveTouchPatternSwap({
    newHandle: { id: 'b', value: 180 },
    patternName: 'pattern_b',
  });
  mixer.startLiveTouchPatternSwap();
  const startedAt = mixer._liveTouchSwapTransition.startTime;

  mixer.updateLiveTouchPatternSwap(startedAt + 125);
  assert.ok(Math.abs(mixer._inactiveLiveTouchChannel.fader - 0.15625) < 1e-12,
    'the smoothstep envelope must reflect actual elapsed time, not a synthetic instant swap');
  mixer.updateLiveTouchPatternSwap(startedAt + 250);
  assert.ok(Math.abs(mixer._inactiveLiveTouchChannel.fader - 0.5) < 1e-12,
    'the midpoint of the exact 500ms transition must be the half mix');
  assert.equal(mixer.getLiveTouchChannel().pattern, 'pattern_a',
    'A remains the actual engine base until the completion clock lands B');

  const rejected = { id: 'c', value: 240 };
  assert.throws(
    () => mixer.prepareLiveTouchPatternSwap({ newHandle: rejected, patternName: 'pattern_c' }),
    error => error && error.code === 'EBUSY',
    'an overlapping request must fail loudly instead of replacing the in-flight B',
  );
  assert.ok(host.destroyed.includes(rejected), 'the rejected overlapping handle must be released');
  assert.equal(mixer.getLiveTouchPatternTransitionState().toPattern, 'pattern_b');

  mixer.updateLiveTouchPatternSwap(startedAt + 500);
  assert.equal(mixer.getLiveTouchChannel().pattern, 'pattern_b');
  assert.equal(mixer.getLiveTouchPatternTransitionState(), null);
});

test('retained A and incoming B keep animating and rendering through the crossfade', () => {
  const host = makeHost();
  const mixer = makeMixer(host);
  const incomingHandle = { id: 'b', value: 180 };
  mixer.prepareLiveTouchPatternSwap({ newHandle: incomingHandle, patternName: 'pattern_b' });
  mixer.startLiveTouchPatternSwap();

  // Make the next normal mixer tick a deterministic midpoint without waiting
  // on wall time. Both channels must receive the same advancing phase clock.
  mixer._liveTouchSwapTransition.startTime = performance.now() - 250;
  mixer.beginFrame(1);
  mixer.beginFrame(1.25);
  mixer.renderAll6ch();

  const aPhases = host.framePhases.get('a');
  const bPhases = host.framePhases.get('b');
  assert.deepEqual(aPhases, [0, 0.25], 'retained A must continue advancing during the fade');
  assert.deepEqual(bPhases, [0, 0.25], 'incoming B must advance before it becomes authoritative');
  assert.ok(host.renderCalls.includes('a'), 'A must still render into the crossfade base');
  assert.ok(host.renderCalls.includes('b'), 'B must render into the crossfade base');

  const bPhaseBeforeLanding = bPhases.at(-1);
  const aRenderCountBeforeLanding = host.renderCalls.filter(id => id === 'a').length;
  mixer._liveTouchSwapTransition.startTime = performance.now() - 500;
  mixer.beginFrame(1.5);
  mixer.renderAll6ch();

  assert.equal(mixer.getLiveTouchChannel().handle, incomingHandle,
    'the exact landing promotes the already-animated B handle');
  assert.ok(host.framePhases.get('b').at(-1) > bPhaseBeforeLanding,
    'promoted B must preserve and advance its pre-landing phase rather than reset');
  assert.equal(host.renderCalls.filter(id => id === 'a').length, aRenderCountBeforeLanding,
    'A must stop rendering after its retained handle is released at landing');
  assert.ok(host.renderCalls.filter(id => id === 'b').length >= 2,
    'B must keep rendering after promotion');
});

test('Live Touch spatial/creative processor runs once after the real base crossfade', () => {
  const host = makeHost();
  const mixer = makeMixer(host);
  const crossfadeHandle = mixer.blendHandles.trans_crossfade;
  let creativeCalls = 0;
  mixer.setLiveTouchOutputProcessor(buffer => {
    creativeCalls += 1;
    buffer[0] += 10;
  });
  mixer.prepareLiveTouchPatternSwap({
    newHandle: { id: 'b', value: 180 },
    patternName: 'pattern_b',
  });
  mixer.startLiveTouchPatternSwap();
  mixer._inactiveLiveTouchChannel.fader = 0.5;

  const output = mixer.renderAll6ch();

  assert.equal(host.blendCalls.length, 1);
  assert.equal(host.blendCalls[0].handle, crossfadeHandle, 'the compiled trans_crossfade is authoritative');
  assert.equal(host.blendCalls[0].progress, 0.5);
  assert.equal(creativeCalls, 1, 'spatial/effects stage must not run independently on A and B');
  assert.equal(output[0], 110, 'creative stage applies to the already-crossfaded base');
});

test('Live Touch transition rejection and cancellation preserve A and release prepared B', () => {
  const missingHost = makeHost();
  const missingMixer = makeMixer(missingHost);
  missingMixer.blendHandles.trans_crossfade = null;
  const rejected = { id: 'rejected', value: 180 };
  assert.throws(
    () => missingMixer.prepareLiveTouchPatternSwap({
      newHandle: rejected,
      patternName: 'pattern_b',
    }),
    /missing or failed to compile/,
  );
  assert.equal(missingMixer.getLiveTouchChannel().pattern, 'pattern_a');
  assert.ok(missingHost.destroyed.includes(rejected));

  const host = makeHost();
  const mixer = makeMixer(host);
  const cancelled = { id: 'cancelled', value: 180 };
  mixer.prepareLiveTouchPatternSwap({ newHandle: cancelled, patternName: 'pattern_b' });
  mixer.startLiveTouchPatternSwap();
  assert.equal(mixer.cancelLiveTouchPatternSwap(), true);
  assert.equal(mixer.getLiveTouchChannel().pattern, 'pattern_a');
  assert.equal(mixer.getLiveTouchPatternTransitionState(), null);
  assert.ok(host.destroyed.includes(cancelled));
});

test('Live Touch pattern API pins pending and landing truth without mutating Deck transition config', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const apiSource = fs.readFileSync(path.resolve(here, '../../lib/api_server.js'), 'utf8');
  const routePattern = new RegExp(
    "req\\.method === 'PUT' && req\\.url === '\\/layers\\/live_touch\\/pattern'"
      + "[\\s\\S]*?req\\.method === 'GET' && req\\.url === '\\/layers\\/live_touch\\/exports'",
  );
  const route = apiSource.match(routePattern);
  assert.ok(route, 'Live Touch pattern route is missing');
  assert.match(route[0], /LIVE_TOUCH_PATTERN_TRANSITION_MODE/);
  assert.match(route[0], /LIVE_TOUCH_PATTERN_TRANSITION_MS/);
  assert.match(route[0], /status: retained \? 'transitioning' : 'ok'/);
  assert.match(route[0], /targetPattern: retained \? retained\.incoming\.pattern : channel\.pattern/);
  assert.match(route[0], /res\.writeHead\(retained \? 202 : 200/);
  assert.doesNotMatch(route[0], /deckTransitionConfig|\/deck\/transition-config/);
  assert.match(apiSource, /patternTransition: mixer\.getLiveTouchPatternTransitionState/);
  assert.match(apiSource, /sessionRevision: liveTouchSession/);
});
