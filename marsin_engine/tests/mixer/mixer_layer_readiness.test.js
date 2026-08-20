import assert from 'node:assert/strict';
import test from 'node:test';

import { PatternMixer } from '../../lib/pattern_mixer.js';

function makeMixer() {
  const wasmHost = {
    destroy() {},
    renderAll6ch() {},
  };
  return new PatternMixer({ wasmHost, pixelCount: 2, maxChannels: 4 });
}

function addChannel(mixer, id, patch = {}) {
  return mixer.addMixerChannel({
    id,
    name: id,
    pattern: 'deliberately_black_is_still_valid',
    handle: 1,
    mode: 'blend_screen',
    fader: 1,
    enabled: true,
    ...patch,
  });
}

test('empty Mixer is not ready and a configured contributor is ready', () => {
  const mixer = makeMixer();
  assert.deepEqual(mixer.getMixerReadiness(), {
    ready: false,
    contributors: [],
    channelCount: 0,
    reason: 'Mixer has no channels',
  });

  addChannel(mixer, 'live');
  assert.deepEqual(mixer.getMixerReadiness(), {
    ready: true,
    contributors: ['live'],
    channelCount: 1,
  });
});

test('readiness includes fader, cap, group, solo and selected-pixel gates', () => {
  const mixer = makeMixer();
  const channel = addChannel(mixer, 'gated', { fader: 0 });
  assert.equal(mixer.getMixerReadiness().ready, false);

  channel.fader = 1;
  channel.handle = 0;
  assert.equal(mixer.getMixerReadiness().ready, false);

  channel.handle = 1;
  channel.faderMax = 0;
  assert.equal(mixer.getMixerReadiness().ready, false);

  channel.faderMax = 1;
  channel.compiledPixelMask = new Uint8Array([0, 0]);
  assert.equal(mixer.getMixerReadiness().ready, false);

  channel.compiledPixelMask = new Uint8Array([0, 1]);
  const group = mixer.createMixGroup({ name: 'muted' });
  channel.mixGroupId = group.id;
  group.muted = true;
  assert.equal(mixer.getMixerReadiness().ready, false);

  group.muted = false;
  mixer.soloedChannelIds.add('someone_else');
  assert.equal(mixer.getMixerReadiness().ready, false);

  channel.soloSafe = true;
  assert.equal(mixer.getMixerReadiness().ready, true);
});

test('follow chains are resolved from configuration without sampling pixels', () => {
  const mixer = makeMixer();
  const leader = addChannel(mixer, 'leader', { fader: 0 });
  const follower = addChannel(mixer, 'follower', {
    fader: 1,
    followLeaderId: 'leader',
    followScale: 1,
  });
  assert.equal(mixer.getMixerReadiness().ready, false);

  leader.fader = 0.5;
  assert.deepEqual(mixer.getMixerReadiness().contributors, ['leader', 'follower']);

  leader.followLeaderId = 'follower';
  follower.followLeaderId = 'leader';
  assert.equal(mixer.getMixerReadiness().ready, false, 'a follow cycle cannot invent a level');
});
