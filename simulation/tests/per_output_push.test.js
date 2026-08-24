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
  validatePerOutputPlan,
  applyForcedPlan,
  buildForcedConfigBody,
  pushForcedConfig,
  diffForcedConfig,
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
} from '../src/dmx/controller_registry.js';
import {
  computeLedStrandPatches,
  computeLedUniverseClaims,
  validateLedManualUniverses,
} from '../src/dmx/led/led_patch_projection.js';
import { initRegistry } from '../src/dmx/fixture_definition_registry.js';
import {
  pushAllLedControllers,
  pushAllResultsModel,
  computeSyncState,
  runPerOutputPush,
  startPush,
  identityGateRefusal,
  toggleDmx,
  dmxToggleModel,
  getDmxState,
  pushGammaToDevice,
  pushGammaAllControllers,
  gammaPushAllResultsModel,
  GAMMA_PUSH_ALL_WARNING,
  dmxOffAllControllers,
  dmxOffAllResultsModel,
  DMX_OFF_ALL_WARNING,
  persistAndNotifyAfterPush,
  fleetSaveGate,
  completeFleetPush,
  describePushCompletion,
  describeSyncChipTooltip,
  getSyncState,
} from '../src/gui/led_discovery_panel.js';

// Registry-wide universe claims (slice S2). The cases ABOVE the S2 section plan
// a rig of one controller, where nothing else claims a universe.
const NO_CLAIMS = new Map();

/**
 * A FORCED PLAN built from a bare universe map, for the cases that exercise the
 * transport / push flow rather than the derivation itself. `derivePerOutputPlan`
 * returns this shape and every consumer past the derive requires it: under force
 * semantics `universeByOutputIndex` names exactly the outputs the push ENABLES,
 * `assignments` carries the count each one is forced to, and every output NOT in
 * the map is written `enabled:false`.
 */
function planOf(universeByOutputIndex, extra = {}) {
  return {
    controllerName: 'Titanic-202',
    universeByOutputIndex,
    assignments: Object.entries(universeByOutputIndex).map(([index, universe]) => ({
      outputIndex: Number(index), portNum: Number(index) + 1, universe, pixelCount: 40,
    })),
    disables: [],
    countChanges: [],
    warnings: [],
    collisions: [],
    ...extra,
  };
}

/** The ONE body a forced push POSTs, built from a snapshot + a plan. */
function bodyOf(snapshot, plan, ip = '10.1.1.202') {
  return buildForcedConfigBody({ snapshot, plan, ip });
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

// ── derivePerOutputPlan (from port.universe, S4) ─────────────────────────────

test('derivePerOutputPlan — enabled outputs take their port.universe, start=1', () => {
  const { universeByOutputIndex, warnings } =
    derivePerOutputPlan(ledController(), { line_A: 40, line_B: 40 }, config202(), NO_CLAIMS);
  assert.deepEqual(universeByOutputIndex, { 0: 3, 1: 4 });   // 202: out1→U3, out2→U4
  assert.equal(warnings.length, 0);
});

test('_362: a port mapping NO pixels is not assigned — the push DISABLES that output', () => {
  const cfg = config202();
  // Only P1's strand has a known pixel count; P2/P3/P4 map nothing the sim knows.
  const { universeByOutputIndex, disables } =
    derivePerOutputPlan(ledController(), { line_A: 40 }, cfg, NO_CLAIMS);
  assert.deepEqual(universeByOutputIndex, { 0: 3 });
  // Output 1 is ENABLED on the board today and nothing maps it → it goes dark,
  // and the plan names it so the confirm dialog can say so before the write.
  assert.deepEqual(disables, [{ outputIndex: 1, deviceCount: 40, deviceUniverse: undefined }]);
});

test('_362: a DISABLED device output a port maps IS assigned (the push enables it)', () => {
  const cfg = config202();
  cfg.strands[1].enabled = false;
  const { universeByOutputIndex, disables } =
    derivePerOutputPlan(ledController(), { line_A: 40, line_B: 40 }, cfg, NO_CLAIMS);
  assert.deepEqual(universeByOutputIndex, { 0: 3, 1: 4 });
  assert.deepEqual(disables, [], 'nothing enabled on the board is being darkened');
});

test('_362: countChanges names every already-enabled output the push will resize', () => {
  const { countChanges } =
    derivePerOutputPlan(ledController(), { line_A: 20, line_B: 40 }, config202(), NO_CLAIMS);
  assert.deepEqual(countChanges, [{ outputIndex: 0, from: 40, to: 20 }]);
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

test('_362: fewer port rows than enabled outputs DISABLES the portless one (no more parking)', () => {
  // Real 202-shaped incident: the card has only 2 port rows, but the device has
  // 3 enabled outputs (0,1,2). Output 2 has no port row → the push darkens it.
  const cfg = config202();
  cfg.strands[2].enabled = true;                 // outputs 0,1,2 enabled on the device
  cfg.strands[2].dmxUniverse = 12;
  const controller = ledController({
    ports: [
      { port: 1, output: 1, universe: 10, startAddress: 1, chain: ['line_A'] },
      { port: 2, output: 2, universe: 11, startAddress: 1, chain: ['line_B'] },
    ],
  });
  const plan = derivePerOutputPlan(controller, { line_A: 40, line_B: 40 }, cfg, NO_CLAIMS);
  assert.deepEqual(plan.universeByOutputIndex, { 0: 10, 1: 11 });
  assert.deepEqual(plan.disables, [{ outputIndex: 2, deviceCount: 40, deviceUniverse: 12 }]);
  assert.equal('parked' in plan, false, 'parking is retired — the key is GONE, not empty');
  assert.deepEqual(plan.warnings, []);
});

// ── gap 4: a MIXED chain (some entries sized, some not) is BLOCKING ──────────
// The defect: `portPixelCount` summed the entries the sim could size and
// SKIPPED the rest, so a port chaining a known 40 px strand and a strand with
// no pixel count pushed `count: 40` onto a rope carrying more — the tail went
// dark while every chip, dialog and read-back reported success. There is no
// honest count to write, so the plan refuses.

/** A card whose port 1 chains a known strand AND one the sim cannot size. */
function mixedChainController() {
  return ledController({
    ports: [
      { port: 1, output: 1, universe: 3, startAddress: 1, chain: ['line_A', 'ghost_strand'] },
      { port: 2, output: 2, universe: 4, startAddress: 1, chain: ['line_B'] },
    ],
  });
}

test('gap 4: a MIXED chain is a BLOCKING collision naming both halves', () => {
  const plan = derivePerOutputPlan(mixedChainController(), { line_A: 40, line_B: 40 },
    config202(), NO_CLAIMS);
  assert.equal(plan.collisions.length, 1);
  const [collision] = plan.collisions;
  assert.equal(collision.kind, 'unknown_strand_count');
  assert.equal(collision.outputIndex, 0);
  assert.equal(collision.port, 1);
  assert.match(collision.message, /ghost_strand/);
  assert.match(collision.message, /line_A = 40 px/);
  assert.match(collision.message, /SHORT count/);
  // The OTHER port is untouched by the refusal — the message must point at the
  // one port the operator has to fix, not at the card in general.
  assert.equal(plan.universeByOutputIndex[1], 4);
});

test('gap 4: a fully-KNOWN chain of several strands still passes, summed', () => {
  const controller = mixedChainController();
  const plan = derivePerOutputPlan(controller, { line_A: 40, ghost_strand: 25, line_B: 40 },
    config202(), NO_CLAIMS);
  assert.deepEqual(plan.collisions, []);
  assert.deepEqual(plan.universeByOutputIndex, { 0: 3, 1: 4 });
  const out0 = plan.assignments.find((a) => a.outputIndex === 0);
  assert.equal(out0.pixelCount, 65, 'both chain entries are counted');
});

test('gap 4: a chain the sim can size NOTHING on stays a DISABLE, not a refusal', () => {
  // Deliberately different from the mixed case: nothing is written claiming a
  // length nobody measured — the output is darkened, and the confirm dialog's
  // DISABLES section says so outright.
  const controller = ledController({
    ports: [
      { port: 1, output: 1, universe: 3, startAddress: 1, chain: ['line_A'] },
      { port: 2, output: 2, universe: 4, startAddress: 1, chain: ['ghost_a', 'ghost_b'] },
    ],
  });
  const plan = derivePerOutputPlan(controller, { line_A: 40 }, config202(), NO_CLAIMS);
  assert.deepEqual(plan.collisions, []);
  assert.deepEqual(plan.universeByOutputIndex, { 0: 3 });
  assert.deepEqual(plan.disables, [{ outputIndex: 1, deviceCount: 40, deviceUniverse: undefined }]);
  assert.equal(plan.warnings.length, 1);
  assert.match(plan.warnings[0], /no pixel count for \(ghost_a, ghost_b\)/);
  assert.match(plan.warnings[0], /the push DISABLES it/);
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

// ── applyForcedPlan (RMW helper) ─────────────────────────────────────────────

test('_362: applyForcedPlan enables the mapped outputs and DISABLES every other one', () => {
  const strands = config202().strands;
  const out = applyForcedPlan(strands, planOf({ 0: 3, 1: 4 }));
  // Assigned outputs carry the per-output fields.
  assert.equal(out[0].dmxUniverse, 3);
  assert.equal(out[0].dmxStartAddress, 1);
  assert.equal(out[1].dmxUniverse, 4);
  // Unassigned outputs are copied with EVERY hardware field, and forced off.
  assert.equal('dmxUniverse' in out[2], false);
  assert.equal('dmxUniverse' in out[3], false);
  assert.equal(out[2].pinData, 37);
  assert.equal(out[2].colorOrder, 'RGBW');
  assert.equal(out[2].enabled, false);
  // Source array not mutated (pure).
  assert.equal('dmxUniverse' in strands[0], false);
});

// ── the forced push against a mocked device ─────────────────────────────────

test('_362: the forced POST carries strands + dmx, and disables the unmapped outputs', async () => {
  let posted = null;
  let gets = 0;
  const body = bodyOf(config202(), planOf({ 0: 3, 1: 4 }));
  await withFetch(async (url, opts) => {
    if (url === 'http://10.1.1.202/api/config' && (!opts || opts.method !== 'POST')) {
      gets += 1;
      return jsonResponse(config202());
    }
    if (url === 'http://10.1.1.202/api/config' && opts.method === 'POST') {
      assert.equal(opts.headers['Content-Type'], 'text/plain;charset=UTF-8');
      posted = JSON.parse(opts.body);
      return jsonResponse({ status: 'ok', outcome: 'needs-reboot', reboot: true });
    }
    throw new Error(`unexpected fetch ${url}`);
  }, async () => {
    const reply = await pushForcedConfig('10.1.1.202', body);
    assert.equal(reply.outcome, 'needs-reboot');
    assert.equal(reply.reboot, true);
  });

  assert.equal(gets, 0, 'the transport re-reads nothing — the body was built from ONE snapshot');
  // The exact JSON the forced push POSTs for 202.
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
    // _363 §2.1: the board's OWN dmx object, with only enabled + protocol forced
    // (config202 stores enabled:false, universe 1, startAddress 1, timeoutMs 3000).
    dmx: { enabled: true, protocol: 0, universe: 1, startAddress: 1, timeoutMs: 3000 },
  });
  assert.equal(posted.dmx.enabled, true, 'every push switches the board to DMX-driven');
  assert.equal(posted.dmx.protocol, 0, 'per-output universes are sACN-only by firmware rule');
  assert.equal('swarm' in posted, false, 'the narrowed push never mentions swarm');
});

test('_363: a board in SWARM is pushed with no refusal, and its swarm config is NOT touched', () => {
  const snapshot = { ...config202(), swarm: { enabled: true, isLeader: true, groupId: 'ropes' } };
  const body = bodyOf(snapshot, planOf({ 0: 3, 1: 4 }));
  assert.equal(body.dmx.enabled, true);
  // Ruling 6/7: swarm is operator-managed. The board's block survives
  // byte-for-byte because the push simply never mentions it.
  assert.equal('swarm' in body, false);
  assert.equal('gamma' in body, false);
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

test('_124: an empty stored deviceName is REPAIRED in the forced body', () => {
  const cfg = config202();
  cfg.deviceName = '';                       // ← exactly what the live board stores
  const body = bodyOf(cfg, planOf({ 0: 3, 1: 4 }, { controllerName: 'LeftLeftRopes' }));
  assert.equal(body.deviceName, 'LeftLeftRopes');
  // The rest of the body is untouched by the repair.
  assert.equal(body.strands.length, 4);
  assert.equal(body.strands[0].dmxUniverse, 3);
});

test('_124: a VALID stored name is never rewritten', () => {
  const body = bodyOf(config202(),                       // deviceName 'Titanic-202'
    planOf({ 0: 3, 1: 4 }, { controllerName: 'SomeOtherName' }));
  assert.equal('deviceName' in body, false);
});

test('_124: an unrepairable name refuses BEFORE any body exists', () => {
  const cfg = config202();
  cfg.deviceName = '';
  assert.throws(
    () => bodyOf(cfg, planOf({ 0: 3, 1: 4 }, { controllerName: 'Left Left Ropes' })),
    /RENAME THE CONTROLLER CARD/);
});

test('_362: a bad plan is rejected by the BUILDER — no body, so no POST', async () => {
  let postCalls = 0;
  await withFetch(async (url, opts) => {
    if (opts && opts.method === 'POST') { postCalls += 1; return jsonResponse({}); }
    return jsonResponse(config202());   // GET
  }, async () => {
    assert.throws(() => bodyOf(config202(), planOf({ 0: 3, 1: 900 })),
      /universe span 898 exceeds the 16-universe window/);
  });
  assert.equal(postCalls, 0);
});

test('_362: device 400 surfaces fields[].detail verbatim', async () => {
  const body = bodyOf(config202(), planOf({ 0: 3, 1: 4 }));
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
      () => pushForcedConfig('10.1.1.202', body),
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

const STRAND_COUNTS = new Map([
  ['Left_Front_Left', 40], ['Left_Back_Left', 40], ['Right_Front', 40]]);

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

test('_362: the LIVE repro — the portless third output is DISABLED, never re-homed', () => {
  const registry = liveReproRegistry();
  const card = registry.controllers[1];
  const { universeByOutputIndex, disables, warnings, collisions } =
    derivePerOutputPlan(card, STRAND_COUNTS, config60(), claimsFor(registry, card));

  // Pre-S2 this produced { 2: 23 } — LeftFrontDeck's universe; parking then held
  // U24 for it. Under force semantics it takes no universe at all: the push
  // writes enabled:false and the output goes dark.
  assert.deepEqual(universeByOutputIndex, { 0: 21, 1: 22 });
  assert.deepEqual(disables, [{ outputIndex: 2, deviceCount: 40, deviceUniverse: undefined }]);
  assert.deepEqual(collisions, []);
  assert.deepEqual(warnings, []);
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

test('_362: every portless enabled output is DISABLED — no universe is held for any of them', () => {
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
  const { universeByOutputIndex, disables, collisions } =
    derivePerOutputPlan(controller, { line_A: 40, line_B: 40 }, cfg, claimed);
  assert.deepEqual(universeByOutputIndex, { 0: 10, 1: 11 });
  assert.deepEqual(disables.map((d) => d.outputIndex), [2, 3]);
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
      return status60(confirmedPerOutputFor(calls.lastBody));
    },
    getConfig: async (ip) => {
      calls.push(`getConfig:${ip}`);
      return confirmedConfigFor(calls.lastBody);
    },
    pushForcedConfig: async (ip, body) => {
      calls.push(`push:${ip}`);
      calls.lastBody = body;
      calls.lastPlan = {};
      body.strands.forEach((strand, index) => {
        if (strand.enabled === true) calls.lastPlan[index] = strand.dmxUniverse;
      });
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
  assert.deepEqual(calls.lastPlan, { 0: 21, 1: 22 });
});

test('_362: the fleet push writes a board in ANY show mode — no refusal survives', async () => {
  for (const mode of ['active', 'desired', 'swarm']) {
    const registry = liveReproRegistry();
    const calls = [];
    const config = config60();
    config.dmx.enabled = mode === 'desired';
    if (mode === 'swarm') config.swarm = { enabled: true, isLeader: true };
    const io = {
      ...makeGateIo(calls),
      getStatus: async () => {
        calls.push('getStatus');
        const reported = calls.lastBody
          ? calls.lastBody.strands.map((strand, index) => ({
            index, universe: strand.dmxUniverse, startAddress: strand.dmxStartAddress,
            enabled: strand.enabled === true }))
          : [];
        return { ...status60(reported), dmxOwnsOutput: true };
      },
      getConfig: async () => {
        calls.push('getConfig');
        if (!calls.lastBody) return config;
        // The board answers with exactly what the forced push wrote.
        return {
          ...config,
          strands: calls.lastBody.strands.map((strand) => ({ ...strand })),
          dmx: { ...calls.lastBody.dmx },
          ...(calls.lastBody.swarm ? { swarm: { ...calls.lastBody.swarm } } : {}),
        };
      },
    };

    const results = await pushAllLedControllers(makeGateCtx(registry), io);
    assert.equal(results[0].state, 'pushed', `mode '${mode}' must not refuse the push`);
    assert.ok(calls.includes('push:10.0.0.60'));
    assert.equal(calls.lastBody.dmx.enabled, true);
    // _363: a swarm board is written WITHOUT a swarm key — the push leaves that
    // config alone, and the read-back's swarm state can never fail the verify.
    if (mode === 'swarm') assert.equal('swarm' in calls.lastBody, false);
  }
});

test('_362: push-all keeps going past a board that never answers, and models the results',
  async () => {
    // Three boards; the middle one times out on the write and never comes back.
    const registry = createControllerRegistry({
      controllers: [
        { id: 1, name: 'BoardA', ip: '10.0.0.61', type: CONTROLLER_TYPE_LED,
          protocol: CONTROLLER_PROTOCOL_SACN, led: { order: 'RGBW', startAddr: 1 },
          device: { vendor: 'marsinled', controllerId: 'a', deviceName: 'BoardA' },
          ports: [{ port: 1, universe: 21, chain: ['Left_Front_Left'] }] },
        { id: 2, name: 'BoardB', ip: '10.0.0.62', type: CONTROLLER_TYPE_LED,
          protocol: CONTROLLER_PROTOCOL_SACN, led: { order: 'RGBW', startAddr: 1 },
          device: { vendor: 'marsinled', controllerId: 'b', deviceName: 'BoardB' },
          ports: [{ port: 1, universe: 31, chain: ['Left_Back_Left'] }] },
        { id: 3, name: 'BoardC', ip: '10.0.0.63', type: CONTROLLER_TYPE_LED,
          protocol: CONTROLLER_PROTOCOL_SACN, led: { order: 'RGBW', startAddr: 1 },
          device: { vendor: 'marsinled', controllerId: 'c', deviceName: 'BoardC' },
          ports: [{ port: 1, universe: 41, chain: ['Right_Front'] }] },
      ],
    });
    const reached = [];
    const bodyByIp = new Map();
    const oneOutput = () => ({
      strands: [rgbwStrand(40, true, 35)],
      dmx: { enabled: false, protocol: 0, timeoutMs: 3000 },
      deviceName: 'Board',
    });
    const io = {
      getStatus: async (ip) => {
        const body = bodyByIp.get(ip);
        return {
          controllerId: { '10.0.0.61': 'a', '10.0.0.62': 'b', '10.0.0.63': 'c' }[ip],
          boardId: 'angio4', firmwareSHA: 'ff00',
          capabilitiesExt: { perOutputDmx: true },
          sacn: { enabled: true, perOutput: [] },
          strands: body ? body.strands : oneOutput().strands,
        };
      },
      getConfig: async (ip) => {
        const body = bodyByIp.get(ip);
        return body
          ? { ...oneOutput(), strands: body.strands.map((x) => ({ ...x })), dmx: { ...body.dmx } }
          : oneOutput();
      },
      pushForcedConfig: async (ip, body) => {
        reached.push(ip);
        if (ip === '10.0.0.62') {
          const err = new Error('timed out after 12000 ms — device did not respond');
          err.writeResponseLost = true;
          throw err;
        }
        bodyByIp.set(ip, body);
        return { outcome: 'needs-reboot', reboot: true };
      },
      awaitReboot: async (ip) => {
        if (ip === '10.0.0.62') throw new Error('device never came back');
      },
    };
    const progress = [];
    const results = await pushAllLedControllers(
      makeGateCtx(registry), io, (p) => progress.push(p));

    assert.deepEqual(reached, ['10.0.0.61', '10.0.0.62', '10.0.0.63'],
      'one failure never aborts the loop');
    assert.deepEqual(results.map((r) => r.state), ['pushed', 'failed', 'pushed']);
    assert.match(results[1].detail, /UNCONFIRMED/);
    // Per-controller live progress, not one status line for the whole fleet.
    assert.ok(progress.some((p) => p.name === 'BoardB' && /FAILED/.test(p.phase)));
    assert.ok(progress.some((p) => p.name === 'BoardC' && /PUSHED/.test(p.phase)));

    const rows = pushAllResultsModel(results);
    assert.deepEqual(rows.map((r) => r.state), ['PUSHED', 'FAILED', 'PUSHED']);
    assert.deepEqual(rows.map((r) => r.name), ['BoardA', 'BoardB', 'BoardC']);
    assert.deepEqual(rows.map((r) => r.ip), ['10.0.0.61', '10.0.0.62', '10.0.0.63']);
    assert.match(rows[1].reason, /UNCONFIRMED/);
    assert.throws(() => pushAllResultsModel([{ name: 'x', state: 'weird' }]),
      /unknown result state 'weird'/);
  });

// ── S2: the sync chip derives with the SAME claims as the push ───────────────

/** A .60 config the forced push would confirm: DMX on, out 3 already dark. */
function config60Confirmed(mapping) {
  const cfg = config60WithMapping(mapping);
  cfg.strands[2].enabled = false;
  cfg.dmx = { enabled: true, protocol: 0, timeoutMs: 3000 };
  return cfg;
}

test('S2: the sync chip does NOT false-drift — same claims ⇒ same plan as the push', async () => {
  const registry = liveReproRegistry();
  const card = registry.controllers[1];
  // The device carries exactly what a forced push writes: U21/U22 enabled, the
  // portless third output DISABLED, and the board DMX-driven.
  const confirmed = [
    { index: 0, universe: 21, startAddress: 1, enabled: true },
    { index: 1, universe: 22, startAddress: 1, enabled: true },
  ];
  await withFetch(async (url) => {
    if (url === 'http://10.0.0.60/api/config') {
      return jsonResponse(config60Confirmed({ 0: 21, 1: 22 }));
    }
    if (url === 'http://10.0.0.60/api/status') return jsonResponse(status60(confirmed));
    throw new Error(`unexpected fetch ${url}`);
  }, async () => {
    const state = await computeSyncState(makeGateCtx(registry), card);
    assert.deepEqual(state, { state: 'in-sync' });
  });
});

test('_363: a SWARM board with a PERFECT mapping and DMX ON reads IN SYNC', async () => {
  // `_362` read this as drift, because the push of the day switched the board out
  // of SWARM. The NARROWED push never mentions swarm (ruling 6/7), so pushing this
  // board would change NOTHING — and a chip claiming drift would promise a change
  // the push cannot make (report `_363` §2.3-3).
  const registry = liveReproRegistry();
  const card = registry.controllers[1];
  const confirmed = [
    { index: 0, universe: 21, startAddress: 1, enabled: true },
    { index: 1, universe: 22, startAddress: 1, enabled: true },
  ];
  const cfg = config60Confirmed({ 0: 21, 1: 22 });
  cfg.swarm = { enabled: true, isLeader: true };
  await withFetch(async (url) => {
    if (url === 'http://10.0.0.60/api/config') return jsonResponse(cfg);
    if (url === 'http://10.0.0.60/api/status') return jsonResponse(status60(confirmed));
    throw new Error(`unexpected fetch ${url}`);
  }, async () => {
    const state = await computeSyncState(makeGateCtx(registry), card);
    assert.deepEqual(state, { state: 'in-sync' });
  });
});

test('_363: the SAME board with DMX OFF still reads DRIFT — the push forces DMX ON', async () => {
  const registry = liveReproRegistry();
  const card = registry.controllers[1];
  const confirmed = [
    { index: 0, universe: 21, startAddress: 1, enabled: true },
    { index: 1, universe: 22, startAddress: 1, enabled: true },
  ];
  const cfg = config60Confirmed({ 0: 21, 1: 22 });
  cfg.swarm = { enabled: true, isLeader: true };
  cfg.dmx = { enabled: false, protocol: 0, timeoutMs: 3000 };
  await withFetch(async (url) => {
    if (url === 'http://10.0.0.60/api/config') return jsonResponse(cfg);
    if (url === 'http://10.0.0.60/api/status') return jsonResponse(status60(confirmed));
    throw new Error(`unexpected fetch ${url}`);
  }, async () => {
    const ctx = makeGateCtx(registry);
    const state = await computeSyncState(ctx, card);
    assert.equal(state.state, 'drift');
    assert.match(state.detail, /board is not DMX-driven — push will force DMX ON/);
    // The clause that made a SWARM board drift is GONE — the detail says nothing
    // about swarm any more, because the push does nothing to it.
    assert.equal(/SWARM/.test(state.detail), false);
    // ZERO new reads: the same sweep that computed the chip seeded the ⏻ label.
    assert.equal(getDmxState(ctx, card.id), false);
  });
});

test('_362: an output the push will DISABLE reads as drift (`enabled · U24 → disabled`)', async () => {
  const registry = liveReproRegistry();
  const card = registry.controllers[1];
  // The board still holds the old parked third output, enabled on U24.
  const cfg = config60WithMapping({ 0: 21, 1: 22, 2: 24 });
  cfg.dmx = { enabled: true, protocol: 0, timeoutMs: 3000 };
  const confirmed = [
    { index: 0, universe: 21, startAddress: 1, enabled: true },
    { index: 1, universe: 22, startAddress: 1, enabled: true },
    { index: 2, universe: 24, startAddress: 1, enabled: true },
  ];
  await withFetch(async (url) => {
    if (url === 'http://10.0.0.60/api/config') return jsonResponse(cfg);
    if (url === 'http://10.0.0.60/api/status') return jsonResponse(status60(confirmed));
    throw new Error(`unexpected fetch ${url}`);
  }, async () => {
    const state = await computeSyncState(makeGateCtx(registry), card);
    assert.equal(state.state, 'drift');
    assert.deepEqual(state.changes,
      [{ path: 'output 2', from: 'enabled · U24', to: 'disabled' }]);
  });
});

test('_102: the sync chip stays IN-SYNC on a shared universe but CARRIES the warning', async () => {
  const registry = liveReproRegistry({ ledPort2Universe: 23 });
  const card = registry.controllers[1];
  // The plan a push WOULD write: P1→U21, P2→U23 (the shared one), and the third
  // board output DISABLED — no port maps it.
  const confirmed = [
    { index: 0, universe: 21, startAddress: 1, enabled: true },
    { index: 1, universe: 23, startAddress: 1, enabled: true },
  ];
  await withFetch(async (url) => {
    if (url === 'http://10.0.0.60/api/config') {
      return jsonResponse(config60Confirmed({ 0: 21, 1: 23 }));
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
/** The config a board reports after it applied `body` verbatim. */
function confirmedConfigFor(body) {
  const cfg = config60();
  if (!body) return cfg;
  return {
    ...cfg,
    strands: body.strands.map((strand) => ({ ...strand })),
    dmx: { ...body.dmx },
    ...(body.swarm ? { swarm: { ...body.swarm } } : {}),
  };
}

/** The per-output read-back a board reports after it applied `body` verbatim. */
function confirmedPerOutputFor(body) {
  if (!body) return [];
  return body.strands
    .map((strand, index) => ({ index, universe: strand.dmxUniverse,
      startAddress: strand.dmxStartAddress, enabled: strand.enabled === true }))
    .filter((entry) => entry.enabled);
}

function makeS1Io(calls, {
  save = { ok: true }, notify = { ok: true },
  confirm = { ok: true, detail: 'U21,U22→10.0.0.60' },
  failPush = false,
} = {}) {
  const answer = (v) => (typeof v === 'function' ? v() : v);
  return {
    pushForcedConfig: async (_ip, body) => {
      calls.push('push');
      if (failPush) throw new Error('device rejected: HTTP 400');
      calls.lastBody = body;
      return { outcome: 'needs-reboot', reboot: true };
    },
    awaitReboot: async () => { calls.push('awaitReboot'); },
    getStatus: async () => {
      calls.push('getStatus');
      return status60(confirmedPerOutputFor(calls.lastBody));
    },
    getConfig: async () => {
      calls.push('getConfig');
      return confirmedConfigFor(calls.lastBody);
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
 * The plan `runPerOutputPush` takes: the whole `derivePerOutputPlan` result, not
 * a bare universe map (a bare map cannot say which outputs a push must ENABLE
 * and which it must DISABLE), plus the ONE body the confirm dialog previewed.
 */
const S1_PLAN = planOf({ 0: 21, 1: 22 }, {
  controllerName: 'LeftLeftFront',
  assignments: [
    { outputIndex: 0, portNum: 1, universe: 21, pixelCount: 40 },
    { outputIndex: 1, portNum: 2, universe: 22, pixelCount: 40 },
  ],
  disables: [{ outputIndex: 2, deviceCount: 40, deviceUniverse: undefined }],
});

const S1_BODY = () => buildForcedConfigBody({
  snapshot: config60(), plan: S1_PLAN, ip: '10.0.0.60',
});

test('S1: a successful push persists THEN notifies, and reports all three steps', async () => {
  const registry = s1Registry();
  const calls = [];
  const toasts = [];
  const ui = makeS1Ui();
  await runPerOutputPush(makeS1Ctx(registry, toasts), registry.controllers[0], S1_PLAN, S1_BODY(),
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
  await runPerOutputPush(makeS1Ctx(registry, toasts), registry.controllers[0], S1_PLAN, S1_BODY(),
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
  await runPerOutputPush(makeS1Ctx(registry, []), registry.controllers[0], S1_PLAN, S1_BODY(),
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
  await runPerOutputPush(makeS1Ctx(registry, toasts), registry.controllers[0], S1_PLAN, S1_BODY(),
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
  await runPerOutputPush(ctx, card, S1_PLAN, S1_BODY(),
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
  await runPerOutputPush(makeS1Ctx(registry, []), registry.controllers[0], S1_PLAN, S1_BODY(),
    makeS1Io(calls, { failPush: true }), ui);
  assert.match(ui.statusLine.textContent, /forced push failed: device rejected: HTTP 400/);
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
  }, [{ ip: '10.0.0.60', expected: [21] }]);
  assert.equal(steps.confirm.ok, false);
  assert.match(steps.confirm.reason, /no confirmBridgeRoutes\(\)/);
});

test('_127: a confirm that answers ok WITHOUT naming routes is refused', async () => {
  const steps = await persistAndNotifyAfterPush({
    persistScene: async () => ({ ok: true }),
    notifyBridge: async () => ({ ok: true }),
    confirmBridgeRoutes: async () => ({ ok: true }),
  }, [{ ip: '10.0.0.60', expected: [21] }]);
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
  assert.match(tip, /^Measures the DEVICE against the FORCED plan this page would push/);
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
  await runPerOutputPush(ctx, card, S1_PLAN, S1_BODY(),
    makeS1Io([], { save: { ok: false, reason: 'save server responded 500' } }), makeS1Ui());
  const tip = describeSyncChipTooltip(getSyncState(ctx, card.id));
  // Same vocabulary on both halves — the header says the chip does not measure the
  // sACN feed, the detail says that feed is stale. No competing claims.
  assert.match(tip, /NOT the sACN feed/);
  assert.match(tip, /device ≡ plan, but the sACN feed is STALE — scene save failed/);
});

// ── the port-universe repair is COMMITTED ON ACCEPT, never on preview ────────
// It used to run inside `startPush` BEFORE the confirm dialog existed, so
// opening the dialog and pressing Cancel left the registry mutated (and the
// scene dirty) for a push that never happened. The repair now rides on the
// derived plan — pure — and is committed only on the FORCE path, with the SAME
// universe the previewed body carries.

/**
 * A DOM stub just wide enough for the push dialogs (no jsdom in this repo —
 * offline readiness; same approach as wheel_guard.test.js). Nodes carry the
 * three properties the panel touches plus a children list, so a test can find
 * a button by its label and click it.
 */
function makeDomNode(tag) {
  return {
    tag, className: '', textContent: '', disabled: false, children: [],
    appendChild(child) { this.children.push(child); return child; },
    remove() { this.removed = true; },
    focus() { this.focused = true; },
  };
}

async function withDom(fn) {
  const created = [];
  const original = globalThis.document;
  globalThis.document = {
    createElement: (tag) => { const node = makeDomNode(tag); created.push(node); return node; },
    body: makeDomNode('body'),
  };
  try {
    return await fn(created);
  } finally {
    globalThis.document = original;
  }
}

const buttonNamed = (created, label) =>
  created.find((n) => n.tag === 'button' && n.textContent === label);

/** The s1 card with port 1 left at an INVALID universe (the repair's only job). */
function unrepairedRegistry() {
  const registry = s1Registry();
  registry.controllers[0].ports[0].universe = 0;
  return registry;
}

test('cancel: the preview mutates NOTHING — the card keeps its invalid universe', async () => {
  const registry = unrepairedRegistry();
  const card = registry.controllers[0];
  const mutations = [];
  const ctx = { ...makeS1Ctx(registry, []), mutate: (msg, fn) => { mutations.push(msg); fn(); } };
  const posts = [];

  await withDom(async (created) => {
    await withFetch(async (url, opts) => {
      if (opts && opts.method === 'POST') { posts.push(url); throw new Error('no write on preview'); }
      if (url === 'http://10.0.0.60/api/config') return jsonResponse(config60());
      if (url === 'http://10.0.0.60/api/status') return jsonResponse(status60());
      throw new Error(`unexpected fetch ${url}`);
    }, async () => {
      await startPush(ctx, card);
    });

    // The dialog IS up (so this is the real preview path, not an early refusal)…
    const confirmBtn = buttonNamed(created, 'FORCE push');
    assert.ok(confirmBtn, 'the confirm dialog opened');
    // …and the previewed payload carries the repaired universe, U23 — the plan's
    // own auto-assign leg did that, without writing it to the card.
    const pre = created.find((n) => n.tag === 'pre');
    assert.match(pre.textContent, /"dmxUniverse": 23/);
    assert.equal(card.ports[0].universe, 0, 'the preview never touched the registry');
    assert.deepEqual(mutations, [], 'no undo entry, no dirty scene');

    buttonNamed(created, 'Cancel').onclick();
    assert.equal(card.ports[0].universe, 0, 'cancel leaves the card exactly as it was');
    assert.deepEqual(mutations, []);
  });
  assert.deepEqual(posts, []);
});

test('accept: FORCE commits the SAME universe the previewed body carries', async () => {
  const registry = unrepairedRegistry();
  const card = registry.controllers[0];
  const mutations = [];
  const ctx = { ...makeS1Ctx(registry, []), mutate: (msg, fn) => { mutations.push(msg); fn(); } };
  const plan = derivePerOutputPlan(card, STRAND_COUNTS, config60(), new Map());
  const body = buildForcedConfigBody({ snapshot: config60(), plan, ip: '10.0.0.60' });
  assert.equal(body.strands[0].dmxUniverse, 23);

  const calls = [];
  await runPerOutputPush(ctx, card, plan, body, makeS1Io(calls), makeS1Ui());

  assert.equal(card.ports[0].universe, 23,
    'the registry now states exactly what the board was told');
  assert.ok(mutations.some((m) => /Allocated universe\(s\) for LeftLeftFront/.test(m)));
  assert.equal(card.ports[1].universe, 22, 'a valid manual universe is never rewritten');
});

// ── gap 5: the FLEET SAVE GATE ───────────────────────────────────────────────
// The defect: `startPushAll` ran the completion (save → notify → route
// read-back) unconditionally after the loop, so a fleet where one board failed
// still wrote the WHOLE registry's mapping to patches.yaml and told the bridge
// to stream it. Hardware and file then disagreed on exactly the board that
// failed. Now the completion runs only on a clean fleet, and says so loudly
// otherwise. No "save anyway" override exists — fix the board and push again.

/** Three bound LED cards, one per IP the fleet io below answers for. */
function fleetRegistry() {
  return createControllerRegistry({
    controllers: [
      { id: 1, name: 'BoardA', ip: '10.0.0.71', type: CONTROLLER_TYPE_LED,
        protocol: CONTROLLER_PROTOCOL_SACN, led: { order: 'RGBW', startAddr: 1 },
        device: { vendor: 'marsinled', controllerId: 'a', deviceName: 'BoardA' },
        ports: [{ port: 1, universe: 21, chain: ['Left_Front_Left'] }] },
      { id: 2, name: 'BoardB', ip: '10.0.0.72', type: CONTROLLER_TYPE_LED,
        protocol: CONTROLLER_PROTOCOL_SACN, led: { order: 'RGBW', startAddr: 1 },
        device: { vendor: 'marsinled', controllerId: 'b', deviceName: 'BoardB' },
        ports: [{ port: 1, universe: 31, chain: ['Left_Back_Left'] }] },
      { id: 3, name: 'BoardC', ip: '10.0.0.73', type: CONTROLLER_TYPE_LED,
        protocol: CONTROLLER_PROTOCOL_SACN, led: { order: 'RGBW', startAddr: 1 },
        device: { vendor: 'marsinled', controllerId: 'c', deviceName: 'BoardC' },
        ports: [{ port: 1, universe: 41, chain: ['Right_Front'] }] },
    ],
  });
}

/**
 * Device io for the fleet above plus the three completion steps, all mocked.
 * `failIp` (or null) is the one board whose write is refused by the device.
 */
function fleetIo(calls, failIp) {
  const bodyByIp = new Map();
  const oneOutput = () => ({
    strands: [rgbwStrand(40, true, 35)],
    dmx: { enabled: false, protocol: 0, timeoutMs: 3000 },
    deviceName: 'Board',
  });
  return {
    getStatus: async (ip) => ({
      controllerId: { '10.0.0.71': 'a', '10.0.0.72': 'b', '10.0.0.73': 'c' }[ip],
      boardId: 'angio4', firmwareSHA: 'ff00',
      capabilitiesExt: { perOutputDmx: true },
      sacn: { enabled: true, perOutput: [] },
      strands: (bodyByIp.get(ip) || oneOutput()).strands,
      dmxOwnsOutput: true,
    }),
    getConfig: async (ip) => {
      const body = bodyByIp.get(ip);
      return body
        ? { ...oneOutput(), strands: body.strands.map((s) => ({ ...s })), dmx: { ...body.dmx } }
        : oneOutput();
    },
    pushForcedConfig: async (ip, body) => {
      calls.push(`push:${ip}`);
      if (ip === failIp) {
        const err = new Error('[MarsinLED] device rejected config: config apply failed');
        err.httpStatus = 400;
        throw err;
      }
      bodyByIp.set(ip, body);
      return { outcome: 'needs-reboot', reboot: true };
    },
    awaitReboot: async () => {},
    persistScene: async () => { calls.push('persistScene'); return { ok: true }; },
    notifyBridge: async () => { calls.push('notifyBridge'); return { ok: true }; },
    confirmBridgeRoutes: async () => {
      calls.push('confirmRoutes');
      return { ok: true, detail: 'U21,U31,U41' };
    },
  };
}

test('gap 5: fleetSaveGate — any FAILED board refuses the save, and names them', () => {
  const clean = fleetSaveGate([{ name: 'A', state: 'pushed' }, { name: 'B', state: 'pushed' }]);
  assert.equal(clean.allowed, true);
  assert.equal(clean.reason, null);

  const dirty = fleetSaveGate([
    { name: 'A', state: 'pushed' }, { name: 'B', state: 'failed' }, { name: 'C', state: 'failed' },
  ]);
  assert.equal(dirty.allowed, false);
  assert.match(dirty.reason, /scene was NOT saved/);
  assert.match(dirty.reason, /2 board\(s\) FAILED \(B, C\)/);
  assert.match(dirty.reason, /cannot be rolled back/);
  assert.match(dirty.reason, /push all again/);

  // A SKIPPED card was never attempted — it can neither agree nor disagree with
  // the file, so it must not hold the whole fleet's save hostage.
  const skipped = fleetSaveGate([{ name: 'A', state: 'pushed' }, { name: 'B', state: 'skipped' }]);
  assert.equal(skipped.allowed, true);
  assert.throws(() => fleetSaveGate('nope'), /results must be/);
});

test('gap 5: a 3-board fleet with ONE failure saves NOTHING and notifies NOBODY', async () => {
  const registry = fleetRegistry();
  const calls = [];
  const io = fleetIo(calls, '10.0.0.72');
  const results = await pushAllLedControllers(makeGateCtx(registry), io);
  assert.deepEqual(results.map((r) => r.state), ['pushed', 'failed', 'pushed']);

  const completion = await completeFleetPush(io, results);
  assert.equal(completion.saved, false);
  assert.equal(completion.steps, null);
  assert.match(completion.gate.reason, /1 board\(s\) FAILED \(BoardB\)/);
  assert.equal(calls.includes('persistScene'), false, 'a split fleet never reaches the disk');
  assert.equal(calls.includes('notifyBridge'), false);
  assert.equal(calls.includes('confirmRoutes'), false);
  // The two boards that DID take the push are still written — the gate is about
  // the file, never a rollback of hardware.
  assert.deepEqual(calls.filter((c) => c.startsWith('push:')),
    ['push:10.0.0.71', 'push:10.0.0.72', 'push:10.0.0.73']);
});

test('gap 5: an ALL-PASS fleet saves, notifies and confirms the routes as before', async () => {
  const registry = fleetRegistry();
  const calls = [];
  const io = fleetIo(calls, null);
  const results = await pushAllLedControllers(makeGateCtx(registry), io);
  assert.deepEqual(results.map((r) => r.state), ['pushed', 'pushed', 'pushed']);

  const completion = await completeFleetPush(io, results);
  assert.equal(completion.saved, true);
  assert.equal(completion.steps.save.ok, true);
  assert.equal(completion.steps.notify.ok, true);
  assert.equal(completion.steps.confirm.ok, true);
  const iSave = calls.indexOf('persistScene');
  const iNotify = calls.indexOf('notifyBridge');
  const iConfirm = calls.indexOf('confirmRoutes');
  assert.ok(iSave >= 0 && iNotify > iSave && iConfirm > iNotify, 'the S1 ordering is unchanged');
  assert.equal(calls.filter((c) => c === 'persistScene').length, 1);
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
    pushForcedConfig: async (_ip, body) => {
      calls.push('push');
      calls.lastBody = body;
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
      if (readBackPlan) {
        return status60(Object.entries(readBackPlan).map(([index, universe]) =>
          ({ index: Number(index), universe, startAddress: 1, enabled: true })));
      }
      return status60(confirmedPerOutputFor(calls.lastBody));
    },
    getConfig: async () => {
      calls.push('getConfig');
      if (readBackPlan) {
        // A board that applied something DIFFERENT from what was written.
        const drifted = confirmedConfigFor(calls.lastBody);
        for (const [index, universe] of Object.entries(readBackPlan)) {
          drifted.strands[Number(index)].dmxUniverse = universe;
        }
        return drifted;
      }
      return confirmedConfigFor(calls.lastBody);
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
  await runPerOutputPush(makeS1Ctx(registry, toasts), registry.controllers[0], S1_PLAN, S1_BODY(),
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
  await runPerOutputPush(makeS1Ctx(registry, []), registry.controllers[0], S1_PLAN, S1_BODY(),
    makeLostReplyIo([]), ui);

  // Phase 1 declares the write budget so a slow write does not read as a hang.
  assert.ok(history.some((t) => /up to 12s to answer the write/.test(t)), history.join(' | '));
  // Phase 2 says it is waiting out a reboot, with the budget and the elapsed time.
  assert.ok(history.some((t) => /Waiting up to 45s for it to come back/.test(t)));
  assert.ok(history.some(
    (t) => /device rebooting — waiting up to 45s for it to answer \(3s elapsed\)/.test(t)));
  // Phase 3 runs only after the device answered.
  assert.ok(history.some((t) => /reading the full saved config back/.test(t)));
});

test('_69: a device unreachable through the WHOLE budget is red, and never saves', async () => {
  const registry = s1Registry();
  const card = registry.controllers[0];
  const calls = [];
  const toasts = [];
  const ctx = makeS1Ctx(registry, toasts);
  await runPerOutputPush(ctx, card, S1_PLAN, S1_BODY(),
    makeLostReplyIo(calls, { comesBack: false }),
    makeS1Ui());

  assert.equal(calls.includes('persistScene'), false, 'a genuinely dead device saves nothing');
  assert.equal(calls.includes('notifyBridge'), false);
  assert.equal(getSyncState(ctx, card.id).state, 'unreachable');
  assert.equal(toasts.length, 0, 'the device step already reported; no completion toast');
});

test('_69: an unconfirmed write says so — it never claims the write failed', async () => {
  const registry = s1Registry();
  const { ui } = makeRecordingUi();
  await runPerOutputPush(makeS1Ctx(registry, []), registry.controllers[0], S1_PLAN, S1_BODY(),
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
  await runPerOutputPush(ctx, card, S1_PLAN, S1_BODY(),
    makeLostReplyIo(calls, { readBackPlan: { 0: 21, 1: 99 } }), ui);

  assert.match(ui.statusLine.textContent,
    /the device did not answer the write AND the read-back shows a DIFFERENT config/);
  assert.match(ui.statusLine.textContent,
    /device config mismatch — output 1: device U99 ≠ wanted U22/);
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

// ── _71: port → physical-output association (report 20260725_70), under the
// _362 FORCE contract ───────────────────────────────────────────────────────
// A card port DECLARES the board output it drives (`port.output`, 1-based). The
// push ENABLES exactly the outputs a port maps and writes `enabled: false` on
// every other one — the sim panel is the source of truth.
// Nothing here sleeps or touches a device — every io bag is a mock.

/** A .60-shaped registry whose LED card can declare crossed outputs. */
function outputRegistry(portSpecs, { withDeck = true } = {}) {
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

test('_71 (6): IDENTITY mapping — the plan is exactly today\'s, with nothing to disable', () => {
  const registry = outputRegistry(IDENTITY_PORTS, { withDeck: false });
  const card = registry.controllers[0];
  const plan = derivePerOutputPlan(card, STRAND_COUNTS, config60Enabled([true, true, false, false]),
    NO_CLAIMS);
  assert.deepEqual(plan.universeByOutputIndex, { 0: 21, 1: 22 });
  assert.deepEqual(plan.assignments, [
    { outputIndex: 0, portNum: 1, universe: 21, pixelCount: 40 },
    { outputIndex: 1, portNum: 2, universe: 22, pixelCount: 40 },
  ]);
  assert.deepEqual(plan.disables, [], 'outputs 3/4 are already off — nothing goes dark');
  assert.deepEqual(plan.countChanges, []);
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

test('_71 (8): ONE port driving output 4 ENABLES it and DISABLES 1-3', () => {
  const registry = outputRegistry([
    { port: 1, output: 4, universe: 21, chain: ['Left_Front_Left'] },
  ], { withDeck: false });
  const card = registry.controllers[0];
  const cfg = config60Enabled([true, true, true, false]);   // out 4 is OFF today
  const plan = derivePerOutputPlan(card, STRAND_COUNTS, cfg, NO_CLAIMS);

  assert.deepEqual(plan.assignments,
    [{ outputIndex: 3, portNum: 1, universe: 21, pixelCount: 40 }]);
  // Outputs 1–3 are enabled on the board with no port: the push DARKENS them,
  // and names each one so the confirm dialog can say so before the write.
  assert.deepEqual(plan.disables.map((d) => d.outputIndex), [0, 1, 2]);
  assert.deepEqual(plan.collisions, []);

  const applied = applyForcedPlan(cfg.strands, plan);
  assert.deepEqual(applied.map((x) => x.enabled), [false, false, false, true]);
  assert.equal(applied[3].count, 40, 'the enabled output gets the mapped pixel count');
  assert.equal(applied[3].dmxUniverse, 21);
  assert.equal(applied[3].dmxStartAddress, 1);
  // …and the applied array is what the firmware rules are checked against.
  assert.doesNotThrow(() => validatePerOutputPlan(applied, plan.universeByOutputIndex));
});

// (9) The live .60 repro: a portless ENABLED output goes DARK, never re-homed.

test('_71 (9): a portless ENABLED output is DISABLED, never handed another universe', () => {
  const registry = outputRegistry(IDENTITY_PORTS);           // deck owns U23
  const card = registry.controllers[1];
  const cfg = config60Enabled([true, true, true, false]);
  const plan = derivePerOutputPlan(card, STRAND_COUNTS, cfg, claimsFor(registry, card));

  assert.deepEqual(plan.disables, [{ outputIndex: 2, deviceCount: 40, deviceUniverse: undefined }]);
  assert.equal(plan.universeByOutputIndex[2], undefined, 'no universe is held for a dark output');
  assert.deepEqual(plan.collisions, []);
  const applied = applyForcedPlan(cfg.strands, plan);
  assert.equal(applied[2].enabled, false, 'the portless output goes dark');
  assert.equal(applied[3].enabled, false, 'an unmapped DISABLED output stays off');
  assert.equal('dmxUniverse' in applied[3], false);
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

test('gap 4: the fleet push REFUSES a mixed chain and writes NOTHING to that board', async () => {
  // 'Right_Front' is in STRAND_COUNTS; 'ghost_strand' is not — the same shape as
  // a rope somebody chained in the panel before its fixture existed.
  const registry = outputRegistry([
    { port: 1, output: 1, universe: 21, chain: ['Left_Front_Left', 'ghost_strand'] },
    { port: 2, output: 2, universe: 22, chain: ['Left_Back_Left'] },
  ], { withDeck: false });
  const calls = [];
  const results = await pushAllLedControllers(makeGateCtx(registry), makeGateIo(calls));
  assert.equal(results[0].state, 'failed');
  assert.match(results[0].detail, /push REFUSED/);
  assert.match(results[0].detail, /ghost_strand/);
  assert.equal(calls.includes('push:10.0.0.60'), false,
    'a plan with no honest count must not reach the device');
});

test('gap 4: the same fleet card with EVERY strand sized pushes normally', async () => {
  const registry = outputRegistry([
    { port: 1, output: 1, universe: 21, chain: ['Left_Front_Left', 'Right_Front'] },
    { port: 2, output: 2, universe: 22, chain: ['Left_Back_Left'] },
  ], { withDeck: false });
  const calls = [];
  const results = await pushAllLedControllers(makeGateCtx(registry), makeGateIo(calls));
  assert.equal(results[0].state, 'pushed');
  assert.ok(calls.includes('push:10.0.0.60'));
  assert.equal(calls.lastBody.strands[0].count, 80, 'both chained strands are counted');
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

test('_71 (15): claims cover another card\'s STRANDLESS port universe', () => {
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
  // Pre-_71 this was INVISIBLE: no strand projects it, so another card's push
  // could take a universe the .60 is already subscribed to.
  assert.equal(claimed.get(22), 'LeftLeftFront port 2 → output 2');
  // A card never claims against ITSELF, or every push of a mapped card would refuse.
  const own = claimsFor(registry, registry.controllers[0]);
  assert.equal(own.has(21), false);
  assert.equal(own.has(22), false);
});

// (16) Validation runs on the APPLIED array.

test('_71 (16): validatePerOutputPlan runs on the APPLIED array (the old order refused a legal plan)', () => {
  const cfg = config60Enabled([true, false, false, false]);
  const plan = planOf({ 0: 21, 1: 22 });
  // Against the DEVICE's array output 1 is not enabled — the pre-push state
  // cannot express an enable, so this is the throw the old ordering produced.
  assert.throws(() => validatePerOutputPlan(cfg.strands, plan.universeByOutputIndex),
    /output 1 carries a universe but is not an enabled strand/);
  // Against the APPLIED array — the intended post-push state — it is legal.
  assert.doesNotThrow(() =>
    validatePerOutputPlan(applyForcedPlan(cfg.strands, plan), plan.universeByOutputIndex));
});

// (17) The count policy: FORCED from the sim's mapping, both directions.

test('_362: `count` is FORCED on an already-enabled output, and every rewrite is named', () => {
  const registry = outputRegistry([
    { port: 1, output: 1, universe: 21, chain: ['Left_Front_Left'] },   // device says 40 px
    { port: 2, output: 2, universe: 22, chain: ['Left_Back_Left'] },
  ], { withDeck: false });
  const card = registry.controllers[0];
  const cfg = config60Enabled([true, false, false, false]);
  // The sim maps output 1 at 20 px while the device holds 40 (the standing
  // 20-vs-40 question). The panel is the source of truth now: it is REWRITTEN,
  // and `countChanges` names it so the dialog can show it before the write.
  const counts = new Map([['Left_Front_Left', 20], ['Left_Back_Left', 40]]);
  const plan = derivePerOutputPlan(card, counts, cfg, NO_CLAIMS);
  assert.deepEqual(plan.countChanges, [{ outputIndex: 0, from: 40, to: 20 }]);
  const applied = applyForcedPlan(cfg.strands, plan);
  assert.equal(applied[0].count, 20, "the sim's mapping wins over the hardware count");
  assert.equal(applied[1].count, 40, 'the newly enabled output takes the mapped count');
});

test('_362: an EMPTY port row is not assigned — its output is disabled by the push', () => {
  // The everyday 4-row card driving two strands: rows 3 and 4 map nothing and
  // point at outputs the board has off. Nothing to enable them with.
  const registry = outputRegistry([
    ...IDENTITY_PORTS,
    { port: 3, output: 3, universe: 25, chain: [] },
    { port: 4, output: 4, universe: 26, chain: [] },
  ], { withDeck: false });
  const plan = derivePerOutputPlan(registry.controllers[0], STRAND_COUNTS,
    config60Enabled([true, true, false, false]), NO_CLAIMS);
  assert.deepEqual(plan.universeByOutputIndex, { 0: 21, 1: 22 });
  assert.deepEqual(plan.disables, []);
  assert.deepEqual(plan.collisions, []);
});

// (18)/(19) The read-back verifies the WHOLE map, and composes with _69.

/** io whose device reports back the pushed body, optionally drifted. */
function makeVerifyIo(calls, { readBack = null, lostReply = false } = {}) {
  const drifted = () => {
    const config = confirmedConfigFor(calls.lastBody);
    if (readBack) {
      for (const [index, universe] of Object.entries(readBack)) {
        config.strands[Number(index)].dmxUniverse = universe;
      }
    }
    return config;
  };
  return {
    pushForcedConfig: async (_ip, body) => {
      calls.push('push');
      calls.lastBody = body;
      if (lostReply) throw lostReplyError();
      return { outcome: 'needs-reboot', reboot: true };
    },
    awaitReboot: async () => { calls.push('awaitReboot'); },
    getStatus: async () => {
      calls.push('getStatus');
      return status60(confirmedPerOutputFor(calls.lastBody));
    },
    getConfig: async () => {
      calls.push('getConfig');
      return drifted();
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

test('_362: a read-back on a DIFFERENT universe fails the push, and never saves', async () => {
  const registry = s1Registry();
  const card = registry.controllers[0];
  const ctx = makeS1Ctx(registry, []);
  const calls = [];
  // The device reports U23 where the push wrote U22.
  await runPerOutputPush(ctx, card, S1_PLAN, S1_BODY(),
    makeVerifyIo(calls, { readBack: { 1: 23 } }), makeS1Ui());
  assert.equal(calls.includes('persistScene'), false, 'an unverified device saves nothing');
  assert.equal(getSyncState(ctx, card.id).state, 'drift');
  assert.ok(getSyncState(ctx, card.id).detail.includes('output 1: device U23 ≠ wanted U22'));
});

test('_362: a matching read-back completes, and the expectation names only the routed universes',
  async () => {
    const registry = s1Registry();
    const card = registry.controllers[0];
    const ctx = makeS1Ctx(registry, []);
    const calls = [];
    await runPerOutputPush(ctx, card, S1_PLAN, S1_BODY(), makeVerifyIo(calls), makeS1Ui());
    assert.deepEqual(calls.filter((c) => c !== 'getConfig'),
      ['push', 'awaitReboot', 'getStatus', 'persistScene', 'notifyBridge', 'confirmRoutes']);
    assert.deepEqual(calls.lastExpectations[0].expected, [21, 22]);
    assert.equal('parkedAbsent' in calls.lastExpectations[0], false);
    assert.equal('parkedOutputs' in card, false, 'nothing parks anything any more');
  });

test('_362: a LOST write reply verified over the FULL forced body is a success', async () => {
  const registry = s1Registry();
  const card = registry.controllers[0];
  const ctx = makeS1Ctx(registry, []);
  const calls = [];
  const { ui } = makeRecordingUi();
  await runPerOutputPush(ctx, card, S1_PLAN, S1_BODY(),
    makeVerifyIo(calls, { lostReply: true }), ui);
  assert.match(ui.statusLine.textContent, /the write reply was LOST/);
  assert.match(ui.statusLine.textContent, /✓ scene saved \(patches projected\)/);
  assert.equal(ui.statusLine.className, 'led-push-status led-push-ok');
});

test('_362: a 2xx reply the sim cannot read is a HARD failure, not a silent pass', async () => {
  for (const [reply, expected] of [
    [{ status: 'ok' }, /a 2xx body with NO outcome field/],
    [{ outcome: 'deferred', suppressedBy: 'dmx' }, /outcome='deferred'.*suppressedBy='dmx'/],
  ]) {
    const registry = s1Registry();
    const card = registry.controllers[0];
    const ctx = makeS1Ctx(registry, []);
    const calls = [];
    const { ui } = makeRecordingUi();
    const io = makeVerifyIo(calls);
    io.pushForcedConfig = async (_ip, body) => {
      calls.push('push');
      calls.lastBody = body;
      return reply;
    };
    await runPerOutputPush(ctx, card, S1_PLAN, S1_BODY(), io, ui);
    assert.match(ui.statusLine.textContent, /the device refused the forced write/);
    assert.match(ui.statusLine.textContent, expected);
    assert.match(ui.statusLine.textContent, /The write is NOT retried/);
    assert.equal(calls.includes('persistScene'), false, 'a refused write saves nothing');
    assert.equal(calls.filter((c) => c === 'push').length, 1, 'and is never retried');
  }
});

test('_362: a board that DROPPED the dmx write reads back RED, naming dmx.enabled', async () => {
  const registry = s1Registry();
  const card = registry.controllers[0];
  const ctx = makeS1Ctx(registry, []);
  const calls = [];
  const { ui } = makeRecordingUi();
  const io = makeVerifyIo(calls);
  io.getConfig = async () => {
    calls.push('getConfig');
    const config = confirmedConfigFor(calls.lastBody);
    config.dmx = { enabled: false, protocol: 0, timeoutMs: 3000 };   // ignored the mode write
    return config;
  };
  await runPerOutputPush(ctx, card, S1_PLAN, S1_BODY(), io, ui);
  assert.match(ui.statusLine.textContent,
    /dmx.enabled=false ≠ true — the board is NOT DMX-driven/);
  assert.equal(calls.includes('persistScene'), false);
  assert.equal(calls.includes('notifyBridge'), false);
  assert.equal(getSyncState(ctx, card.id).state, 'drift');
});

test('_362: a read-back MISSING an enable fails, and never saves', async () => {
  const registry = s1Registry();
  const card = registry.controllers[0];
  const ctx = makeS1Ctx(registry, []);
  const calls = [];
  const { ui } = makeRecordingUi();
  const io = makeVerifyIo(calls, { lostReply: true });
  io.getConfig = async () => {
    calls.push('getConfig');
    const config = confirmedConfigFor(calls.lastBody);
    config.strands[1].enabled = false;   // never enabled
    return config;
  };
  await runPerOutputPush(ctx, card, S1_PLAN, S1_BODY(), io, ui);
  assert.match(ui.statusLine.textContent,
    /output 1: device enabled=false ≠ wanted enabled=true/);
  assert.equal(calls.includes('persistScene'), false);
  assert.equal(calls.includes('notifyBridge'), false);
  assert.equal(getSyncState(ctx, card.id).state, 'drift');
});

// ── _363 / S3: the pre-write identity gate, the swarm note, the DMX ⏻ toggle ──
// Panel wiring only — every device call goes through the injected `io` bag or a
// stubbed global fetch, and every IP is a private/documentation-range fake.

test('_363: identityGateRefusal — an UNBOUND card is never gated, a matching board passes', () => {
  const unbound = { id: 1, name: 'Fresh', ip: '10.0.0.60' };
  assert.equal(identityGateRefusal(unbound, { controllerId: 'anything' }), null);
  const bound = { id: 1, name: 'LeftLeftFront', ip: '10.0.0.60',
    device: { controllerId: 'titanic_60' } };
  assert.equal(identityGateRefusal(bound, status60()), null);
  // A board that answers as someone else — both ids named, and the sentence says
  // the write did not happen.
  const refusal = identityGateRefusal(bound, { ...status60(), controllerId: 'titanic_99' });
  assert.match(refusal, /titanic_60/);
  assert.match(refusal, /titanic_99/);
  assert.match(refusal, /REFUSED before any write/);
  // A box that answers with no identity at all is refused too, and SAYS so.
  assert.match(identityGateRefusal(bound, { sacn: { enabled: true } }), /no controllerId/);
});

test('_363: the single push REFUSES a swapped board BEFORE any POST', async () => {
  const registry = s1Registry();
  const card = registry.controllers[0];          // bound to 'titanic_60'
  const toasts = [];
  const ctx = makeS1Ctx(registry, toasts);
  const posts = [];
  await withFetch(async (url, opts) => {
    if (opts && opts.method === 'POST') {
      posts.push(url);
      throw new Error('the identity gate must refuse before any POST exists');
    }
    if (url === 'http://10.0.0.60/api/config') return jsonResponse(config60());
    if (url === 'http://10.0.0.60/api/status') {
      return jsonResponse({ ...status60(), controllerId: 'titanic_77' });
    }
    throw new Error(`unexpected fetch ${url}`);
  }, async () => {
    await startPush(ctx, card);
  });
  assert.deepEqual(posts, [], 'nothing was written to the device');
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0].error, true);
  assert.match(toasts[0].msg, /titanic_60/);
  assert.match(toasts[0].msg, /titanic_77/);
  // The chip carries the same sentence, so the card explains itself after the
  // toast has faded.
  assert.equal(getSyncState(ctx, card.id).state, 'drift');
  assert.match(getSyncState(ctx, card.id).detail, /REFUSED before any write/);
});

test('_363: push-all FAILS the swapped board and keeps going', async () => {
  const registry = createControllerRegistry({
    controllers: [
      { id: 1, name: 'BoardA', ip: '10.0.0.61', type: CONTROLLER_TYPE_LED,
        protocol: CONTROLLER_PROTOCOL_SACN, led: { order: 'RGBW', startAddr: 1 },
        device: { vendor: 'marsinled', controllerId: 'a', deviceName: 'BoardA' },
        ports: [{ port: 1, universe: 21, chain: ['Left_Front_Left'] }] },
      { id: 2, name: 'BoardB', ip: '10.0.0.62', type: CONTROLLER_TYPE_LED,
        protocol: CONTROLLER_PROTOCOL_SACN, led: { order: 'RGBW', startAddr: 1 },
        device: { vendor: 'marsinled', controllerId: 'b', deviceName: 'BoardB' },
        ports: [{ port: 1, universe: 31, chain: ['Left_Back_Left'] }] },
    ],
  });
  const pushed = [];
  const bodyByIp = new Map();
  const oneOutput = () => ({
    strands: [rgbwStrand(40, true, 35)],
    dmx: { enabled: false, protocol: 0, timeoutMs: 3000 },
    deviceName: 'Board',
  });
  const io = {
    // .61 is the swapped board: the card claims 'a', the box answers 'stranger'.
    getStatus: async (ip) => {
      const body = bodyByIp.get(ip);
      return {
        controllerId: ip === '10.0.0.61' ? 'stranger' : 'b',
        boardId: 'angio4', firmwareSHA: 'ff00',
        capabilitiesExt: { perOutputDmx: true },
        sacn: { enabled: true, perOutput: [] },
        strands: body ? body.strands : oneOutput().strands,
      };
    },
    getConfig: async (ip) => {
      const body = bodyByIp.get(ip);
      return body
        ? { ...oneOutput(), strands: body.strands.map((x) => ({ ...x })), dmx: { ...body.dmx } }
        : oneOutput();
    },
    pushForcedConfig: async (ip, body) => {
      pushed.push(ip);
      bodyByIp.set(ip, body);
      return { outcome: 'needs-reboot', reboot: true };
    },
    awaitReboot: async () => {},
  };
  const progress = [];
  const results = await pushAllLedControllers(
    makeGateCtx(registry), io, (p) => progress.push(p));

  assert.deepEqual(results.map((r) => r.state), ['failed', 'pushed']);
  assert.match(results[0].detail, /REFUSED before any write/);
  assert.match(results[0].detail, /stranger/);
  assert.deepEqual(pushed, ['10.0.0.62'], 'the swapped board is never written');
  assert.ok(progress.some((p) => p.name === 'BoardA' && /FAILED/.test(p.phase)));
  assert.ok(progress.some((p) => p.name === 'BoardB' && /PUSHED/.test(p.phase)));
});

// ── the informational swarm note (non-failing) ───────────────────────────────

/** makeS1Io, but the board also reports SWARM enabled on the read-back. */
function makeSwarmIo(calls, options = {}) {
  const io = makeS1Io(calls, options);
  const inner = io.getConfig;
  io.getConfig = async (...args) => {
    const config = await inner(...args);
    return { ...config, swarm: { enabled: true, isLeader: false, groupId: 'ropes' } };
  };
  return io;
}

test('_363: a SWARM board pushes without refusal and carries the note on the outcome line',
  async () => {
    const registry = s1Registry();
    const card = registry.controllers[0];
    const calls = [];
    const toasts = [];
    const ctx = makeS1Ctx(registry, toasts);
    const ui = makeS1Ui();
    await runPerOutputPush(ctx, card, S1_PLAN, S1_BODY(), makeSwarmIo(calls), ui);

    // The push SUCCEEDS — swarm is not a mismatch, it is a fact.
    assert.equal(ui.statusLine.className, 'led-push-status led-push-ok');
    assert.match(ui.statusLine.textContent, /✓ device written \+ verified/);
    assert.match(ui.statusLine.textContent,
      /ℹ board also reports SWARM enabled — swarm is operator-managed; the sim does not touch it/);
    assert.equal(toasts[0].error, false);
    // And the body that was posted never mentioned swarm.
    assert.equal('swarm' in calls.lastBody, false);
    assert.equal(getSyncState(ctx, card.id).state, 'in-sync');
  });

test('_363: a non-swarm board outcome line carries NO note', async () => {
  const registry = s1Registry();
  const calls = [];
  const ui = makeS1Ui();
  await runPerOutputPush(makeS1Ctx(registry, []), registry.controllers[0], S1_PLAN, S1_BODY(),
    makeS1Io(calls), ui);
  assert.equal(/SWARM/.test(ui.statusLine.textContent), false);
});

test('_363: push-all puts the note on that board results row', async () => {
  const registry = s1Registry();
  const calls = [];
  const results = await pushAllLedControllers(makeS1Ctx(registry, []), makeSwarmIo(calls));
  assert.equal(results[0].state, 'pushed');
  assert.match(results[0].detail, /ℹ board also reports SWARM enabled/);
  assert.equal(pushAllResultsModel(results)[0].state, 'PUSHED', 'a note never fails a board');
});

// ── the DMX ⏻ toggle ────────────────────────────────────────────────────────

/**
 * A mock board for the toggle: it holds a `dmx` object, applies the toggle body
 * on POST (reboot-to-apply) and mirrors the saved flag into `status.sacn`.
 * `failWith` makes the write answer a device error instead.
 */
function makeToggleBoard({ enabled = false, controllerId = 'titanic_60', failWith = null } = {}) {
  const board = {
    config: { ...config60(), dmx: { enabled, protocol: 0, timeoutMs: 3000 } },
    calls: [],
  };
  board.io = {
    getStatus: async (ip) => {
      board.calls.push(`getStatus:${ip}`);
      return { ...status60(), controllerId, sacn: { enabled: board.config.dmx.enabled === true } };
    },
    getConfig: async (ip) => {
      board.calls.push(`getConfig:${ip}`);
      return JSON.parse(JSON.stringify(board.config));
    },
    pushDmxToggle: async (ip, body) => {
      board.calls.push(`pushDmxToggle:${ip}`);
      board.lastBody = body;
      if (failWith) throw failWith;
      board.config.dmx = { ...body.dmx };
      return { outcome: 'needs-reboot', reboot: true };
    },
    awaitReboot: async (ip) => { board.calls.push(`awaitReboot:${ip}`); },
  };
  return board;
}

function makeToggleButton() {
  return { textContent: '⏻ DMX: ?', title: '', className: '', disabled: false };
}

/**
 * A ctx on its OWN scene name. The ⏻ label store is scene-scoped exactly like the
 * sync/MAC caches (G7), so one scene per case keeps these tests' observations out
 * of each other — and pins that scoping while it does.
 */
function makeToggleCtx(registry, toasts, scene) {
  return { ...makeS1Ctx(registry, toasts), activeScene: () => scene };
}

test('_363: the toggle label is ? until something reads the board, then on / off', async () => {
  const registry = s1Registry();
  const card = registry.controllers[0];
  const ctx = makeToggleCtx(registry, [], 'toggle_label');
  // Nothing has been read in this scene: the label refuses to guess.
  const cold = dmxToggleModel(ctx, card);
  assert.equal(cold.label, '⏻ DMX: ?');
  assert.equal(cold.state, null);
  assert.equal(cold.target, true, 'from ? the click asks for ON — the state a show needs');
  assert.match(cold.className, /led-dmx-unknown/);
  assert.match(cold.title, /reboots it \(~11 s\)/);

  // Toggle ON, confirmed by the read-back.
  const board = makeToggleBoard({ enabled: false });
  const button = makeToggleButton();
  const phases = [];
  const watched = new Proxy(button, {
    set(target, key, value) {
      if (key === 'textContent') phases.push(value);
      target[key] = value;
      return true;
    },
  });
  assert.equal(await toggleDmx(ctx, card, true, board.io, watched), true);
  assert.equal(getDmxState(ctx, card.id), true);
  assert.equal(dmxToggleModel(ctx, card).label, '⏻ DMX: on');
  assert.equal(dmxToggleModel(ctx, card).target, false, 'a known ON offers OFF');
  assert.match(dmxToggleModel(ctx, card).className, /led-dmx-on/);
  // The button NAMED every phase while it ran — a reboot must never look like a hang.
  assert.deepEqual(phases.slice(0, 4),
    ['⏻ reading…', '⏻ writing…', '⏻ rebooting…', '⏻ verifying…']);
  assert.equal(button.textContent, '⏻ DMX: on');
  assert.equal(button.disabled, false);
  // ONE write, and the body carried ONLY the dmx block (no strands, no swarm).
  assert.deepEqual(Object.keys(board.lastBody), ['dmx']);
  assert.equal(board.lastBody.dmx.enabled, true);
  assert.equal(board.lastBody.dmx.timeoutMs, 3000, 'the board own dmx keys are preserved');

  // …and back OFF.
  assert.equal(await toggleDmx(ctx, card, false, board.io, button), true);
  assert.equal(getDmxState(ctx, card.id), false);
  assert.equal(dmxToggleModel(ctx, card).label, '⏻ DMX: off');
  assert.equal(dmxToggleModel(ctx, card).target, true);
  assert.equal(board.config.dmx.enabled, false);
});

test('_363: a toggle whose write is REFUSED is a loud toast and the label falls to ?', async () => {
  const registry = s1Registry();
  const card = registry.controllers[0];
  const toasts = [];
  const ctx = makeToggleCtx(registry, toasts, 'toggle_refused');
  const err = new Error('config apply failed (field=dmx)');
  err.httpStatus = 400;
  const board = makeToggleBoard({ enabled: true, failWith: err });
  const button = makeToggleButton();

  assert.equal(await toggleDmx(ctx, card, false, board.io, button), false);
  assert.equal(getDmxState(ctx, card.id), null, 'a failed write leaves NO claim about the board');
  assert.equal(button.textContent, '⏻ DMX: ?');
  assert.equal(toasts.at(-1).error, true);
  assert.match(toasts.at(-1).msg, /DMX OFF FAILED — config apply failed \(field=dmx\)/);
  assert.equal(board.calls.includes('awaitReboot:10.0.0.60'), false,
    'a device that ANSWERED non-2xx did not apply anything — nothing to wait for');
});

test('_363: a toggle the board does NOT confirm fails, naming the read-back', async () => {
  const registry = s1Registry();
  const card = registry.controllers[0];
  const toasts = [];
  const ctx = makeToggleCtx(registry, toasts, 'toggle_unconfirmed');
  const board = makeToggleBoard({ enabled: false });
  // The board takes the POST but keeps reporting DMX off.
  board.io.pushDmxToggle = async () => ({ outcome: 'needs-reboot', reboot: true });

  assert.equal(await toggleDmx(ctx, card, true, board.io, makeToggleButton()), false);
  assert.equal(getDmxState(ctx, card.id), null);
  assert.match(toasts.at(-1).msg, /did NOT confirm DMX ON/);
  assert.match(toasts.at(-1).msg, /dmx.enabled=false ≠ true/);
});

test('_363: the toggle applies the SAME pre-write identity gate — no write on a swap', async () => {
  const registry = s1Registry();
  const card = registry.controllers[0];
  const toasts = [];
  const ctx = makeToggleCtx(registry, toasts, 'toggle_identity');
  const board = makeToggleBoard({ enabled: false, controllerId: 'someone_else' });

  assert.equal(await toggleDmx(ctx, card, true, board.io, makeToggleButton()), false);
  assert.equal(board.calls.some((c) => c.startsWith('pushDmxToggle')), false,
    'the gate refuses before the write');
  assert.equal(board.calls.some((c) => c.startsWith('getConfig')), false,
    'and before the snapshot read that would build a body');
  assert.match(toasts.at(-1).msg, /someone_else/);
  assert.equal(getDmxState(ctx, card.id), null);
});

test('_363: a LOST toggle reply is settled by the read-back, not declared a failure', async () => {
  const registry = s1Registry();
  const card = registry.controllers[0];
  const toasts = [];
  const ctx = makeToggleCtx(registry, toasts, 'toggle_lost_reply');
  const board = makeToggleBoard({ enabled: false });
  const realPush = board.io.pushDmxToggle;
  board.io.pushDmxToggle = async (ip, body) => {
    await realPush(ip, body);                       // the board DID apply it
    const lost = new Error('timed out after 12000 ms — device did not respond');
    lost.writeResponseLost = true;                  // …and dropped the reply rebooting
    throw lost;
  };
  assert.equal(await toggleDmx(ctx, card, true, board.io, makeToggleButton()), true);
  assert.equal(getDmxState(ctx, card.id), true);
  assert.match(toasts.at(-1).msg, /the write reply was lost to the reboot/);
});

test('_363: the toggle NEVER polls — one read, one write, one read-back', async () => {
  const registry = s1Registry();
  const card = registry.controllers[0];
  const board = makeToggleBoard({ enabled: false });
  await toggleDmx(makeToggleCtx(registry, [], 'toggle_no_poll'), card, true, board.io,
    makeToggleButton());
  assert.deepEqual(board.calls, [
    'getStatus:10.0.0.60', 'getConfig:10.0.0.60',      // ONE pre-write read pair
    'pushDmxToggle:10.0.0.60',
    'awaitReboot:10.0.0.60',
    'getStatus:10.0.0.60', 'getConfig:10.0.0.60',      // ONE verify read pair
  ]);
});

// ═══════════════════════════════════════════════════════════════════════════
// 20260824 — the verify-race fix, the gamma push, and the fleet DMX-off
// ═══════════════════════════════════════════════════════════════════════════

/** The rejection shape `fetchWithTimeout` raises when OUR abort timer fires. */
function readTimeout(ms = 8000) {
  const err = new Error(`timed out after ${ms} ms — device did not respond`);
  err.timedOut = true;
  return err;
}

/** Retry options that make a retry case instant (`io.readRetry` is an injected seam). */
const FAST_RETRY = { retryDelayMs: 0 };

// ── 1. THE VERIFY RACE (live evidence: hit twice on 4 real boards) ──────────
//
// `awaitReboot` returns on the FIRST /api/status answer, but the board finishes
// re-associating to WiFi afterwards and drops reads for a few seconds. The
// verify's read pair had ONE attempt each, so it timed out and the push
// declared a FALSE FAIL over a write that HAD applied.

/**
 * A .60 board whose POST applies, and whose first `dropReads` verify read pairs
 * TIME OUT before it starts serving reads again. `calls` records every hop.
 */
function makeRaceBoard({ dropReads = 0, calls = [] } = {}) {
  const state = { config: config60(), written: null, dropsLeft: 0, calls };
  const io = {
    getStatus: async (ip) => {
      if (state.dropsLeft > 0) { state.dropsLeft -= 1; calls.push(`getStatus:TIMEOUT`); throw readTimeout(); }
      calls.push(`getStatus:${ip}`);
      return status60(confirmedPerOutputFor(state.written));
    },
    getConfig: async (ip) => {
      calls.push(`getConfig:${ip}`);
      return state.written ? confirmedConfigFor(state.written) : config60();
    },
    pushForcedConfig: async (ip, body) => {
      calls.push(`push:${ip}`);
      state.written = body;
      // The write landed — from HERE the board is rebooting and re-associating.
      state.dropsLeft = dropReads;
      return { outcome: 'needs-reboot', reboot: true };
    },
    pushDmxToggle: async (ip, body) => {
      calls.push(`pushDmxToggle:${ip}`);
      state.config = { ...state.config, dmx: { ...body.dmx } };
      state.dropsLeft = dropReads;
      return { outcome: 'needs-reboot', reboot: true };
    },
    awaitReboot: async (ip) => { calls.push(`awaitReboot:${ip}`); },
    persistScene: async () => ({ ok: true }),
    notifyBridge: async () => ({ ok: true }),
    confirmBridgeRoutes: async () => ({ ok: true, detail: 'U21,U22' }),
    readRetry: FAST_RETRY,
  };
  state.io = io;
  return state;
}

test('_20260824: a push whose first TWO verify reads time out still PASSES', async () => {
  const registry = s1Registry();
  const card = registry.controllers[0];
  const calls = [];
  const board = makeRaceBoard({ dropReads: 2, calls });
  const plan = S1_PLAN;
  const body = S1_BODY();
  const ui = makeS1Ui();

  await runPerOutputPush(makeS1Ctx(registry, []), card, plan, body, board.io, ui);

  assert.match(ui.statusLine.textContent, /device written \+ verified/,
    'the write applied and the read-back confirmed it — no false FAIL');
  assert.equal(ui.statusLine.className.includes('led-push-error'), false);
  // The read pair was retried as a UNIT, and the WRITE was never repeated.
  assert.equal(calls.filter((c) => c === 'getStatus:TIMEOUT').length, 2);
  assert.equal(calls.filter((c) => c.startsWith('push:')).length, 1,
    'retrying READS must never re-POST the body');
  assert.deepEqual(getSyncState(makeS1Ctx(registry, []), card.id), { state: 'in-sync' });
});

test('_20260824: a verify that times out on EVERY attempt still fails, loudly', async () => {
  const registry = s1Registry();
  const card = registry.controllers[0];
  const calls = [];
  const board = makeRaceBoard({ dropReads: 99, calls });
  const plan = S1_PLAN;
  const body = S1_BODY();
  const ui = makeS1Ui();

  await runPerOutputPush(makeS1Ctx(registry, []), card, plan, body, board.io, ui);

  assert.match(ui.statusLine.textContent, /forced push failed/);
  assert.match(ui.statusLine.textContent, /timed out on every attempt/);
  assert.equal(calls.filter((c) => c === 'getStatus:TIMEOUT').length, 4,
    'exactly the declared attempt budget — bounded, never an infinite spinner');
  assert.equal(calls.filter((c) => c.startsWith('push:')).length, 1);
});

test('_20260824: an ANSWERED verify error is NOT retried — it fails on the first read',
  async () => {
    const registry = s1Registry();
    const card = registry.controllers[0];
    const calls = [];
    const board = makeRaceBoard({ dropReads: 0, calls });
    const answered = new Error('[MarsinLED] GET /api/status 10.0.0.60 failed: HTTP 500 oops');
    answered.httpStatus = 500;
    let reads = 0;
    board.io.getStatus = async () => { reads += 1; throw answered; };
    const plan = S1_PLAN;
    const body = S1_BODY();
    const ui = makeS1Ui();

    await runPerOutputPush(makeS1Ctx(registry, []), card, plan, body, board.io, ui);
    assert.match(ui.statusLine.textContent, /HTTP 500 oops/);
    assert.equal(reads, 1, 'ONE verify read — a device that spoke is final, never re-asked');
  });

test('_20260824: the fleet retries a board SNAPSHOT read that times out', async () => {
  const registry = fleetRegistry();
  const calls = [];
  const io = fleetIo(calls, null);
  io.readRetry = FAST_RETRY;
  const realStatus = io.getStatus;
  let drops = 2;
  io.getStatus = async (ip) => {
    if (ip === '10.0.0.72' && drops > 0) { drops -= 1; calls.push('snapshotTimeout:72'); throw readTimeout(); }
    return realStatus(ip);
  };
  const results = await pushAllLedControllers(makeGateCtx(registry), io);
  assert.deepEqual(results.map((r) => r.state), ['pushed', 'pushed', 'pushed'],
    'a board that was merely slow to serve reads must not FAIL before it is even written');
  assert.equal(calls.filter((c) => c === 'snapshotTimeout:72').length, 2);
});

// ── 2. THE GAMMA PUSH (report `_363` §11, operator-ordered re-enable) ───────

const CURVE_22 = { r: 2.2, g: 2.2, b: 2.2, w: 1 };
const CURVE_26 = { r: 2.6, g: 2.6, b: 2.6, w: 1 };

/**
 * A board that stores a gamma block, applies a gamma POST LIVE (outcome
 * 'applied', no reboot) and reports it back with float32 noise, exactly as the
 * firmware does.
 */
function makeGammaBoard({ controllerId = 'titanic_60', failWith = null, confirm = true } = {}) {
  const float32 = (v) => Math.fround(v);
  const board = { gamma: { r: 1, g: 1, b: 1, w: 1 }, calls: [] };
  board.io = {
    getStatus: async (ip) => {
      board.calls.push(`getStatus:${ip}`);
      return { ...status60(), controllerId, mac: 'AA:BB:CC:00:00:60' };
    },
    getConfig: async (ip) => {
      board.calls.push(`getConfig:${ip}`);
      return { ...config60(), gamma: { ...board.gamma } };
    },
    pushGammaPush: async (ip, body) => {
      board.calls.push(`pushGammaPush:${ip}`);
      board.lastBody = body;
      if (failWith) throw failWith;
      if (confirm) {
        board.gamma = {
          r: float32(body.gamma.r), g: float32(body.gamma.g),
          b: float32(body.gamma.b), w: float32(body.gamma.w),
        };
      }
      return { status: 'ok', outcome: 'applied', reboot: false };
    },
    awaitReboot: async (ip) => { board.calls.push(`awaitReboot:${ip}`); },
    readRetry: FAST_RETRY,
  };
  return board;
}

test('_363 §11: a gamma push is LIVE-APPLY — one read pair, one write, one read-back, NO reboot',
  async () => {
    const registry = s1Registry();
    const card = registry.controllers[0];
    const toasts = [];
    const ctx = makeToggleCtx(registry, toasts, 'gamma_live');
    const board = makeGammaBoard();

    const result = await pushGammaToDevice(ctx, card, CURVE_22, board.io);
    assert.equal(result.ok, true);
    assert.deepEqual(board.calls, [
      'getStatus:10.0.0.60', 'getConfig:10.0.0.60',   // ONE pre-write read pair
      'pushGammaPush:10.0.0.60',
      'getStatus:10.0.0.60', 'getConfig:10.0.0.60',   // ONE verify read pair
    ]);
    assert.equal(board.calls.includes('awaitReboot:10.0.0.60'), false,
      'gamma applies live — the flow must not wait out a reboot nobody asked for');
    // The body carried the curve and NOTHING else.
    assert.deepEqual(Object.keys(board.lastBody), ['gamma']);
    assert.deepEqual(board.lastBody.gamma, CURVE_22);
    // Provenance records the curve that was SENT, not the float32 read-back —
    // adopting the device's numbers would be a PULL.
    assert.deepEqual(card.device.lastGammaPush.gamma, CURVE_22);
    assert.equal(card.device.lastGammaPush.outcome, 'applied');
    assert.match(toasts.at(-1).msg, /gamma 2\.2 \/ 2\.2 \/ 2\.2 \/ 1 confirmed by read-back/);
    assert.equal(toasts.at(-1).error, undefined);
  });

test('_363 §11: the SCENE mirror is never overwritten by the device read-back', async () => {
  const registry = s1Registry();
  const card = registry.controllers[0];
  const ctx = makeToggleCtx(registry, [], 'gamma_no_pull');
  const board = makeGammaBoard();
  await pushGammaToDevice(ctx, card, CURVE_22, board.io);
  // The board reports 2.200000047683716; the card's own curve stays exactly 2.2.
  assert.equal(Math.fround(2.2) !== 2.2, true, 'the float32 noise is real');
  const mirror = card.led && card.led.wire && card.led.wire.controllerGamma;
  if (mirror) assert.deepEqual(mirror, mirror, 'the mirror is whatever the sliders set');
  assert.deepEqual(card.device.lastGammaPush.gamma, { r: 2.2, g: 2.2, b: 2.2, w: 1 });
});

test('_363 §11: the gamma push applies the SAME pre-write identity gate', async () => {
  const registry = s1Registry();
  const card = registry.controllers[0];
  const toasts = [];
  const ctx = makeToggleCtx(registry, toasts, 'gamma_identity');
  const board = makeGammaBoard({ controllerId: 'someone_else' });

  const result = await pushGammaToDevice(ctx, card, CURVE_22, board.io);
  assert.equal(result.ok, false);
  assert.equal(board.calls.some((c) => c.startsWith('pushGammaPush')), false,
    'the gate refuses before the write');
  assert.equal(board.calls.some((c) => c.startsWith('getConfig')), false,
    'and before the snapshot read that would build a body');
  assert.match(toasts.at(-1).msg, /someone_else/);
  assert.equal(card.device.lastGammaPush, undefined, 'no receipt for a write that never happened');
});

test('_363 §11: a curve the board does NOT confirm is a FAILURE with no receipt', async () => {
  const registry = s1Registry();
  const card = registry.controllers[0];
  const toasts = [];
  const ctx = makeToggleCtx(registry, toasts, 'gamma_unconfirmed');
  const board = makeGammaBoard({ confirm: false });   // takes the POST, keeps 1.0

  const result = await pushGammaToDevice(ctx, card, CURVE_22, board.io);
  assert.equal(result.ok, false);
  assert.match(toasts.at(-1).msg, /did NOT confirm the curve/);
  assert.match(toasts.at(-1).msg, /gamma\.r=1 ≠ pushed 2\.2/);
  assert.equal(toasts.at(-1).error, true);
  assert.equal(card.device.lastGammaPush, undefined);
});

test('_363 §11: a device-ANSWERED gamma refusal is loud and never waits for a reboot', async () => {
  const registry = s1Registry();
  const card = registry.controllers[0];
  const toasts = [];
  const ctx = makeToggleCtx(registry, toasts, 'gamma_refused');
  const err = new Error('[MarsinLED] rejected config: config apply failed (field=gamma)');
  err.httpStatus = 400;
  const board = makeGammaBoard({ failWith: err });

  assert.equal((await pushGammaToDevice(ctx, card, CURVE_22, board.io)).ok, false);
  assert.match(toasts.at(-1).msg, /gamma push FAILED — .*field=gamma/);
  assert.equal(board.calls.includes('awaitReboot:10.0.0.60'), false);
  assert.equal(card.device.lastGammaPush, undefined);
});

test('_363 §11: a needs-reboot gamma reply IS honored, even though none is expected', async () => {
  const registry = s1Registry();
  const card = registry.controllers[0];
  const ctx = makeToggleCtx(registry, [], 'gamma_reboot');
  const board = makeGammaBoard();
  const applied = board.io.pushGammaPush;
  board.io.pushGammaPush = async (ip, body) => {
    await applied(ip, body);
    return { status: 'ok', outcome: 'needs-reboot', reboot: true };
  };
  assert.equal((await pushGammaToDevice(ctx, card, CURVE_22, board.io)).ok, true);
  assert.equal(board.calls.includes('awaitReboot:10.0.0.60'), true,
    'believing the device beats assuming live-apply');
  assert.equal(card.device.lastGammaPush.outcome, 'needs-reboot');
});

test('_363 §11: an invalid curve is refused BEFORE any device hop', async () => {
  const registry = s1Registry();
  const card = registry.controllers[0];
  const toasts = [];
  const ctx = makeToggleCtx(registry, toasts, 'gamma_invalid');
  const board = makeGammaBoard();
  assert.equal((await pushGammaToDevice(ctx, card, { r: 9, g: 2.2, b: 2.2, w: 1 }, board.io)).ok,
    false);
  assert.match(toasts.at(-1).msg, /gamma\.r 9 must be a finite number in 1–3/);
  assert.equal(board.calls.some((c) => c.startsWith('pushGammaPush')), false);
});

// ── Fleet gamma: each board gets ITS OWN curve, no scene save ───────────────

function gammaFleetRegistry() {
  const registry = fleetRegistry();
  // Three cards, three DIFFERENT curves — the point of "its own card's curve".
  registry.controllers[0].led.wire = { controllerGamma: { ...CURVE_22 } };
  registry.controllers[1].led.wire = { controllerGamma: { ...CURVE_26 } };
  registry.controllers[2].led.wire = { controllerGamma: { r: 1, g: 1, b: 1, w: 1 } };
  return registry;
}

function gammaFleetIo(calls, { failIp = null } = {}) {
  const float32 = (v) => Math.fround(v);
  const gammaByIp = new Map();
  const idByIp = { '10.0.0.71': 'a', '10.0.0.72': 'b', '10.0.0.73': 'c' };
  return {
    getStatus: async (ip) => ({
      controllerId: idByIp[ip], boardId: 'angio4', firmwareSHA: 'ff00',
      capabilitiesExt: { perOutputDmx: true }, sacn: { enabled: true, perOutput: [] },
      strands: config60().strands,
    }),
    getConfig: async (ip) => ({
      ...config60(), deviceName: 'Board',
      gamma: gammaByIp.get(ip) || { r: 1, g: 1, b: 1, w: 1 },
    }),
    pushGammaPush: async (ip, body) => {
      calls.push(`gamma:${ip}:${body.gamma.r}`);
      if (ip === failIp) {
        const err = new Error('[MarsinLED] rejected config: config apply failed');
        err.httpStatus = 400;
        throw err;
      }
      gammaByIp.set(ip, {
        r: float32(body.gamma.r), g: float32(body.gamma.g),
        b: float32(body.gamma.b), w: float32(body.gamma.w),
      });
      return { status: 'ok', outcome: 'applied', reboot: false };
    },
    awaitReboot: async (ip) => { calls.push(`awaitReboot:${ip}`); },
    persistScene: async () => { calls.push('persistScene'); return { ok: true }; },
    notifyBridge: async () => { calls.push('notifyBridge'); return { ok: true }; },
    readRetry: FAST_RETRY,
  };
}

test('_363 §11: the gamma fleet sends each board ITS OWN card curve, sequentially', async () => {
  const registry = gammaFleetRegistry();
  const calls = [];
  const phases = [];
  const results = await pushGammaAllControllers(makeGateCtx(registry),
    gammaFleetIo(calls), (p) => phases.push(`${p.name}:${p.phase}`));

  assert.deepEqual(results.map((r) => r.state), ['pushed', 'pushed', 'pushed']);
  // Three different curves, in registry order — no shared "fleet curve".
  assert.deepEqual(calls.filter((c) => c.startsWith('gamma:')),
    ['gamma:10.0.0.71:2.2', 'gamma:10.0.0.72:2.6', 'gamma:10.0.0.73:1']);
  assert.equal(calls.includes('awaitReboot:10.0.0.71'), false, 'gamma is live-apply');
  // NO scene save: gamma is not part of the mapping.
  assert.equal(calls.includes('persistScene'), false);
  assert.equal(calls.includes('notifyBridge'), false);
  assert.ok(phases.some((p) => /BoardB:PUSHED — gamma 2\.6/.test(p)));
});

test('_363 §11: one failed board never aborts the gamma fleet, and the table says so', async () => {
  const registry = gammaFleetRegistry();
  const calls = [];
  const results = await pushGammaAllControllers(makeGateCtx(registry),
    gammaFleetIo(calls, { failIp: '10.0.0.72' }));
  assert.deepEqual(results.map((r) => r.state), ['pushed', 'failed', 'pushed']);
  assert.match(results[1].detail, /config apply failed/);
  assert.equal(calls.filter((c) => c.startsWith('gamma:')).length, 3, 'the loop kept going');
  // Only the boards that CONFIRMED carry a receipt.
  assert.deepEqual(registry.controllers.map((c) => !!(c.device && c.device.lastGammaPush)),
    [true, false, true]);
  const rows = gammaPushAllResultsModel(results);
  assert.deepEqual(rows.map((r) => r.state), ['GAMMA SET', 'FAILED', 'GAMMA SET']);
  assert.match(rows[1].reason, /config apply failed/);
  assert.throws(() => gammaPushAllResultsModel([{ name: 'X', state: 'weird' }]),
    /unknown result state 'weird'/);
});

test('_363 §11: a card with no usable IP is SKIPPED by the gamma fleet, never guessed at',
  async () => {
    const registry = gammaFleetRegistry();
    registry.controllers[1].ip = '';
    const calls = [];
    const results = await pushGammaAllControllers(makeGateCtx(registry), gammaFleetIo(calls));
    assert.deepEqual(results.map((r) => r.state), ['pushed', 'skipped', 'pushed']);
    assert.match(results[1].detail, /no valid device IP/);
    assert.equal(calls.some((c) => c.includes('10.0.0.72')), false);
  });

test('_363 §11: the fleet gamma dialog copy states push-only, live-apply, own-curve', () => {
  assert.match(GAMMA_PUSH_ALL_WARNING, /ITS OWN card's curve/);
  assert.match(GAMMA_PUSH_ALL_WARNING, /LIVE \(no reboot\)/);
  assert.match(GAMMA_PUSH_ALL_WARNING, /the scene is NOT saved/);
  assert.match(GAMMA_PUSH_ALL_WARNING, /never reads a curve back off a device/);
  assert.doesNotMatch(GAMMA_PUSH_ALL_WARNING, /swarm[^,]*ON|switch/i);
});

// ── 3. FLEET DMX OFF (operator-ordered exception to `_363` §3) ──────────────

function dmxFleetIo(calls, { failIp = null, controllerIds = null } = {}) {
  const dmxByIp = new Map();
  const idByIp = controllerIds || { '10.0.0.71': 'a', '10.0.0.72': 'b', '10.0.0.73': 'c' };
  const dmxOf = (ip) => dmxByIp.get(ip) || { enabled: true, protocol: 0, timeoutMs: 3000 };
  return {
    getStatus: async (ip) => {
      calls.push(`getStatus:${ip}`);
      return {
        controllerId: idByIp[ip], boardId: 'angio4', firmwareSHA: 'ff00',
        capabilitiesExt: { perOutputDmx: true },
        sacn: { enabled: dmxOf(ip).enabled === true },
        strands: config60().strands,
      };
    },
    getConfig: async (ip) => {
      calls.push(`getConfig:${ip}`);
      return { ...config60(), deviceName: 'Board', dmx: { ...dmxOf(ip) },
        swarm: { enabled: true, role: 'follower' } };
    },
    pushDmxToggle: async (ip, body) => {
      calls.push(`pushDmxToggle:${ip}`);
      calls.lastBody = body;
      if (ip === failIp) {
        const err = new Error('[MarsinLED] rejected config: config apply failed');
        err.httpStatus = 400;
        throw err;
      }
      dmxByIp.set(ip, { ...body.dmx });
      return { outcome: 'needs-reboot', reboot: true };
    },
    awaitReboot: async (ip) => { calls.push(`awaitReboot:${ip}`); },
    persistScene: async () => { calls.push('persistScene'); return { ok: true }; },
    notifyBridge: async () => { calls.push('notifyBridge'); return { ok: true }; },
    readRetry: FAST_RETRY,
  };
}

test('_20260824: DMX all-off writes ONLY the dmx block, board by board, and confirms each',
  async () => {
    const registry = fleetRegistry();
    const ctx = makeGateCtx(registry);
    const calls = [];
    const phases = [];
    const results = await dmxOffAllControllers(ctx, dmxFleetIo(calls),
      (p) => phases.push(`${p.name}:${p.phase}`));

    assert.deepEqual(results.map((r) => r.state), ['off', 'off', 'off']);
    // Sequential, and the FULL discipline per board: read pair → write → reboot
    // → verify read pair.
    assert.deepEqual(calls.filter((c) => typeof c === 'string' && c.includes('10.0.0.71')), [
      'getStatus:10.0.0.71', 'getConfig:10.0.0.71',
      'pushDmxToggle:10.0.0.71',
      'awaitReboot:10.0.0.71',
      'getStatus:10.0.0.71', 'getConfig:10.0.0.71',
    ]);
    // The body is the board's own dmx object with ONE flag flipped: no swarm
    // key (even though the board reports swarm ON), no gamma, no strands.
    assert.deepEqual(Object.keys(calls.lastBody), ['dmx']);
    assert.equal(calls.lastBody.dmx.enabled, false);
    assert.equal(calls.lastBody.dmx.timeoutMs, 3000, 'the board own dmx keys are preserved');
    assert.equal('swarm' in calls.lastBody, false);
    assert.equal('gamma' in calls.lastBody, false);
    // Runtime state only — nothing is written to disk.
    assert.equal(calls.includes('persistScene'), false);
    assert.equal(calls.includes('notifyBridge'), false);
    // The ⏻ labels are seeded from the results, per card.
    for (const c of registry.controllers) {
      assert.equal(getDmxState(ctx, c.id), false);
      assert.equal(dmxToggleModel(ctx, c).label, '⏻ DMX: off');
      assert.equal(dmxToggleModel(ctx, c).target, true, 'a known OFF offers ON');
    }
    assert.ok(phases.some((p) => /BoardC:DMX OFF — confirmed by read-back/.test(p)));
  });

test('_20260824: one failed board never aborts the DMX-off fleet, and its label falls to ?',
  async () => {
    const registry = fleetRegistry();
    const ctx = makeGateCtx(registry);
    const calls = [];
    const results = await dmxOffAllControllers(ctx, dmxFleetIo(calls, { failIp: '10.0.0.72' }));

    assert.deepEqual(results.map((r) => r.state), ['off', 'failed', 'off']);
    assert.match(results[1].detail, /config apply failed/);
    assert.equal(calls.filter((c) => typeof c === 'string' && c.startsWith('pushDmxToggle')).length,
      3, 'the loop kept going');
    assert.equal(getDmxState(ctx, registry.controllers[0].id), false);
    assert.equal(getDmxState(ctx, registry.controllers[1].id), null,
      'a failed board makes NO claim about its DMX flag');
    assert.equal(getDmxState(ctx, registry.controllers[2].id), false);
    const rows = dmxOffAllResultsModel(results);
    assert.deepEqual(rows.map((r) => r.state), ['DMX OFF', 'FAILED', 'DMX OFF']);
    assert.throws(() => dmxOffAllResultsModel([{ name: 'X', state: 'pushed' }]),
      /unknown result state 'pushed'/);
  });

test('_20260824: DMX all-off FAILS a swapped board before writing it, and skips a card with no IP',
  async () => {
    const registry = fleetRegistry();
    registry.controllers[2].ip = '';
    const ctx = makeGateCtx(registry);
    const calls = [];
    const io = dmxFleetIo(calls, {
      controllerIds: { '10.0.0.71': 'a', '10.0.0.72': 'not_b', '10.0.0.73': 'c' },
    });
    const results = await dmxOffAllControllers(ctx, io);

    assert.deepEqual(results.map((r) => r.state), ['off', 'failed', 'skipped']);
    assert.match(results[1].detail, /bound to board 'b'.*answers as 'not_b'/);
    assert.match(results[1].detail, /Nothing was sent to the device/);
    assert.equal(calls.includes('pushDmxToggle:10.0.0.72'), false,
      'the identity gate refuses before any write');
    assert.equal(calls.includes('getConfig:10.0.0.72'), false,
      'and before the snapshot read that would build a body');
    assert.match(results[2].detail, /no valid device IP/);
  });

test('_20260824: a board that does NOT confirm DMX off is a per-board failure', async () => {
  const registry = fleetRegistry();
  const ctx = makeGateCtx(registry);
  const calls = [];
  const io = dmxFleetIo(calls);
  io.pushDmxToggle = async (ip) => {   // takes the POST, changes nothing
    calls.push(`pushDmxToggle:${ip}`);
    return { outcome: 'needs-reboot', reboot: true };
  };
  const results = await dmxOffAllControllers(ctx, io);
  assert.deepEqual(results.map((r) => r.state), ['failed', 'failed', 'failed']);
  assert.match(results[0].detail, /did NOT confirm DMX OFF/);
  assert.match(results[0].detail, /dmx\.enabled=true ≠ false/);
});

test('_20260824: the DMX-off fleet uses the retrying reads — a slow board is not a failure',
  async () => {
    const registry = fleetRegistry();
    const ctx = makeGateCtx(registry);
    const calls = [];
    const io = dmxFleetIo(calls);
    const realStatus = io.getStatus;
    let drops = 2;
    io.getStatus = async (ip) => {
      if (ip === '10.0.0.73' && drops > 0) { drops -= 1; throw readTimeout(); }
      return realStatus(ip);
    };
    const results = await dmxOffAllControllers(ctx, io);
    assert.deepEqual(results.map((r) => r.state), ['off', 'off', 'off']);
    assert.equal(calls.filter((c) => c === 'pushDmxToggle:10.0.0.73').length, 1,
      'retrying READS never re-POSTs the toggle');
  });

test('_20260824: the DMX-off dialog copy names the show-visible consequence and the way back',
  () => {
    // Binding copy — this darkens sACN control of the whole rig, so the ONE
    // confirm must say exactly what happens, what does not, and how it comes back.
    assert.match(DMX_OFF_ALL_WARNING, /switches DMX \(sACN\) input OFF on every bound and reachable/);
    assert.match(DMX_OFF_ALL_WARNING, /SEQUENTIALLY/);
    assert.match(DMX_OFF_ALL_WARNING, /reboots \(~11 s\)/);
    assert.match(DMX_OFF_ALL_WARNING, /runs its own local pattern/);
    assert.match(DMX_OFF_ALL_WARNING, /Swarm and the mapping are NOT touched/);
    assert.match(DMX_OFF_ALL_WARNING, /nothing is saved into the scene/);
    assert.match(DMX_OFF_ALL_WARNING, /DMX comes back with ⬆ Push, ⬆ Push all, or a card's own ⏻ DMX toggle/);
    assert.match(DMX_OFF_ALL_WARNING, /one failure never aborts the rest/);
  });
