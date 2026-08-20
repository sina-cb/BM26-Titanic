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
  pushPerOutputUniverses,
  DEFAULT_HTTP_TIMEOUT_MS,
  PER_OUTPUT_WRITE_TIMEOUT_MS,
  REBOOT_WAIT_TIMEOUT_MS,
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

/**
 * A minimal per-output PLAN (report 20260725_70): the shape
 * `derivePerOutputPlan` returns and `pushPerOutputUniverses` now requires. The
 * transport only reads `universeByOutputIndex` + `enables`; the richer fields
 * (assignments / parked / warnings) belong to the UI and the gate.
 */
const PLAN_201 = { universeByOutputIndex: { 0: 3, 1: 4 }, enables: [], enableOutputIndices: [] };

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

// ── G6 — a hung host surfaces a legible timeout, not the raw AbortError ───────

test('getStatus on a hung host throws a legible timeout, not "signal is aborted"', async () => {
  await withFetch(neverResolvesFetch(), async () => {
    await assert.rejects(
      () => getStatus('10.1.1.201', { timeoutMs: 10 }),
      (err) => {
        // The clean, human-readable message (fail loud, but legibly — G6)…
        assert.match(err.message, /timed out after 10 ms — device did not respond/);
        // …and NEVER the raw AbortError string the operator saw before.
        assert.doesNotMatch(err.message, /signal is aborted/i);
        return true;
      },
    );
  });
});

test('getConfig on a hung host throws the same legible timeout', async () => {
  await withFetch(neverResolvesFetch(), async () => {
    await assert.rejects(
      () => getConfig('10.1.1.201', { timeoutMs: 10 }),
      /timed out after 10 ms — device did not respond/,
    );
  });
});

test('a NON-timeout fetch failure still propagates verbatim (no masking)', async () => {
  await withFetch(async () => { throw new Error('Failed to fetch'); }, async () => {
    await assert.rejects(() => getStatus('10.1.1.201'), /Failed to fetch/);
  });
});

// ── _69: reboot-aware phase budgets (transport half) ─────────────────────────
// The operator's failed push died on a flat 5000 ms budget that spanned a device
// REBOOT (measured ~11 s). The transport now times the read and the write
// separately, refuses a single flat budget, and MARKS an unanswered write as
// ambiguous so the caller can read the device back instead of guessing.

test('_69: an unanswered per-output write is flagged writeResponseLost (not a verdict)', async () => {
  const hang = neverResolvesFetch();
  await withFetch(async (url, opts) => {
    if (opts && opts.method === 'POST') return hang(url, opts);
    return jsonResponse(CONFIG_201);
  }, async () => {
    await assert.rejects(
      () => pushPerOutputUniverses('10.1.1.202', {
        plan: PLAN_201,
        opts: { readTimeoutMs: 20, writeTimeoutMs: 20 },
      }),
      (err) => {
        assert.match(err.message, /timed out after 20 ms — device did not respond/);
        assert.equal(err.timedOut, true);
        // The whole point: a lost reply is AMBIGUOUS, never proof of failure.
        assert.equal(err.writeResponseLost, true);
        return true;
      },
    );
  });
});

test('_69: a device that ANSWERS 400 is a definite failure — never flagged ambiguous', async () => {
  await withFetch(async (url, opts) => {
    if (opts && opts.method === 'POST') {
      return jsonResponse({ status: 'error', error: 'per-output validation failed' },
        { ok: false, status: 400, statusText: 'Bad Request' });
    }
    return jsonResponse(CONFIG_201);
  }, async () => {
    await assert.rejects(
      () => pushPerOutputUniverses('10.1.1.202', { plan: PLAN_201 }),
      (err) => {
        assert.equal(err.httpStatus, 400);
        assert.equal(err.writeResponseLost, undefined);
        return true;
      },
    );
  });
});

test('_69: a non-2xx that is not 400 is also definite (the device spoke)', async () => {
  await withFetch(async (url, opts) => {
    if (opts && opts.method === 'POST') {
      return jsonResponse({}, { ok: false, status: 503, statusText: 'Service Unavailable' });
    }
    return jsonResponse(CONFIG_201);
  }, async () => {
    await assert.rejects(
      () => pushPerOutputUniverses('10.1.1.202', { plan: PLAN_201 }),
      (err) => {
        assert.equal(err.httpStatus, 503);
        assert.equal(err.writeResponseLost, undefined);
        return true;
      },
    );
  });
});

test('_69: one flat timeoutMs across read+write is REFUSED (that was the bug)', async () => {
  await assert.rejects(
    () => pushPerOutputUniverses('10.1.1.202', {
      plan: PLAN_201, opts: { timeoutMs: 5000 },
    }),
    /one flat timeoutMs cannot cover both the read and the reboot-spanning write/,
  );
});

test('_69: the write budget covers the measured reboot; the reboot wait is far longer', () => {
  // Reboot measured ~11 s (report 20260725_56 addendum); a cold device needs
  // ~5 s to first byte. Any budget at or below 11 s across the write reproduces
  // the operator's failure on healthy hardware.
  assert.ok(PER_OUTPUT_WRITE_TIMEOUT_MS > 11000, 'the write budget must clear an ~11 s reboot');
  assert.ok(DEFAULT_HTTP_TIMEOUT_MS > 5000, 'a read budget must clear the ~5 s cold first byte');
  assert.ok(REBOOT_WAIT_TIMEOUT_MS >= 30000, 'the reboot wait needs honest headroom over ~11 s');
  assert.ok(REBOOT_WAIT_TIMEOUT_MS > PER_OUTPUT_WRITE_TIMEOUT_MS);
});

test('_69: the reboot poll respects its budget and reports progress while it waits', async () => {
  const progress = [];
  await withFetch(async () => jsonResponse({}, { ok: false, status: 404, statusText: 'Not Found' }),
    async () => {
      // Budget + poll interval are injected, so the test never sleeps a real 45 s.
      await assert.rejects(
        () => awaitReboot('10.1.1.201', {
          timeoutMs: 40,
          pollIntervalMs: 5,
          probeTimeoutMs: 5,
          onProgress: (p) => progress.push(p),
        }),
        /did not come back within 40ms after reboot \(\d+ probe\(s\)\)/,
      );
    });
  assert.ok(progress.length > 0, 'the wait must report progress, not sit silent');
  assert.equal(progress[0].timeoutMs, 40);
  assert.ok(progress[0].elapsedMs >= 0);
  assert.equal(progress[0].attempts, 1);
});
