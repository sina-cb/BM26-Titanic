/**
 * hil_push_check.test.js — MOCK-ONLY tests of the HIL runner's PURE exports
 * (report `_363` §5's `hil_push_check` block, gating slice S5).
 *
 * NOTHING here touches hardware, a network, a serial port or a child process:
 * every test calls a pure function with synthetic fixtures. The suite passes
 * with networking absent, never spawns `tools/hil_push_check.cjs` and never
 * spawns `tools/hil_serial_tail.py`. Merely importing the runner must run
 * nothing — that is asserted below.
 *
 * The serial fixture lines are SYNTHETIC and generic (public ESP32 boot-ROM /
 * ESP-IDF wording only) — no private-firmware content, per the plan's
 * confidentiality boundary.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import hil from '../tools/hil_push_check.cjs';
import { buildForcedConfigBody } from '../src/dmx/led/marsinled_client.js';

const {
  HIL_ALLOWED,
  OPERATOR_RESERVED_OCTETS,
  UsageError,
  usageText,
  parseArgs,
  lastOctet,
  assertTargetAllowed,
  assertTargetsAllowed,
  buildPlanFromSnapshot,
  assertExpectedUniverses,
  buildRestoreBody,
  classifySerialWindow,
  renderTable,
  mainWasInvoked,
  main,
} = hil;

// ── Fixtures ────────────────────────────────────────────────────────────────

/** A .65-shaped GET /api/config: outputs 1+2 enabled at 40 px, U36/U37. */
function snapshotFixture() {
  return {
    deviceName: 'ss_right_right',
    strands: [
      {
        enabled: true, count: 40, dmxUniverse: 36, dmxStartAddress: 1,
        type: 'WS2812', colorOrder: 'GRB', pinData: 1, rgbwMode: false,
      },
      {
        enabled: true, count: 40, dmxUniverse: 37, dmxStartAddress: 1,
        type: 'WS2812', colorOrder: 'GRB', pinData: 2, rgbwMode: false,
      },
      { enabled: false, count: 0, type: 'WS2812', colorOrder: 'GRB', pinData: 3 },
      { enabled: false, count: 0, type: 'WS2812', colorOrder: 'GRB', pinData: 4 },
    ],
    dmx: { enabled: true, protocol: 0, timeoutMs: 3000, universe: 1, startAddress: 1 },
    swarm: { enabled: true, role: 'follower' },
    gamma: { r: 2.2, g: 2.2, b: 2.2, w: 1.0 },
  };
}

const BASE_MS = Date.parse('2026-08-23T20:00:00.000Z');

/** Build one capture line exactly as `hil_serial_tail.py` writes it. */
function capture(offsetMs, text) {
  return `${new Date(BASE_MS + offsetMs).toISOString()} ${text}`;
}

/** The three public ESP32 boot-ROM banner lines of ONE boot. */
function bootBanner(offsetMs, resetReason = 'POWERON') {
  return [
    capture(offsetMs, 'ESP-ROM:esp32s3-20210327'),
    capture(offsetMs + 4, 'Build:Mar 27 2021'),
    capture(offsetMs + 9, `rst:0x1 (${resetReason}),boot:0x8 (SPI_FAST_FLASH_BOOT)`),
  ];
}

// ── The frozen allowlist + the flag gate (§6.2-1, §6.2-2) ───────────────────

test('the allowlist is FROZEN and holds exactly the two authorized boards', () => {
  assert.equal(Object.isFrozen(HIL_ALLOWED), true);
  assert.deepEqual({ ...HIL_ALLOWED }, { ss_right_right: 65, ss_right_left: 66 });
  assert.throws(() => { 'use strict'; HIL_ALLOWED.bench = 60; }, TypeError);
  assert.equal(HIL_ALLOWED.bench, undefined);
  assert.deepEqual([...OPERATOR_RESERVED_OCTETS], [61, 62]);
});

test('the authorized pairs pass the gate', () => {
  assert.doesNotThrow(() => assertTargetAllowed({ id: 'ss_right_right', ip: '192.0.2.65' }));
  assert.doesNotThrow(() => assertTargetAllowed({ id: 'ss_right_left', ip: '192.0.2.66' }));
  assert.doesNotThrow(() => assertTargetsAllowed([
    { id: 'ss_right_right', ip: '192.0.2.65' },
    { id: 'ss_right_left', ip: '192.0.2.66' },
  ]));
});

test('every octet outside the allowlist is REFUSED — .60–.64 and .67+', () => {
  for (const octet of [60, 61, 62, 63, 64, 67, 68, 99, 201]) {
    assert.throws(
      () => assertTargetAllowed({ id: 'ss_right_right', ip: `192.0.2.${octet}` }),
      (err) => err instanceof UsageError && /REFUSED/.test(err.message),
      `octet .${octet} must be refused`,
    );
  }
});

test('the refusal names .61/.62 as operator-reserved', () => {
  assert.throws(
    () => assertTargetAllowed({ id: 'ss_right_right', ip: '192.0.2.61' }),
    /\.61\/\.62 are operator-reserved/,
  );
  assert.throws(
    () => assertTargetAllowed({ id: 'bench', ip: '192.0.2.60' }),
    /\.61\/\.62 are operator-reserved/,
  );
});

test('an id that is not a key of the allowlist is REFUSED', () => {
  for (const id of ['bench', 'ss_left_left', 'titanic_201', '', 'SS_RIGHT_RIGHT']) {
    assert.throws(
      () => assertTargetAllowed({ id, ip: '192.0.2.65' }),
      (err) => err instanceof UsageError && /not an authorized HIL target/.test(err.message),
      `id '${id}' must be refused`,
    );
  }
});

test('a WRONG id/octet pairing is REFUSED even though both halves are allowed', () => {
  assert.throws(() => assertTargetAllowed({ id: 'ss_right_right', ip: '192.0.2.66' }),
    /authorized at \.65 only, but --board names \.66/);
  assert.throws(() => assertTargetAllowed({ id: 'ss_right_left', ip: '192.0.2.65' }),
    /authorized at \.66 only, but --board names \.65/);
});

test('a non-IPv4 --board (hostname, ip:port) is refused before any lookup', () => {
  for (const ip of ['ss-right-right.local', '192.0.2.65:6969', '192.0.2', '192.0.2.999', '']) {
    assert.throws(() => lastOctet(ip), UsageError, `'${ip}' must be refused`);
  }
  assert.equal(lastOctet('192.0.2.65'), 65);
});

test('a FLAGLESS invocation is a usage refusal — there is NO default target', () => {
  assert.throws(() => parseArgs([]),
    (err) => err instanceof UsageError && /NO default target/.test(err.message));
  assert.match(usageText(), /NO default target/);
  assert.match(usageText(), /ss_right_right → \.65/);
});

test('--board and --expect-id are ORDERED PAIRS', () => {
  assert.throws(() => parseArgs(['--board', '192.0.2.65']), /ORDERED PAIRS/);
  assert.throws(() => parseArgs(['--expect-id', 'ss_right_right']), /ORDERED PAIRS/);
  assert.throws(
    () => parseArgs(['--board', '192.0.2.65', '--board', '192.0.2.66',
      '--expect-id', 'ss_right_right', '--serial', 'ss_right_right=COM7']),
    /ORDERED PAIRS/,
  );
  const parsed = parseArgs([
    '--board', '192.0.2.65', '--expect-id', 'ss_right_right', '--serial', 'ss_right_right=COM7',
    '--board', '192.0.2.66', '--expect-id', 'ss_right_left', '--serial', 'ss_right_left=COM8',
  ]);
  assert.deepEqual(parsed.targets, [
    { id: 'ss_right_right', ip: '192.0.2.65', serialPort: 'COM7' },
    { id: 'ss_right_left', ip: '192.0.2.66', serialPort: 'COM8' },
  ]);
  assert.equal(parsed.noSerial, false);
  assert.equal(parsed.skipConfig, false);
  assert.equal(parsed.skipToggle, false);
  assert.equal(parsed.expectUniverses, null);
});

test('a target with NO --serial mapping is a usage refusal (unless --no-serial)', () => {
  assert.throws(
    () => parseArgs(['--board', '192.0.2.65', '--expect-id', 'ss_right_right']),
    /no --serial mapping for 'ss_right_right'/,
  );
  assert.throws(
    () => parseArgs(['--board', '192.0.2.65', '--expect-id', 'ss_right_right',
      '--board', '192.0.2.66', '--expect-id', 'ss_right_left',
      '--serial', 'ss_right_right=COM7']),
    /no --serial mapping for 'ss_right_left'/,
  );
  const parsed = parseArgs(['--board', '192.0.2.65', '--expect-id', 'ss_right_right',
    '--no-serial']);
  assert.equal(parsed.noSerial, true);
  assert.equal(parsed.targets[0].serialPort, null);
});

test('--serial for a board that is not a target, or a malformed mapping, is refused', () => {
  assert.throws(
    () => parseArgs(['--board', '192.0.2.65', '--expect-id', 'ss_right_right',
      '--serial', 'ss_right_right=COM7', '--serial', 'ss_left_left=COM9']),
    /not one of this run's targets/,
  );
  assert.throws(
    () => parseArgs(['--board', '192.0.2.65', '--expect-id', 'ss_right_right',
      '--serial', 'COM7']),
    /--serial must be <controllerId>=<COMx>/,
  );
  assert.throws(
    () => parseArgs(['--board', '192.0.2.65', '--expect-id', 'ss_right_right',
      '--serial', 'ss_right_right=COM7', '--serial', 'ss_right_right=COM8']),
    /names 'ss_right_right' twice/,
  );
  assert.throws(
    () => parseArgs(['--board', '192.0.2.65', '--expect-id', 'ss_right_right',
      '--no-serial', '--serial', 'ss_right_right=COM7']),
    /--no-serial and --serial contradict/,
  );
});

test('the optional flags parse, and no flag ever widens targeting', () => {
  const parsed = parseArgs(['--board', '192.0.2.65', '--expect-id', 'ss_right_right',
    '--no-serial', '--skip-toggle', '--expect-universes', '36,37']);
  assert.equal(parsed.skipToggle, true);
  assert.deepEqual(parsed.expectUniverses, [36, 37]);
  assert.equal(parsed.targets.length, 1);
  // Skipping BOTH mutating legs would prove nothing.
  assert.throws(() => parseArgs(['--board', '192.0.2.65', '--expect-id', 'ss_right_right',
    '--no-serial', '--skip-config', '--skip-toggle']), /nothing to prove/);
  // --expect-universes states ONE board's universes.
  assert.throws(() => parseArgs(['--board', '192.0.2.65', '--expect-id', 'ss_right_right',
    '--board', '192.0.2.66', '--expect-id', 'ss_right_left', '--no-serial',
    '--expect-universes', '36,37']), /cannot be applied to several targets/);
  assert.throws(() => parseArgs(['--board', '192.0.2.65', '--expect-id', 'ss_right_right',
    '--no-serial', '--expect-universes', 'U36']), /is not a universe number/);
  assert.throws(() => parseArgs(['--board', '192.0.2.65', '--expect-id', 'ss_right_right',
    '--wipe-everything']), /unknown argument '--wipe-everything'/);
  assert.throws(() => parseArgs(['--board', '--expect-id']), /--board needs a value/);
});

// ── The snapshot-derived plan (§6.4-2) ──────────────────────────────────────

test('the plan is derived from the board OWN pre-snapshot', () => {
  const plan = buildPlanFromSnapshot(snapshotFixture(), 'ss_right_right');
  assert.equal(plan.controllerName, 'ss_right_right');
  assert.deepEqual(plan.universeByOutputIndex, { 0: 36, 1: 37 });
  assert.deepEqual(plan.assignments, [
    { outputIndex: 0, universe: 36, pixelCount: 40 },
    { outputIndex: 1, universe: 37, pixelCount: 40 },
  ]);
  assert.deepEqual(plan.disables, []);
  assert.deepEqual(plan.countChanges, []);
  assert.deepEqual(plan.warnings, []);
  assert.deepEqual(plan.collisions, []);
});

test('a board with nothing enabled is refused — "push it from the sim once first"', () => {
  const snapshot = snapshotFixture();
  snapshot.strands = snapshot.strands.map((s) => ({ ...s, enabled: false }));
  assert.throws(() => buildPlanFromSnapshot(snapshot, 'ss_right_right'),
    /no enabled per-output strand.*push it from the sim once first/s);
});

test('an enabled output with no universe / no count is refused, never darkened', () => {
  const noUniverse = snapshotFixture();
  delete noUniverse.strands[1].dmxUniverse;
  assert.throws(() => buildPlanFromSnapshot(noUniverse, 'ss_right_right'),
    /output 1 is enabled but carries no integer dmxUniverse/);
  const noCount = snapshotFixture();
  noCount.strands[0].count = 0;
  assert.throws(() => buildPlanFromSnapshot(noCount, 'ss_right_right'),
    /output 0 is enabled but its count is 0/);
  assert.throws(() => buildPlanFromSnapshot({}, 'ss_right_right'), /strands\[\] array/);
  assert.throws(() => buildPlanFromSnapshot(snapshotFixture(), ''), /controllerId is required/);
});

test('the derived plan feeds the REAL client and yields the narrowed body only', () => {
  const snapshot = snapshotFixture();
  const plan = buildPlanFromSnapshot(snapshot, 'ss_right_right');
  const body = buildForcedConfigBody({ snapshot, plan, ip: '192.0.2.65' });
  assert.deepEqual(Object.keys(body).sort(), ['dmx', 'strands']);
  assert.equal('swarm' in body, false);
  assert.equal('gamma' in body, false);
  assert.equal(body.dmx.enabled, true);
  assert.equal(body.dmx.protocol, 0);
  assert.equal(body.dmx.timeoutMs, 3000);
  assert.deepEqual(body.strands[0], snapshot.strands[0]);
  assert.equal(body.strands[2].enabled, false);
  assert.equal('dmxUniverse' in body.strands[2], false);
});

test('--expect-universes asserts the snapshot BEFORE any write', () => {
  const plan = buildPlanFromSnapshot(snapshotFixture(), 'ss_right_right');
  assert.doesNotThrow(() => assertExpectedUniverses(plan, [37, 36]));
  assert.doesNotThrow(() => assertExpectedUniverses(plan, null));
  assert.throws(() => assertExpectedUniverses(plan, [34, 35]),
    /--expect-universes 34,35 ≠ the board's enabled universes 36,37/);
  assert.throws(() => assertExpectedUniverses(plan, [36]), /≠ the board's enabled universes/);
});

// ── The restore body (§6.4-4) ───────────────────────────────────────────────

test('the restore body carries EXACTLY {strands, dmx} from the pre-snapshot', () => {
  const snapshot = snapshotFixture();
  const body = buildRestoreBody(snapshot);
  assert.deepEqual(Object.keys(body).sort(), ['dmx', 'strands']);
  assert.deepEqual(body.strands, snapshot.strands);
  assert.deepEqual(body.dmx, snapshot.dmx);
  // The keys the run never touched are never mentioned — that is how the
  // board's swarm membership and gamma survive byte-for-byte.
  assert.equal('swarm' in body, false);
  assert.equal('gamma' in body, false);
  assert.equal('deviceName' in body, false);
});

test('the restore body is a COPY — mutating it cannot corrupt the snapshot', () => {
  const snapshot = snapshotFixture();
  const body = buildRestoreBody(snapshot);
  body.strands[0].count = 999;
  body.dmx.enabled = false;
  assert.equal(snapshot.strands[0].count, 40);
  assert.equal(snapshot.dmx.enabled, true);
});

test('a snapshot without strands[] or without a dmx object is a loud refusal', () => {
  assert.throws(() => buildRestoreBody({ dmx: {} }), /strands\[\] array/);
  assert.throws(() => buildRestoreBody({ strands: [] }), /carries no dmx object/);
  assert.throws(() => buildRestoreBody({ strands: [], dmx: [] }), /carries no dmx object/);
});

// ── The serial-window classifier (§6.3) ─────────────────────────────────────

test('boot counting: the banner lines of ONE boot count ONCE', () => {
  const lines = bootBanner(1000);
  const found = classifySerialWindow(lines, BASE_MS, BASE_MS + 60000);
  assert.equal(found.boots, 1);
  assert.equal(found.crashes.length, 0);
  assert.equal(found.windowLines, 3);
  assert.equal(found.bootLines[0].marker, 'esp-rom-banner');
});

test('boot counting: two separate boots in one window are TWO — the crash-loop shape', () => {
  const lines = [...bootBanner(1000), ...bootBanner(13000)];
  const found = classifySerialWindow(lines, BASE_MS, BASE_MS + 60000);
  assert.equal(found.boots, 2);
});

test('boot counting: the window bounds are honoured', () => {
  const lines = [...bootBanner(1000), ...bootBanner(40000)];
  assert.equal(classifySerialWindow(lines, BASE_MS, BASE_MS + 5000).boots, 1);
  assert.equal(classifySerialWindow(lines, BASE_MS + 30000, BASE_MS + 60000).boots, 1);
  assert.equal(classifySerialWindow(lines, BASE_MS + 5000, BASE_MS + 30000).boots, 0);
  assert.throws(() => classifySerialWindow(lines, BASE_MS + 10, BASE_MS),
    /window ends before it starts/);
  assert.throws(() => classifySerialWindow('not-an-array', BASE_MS, BASE_MS),
    /lines must be an array/);
  assert.throws(() => classifySerialWindow([], 'yesterday', BASE_MS),
    /must be a Date or an epoch-ms number/);
});

test('crash markers: the ESP-IDF-generic fatals are caught, quoted and timestamped', () => {
  const cases = [
    ['Guru Meditation Error: Core  0 panic\'ed (LoadProhibited).', 'guru-meditation'],
    ['abort() was called at PC 0x4008b1f5 on core 0', 'abort'],
    ['assert failed: xQueueSemaphoreTake queue.c:1545', 'assert-failed'],
    ['E (12345) task_wdt: Task watchdog got triggered.', 'task-watchdog'],
    ['Guru Meditation Error: Core 0 panic\'ed (Interrupt wdt timeout on CPU0)', 'guru-meditation'],
    ['Brownout detector was triggered', 'brownout'],
    ['CORRUPT HEAP: Bad head at 0x3ffb', 'heap-corruption'],
    ['Backtrace:0x40081b2e:0x3ffb1f30', 'backtrace'],
  ];
  for (const [text, marker] of cases) {
    const found = classifySerialWindow([capture(500, text)], BASE_MS, BASE_MS + 60000);
    assert.equal(found.crashes.length, 1, `no crash found in: ${text}`);
    assert.equal(found.crashes[0].marker, marker);
    assert.equal(found.crashes[0].text, text);
    assert.equal(found.crashes[0].ms, BASE_MS + 500);
  }
});

test('crash markers: a watchdog RESET REASON is both a boot and a crash', () => {
  const found = classifySerialWindow(bootBanner(1000, 'TG1WDT_SYS_RESET'),
    BASE_MS, BASE_MS + 60000);
  assert.equal(found.boots, 1);
  assert.equal(found.crashes.length, 1);
  assert.equal(found.crashes[0].marker, 'watchdog-reset-reason');
  // A clean power-on / software reset is NOT a crash.
  assert.equal(classifySerialWindow(bootBanner(1000, 'POWERON'), BASE_MS, BASE_MS + 60000)
    .crashes.length, 0);
  assert.equal(classifySerialWindow(bootBanner(1000, 'SW_CPU_RESET'), BASE_MS, BASE_MS + 60000)
    .crashes.length, 0);
});

test('crash markers: an UNSTAMPED line is still scanned, never silently dropped', () => {
  const lines = ['Guru Meditation Error: Core 0 panic\'ed (StoreProhibited)'];
  const found = classifySerialWindow(lines, BASE_MS, BASE_MS + 60000);
  assert.equal(found.malformedLines, 1);
  assert.equal(found.crashes.length, 1);
  assert.equal(found.crashes[0].ms, null);
  assert.equal(found.boots, 0, 'an unplaceable line delimits no boot');
});

test('crash markers: a healthy boot window has none', () => {
  const lines = [
    ...bootBanner(1000),
    capture(1400, 'I (330) cpu_start: Starting scheduler on PRO CPU.'),
    capture(1600, 'I (512) app: strand 0 type:WS2812 count:40 universe:36'),
    capture(1620, 'I (515) app: strand 1 type:WS2812 count:40 universe:37'),
  ];
  const found = classifySerialWindow(lines, BASE_MS, BASE_MS + 60000);
  assert.equal(found.crashes.length, 0);
  assert.equal(found.boots, 1);
});

test('strand consistency: the boot that initialized 2×40 px reads OK', () => {
  const lines = [
    ...bootBanner(1000),
    capture(1600, 'I (512) app: strand 0 type:WS2812 count:40'),
    capture(1620, 'I (515) app: strand 1 type:WS2812 count:40'),
  ];
  const found = classifySerialWindow(lines, BASE_MS, BASE_MS + 60000,
    { expectStrands: { outputs: 2, pixelCount: 40 } });
  assert.equal(found.strandInits.length, 2);
  assert.deepEqual(found.strandInits.map((s) => s.index), [0, 1]);
  assert.deepEqual(found.strandInits.map((s) => s.count), [40, 40]);
  assert.deepEqual(found.strandInits.map((s) => s.type), ['WS2812', 'WS2812']);
  assert.equal(found.strandCheck.ok, true);
  assert.equal(found.strandCheck.defaultStrandSuspect, false);
  assert.deepEqual(found.strandCheck.notes, []);
});

test('strand consistency: a firmware-default strand set is SUSPECT, not a shrug', () => {
  const lines = [
    ...bootBanner(1000),
    capture(1600, 'I (512) app: strand 0 type:WS2811 count:60'),
    capture(1620, 'I (515) app: strand 1 type:WS2811 count:60'),
  ];
  const found = classifySerialWindow(lines, BASE_MS, BASE_MS + 60000,
    { expectStrands: { outputs: 2, pixelCount: 40 } });
  assert.equal(found.strandCheck.ok, false);
  assert.equal(found.strandCheck.defaultStrandSuspect, true);
  assert.deepEqual(found.strandCheck.observedCounts, [60, 60]);
  assert.match(found.strandCheck.notes.join(' | '), /firmware-default strand set/);
});

test('strand consistency: too few initialized strands is a finding', () => {
  const lines = [...bootBanner(1000), capture(1600, 'I (512) app: strand 0 type:WS2812 count:40')];
  const found = classifySerialWindow(lines, BASE_MS, BASE_MS + 60000,
    { expectStrands: { outputs: 2, pixelCount: 40 } });
  assert.equal(found.strandCheck.ok, false);
  assert.equal(found.strandCheck.defaultStrandSuspect, false);
  assert.match(found.strandCheck.notes.join(' | '), /initialized 1 strand\(s\) of 40 px, expected 2/);
});

test('strand consistency: NO recognizable strand line is inconclusive, not a pass', () => {
  const found = classifySerialWindow(bootBanner(1000), BASE_MS, BASE_MS + 60000,
    { expectStrands: { outputs: 2, pixelCount: 40 } });
  assert.equal(found.strandCheck.ok, false);
  assert.equal(found.strandCheck.defaultStrandSuspect, false);
  assert.match(found.strandCheck.notes.join(' | '), /BM26_HIL_SERIAL_PATTERNS/);
});

test('the classifier accepts LOCAL extra patterns without embedding any', () => {
  const lines = [capture(500, 'W (900) local: rope segment 0 count=40'),
    capture(600, 'FW-SPECIFIC-FATAL 0x21')];
  const found = classifySerialWindow(lines, BASE_MS, BASE_MS + 60000, {
    extraCrashPatterns: [/FW-SPECIFIC-FATAL/],
    extraStrandPatterns: [/rope segment/],
    expectStrands: { outputs: 1, pixelCount: 40 },
  });
  assert.equal(found.crashes.length, 1);
  assert.equal(found.crashes[0].marker, 'local-crash-1');
  assert.equal(found.strandCheck.ok, true);
});

test('the classifier is PURE — same input, same answer, no mutation', () => {
  const lines = Object.freeze([...bootBanner(1000)]);
  const a = classifySerialWindow(lines, BASE_MS, BASE_MS + 60000);
  const b = classifySerialWindow(lines, BASE_MS, BASE_MS + 60000);
  assert.deepEqual(a, b);
});

// ── The result table (§6.5) ─────────────────────────────────────────────────

function reportFixture(status = 'PASS') {
  return {
    targets: [{
      id: 'ss_right_right',
      octet: 65,
      snapshotPath: '~/tmp/led_controller_configs_backup/hil_ss_right_right_stamp.json',
      serialPath: '~/tmp/hil_serial/ss_right_right_stamp.log',
      serialPort: 'COM7',
      rows: [
        { leg: 'PREFLIGHT', detail: 'allowlist+identity+capability+serial-attach', status: 'PASS' },
        {
          leg: 'CONFIG',
          detail: 'read-back verify',
          status,
          note: status === 'PASS' ? '0 mismatch(es)' : '1 mismatch(es)',
          details: status === 'PASS' ? [] : ['output 0: device count 60 px ≠ wanted 40 px'],
        },
      ],
    }],
  };
}

test('the table renders the §6.5 block, one row per step, and a verdict', () => {
  const text = renderTable(reportFixture('PASS'));
  assert.match(text, /^HIL PUSH CHECK — 1 target\(s\)$/m);
  assert.match(text, /^── ss_right_right \(\.65\) {3}snapshot: .*hil_ss_right_right_stamp\.json$/m);
  assert.match(text, /serial: {3}.*ss_right_right_stamp\.log \(COM7\)/);
  assert.match(text, /^ {2}PREFLIGHT {2}allowlist\+identity\+capability\+serial-attach {2}PASS$/m);
  assert.match(text, /^VERDICT: PASS \(2\/2\)$/m);
});

test('a FAIL row prints its mismatch verbatim and the verdict repeats the snapshot path', () => {
  const text = renderTable(reportFixture('FAIL'));
  assert.match(text, /output 0: device count 60 px ≠ wanted 40 px/);
  assert.match(text, /^VERDICT: FAIL \(1\/2\)$/m);
  assert.match(text, /snapshot ss_right_right: .*hil_ss_right_right_stamp\.json/);
});

test('SKIP rows count towards neither side of the verdict', () => {
  const report = reportFixture('PASS');
  report.targets[0].rows.push({ leg: 'TOGGLE', detail: 'DMX off → verify', status: 'SKIP',
    note: '--skip-toggle' });
  assert.match(renderTable(report), /^VERDICT: PASS \(2\/2\)$/m);
});

test('--no-serial caps the verdict at "PASS (HTTP-only — not gate evidence)"', () => {
  const report = reportFixture('PASS');
  report.noSerial = true;
  report.targets[0].serialPath = null;
  report.targets[0].serialPort = null;
  const text = renderTable(report);
  assert.match(text, /serial: {3}\(not captured\)/);
  assert.match(text, /^VERDICT: PASS \(HTTP-only — not gate evidence\) \(2\/2\)$/m);
  // …and a FAIL still reads FAIL, cap or no cap.
  const failing = reportFixture('FAIL');
  failing.noSerial = true;
  assert.match(renderTable(failing), /^VERDICT: FAIL \(1\/2\)$/m);
});

test('renderTable refuses a malformed report', () => {
  assert.throws(() => renderTable({}), /report.targets must be an array/);
  assert.throws(() => renderTable(null), /report.targets must be an array/);
});

// ── Inertness (§8-g) ────────────────────────────────────────────────────────

test('importing the runner runs NOTHING', () => {
  assert.equal(mainWasInvoked(), false);
  assert.equal(typeof main, 'function');
});

test('neither tool is reachable from an npm script or the default test glob', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const scripts = JSON.stringify(pkg.scripts);
  assert.equal(/hil_push_check|hil_serial_tail/.test(scripts), false,
    'no npm script may reference the HIL tools');
  // The default suite globs `tests/*.test.js`; `tools/` cannot be swept into it.
  assert.equal(pkg.scripts.test, 'node --test tests/*.test.js');
});
