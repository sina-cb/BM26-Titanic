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
  readConfiguredPerOutput,
  assertMappingPushAllowed,
  validatePerOutputPlan,
  applyPerOutputPlan,
  pushPerOutputUniverses,
  deviceNameRepairForPush,
  isValidDeviceName,
} from '../src/dmx/led/marsinled_client.js';
import {
  derivePerOutputPlan,
  autoAssignPerOutputUniverses,
  collectClaimedUniverses,
} from '../src/dmx/led/device_config_mapper.js';
import {
  CONTROLLER_TYPE_LED,
  CONTROLLER_PROTOCOL_SACN,
  createControllerRegistry,
  computeProjection,
  computeLedProjection,
  parkedUniverseFor,
} from '../src/dmx/controller_registry.js';
import {
  computeLedStrandPatches,
  computeLedUniverseClaims,
  validateLedManualUniverses,
} from '../src/dmx/led/led_patch_projection.js';
import { initRegistry } from '../src/dmx/fixture_definition_registry.js';
import {
  pushAllLedControllers,
  computeSyncState,
  runPerOutputPush,
  persistAndNotifyAfterPush,
  describePushCompletion,
  describeSyncChipTooltip,
  getSyncState,
} from '../src/gui/led_discovery_panel.js';

// Registry-wide universe claims (slice S2). The cases ABOVE the S2 section plan
// a rig of one controller, where nothing else claims a universe.
const NO_CLAIMS = new Map();

/**
 * A per-output PLAN built from a bare universe map, for the cases that exercise
 * the transport / push flow rather than the derivation itself.
 * `derivePerOutputPlan` returns this shape and every consumer past the derive
 * requires it (a bare map cannot express an enable transition).
 */
function planOf(universeByOutputIndex, extra = {}) {
  return {
    universeByOutputIndex,
    assignments: [],
    parked: [],
    enables: [],
    enableOutputIndices: [],
    warnings: [],
    collisions: [],
    ...extra,
  };
}

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
    // `output` = the PHYSICAL board output the row drives (report 20260725_70).
    // These hand-built cards declare it explicitly; createControllerRegistry
    // materializes the identity default for a file that predates the field.
    ports: [
      { port: 1, output: 1, universe: 3, startAddress: 1, chain: ['line_A'] },
      { port: 2, output: 2, universe: 4, startAddress: 1, chain: ['line_B'] },
      { port: 3, output: 3, universe: 5, startAddress: 1, chain: [] },
      { port: 4, output: 4, universe: 6, startAddress: 1, chain: [] },
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

test('readConfiguredPerOutput — reads the saved strand mapping while DMX is off', () => {
  const cfg = config202();
  cfg.strands[0].dmxUniverse = 3;
  cfg.strands[0].dmxStartAddress = 1;
  assert.deepEqual(readConfiguredPerOutput(cfg)[0],
    { index: 0, universe: 3, startAddress: 1, enabled: true });
});

test('mapping push refuses active or desired DMX mode', () => {
  assert.throws(() => assertMappingPushAllowed({ dmxOwnsOutput: true }, config202()),
    /mapping push refused.*show-mode workflow/);
  const desired = config202();
  desired.dmx.enabled = true;
  assert.throws(() => assertMappingPushAllowed({ dmxOwnsOutput: false }, desired),
    /mapping push refused.*show-mode workflow/);
  assert.doesNotThrow(() =>
    assertMappingPushAllowed({ dmxOwnsOutput: false }, config202()));
});

// ── derivePerOutputPlan (from port.universe, S4) ─────────────────────────────

test('derivePerOutputPlan — enabled outputs take their port.universe, start=1', () => {
  const { universeByOutputIndex, warnings } =
    derivePerOutputPlan(ledController(), { line_A: 40, line_B: 40 }, config202(), NO_CLAIMS);
  assert.deepEqual(universeByOutputIndex, { 0: 3, 1: 4 });   // 202: out1→U3, out2→U4
  assert.equal(warnings.length, 0);
});

test('derivePerOutputPlan — a disabled device output takes NO universe', () => {
  const cfg = config202();
  cfg.strands[1].enabled = false;                            // only output 0 enabled
  const { universeByOutputIndex } = derivePerOutputPlan(ledController(), {}, cfg, NO_CLAIMS);
  assert.deepEqual(universeByOutputIndex, { 0: 3 });
});

test('derivePerOutputPlan — enabled output with an invalid port universe is AUTO-EXTENDED', () => {
  const controller = ledController({
    ports: [
      { port: 1, output: 1, universe: 0, startAddress: 1, chain: ['line_A'] }, // invalid universe
      { port: 2, output: 2, universe: 4, startAddress: 1, chain: ['line_B'] },
    ],
  });
  const { universeByOutputIndex, warnings } =
    derivePerOutputPlan(controller, { line_A: 40, line_B: 40 }, config202(), NO_CLAIMS);
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
      { port: 1, output: 1, universe: 10, startAddress: 1, chain: ['line_A'] },
      { port: 2, output: 2, universe: 11, startAddress: 1, chain: ['line_B'] },
    ],
  });
  const { universeByOutputIndex, parked, warnings } =
    derivePerOutputPlan(controller, { line_A: 40, line_B: 40 }, cfg, NO_CLAIMS);
  // Outputs 0,1 keep their port universes; output 2 (no port row) is PARKED on
  // the next free universe — enabled on the board, nothing routed to it.
  assert.deepEqual(universeByOutputIndex, { 0: 10, 1: 11, 2: 12 });
  assert.deepEqual(parked, [{ outputIndex: 2, universe: 12, reused: false }]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /output 3 has no controller port row — PARKED on U12/);
});

// ── autoAssignPerOutputUniverses (pure, operator default scheme) ─────────────

test('autoAssignPerOutputUniverses — contiguous run from base, port order', () => {
  assert.deepEqual(autoAssignPerOutputUniverses(ledController(), 3), { 0: 3, 1: 4 });
  assert.deepEqual(autoAssignPerOutputUniverses(ledController(), 1), { 0: 1, 1: 2 });   // 201 default
});

test('autoAssignPerOutputUniverses — skips empty ports, still contiguous', () => {
  const controller = ledController({
    ports: [
      { port: 1, output: 1, universe: 3, startAddress: 1, chain: [] },   // empty → skipped
      { port: 2, output: 2, universe: 4, startAddress: 1, chain: ['line_B'] },
      { port: 3, output: 3, universe: 5, startAddress: 1, chain: ['line_C'] },
      { port: 4, output: 4, universe: 6, startAddress: 1, chain: [] },
    ],
  });
  assert.deepEqual(autoAssignPerOutputUniverses(controller, 5), { 1: 5, 2: 6 });
});

test('autoAssignPerOutputUniverses — no enabled output / bad base throw', () => {
  const empty = ledController({ ports: [{ port: 1, output: 1, universe: 3, chain: [] }] });
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

// ── applyPerOutputPlan (RMW helper) ──────────────────────────────────────────

test('applyPerOutputPlan — sets fields on enabled, leaves disabled UNTOUCHED', () => {
  const strands = config202().strands;
  const out = applyPerOutputPlan(strands, planOf({ 0: 3, 1: 4 }));
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

test('pushPerOutputUniverses — mapping POST is mode-neutral (202 out1→U3,out2→U4)', async () => {
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
      plan: planOf({ 0: 3, 1: 4 }),
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
  });
  assert.equal('dmx' in posted, false, 'a mapping push must never change show mode');
});

// ── deviceName repair (report 20260725_124) ─────────────────────────────────
//
// THE BUG, live 2026-08-03: pushing per-output universes to the bench board at
// 10.x.x.60 failed with `config apply failed (field=deviceName) — 1-32 chars,
// letters/digits/-._ only`, even though the POST body contained ONLY `strands`
// and `dmx`. Root cause: the board stores `deviceName: ""` and the firmware
// re-validates the WHOLE merged config on every apply, so it rejects every
// write — a no-op gamma write to the same box returned the identical 400.
// These cases pin the payload-construction seam (no device needed).

test('_124: isValidDeviceName — the firmware rule, verbatim', () => {
  assert.equal(isValidDeviceName('LeftLeftRopes'), true);
  assert.equal(isValidDeviceName('Titanic-201'), true);
  assert.equal(isValidDeviceName('a.b_c-1'), true);
  assert.equal(isValidDeviceName(''), false);             // ← the live failure
  assert.equal(isValidDeviceName('Left Left Ropes'), false);  // spaces are illegal
  assert.equal(isValidDeviceName('x'.repeat(33)), false);     // >32
  assert.equal(isValidDeviceName('x'.repeat(32)), true);
  assert.equal(isValidDeviceName(undefined), false);
  assert.equal(isValidDeviceName(null), false);
});

test('_124: deviceNameRepairForPush — a VALID stored name is left alone', () => {
  assert.equal(deviceNameRepairForPush({
    ip: '10.0.0.60', storedName: 'LeftLeftFront', controllerName: 'LeftLeftRopes',
  }), null);
});

test('_124: deviceNameRepairForPush — an ABSENT field is never invented', () => {
  assert.equal(deviceNameRepairForPush({
    ip: '10.0.0.60', storedName: undefined, controllerName: 'LeftLeftRopes',
  }), null);
});

test('_124: deviceNameRepairForPush — an EMPTY stored name is repaired with the card name', () => {
  const repair = deviceNameRepairForPush({
    ip: '10.0.0.60', storedName: '', controllerName: 'LeftLeftRopes',
  });
  assert.equal(repair.from, '');
  assert.equal(repair.to, 'LeftLeftRopes');   // VERBATIM — never sanitized
  assert.match(repair.message, /reject every config write/);
});

test('_124: deviceNameRepairForPush — an unusable card name FAILS LOUD, naming the rename', () => {
  assert.throws(() => deviceNameRepairForPush({
    ip: '10.0.0.60', storedName: '', controllerName: 'Left Left Ropes',
  }), (err) => {
    assert.match(err.message, /RENAME THE CONTROLLER CARD/);
    assert.match(err.message, /'Left Left Ropes' is not a legal device name/);
    assert.match(err.message, /1-32 chars, letters\/digits\/-\._ only/);
    return true;
  });
  // …and it never silently substitutes a sanitized name.
  assert.throws(() => deviceNameRepairForPush({
    ip: '10.0.0.60', storedName: '', controllerName: 'x'.repeat(33),
  }), /RENAME THE CONTROLLER CARD/);
  assert.throws(() => deviceNameRepairForPush({
    ip: '10.0.0.60', storedName: '', controllerName: undefined,
  }), /no card name was supplied/);
});

test('_124: derivePerOutputPlan carries the card name (the push repairs deviceName with it)', () => {
  const plan = derivePerOutputPlan(ledController({ name: 'LeftLeftRopes' }),
    { line_A: 40, line_B: 40 }, config202(), NO_CLAIMS);
  assert.equal(plan.controllerName, 'LeftLeftRopes');
});

test('_124: pushPerOutputUniverses — an empty stored deviceName is REPAIRED in the POST body',
  async () => {
    let posted = null;
    const cfg = config202();
    cfg.deviceName = '';                       // ← exactly what the live board stores
    await withFetch(async (url, opts) => {
      if (opts && opts.method === 'POST') {
        posted = JSON.parse(opts.body);
        return jsonResponse({ status: 'ok', outcome: 'needs-reboot', reboot: true });
      }
      return jsonResponse(cfg);
    }, async () => {
      await pushPerOutputUniverses('10.1.1.202', {
        plan: planOf({ 0: 3, 1: 4 }, { controllerName: 'LeftLeftRopes' }),
      });
    });
    assert.equal(posted.deviceName, 'LeftLeftRopes');
    // The rest of the body is untouched by the repair.
    assert.equal('dmx' in posted, false);
    assert.equal(posted.strands.length, 4);
    assert.equal(posted.strands[0].dmxUniverse, 3);
  });

test('_124: pushPerOutputUniverses — a VALID stored name is never rewritten', async () => {
  let posted = null;
  await withFetch(async (url, opts) => {
    if (opts && opts.method === 'POST') {
      posted = JSON.parse(opts.body);
      return jsonResponse({ status: 'ok', outcome: 'needs-reboot', reboot: true });
    }
    return jsonResponse(config202());          // deviceName 'Titanic-202'
  }, async () => {
    await pushPerOutputUniverses('10.1.1.202', {
      plan: planOf({ 0: 3, 1: 4 }, { controllerName: 'SomeOtherName' }),
    });
  });
  assert.equal('deviceName' in posted, false);
});

test('_124: pushPerOutputUniverses — an unrepairable name refuses BEFORE the POST', async () => {
  let postCalls = 0;
  const cfg = config202();
  cfg.deviceName = '';
  await withFetch(async (url, opts) => {
    if (opts && opts.method === 'POST') { postCalls += 1; return jsonResponse({}); }
    return jsonResponse(cfg);
  }, async () => {
    await assert.rejects(() => pushPerOutputUniverses('10.1.1.202', {
      plan: planOf({ 0: 3, 1: 4 }, { controllerName: 'Left Left Ropes' }),
    }), /RENAME THE CONTROLLER CARD/);
  });
  assert.equal(postCalls, 0);        // the device is never written on a refusal
});

test('pushPerOutputUniverses — a bad plan is rejected BEFORE the POST', async () => {
  let postCalls = 0;
  await withFetch(async (url, opts) => {
    if (opts && opts.method === 'POST') { postCalls += 1; return jsonResponse({}); }
    return jsonResponse(config202());   // GET
  }, async () => {
    await assert.rejects(() => pushPerOutputUniverses('10.1.1.202', {
      plan: planOf({ 0: 3 }),                   // missing output 1 (all-or-none)
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
      () => pushPerOutputUniverses('10.1.1.202', { plan: planOf({ 0: 3, 1: 4 }) }),
      (err) => {
        assert.match(err.message, /universe span exceeds 16/);
        assert.equal(err.fields[0].field, 'strands[1].dmxUniverse');
        assert.equal(err.fields[0].detail, 'universe span exceeds 16');
        return true;
      },
    );
  });
});

// ── Slice S2: registry-aware per-output plan gate (report 20260725_58 §4) ─────
// The live defect: a push auto-extended the .60 controller's third (enabled but
// unmapped) output onto U23 — the universe LeftFrontDeck already owns for the
// Left Front Rails DMX chain — because the auto-extender's `used` set only ever
// held THIS device's universes. The gate makes "free" mean free across the WHOLE
// registry, and turns an EXPLICIT collision into a blocking refusal.

initRegistry({ UkingPar: { fixture_type: 'UkingPar', channel_mode: 10 } });

const RAILS_CONFIGS = new Map([
  ['Left Front Rails 1', { name: 'Left Front Rails 1', group: 'Rails', fixtureType: 'UkingPar' }],
]);

const STRAND_COUNTS = new Map([['Left_Front_Left', 40], ['Left_Back_Left', 40]]);

/** GET /api/config for the .60: 3 ENABLED outputs, while the card maps only two. */
function config60() {
  const cfg = config202();
  cfg.strands[2].enabled = true;
  cfg.deviceName = 'LeftLeftFront';
  return cfg;
}

function config60WithMapping(mapping = {}) {
  const cfg = config60();
  for (const [index, universe] of Object.entries(mapping)) {
    cfg.strands[Number(index)].dmxUniverse = universe;
    cfg.strands[Number(index)].dmxStartAddress = 1;
  }
  return cfg;
}

function status60(perOutput = []) {
  return {
    controllerId: 'titanic_60', boardId: 'angio4', firmwareSHA: 'aa11bb22cc33',
    strands: config60().strands,
    capabilitiesExt: { perOutputDmx: true },
    sacn: { enabled: true, perOutput },
  };
}

/**
 * The live rig slice: a DMX controller owning U23 (Left Front Rails) plus the
 * hand-added LED card on U21/U22 whose device has a third enabled output.
 * `ledPort2Universe` lets a case park an EXPLICIT port universe on that claim.
 */
function liveReproRegistry({ ledPort2Universe = 22 } = {}) {
  return createControllerRegistry({
    controllers: [
      {
        id: 11, name: 'LeftFrontDeck', ip: '10.0.0.11',
        ports: [{ port: 1, universe: 23, chain: [{ fixture: 'Left Front Rails 1', at: 1 }] }],
      },
      {
        id: 60, name: 'LeftLeftFront', ip: '10.0.0.60', type: CONTROLLER_TYPE_LED,
        protocol: CONTROLLER_PROTOCOL_SACN,
        led: { order: 'RGBW', startAddr: 1 },
        device: { vendor: 'marsinled', controllerId: 'titanic_60', deviceName: 'LeftLeftFront' },
        ports: [
          { port: 1, universe: 21, chain: ['Left_Front_Left'] },
          { port: 2, universe: ledPort2Universe, chain: ['Left_Back_Left'] },
        ],
      },
    ],
  });
}

/** EXACTLY what controller_map_editor's ledCtx threads into the panel. */
function claimsFor(registry, controller) {
  const proj = computeProjection(registry, RAILS_CONFIGS, {});
  const bound = computeLedStrandPatches(registry, STRAND_COUNTS).fields;
  const generic = computeLedProjection(registry, STRAND_COUNTS).fields;
  const unbound = new Map();
  for (const [name, rec] of generic) if (!bound.has(name)) unbound.set(name, rec);
  return collectClaimedUniverses(controller, {
    dmxUniverseMaps: proj.universeMaps,
    ledClaims: computeLedUniverseClaims(bound, unbound),
    controllers: registry.controllers,
  });
}

test('S2: collectClaimedUniverses — other controllers claim U23, the card never claims itself', () => {
  const registry = liveReproRegistry();
  const card = registry.controllers[1];
  const claimed = claimsFor(registry, card);

  // The DMX chain's universe, labelled with BOTH sides of the future refusal.
  assert.equal(claimed.get(23), 'LeftFrontDeck port 1');
  // The card's OWN per-output universes are NOT claims against itself — otherwise
  // every push of an already-mapped card would refuse.
  assert.equal(claimed.has(21), false);
  assert.equal(claimed.has(22), false);
});

test('S2: collectClaimedUniverses — LED claims resolve their owner by PANEL ORDINAL', () => {
  const registry = liveReproRegistry();
  const deck = registry.controllers[0];        // planning the DMX controller instead
  const claimed = collectClaimedUniverses(deck, {
    dmxUniverseMaps: computeProjection(registry, RAILS_CONFIGS, {}).universeMaps,
    ledClaims: computeLedUniverseClaims(
      computeLedStrandPatches(registry, STRAND_COUNTS).fields, new Map()),
    controllers: registry.controllers,
  });
  // The LED card's strands are claims from the deck's point of view; LED claims
  // key their owner by ordinal (docs/33 decision 20), resolved here to the name.
  assert.equal(claimed.get(21), "LeftLeftFront port 1 (LED strand 'Left_Front_Left')");
  assert.equal(claimed.get(22), "LeftLeftFront port 2 (LED strand 'Left_Back_Left')");
  assert.equal(claimed.has(23), false);        // the deck's own DMX chain
});

test('S2: collectClaimedUniverses — a controller outside the registry array is REFUSED', () => {
  const registry = liveReproRegistry();
  assert.throws(() => collectClaimedUniverses({ id: 99, name: 'ghost' }, {
    dmxUniverseMaps: new Map(), ledClaims: new Map(), controllers: registry.controllers,
  }), /not in the registry controllers array/);
});

test('S2: the LIVE repro — the PARK skips a universe another controller owns', () => {
  const registry = liveReproRegistry();
  const card = registry.controllers[1];
  const { universeByOutputIndex, parked, warnings, collisions } =
    derivePerOutputPlan(card, STRAND_COUNTS, config60(), claimsFor(registry, card));

  // Pre-S2 this produced { 2: 23 } — LeftFrontDeck's universe. The park picks
  // the lowest universe free across the WHOLE registry inside the window.
  assert.deepEqual(universeByOutputIndex, { 0: 21, 1: 22, 2: 24 });
  assert.deepEqual(parked, [{ outputIndex: 2, universe: 24, reused: false }]);
  assert.deepEqual(collisions, []);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /output 3 has no controller port row — PARKED on U24/);
});

// Operator order 2026-07-31 (report 20260725_102) REPLACED the old
// `universe_owned` BLOCKING collision with a shared-address WARNING. What
// changed is only the verdict: the same overlap is still detected, still named,
// and still surfaced everywhere the plan is shown — it just no longer refuses
// the push, because the wire-side merge (src/dmx/address_merge.js) resolves it.
test('S2: an EXPLICIT port universe on another controller is a SHARED-ADDRESS WARNING', () => {
  const registry = liveReproRegistry({ ledPort2Universe: 23 });   // operator typed U23
  const card = registry.controllers[1];
  const { collisions, sharedUniverses, warnings } =
    derivePerOutputPlan(card, STRAND_COUNTS, config60(), claimsFor(registry, card));

  assert.equal(collisions.length, 0, 'a shared universe must NOT block the push any more');
  assert.equal(sharedUniverses.length, 1);
  assert.equal(sharedUniverses[0].outputIndex, 1);
  assert.equal(sharedUniverses[0].port, 2);
  assert.equal(sharedUniverses[0].universe, 23);
  assert.match(sharedUniverses[0].message, /shares U23 with LeftFrontDeck port 1/);
  assert.match(sharedUniverses[0].message, /higher controller IP overrides/);
  // Mirrored into `warnings` so no surface can show the plan and hide the share.
  assert.ok(warnings.some((w) => /⚠ .*shares U23 with LeftFrontDeck port 1/.test(w)));
});

test('S2: the park walks PAST a run of claimed universes', () => {
  const cfg = config202();
  cfg.strands[2].enabled = true;
  cfg.strands[3].enabled = true;                 // 4 enabled outputs, 2 port rows
  const controller = ledController({
    ports: [
      { port: 1, output: 1, universe: 10, startAddress: 1, chain: ['line_A'] },
      { port: 2, output: 2, universe: 11, startAddress: 1, chain: ['line_B'] },
    ],
  });
  const claimed = new Map([[12, 'Deck A port 1'], [13, 'Deck A port 2'], [15, 'Deck B port 1']]);
  const { universeByOutputIndex, parked, collisions } =
    derivePerOutputPlan(controller, { line_A: 40, line_B: 40 }, cfg, claimed);
  assert.deepEqual(universeByOutputIndex, { 0: 10, 1: 11, 2: 14, 3: 16 });
  assert.deepEqual(parked, [
    { outputIndex: 2, universe: 14, reused: false },
    { outputIndex: 3, universe: 16, reused: false },
  ]);
  assert.deepEqual(collisions, []);
});

test('S2: deriving WITHOUT a claim index is refused (never plan registry-blind)', () => {
  assert.throws(() => derivePerOutputPlan(ledController(), {}, config202()),
    /claimedUniverses is required/);
  assert.throws(() => derivePerOutputPlan(ledController(), {}, config202(), [21, 22]),
    /claimedUniverses is required/);   // an array has no .has()
});

// ── S2 through the push flow (no device is written on a refusal) ─────────────

function makeGateCtx(registry) {
  return {
    registry: () => registry,
    strandLedCounts: () => STRAND_COUNTS,
    claimedUniverses: (controller) => claimsFor(registry, controller),
    mutate: (_msg, fn) => fn(),
    refresh: () => {},
    showToast: () => {},
    activeScene: () => 's2_gate',
  };
}

function makeGateIo(calls) {
  return {
    getStatus: async (ip) => {
      calls.push(`getStatus:${ip}`);
      // Report back whatever the last push wrote, so verify passes on a real push.
      return status60(calls.lastPlan
        ? Object.entries(calls.lastPlan).map(([index, universe]) =>
          ({ index: Number(index), universe, startAddress: 1, enabled: true }))
        : []);
    },
    getConfig: async (ip) => {
      calls.push(`getConfig:${ip}`);
      return config60WithMapping(calls.lastPlan || {});
    },
    pushPerOutputUniverses: async (ip, { plan }) => {
      calls.push(`push:${ip}`);
      calls.lastPlan = plan.universeByOutputIndex;
      calls.lastFullPlan = plan;
      return { outcome: 'needs-reboot', reboot: true };
    },
    awaitReboot: async (ip) => { calls.push(`awaitReboot:${ip}`); },
  };
}

test('_102: pushAllLedControllers PUSHES a shared-universe card, loudly', async () => {
  const registry = liveReproRegistry({ ledPort2Universe: 23 });
  const calls = [];
  const results = await pushAllLedControllers(makeGateCtx(registry), makeGateIo(calls));

  // Only the LED card is a push target (the DMX controller is not an LED card).
  assert.equal(results.length, 1);
  assert.equal(results[0].state, 'pushed', 'a shared address no longer refuses the push');
  assert.match(results[0].detail, /shared address \(allowed\)/);
  assert.match(results[0].detail, /shares U23 with LeftFrontDeck port 1/);
  assert.ok(calls.includes('push:10.0.0.60'), 'the device IS written — the share is a warning');
});

test('S2: a registry-free card still pushes (the gate only blocks real collisions)', async () => {
  const registry = liveReproRegistry();          // U21/U22, third output auto-extends to U24
  const calls = [];
  const results = await pushAllLedControllers(makeGateCtx(registry), makeGateIo(calls));
  assert.equal(results[0].state, 'pushed');
  assert.ok(calls.includes('push:10.0.0.60'));
  assert.deepEqual(calls.lastPlan, { 0: 21, 1: 22, 2: 24 });
});

test('mapping fleet refuses active or desired DMX before repairing the card or writing', async () => {
  for (const mode of ['active', 'desired']) {
    const registry = liveReproRegistry();
    const card = registry.controllers[1];
    card.ports[0].universe = 0;
    const calls = [];
    const config = config60();
    config.dmx.enabled = mode === 'desired';
    const io = {
      getStatus: async () => {
        calls.push('getStatus');
        return { ...status60(), dmxOwnsOutput: mode === 'active' };
      },
      getConfig: async () => { calls.push('getConfig'); return config; },
      pushPerOutputUniverses: async () => { calls.push('push'); },
    };

    const results = await pushAllLedControllers(makeGateCtx(registry), io);
    assert.equal(results[0].state, 'failed');
    assert.match(results[0].detail, /mapping push refused.*show-mode workflow/);
    assert.equal(calls.includes('push'), false);
    assert.equal(card.ports[0].universe, 0, 'mode refusal must happen before plan repair');
  }
});

// ── S2: the sync chip derives with the SAME claims as the push ───────────────

test('S2: the sync chip does NOT false-drift — same claims ⇒ same plan as the push', async () => {
  const registry = liveReproRegistry();
  const card = registry.controllers[1];
  // The device carries exactly what a post-gate push writes: U21/U22 + U24.
  const confirmed = [
    { index: 0, universe: 21, startAddress: 1, enabled: true },
    { index: 1, universe: 22, startAddress: 1, enabled: true },
    { index: 2, universe: 24, startAddress: 1, enabled: true },
  ];
  await withFetch(async (url) => {
    if (url === 'http://10.0.0.60/api/config') {
      return jsonResponse(config60WithMapping({ 0: 21, 1: 22, 2: 24 }));
    }
    if (url === 'http://10.0.0.60/api/status') return jsonResponse(status60(confirmed));
    throw new Error(`unexpected fetch ${url}`);
  }, async () => {
    const state = await computeSyncState(makeGateCtx(registry), card);
    assert.deepEqual(state, { state: 'in-sync' });

    // Same device, chip deriving registry-BLIND (the pre-S2 behaviour): it plans
    // U23 for output 3 and reports drift the push would never resolve.
    const blindCtx = { ...makeGateCtx(registry), claimedUniverses: () => new Map() };
    const blind = await computeSyncState(blindCtx, card);
    assert.equal(blind.state, 'drift');
    assert.deepEqual(blind.changes, [{ path: 'output 2', from: 'U24', to: 'U23' }]);
  });
});

test('_102: the sync chip stays IN-SYNC on a shared universe but CARRIES the warning', async () => {
  const registry = liveReproRegistry({ ledPort2Universe: 23 });
  const card = registry.controllers[1];
  // The plan a push WOULD write: P1→U21, P2→U23 (the shared one), and the third
  // board output PARKED on U22 — the lowest universe free across the registry.
  const confirmed = [
    { index: 0, universe: 21, startAddress: 1, enabled: true },
    { index: 1, universe: 23, startAddress: 1, enabled: true },
    { index: 2, universe: 22, startAddress: 1, enabled: true },
  ];
  await withFetch(async (url) => {
    if (url === 'http://10.0.0.60/api/config') {
      return jsonResponse(config60WithMapping({ 0: 21, 1: 23, 2: 22 }));
    }
    if (url === 'http://10.0.0.60/api/status') return jsonResponse(status60(confirmed));
    throw new Error(`unexpected fetch ${url}`);
  }, async () => {
    const state = await computeSyncState(makeGateCtx(registry), card);
    // The device MATCHES the plan, and a shared address no longer makes the plan
    // unpushable — so the chip agrees with the push by saying in-sync. The
    // warning still rides in the detail (and therefore the chip tooltip).
    assert.equal(state.state, 'in-sync');
    assert.match(state.detail, /shared address \(allowed\)/);
    assert.match(state.detail, /shares U23 with LeftFrontDeck port 1/);
  });
});

// ── Slice S1: the push completes the loop (report 20260725_58 §5) ────────────
// A device write moves ONE state layer. The sACN feed the hardware actually
// receives comes from patches.yaml + the engine model ON DISK, which only a
// scene save writes (auto-save is off) and which the bridge only re-reads when
// it is notified. So the push continues past the device: save, THEN notify —
// and reports each step. Nothing here saves a scene or touches a device: the
// `io` bag's persistScene/notifyBridge are mocked exactly like the device calls.

/** A single bound LED card on U21/U22, as the live rig has it. */
function s1Registry() {
  return createControllerRegistry({
    controllers: [{
      id: 60, name: 'LeftLeftFront', ip: '10.0.0.60', type: CONTROLLER_TYPE_LED,
      protocol: CONTROLLER_PROTOCOL_SACN,
      led: { order: 'RGBW', startAddr: 1 },
      device: { vendor: 'marsinled', controllerId: 'titanic_60', deviceName: 'LeftLeftFront' },
      ports: [
        { port: 1, universe: 21, chain: ['Left_Front_Left'] },
        { port: 2, universe: 22, chain: ['Left_Back_Left'] },
      ],
    }],
  });
}

function makeS1Ctx(registry, toasts) {
  return {
    registry: () => registry,
    strandLedCounts: () => STRAND_COUNTS,
    claimedUniverses: () => new Map(),
    mutate: (_msg, fn) => fn(),
    refresh: () => {},
    showToast: (msg, opts) => { toasts.push({ msg, ...(opts || {}) }); },
    activeScene: () => 's1_loop',
  };
}

/**
 * Device I/O + the two completion steps, all mocked. `save` / `notify` are the
 * values those steps resolve with (or a function to call — used to answer with
 * nothing, or to throw).
 */
function makeS1Io(calls, {
  save = { ok: true }, notify = { ok: true },
  confirm = { ok: true, detail: 'U21,U22→10.0.0.60' },
  failPush = false,
} = {}) {
  const answer = (v) => (typeof v === 'function' ? v() : v);
  return {
    pushPerOutputUniverses: async (_ip, { plan }) => {
      calls.push('push');
      if (failPush) throw new Error('device rejected: HTTP 400');
      calls.lastPlan = plan.universeByOutputIndex;
      calls.lastFullPlan = plan;
      return { outcome: 'needs-reboot', reboot: true };
    },
    awaitReboot: async () => { calls.push('awaitReboot'); },
    getStatus: async () => {
      calls.push('getStatus');
      return status60(Object.entries(calls.lastPlan || {}).map(([index, universe]) =>
        ({ index: Number(index), universe, startAddress: 1, enabled: true })));
    },
    getConfig: async () => {
      calls.push('getConfig');
      return config60WithMapping(calls.lastPlan || {});
    },
    persistScene: async () => { calls.push('persistScene'); return answer(save); },
    notifyBridge: async () => { calls.push('notifyBridge'); return answer(notify); },
    confirmBridgeRoutes: async (expectations) => {
      calls.push('confirmRoutes');
      calls.lastExpectations = expectations;
      return answer(confirm);
    },
  };
}

/** The push dialog's three live nodes, DOM-free (textContent/className/disabled). */
function makeS1Ui() {
  return {
    statusLine: { textContent: '', className: '' },
    confirmBtn: { disabled: false },
    cancelBtn: { disabled: false, textContent: 'Cancel' },
  };
}

/**
 * The plan `runPerOutputPush` now takes: the whole `derivePerOutputPlan` result,
 * not a bare universe map. A bare map cannot say which outputs a push must
 * ENABLE, which is why the transport refuses one.
 */
const S1_PLAN = planOf({ 0: 21, 1: 22 }, {
  assignments: [
    { outputIndex: 0, portNum: 1, universe: 21, pixelCount: 40 },
    { outputIndex: 1, portNum: 2, universe: 22, pixelCount: 40 },
  ],
});

test('S1: a successful push persists THEN notifies, and reports all three steps', async () => {
  const registry = s1Registry();
  const calls = [];
  const toasts = [];
  const ui = makeS1Ui();
  await runPerOutputPush(makeS1Ctx(registry, toasts), registry.controllers[0], S1_PLAN,
    makeS1Io(calls), ui);

  // ORDERING is the whole point: the bridge must be told to re-read patches.yaml
  // only AFTER the save that wrote it (never on a timer — report §7.2).
  const iPush = calls.indexOf('push');
  const iSave = calls.indexOf('persistScene');
  const iNotify = calls.indexOf('notifyBridge');
  const iConfirm = calls.indexOf('confirmRoutes');
  assert.ok(iPush >= 0 && iSave > iPush, 'the save runs after the device write');
  assert.ok(iNotify > iSave, 'the bridge is notified only after the save resolves');
  assert.ok(iConfirm > iNotify, 'the route table is read back only after the notify resolved');
  assert.equal(calls.filter((c) => c === 'persistScene').length, 1, 'exactly one save');

  // _127: the expectation handed to the read-back is the plan's own routes.
  assert.equal(calls.lastExpectations.length, 1);
  assert.deepEqual(calls.lastExpectations[0].expected, [21, 22]);
  assert.equal(calls.lastExpectations[0].ip, '10.0.0.60');

  assert.equal(ui.statusLine.textContent,
    '✓ device written + verified · ✓ scene saved (patches projected) · ' +
    '✓ bridge routes confirmed (U21,U22→10.0.0.60)');
  assert.equal(ui.statusLine.className, 'led-push-status led-push-ok');
  assert.equal(ui.cancelBtn.textContent, 'Done');
  assert.equal(toasts[0].error, false);
});

test('S1: a 500 from the save server is RED, names the stale layer, and never notifies', async () => {
  const registry = s1Registry();
  const calls = [];
  const toasts = [];
  const ui = makeS1Ui();
  await runPerOutputPush(makeS1Ctx(registry, toasts), registry.controllers[0], S1_PLAN,
    makeS1Io(calls, { save: { ok: false, reason: 'save server responded 500' } }), ui);

  assert.equal(calls.includes('notifyBridge'), false,
    'notifying after a failed save would only re-read the STALE patches.yaml');
  assert.equal(calls.includes('confirmRoutes'), false,
    'nothing to read back — the bridge was never notified');
  assert.equal(ui.statusLine.className, 'led-push-status led-push-error');
  assert.match(ui.statusLine.textContent, /✋ scene NOT saved: save server responded 500/);
  assert.match(ui.statusLine.textContent,
    /the device WAS written \(cannot be rolled back\); the sACN feed was NOT updated: scene save/);
  assert.match(ui.statusLine.textContent, /LEDs will not follow until a successful save\./);
  assert.equal(ui.cancelBtn.textContent, 'Close');
  assert.equal(toasts[0].error, true);
  assert.match(toasts[0].msg, /the device WAS written but the sACN feed was NOT updated/);
});

test('S1: a save aborted by the model export (duplicate fixture names) surfaces verbatim', async () => {
  // The standing operator item (TE Sign V3 A/B): saveModelJS throws → exportConfig
  // aborts the WHOLE save. That abort must reach the push dialog, not vanish.
  const registry = s1Registry();
  const calls = [];
  const ui = makeS1Ui();
  await runPerOutputPush(makeS1Ctx(registry, []), registry.controllers[0], S1_PLAN,
    makeS1Io(calls, {
      save: { ok: false,
        reason: "model/sidecar export failed — nothing saved: duplicate fixture name 'TE Sign V3'" },
    }), ui);
  assert.match(ui.statusLine.textContent, /duplicate fixture name 'TE Sign V3'/);
  assert.equal(calls.includes('notifyBridge'), false);
});

test('S1: a failed bridge notify is RED — a disconnected WS is a failure, not a warning', async () => {
  const registry = s1Registry();
  const calls = [];
  const toasts = [];
  const ui = makeS1Ui();
  await runPerOutputPush(makeS1Ctx(registry, toasts), registry.controllers[0], S1_PLAN,
    makeS1Io(calls, {
      notify: { ok: false,
        reason: 'sACN bridge WebSocket not connected — the bridge did NOT reload its routes' },
    }), ui);

  assert.ok(calls.includes('persistScene'));
  assert.equal(calls.includes('confirmRoutes'), false,
    'a failed notify must not be followed by a route read-back that measures the old world');
  assert.equal(ui.statusLine.className, 'led-push-status led-push-error');
  assert.match(ui.statusLine.textContent, /✓ scene saved \(patches projected\)/);
  assert.match(ui.statusLine.textContent,
    /✋ bridge NOT notified: sACN bridge WebSocket not connected/);
  assert.match(ui.statusLine.textContent,
    /the device WAS written \(cannot be rolled back\); the sACN feed was NOT updated: bridge notify/);
  assert.equal(toasts[0].error, true);
});

test('S1: the sync chip stays in-sync but SAYS the feed is stale after a failed completion', async () => {
  const registry = s1Registry();
  const card = registry.controllers[0];
  const ctx = makeS1Ctx(registry, []);
  await runPerOutputPush(ctx, card, S1_PLAN,
    makeS1Io([], { save: { ok: false, reason: 'save server responded 500' } }), makeS1Ui());
  const chip = getSyncState(ctx, card.id);
  // device ≡ plan is literally true (that is all the chip measures), but the
  // tooltip must not let that read as "the LEDs are following".
  assert.equal(chip.state, 'in-sync');
  assert.match(chip.detail, /the sACN feed is STALE — scene save failed/);
});

test('S1: a FAILED device write never saves or notifies (nothing to project)', async () => {
  const registry = s1Registry();
  const calls = [];
  const ui = makeS1Ui();
  await runPerOutputPush(makeS1Ctx(registry, []), registry.controllers[0], S1_PLAN,
    makeS1Io(calls, { failPush: true }), ui);
  assert.match(ui.statusLine.textContent, /per-output push failed: device rejected: HTTP 400/);
  assert.equal(calls.includes('persistScene'), false);
  assert.equal(calls.includes('notifyBridge'), false);
});

test('S1: a step that answers with nothing is a REFUSAL, not an assumed success', async () => {
  const steps = await persistAndNotifyAfterPush(makeS1Io([], { save: () => undefined }));
  assert.equal(steps.save.ok, false);
  assert.match(steps.save.reason, /the scene save step returned no \{ok\} result/);
  assert.equal(steps.notify, null);

  // Same for a step the io bag does not carry at all.
  const bare = await persistAndNotifyAfterPush({});
  assert.equal(bare.save.ok, false);
  assert.match(bare.save.reason, /no persistScene\(\)/);
});

test('S1: a throwing save step is captured verbatim (never a silent skip)', async () => {
  const steps = await persistAndNotifyAfterPush({
    persistScene: async () => { throw new Error('window.exportConfig is not installed'); },
    notifyBridge: async () => ({ ok: true }),
  });
  assert.equal(steps.save.ok, false);
  assert.match(steps.save.reason, /window\.exportConfig is not installed/);
  assert.equal(steps.notify, null, 'a save that threw must not be followed by a notify');
});

// ── _127: the third step is a route-table READ, and it cannot be dodged ─────

test('_127: omitting the route expectation FAILS the confirm — no unmeasured ✓ by omission', async () => {
  const steps = await persistAndNotifyAfterPush({
    persistScene: async () => ({ ok: true }),
    notifyBridge: async () => ({ ok: true }),
    confirmBridgeRoutes: async () => ({ ok: true, detail: 'U21→10.0.0.60' }),
  });
  assert.equal(steps.save.ok, true);
  assert.equal(steps.notify.ok, true);
  assert.equal(steps.confirm.ok, false);
  assert.match(steps.confirm.reason, /stated no route expectation/);
});

test('_127: an io bag without confirmBridgeRoutes() is a loud confirm failure', async () => {
  const steps = await persistAndNotifyAfterPush({
    persistScene: async () => ({ ok: true }),
    notifyBridge: async () => ({ ok: true }),
  }, [{ ip: '10.0.0.60', expected: [21], parkedAbsent: [] }]);
  assert.equal(steps.confirm.ok, false);
  assert.match(steps.confirm.reason, /no confirmBridgeRoutes\(\)/);
});

test('_127: a confirm that answers ok WITHOUT naming routes is refused', async () => {
  const steps = await persistAndNotifyAfterPush({
    persistScene: async () => ({ ok: true }),
    notifyBridge: async () => ({ ok: true }),
    confirmBridgeRoutes: async () => ({ ok: true }),
  }, [{ ip: '10.0.0.60', expected: [21], parkedAbsent: [] }]);
  assert.equal(steps.confirm.ok, false);
  assert.match(steps.confirm.reason, /without naming the confirmed routes/);
});

test('_127: the EXPLICIT empty expectation list is the only skip, and says so', async () => {
  const calls = [];
  const steps = await persistAndNotifyAfterPush({
    persistScene: async () => ({ ok: true }),
    notifyBridge: async () => ({ ok: true }),
    confirmBridgeRoutes: async () => { calls.push('confirmRoutes'); return { ok: true, detail: 'x' }; },
  }, []);
  assert.deepEqual(steps.confirm, { ok: true, skipped: true });
  assert.equal(calls.length, 0, 'nothing pushed — nothing queried');
});

test('S1: describePushCompletion — the exact operator-facing sentences', () => {
  const ok = describePushCompletion({ save: { ok: true }, notify: { ok: true },
    confirm: { ok: true, detail: 'U21,U22→10.0.0.60' } });
  assert.equal(ok.ok, true);
  assert.equal(ok.failedStep, null);
  assert.equal(ok.text,
    '✓ device written + verified · ✓ scene saved (patches projected) · ' +
    '✓ bridge routes confirmed (U21,U22→10.0.0.60)');

  const noSave = describePushCompletion(
    { save: { ok: false, reason: 'boom' }, notify: null, confirm: null });
  assert.equal(noSave.ok, false);
  assert.equal(noSave.failedStep, 'scene save');
  assert.match(noSave.text, /⏸ bridge not notified \(the save failed first\)/);

  const noNotify = describePushCompletion(
    { save: { ok: true }, notify: { ok: false, reason: 'no WS' }, confirm: null });
  assert.equal(noNotify.failedStep, 'bridge notify');
  assert.match(noNotify.text, /the sACN feed was NOT updated: bridge notify/);
});

test('_127: describePushCompletion — a failed route read-back is ✋, named, never a ✓', () => {
  const mismatch = describePushCompletion({ save: { ok: true }, notify: { ok: true },
    confirm: { ok: false, reason: 'missing U31→10.1.1.60 — bridge relays 1 route(s) after ' +
      '5 read(s); check the sACN bridge log' } });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.failedStep, 'bridge route read-back');
  assert.match(mismatch.text, /✋ bridge routes NOT confirmed: missing U31→10\.1\.1\.60/);
  assert.match(mismatch.text, /the sACN feed is NOT CONFIRMED: bridge route read-back/);
  assert.match(mismatch.text, /check the sACN bridge log\./);
  assert.equal(mismatch.text.includes('✓ bridge'), false, 'no ✓ over an unproven route table');
});

test('_127: a notify with NO confirm step renders ✋ — the unmeasured ✓ is gone for good', () => {
  const unmeasured = describePushCompletion({ save: { ok: true }, notify: { ok: true } });
  assert.equal(unmeasured.ok, false);
  assert.equal(unmeasured.failedStep, 'bridge route read-back');
  assert.match(unmeasured.text,
    /✋ bridge routes NOT confirmed: the route table was never read back/);
});

test('_127: an EXPLICIT empty expectation (fleet, nothing pushed) says so — not a fake route ✓', () => {
  const skipped = describePushCompletion({ save: { ok: true }, notify: { ok: true },
    confirm: { ok: true, skipped: true } }, { lead: 'done — 0 pushed · 2 skipped · 0 failed' });
  assert.equal(skipped.ok, true);
  assert.match(skipped.text, /✓ bridge notified — nothing was pushed, no routes to confirm/);
  assert.equal(skipped.text.includes('routes confirmed'), false);
});

// ── Slice S5 — the sync chip says what it measures ──────────────────────────
// The chip compares the DEVICE to the plan this page would push. It has nothing
// to say about whether frames reach the strands, and a green chip standing over a
// stale feed is exactly the shape of the operator's dark-LED day (20260725_58 §3).

test('S5: every sync-chip tooltip leads with what the chip measures', () => {
  const tip = describeSyncChipTooltip({ state: 'in-sync' });
  assert.match(tip, /^Measures the DEVICE against the per-output plan this page would push/);
  assert.match(tip, /device ≡ plan/);
  assert.match(tip, /NOT the sACN feed/);
  assert.match(tip, /patches\.yaml/);
  // A missing/empty state still explains itself rather than showing a bare chip.
  assert.equal(describeSyncChipTooltip(null), tip);
});

test('S5: the tooltip appends the state detail below the meaning line', () => {
  const tip = describeSyncChipTooltip({ state: 'drift', detail: 'firmware predates per-output DMX' });
  const [head, extra] = tip.split('\n\n');
  assert.match(head, /NOT the sACN feed/);
  assert.equal(extra, 'firmware predates per-output DMX');
});

test('S5: the tooltip renders the per-output diff when the state carries changes', () => {
  const tip = describeSyncChipTooltip({
    state: 'drift',
    changes: [{ path: 'output 2', from: 24, to: 23 }],
  });
  assert.match(tip, /output 2: 24 → 23$/);
});

test('S5: chip tooltip and the stale-feed detail read as ONE consistent claim', async () => {
  const registry = s1Registry();
  const card = registry.controllers[0];
  const ctx = makeS1Ctx(registry, []);
  await runPerOutputPush(ctx, card, S1_PLAN,
    makeS1Io([], { save: { ok: false, reason: 'save server responded 500' } }), makeS1Ui());
  const tip = describeSyncChipTooltip(getSyncState(ctx, card.id));
  // Same vocabulary on both halves — the header says the chip does not measure the
  // sACN feed, the detail says that feed is stale. No competing claims.
  assert.match(tip, /NOT the sACN feed/);
  assert.match(tip, /device ≡ plan, but the sACN feed is STALE — scene save failed/);
});

// ── _69: reboot-aware push phases (the operator's "timed out after 5000 ms") ─
// A per-output write REBOOTS the device; the reboot was measured at ~11 s. The
// old flat 5000 ms budget covered the POST, so on healthy hardware the push
// aborted mid-reboot and reported a failure over a device that had just been
// written — the mirror-vs-device lie. Now: a write budget, a reboot-wait budget
// with progress copy, and a read-back that ARBITRATES an unanswered write.
// Nothing here sleeps: awaitReboot is mocked in the io bag (the client's own
// budget/poll behaviour is covered in marsinled_client.test.js).

/** Exactly the error shape marsinled_client.js raises for an unanswered write. */
function lostReplyError(ms = 12000) {
  const err = new Error(`timed out after ${ms} ms — device did not respond`);
  err.writeResponseLost = true;
  return err;
}

/**
 * Device io whose WRITE never answers. `comesBack` decides whether the reboot
 * poll ever finds the device again; `readBackPlan` is what /api/status reports
 * once it does (default: the plan that was pushed — i.e. the write DID apply).
 */
function makeLostReplyIo(calls, {
  comesBack = true, readBackPlan = null, save = { ok: true }, notify = { ok: true },
  confirm = { ok: true, detail: 'U21,U22→10.0.0.60' },
} = {}) {
  return {
    pushPerOutputUniverses: async (_ip, { plan }) => {
      calls.push('push');
      calls.lastPlan = plan.universeByOutputIndex;
      calls.lastFullPlan = plan;
      throw lostReplyError();
    },
    awaitReboot: async (_ip, opts) => {
      calls.push('awaitReboot');
      if (opts && typeof opts.onProgress === 'function') {
        opts.onProgress({ elapsedMs: 3000, timeoutMs: 45000, attempts: 3 });
      }
      if (!comesBack) {
        throw new Error('[MarsinLED] device 10.0.0.60 did not come back within 45000ms after ' +
          'reboot (30 probe(s))');
      }
    },
    getStatus: async () => {
      calls.push('getStatus');
      const plan = readBackPlan || calls.lastPlan || {};
      return status60(Object.entries(plan).map(([index, universe]) =>
        ({ index: Number(index), universe, startAddress: 1, enabled: true })));
    },
    getConfig: async () => {
      calls.push('getConfig');
      return config60WithMapping(readBackPlan || calls.lastPlan || {});
    },
    persistScene: async () => { calls.push('persistScene'); return save; },
    notifyBridge: async () => { calls.push('notifyBridge'); return notify; },
    confirmBridgeRoutes: async () => { calls.push('confirmRoutes'); return confirm; },
  };
}

/** Like makeS1Ui, but keeps every status line the push ever rendered. */
function makeRecordingUi() {
  const history = [];
  return {
    history,
    ui: {
      statusLine: {
        _text: '',
        className: '',
        get textContent() { return this._text; },
        set textContent(v) { this._text = v; history.push(v); },
      },
      confirmBtn: { disabled: false },
      cancelBtn: { disabled: false, textContent: 'Cancel' },
    },
  };
}

test('_69: a LOST write reply is settled by the read-back, never declared a failure', async () => {
  const registry = s1Registry();
  const calls = [];
  const toasts = [];
  const { ui } = makeRecordingUi();
  await runPerOutputPush(makeS1Ctx(registry, toasts), registry.controllers[0], S1_PLAN,
    makeLostReplyIo(calls), ui);

  // The timeout does NOT end the push: it falls into the same reboot wait, then
  // reads the device back — and the read-back says the write applied.
  assert.deepEqual(calls.filter((c) => c !== 'getConfig'),
    ['push', 'awaitReboot', 'getStatus', 'persistScene', 'notifyBridge', 'confirmRoutes']);
  assert.match(ui.statusLine.textContent, /the write reply was LOST/);
  assert.match(ui.statusLine.textContent, /the read-back confirms the mapping applied/);
  assert.match(ui.statusLine.textContent, /✓ scene saved \(patches projected\)/);
  assert.match(ui.statusLine.textContent, /✓ bridge routes confirmed/);
  assert.equal(ui.statusLine.className, 'led-push-status led-push-ok');
  assert.equal(ui.cancelBtn.textContent, 'Done');
  assert.equal(toasts[0].error, false);
  assert.match(toasts[0].msg, /the write reply was lost — the read-back confirmed it/);
  assert.equal(calls.filter((call) => call === 'push').length, 1,
    'an ambiguous write is read back, never retried');
});

test('_69: the dialog names the phase and its budget while the device reboots', async () => {
  const registry = s1Registry();
  const { ui, history } = makeRecordingUi();
  await runPerOutputPush(makeS1Ctx(registry, []), registry.controllers[0], S1_PLAN,
    makeLostReplyIo([]), ui);

  // Phase 1 declares the write budget so a slow write does not read as a hang.
  assert.ok(history.some((t) => /up to 12s to answer the write/.test(t)), history.join(' | '));
  // Phase 2 says it is waiting out a reboot, with the budget and the elapsed time.
  assert.ok(history.some((t) => /Waiting up to 45s for it to come back/.test(t)));
  assert.ok(history.some(
    (t) => /device rebooting — waiting up to 45s for it to answer \(3s elapsed\)/.test(t)));
  // Phase 3 runs only after the device answered.
  assert.ok(history.some((t) => /reading confirmed saved mapping/.test(t)));
});

test('_69: a device unreachable through the WHOLE budget is red, and never saves', async () => {
  const registry = s1Registry();
  const card = registry.controllers[0];
  const calls = [];
  const toasts = [];
  const ctx = makeS1Ctx(registry, toasts);
  await runPerOutputPush(ctx, card, S1_PLAN, makeLostReplyIo(calls, { comesBack: false }),
    makeS1Ui());

  assert.equal(calls.includes('persistScene'), false, 'a genuinely dead device saves nothing');
  assert.equal(calls.includes('notifyBridge'), false);
  assert.equal(getSyncState(ctx, card.id).state, 'unreachable');
  assert.equal(toasts.length, 0, 'the device step already reported; no completion toast');
});

test('_69: an unconfirmed write says so — it never claims the write failed', async () => {
  const registry = s1Registry();
  const { ui } = makeRecordingUi();
  await runPerOutputPush(makeS1Ctx(registry, []), registry.controllers[0], S1_PLAN,
    makeLostReplyIo([], { comesBack: false }), ui);
  assert.equal(ui.statusLine.className, 'led-push-status led-push-error');
  assert.match(ui.statusLine.textContent,
    /the write is UNCONFIRMED: it may or may not have applied/);
  assert.match(ui.statusLine.textContent, /Power-cycle the controller/);
});

test('_69: a lost reply with a DIFFERENT read-back is a real failure (drift)', async () => {
  const registry = s1Registry();
  const card = registry.controllers[0];
  const calls = [];
  const ctx = makeS1Ctx(registry, []);
  const { ui } = makeRecordingUi();
  await runPerOutputPush(ctx, card, S1_PLAN,
    makeLostReplyIo(calls, { readBackPlan: { 0: 21, 1: 99 } }), ui);

  assert.match(ui.statusLine.textContent,
    /the device did not answer the write AND the read-back shows a DIFFERENT mapping/);
  assert.match(ui.statusLine.textContent,
    /device mapping mismatch — output 1: device U99 ≠ wanted U22/);
  assert.equal(calls.includes('persistScene'), false);
  assert.equal(calls.includes('notifyBridge'), false);
  assert.equal(getSyncState(ctx, card.id).state, 'drift');
});

test('_69: the fleet push settles a lost reply the same way (pushed, with the note)', async () => {
  const registry = s1Registry();
  const calls = [];
  const results = await pushAllLedControllers(makeS1Ctx(registry, []), makeLostReplyIo(calls));
  assert.equal(results[0].state, 'pushed');
  assert.match(results[0].detail, /the write reply was lost .*the read-back confirms/);
  assert.ok(calls.includes('awaitReboot'));
});

test('_69: the fleet push still fails loudly on a device that never comes back', async () => {
  const registry = s1Registry();
  const results = await pushAllLedControllers(makeS1Ctx(registry, []),
    makeLostReplyIo([], { comesBack: false }));
  assert.equal(results[0].state, 'failed');
  assert.match(results[0].detail, /UNCONFIRMED/);
});

// ── _71: port → physical-output association (report 20260725_70) ─────────────
// A card port DECLARES the board output it drives (`port.output`, 1-based). The
// push NEVER writes `enabled: false`: an enabled output no port drives is
// PARKED on a claims-free universe (subscribed, unrouted, dark), and the ONE
// asymmetric write is enabling an output a mapped port points at.
// Nothing here sleeps or touches a device — every io bag is a mock.

/** A .60-shaped registry whose LED card can declare crossed outputs. */
function outputRegistry(portSpecs, { parkedOutputs, withDeck = true } = {}) {
  const controllers = [];
  if (withDeck) {
    controllers.push({
      id: 11, name: 'LeftFrontDeck', ip: '10.0.0.11',
      ports: [{ port: 1, universe: 23, chain: [{ fixture: 'Left Front Rails 1', at: 1 }] }],
    });
  }
  const card = {
    id: 60, name: 'LeftLeftFront', ip: '10.0.0.60', type: CONTROLLER_TYPE_LED,
    protocol: CONTROLLER_PROTOCOL_SACN,
    led: { order: 'RGBW', startAddr: 1 },
    device: { vendor: 'marsinled', controllerId: 'titanic_60', deviceName: 'LeftLeftFront' },
    ports: portSpecs,
  };
  if (parkedOutputs) card.parkedOutputs = parkedOutputs;
  controllers.push(card);
  return createControllerRegistry({ controllers });
}

/** The .60 device: 4 outputs, 0/1/2 enabled at 40 px, 3 disabled. */
function config60Enabled(enabledFlags) {
  const cfg = config202();
  cfg.deviceName = 'LeftLeftFront';
  enabledFlags.forEach((on, i) => { cfg.strands[i].enabled = on; });
  return cfg;
}

const IDENTITY_PORTS = [
  { port: 1, output: 1, universe: 21, chain: ['Left_Front_Left'] },
  { port: 2, output: 2, universe: 22, chain: ['Left_Back_Left'] },
];

// (6) Identity mapping — byte-for-byte what the pre-selector code produced.

test('_71 (6): IDENTITY mapping — the plan is exactly today\'s, with no parked outputs', () => {
  const registry = outputRegistry(IDENTITY_PORTS, { withDeck: false });
  const card = registry.controllers[0];
  const plan = derivePerOutputPlan(card, STRAND_COUNTS, config60Enabled([true, true, false, false]),
    NO_CLAIMS);
  assert.deepEqual(plan.universeByOutputIndex, { 0: 21, 1: 22 });
  assert.deepEqual(plan.assignments, [
    { outputIndex: 0, portNum: 1, universe: 21, pixelCount: 40 },
    { outputIndex: 1, portNum: 2, universe: 22, pixelCount: 40 },
  ]);
  assert.deepEqual(plan.parked, []);
  assert.deepEqual(plan.enableOutputIndices, []);
  assert.deepEqual(plan.collisions, []);
  assert.deepEqual(plan.warnings, []);
});

// (7) Crossed mapping — the case that cannot pass against the pre-change module.

test('_71 (7): CROSSED mapping P1→out2 / P2→out1 swaps the universes, and names the right ports', () => {
  const registry = outputRegistry([
    { port: 1, output: 2, universe: 21, chain: ['Left_Front_Left'] },
    { port: 2, output: 1, universe: 22, chain: ['Left_Back_Left'] },
  ], { withDeck: false });
  const card = registry.controllers[0];
  const plan = derivePerOutputPlan(card, STRAND_COUNTS, config60Enabled([true, true, false, false]),
    NO_CLAIMS);
  // Board output 1 (index 0) carries P2's universe; output 2 carries P1's.
  assert.deepEqual(plan.universeByOutputIndex, { 0: 22, 1: 21 });
  assert.deepEqual(plan.assignments, [
    { outputIndex: 0, portNum: 2, universe: 22, pixelCount: 40 },
    { outputIndex: 1, portNum: 1, universe: 21, pixelCount: 40 },
  ]);
  // NOT symmetric with the identity plan — this is what falsifies the old module.
  const identity = derivePerOutputPlan(
    outputRegistry(IDENTITY_PORTS, { withDeck: false }).controllers[0],
    STRAND_COUNTS, config60Enabled([true, true, false, false]), NO_CLAIMS);
  assert.notDeepEqual(plan.universeByOutputIndex, identity.universeByOutputIndex);

  // The strand patch records follow the DECLARED output, and the claim labels
  // still name the CARD port the operator edits.
  const { fields } = computeLedStrandPatches(registry, STRAND_COUNTS);
  assert.equal(fields.get('Left_Front_Left').outputIndex, 1);
  assert.equal(fields.get('Left_Front_Left').portNum, 1);
  assert.equal(fields.get('Left_Back_Left').outputIndex, 0);
  assert.equal(fields.get('Left_Back_Left').portNum, 2);
});

// (8) The operator's case: ONE row driving output 4.

test('_71 (8): ONE port driving output 4 ENABLES it, parks 1–3, and disables NOTHING', () => {
  const registry = outputRegistry([
    { port: 1, output: 4, universe: 21, chain: ['Left_Front_Left'] },
  ], { withDeck: false });
  const card = registry.controllers[0];
  const cfg = config60Enabled([true, true, true, false]);   // out 4 is OFF today
  const plan = derivePerOutputPlan(card, STRAND_COUNTS, cfg, NO_CLAIMS);

  assert.deepEqual(plan.assignments,
    [{ outputIndex: 3, portNum: 1, universe: 21, pixelCount: 40 }]);
  assert.deepEqual(plan.enableOutputIndices, [3]);
  assert.deepEqual(plan.enables,
    [{ outputIndex: 3, portNum: 1, universe: 21, count: 40 }]);
  // Outputs 1–3 are enabled on the board with no port: PARKED, never disabled.
  assert.deepEqual(plan.parked.map((p) => p.outputIndex), [0, 1, 2]);
  assert.deepEqual(plan.collisions, []);

  // The payload proves the asymmetry: `enabled: false` appears NOWHERE.
  const applied = applyPerOutputPlan(cfg.strands, plan);
  assert.deepEqual(applied.map((s) => s.enabled), [true, true, true, true]);
  assert.equal(applied[3].count, 40, 'a newly enabled output gets the mapped pixel count');
  assert.equal(applied[3].dmxUniverse, 21);
  assert.equal(applied[3].dmxStartAddress, 1);
  // …and the applied array is what the firmware rules are checked against.
  assert.doesNotThrow(() => validatePerOutputPlan(applied, plan.universeByOutputIndex));
});

// (9) The live .60 repro: a portless ENABLED output is PARKED, not disabled.

test('_71 (9): a portless ENABLED output is PARKED off U23, and stays enabled', () => {
  const registry = outputRegistry(IDENTITY_PORTS);           // deck owns U23
  const card = registry.controllers[1];
  const cfg = config60Enabled([true, true, true, false]);
  const plan = derivePerOutputPlan(card, STRAND_COUNTS, cfg, claimsFor(registry, card));

  assert.deepEqual(plan.parked, [{ outputIndex: 2, universe: 24, reused: false }]);
  assert.notEqual(plan.universeByOutputIndex[2], 23, 'never a universe another card owns');
  assert.deepEqual(plan.collisions, []);
  const applied = applyPerOutputPlan(cfg.strands, plan);
  assert.equal(applied[2].enabled, true, 'a parked output is never disabled');
  assert.equal(applied[2].dmxUniverse, 24);
  assert.equal(applied[3].enabled, false, 'an unmapped DISABLED output is untouched');
  assert.equal('dmxUniverse' in applied[3], false);
});

// (10) Sticky parking — a stored park is REUSED, silently.

test('_71 (10): a STORED park is reused (reused: true) and emits no warning', () => {
  const registry = outputRegistry(IDENTITY_PORTS, {
    parkedOutputs: [{ output: 3, universe: 26 }],
  });
  const card = registry.controllers[1];
  const plan = derivePerOutputPlan(card, STRAND_COUNTS, config60Enabled([true, true, true, false]),
    claimsFor(registry, card));
  assert.deepEqual(plan.parked, [{ outputIndex: 2, universe: 26, reused: true }]);
  assert.deepEqual(plan.warnings, [], 'a stable park is not news');
  // Stickiness is the whole point: re-deriving is idempotent, so the sync chip
  // never reports drift on a card nobody touched.
  const again = derivePerOutputPlan(card, STRAND_COUNTS, config60Enabled([true, true, true, false]),
    claimsFor(registry, card));
  assert.deepEqual(again.universeByOutputIndex, plan.universeByOutputIndex);
});

// (11) Re-park — only when the stored universe stops being valid.

test('_71 (11): a stored park another controller has CLAIMED is re-parked, loudly', () => {
  const registry = outputRegistry(IDENTITY_PORTS, {
    parkedOutputs: [{ output: 3, universe: 23 }],   // the deck owns U23 now
  });
  const card = registry.controllers[1];
  const plan = derivePerOutputPlan(card, STRAND_COUNTS, config60Enabled([true, true, true, false]),
    claimsFor(registry, card));
  assert.deepEqual(plan.parked, [{ outputIndex: 2, universe: 24, reused: false }]);
  assert.equal(plan.warnings.length, 1);
  assert.match(plan.warnings[0],
    /output 3: parked universe U23 is no longer free — re-parked on U24/);
});

test('_71 (11): a stored park that collides with one of THIS card\'s ports is re-parked', () => {
  const registry = outputRegistry(IDENTITY_PORTS, {
    parkedOutputs: [{ output: 3, universe: 22 }],   // == P2's universe
  });
  const card = registry.controllers[1];
  const plan = derivePerOutputPlan(card, STRAND_COUNTS, config60Enabled([true, true, true, false]),
    claimsFor(registry, card));
  assert.equal(plan.parked[0].reused, false);
  assert.notEqual(plan.parked[0].universe, 22);
  assert.match(plan.warnings[0], /parked universe U22 is no longer free/);
});

// (12) The park must fit the firmware's ≤16-universe window.

test('_71 (12): a park lands INSIDE the 16-universe window, not at the registry high-water mark', () => {
  const registry = outputRegistry(IDENTITY_PORTS, { withDeck: false });
  registry.nextUniverse = 60;                       // the rig has grown well past U22
  const card = registry.controllers[0];
  const plan = derivePerOutputPlan(card, STRAND_COUNTS, config60Enabled([true, true, true, false]),
    NO_CLAIMS);
  const u = plan.parked[0].universe;
  assert.ok(u >= 21 && u <= 36, `parked U${u} must sit in U21–U36`);
  // Proof it is not just "close": the whole plan passes the firmware span rule.
  const applied = applyPerOutputPlan(config60Enabled([true, true, true, false]).strands, plan);
  assert.doesNotThrow(() => validatePerOutputPlan(applied, plan.universeByOutputIndex));
});

test('_71 (12): a FULL window REFUSES loudly instead of parking outside it', () => {
  const registry = outputRegistry(IDENTITY_PORTS, { withDeck: false });
  const card = registry.controllers[0];
  // Every universe in the window U21–U36 belongs to someone else.
  const claimed = new Map();
  for (let u = 21; u <= 36; u++) claimed.set(u, `Deck ${u}`);
  claimed.delete(21); claimed.delete(22);          // except this card's own two
  const plan = derivePerOutputPlan(card, STRAND_COUNTS, config60Enabled([true, true, true, false]),
    claimed);
  assert.equal(plan.parked.length, 0);
  assert.equal(plan.collisions.length, 1);
  assert.equal(plan.collisions[0].kind, 'parked_span');
  assert.match(plan.collisions[0].message,
    /no free universe in the window U21–U36 for output 3 — free one up, or unpark it/);
});

// (13)/(14) The two new BLOCKING refusals — no device is written.

test('_71 (13): TWO ports on one output is a blocking duplicate_output refusal', () => {
  const registry = outputRegistry([
    { port: 1, output: 2, universe: 21, chain: ['Left_Front_Left'] },
    { port: 3, output: 2, universe: 25, chain: ['Left_Back_Left'] },
  ], { withDeck: false });
  const card = registry.controllers[0];
  const plan = derivePerOutputPlan(card, STRAND_COUNTS, config60Enabled([true, true, true, false]),
    NO_CLAIMS);
  const dup = plan.collisions.find((c) => c.kind === 'duplicate_output');
  assert.ok(dup, 'a duplicate association must block the push');
  assert.equal(dup.message, 'ports 1 and 3 both drive output 2 — one physical output cannot ' +
    'take two universes; give each port its own output');
  // The pane says it too, BEFORE anyone presses Push (hand-edited YAML has no UI).
  const chips = validateLedManualUniverses(registry, STRAND_COUNTS, new Map());
  assert.ok(chips.some((w) => w.code === 'led_output_duplicate'));
});

test('_71 (13): the fleet push refuses the duplicate card and writes NOTHING to it', async () => {
  const registry = outputRegistry([
    { port: 1, output: 2, universe: 21, chain: ['Left_Front_Left'] },
    { port: 3, output: 2, universe: 25, chain: ['Left_Back_Left'] },
  ], { withDeck: false });
  const calls = [];
  const results = await pushAllLedControllers(makeGateCtx(registry), makeGateIo(calls));
  assert.equal(results[0].state, 'failed');
  assert.match(results[0].detail, /push REFUSED — ports 1 and 3 both drive output 2/);
  assert.equal(calls.includes('push:10.0.0.60'), false, 'a refused plan must not reach the device');
});

test('_71 (14): a port driving an output the BOARD does not have is refused', async () => {
  const registry = outputRegistry([
    { port: 1, output: 1, universe: 21, chain: ['Left_Front_Left'] },
    { port: 2, output: 5, universe: 22, chain: ['Left_Back_Left'] },   // 4-output board
  ], { withDeck: false });
  const card = registry.controllers[0];
  const plan = derivePerOutputPlan(card, STRAND_COUNTS, config60Enabled([true, true, true, false]),
    NO_CLAIMS);
  const oor = plan.collisions.find((c) => c.kind === 'output_out_of_range');
  assert.ok(oor);
  assert.equal(oor.message, 'port 2 drives output 5, but the device reports only 4 output(s)');

  const calls = [];
  const results = await pushAllLedControllers(makeGateCtx(registry), makeGateIo(calls));
  assert.equal(results[0].state, 'failed');
  assert.equal(calls.includes('push:10.0.0.60'), false);
});

// (15) The claim index now sees the two universes a device SUBSCRIBES to that
// no strand patch projects.

test('_71 (15): claims cover another card\'s STRANDLESS port universe and its PARKED universe', () => {
  const registry = createControllerRegistry({
    controllers: [
      {
        id: 60, name: 'LeftLeftFront', ip: '10.0.0.60', type: CONTROLLER_TYPE_LED,
        protocol: CONTROLLER_PROTOCOL_SACN, led: { order: 'RGBW', startAddr: 1 },
        device: { vendor: 'marsinled', controllerId: 'titanic_60' },
        ports: [
          { port: 1, output: 1, universe: 21, chain: ['Left_Front_Left'] },
          { port: 2, output: 2, universe: 22, chain: [] },        // STRANDLESS
        ],
        parkedOutputs: [{ output: 3, universe: 27 }],
      },
      {
        id: 61, name: 'RightRight', ip: '10.0.0.61', type: CONTROLLER_TYPE_LED,
        protocol: CONTROLLER_PROTOCOL_SACN, led: { order: 'RGBW', startAddr: 1 },
        device: { vendor: 'marsinled', controllerId: 'titanic_61' },
        ports: [{ port: 1, output: 1, universe: 31, chain: ['Left_Back_Left'] }],
      },
    ],
  });
  const other = registry.controllers[1];
  const claimed = claimsFor(registry, other);
  // Pre-_71 both were INVISIBLE: no strand projects them, so another card's push
  // could take a universe the .60 is already subscribed to.
  assert.equal(claimed.get(22), 'LeftLeftFront port 2 → output 2');
  assert.equal(claimed.get(27), 'LeftLeftFront output 3 (parked)');
  // A card never claims against ITSELF, or every push of a mapped card would refuse.
  const own = claimsFor(registry, registry.controllers[0]);
  assert.equal(own.has(21), false);
  assert.equal(own.has(22), false);
  assert.equal(own.has(27), false);
});

// (16) Validation runs on the APPLIED array.

test('_71 (16): validatePerOutputPlan runs on the APPLIED array (the old order refused a legal plan)', () => {
  const cfg = config60Enabled([true, false, false, false]);
  const plan = {
    universeByOutputIndex: { 0: 21, 1: 22 },
    enables: [{ outputIndex: 1, portNum: 2, universe: 22, count: 40 }],
    enableOutputIndices: [1],
    assignments: [], parked: [], warnings: [], collisions: [],
  };
  // Against the DEVICE's array output 1 is not enabled — the pre-push state
  // cannot express an enable, so this is the throw the old ordering produced.
  assert.throws(() => validatePerOutputPlan(cfg.strands, plan.universeByOutputIndex),
    /output 1 carries a universe but is not an enabled strand/);
  // Against the APPLIED array — the intended post-push state — it is legal.
  assert.doesNotThrow(() =>
    validatePerOutputPlan(applyPerOutputPlan(cfg.strands, plan), plan.universeByOutputIndex));
});

// (17) The count policy: written on an ENABLE, never on a live output.

test('_71 (17): `count` is written on an ENABLE and never on an already-enabled output', () => {
  const registry = outputRegistry([
    { port: 1, output: 1, universe: 21, chain: ['Left_Front_Left'] },   // device says 40 px
    { port: 2, output: 2, universe: 22, chain: ['Left_Back_Left'] },
  ], { withDeck: false });
  const card = registry.controllers[0];
  const cfg = config60Enabled([true, false, false, false]);
  // The sim believes output 1 is 20 px while the device holds 40 (the standing
  // 20-vs-40 question): REPORT it, never rewrite a live strand's length.
  const counts = new Map([['Left_Front_Left', 20], ['Left_Back_Left', 40]]);
  const plan = derivePerOutputPlan(card, counts, cfg, NO_CLAIMS);
  assert.ok(plan.warnings.some((w) =>
    /output 1: device count 40 px, this card maps 20 px — count NOT changed/.test(w)));
  const applied = applyPerOutputPlan(cfg.strands, plan);
  assert.equal(applied[0].count, 40, 'a live output keeps the hardware count');
  assert.equal(applied[1].count, 40, 'the newly ENABLED output takes the mapped count');
  assert.deepEqual(plan.enableOutputIndices, [1]);
});

test('_71 (17): an EMPTY port row pointed at a disabled output enables nothing', () => {
  // The everyday 4-row card driving two strands: rows 3 and 4 map nothing and
  // point at outputs the board has off. Enabling them would be the sim deciding
  // to drive hardware nobody mapped.
  const registry = outputRegistry([
    ...IDENTITY_PORTS,
    { port: 3, output: 3, universe: 25, chain: [] },
    { port: 4, output: 4, universe: 26, chain: [] },
  ], { withDeck: false });
  const plan = derivePerOutputPlan(registry.controllers[0], STRAND_COUNTS,
    config60Enabled([true, true, false, false]), NO_CLAIMS);
  assert.deepEqual(plan.universeByOutputIndex, { 0: 21, 1: 22 });
  assert.deepEqual(plan.enableOutputIndices, []);
  assert.deepEqual(plan.collisions, []);
});

// (18)/(19) The read-back verifies the WHOLE map, and composes with _69.

/** io whose device reports back exactly `readBack` (default: the pushed plan). */
function makeVerifyIo(calls, { readBack = null, lostReply = false } = {}) {
  return {
    pushPerOutputUniverses: async (_ip, { plan }) => {
      calls.push('push');
      calls.lastFullPlan = plan;
      calls.lastPlan = plan.universeByOutputIndex;
      if (lostReply) throw lostReplyError();
      return { outcome: 'needs-reboot', reboot: true };
    },
    awaitReboot: async () => { calls.push('awaitReboot'); },
    getStatus: async () => {
      calls.push('getStatus');
      const map = readBack || calls.lastPlan || {};
      return status60(Object.entries(map).map(([index, universe]) =>
        ({ index: Number(index), universe, startAddress: 1, enabled: true })));
    },
    getConfig: async () => {
      calls.push('getConfig');
      return config60WithMapping(readBack || calls.lastPlan || {});
    },
    persistScene: async () => { calls.push('persistScene'); return { ok: true }; },
    notifyBridge: async () => { calls.push('notifyBridge'); return { ok: true }; },
    confirmBridgeRoutes: async (expectations) => {
      calls.push('confirmRoutes');
      calls.lastExpectations = expectations;
      return { ok: true, detail: 'U21,U22→10.0.0.60' };
    },
  };
}

const PARKED_PLAN = planOf({ 0: 21, 1: 22, 2: 24 }, {
  assignments: [
    { outputIndex: 0, portNum: 1, universe: 21, pixelCount: 40 },
    { outputIndex: 1, portNum: 2, universe: 22, pixelCount: 40 },
  ],
  parked: [{ outputIndex: 2, universe: 24, reused: false }],
});

test('_71 (18): the read-back covers the PARKED output — a stale universe there fails the push', async () => {
  const registry = s1Registry();
  const card = registry.controllers[0];
  const ctx = makeS1Ctx(registry, []);
  const calls = [];
  // The device still reports the .60's old U23 on the parked output.
  await runPerOutputPush(ctx, card, PARKED_PLAN,
    makeVerifyIo(calls, { readBack: { 0: 21, 1: 22, 2: 23 } }), makeS1Ui());
  assert.equal(calls.includes('persistScene'), false, 'an unverified device saves nothing');
  assert.equal(getSyncState(ctx, card.id).state, 'drift');
  assert.equal(getSyncState(ctx, card.id).detail.includes('output 2: device U23 ≠ wanted U24'), true);
});

test('_71 (18): a matching read-back over assigned + parked completes, and PERSISTS the park', async () => {
  const registry = s1Registry();
  const card = registry.controllers[0];
  const ctx = makeS1Ctx(registry, []);
  const calls = [];
  await runPerOutputPush(ctx, card, PARKED_PLAN, makeVerifyIo(calls), makeS1Ui());
  assert.deepEqual(calls.filter((c) => c !== 'getConfig'),
    ['push', 'awaitReboot', 'getStatus', 'persistScene', 'notifyBridge', 'confirmRoutes']);
  // _127: the parked universe rides the expectation as a MUST-BE-ABSENT claim.
  assert.deepEqual(calls.lastExpectations[0].expected, [21, 22]);
  assert.deepEqual(calls.lastExpectations[0].parkedAbsent, [24]);
  // STICKY: the park is written onto the card so the next derive reuses it.
  assert.equal(parkedUniverseFor(card, 2), 24);
  assert.deepEqual(card.parkedOutputs, [{ output: 3, universe: 24 }]);
  // …and an output a port drives is never left carrying a stale park.
  assert.equal(parkedUniverseFor(card, 0), null);
});

test('_71 (19): a LOST write reply verified over the FULL map (incl. the enable) is a success', async () => {
  const registry = s1Registry();
  const card = registry.controllers[0];
  const ctx = makeS1Ctx(registry, []);
  const calls = [];
  const { ui } = makeRecordingUi();
  const planWithEnable = planOf({ 0: 21, 1: 22, 2: 24 }, {
    assignments: [{ outputIndex: 0, portNum: 1, universe: 21, pixelCount: 40 }],
    parked: [{ outputIndex: 2, universe: 24, reused: false }],
    enables: [{ outputIndex: 1, portNum: 2, universe: 22, count: 40 }],
    enableOutputIndices: [1],
  });
  await runPerOutputPush(ctx, card, planWithEnable, makeVerifyIo(calls, { lostReply: true }), ui);
  assert.match(ui.statusLine.textContent, /the write reply was LOST/);
  assert.match(ui.statusLine.textContent, /✓ scene saved \(patches projected\)/);
  assert.equal(ui.statusLine.className, 'led-push-status led-push-ok');
});

test('_71 (19): a read-back MISSING the enable transition fails, and never saves', async () => {
  const registry = s1Registry();
  const card = registry.controllers[0];
  const ctx = makeS1Ctx(registry, []);
  const calls = [];
  const { ui } = makeRecordingUi();
  const planWithEnable = planOf({ 0: 21, 1: 22 }, {
    assignments: [{ outputIndex: 0, portNum: 1, universe: 21, pixelCount: 40 }],
    enables: [{ outputIndex: 1, portNum: 2, universe: 22, count: 40 }],
    enableOutputIndices: [1],
  });
  const io = makeVerifyIo(calls, { lostReply: true });
  io.getConfig = async () => {
    calls.push('getConfig');
    const config = config60WithMapping({ 0: 21, 1: 22 });
    config.strands[1].enabled = false;   // never enabled
    return config;
  };
  await runPerOutputPush(ctx, card, planWithEnable, io, ui);
  assert.match(ui.statusLine.textContent,
    /output 1: this push should have ENABLED it, device reports enabled=false/);
  assert.equal(calls.includes('persistScene'), false);
  assert.equal(calls.includes('notifyBridge'), false);
  assert.equal(getSyncState(ctx, card.id).state, 'drift');
});
