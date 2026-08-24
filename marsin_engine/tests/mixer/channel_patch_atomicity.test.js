import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';

import { createEngineHarness } from '../helpers/spawn_engine.mjs';

const harness = createEngineHarness({
  scene: 'summer_camp_dome',
  pattern: '13_sparkle',
  prefix: 'marsin-channel-patch-atomicity',
  portBase: 33400,
  portSpan: 30,
  extraArgs: ['--dest', '192.0.2.9'],
});
const { api } = harness;

let mixerChannelId;

async function deckChannelBytes() {
  const response = await api('GET', '/deck/channel');
  assert.equal(response.status, 200);
  return JSON.stringify(response.data.channel);
}

async function mixerChannelBytes() {
  const response = await api('GET', '/mixer');
  assert.equal(response.status, 200);
  const channel = response.data.channels.find(candidate => candidate.id === mixerChannelId);
  assert.ok(channel, `mixer channel '${mixerChannelId}' must exist`);
  return JSON.stringify(channel);
}

before(async () => {
  harness.spawnEngine();
  await harness.waitForReady();
  const created = await api('POST', '/mixer/channels', { pattern: '13_sparkle' });
  assert.equal(created.status, 200);
  mixerChannelId = created.data.channelId;
  assert.ok(mixerChannelId);
});

after(async () => {
  await harness.teardown();
});

test('performance-locked deck view PATCH rejects mixed fields atomically', async () => {
  const entered = await api('POST', '/performance-mode', { active: true });
  assert.equal(entered.status, 200);
  const beforeBytes = await deckChannelBytes();

  const rejected = await api('PATCH', '/deck/channel', {
    fader: 0.15,
    name: 'must_not_commit',
    viewSelection: { type: 'all' },
  });

  assert.equal(rejected.status, 409);
  assert.equal(rejected.data.code, 'PERFORMANCE_MODE');
  assert.equal(await deckChannelBytes(), beforeBytes);

  const exited = await api('POST', '/performance-mode', {
    active: false,
    exitAction: 'keep',
  });
  assert.equal(exited.status, 200);
});

test('performance-locked mixer view PATCH rejects mixed fields atomically', async () => {
  const entered = await api('POST', '/performance-mode', { active: true });
  assert.equal(entered.status, 200);
  const beforeBytes = await mixerChannelBytes();

  const rejected = await api('PATCH', `/mixer/channels/${mixerChannelId}`, {
    fader: 0.15,
    name: 'must_not_commit',
    viewSelection: { type: 'all' },
  });

  assert.equal(rejected.status, 409);
  assert.equal(rejected.data.code, 'PERFORMANCE_MODE');
  assert.equal(await mixerChannelBytes(), beforeBytes);

  const exited = await api('POST', '/performance-mode', {
    active: false,
    exitAction: 'keep',
  });
  assert.equal(exited.status, 200);
});

test('invalid late deck field rejects mixed fields atomically', async () => {
  const beforeBytes = await deckChannelBytes();

  const rejected = await api('PATCH', '/deck/channel', {
    fader: 0.15,
    name: 'must_not_commit',
    hue: 'not-a-number',
  });

  assert.equal(rejected.status, 400);
  assert.match(rejected.data.error, /hue/);
  assert.equal(await deckChannelBytes(), beforeBytes);
});

test('invalid late mixer follow target rejects mixed fields atomically', async () => {
  const beforeBytes = await mixerChannelBytes();

  const rejected = await api('PATCH', `/mixer/channels/${mixerChannelId}`, {
    fader: 0.15,
    name: 'must_not_commit',
    followLeaderId: 'missing-channel',
  });

  assert.equal(rejected.status, 404);
  assert.equal(rejected.data.code, 'FOLLOW_LEADER_NOT_FOUND');
  assert.equal(await mixerChannelBytes(), beforeBytes);
});

test('invalid final mixer autopilot delay rejects mixed fields atomically', async () => {
  const beforeBytes = await mixerChannelBytes();

  const rejected = await api('PATCH', `/mixer/channels/${mixerChannelId}`, {
    fader: 0.15,
    name: 'must_not_commit',
    autopilot: { active: true, delay_s: 0 },
  });

  assert.equal(rejected.status, 400);
  assert.equal(rejected.data.code, 'AUTOCYCLE_BAD_DELAY');
  assert.equal(await mixerChannelBytes(), beforeBytes);
});

test('unknown mixer view mask rejects mixed fields atomically', async () => {
  const beforeBytes = await mixerChannelBytes();

  const rejected = await api('PATCH', `/mixer/channels/${mixerChannelId}`, {
    fader: 0.15,
    name: 'must_not_commit',
    viewSelection: { type: 'viewMask', target: 'definitely_missing_mask' },
  });

  assert.equal(rejected.status, 400);
  assert.match(rejected.data.error, /Unknown viewMask name/);
  assert.equal(await mixerChannelBytes(), beforeBytes);
});
