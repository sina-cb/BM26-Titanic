// Unit + behavior tests for lib/bike_color_share.js — the engine-side feature
// that discovers MarsinLED bike controllers on the LAN and pushes the live
// palette to them under a firmware-held lease, so a bike wins its own colors
// back automatically the moment the engine stops pushing.
//
// Every scenario runs in-process against a real HTTP mock (tests/helpers/
// mock_bike_server.mjs), never a real bike, with tiny real cadences so the
// suite stays fast — there are no fake timers in this repo.
//
// Run:  cd marsin_engine && node --test tests/io/bike_color_share.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import {
  BikeColorShare,
  BIKE_STATES,
  BIKE_COLOR_CHANGE_DEBOUNCE_MS,
  BIKE_COLOR_CHANGE_MIN_GAP_MS,
  BIKE_COLOR_PUSH_INTERVAL_MS,
  DEFAULT_BIKE_COLOR_SHARE_CONFIG,
  expandTargets,
  validateBikeColorShareConfig,
} from '../../lib/bike_color_share.js';
import { createMockBike } from '../helpers/mock_bike_server.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Borrow a free TCP port, then release it — a "nobody's listening here" target. */
async function freeTcpPort() {
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

/** A fixed, mutable palette a test can swap mid-run to prove push freshness. */
function makePaletteHolder() {
  const palette = {
    color1: { h: 0.1, s: 0.5, v: 0.5 },
    color2: { h: 0.6, s: 0.5, v: 0.5 },
  };
  return { palette, getPalette: () => palette };
}

/** A short-cadence, valid config for behavior tests — never the DEFAULT's
 * production-scale intervals, which would make every test minutes long. */
function fastConfig(overrides = {}) {
  return {
    enabled: true,
    targets: '',
    port: 80,
    scanIntervalMs: 5000,
    probeTimeoutMs: 400,
    probeStaggerMs: 0,
    pushIntervalMs: BIKE_COLOR_PUSH_INTERVAL_MS,
    pushTimeoutMs: 400,
    staleAfterFailures: 2,
    goneAfterMs: 5000,
    dropAfterMs: 10000,
    ...overrides,
  };
}

// ── 1) disabled by default ──────────────────────────────────────────────────

test('disabled by default: start() never scans, and snapshot reports empty', async () => {
  const mock = await createMockBike({ persona: 'healthy' });
  // DEFAULT_BIKE_COLOR_SHARE_CONFIG mandates enabled:false; only scanIntervalMs
  // is shortened here so "3x scanIntervalMs" is a real-world-fast sleep — the
  // literal default (15000ms) would make this single assertion take 45s.
  const config = {
    ...DEFAULT_BIKE_COLOR_SHARE_CONFIG,
    targets: `127.0.0.1:${mock.port}`,
    scanIntervalMs: 100,
  };
  const share = new BikeColorShare({ config, getPalette: () => ({
    color1: { h: 0, s: 0, v: 0 }, color2: { h: 0, s: 0, v: 0 },
  }) });
  try {
    assert.equal(share.isEnabled(), false);
    share.start();
    await sleep(300); // 3x scanIntervalMs
    const st = mock.state();
    assert.deepEqual(st.requests, { status: 0, colorsGet: 0, colorsPost: 0 },
      'a disabled share must never touch the wire');
    const snap = share.snapshot();
    assert.equal(snap.enabled, false);
    assert.deepEqual(snap.bikes, []);
  } finally {
    share.stop();
    await mock.close();
  }
});

// ── 2) discovery finds only real bikes ──────────────────────────────────────

test('sweepOnce discovers only real bikes: wrong-device and dead ports are ignored', async () => {
  const healthy = await createMockBike({ controllerId: 'bike-real-1', persona: 'healthy' });
  const wrong = await createMockBike({ persona: 'wrong_device' });
  const deadPort = await freeTcpPort();
  const targets = [
    `127.0.0.1:${healthy.port}`,
    `127.0.0.1:${wrong.port}`,
    `127.0.0.1:${deadPort}`,
  ].join(',');
  const { getPalette } = makePaletteHolder();
  const share = new BikeColorShare({ config: fastConfig({ targets }), getPalette });
  try {
    await share.sweepOnce();
    const snap = share.snapshot();
    assert.equal(snap.bikes.length, 1, `expected exactly one real bike, got: ${JSON.stringify(snap.bikes)}`);
    assert.equal(snap.bikes[0].controllerId, 'bike-real-1');
    assert.equal(snap.bikes[0].state, BIKE_STATES.LINKED);
  } finally {
    share.stop();
    await healthy.close();
    await wrong.close();
  }
});

// ── 3) identity is controllerId, not address ────────────────────────────────

test('a swapped bike relinks under its new id; the old record goes STALE, GONE, then drops', async () => {
  const mock = await createMockBike({ controllerId: 'bike-a', persona: 'healthy' });
  const targets = `127.0.0.1:${mock.port}`;
  const { getPalette } = makePaletteHolder();
  const share = new BikeColorShare({
    config: fastConfig({ targets, goneAfterMs: 150, dropAfterMs: 300 }),
    getPalette,
  });
  try {
    await share.sweepOnce();
    let snap = share.snapshot();
    assert.equal(snap.bikes.find((b) => b.controllerId === 'bike-a')?.state, BIKE_STATES.LINKED);

    mock.setControllerId('bike-b');
    await share.sweepOnce();
    snap = share.snapshot();
    const a1 = snap.bikes.find((b) => b.controllerId === 'bike-a');
    const b1 = snap.bikes.find((b) => b.controllerId === 'bike-b');
    assert.ok(b1, 'the new identity is discovered at the same address');
    assert.equal(b1.state, BIKE_STATES.LINKED, 'the new identity auto-relinks');
    assert.equal(b1.address, a1.address, 'same physical address, different identity');
    assert.equal(a1.state, BIKE_STATES.STALE, 'the old identity is bumped by the address conflict');

    await sleep(200); // > goneAfterMs since bike-a's lastSeenMs
    await share.sweepOnce();
    snap = share.snapshot();
    assert.equal(snap.bikes.find((b) => b.controllerId === 'bike-a')?.state, BIKE_STATES.GONE);

    await sleep(200); // cumulative > dropAfterMs since bike-a's lastSeenMs
    await share.sweepOnce();
    snap = share.snapshot();
    assert.equal(snap.bikes.some((b) => b.controllerId === 'bike-a'), false,
      'a GONE record past dropAfterMs is removed from the registry entirely');
  } finally {
    share.stop();
    await mock.close();
  }
});

// ── 4) UNSUPPORTED firmware is discovered but never pushed to ──────────────

test('old firmware is discovered as UNSUPPORTED and never receives a push', async () => {
  const mock = await createMockBike({ controllerId: 'bike-old', persona: 'old_firmware' });
  const targets = `127.0.0.1:${mock.port}`;
  const { getPalette } = makePaletteHolder();
  const share = new BikeColorShare({ config: fastConfig({ targets }), getPalette });
  try {
    await share.sweepOnce();
    let snap = share.snapshot();
    const rec = snap.bikes.find((b) => b.controllerId === 'bike-old');
    assert.ok(rec, 'old firmware still shows up in the registry');
    assert.equal(rec.state, BIKE_STATES.UNSUPPORTED);

    await share.pushOnce();
    assert.equal(mock.state().requests.colorsPost, 0, 'UNSUPPORTED bikes are never pushed to');

    await share.sweepOnce();
    snap = share.snapshot();
    assert.equal(snap.bikes.find((b) => b.controllerId === 'bike-old').state, BIKE_STATES.UNSUPPORTED,
      'a 404-on-colors bike never promotes to LINKED');
  } finally {
    share.stop();
    await mock.close();
  }
});

// ── 5) STALE after repeated push failures, auto-relink on return ───────────

test('a bike that goes dark turns STALE after repeated push failures, then auto-relinks', async () => {
  let mock = await createMockBike({ controllerId: 'bike-flaky', persona: 'healthy' });
  const recordedPort = mock.port;
  const targets = `127.0.0.1:${recordedPort}`;
  const { getPalette } = makePaletteHolder();
  const share = new BikeColorShare({
    config: fastConfig({ targets, staleAfterFailures: 2 }),
    getPalette,
  });
  try {
    await share.sweepOnce();
    assert.equal(share.snapshot().bikes[0].state, BIKE_STATES.LINKED);

    await mock.close();
    await share.pushOnce();
    await share.pushOnce();
    let snap = share.snapshot();
    let rec = snap.bikes.find((b) => b.controllerId === 'bike-flaky');
    assert.equal(rec.state, BIKE_STATES.STALE);
    assert.ok(rec.pushStats.consecutiveFailures >= 2,
      `expected consecutiveFailures >= 2, got ${rec.pushStats.consecutiveFailures}`);

    // Rebind the SAME port with the SAME identity — a real bike coming back.
    mock = await createMockBike({ controllerId: 'bike-flaky', persona: 'healthy', port: recordedPort });
    await share.sweepOnce();
    snap = share.snapshot();
    rec = snap.bikes.find((b) => b.controllerId === 'bike-flaky');
    assert.equal(rec.state, BIKE_STATES.LINKED, 'the returning bike auto-relinks');
    assert.equal(rec.pushStats.consecutiveFailures, 0, 'the failure streak resets on relink');
  } finally {
    share.stop();
    await mock.close();
  }
});

// ── 6) lease keepalive cadence ──────────────────────────────────────────────

test('repeated keepalives renew the engine lease; stopping lets it lapse and restore', async () => {
  const initialColors = { color1: [0.1, 0.2, 0.3], color2: [0.4, 0.5, 0.6] };
  const mock = await createMockBike({
    controllerId: 'bike-lease', persona: 'healthy', leaseMs: 450, initialColors,
  });
  const targets = `127.0.0.1:${mock.port}`;
  const { getPalette } = makePaletteHolder();
  const share = new BikeColorShare({
    config: fastConfig({ targets, staleAfterFailures: 5 }),
    getPalette,
  });
  try {
    await share.sweepOnce();
    await share.pushOnce();
    await sleep(150);
    await share.pushOnce();
    await sleep(150);
    await share.pushOnce();
    const st1 = mock.state();
    assert.equal(st1.leased, true);
    assert.equal(st1.source, 'engine');
    assert.equal(st1.restoredCount, 0, 'the push cadence must never let the lease lapse');
    assert.ok(st1.lastPostBody, 'the mock recorded an engine POST');
    assert.equal(st1.lastPostBody.engine, true);
    for (const key of ['color1', 'color2']) {
      const arr = st1.lastPostBody[key];
      assert.ok(Array.isArray(arr) && arr.length === 3, `${key} is an [h,s,v] triple`);
      for (const n of arr) assert.ok(typeof n === 'number' && n >= 0 && n <= 1, `${key} values are floats in 0..1`);
    }

    share.stop();
    await sleep(600); // > leaseMs past the last push, nothing renews it now
    const st2 = mock.state();
    assert.equal(st2.restoredCount, 1, 'the lease lapses exactly once after stop()');
    assert.equal(st2.leased, false);
    assert.equal(st2.source, 'local');
    assert.deepEqual(st2.colors.color1, initialColors.color1, 'restored to the pre-engine snapshot');
    assert.deepEqual(st2.colors.color2, initialColors.color2);
  } finally {
    share.stop();
    await mock.close();
  }
});

// ── 7) push carries the CURRENT palette every cycle ─────────────────────────

test('each push cycle reads the palette fresh', async () => {
  const mock = await createMockBike({ controllerId: 'bike-pal', persona: 'healthy' });
  const targets = `127.0.0.1:${mock.port}`;
  const { palette, getPalette } = makePaletteHolder();
  const share = new BikeColorShare({ config: fastConfig({ targets }), getPalette });
  try {
    await share.sweepOnce();
    await share.pushOnce();
    let body = mock.state().lastPostBody;
    assert.deepEqual(body.color1, [palette.color1.h, palette.color1.s, palette.color1.v]);
    assert.deepEqual(body.color2, [palette.color2.h, palette.color2.s, palette.color2.v]);

    palette.color1 = { h: 0.2, s: 0.8, v: 0.9 };
    palette.color2 = { h: 0.9, s: 0.2, v: 0.1 };
    await share.pushOnce();
    body = mock.state().lastPostBody;
    assert.deepEqual(body.color1, [0.2, 0.8, 0.9]);
    assert.deepEqual(body.color2, [0.9, 0.2, 0.1]);
  } finally {
    share.stop();
    await mock.close();
  }
});

test('rapid palette notifications coalesce to one prompt newest-value push', async () => {
  const mocks = await Promise.all(Array.from({ length: 2 }, (_, i) => createMockBike({
    controllerId: `bike-coalesce-${i}`, persona: 'healthy',
  })));
  const targets = mocks.map((mock) => `127.0.0.1:${mock.port}`).join(',');
  const { palette, getPalette } = makePaletteHolder();
  const share = new BikeColorShare({ config: fastConfig({ targets }), getPalette });
  try {
    await share.sweepOnce();
    const startedMs = Date.now();
    for (let i = 0; i < 80; i++) {
      palette.color1 = { h: i / 100, s: 0.8, v: 0.9 };
      palette.color2 = { h: 1 - (i / 100), s: 0.7, v: 0.6 };
      share.notifyPaletteChanged();
    }
    await sleep(BIKE_COLOR_CHANGE_DEBOUNCE_MS + 300);
    assert.ok(Date.now() - startedMs < BIKE_COLOR_CHANGE_MIN_GAP_MS,
      'the first change-driven push should not wait for the one-second sustained-activity limit');
    for (const mock of mocks) {
      assert.equal(mock.state().requests.colorsPost, 1);
      assert.deepEqual(mock.state().lastPostBody.color1, [0.79, 0.8, 0.9]);
      assert.deepEqual(mock.state().lastPostBody.color2, [0.20999999999999996, 0.7, 0.6]);
    }
    const stats = share.snapshot().stats;
    assert.equal(stats.paletteChangeNotifications, 80);
    assert.equal(stats.paletteChangeNotificationsCoalesced, 79);
    assert.equal(stats.changePushCycles, 1);
  } finally {
    share.stop();
    await Promise.all(mocks.map((mock) => mock.close()));
  }
});

test('sustained color-wheel activity is rate-limited and still delivers the trailing value', async () => {
  const mock = await createMockBike({ controllerId: 'bike-rate-limit', persona: 'healthy' });
  const targets = `127.0.0.1:${mock.port}`;
  const { palette, getPalette } = makePaletteHolder();
  const postStartedAt = [];
  const trackedFetch = async (url, options) => {
    if (options?.method === 'POST') postStartedAt.push(Date.now());
    return fetch(url, options);
  };
  const share = new BikeColorShare({
    config: fastConfig({ targets }), getPalette, fetchImpl: trackedFetch,
  });
  try {
    await share.sweepOnce();
    for (let i = 0; i < 65; i++) {
      palette.color1 = { h: i / 100, s: 0.9, v: 0.8 };
      share.notifyPaletteChanged();
      await sleep(20);
    }
    await sleep(BIKE_COLOR_CHANGE_MIN_GAP_MS + 300);
    assert.ok(postStartedAt.length >= 2 && postStartedAt.length <= 3,
      `expected 2..3 coalesced pushes, got ${postStartedAt.length}`);
    for (let i = 1; i < postStartedAt.length; i++) {
      assert.ok(postStartedAt[i] - postStartedAt[i - 1] >= BIKE_COLOR_CHANGE_MIN_GAP_MS - 80,
        `change pushes were only ${postStartedAt[i] - postStartedAt[i - 1]} ms apart`);
    }
    assert.deepEqual(mock.state().lastPostBody.color1, [0.64, 0.9, 0.8],
      'the trailing cycle carries the newest value, never an intermediate slider sample');
  } finally {
    share.stop();
    await mock.close();
  }
});

test('high target count stays sequential under a burst', async () => {
  const targetCount = 64;
  const mocks = await Promise.all(Array.from({ length: targetCount }, (_, i) => createMockBike({
    controllerId: `bike-scale-${i}`, persona: 'healthy',
  })));
  const targets = mocks.map((mock) => `127.0.0.1:${mock.port}`).join(',');
  const { palette, getPalette } = makePaletteHolder();
  let activePosts = 0;
  let maxConcurrentPosts = 0;
  const trackedFetch = async (url, options) => {
    if (options?.method !== 'POST') return fetch(url, options);
    activePosts++;
    maxConcurrentPosts = Math.max(maxConcurrentPosts, activePosts);
    try { return await fetch(url, options); } finally { activePosts--; }
  };
  const share = new BikeColorShare({
    config: fastConfig({ targets }), getPalette, fetchImpl: trackedFetch,
  });
  try {
    await share.sweepOnce();
    for (let i = 0; i < 100; i++) {
      palette.color2 = { h: i / 200, s: 0.75, v: 0.65 };
      share.notifyPaletteChanged();
    }
    const deadlineMs = Date.now() + 4000;
    while (mocks.some((mock) => mock.state().requests.colorsPost < 1) && Date.now() < deadlineMs) {
      await sleep(25);
    }
    assert.equal(maxConcurrentPosts, 1, 'even 64 targets are pushed sequentially, never as a parallel flood');
    assert.equal(mocks.reduce((sum, mock) => sum + mock.state().requests.colorsPost, 0), targetCount,
      'one burst produces exactly one request per linked target');
    assert.equal(share.snapshot().stats.changePushCycles, 1);
  } finally {
    share.stop();
    await Promise.all(mocks.map((mock) => mock.close()));
  }
});

// ── 8) push cycle never blocks the render loop ──────────────────────────────

test('a push cycle over slow bikes never stalls the event loop', async () => {
  const delayMs = 900;
  const mocks = await Promise.all(
    Array.from({ length: 4 }, (_, i) => createMockBike({
      controllerId: `bike-slow-${i}`, persona: 'slow', delayMs,
    })),
  );
  const targets = mocks.map((m) => `127.0.0.1:${m.port}`).join(',');
  const { getPalette } = makePaletteHolder();
  const share = new BikeColorShare({
    config: fastConfig({
      targets,
      // Long enough to observe the slow bikes' real 900ms responses during
      // discovery; short enough that PUSH requests reliably time out fast
      // (see pushTimeoutMs below) rather than waiting out the full delay.
      probeTimeoutMs: 1300,
      pushTimeoutMs: 250,
      staleAfterFailures: 20,
      goneAfterMs: 60000,
      dropAfterMs: 600000,
    }),
    getPalette,
  });
  try {
    await share.sweepOnce();
    assert.equal(
      share.snapshot().bikes.filter((b) => b.state === BIKE_STATES.LINKED).length,
      4,
      'all four slow bikes should still be discoverable within the generous probe timeout',
    );

    const pushPromise = share.pushOnce();
    const gaps = [];
    let last = Date.now();
    const frameTimer = setInterval(() => {
      const now = Date.now();
      gaps.push(now - last);
      last = now;
    }, 25);
    await pushPromise;
    clearInterval(frameTimer);

    const maxGap = Math.max(...gaps);
    assert.ok(maxGap < 250,
      `render-loop tick gapped ${maxGap}ms — a synchronously-blocking push implementation ` +
      'would gap by (roughly) the full push-cycle wall time, not milliseconds');
    assert.equal(share.snapshot().stats.pushCycles, 1);
  } finally {
    share.stop();
    await Promise.all(mocks.map((m) => m.close()));
  }
});

// ── 9) validation throws, naming the offending field ────────────────────────

test('validateBikeColorShareConfig throws on invalid input, naming the field', () => {
  assert.throws(
    () => validateBikeColorShareConfig({ ...DEFAULT_BIKE_COLOR_SHARE_CONFIG, enabled: 'yes' }),
    /enabled/,
  );
  assert.throws(
    () => validateBikeColorShareConfig({ ...DEFAULT_BIKE_COLOR_SHARE_CONFIG, enabled: true, targets: '' }),
    /targets/,
  );
  assert.throws(
    () => validateBikeColorShareConfig({
      ...DEFAULT_BIKE_COLOR_SHARE_CONFIG, enabled: true, targets: '127.0.0.1', pushIntervalMs: 60000,
    }),
    /pushIntervalMs/,
  );
  assert.throws(
    () => validateBikeColorShareConfig({ ...DEFAULT_BIKE_COLOR_SHARE_CONFIG, pushIntervalMs: 5 }),
    /pushIntervalMs/,
  );
  assert.throws(
    () => validateBikeColorShareConfig({ ...DEFAULT_BIKE_COLOR_SHARE_CONFIG, pushIntervalMs: 30000 }),
    /fixed at 10000 ms/,
  );
  assert.equal(
    validateBikeColorShareConfig(DEFAULT_BIKE_COLOR_SHARE_CONFIG).pushIntervalMs,
    BIKE_COLOR_PUSH_INTERVAL_MS,
  );
  assert.throws(
    () => validateBikeColorShareConfig({ ...DEFAULT_BIKE_COLOR_SHARE_CONFIG, notAField: true }),
    /notAField/,
  );
  assert.throws(
    () => validateBikeColorShareConfig({ ...DEFAULT_BIKE_COLOR_SHARE_CONFIG, staleAfterFailures: 0 }),
    /staleAfterFailures/,
  );
  assert.throws(
    () => validateBikeColorShareConfig({ ...DEFAULT_BIKE_COLOR_SHARE_CONFIG, staleAfterFailures: 1.5 }),
    /staleAfterFailures/,
  );
  assert.throws(
    () => validateBikeColorShareConfig({ ...DEFAULT_BIKE_COLOR_SHARE_CONFIG, scanIntervalMs: -1 }),
    /scanIntervalMs/,
  );
  assert.throws(
    () => validateBikeColorShareConfig({ ...DEFAULT_BIKE_COLOR_SHARE_CONFIG, probeTimeoutMs: Infinity }),
    /probeTimeoutMs/,
  );
});

test('loadConfig migrates a formerly-valid stored cadence to the fixed 10 s contract', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bike-color-cadence-migration-'));
  const configFile = path.join(dir, 'config.yaml');
  fs.writeFileSync(configFile, [
    'bike_color_share:',
    '  enabled: false',
    '  targets: ""',
    '  pushIntervalMs: 30000',
    '',
  ].join('\n'));
  const warnings = [];
  const share = new BikeColorShare({
    configFile,
    getPalette: () => ({
      color1: { h: 0, s: 0, v: 0 },
      color2: { h: 0, s: 0, v: 0 },
    }),
    logger: { log() {}, warn: (message) => warnings.push(message), error() {} },
  });
  try {
    assert.equal(share.getConfig().pushIntervalMs, BIKE_COLOR_PUSH_INTERVAL_MS);
    assert.match(warnings.join('\n'), /migrating stored pushIntervalMs=30000/);
  } finally {
    share.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('expandTargets throws once the expansion exceeds 256 entries, holds at exactly 256', () => {
  // 257 distinct host:port pairs (same host, differing ports) via a comma
  // list — a single last-octet range tops out at 256 by construction, so the
  // >256 guard is only reachable this way.
  const over = Array.from({ length: 257 }, (_, i) => `192.0.2.1:${8000 + i}`).join(',');
  assert.throws(() => expandTargets(over, 80), /256/);

  const exactly256 = Array.from({ length: 256 }, (_, i) => `192.0.2.1:${9000 + i}`).join(',');
  assert.doesNotThrow(() => expandTargets(exactly256, 80));

  assert.throws(() => expandTargets('not-an-ip', 80));
  assert.throws(() => expandTargets('192.0.2.1:notaport', 80));
  assert.throws(() => expandTargets('192.0.2.1-not-a-range-end', 80));
});

test('expandTargets parses bare hosts, explicit ports, and both last-octet range forms', () => {
  assert.deepEqual(expandTargets('192.0.2.5', 80), [{ host: '192.0.2.5', port: 80, address: '192.0.2.5:80' }]);
  assert.deepEqual(
    expandTargets('192.0.2.5:8080', 80),
    [{ host: '192.0.2.5', port: 8080, address: '192.0.2.5:8080' }],
  );
  const range = expandTargets('192.0.2.1-192.0.2.3', 80);
  assert.deepEqual(range.map((t) => t.address), ['192.0.2.1:80', '192.0.2.2:80', '192.0.2.3:80']);
  const bracketRange = expandTargets('192.0.2.[4...6]', 80);
  assert.deepEqual(
    bracketRange.map((t) => t.address),
    ['192.0.2.4:80', '192.0.2.5:80', '192.0.2.6:80'],
  );
  const bracketRangeWithPort = expandTargets('192.0.2.[7...8]:8080', 80);
  assert.deepEqual(
    bracketRangeWithPort.map((t) => t.address),
    ['192.0.2.7:8080', '192.0.2.8:8080'],
  );
  // Duplicate entries collapse to one.
  assert.deepEqual(
    expandTargets('192.0.2.5,192.0.2.5', 80),
    [{ host: '192.0.2.5', port: 80, address: '192.0.2.5:80' }],
  );
});

test('expandTargets rejects malformed or descending bracket ranges', () => {
  assert.throws(() => expandTargets('192.0.2.[9..10]', 80), /valid IPv4|targets/);
  assert.throws(() => expandTargets('192.0.2.[10...9]', 80), /end is before start/);
  assert.throws(() => expandTargets('192.0.2.[0...256]', 80), /octet out of range/);
  assert.throws(() => expandTargets('192.0.2.[1...2]:0', 80), /port out of range/);
});

// ── 10) snapshot() matches the documented REST shape ────────────────────────

test('snapshot() matches the documented shape exactly', async () => {
  const mock = await createMockBike({ controllerId: 'bike-shape', persona: 'healthy' });
  const targets = `127.0.0.1:${mock.port}`;
  const { getPalette } = makePaletteHolder();
  const share = new BikeColorShare({ config: fastConfig({ targets }), getPalette });
  try {
    await share.sweepOnce();
    await share.pushOnce();
    const snap = share.snapshot();
    assert.deepEqual(new Set(Object.keys(snap)), new Set(['enabled', 'config', 'stats', 'bikes']));
    assert.deepEqual(
      new Set(Object.keys(snap.stats)),
      new Set([
        'sweeps', 'pushCycles', 'changePushCycles', 'pushCycleOverruns', 'pushesOk', 'pushesFailed',
        'paletteErrors', 'paletteChangeNotifications', 'paletteChangeNotificationsCoalesced',
      ]),
    );
    assert.equal(snap.bikes.length, 1);
    const row = snap.bikes[0];
    assert.deepEqual(
      new Set(Object.keys(row)),
      new Set([
        'controllerId', 'address', 'ip', 'port', 'state', 'firmwareTag',
        'activePattern', 'mac', 'lastSeenMs', 'leaseMsRemaining', 'pushStats',
      ]),
    );
    assert.deepEqual(
      new Set(Object.keys(row.pushStats)),
      new Set(['ok', 'failed', 'consecutiveFailures', 'lastPushMs']),
    );
  } finally {
    share.stop();
    await mock.close();
  }
});

// ── palette read failure: loud, counted, cycle skipped ──────────────────────

test('an invalid palette is a loud, counted, skipped push cycle — never a thrown crash', async () => {
  const mock = await createMockBike({ controllerId: 'bike-badpal', persona: 'healthy' });
  const targets = `127.0.0.1:${mock.port}`;
  const share = new BikeColorShare({
    config: fastConfig({ targets }),
    getPalette: () => { throw new Error('palette source unavailable'); },
  });
  try {
    await share.sweepOnce();
    await assert.doesNotReject(() => share.pushOnce());
    assert.equal(mock.state().requests.colorsPost, 0, 'no push is attempted on an invalid palette');
    assert.ok(share.snapshot().stats.paletteErrors >= 1);
  } finally {
    share.stop();
    await mock.close();
  }
});
