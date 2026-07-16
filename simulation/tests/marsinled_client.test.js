/**
 * marsinled_client.test.js — unit tests for the MarsinLED HTTP client
 * (discovery + read/write). Uses a STUBBED global `fetch` (node:test, no real
 * network). Covers: probe happy path + fingerprint/timeout misses, subnet scan
 * + cancellation, config read, push (happy / 400 field error / denied key /
 * §4.2 bounds), and the reboot wait.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeSubnetPrefix,
  probeDevice,
  scanSubnet,
  getStatus,
  getConfig,
  pushConfig,
  validatePushPayload,
  awaitReboot,
} from '../src/dmx/led/marsinled_client.js';

// ── Fixtures: the real titanic_201 shapes (trimmed) ─────────────────────────

const STATUS_201 = {
  ip: '10.1.1.201',
  mac: 'AA:BB:CC:DD:02:01',
  fps: 937,
  controllerId: 'titanic_201',
  boardId: 'angio4-old',
  boardType: 'angio4-old',
  firmwareSHA: 'be2fcc1b5f6f',
  firmwareTag: 'dev+dirty',
  languageVersion: 'Live',
  pixelCount: 80,
  networkMode: 'WIFI',
  strands: [
    { type: 'WS281X_RGBW', count: 40, pinData: 35, enabled: true },
    { type: 'WS281X_RGBW', count: 40, pinData: 36, enabled: true },
    { type: 'WS281X_RGBW', count: 40, pinData: 37, enabled: false },
    { type: 'WS281X_RGBW', count: 40, pinData: 38, enabled: false },
  ],
  sacn: { enabled: true, rxPackets: 39197, lastUniverse: 1, seqErrors: 0 },
  outputs: [{ index: 0, enabled: true }, { index: 1, enabled: true }],
};

const CONFIG_201 = {
  strands: [
    { type: 'WS281X_RGBW', count: 40, pinData: 35, pinClock: 0, colorOrder: 'RGBW',
      rgbwMode: 'exact', enabled: true, deadPixels: 0, deadPixelIndices: [] },
    { type: 'WS281X_RGBW', count: 40, pinData: 36, pinClock: 0, colorOrder: 'RGBW',
      rgbwMode: 'exact', enabled: true, deadPixels: 0, deadPixelIndices: [] },
    { type: 'WS281X_RGBW', count: 40, pinData: 37, pinClock: 0, colorOrder: 'RGBW',
      rgbwMode: 'exact', enabled: false, deadPixels: 0, deadPixelIndices: [] },
    { type: 'WS281X_RGBW', count: 40, pinData: 38, pinClock: 0, colorOrder: 'RGBW',
      rgbwMode: 'exact', enabled: false, deadPixels: 0, deadPixelIndices: [] },
  ],
  dmx: { enabled: true, protocol: 0, universe: 1, startAddress: 1, timeoutMs: 3000 },
  deviceName: 'Titanic-201',
};

// ── Fetch stub scaffolding ───────────────────────────────────────────────────

function jsonResponse(body, { ok = true, status = 200, statusText = 'OK' } = {}) {
  return { ok, status, statusText, json: async () => body };
}

/** Install a fetch stub for the duration of `fn`, always restoring after. */
async function withFetch(stub, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = stub;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

/** A fetch that rejects when its AbortSignal fires (simulates a hung host). */
function neverResolvesFetch() {
  return (url, opts) => new Promise((_resolve, reject) => {
    const signal = opts && opts.signal;
    if (signal) {
      if (signal.aborted) reject(new Error('aborted'));
      signal.addEventListener('abort', () => reject(new Error('aborted')));
    }
  });
}

// ── probeDevice ──────────────────────────────────────────────────────────────

test('probeDevice accepts a host with the 3-field fingerprint', async () => {
  await withFetch(async (url) => {
    assert.equal(url, 'http://10.1.1.201/api/status');
    return jsonResponse(STATUS_201);
  }, async () => {
    const dev = await probeDevice('10.1.1.201');
    assert.ok(dev);
    assert.equal(dev.ip, '10.1.1.201');
    assert.equal(dev.controllerId, 'titanic_201');
    assert.equal(dev.boardId, 'angio4-old');
    assert.equal(dev.mac, 'AA:BB:CC:DD:02:01');
    assert.equal(dev.pixelCount, 80);
    assert.equal(dev.strands.length, 4);
    assert.equal(dev.raw, STATUS_201);
  });
});

test('probeDevice rejects a host missing any fingerprint field', async () => {
  const { boardId, ...noBoardId } = STATUS_201;
  await withFetch(async () => jsonResponse(noBoardId), async () => {
    assert.equal(await probeDevice('10.1.1.50'), null);
  });
  await withFetch(async () => jsonResponse({ hello: 'world' }), async () => {
    assert.equal(await probeDevice('10.1.1.51'), null);
  });
});

test('probeDevice returns null on a non-ok response', async () => {
  await withFetch(async () => jsonResponse({}, { ok: false, status: 404, statusText: 'Not Found' }),
    async () => {
      assert.equal(await probeDevice('10.1.1.52'), null);
    });
});

test('probeDevice returns null (not throw) on timeout', async () => {
  await withFetch(neverResolvesFetch(), async () => {
    assert.equal(await probeDevice('10.1.1.53', { timeoutMs: 10 }), null);
  });
});

// ── scanSubnet ───────────────────────────────────────────────────────────────

test('scanSubnet finds only the fingerprinted host and reports progress', async () => {
  let progressCalls = 0;
  await withFetch(async (url) => {
    if (url === 'http://10.1.1.201/api/status') return jsonResponse(STATUS_201);
    return jsonResponse({}, { ok: false, status: 404, statusText: 'Not Found' });
  }, async () => {
    const found = await scanSubnet('10.1.1', {
      timeoutMs: 5,
      onProgress: () => { progressCalls += 1; },
    });
    assert.equal(found.length, 1);
    assert.equal(found[0].controllerId, 'titanic_201');
    assert.equal(progressCalls, 4);            // 254 IPs / 64 per batch = 4 batches
  });
});

test('scanSubnet throws on a malformed prefix', async () => {
  await assert.rejects(() => scanSubnet('10.1'), /invalid subnet prefix/);
  await assert.rejects(() => scanSubnet('not.an.ip.addr'), /invalid subnet prefix/);
});

test('scanSubnet stops early when its AbortSignal fires', async () => {
  let probeCount = 0;
  const controller = new AbortController();
  await withFetch(async () => {
    probeCount += 1;
    return jsonResponse({}, { ok: false, status: 404, statusText: 'Not Found' });
  }, async () => {
    await scanSubnet('10.1.1', {
      timeoutMs: 5,
      signal: controller.signal,
      onProgress: () => controller.abort(),   // cancel after the first batch
    });
    assert.equal(probeCount, 64);              // only the first batch ran
  });
});

test('normalizeSubnetPrefix mirrors CaptainPad', () => {
  assert.equal(normalizeSubnetPrefix('10.1.1'), '10.1.1');
  assert.equal(normalizeSubnetPrefix(' 10.1.1. '), '10.1.1');
  assert.equal(normalizeSubnetPrefix('10.1'), null);
  assert.equal(normalizeSubnetPrefix('10.1.1.5'), null);
  assert.equal(normalizeSubnetPrefix('10.1.300'), null);
});

// ── getStatus / getConfig ────────────────────────────────────────────────────

test('getConfig returns the config body and throws on a non-ok reply', async () => {
  await withFetch(async (url) => {
    assert.equal(url, 'http://10.1.1.201/api/config');
    return jsonResponse(CONFIG_201);
  }, async () => {
    const cfg = await getConfig('10.1.1.201');
    assert.equal(cfg.dmx.universe, 1);
    assert.equal(cfg.strands.length, 4);
  });
  await withFetch(async () => jsonResponse({}, { ok: false, status: 500, statusText: 'Err' }),
    async () => {
      await assert.rejects(() => getConfig('10.1.1.201'), /GET \/api\/config/);
    });
});

test('getStatus throws on a non-ok reply (chosen device must answer)', async () => {
  await withFetch(async () => jsonResponse({}, { ok: false, status: 503, statusText: 'Down' }),
    async () => {
      await assert.rejects(() => getStatus('10.1.1.201'), /GET \/api\/status/);
    });
});

// ── pushConfig ───────────────────────────────────────────────────────────────

const VALID_PUSH = {
  strands: CONFIG_201.strands.map((s) => ({ ...s })),
  dmx: { enabled: true, protocol: 0, universe: 3, startAddress: 1, timeoutMs: 3000 },
};

test('pushConfig posts a partial body and returns the device reply', async () => {
  await withFetch(async (url, opts) => {
    assert.equal(url, 'http://10.1.1.201/api/config');
    assert.equal(opts.method, 'POST');
    const sent = JSON.parse(opts.body);
    assert.equal(sent.dmx.universe, 3);
    return jsonResponse({ status: 'ok', outcome: 'needs-reboot', reboot: true, message: 'ok' });
  }, async () => {
    const reply = await pushConfig('10.1.1.201', VALID_PUSH);
    assert.equal(reply.outcome, 'needs-reboot');
    assert.equal(reply.reboot, true);
  });
});

test('pushConfig throws carrying the device field/detail on HTTP 400', async () => {
  await withFetch(async () => jsonResponse(
    { error: 'validation failed', field: 'strands[0].count', detail: 'count must be >= 1' },
    { ok: false, status: 400, statusText: 'Bad Request' },
  ), async () => {
    await assert.rejects(
      () => pushConfig('10.1.1.201', VALID_PUSH),
      (err) => {
        assert.equal(err.field, 'strands[0].count');
        assert.equal(err.detail, 'count must be >= 1');
        assert.ok(err.deviceError);
        assert.match(err.message, /strands\[0\]\.count/);
        return true;
      },
    );
  });
});

test('pushConfig refuses forbidden keys before any network call', async () => {
  await withFetch(async () => { throw new Error('fetch must not run'); }, async () => {
    await assert.rejects(
      () => pushConfig('10.1.1.201', { wifi: { staSsid: 'x' } }),
      /refusing to push key 'wifi'/,
    );
    await assert.rejects(
      () => pushConfig('10.1.1.201', { deviceName: 'nope', strands: VALID_PUSH.strands }),
      /refusing to push key 'deviceName'/,
    );
  });
});

test('pushConfig client-validates §4.2 bounds before POST', async () => {
  await withFetch(async () => { throw new Error('fetch must not run'); }, async () => {
    // universe out of range
    await assert.rejects(() => pushConfig('10.1.1.201', {
      dmx: { enabled: true, protocol: 0, universe: 70000, startAddress: 1 },
    }), /dmx\.universe/);
    // startAddress out of range
    await assert.rejects(() => pushConfig('10.1.1.201', {
      dmx: { enabled: true, protocol: 0, universe: 3, startAddress: 700 },
    }), /dmx\.startAddress/);
    // no enabled strand
    const allDisabled = CONFIG_201.strands.map((s) => ({ ...s, enabled: false }));
    await assert.rejects(() => pushConfig('10.1.1.201', { strands: allDisabled }),
      /at least one strand must be enabled/);
    // duplicate pinData
    const dupPins = CONFIG_201.strands.map((s) => ({ ...s, pinData: 35 }));
    await assert.rejects(() => pushConfig('10.1.1.201', { strands: dupPins }),
      /duplicate pinData/);
    // count < 1
    const zeroCount = CONFIG_201.strands.map((s, i) => ({ ...s, count: i === 0 ? 0 : s.count }));
    await assert.rejects(() => pushConfig('10.1.1.201', { strands: zeroCount }),
      /strands\[0\]\.count/);
  });
});

test('validatePushPayload rejects an empty payload', () => {
  assert.throws(() => validatePushPayload({}), /nothing to write/);
});

// ── awaitReboot ──────────────────────────────────────────────────────────────

test('awaitReboot resolves once the device answers again', async () => {
  let calls = 0;
  await withFetch(async () => {
    calls += 1;
    if (calls < 3) return jsonResponse({}, { ok: false, status: 404, statusText: 'Not Found' });
    return jsonResponse(STATUS_201);
  }, async () => {
    const dev = await awaitReboot('10.1.1.201', {
      timeoutMs: 2000, pollIntervalMs: 1, probeTimeoutMs: 5,
    });
    assert.equal(dev.controllerId, 'titanic_201');
    assert.equal(calls, 3);
  });
});

test('awaitReboot hard-errors on timeout', async () => {
  await withFetch(async () => jsonResponse({}, { ok: false, status: 404, statusText: 'Not Found' }),
    async () => {
      await assert.rejects(
        () => awaitReboot('10.1.1.201', { timeoutMs: 30, pollIntervalMs: 5, probeTimeoutMs: 5 }),
        /did not come back within/,
      );
    });
});
