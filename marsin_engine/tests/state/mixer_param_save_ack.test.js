import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { WebSocket } from 'ws';

import { createEngineHarness } from '../helpers/spawn_engine.mjs';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'marsin-mixer-param-config-'));
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.yaml');
const testConfig = yaml.load(fs.readFileSync(path.resolve(TEST_DIR, '../../config.yaml'), 'utf8'));
testConfig.osc = { ...testConfig.osc, enabled: false };
testConfig.fire_sync = { ...testConfig.fire_sync, enabled: false };
fs.writeFileSync(CONFIG_FILE, yaml.dump(testConfig));

const h = createEngineHarness({
  scene: 'summer_camp_dome',
  pattern: '13_sparkle',
  prefix: 'marsin-mixer-param-save',
  portBase: 17910,
  portSpan: 40,
  extraEnv: { MARSIN_CONFIG_FILE: CONFIG_FILE },
  extraArgs: ['--dest', '192.0.2.9'],
});

const MIXER_FILE = () => path.join(h.stateDir, 'mixer_state.yaml');
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function mixerChannel(channelId) {
  const response = await h.api('GET', '/mixer');
  assert.equal(response.status, 200);
  return (response.data.channels || []).find(channel => channel.id === channelId) || null;
}

function awaitChannelSaveEvent(channelId, action, timeoutMs = 1400) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${h.port}/ws/control`);
    let settled = false;
    let actionPromise = Promise.resolve();
    const finish = async (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ws.close();
      try {
        await actionPromise;
        resolve(value);
      } catch (error) {
        reject(error);
      }
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    ws.on('open', () => {
      actionPromise = Promise.resolve(action());
      actionPromise.catch((error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        ws.close();
        reject(error);
      });
    });
    ws.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.channelId === channelId
          && (message.type === 'channelParamsSaved'
            || message.type === 'channelParamsSaveFailed')) {
        finish(message);
      }
    });
    ws.on('error', (error) => {
      if (!settled) {
        clearTimeout(timer);
        reject(error);
      }
    });
  });
}

test('mixer local parameter save is acknowledged, persisted, restored, and gated', async (t) => {
  t.after(async () => {
    await h.teardown();
    fs.rmSync(CONFIG_DIR, { recursive: true, force: true });
  });
  h.spawnEngine();
  await h.waitForReady();

  const created = await h.api('POST', '/mixer/channels', {
    pattern: '13_sparkle',
    name: 'SaveAckLayer',
    mode: 'blend_screen',
    fader: 0.5,
  });
  assert.equal(created.status, 200);
  const channelId = created.data.channelId;
  assert.ok(channelId);

  const channel = await mixerChannel(channelId);
  const slider = channel.exports.find(item => item.name?.startsWith('slider') && !item.cpcOwned);
  assert.ok(slider, 'test pattern exposes a channel-local slider');

  let writeResponse;
  const savedEvent = await awaitChannelSaveEvent(channelId, async () => {
    writeResponse = await h.api(
      'POST',
      `/mixer/channels/${channelId}/control`,
      { id: slider.id, v0: 0.613, v1: 0, v2: 0 },
    );
  });
  assert.equal(writeResponse.status, 200);
  assert.equal(writeResponse.data.saved, true);
  assert.equal(writeResponse.data.persistence, 'saved');
  assert.deepEqual(savedEvent, { type: 'channelParamsSaved', channelId });

  const persisted = yaml.load(fs.readFileSync(MIXER_FILE(), 'utf8'));
  const savedChannel = persisted.channels.find(item => item.id === channelId);
  assert.equal(savedChannel.localControls[String(slider.id)].v0, 0.613);

  await h.teardown();
  await sleep(600);
  h.spawnEngine();
  await h.waitForReady();

  const restored = await mixerChannel(channelId);
  assert.ok(restored, 'saved mixer channel is restored after restart');
  const restoredSlider = restored.exports.find(item => item.id === slider.id);
  assert.ok(Math.abs(restoredSlider.v0 - 0.613) < 1e-6,
    `restored slider must retain 0.613, got ${restoredSlider.v0}`);

  const beforeRejectedWrite = fs.readFileSync(MIXER_FILE());
  let rejectedResponse;
  const rejectedEvent = await awaitChannelSaveEvent(channelId, async () => {
    rejectedResponse = await h.api(
      'POST',
      `/mixer/channels/${channelId}/control`,
      { id: 2147483647, v0: 0.2, v1: 0, v2: 0 },
    );
  });
  assert.equal(rejectedResponse.status, 400);
  assert.equal(rejectedEvent, null, 'a rejected control write emits no persistence event');
  assert.ok(fs.readFileSync(MIXER_FILE()).equals(beforeRejectedWrite),
    'a rejected control write does not mutate mixer_state.yaml');

  const off = await h.api('POST', '/settings', { autoSave: false });
  assert.equal(off.status, 200);
  const beforeSuppressedWrite = fs.readFileSync(MIXER_FILE());
  let suppressedResponse;
  const suppressedEvent = await awaitChannelSaveEvent(channelId, async () => {
    suppressedResponse = await h.api(
      'POST',
      `/mixer/channels/${channelId}/control`,
      { id: slider.id, v0: 0.829, v1: 0, v2: 0 },
    );
  });
  assert.equal(suppressedResponse.status, 200);
  assert.equal(suppressedResponse.data.saved, false);
  assert.equal(suppressedResponse.data.persistence, 'suppressed');
  assert.equal(suppressedEvent, null, 'suppressed persistence emits no saved/failure event');
  assert.ok(fs.readFileSync(MIXER_FILE()).equals(beforeSuppressedWrite),
    'mixer_state.yaml remains byte-identical while persistence is suppressed');
});
