/**
 * Offline contract tests for the gamma saved-config workflow. No controller,
 * HTTP server, backup file, or timer is used: every I/O seam is injected.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  GAMMA_MAX,
  GAMMA_MIN,
  pushGammaWithIo,
  validateGamma,
} = require('../server/led_gamma_service.cjs');

const IP = '192.0.2.65';
const BEFORE_STATUS = Object.freeze({
  controllerId: 'rope_a',
  deviceName: 'Rope-A',
  boardId: 'board-a',
  firmwareSHA: 'candidate-a',
});
const BEFORE_CONFIG = Object.freeze({
  deviceName: 'Rope-A',
  gamma: { r: 1, g: 1, b: 1, w: 1 },
  dmx: { enabled: false, protocol: 0, timeoutMs: 3000 },
  swarm: { enabled: true, leader: false },
  strands: [{ enabled: true, count: 40 }],
  wifi: { ssid: 'EXAMPLE_NETWORK' }, // gitleaks:allow -- synthetic fixture, never deployed
});

function clone(value) {
  return structuredClone(value);
}

function workflowIo(overrides = {}) {
  const calls = [];
  const io = {
    calls,
    readStatus: async () => {
      calls.push('status');
      return clone(calls.filter((call) => call === 'status').length === 1
        ? BEFORE_STATUS
        : (overrides.afterStatus || BEFORE_STATUS));
    },
    readConfig: async () => {
      calls.push('config');
      const readNumber = calls.filter((call) => call === 'config').length;
      if (readNumber === 1) return clone(overrides.beforeConfig || BEFORE_CONFIG);
      if (overrides.afterReadError) throw overrides.afterReadError;
      return clone(overrides.afterConfig || {
        ...BEFORE_CONFIG,
        gamma: overrides.target || { r: 2.2, g: 2.3, b: 2.4, w: 1 },
      });
    },
    writeBackup: (_host, _name, config) => {
      calls.push('backup');
      assert.deepEqual(config, overrides.beforeConfig || BEFORE_CONFIG);
      return 'offline-backup.json';
    },
    writeConfig: async (_host, body) => {
      calls.push('write');
      io.body = body;
      if (overrides.writeError) throw overrides.writeError;
      return overrides.writeReply || {
        status: 200,
        json: { status: 'ok', outcome: 'applied', reboot: false },
      };
    },
    sleep: async (ms) => { calls.push(`sleep:${ms}`); },
  };
  return io;
}

test('gamma workflow posts one exact partial body and verifies saved config + identity',
  async () => {
    const target = { r: GAMMA_MIN, g: 2.35, b: GAMMA_MAX, w: 1 };
    const io = workflowIo({ target });
    const result = await pushGammaWithIo(IP, target, { controllerName: 'Rope-A' }, io);

    assert.deepEqual(io.body, { gamma: target });
    assert.deepEqual(Object.keys(io.body), ['gamma']);
    assert.deepEqual(result.verified, target);
    assert.equal(result.controllerId, BEFORE_STATUS.controllerId);
    assert.equal(result.writeReplyLost, false);
    assert.deepEqual(io.calls, ['status', 'config', 'backup', 'write', 'config', 'status']);
    assert.equal(io.calls.filter((call) => call === 'write').length, 1);
  });

test('gamma schema requires four finite numeric channels at inclusive boundaries', () => {
  assert.deepEqual(validateGamma({ r: 1, g: 1.0001, b: 2.9999, w: 3 }),
    { r: 1, g: 1.0001, b: 2.9999, w: 3 });

  for (const gamma of [
    { r: '2.2', g: 2, b: 2, w: 1 },
    { r: true, g: 2, b: 2, w: 1 },
    { r: Number.NaN, g: 2, b: 2, w: 1 },
    { r: 0.9999, g: 2, b: 2, w: 1 },
    { r: 3.0001, g: 2, b: 2, w: 1 },
    { r: 2, g: 2, b: 2 },
    { r: 2, g: 2, b: 2, w: 1, global: 2 },
  ]) {
    assert.throws(() => validateGamma(gamma));
  }
});

test('float read-back noise verifies within epsilon and is rounded to four decimals', async () => {
  const target = { r: 2.2, g: 2.3, b: 2.4, w: 1 };
  const io = workflowIo({ target, afterConfig: {
    ...BEFORE_CONFIG,
    gamma: { r: 2.200000048, g: 2.299999952, b: 2.400000095, w: 1 },
  } });
  const result = await pushGammaWithIo(IP, target, {}, io);
  assert.deepEqual(result.verified, target);
});

test('saved-config gamma mismatch fails after exactly one write', async () => {
  const target = { r: 2.2, g: 2.2, b: 2.2, w: 1 };
  const io = workflowIo({ target, afterConfig: { ...BEFORE_CONFIG } });
  await assert.rejects(() => pushGammaWithIo(IP, target, {}, io),
    /saved-config read-back MISMATCH/);
  assert.equal(io.calls.filter((call) => call === 'write').length, 1);
  assert.equal(io.calls.at(-1), 'config');
});

test('lost write reply is settled by saved config without retrying the write', async () => {
  const target = { r: 2.2, g: 2.3, b: 2.4, w: 1 };
  const writeError = Object.assign(new Error('socket closed'), { kind: 'unreachable' });
  const io = workflowIo({ target, writeError });
  const result = await pushGammaWithIo(IP, target, { rebootWaitMs: 25 }, io);

  assert.equal(result.writeReplyLost, true);
  assert.equal(io.calls.filter((call) => call === 'write').length, 1);
  assert.deepEqual(io.calls,
    ['status', 'config', 'backup', 'write', 'sleep:25', 'config', 'status']);
});

test('lost write reply + mismatch stays failed and is never retried', async () => {
  const target = { r: 2.2, g: 2.2, b: 2.2, w: 1 };
  const writeError = Object.assign(new Error('timeout'), { kind: 'unreachable' });
  const io = workflowIo({ target, writeError, afterConfig: { ...BEFORE_CONFIG } });
  await assert.rejects(() => pushGammaWithIo(IP, target, { rebootWaitMs: 0 }, io),
    /write reply was lost.*MISMATCH.*not retried/);
  assert.equal(io.calls.filter((call) => call === 'write').length, 1);
});

test('gamma verification refuses mode, identity, or device-name drift', async () => {
  const target = { r: 2.2, g: 2.2, b: 2.2, w: 1 };
  const cases = [
    {
      overrides: { target, afterConfig: {
        ...BEFORE_CONFIG, gamma: target, dmx: { ...BEFORE_CONFIG.dmx, enabled: true },
      } },
      message: /changed saved dmx config/,
    },
    {
      overrides: { target, afterConfig: {
        ...BEFORE_CONFIG, gamma: target, swarm: { enabled: false, leader: false },
      } },
      message: /changed saved swarm config/,
    },
    {
      overrides: { target, afterConfig: { ...BEFORE_CONFIG, gamma: target, deviceName: 'Other' } },
      message: /changed deviceName unexpectedly/,
    },
    {
      overrides: { target, afterStatus: { ...BEFORE_STATUS, controllerId: 'rope_b' } },
      message: /controller identity changed.*controllerId/,
    },
  ];

  for (const { overrides, message } of cases) {
    const io = workflowIo(overrides);
    await assert.rejects(() => pushGammaWithIo(IP, target, {}, io), message);
    assert.equal(io.calls.filter((call) => call === 'write').length, 1);
  }
});
