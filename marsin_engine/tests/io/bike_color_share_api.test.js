// e2e coverage for the bike-color-share REST surface (GET /bikes, POST
// /bikes/config) wired into a REAL spawned engine.js subprocess.
//
// Drives the engine over real HTTP, with a real (loopback, ephemeral-port)
// mock bike controller on the other end, to prove: disabled-by-default at
// the engine level, the enable → discover → link → engine-flagged push
// round trip, disabling stops all traffic, the feature block persists to its
// OWN runtime file (never rewriting the tracked config.yaml), and a bad
// config is rejected with a 400 naming the field.
//
// Run:  cd marsin_engine && node --test tests/io/bike_color_share_api.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import yaml from 'js-yaml';

import { writeBlackHoledConfig } from '../e2e/timeline_e2e_harness.mjs';
import { createEngineHarness } from '../helpers/spawn_engine.mjs';
import { createMockBike } from '../helpers/mock_bike_server.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, timeoutMs = 8000, intervalMs = 150) {
  const t0 = Date.now();
  let lastErr = null;
  while (Date.now() - t0 < timeoutMs) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (err) { lastErr = err; }
    await sleep(intervalMs);
  }
  throw new Error(`waitFor timeout${lastErr ? `: last error ${lastErr.message}` : ''}`);
}

function makeHarness() {
  // A scratch dir the engine's config.yaml, and the feature's own runtime
  // persistence file, both live in — never the tracked repo tree.
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bike-color-share-api-config-'));
  const configFile = writeBlackHoledConfig(configDir);
  const baselineConfigText = fs.readFileSync(configFile, 'utf8');

  const h = createEngineHarness({
    scene: 'test_bench',
    pattern: '13_sparkle',
    prefix: 'bike-color-share-api',
    portBase: 17560,
    portSpan: 40,
    extraEnv: { MARSIN_CONFIG_FILE: configFile, MARSIN_VSN1_DEPLOY: '0' },
    // TEST-NET-1 (RFC 5737) black hole — loopback is not one.
    extraArgs: ['--dest', '192.0.2.9'],
  });

  return { ...h, configFile, configDir, baselineConfigText };
}

test('GET /bikes is disabled-by-default with an empty registry, and no scanning happens', async () => {
  const h = makeHarness();
  const mock = await createMockBike({ controllerId: 'bike-e2e-idle', persona: 'healthy' });
  try {
    h.spawnEngine();
    await h.waitForReady();

    const res = await h.api('GET', '/bikes');
    assert.equal(res.status, 200);
    assert.equal(res.data.enabled, false, 'absent config.yaml block ⇒ defaults ⇒ disabled');
    assert.deepEqual(res.data.bikes, []);

    await sleep(800);
    assert.deepEqual(mock.state().requests, { status: 0, colorsGet: 0, colorsPost: 0 },
      'a disabled feature must never probe or push, even with a bike sitting right there');
  } finally {
    await mock.close();
    await h.teardown();
  }
});

test('shared global color changes push promptly, coalesce bursts, and ignore unrelated effects', async () => {
  const h = makeHarness();
  const mock = await createMockBike({ controllerId: 'bike-e2e-link', persona: 'healthy' });
  try {
    h.spawnEngine();
    await h.waitForReady();

    const enable = await h.api('POST', '/bikes/config', {
      enabled: true,
      targets: `127.0.0.1:${mock.port}`,
      scanIntervalMs: 200,
      pushIntervalMs: 10000,
      probeTimeoutMs: 500,
      pushTimeoutMs: 500,
      probeStaggerMs: 0,
    });
    assert.equal(enable.status, 200);
    assert.equal(enable.data.ok, true);

    const linked = await waitFor(async () => {
      const res = await h.api('GET', '/bikes');
      const row = res.data.bikes?.find((b) => b.controllerId === 'bike-e2e-link');
      return row?.state === 'LINKED' ? row : null;
    });
    assert.equal(linked.controllerId, 'bike-e2e-link');
    assert.ok(linked.address.includes(String(mock.port)));
    assert.equal(linked.firmwareTag, '2.0.0-mock');
    assert.ok(linked.pushStats && typeof linked.pushStats === 'object');
    assert.ok('leaseMsRemaining' in linked);

    const firstPalette = {
      colorPalette1: { h: 0.08, s: 0.9, v: 0.8 },
      colorPalette2: { h: 0.58, s: 0.85, v: 0.75 },
    };
    const firstStartedMs = Date.now();
    const firstPaletteWrite = await h.api('POST', '/param-center', firstPalette);
    assert.equal(firstPaletteWrite.status, 200);
    await waitFor(() => mock.state().requests.colorsPost > 0, 2500, 25);
    assert.ok(Date.now() - firstStartedMs <= 2000,
      'a shared Color 1/2 change must reach the controller within the coalesced rate limit');
    const body = mock.state().lastPostBody;
    assert.equal(body.engine, true, 'the wire proves this is an engine-flagged write');
    for (const key of ['color1', 'color2']) {
      const arr = body[key];
      assert.ok(Array.isArray(arr) && arr.length === 3, `${key} is an [h,s,v] triple`);
      for (const n of arr) {
        assert.equal(typeof n, 'number');
        assert.ok(n >= 0 && n <= 1, `${key} component ${n} is a float in 0..1`);
      }
    }
    assert.deepEqual(body.color1, [0.08, 0.9, 0.8]);
    assert.deepEqual(body.color2, [0.58, 0.85, 0.75]);

    const postsAfterFirst = mock.state().requests.colorsPost;
    assert.equal((await h.api('POST', '/param-center', firstPalette)).status, 200);
    assert.equal((await h.api('POST', '/param-center', { speed: 0.73 })).status, 200);
    assert.equal((await h.api('POST', '/global-effect', { effect: 'uvBlast', state: true })).status, 200);
    assert.equal((await h.api('POST', '/global-effect', { effect: 'uvBlast', state: false })).status, 200);
    await sleep(1200);
    assert.equal(mock.state().requests.colorsPost, postsAfterFirst,
      'same-value shared writes, non-color parameters, and normal effects must not produce bike pushes');

    const burstStartedMs = Date.now();
    const postsBeforeBurst = mock.state().requests.colorsPost;
    let lastPair = null;
    for (let i = 0; i < 40; i++) {
      lastPair = {
        colorPalette1: { h: 0.2 + (i / 1000), s: 0.78, v: 0.91 },
        colorPalette2: { h: 0.8 - (i / 1000), s: 0.66, v: 0.72 },
      };
      assert.equal((await h.api('POST', '/param-center', lastPair)).status, 200);
    }
    await waitFor(() => {
      const last = mock.state().lastPostBody;
      return last?.color1?.[0] === lastPair.colorPalette1.h;
    }, 2500, 25);
    const burstPosts = mock.state().requests.colorsPost - postsBeforeBurst;
    assert.ok(burstPosts >= 1 && burstPosts <= 2,
      `40 rapid updates must coalesce to 1..2 pushes, got ${burstPosts}`);
    assert.ok(Date.now() - burstStartedMs <= 2200, 'the trailing burst value must arrive promptly');
    assert.deepEqual(mock.state().lastPostBody.color1,
      [lastPair.colorPalette1.h, lastPair.colorPalette1.s, lastPair.colorPalette1.v]);
    assert.deepEqual(mock.state().lastPostBody.color2,
      [lastPair.colorPalette2.h, lastPair.colorPalette2.s, lastPair.colorPalette2.v]);

    const bikeSnapshot = await h.api('GET', '/bikes');
    assert.ok(bikeSnapshot.data.stats.paletteChangeNotifications >= 41);
    assert.ok(bikeSnapshot.data.stats.paletteChangeNotificationsCoalesced >= 38);
  } finally {
    await mock.close();
    await h.teardown();
  }
});

test('disabling stops all scanning and pushing', async () => {
  const h = makeHarness();
  const mock = await createMockBike({ controllerId: 'bike-e2e-stop', persona: 'healthy' });
  try {
    h.spawnEngine();
    await h.waitForReady();

    await h.api('POST', '/bikes/config', {
      enabled: true,
      targets: `127.0.0.1:${mock.port}`,
      scanIntervalMs: 200,
      pushIntervalMs: 10000,
      probeTimeoutMs: 500,
      pushTimeoutMs: 500,
      probeStaggerMs: 0,
    });
    await waitFor(async () => {
      const res = await h.api('GET', '/bikes');
      return res.data.bikes?.some((b) => b.controllerId === 'bike-e2e-stop' && b.state === 'LINKED');
    });

    const disable = await h.api('POST', '/bikes/config', { enabled: false });
    assert.equal(disable.status, 200);
    assert.equal(disable.data.ok, true);

    const before = mock.state().requests;
    await sleep(700);
    const after = mock.state().requests;
    assert.deepEqual(after, before, 'no further probes or pushes after disabling');
  } finally {
    await mock.close();
    await h.teardown();
  }
});

test('the feature block persists to its own runtime file; config.yaml is never rewritten', async () => {
  const h = makeHarness();
  const mock = await createMockBike({ controllerId: 'bike-e2e-persist', persona: 'healthy' });
  try {
    h.spawnEngine();
    await h.waitForReady();

    const targets = `127.0.0.1:${mock.port}`;
    const enable = await h.api('POST', '/bikes/config', {
      enabled: true,
      targets,
      scanIntervalMs: 200,
      pushIntervalMs: 10000,
      probeTimeoutMs: 500,
      pushTimeoutMs: 500,
      probeStaggerMs: 0,
    });
    assert.equal(enable.status, 200);

    // Give the persistence write a moment to land on disk.
    const runtimeFile = await waitFor(() => {
      const hit = fs.readdirSync(h.configDir).find((f) => f.endsWith('bike_color_share_runtime.yaml'));
      return hit ? path.join(h.configDir, hit) : null;
    });
    // The block is wrapped under its feature key, exactly like the
    // colorAutopilot runtime file (`colorAutopilot:` at top level).
    const runtimeDoc = yaml.load(fs.readFileSync(runtimeFile, 'utf8'));
    assert.ok(runtimeDoc.bike_color_share, 'runtime doc nests under the bike_color_share key');
    assert.equal(runtimeDoc.bike_color_share.enabled, true);
    assert.equal(runtimeDoc.bike_color_share.targets, targets);

    const configNow = fs.readFileSync(h.configFile, 'utf8');
    assert.equal(configNow, h.baselineConfigText,
      'saveConfig() must persist ONLY the feature block to the runtime file, ' +
      'never rewrite the tracked config.yaml');
  } finally {
    await mock.close();
    await h.teardown();
  }
});

test('an invalid config POST is rejected with a 400 naming the offending field', async () => {
  const h = makeHarness();
  try {
    h.spawnEngine();
    await h.waitForReady();

    const res = await h.api('POST', '/bikes/config', { pushIntervalMs: 60000 });
    assert.equal(res.status, 400);
    assert.ok(res.data && typeof res.data.error === 'string', 'a 400 must carry an {error} string');
    assert.match(res.data.error, /pushIntervalMs/);

    // The rejected config must not have been applied.
    const after = await h.api('GET', '/bikes');
    assert.equal(after.data.enabled, false, 'a rejected config leaves the feature disabled, as it started');
  } finally {
    await h.teardown();
  }
});

test('enabling with empty targets returns 400 and leaves the engine alive and disabled', async () => {
  const h = makeHarness();
  try {
    h.spawnEngine();
    await h.waitForReady();

    const rejected = await h.api('POST', '/bikes/config', { enabled: true });
    assert.equal(rejected.status, 400);
    assert.match(rejected.data.error, /targets must be non-empty when enabled is true/);

    const bikesAfter = await h.api('GET', '/bikes');
    assert.equal(bikesAfter.status, 200, 'the same engine still answers after the rejected request');
    assert.equal(bikesAfter.data.enabled, false);
    assert.equal(bikesAfter.data.config.targets, '');

    const statusAfter = await h.api('GET', '/status');
    assert.equal(statusAfter.status, 200, 'the engine process did not crash');
  } finally {
    await h.teardown();
  }
});
