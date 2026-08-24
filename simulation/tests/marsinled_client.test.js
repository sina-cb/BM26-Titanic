/**
 * marsinled_client.test.js — unit tests for the MarsinLED HTTP client
 * (discovery + read/write). Uses a STUBBED global `fetch` (node:test, no real
 * network). Covers: probe happy path + fingerprint/timeout misses, subnet scan
 * + cancellation, config read, the two surviving writers (forced push + DMX
 * toggle) with the write seam's denied-key guard, and the reboot wait.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeSubnetPrefix,
  probeDevice,
  scanSubnet,
  getStatus,
  getConfig,
  awaitReboot,
  applyForcedPlan,
  buildForcedConfigBody,
  pushForcedConfig,
  diffForcedConfig,
  swarmEnabledNote,
  buildDmxToggleBody,
  diffDmxToggle,
  pushDmxToggle,
  validateGammaCurve,
  buildGammaPushBody,
  diffGammaPush,
  pushGammaPush,
  readWithRetryOnTimeout,
  GAMMA_VERIFY_EPSILON,
  VERIFY_READ_ATTEMPTS,
  DEFAULT_HTTP_TIMEOUT_MS,
  PER_OUTPUT_WRITE_TIMEOUT_MS,
  REBOOT_WAIT_TIMEOUT_MS,
} from '../src/dmx/led/marsinled_client.js';
import * as marsinledClient from '../src/dmx/led/marsinled_client.js';

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
 * A minimal per-output PLAN: the shape `derivePerOutputPlan` returns and the
 * forced-push builder requires. `universeByOutputIndex` names the outputs the
 * push ENABLES; `assignments` carries the pixel count each one is forced to.
 * Every output NOT in the map is disabled by the push.
 */
const PLAN_201 = {
  controllerName: 'Titanic-201',
  universeByOutputIndex: { 0: 3, 1: 4 },
  assignments: [
    { outputIndex: 0, portNum: 1, universe: 3, pixelCount: 40 },
    { outputIndex: 1, portNum: 2, universe: 4, pixelCount: 40 },
  ],
  disables: [],
  countChanges: [],
};

/** The body every forced-push transport test posts. */
const BODY_201 = () => buildForcedConfigBody({
  snapshot: CONFIG_201, plan: PLAN_201, ip: '10.1.1.202',
});

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

// ── the deleted generic write path + the surviving write seam ────────────────
// The partial-body `pushConfig` / `validatePushPayload` pair went out with this
// slice: per-output is the only push style, so nothing in the panel, the tools,
// the servers or the HIL runner had called either for a full campaign. What
// their denied-key guard protected did NOT go with them — it moved to the one
// seam every write passes through (`postConfigBody`), where it now also covers
// the forced push and the DMX toggle, which the old guard never saw.

test('the generic pushConfig / validatePushPayload path is GONE (per-output only)', () => {
  assert.equal(marsinledClient.pushConfig, undefined,
    'pushConfig must not come back — a partial-body write has no caller and no verify');
  assert.equal(marsinledClient.validatePushPayload, undefined);
});

test('the write seam REFUSES a denied key on any body, before the socket opens', async () => {
  const body = { strands: CONFIG_201.strands.map((s) => ({ ...s })), swarm: { enabled: false } };
  await withFetch(async () => { throw new Error('fetch must not run'); }, async () => {
    await assert.rejects(() => pushForcedConfig('10.1.1.201', body),
      /refusing to POST key 'swarm'/);
    await assert.rejects(
      () => pushDmxToggle('10.1.1.201', { dmx: { enabled: true }, wifi: { staSsid: 'x' } }),
      /refusing to POST key 'wifi'/);
    await assert.rejects(
      () => pushForcedConfig('10.1.1.201', {
        strands: CONFIG_201.strands.map((s) => ({ ...s })), controllerId: 'someone_else' }),
      /refusing to POST key 'controllerId'/);
  });
});

test('deviceName is the ONE declared exception — the repair still posts', async () => {
  let posted = null;
  await withFetch(async (url, opts) => {
    posted = JSON.parse(opts.body);
    return jsonResponse({ status: 'ok', outcome: 'needs-reboot', reboot: true });
  }, async () => {
    const reply = await pushForcedConfig('10.1.1.201', {
      strands: CONFIG_201.strands.map((s) => ({ ...s })),
      dmx: { enabled: true, protocol: 0 },
      deviceName: 'Titanic-201',
    });
    assert.equal(reply.outcome, 'needs-reboot');
  });
  assert.equal(posted.deviceName, 'Titanic-201');
});

test('isMarsinLedStatus is EXPORTED — one fingerprint, shared with the server probe', () => {
  assert.equal(typeof marsinledClient.isMarsinLedStatus, 'function');
  assert.equal(marsinledClient.isMarsinLedStatus(STATUS_201), true);
  assert.equal(marsinledClient.isMarsinLedStatus({ ...STATUS_201, boardId: '' }), false);
  assert.equal(marsinledClient.isMarsinLedStatus({ ...STATUS_201, strands: undefined }), false);
  assert.equal(marsinledClient.isMarsinLedStatus(null), false);
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

test('_69: an unanswered forced write is flagged writeResponseLost (not a verdict)', async () => {
  const hang = neverResolvesFetch();
  await withFetch(async (url, opts) => {
    if (opts && opts.method === 'POST') return hang(url, opts);
    return jsonResponse(CONFIG_201);
  }, async () => {
    await assert.rejects(
      () => pushForcedConfig('10.1.1.202', BODY_201(), { writeTimeoutMs: 20 }),
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
      () => pushForcedConfig('10.1.1.202', BODY_201()),
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
      () => pushForcedConfig('10.1.1.202', BODY_201()),
      (err) => {
        assert.equal(err.httpStatus, 503);
        assert.equal(err.writeResponseLost, undefined);
        return true;
      },
    );
  });
});

test('_69: one flat timeoutMs is REFUSED — the write budget spans the reboot alone', async () => {
  await assert.rejects(
    () => pushForcedConfig('10.1.1.202', BODY_201(), { timeoutMs: 5000 }),
    /pass \{writeTimeoutMs\}/,
  );
});

// ── _362: the forced-push contract (build → post → verify) ──────────────────
// The sim panel is the SINGLE SOURCE OF TRUTH. A push is a one-way full
// overwrite: mapped outputs are enabled with the mapped count + universe, every
// other output is DISABLED, and the board is switched to DMX-driven.

test('_362: applyForcedPlan copies hardware truth and forces the sim fields', () => {
  const out = applyForcedPlan(CONFIG_201.strands, PLAN_201);
  assert.equal(out.length, 4);
  // Hardware identity is the board's, verbatim — the sim never invents pins.
  out.forEach((s, i) => {
    assert.equal(s.type, CONFIG_201.strands[i].type);
    assert.equal(s.pinData, CONFIG_201.strands[i].pinData);
    assert.equal(s.pinClock, CONFIG_201.strands[i].pinClock);
    assert.equal(s.colorOrder, CONFIG_201.strands[i].colorOrder);
    assert.equal(s.rgbwMode, CONFIG_201.strands[i].rgbwMode);
    assert.deepEqual(s.deadPixelIndices, CONFIG_201.strands[i].deadPixelIndices);
  });
  assert.deepEqual(
    out.map((s) => [s.enabled, s.count, s.dmxUniverse, s.dmxStartAddress]),
    [
      [true, 40, 3, 1],
      [true, 40, 4, 1],
      [false, 40, undefined, undefined],
      [false, 40, undefined, undefined],
    ],
  );
  // The input array is never mutated (pure).
  assert.equal(CONFIG_201.strands[0].dmxUniverse, undefined);
});

test('_362: applyForcedPlan DISABLES an enabled output no port maps', () => {
  const strands = CONFIG_201.strands.map((s, i) => ({ ...s, enabled: i < 3 }));
  const out = applyForcedPlan(strands, PLAN_201);
  assert.equal(out[2].enabled, false, 'output 2 is enabled on the board but unmapped → disabled');
  assert.equal(out[3].enabled, false);
});

test('_362: a DARKENED output carries NO universe — the ALL-OR-NONE trap', () => {
  // The rope-board case this feature exists for: output 2 is enabled TODAY on
  // U27, and no port maps it. CONFIG_201's golden strands carry no universes,
  // so only a snapshot that HAS one can catch a stale key riding through.
  const strands = CONFIG_201.strands.map((s, i) => (i === 2
    ? { ...s, enabled: true, dmxUniverse: 27, dmxStartAddress: 1 }
    : { ...s }));
  const out = applyForcedPlan(strands, PLAN_201);
  assert.equal(out[2].enabled, false);
  assert.equal('dmxUniverse' in out[2], false,
    'a disabled strand carrying a universe violates the firmware ALL-OR-NONE rule');
  assert.equal('dmxStartAddress' in out[2], false);
  // …and through the builder, so the POSTed body is what actually lands.
  const body = buildForcedConfigBody({
    snapshot: { ...CONFIG_201, strands }, plan: PLAN_201, ip: '10.1.1.202',
  });
  assert.equal('dmxUniverse' in body.strands[2], false);
  assert.equal('dmxStartAddress' in body.strands[2], false);
  // The hardware identity of the darkened output survives untouched.
  assert.equal(body.strands[2].pinData, 37);
  assert.equal(body.strands[2].colorOrder, 'RGBW');
  assert.equal(body.strands[2].count, 40);
});

test('_362: applyForcedPlan FORCES count on an already-enabled output', () => {
  const plan = {
    ...PLAN_201,
    assignments: [
      { outputIndex: 0, portNum: 1, universe: 3, pixelCount: 20 },
      { outputIndex: 1, portNum: 2, universe: 4, pixelCount: 40 },
    ],
  };
  const out = applyForcedPlan(CONFIG_201.strands, plan);
  assert.equal(out[0].count, 20, 'the sim mapping wins over the board count, both directions');
});

test('_362: applyForcedPlan refuses a universe with no assignment, and an out-of-range output', () => {
  assert.throws(
    () => applyForcedPlan(CONFIG_201.strands, { ...PLAN_201, assignments: [] }),
    /carries a universe but no assignment with a pixel count/,
  );
  assert.throws(
    () => applyForcedPlan(CONFIG_201.strands, {
      universeByOutputIndex: { 9: 3 },
      assignments: [{ outputIndex: 9, portNum: 1, universe: 3, pixelCount: 40 }],
    }),
    /the plan assigns output 9, but the device reports only 4 output\(s\)/,
  );
});

// ── _363 §2.1: the NARROWED body — golden deepEqual of the WHOLE object ─────
// The push forces exactly three things (counts+enables, per-output universes,
// DMX on). Everything else the board holds must ride through untouched, and two
// keys must never appear at all: `swarm` (operator-managed) and `gamma` (gone
// from the sim). One golden value pins the whole contract.

/**
 * Deliberately UNLIKE the body the push builds: DMX off, ArtNet, its own
 * timeout/universe/startAddress, a swarm block, a gamma block, per-strand
 * hardware fields the push must not touch, a stale universe on the output that
 * is about to go dark, and a key no firmware has shipped yet.
 */
const SNAPSHOT_NARROW = {
  strands: [
    { type: 'WS281X_RGBW', count: 12, pinData: 35, pinClock: 0, colorOrder: 'RGBW',
      rgbwMode: 'exact', enabled: false, deadPixels: 0, deadPixelIndices: [],
      futureFirmwareKey: 'keep-me' },
    { type: 'APA102', count: 99, pinData: 36, pinClock: 40, colorOrder: 'BGR',
      rgbwMode: 'none', enabled: true, dmxUniverse: 27, dmxStartAddress: 1,
      deadPixels: 1, deadPixelIndices: [3] },
    { type: 'WS281X_RGB', count: 40, pinData: 37, pinClock: 0, colorOrder: 'GRB',
      rgbwMode: 'none', enabled: true, dmxUniverse: 28, dmxStartAddress: 1 },
  ],
  dmx: { enabled: false, protocol: 1, universe: 7, startAddress: 5, timeoutMs: 2500 },
  swarm: { enabled: true, isLeader: true, role: 'leader', groupId: 'ropes' },
  gamma: { r: 2.2, g: 2.2, b: 2.2, w: 1.0 },
  deviceName: 'Rope-Board',
};

const PLAN_NARROW = {
  controllerName: 'Rope-Board',
  universeByOutputIndex: { 0: 11, 1: 12 },
  assignments: [
    { outputIndex: 0, portNum: 1, universe: 11, pixelCount: 40 },
    { outputIndex: 1, portNum: 2, universe: 12, pixelCount: 60 },
  ],
  disables: [],
  countChanges: [],
};

test('_363: the narrowed forced body, in full — one golden deepEqual', () => {
  const body = buildForcedConfigBody({
    snapshot: SNAPSHOT_NARROW, plan: PLAN_NARROW, ip: '10.1.1.202',
  });
  assert.deepEqual(body, {
    strands: [
      // ASSIGNED: enable + count + universe + start forced; type / colorOrder /
      // rgbwMode / pins / dead-pixel fields / a novel future key ride through.
      { type: 'WS281X_RGBW', count: 40, pinData: 35, pinClock: 0, colorOrder: 'RGBW',
        rgbwMode: 'exact', enabled: true, deadPixels: 0, deadPixelIndices: [],
        futureFirmwareKey: 'keep-me', dmxUniverse: 11, dmxStartAddress: 1 },
      { type: 'APA102', count: 60, pinData: 36, pinClock: 40, colorOrder: 'BGR',
        rgbwMode: 'none', enabled: true, dmxUniverse: 12, dmxStartAddress: 1,
        deadPixels: 1, deadPixelIndices: [3] },
      // UNASSIGNED: enabled:false and the universe keys DELETED (D1).
      { type: 'WS281X_RGB', count: 40, pinData: 37, pinClock: 0, colorOrder: 'GRB',
        rgbwMode: 'none', enabled: false },
    ],
    // The board's OWN dmx object, with only enabled + protocol forced.
    dmx: { enabled: true, protocol: 0, universe: 7, startAddress: 5, timeoutMs: 2500 },
  });
  // Stated again as their own assertions, so a future edit that loses one of
  // them fails with a sentence rather than a diff of the whole body.
  assert.equal('swarm' in body, false, 'the push NEVER writes swarm, even when the board has one');
  assert.equal('gamma' in body, false, 'the push NEVER writes gamma, even when the board has one');
  assert.equal(body.dmx.timeoutMs, 2500, 'timeoutMs is the board\'s, preserved — never forced');
  assert.equal('dmxUniverse' in body.strands[2], false);
  assert.equal('dmxStartAddress' in body.strands[2], false);
  // Pure: the snapshot is not mutated.
  assert.equal(SNAPSHOT_NARROW.strands[0].enabled, false);
  assert.equal(SNAPSHOT_NARROW.dmx.enabled, false);
});

test('_363: the body merges INTO the board\'s dmx object — it never invents one', () => {
  // A snapshot whose dmx block carries only what an older firmware saved.
  const body = buildForcedConfigBody({
    snapshot: { ...SNAPSHOT_NARROW, dmx: { enabled: false } },
    plan: PLAN_NARROW,
  });
  assert.deepEqual(body.dmx, { enabled: true, protocol: 0 });
});

test('_363: a snapshot with NO dmx object is a loud refusal, not an invented block', () => {
  const { dmx, ...noDmx } = SNAPSHOT_NARROW;
  assert.throws(() => buildForcedConfigBody({ snapshot: noDmx, plan: PLAN_NARROW }),
    /the snapshot carries no dmx object/);
  assert.throws(
    () => buildForcedConfigBody({ snapshot: { ...SNAPSHOT_NARROW, dmx: 'on' }, plan: PLAN_NARROW }),
    /the snapshot carries no dmx object/,
  );
  assert.throws(
    () => buildForcedConfigBody({ snapshot: { ...SNAPSHOT_NARROW, dmx: [] }, plan: PLAN_NARROW }),
    /the snapshot carries no dmx object/,
  );
});

test('_363: FORCED_DMX_BLOCK is GONE — no frozen dmx constant is exported any more', () => {
  assert.equal('FORCED_DMX_BLOCK' in marsinledClient, false,
    'the frozen block is replaced by the merge rule (snapshot.dmx + enabled/protocol)');
  assert.equal(marsinledClient.FORCED_DMX_BLOCK, undefined);
});

test('_362: buildForcedConfigBody repairs an INVALID stored deviceName, and only then', () => {
  const broken = { ...CONFIG_201, deviceName: '' };
  const repaired = buildForcedConfigBody({ snapshot: broken, plan: PLAN_201, ip: '10.1.1.202' });
  assert.equal(repaired.deviceName, 'Titanic-201');
  assert.equal('deviceName' in BODY_201(), false, 'a valid stored name is never rewritten');
  assert.throws(
    () => buildForcedConfigBody({
      snapshot: broken, plan: { ...PLAN_201, controllerName: 'not a legal name' },
      ip: '10.1.1.202',
    }),
    /is not a legal device name either/,
  );
});

test('_362: buildForcedConfigBody validates the APPLIED array before any POST', () => {
  assert.throws(
    () => buildForcedConfigBody({
      snapshot: CONFIG_201,
      plan: {
        universeByOutputIndex: { 0: 3, 1: 900 },
        assignments: [
          { outputIndex: 0, portNum: 1, universe: 3, pixelCount: 40 },
          { outputIndex: 1, portNum: 2, universe: 900, pixelCount: 40 },
        ],
      },
      ip: '10.1.1.202',
    }),
    /universe span 898 exceeds the 16-universe window/,
  );
  assert.throws(
    () => buildForcedConfigBody({ snapshot: { dmx: {} }, plan: PLAN_201 }),
    /snapshot must be a GET \/api\/config document with a strands\[\] array/,
  );
});

test('_362: pushForcedConfig POSTs the body byte-for-byte and issues NO GET', async () => {
  const body = BODY_201();
  const seen = [];
  await withFetch(async (url, opts) => {
    seen.push({ url, method: (opts && opts.method) || 'GET', body: opts && opts.body });
    return jsonResponse({ status: 'ok', outcome: 'needs-reboot', reboot: true });
  }, async () => {
    const reply = await pushForcedConfig('10.1.1.202', body);
    assert.equal(reply.outcome, 'needs-reboot');
  });
  assert.equal(seen.length, 1, 'exactly one request — the transport never re-reads the config');
  assert.equal(seen[0].method, 'POST');
  assert.equal(seen[0].url, 'http://10.1.1.202/api/config');
  assert.equal(seen[0].body, JSON.stringify(body));
});

test('_362: pushForcedConfig refuses a body that is not a built forced body', async () => {
  await assert.rejects(() => pushForcedConfig('10.1.1.202', { dmx: { enabled: true, protocol: 0 } }),
    /body must be a buildForcedConfigBody\(\) result/);
});

// ── _362 §2.4: the FULL verify ───────────────────────────────────────────────

/** A read-back pair that confirms `body` exactly. */
function verifyPair(body, { statusPatch = {}, configPatch = {} } = {}) {
  return {
    config: {
      strands: body.strands.map((s) => ({ ...s })),
      dmx: { ...body.dmx },
      ...configPatch,
    },
    status: {
      controllerId: 'titanic_201',
      sacn: { enabled: true, rxPackets: 12 },
      ...statusPatch,
    },
  };
}

test('_362: diffForcedConfig is GREEN on an exact read-back', () => {
  const body = BODY_201();
  const { config, status } = verifyPair(body);
  assert.deepEqual(diffForcedConfig(config, status, body, { controllerId: 'titanic_201' }), []);
});

test('_362: diffForcedConfig is RED on every part of the contract', () => {
  const body = BODY_201();
  const red = (mutate, re) => {
    const pair = verifyPair(body);
    mutate(pair);
    const out = diffForcedConfig(pair.config, pair.status, body, { controllerId: 'titanic_201' });
    assert.ok(out.length > 0, `expected a mismatch for ${re}`);
    assert.match(out.join('; '), re);
  };
  red((p) => { p.config.strands[0].enabled = false; }, /output 0: device enabled=false/);
  red((p) => { p.config.strands[3].enabled = true; }, /output 3: device enabled=true/);
  red((p) => { p.config.strands[0].count = 39; }, /output 0: device count 39 px/);
  red((p) => { p.config.strands[1].dmxUniverse = 9; }, /output 1: device U9 ≠ wanted U4/);
  red((p) => { p.config.strands[1].dmxStartAddress = 2; }, /output 1: device startAddress 2/);
  red((p) => { p.config.dmx = { enabled: false, protocol: 0 }; }, /the board is NOT DMX-driven/);
  red((p) => { p.config.dmx = { enabled: true, protocol: 1 }; }, /dmx.protocol=1 ≠ 0/);
  red((p) => { p.status.sacn = { enabled: false }; }, /sACN receiver is not listening/);
  red((p) => { p.status.dmxOwnsOutput = false; }, /DMX does not own the outputs/);
  red((p) => { p.status.controllerId = 'titanic_999'; }, /is not the same board/);
  red((p) => { p.config.strands.pop(); }, /device reports 3 output\(s\), the push wrote 4/);
});

test('_363: D1 — a DISABLED output still reporting a universe is RED', () => {
  const body = BODY_201();
  const pair = verifyPair(body);
  // Output 2 was darkened; the push deleted its universe keys. A board that
  // still holds one never applied the firmware's all-or-none rule — and it is
  // exactly the state that 400s the NEXT write.
  pair.config.strands[2].dmxUniverse = 27;
  const out = diffForcedConfig(pair.config, pair.status, body);
  assert.equal(out.length, 1);
  assert.match(out[0],
    /output 2: device still reports U27 on a DISABLED output — the push wrote no universe there/);
  // …and a disabled output that reports NO universe is green (the happy D1 case).
  const clean = verifyPair(body);
  assert.deepEqual(diffForcedConfig(clean.config, clean.status, body), []);
});

test('_363: the verify is NARROWED — type/colorOrder/timeoutMs/swarm may differ arbitrarily', () => {
  // Ruling 6.2: the push does not write these fields, so it judges nothing about
  // them. A board whose chip type, colour order, DMX timeout and swarm state all
  // disagree with the sim still VERIFIES, because the push claimed none of it.
  const body = BODY_201();
  const pair = verifyPair(body);
  pair.config.strands[0].type = 'APA102';
  pair.config.strands[0].colorOrder = 'BGR';
  pair.config.strands[0].rgbwMode = 'none';
  pair.config.strands[0].pinData = 99;
  pair.config.strands[1].deadPixels = 4;
  pair.config.dmx = { ...pair.config.dmx, timeoutMs: 60000 };
  pair.config.swarm = { enabled: true, isLeader: true, groupId: 'ropes' };
  pair.config.gamma = { r: 2.2, g: 2.2, b: 2.2, w: 1 };
  assert.deepEqual(diffForcedConfig(pair.config, pair.status, body, { controllerId: 'titanic_201' }),
    []);
});

test('_363: a swarm-enabled read-back produces the INFORMATIONAL note, never a mismatch', () => {
  const body = BODY_201();
  const pair = verifyPair(body);
  pair.config.swarm = { enabled: true, isLeader: true };
  assert.deepEqual(diffForcedConfig(pair.config, pair.status, body), [],
    'swarm is untouched by the push — it can never fail the verify');
  assert.equal(swarmEnabledNote(pair.config),
    'ℹ board also reports SWARM enabled — swarm is operator-managed; the sim does not touch it');
  // Silent on every board that is not in swarm.
  assert.equal(swarmEnabledNote({ swarm: { enabled: false } }), null);
  assert.equal(swarmEnabledNote({}), null);
  assert.equal(swarmEnabledNote(null), null);
});

test('_362: dmxOwnsOutput is asserted only when the firmware reports it', () => {
  const body = BODY_201();
  const absent = verifyPair(body);
  assert.deepEqual(diffForcedConfig(absent.config, absent.status, body), []);
  const present = verifyPair(body, { statusPatch: { dmxOwnsOutput: true } });
  assert.deepEqual(diffForcedConfig(present.config, present.status, body), []);
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

// ── _363 §3: the DMX ON/OFF toggle (one write, one read-back, no machinery) ──

/** The toggle body every transport case posts. */
const TOGGLE_BODY = (enabled = false) => buildDmxToggleBody({
  snapshot: CONFIG_201, enabled, controllerName: 'Titanic-201', ip: '10.1.1.201',
});

test('_363: buildDmxToggleBody flips ONLY enabled, on the board\'s own dmx object', () => {
  const off = buildDmxToggleBody({
    snapshot: SNAPSHOT_NARROW, enabled: false, controllerName: 'Rope-Board', ip: '10.1.1.202',
  });
  assert.deepEqual(off, {
    dmx: { enabled: false, protocol: 1, universe: 7, startAddress: 5, timeoutMs: 2500 },
  });
  const on = buildDmxToggleBody({
    snapshot: SNAPSHOT_NARROW, enabled: true, controllerName: 'Rope-Board', ip: '10.1.1.202',
  });
  assert.deepEqual(on, {
    dmx: { enabled: true, protocol: 1, universe: 7, startAddress: 5, timeoutMs: 2500 },
  });
  // The toggle claims NOTHING about strands, swarm, gamma or protocol — it does
  // not force sACN the way the push does, it only moves the flag.
  for (const body of [off, on]) {
    assert.deepEqual(Object.keys(body), ['dmx']);
  }
  assert.equal(SNAPSHOT_NARROW.dmx.enabled, false, 'pure — the snapshot is not mutated');
});

test('_363: buildDmxToggleBody carries the deviceName repair, and only when it fires', () => {
  assert.equal('deviceName' in TOGGLE_BODY(false), false, 'a valid stored name is never rewritten');
  const repaired = buildDmxToggleBody({
    snapshot: { ...CONFIG_201, deviceName: '' }, enabled: false,
    controllerName: 'Titanic-201', ip: '10.1.1.201',
  });
  assert.equal(repaired.deviceName, 'Titanic-201');
  assert.deepEqual(repaired.dmx,
    { enabled: false, protocol: 0, universe: 1, startAddress: 1, timeoutMs: 3000 });
  // An unusable card name refuses BEFORE any body exists (same doctrine as the push).
  assert.throws(() => buildDmxToggleBody({
    snapshot: { ...CONFIG_201, deviceName: '' }, enabled: false,
    controllerName: 'Rope Board', ip: '10.1.1.201',
  }), /RENAME THE CONTROLLER CARD/);
});

test('_363: buildDmxToggleBody refuses a snapshot with no dmx block, and a non-boolean state', () => {
  assert.throws(() => buildDmxToggleBody({ snapshot: { strands: [] }, enabled: true }),
    /the snapshot carries no dmx object/);
  assert.throws(() => buildDmxToggleBody({ snapshot: { dmx: null }, enabled: true }),
    /the snapshot carries no dmx object/);
  assert.throws(() => buildDmxToggleBody({ snapshot: CONFIG_201, enabled: 'on' }),
    /`enabled` must be a boolean/);
  assert.throws(() => buildDmxToggleBody({ snapshot: CONFIG_201 }),
    /`enabled` must be a boolean/);
});

test('_363: diffDmxToggle is green on agreement and red on each clause, both directions', () => {
  const pair = (dmxEnabled, sacnEnabled, controllerId = 'titanic_201') => ({
    config: { dmx: { enabled: dmxEnabled, protocol: 0, timeoutMs: 3000 } },
    status: { controllerId, sacn: { enabled: sacnEnabled } },
  });
  const expected = { controllerId: 'titanic_201' };

  const onOk = pair(true, true);
  assert.deepEqual(diffDmxToggle(onOk.config, onOk.status, true, expected), []);
  const offOk = pair(false, false);
  assert.deepEqual(diffDmxToggle(offOk.config, offOk.status, false, expected), []);

  // The SAVED flag did not move.
  const savedStale = pair(false, true);
  assert.match(diffDmxToggle(savedStale.config, savedStale.status, true, expected).join('; '),
    /dmx\.enabled=false ≠ true — the board did not take the DMX flag/);
  // The saved flag moved but the RUNNING receiver did not.
  const runtimeStale = pair(true, false);
  assert.match(diffDmxToggle(runtimeStale.config, runtimeStale.status, true, expected).join('; '),
    /sacn\.enabled=false ≠ true — the running sACN receiver does not match the saved flag/);
  // Identity.
  const other = pair(true, true, 'titanic_999');
  assert.match(diffDmxToggle(other.config, other.status, true, expected).join('; '),
    /'titanic_999' ≠ the pre-write 'titanic_201' — this is not the same board/);
  // …and identity is only judged when the caller states one.
  assert.deepEqual(diffDmxToggle(other.config, other.status, true), []);
  // The toggle claims nothing about strands or swarm.
  const noisy = pair(false, false);
  noisy.config.strands = [{ enabled: true, count: 999, dmxUniverse: 4 }];
  noisy.config.swarm = { enabled: true };
  assert.deepEqual(diffDmxToggle(noisy.config, noisy.status, false, expected), []);
  // Malformed inputs fail loudly rather than reading as agreement.
  assert.throws(() => diffDmxToggle({}, {}, 'off'), /`enabled` must be the boolean/);
  assert.throws(() => diffDmxToggle(null, {}, false), /verifyConfig must be a GET \/api\/config/);
  assert.throws(() => diffDmxToggle({}, null, false), /verifyStatus must be a GET \/api\/status/);
});

test('_363: pushDmxToggle POSTs the body byte-for-byte and issues NO GET', async () => {
  const body = TOGGLE_BODY(false);
  const seen = [];
  await withFetch(async (url, opts) => {
    seen.push({ url, method: (opts && opts.method) || 'GET', body: opts && opts.body });
    return jsonResponse({ status: 'ok', outcome: 'needs-reboot', reboot: true });
  }, async () => {
    const reply = await pushDmxToggle('10.1.1.201', body);
    assert.equal(reply.outcome, 'needs-reboot');
  });
  assert.equal(seen.length, 1, 'exactly one request — the transport never re-reads the config');
  assert.equal(seen[0].method, 'POST');
  assert.equal(seen[0].url, 'http://10.1.1.201/api/config');
  assert.equal(seen[0].body, JSON.stringify(body));
});

test('_363: an unanswered toggle write is flagged writeResponseLost (not a verdict)', async () => {
  await withFetch(neverResolvesFetch(), async () => {
    await assert.rejects(
      () => pushDmxToggle('10.1.1.201', TOGGLE_BODY(false), { writeTimeoutMs: 20 }),
      (err) => {
        assert.equal(err.timedOut, true);
        assert.equal(err.writeResponseLost, true);
        return true;
      },
    );
  });
});

test('_363: D2 — an ANSWERED non-2xx toggle (400/409/503) is a definite loud failure', async () => {
  // 409 is the reply during an active staged-network-config confirm window
  // (report `_363` §2.4-1): the device SPOKE, so the write definitively did not
  // apply and it is never arbitrated by a read-back.
  for (const status of [400, 409, 503]) {
    await withFetch(async () => jsonResponse(
      { status: 'error', error: 'config apply failed' },
      { ok: false, status, statusText: 'refused' },
    ), async () => {
      await assert.rejects(
        () => pushDmxToggle('10.1.1.201', TOGGLE_BODY(true)),
        (err) => {
          assert.equal(err.httpStatus, status);
          assert.equal(err.writeResponseLost, undefined,
            `HTTP ${status} is a device that answered — never ambiguous`);
          return true;
        },
      );
    });
  }
});

test('_363: pushDmxToggle refuses a flat timeoutMs and a body that is not a toggle body', async () => {
  await assert.rejects(
    () => pushDmxToggle('10.1.1.201', TOGGLE_BODY(false), { timeoutMs: 5000 }),
    /pass \{writeTimeoutMs\}/,
  );
  await withFetch(async () => { throw new Error('fetch must not run'); }, async () => {
    await assert.rejects(() => pushDmxToggle('10.1.1.201', { strands: [] }),
      /body must be a buildDmxToggleBody\(\) result with a dmx object/);
    await assert.rejects(() => pushDmxToggle('10.1.1.201', { dmx: 'on' }),
      /body must be a buildDmxToggleBody\(\) result with a dmx object/);
  });
});

// ── The retrying READ helper (the verify-race fix) ──────────────────────────
//
// Live evidence, hit TWICE on real boards: after a needs-reboot write
// `awaitReboot` returns on the FIRST /api/status answer, but the board finishes
// re-associating to WiFi afterwards and drops reads for a few seconds. One 8 s
// attempt per read turned that into a FALSE FAIL over a write that HAD applied.

/** An error shaped exactly like the one `fetchWithTimeout` raises on a timeout. */
function timeoutError(ms = 8000) {
  const err = new Error(`timed out after ${ms} ms — device did not respond`);
  err.timedOut = true;
  return err;
}

test('_20260824: a read that times out TWICE and then answers is a SUCCESS', async () => {
  let calls = 0;
  const value = await readWithRetryOnTimeout(async () => {
    calls += 1;
    if (calls < 3) throw timeoutError();
    return { ok: 'third time' };
  }, { retryDelayMs: 0 });
  assert.equal(calls, 3);
  assert.deepEqual(value, { ok: 'third time' });
});

test('_20260824: the retry is BOUNDED — it fails loudly after the last attempt', async () => {
  let calls = 0;
  const retries = [];
  await assert.rejects(
    () => readWithRetryOnTimeout(async () => { calls += 1; throw timeoutError(); }, {
      retryDelayMs: 0,
      label: 'post-write read-back of 192.0.2.7',
      onRetry: (r) => retries.push(r),
    }),
    (err) => {
      assert.match(err.message, /post-write read-back of 192\.0\.2\.7 timed out on every attempt/);
      assert.equal(err.timedOut, true, 'still a timeout — the caller may say so');
      assert.equal(err.readRetriesExhausted, true);
      return true;
    },
  );
  assert.equal(calls, VERIFY_READ_ATTEMPTS, 'exactly the declared number of attempts');
  assert.equal(retries.length, VERIFY_READ_ATTEMPTS - 1,
    'one progress note per RETRY, not per try');
  assert.deepEqual(retries.map((r) => r.attempt), [1, 2, 3]);
});

test('_20260824: an ANSWERED failure is NEVER retried — it is a definite failure', async () => {
  const answeredCases = [
    Object.assign(new Error('[MarsinLED] GET /api/config failed: HTTP 500'), { httpStatus: 500 }),
    Object.assign(new Error('[MarsinLED] rejected config'), { httpStatus: 400, field: 'deviceName' }),
    new Error('connection refused'),          // not a timeout either — fail loud
  ];
  for (const answered of answeredCases) {
    let calls = 0;
    await assert.rejects(
      () => readWithRetryOnTimeout(async () => { calls += 1; throw answered; }, { retryDelayMs: 0 }),
      (err) => { assert.equal(err, answered, 'the original error, verbatim'); return true; },
    );
    assert.equal(calls, 1, 'one attempt only — the device spoke');
  }
});

test('_20260824: the retry helper takes a READ, never a write', async () => {
  await assert.rejects(() => readWithRetryOnTimeout({ not: 'a function' }),
    /`read` must be a function returning a promise/);
  await assert.rejects(() => readWithRetryOnTimeout(async () => 1, { attempts: 0 }),
    /attempts must be a positive integer/);
});

test('_20260824: the wall-clock budget stops a retry loop before the attempt count does',
  async () => {
    let calls = 0;
    await assert.rejects(
      () => readWithRetryOnTimeout(async () => { calls += 1; throw timeoutError(); },
        { attempts: 10, budgetMs: 0, retryDelayMs: 50 }),
      /timed out on every attempt/,
    );
    assert.equal(calls, 1, 'a spent budget means no further attempt is started');
  });

// ── The GAMMA push (report `_363` §11) ──────────────────────────────────────

const GAMMA_22 = { r: 2.2, g: 2.2, b: 2.2, w: 1 };

test('_363 §11: validateGammaCurve accepts a complete in-range curve and nothing else', () => {
  assert.deepEqual(validateGammaCurve(GAMMA_22), { r: 2.2, g: 2.2, b: 2.2, w: 1 });
  assert.notEqual(validateGammaCurve(GAMMA_22), GAMMA_22, 'a fresh object, never the caller\'s');
  // 1.0 and 3.0 are IN; either side is out.
  assert.deepEqual(validateGammaCurve({ r: 1, g: 1, b: 1, w: 1 }), { r: 1, g: 1, b: 1, w: 1 });
  assert.deepEqual(validateGammaCurve({ r: 3, g: 3, b: 3, w: 3 }), { r: 3, g: 3, b: 3, w: 3 });
  const refusals = [
    { r: 0.99, g: 2.2, b: 2.2, w: 1 },
    { r: 3.01, g: 2.2, b: 2.2, w: 1 },
    { r: 2.2, g: 2.2, b: 2.2, w: Infinity },
    { r: 2.2, g: 2.2, b: 2.2, w: NaN },
    { r: '2.2', g: 2.2, b: 2.2, w: 1 },
    { r: 2.2, g: 2.2, b: 2.2 },              // incomplete — w missing
    { r: 2.2, g: 2.2, b: 2.2, w: 1, x: 2 },  // unknown channel
    null, 'sRGB', [2.2, 2.2, 2.2, 1],
  ];
  for (const bad of refusals) {
    assert.throws(() => validateGammaCurve(bad), /\[MarsinLED\]/,
      `${JSON.stringify(bad)} must be refused`);
  }
  // The error names the channel, so a slider can point at itself.
  assert.throws(() => validateGammaCurve({ r: 2.2, g: 9, b: 2.2, w: 1 }), (err) => {
    assert.equal(err.channel, 'g');
    return /gamma\.g 9 must be a finite number/.test(err.message);
  });
});

test('_363 §11: buildGammaPushBody carries the curve and NOTHING else — golden body', () => {
  const body = buildGammaPushBody({
    snapshot: SNAPSHOT_NARROW, gamma: GAMMA_22, controllerName: 'Rope-Board', ip: '10.1.1.202',
  });
  // The snapshot carries strands, a dmx block, a swarm block AND its own gamma;
  // none of it rides along. `deviceName` is absent — the stored name is legal.
  assert.deepEqual(body, { gamma: { r: 2.2, g: 2.2, b: 2.2, w: 1 } });
  assert.deepEqual(Object.keys(body), ['gamma']);
});

test('_363 §11: buildGammaPushBody repairs an INVALID stored deviceName, and only then', () => {
  const broken = { ...SNAPSHOT_NARROW, deviceName: '' };
  assert.deepEqual(buildGammaPushBody({
    snapshot: broken, gamma: GAMMA_22, controllerName: 'Rope-Board', ip: '10.1.1.202',
  }), { gamma: GAMMA_22, deviceName: 'Rope-Board' });
  // A card name that is not a legal device name is a LOUD refusal, not a mangle.
  assert.throws(() => buildGammaPushBody({
    snapshot: broken, gamma: GAMMA_22, controllerName: 'Rope Board', ip: '10.1.1.202',
  }), /RENAME THE CONTROLLER CARD/);
  // A firmware that does not report the field is left alone.
  const silent = { ...SNAPSHOT_NARROW };
  delete silent.deviceName;
  assert.deepEqual(Object.keys(buildGammaPushBody({
    snapshot: silent, gamma: GAMMA_22, controllerName: 'Rope-Board', ip: '10.1.1.202',
  })), ['gamma']);
});

test('_363 §11: buildGammaPushBody refuses a missing snapshot and a bad curve', () => {
  assert.throws(() => buildGammaPushBody({ gamma: GAMMA_22, controllerName: 'X' }),
    /snapshot must be a GET \/api\/config document/);
  assert.throws(() => buildGammaPushBody({ snapshot: SNAPSHOT_NARROW, gamma: { r: 2.2 } }),
    /buildGammaPushBody: gamma\.g/);
  assert.throws(() => buildGammaPushBody({ snapshot: SNAPSHOT_NARROW }),
    /buildGammaPushBody: gamma must be an object/);
});

test('_363 §11: diffGammaPush is GREEN across float32 read-back noise', () => {
  // The firmware stores float32: 2.2 comes back as 2.200000047683716.
  const config = {
    gamma: { r: 2.200000047683716, g: 2.200000047683716, b: 2.200000047683716, w: 1 },
  };
  const status = { controllerId: 'rope_board' };
  assert.deepEqual(diffGammaPush(config, status, GAMMA_22, { controllerId: 'rope_board' }), []);
  // Green right up to the tolerance, red just past it.
  const edge = { gamma: { r: 2.2 + GAMMA_VERIFY_EPSILON * 0.9, g: 2.2, b: 2.2, w: 1 } };
  assert.deepEqual(diffGammaPush(edge, status, GAMMA_22), []);
  const past = { gamma: { r: 2.2 + GAMMA_VERIFY_EPSILON * 2, g: 2.2, b: 2.2, w: 1 } };
  assert.equal(diffGammaPush(past, status, GAMMA_22).length, 1);
  assert.match(diffGammaPush(past, status, GAMMA_22)[0], /gamma\.r=2\.202\d* ≠ pushed 2\.2/);
});

test('_363 §11: diffGammaPush is RED per channel, on a missing block, and on identity', () => {
  const status = { controllerId: 'rope_board' };
  assert.deepEqual(diffGammaPush({ gamma: { r: 2.2, g: 2.2, b: 1, w: 1 } }, status, GAMMA_22),
    ['gamma.b=1 ≠ pushed 2.2 (tolerance 0.001)']);
  // A board that reports no gamma block is NOT agreement.
  assert.match(diffGammaPush({}, status, GAMMA_22)[0], /reports no gamma block/);
  assert.match(diffGammaPush({ gamma: null }, status, GAMMA_22)[0], /reports no gamma block/);
  assert.match(diffGammaPush({ gamma: { r: '2.2', g: 2.2, b: 2.2, w: 1 } }, status, GAMMA_22)[0],
    /gamma\.r="2\.2" is not a number/);
  // Identity — only when the caller states one.
  const swapped = { controllerId: 'someone_else' };
  assert.deepEqual(diffGammaPush({ gamma: GAMMA_22 }, swapped, GAMMA_22), []);
  assert.match(diffGammaPush({ gamma: GAMMA_22 }, swapped, GAMMA_22,
    { controllerId: 'rope_board' })[0], /is not the same board/);
  // The gamma verify claims NOTHING about strands, dmx or swarm.
  assert.deepEqual(diffGammaPush(
    { gamma: GAMMA_22, dmx: { enabled: false }, swarm: { enabled: true }, strands: [] },
    status, GAMMA_22), []);
});

test('_363 §11: pushGammaPush posts the body byte-for-byte, with ZERO GETs', async () => {
  const body = buildGammaPushBody({
    snapshot: SNAPSHOT_NARROW, gamma: GAMMA_22, controllerName: 'Rope-Board', ip: '10.1.1.202',
  });
  const seen = [];
  await withFetch(async (url, opts) => {
    seen.push({ url, method: opts.method, body: opts.body });
    // Gamma is LIVE-APPLY: applied, no reboot.
    return jsonResponse({ status: 'ok', outcome: 'applied', reboot: false });
  }, async () => {
    const reply = await pushGammaPush('10.1.1.202', body);
    assert.equal(reply.outcome, 'applied');
    assert.equal(reply.reboot, false, 'gamma does not reboot the board');
  });
  assert.equal(seen.length, 1, 'one POST, no internal GET');
  assert.equal(seen[0].method, 'POST');
  assert.equal(seen[0].url, 'http://10.1.1.202/api/config');
  assert.deepEqual(JSON.parse(seen[0].body), body);
});

test('_363 §11: an UNANSWERED gamma write is ambiguous; an ANSWERED non-2xx is not', async () => {
  const body = buildGammaPushBody({
    snapshot: SNAPSHOT_NARROW, gamma: GAMMA_22, controllerName: 'Rope-Board', ip: '10.1.1.202',
  });
  await withFetch(neverResolvesFetch(), async () => {
    await assert.rejects(() => pushGammaPush('10.1.1.202', body, { writeTimeoutMs: 20 }),
      (err) => { assert.equal(err.writeResponseLost, true); return true; });
  });
  for (const status of [400, 409, 503]) {
    await withFetch(async () => jsonResponse(
      { status: 'error', error: 'config apply failed' },
      { ok: false, status, statusText: 'refused' },
    ), async () => {
      await assert.rejects(() => pushGammaPush('10.1.1.202', body), (err) => {
        assert.equal(err.httpStatus, status);
        assert.equal(err.writeResponseLost, undefined,
          `HTTP ${status} is a device that answered — never ambiguous`);
        return true;
      });
    });
  }
});

test('_363 §11: pushGammaPush refuses a flat timeoutMs and a body that is not a gamma body',
  async () => {
    await assert.rejects(
      () => pushGammaPush('10.1.1.202', { gamma: GAMMA_22 }, { timeoutMs: 5000 }),
      /pass \{writeTimeoutMs\}/,
    );
    await withFetch(async () => { throw new Error('fetch must not run'); }, async () => {
      for (const bad of [{ strands: [] }, { gamma: '2.2' }, { gamma: null }, {}]) {
        await assert.rejects(() => pushGammaPush('10.1.1.202', bad),
          /body must be a buildGammaPushBody\(\) result with a gamma object/);
      }
    });
  });

test('_363 §11: there is no gamma READ leg on this client, and never will be', () => {
  for (const symbol of ['getGamma', 'readGamma', 'refreshGamma', 'fetchGamma']) {
    assert.equal(symbol in marsinledClient, false,
      `${symbol} must not exist — gamma is push-only, unconditionally`);
  }
});
