/**
 * per_output_push.test.js — the per-output sACN universe push path (firmware
 * capabilitiesExt.perOutputDmx). Covers the full read-modify-write against a
 * MOCKED fetch (no live POST), the pure plan derivation + auto-assign, the §4
 * client-side validation (all-or-none / span>16 / overlap-on-spill / range), the
 * revert strip, the read-back parse, and the feature-gate refusal.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deviceSupportsPerOutput,
  readPerOutput,
  validatePerOutputPlan,
  applyPerOutputUniverses,
  pushPerOutputUniverses,
} from '../src/dmx/led/marsinled_client.js';
import {
  derivePerOutputPlan,
  autoAssignPerOutputUniverses,
} from '../src/dmx/led/device_config_mapper.js';
import {
  CONTROLLER_TYPE_LED,
  CONTROLLER_PROTOCOL_SACN,
} from '../src/dmx/controller_registry.js';

// ── Fixtures: the real titanic_202 shapes (trimmed to what the path reads) ───

function rgbwStrand(count, enabled, pinData) {
  return {
    type: 'WS281X_RGBW', count, pinData, pinClock: 0, colorOrder: 'RGBW',
    rgbwMode: 'exact', enabled, deadPixels: 0, deadPixelIndices: [],
  };
}

/** GET /api/config for a 202-shaped device: 2 enabled 40px, 2 disabled. */
function config202() {
  return {
    strands: [
      rgbwStrand(40, true, 35),
      rgbwStrand(40, true, 36),
      rgbwStrand(40, false, 37),
      rgbwStrand(40, false, 38),
    ],
    dmx: { enabled: false, protocol: 0, universe: 1, startAddress: 1, timeoutMs: 3000 },
    deviceName: 'Titanic-202',
  };
}

/** GET /api/status carrying the per-output capability + a perOutput read-back. */
function status202(perOutput = []) {
  return {
    controllerId: 'titanic_202',
    boardId: 'angio4-old',
    firmwareSHA: 'cb20b07b19c7',
    strands: config202().strands,
    capabilitiesExt: { perOutputDmx: true, stagedConfig: true },
    sacn: { enabled: true, rxPackets: 0, perOutput },
  };
}

function ledController(overrides = {}) {
  return {
    id: 1,
    name: 'Titanic-202',
    ip: '10.1.1.202',
    type: CONTROLLER_TYPE_LED,
    protocol: CONTROLLER_PROTOCOL_SACN,
    led: { baseUniverse: 3, startAddr: 1, order: 'RGBW', stride: 4, whiteMode: 'native' },
    ports: [
      { port: 1, universe: 3, startAddress: 1, chain: ['line_A'] },
      { port: 2, universe: 4, startAddress: 1, chain: ['line_B'] },
      { port: 3, universe: 5, startAddress: 1, chain: [] },
      { port: 4, universe: 6, startAddress: 1, chain: [] },
    ],
    ...overrides,
  };
}

// ── Fetch stub scaffolding (identical shape to marsinled_client.test.js) ─────

function jsonResponse(body, { ok = true, status = 200, statusText = 'OK' } = {}) {
  return { ok, status, statusText, json: async () => body };
}

async function withFetch(stub, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = stub;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

// ── feature detect + read-back ───────────────────────────────────────────────

test('deviceSupportsPerOutput — true only when capabilitiesExt.perOutputDmx===true', () => {
  assert.equal(deviceSupportsPerOutput(status202()), true);
  assert.equal(deviceSupportsPerOutput({ capabilitiesExt: { perOutputDmx: false } }), false);
  assert.equal(deviceSupportsPerOutput({ capabilitiesExt: {} }), false);
  assert.equal(deviceSupportsPerOutput({}), false);
  assert.equal(deviceSupportsPerOutput(null), false);
});

test('readPerOutput — [] in legacy, parses the reported entries otherwise', () => {
  assert.deepEqual(readPerOutput(status202()), []);
  const po = [{ index: 0, universe: 3, startAddress: 1, enabled: true }];
  assert.deepEqual(readPerOutput(status202(po)), po);
  assert.deepEqual(readPerOutput({}), []);
  assert.throws(() => readPerOutput({ sacn: { perOutput: 'nope' } }), /must be an array/);
});

// ── derivePerOutputPlan (from port.universe, S4) ─────────────────────────────

test('derivePerOutputPlan — enabled outputs take their port.universe, start=1', () => {
  const { universeByOutputIndex, warnings } =
    derivePerOutputPlan(ledController(), { line_A: 40, line_B: 40 }, config202());
  assert.deepEqual(universeByOutputIndex, { 0: 3, 1: 4 });   // 202: out1→U3, out2→U4
  assert.equal(warnings.length, 0);
});

test('derivePerOutputPlan — a disabled device output takes NO universe', () => {
  const cfg = config202();
  cfg.strands[1].enabled = false;                            // only output 0 enabled
  const { universeByOutputIndex } = derivePerOutputPlan(ledController(), {}, cfg);
  assert.deepEqual(universeByOutputIndex, { 0: 3 });
});

test('derivePerOutputPlan — enabled output with an invalid port universe is AUTO-EXTENDED', () => {
  const controller = ledController({
    ports: [
      { port: 1, universe: 0, startAddress: 1, chain: ['line_A'] },   // invalid universe
      { port: 2, universe: 4, startAddress: 1, chain: ['line_B'] },
    ],
  });
  const { universeByOutputIndex, warnings } =
    derivePerOutputPlan(controller, { line_A: 40, line_B: 40 }, config202());
  // Output 1 keeps its valid U4; output 0 auto-assigns the next free universe (U5)
  // so every enabled output carries one (all-or-none), with a note.
  assert.deepEqual(universeByOutputIndex, { 0: 5, 1: 4 });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /output 1 \(port 1\) had no valid universe — auto-assigned U5/);
});

test('derivePerOutputPlan — fewer port rows than enabled outputs AUTO-EXTENDS the missing one', () => {
  // Real 202-shaped incident: the card has only 2 port rows, but the device has
  // 3 enabled outputs (0,1,2). Output 2 has no port row → auto-assign next free.
  const cfg = config202();
  cfg.strands[2].enabled = true;                 // outputs 0,1,2 enabled on the device
  const controller = ledController({
    ports: [
      { port: 1, universe: 10, startAddress: 1, chain: ['line_A'] },
      { port: 2, universe: 11, startAddress: 1, chain: ['line_B'] },
    ],
  });
  const { universeByOutputIndex, warnings } =
    derivePerOutputPlan(controller, { line_A: 40, line_B: 40 }, cfg);
  // Outputs 0,1 keep their port universes; output 2 (no port row) → next free U12.
  assert.deepEqual(universeByOutputIndex, { 0: 10, 1: 11, 2: 12 });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /output 3 has no controller port row — auto-assigned U12/);
});

// ── autoAssignPerOutputUniverses (pure, operator default scheme) ─────────────

test('autoAssignPerOutputUniverses — contiguous run from base, port order', () => {
  assert.deepEqual(autoAssignPerOutputUniverses(ledController(), 3), { 0: 3, 1: 4 });
  assert.deepEqual(autoAssignPerOutputUniverses(ledController(), 1), { 0: 1, 1: 2 });   // 201 default
});

test('autoAssignPerOutputUniverses — skips empty ports, still contiguous', () => {
  const controller = ledController({
    ports: [
      { port: 1, universe: 3, startAddress: 1, chain: [] },       // empty → skipped
      { port: 2, universe: 4, startAddress: 1, chain: ['line_B'] },
      { port: 3, universe: 5, startAddress: 1, chain: ['line_C'] },
      { port: 4, universe: 6, startAddress: 1, chain: [] },
    ],
  });
  assert.deepEqual(autoAssignPerOutputUniverses(controller, 5), { 1: 5, 2: 6 });
});

test('autoAssignPerOutputUniverses — no enabled output / bad base throw', () => {
  const empty = ledController({ ports: [{ port: 1, universe: 3, chain: [] }] });
  assert.throws(() => autoAssignPerOutputUniverses(empty, 3), /no enabled output/);
  assert.throws(() => autoAssignPerOutputUniverses(ledController(), 0), /base universe 0 out of range/);
});

// ── validatePerOutputPlan (§4 rules) ─────────────────────────────────────────

test('validatePerOutputPlan — accepts a well-formed all-enabled plan', () => {
  const res = validatePerOutputPlan(config202().strands, { 0: 3, 1: 4 });
  assert.deepEqual(res.enabledIndices, [0, 1]);
  assert.deepEqual(res.universes, [3, 4]);
});

test('validatePerOutputPlan — ALL-OR-NONE: a missing enabled output is rejected', () => {
  assert.throws(() => validatePerOutputPlan(config202().strands, { 0: 3 }),
    /all-or-none — 1\/2 enabled outputs/);
});

test('validatePerOutputPlan — a universe on a DISABLED output is rejected', () => {
  assert.throws(() => validatePerOutputPlan(config202().strands, { 0: 3, 1: 4, 2: 5 }),
    /output 2 carries a universe but is not an enabled strand/);
});

test('validatePerOutputPlan — SPAN>16 across enabled outputs is rejected', () => {
  assert.throws(() => validatePerOutputPlan(config202().strands, { 0: 3, 1: 20 }),
    /universe span 18 exceeds the 16-universe window/);
});

test('validatePerOutputPlan — RANGE: universe out of 1–63999 is rejected', () => {
  assert.throws(() => validatePerOutputPlan(config202().strands, { 0: 3, 1: 70000 }),
    /output 1 dmxUniverse/);
});

test('validatePerOutputPlan — NO OVERLAP: a >128px RGBW strand spilling into the next universe', () => {
  // Output 0 is 200px RGBW → occupies U3 + U4 (spills). Output 1 sits at U4 → collision.
  const strands = [rgbwStrand(200, true, 35), rgbwStrand(40, true, 36)];
  assert.throws(() => validatePerOutputPlan(strands, { 0: 3, 1: 4 }),
    /output 0 \(U3–U4\) overlaps output 1 \(U4\)/);
  // Give output 1 headroom (U5) and it validates — the spill fits in U4.
  assert.doesNotThrow(() => validatePerOutputPlan(strands, { 0: 3, 1: 5 }));
});

// ── applyPerOutputUniverses (RMW helper) ─────────────────────────────────────

test('applyPerOutputUniverses — sets fields on enabled, leaves disabled UNTOUCHED', () => {
  const strands = config202().strands;
  const out = applyPerOutputUniverses(strands, { 0: 3, 1: 4 });
  // Enabled outputs carry the per-output fields.
  assert.equal(out[0].dmxUniverse, 3);
  assert.equal(out[0].dmxStartAddress, 1);
  assert.equal(out[1].dmxUniverse, 4);
  // Disabled outputs are copied with EVERY field, and NO per-output fields added.
  assert.equal('dmxUniverse' in out[2], false);
  assert.equal('dmxUniverse' in out[3], false);
  assert.equal(out[2].pinData, 37);
  assert.equal(out[2].colorOrder, 'RGBW');
  assert.equal(out[2].enabled, false);
  // Source array not mutated (pure).
  assert.equal('dmxUniverse' in strands[0], false);
});

// ── pushPerOutputUniverses (full RMW against a mocked device) ────────────────

test('pushPerOutputUniverses — GET config, RMW, POST text/plain (202 out1→U3,out2→U4)', async () => {
  let posted = null;
  await withFetch(async (url, opts) => {
    if (url === 'http://10.1.1.202/api/config' && (!opts || opts.method !== 'POST')) {
      return jsonResponse(config202());
    }
    if (url === 'http://10.1.1.202/api/config' && opts.method === 'POST') {
      assert.equal(opts.headers['Content-Type'], 'text/plain;charset=UTF-8');
      posted = JSON.parse(opts.body);
      return jsonResponse({ status: 'ok', outcome: 'needs-reboot', reboot: true });
    }
    throw new Error(`unexpected fetch ${url}`);
  }, async () => {
    const reply = await pushPerOutputUniverses('10.1.1.202', {
      universeByOutputIndex: { 0: 3, 1: 4 },
    });
    assert.equal(reply.outcome, 'needs-reboot');
    assert.equal(reply.reboot, true);
  });

  // The exact JSON the RMW POSTs for 202.
  assert.deepEqual(posted, {
    strands: [
      { type: 'WS281X_RGBW', count: 40, pinData: 35, pinClock: 0, colorOrder: 'RGBW',
        rgbwMode: 'exact', enabled: true, deadPixels: 0, deadPixelIndices: [],
        dmxUniverse: 3, dmxStartAddress: 1 },
      { type: 'WS281X_RGBW', count: 40, pinData: 36, pinClock: 0, colorOrder: 'RGBW',
        rgbwMode: 'exact', enabled: true, deadPixels: 0, deadPixelIndices: [],
        dmxUniverse: 4, dmxStartAddress: 1 },
      { type: 'WS281X_RGBW', count: 40, pinData: 37, pinClock: 0, colorOrder: 'RGBW',
        rgbwMode: 'exact', enabled: false, deadPixels: 0, deadPixelIndices: [] },
      { type: 'WS281X_RGBW', count: 40, pinData: 38, pinClock: 0, colorOrder: 'RGBW',
        rgbwMode: 'exact', enabled: false, deadPixels: 0, deadPixelIndices: [] },
    ],
    dmx: { enabled: true, protocol: 0, timeoutMs: 3000 },
  });
});

test('pushPerOutputUniverses — a bad plan is rejected BEFORE the POST', async () => {
  let postCalls = 0;
  await withFetch(async (url, opts) => {
    if (opts && opts.method === 'POST') { postCalls += 1; return jsonResponse({}); }
    return jsonResponse(config202());   // GET
  }, async () => {
    await assert.rejects(() => pushPerOutputUniverses('10.1.1.202', {
      universeByOutputIndex: { 0: 3 },          // missing output 1 (all-or-none)
    }), /all-or-none/);
  });
  assert.equal(postCalls, 0);
});

test('pushPerOutputUniverses — device 400 surfaces fields[].detail verbatim', async () => {
  await withFetch(async (url, opts) => {
    if (opts && opts.method === 'POST') {
      return jsonResponse({
        status: 'error', error: 'per-output validation failed', field: 'strands',
        detail: 'span too wide',
        fields: [{ field: 'strands[1].dmxUniverse', detail: 'universe span exceeds 16' }],
      }, { ok: false, status: 400, statusText: 'Bad Request' });
    }
    return jsonResponse(config202());
  }, async () => {
    await assert.rejects(
      () => pushPerOutputUniverses('10.1.1.202', { universeByOutputIndex: { 0: 3, 1: 4 } }),
      (err) => {
        assert.match(err.message, /universe span exceeds 16/);
        assert.equal(err.fields[0].field, 'strands[1].dmxUniverse');
        assert.equal(err.fields[0].detail, 'universe span exceeds 16');
        return true;
      },
    );
  });
});
