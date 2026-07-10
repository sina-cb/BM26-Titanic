/**
 * led_patch_projection.test.js — the device-linear per-strand patch projection
 * for DEVICE-BOUND MarsinLED controllers (plan 20260709_0 P4). Pure: no DOM,
 * no network. Golden cases mirror docs/41 §3 (the real .201 shape) plus the
 * spill, disabled-output-skip, and fail-loud paths.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createControllerRegistry, CONTROLLER_TYPE_LED } from '../src/dmx/controller_registry.js';
import {
  computeLedStrandPatches,
  computeLedUniverseClaims,
  projectLedStrandPixels,
  projectLedStrandSegments,
  validateLedManualUniverses,
} from '../src/dmx/led/led_patch_projection.js';

const DEVICE = { vendor: 'marsinled', controllerId: 'titanic_201', boardId: 'angio4-old' };

function boundRegistry(ports, { baseUniverse = 3, startAddr = 1, ip = '10.1.1.201', device = DEVICE } = {}) {
  return createControllerRegistry({
    controllers: [{
      id: 1, name: 'T201', ip, type: CONTROLLER_TYPE_LED,
      led: { order: 'RGBW', baseUniverse, startAddr },
      device,
      ports,
    }],
  });
}

const p = (port, universe, ...chain) => ({ port, universe, chain });

test('bench golden: two 40px outputs → contiguous U3 ch1–160 / ch161–320', () => {
  const reg = boundRegistry([
    p(1, 3, 'lineA'), p(2, 4, 'lineB'), p(3, 5), p(4, 6),
  ]);
  const counts = new Map([['lineA', 40], ['lineB', 40]]);
  const { fields, violations } = computeLedStrandPatches(reg, counts);
  assert.equal(violations.length, 0);
  assert.deepEqual(fields.get('lineA'), {
    controllerIp: '10.1.1.201', controllerId: 1, dmxUniverse: 3, dmxAddress: 1,
    pixelCount: 40, outputIndex: 0,
    segments: [{ universe: 3, startChannel: 1, endChannel: 160, pixelCount: 40 }],
    endUniverse: 3, endChannel: 160,
  });
  assert.deepEqual(fields.get('lineB'), {
    controllerIp: '10.1.1.201', controllerId: 1, dmxUniverse: 3, dmxAddress: 161,
    pixelCount: 40, outputIndex: 1,
    segments: [{ universe: 3, startChannel: 161, endChannel: 320, pixelCount: 40 }],
    endUniverse: 3, endChannel: 320,
  });
});

test('cursor is CONTIGUOUS across outputs, not per-port (the firmware model)', () => {
  // If this used the sim per-port model, lineB would restart at U3:1. The
  // device runs one contiguous stream, so lineB MUST continue at ch161.
  const reg = boundRegistry([p(1, 3, 'lineA'), p(2, 4, 'lineB')]);
  const { fields } = computeLedStrandPatches(reg, new Map([['lineA', 40], ['lineB', 40]]));
  assert.notEqual(fields.get('lineB').dmxAddress, 1);
  assert.equal(fields.get('lineB').dmxAddress, 161);
});

test('a disabled middle output is skipped; the cursor stays contiguous', () => {
  const reg = boundRegistry([p(1, 3, 'lineA'), p(2, 4), p(3, 5, 'lineC'), p(4, 6)]);
  const { fields } = computeLedStrandPatches(reg, new Map([['lineA', 40], ['lineC', 40]]));
  assert.equal(fields.get('lineA').dmxAddress, 1);
  assert.equal(fields.get('lineA').outputIndex, 0);
  // lineC follows lineA's 160 channels even though output 1 is empty.
  assert.deepEqual(fields.get('lineC'), {
    controllerIp: '10.1.1.201', controllerId: 1, dmxUniverse: 3, dmxAddress: 161,
    pixelCount: 40, outputIndex: 2,
    segments: [{ universe: 3, startChannel: 161, endChannel: 320, pixelCount: 40 }],
    endUniverse: 3, endChannel: 320,
  });
});

test('spill: a 200px strand fills U3 then U4; the next strand starts in U4', () => {
  const reg = boundRegistry([p(1, 3, 'big'), p(2, 4, 'small')]);
  const { fields } = computeLedStrandPatches(reg, new Map([['big', 200], ['small', 40]]));
  // big starts at U3:1; 128 px fill U3 (ch1..509 occupied, 512 is last full
  // pixel boundary), remaining 72 px roll to U4:1..288.
  assert.equal(fields.get('big').dmxUniverse, 3);
  assert.equal(fields.get('big').dmxAddress, 1);
  // small continues after big's 200 px: U4, ch 289.
  assert.equal(fields.get('small').dmxUniverse, 4);
  assert.equal(fields.get('small').dmxAddress, 289);
});

test('multiple strands chained on one output pack contiguously', () => {
  const reg = boundRegistry([p(1, 3, 'a', 'b'), p(2, 4)]);
  const { fields } = computeLedStrandPatches(reg, new Map([['a', 10], ['b', 10]]));
  assert.equal(fields.get('a').dmxAddress, 1);
  assert.equal(fields.get('a').outputIndex, 0);
  assert.equal(fields.get('b').dmxAddress, 41); // 10px * 4 = 40 channels after a
  assert.equal(fields.get('b').outputIndex, 0);
});

test('an UNBOUND LED controller yields NO strand records', () => {
  const reg = boundRegistry([p(1, 3, 'lineA')], { device: null });
  const { fields, violations } = computeLedStrandPatches(reg, new Map([['lineA', 40]]));
  assert.equal(fields.size, 0);
  assert.equal(violations.length, 0);
});

test('first enabled output with an out-of-range universe → violation, strands unpatched', () => {
  // Base now derives from the first enabled output's port.universe (Slice D).
  // A port universe > the sACN ceiling loads (operational, not corruption) and
  // is flagged loudly at projection — strands stay unpatched.
  const reg = boundRegistry([p(1, 70000, 'lineA')]);
  const { fields, violations } = computeLedStrandPatches(reg, new Map([['lineA', 40]]));
  assert.equal(fields.size, 0);
  assert.equal(violations[0].code, 'led_unallocated_base');
  assert.match(violations[0].message, /first enabled output \(port 1\)/);
});

// ── Slice D: manual per-output universes (base = first enabled output) ────────

test('base universe = the FIRST ENABLED output (empty port 1 ⇒ port 2 universe)', () => {
  const reg = boundRegistry([p(1, 6), p(2, 7, 'lineB'), p(3, 8), p(4, 9)]);
  const { fields } = computeLedStrandPatches(reg, new Map([['lineB', 40]]));
  assert.equal(fields.get('lineB').dmxUniverse, 7);
  assert.equal(fields.get('lineB').dmxAddress, 1);
  assert.equal(fields.get('lineB').outputIndex, 1);
});

test('golden .201 manual: 2×40px on U6/U7 → device U6 ch1/161 + ONE unhonorable warning', () => {
  const reg = boundRegistry([p(1, 6, 'lineA'), p(2, 7, 'lineB'), p(3, 8), p(4, 9)]);
  const counts = new Map([['lineA', 40], ['lineB', 40]]);
  const { fields, violations } = computeLedStrandPatches(reg, counts);
  assert.equal(violations.length, 0);
  assert.equal(fields.get('lineA').dmxUniverse, 6);
  assert.equal(fields.get('lineA').dmxAddress, 1);
  // Single-base linear device: lineB really lands at U6:161, NOT the manual U7.
  assert.equal(fields.get('lineB').dmxUniverse, 6);
  assert.equal(fields.get('lineB').dmxAddress, 161);

  const warnings = validateLedManualUniverses(reg, counts, new Map());
  const unhonorable = warnings.filter((w) => w.code === 'led_universe_unhonorable');
  assert.equal(unhonorable.length, 1);
  assert.equal(unhonorable[0].port, 2);
  assert.match(unhonorable[0].message, /P2 is set to U7/);
  assert.match(unhonorable[0].message, /will drive these pixels at U6 ch 161/);
  // A warning NEVER empties the patch fields — projection proceeds.
  assert.equal(fields.size, 2);
});

test('honorable boundary: 2×128px RGBW on U6/U7 → zero warnings, strand B at U7:1', () => {
  const reg = boundRegistry([p(1, 6, 'lineA'), p(2, 7, 'lineB'), p(3, 8), p(4, 9)]);
  const counts = new Map([['lineA', 128], ['lineB', 128]]);
  const { fields } = computeLedStrandPatches(reg, counts);
  assert.equal(fields.get('lineB').dmxUniverse, 7);
  assert.equal(fields.get('lineB').dmxAddress, 1);
  assert.equal(validateLedManualUniverses(reg, counts, new Map()).length, 0);
});

test('collision: an LED controller streaming U2 collides with a DMX universe', () => {
  const reg = boundRegistry([p(1, 2, 'lineA'), p(2, 3), p(3, 4), p(4, 5)]);
  const counts = new Map([['lineA', 10]]);
  const dmxMaps = new Map([[2, [{ name: 'par1', start: 1, end: 6 }]]]);
  const warnings = validateLedManualUniverses(reg, counts, dmxMaps);
  assert.ok(warnings.some((w) => w.code === 'led_universe_collision'));
});

test('duplicate: two outputs declaring the same universe warn (they land differently)', () => {
  const reg = boundRegistry([p(1, 6, 'lineA'), p(2, 6, 'lineB'), p(3, 8), p(4, 9)]);
  const counts = new Map([['lineA', 40], ['lineB', 40]]);
  const warnings = validateLedManualUniverses(reg, counts, new Map());
  assert.ok(warnings.some((w) => w.code === 'led_universe_duplicate'));
  // Both land in U6, so NEITHER is unhonorable — only the duplicate fires.
  assert.equal(warnings.filter((w) => w.code === 'led_universe_unhonorable').length, 0);
});

test('unknown strand ledCount → loud violation, that strand unpatched', () => {
  const reg = boundRegistry([p(1, 3, 'ghost'), p(2, 4, 'lineB')]);
  const { fields, violations } = computeLedStrandPatches(reg, new Map([['lineB', 40]]));
  assert.equal(fields.has('ghost'), false);
  assert.ok(violations.some((v) => v.code === 'led_unknown_strand'));
  // lineB still projects — the cursor never advanced for the unknown strand.
  assert.equal(fields.get('lineB').dmxAddress, 1);
});

test('a bad-IP bound controller still projects but with an empty controllerIp', () => {
  const reg = boundRegistry([p(1, 3, 'lineA')], { ip: 'not-an-ip' });
  const { fields, violations } = computeLedStrandPatches(reg, new Map([['lineA', 40]]));
  assert.equal(fields.get('lineA').controllerIp, '');
  assert.ok(violations.some((v) => v.code === 'led_bad_ip'));
});

// ── Slice L1: projectLedStrandSegments (DMX-parity multi-universe view) ───────

const STRIDE = 4; // RGBW

test('L1 golden: 200px @ U6 → two segments [U6 ch1–512 ×128, U7 ch1–288 ×72]', () => {
  const { segments, universe, channel, overflow } = projectLedStrandSegments(6, 1, STRIDE, 200);
  assert.equal(overflow, false);
  assert.deepEqual(segments, [
    { universe: 6, startChannel: 1, endChannel: 512, pixelCount: 128 },
    { universe: 7, startChannel: 1, endChannel: 288, pixelCount: 72 },
  ]);
  // Cursor after the last placed pixel = next strand's contiguous start.
  assert.equal(universe, 7);
  assert.equal(channel, 289);
});

test('L1 golden: 40px @ U6 → one segment U6 ch1–160', () => {
  const { segments, universe, channel } = projectLedStrandSegments(6, 1, STRIDE, 40);
  assert.deepEqual(segments, [
    { universe: 6, startChannel: 1, endChannel: 160, pixelCount: 40 },
  ]);
  assert.equal(universe, 6);
  assert.equal(channel, 161);
});

test('L1 no-straddle proof: startAddr 511 stride 4 → first pixel at U7 ch1, U6 511–512 untouched', () => {
  const count = 10;
  const { segments } = projectLedStrandSegments(6, 511, STRIDE, count);
  // A stride-4 pixel cannot fit in ch511–512 → the whole strand rolls to U7 ch1.
  assert.equal(segments.length, 1);
  assert.equal(segments[0].universe, 7);
  assert.equal(segments[0].startChannel, 1);
  // Assert NO segment claims any channel in U6 (511–512 stay unused).
  assert.ok(!segments.some((s) => s.universe === 6));
  // …and the segment view reconstructs the pixel walker byte-for-byte.
  assertSegmentsMatchPixels(6, 511, STRIDE, count);
});

test('L1 misaligned start: startAddr 3, 129px → [U6 ch3–510 ×127, U7 ch1–8 ×2]', () => {
  // 3 + 127×4 = 511; 511 + 3 > 512 → pixel 127 (index 127, the 128th) rolls to U7.
  const { segments } = projectLedStrandSegments(6, 3, STRIDE, 129);
  assert.deepEqual(segments, [
    { universe: 6, startChannel: 3, endChannel: 510, pixelCount: 127 },
    { universe: 7, startChannel: 1, endChannel: 8, pixelCount: 2 },
  ]);
  assertSegmentsMatchPixels(6, 3, STRIDE, 129);
});

// Reconstruct the pixel list from segments and assert it equals the walker's.
function assertSegmentsMatchPixels(u, ch, stride, count) {
  const { pixels } = projectLedStrandPixels(u, ch, stride, count);
  const { segments } = projectLedStrandSegments(u, ch, stride, count);
  const rebuilt = [];
  for (const seg of segments) {
    for (let a = seg.startChannel; a <= seg.endChannel; a += stride) {
      rebuilt.push({ universe: seg.universe, addr: a });
    }
  }
  assert.deepEqual(rebuilt, pixels);
  const totalSegPixels = segments.reduce((n, s) => n + s.pixelCount, 0);
  assert.equal(totalSegPixels, pixels.length);
}

test('L1 equivalence property: segments reconstruct the pixel walker across a grid', () => {
  const startAddrs = [1, 2, 3, 509, 511, 512];
  const counts = [1, 40, 127, 128, 129, 200, 256];
  const strides = [3, 4, 5];
  for (const startAddr of startAddrs) {
    for (const count of counts) {
      for (const stride of strides) {
        assertSegmentsMatchPixels(6, startAddr, stride, count);
      }
    }
  }
});

test('L1 records: computeLedStrandPatches now carries segments/endUniverse/endChannel', () => {
  // baseUniverse is ignored for bound controllers; base = first enabled output.
  const reg = boundRegistry([p(1, 6, 'big'), p(2, 7, 'small')]);
  const { fields } = computeLedStrandPatches(reg, new Map([['big', 200], ['small', 40]]));
  const big = fields.get('big');
  assert.equal(big.dmxUniverse, 6);   // start unchanged (bytes identical)
  assert.equal(big.dmxAddress, 1);
  assert.equal(big.endUniverse, 7);
  assert.equal(big.endChannel, 288);
  assert.deepEqual(big.segments, [
    { universe: 6, startChannel: 1, endChannel: 512, pixelCount: 128 },
    { universe: 7, startChannel: 1, endChannel: 288, pixelCount: 72 },
  ]);
  // small packs contiguously after big (U7 ch289) in one universe.
  const small = fields.get('small');
  assert.equal(small.dmxUniverse, 7);
  assert.equal(small.dmxAddress, 289);
  assert.equal(small.endUniverse, 7);
  assert.equal(small.endChannel, 448);
  assert.deepEqual(small.segments, [
    { universe: 7, startChannel: 289, endChannel: 448, pixelCount: 40 },
  ]);
});

test('L1 multi-strand packing on one port with mid-strand spill', () => {
  // Two 100px strands chained on output 0, base U6. A fills ch1–400; B starts
  // at ch401, fits 28 px (ch401–512) then spills 72 px into U7 ch1–288.
  const reg = boundRegistry([p(1, 6, 'A', 'B'), p(2, 7)]);
  const { fields } = computeLedStrandPatches(reg, new Map([['A', 100], ['B', 100]]));
  assert.deepEqual(fields.get('A').segments, [
    { universe: 6, startChannel: 1, endChannel: 400, pixelCount: 100 },
  ]);
  assert.equal(fields.get('B').dmxUniverse, 6);
  assert.equal(fields.get('B').dmxAddress, 401);
  assert.deepEqual(fields.get('B').segments, [
    { universe: 6, startChannel: 401, endChannel: 512, pixelCount: 28 },
    { universe: 7, startChannel: 1, endChannel: 288, pixelCount: 72 },
  ]);
  assert.equal(fields.get('B').endUniverse, 7);
  assert.equal(fields.get('B').endChannel, 288);
});

// ── Slice L1: computeLedUniverseClaims (per-universe occupancy mirror) ────────

test('L1 claims: a bound 200px strand claims BOTH U6 and U7 (spill visible)', () => {
  const reg = boundRegistry([p(1, 6, 'big'), p(2, 7)]);
  const { fields } = computeLedStrandPatches(reg, new Map([['big', 200]]));
  const claims = computeLedUniverseClaims(fields);
  assert.deepEqual([...claims.keys()].sort((a, b) => a - b), [6, 7]);
  assert.deepEqual(claims.get(6), [
    { start: 1, end: 512, name: 'big', controllerId: 1, portNum: 1, led: true },
  ]);
  assert.deepEqual(claims.get(7), [
    { start: 1, end: 288, name: 'big', controllerId: 1, portNum: 1, led: true },
  ]);
});

test('L1 claims: two strands sharing a spill universe both appear, sorted by start', () => {
  // Controller 1: 200px @ U6 spills into U7 ch1–288.
  // Controller 2: 40px starting @ U7 ch1 (its own spill target collision).
  const c1 = boundRegistry([p(1, 6, 'big'), p(2, 7)]);
  const { fields: f1 } = computeLedStrandPatches(c1, new Map([['big', 200]]));
  // A second, independent bound record landing in U7 (synthesize via generic path).
  const generic = new Map([
    ['zeta', { universe: 7, addr: 1, stride: STRIDE, ledCount: 40, controllerId: 2 }],
  ]);
  const claims = computeLedUniverseClaims(f1, generic);
  const u7 = claims.get(7);
  assert.equal(u7.length, 2);
  // Both start at ch1 → tiebreak by name ('big' < 'zeta').
  assert.equal(u7[0].name, 'big');
  assert.equal(u7[0].controllerId, 1);
  assert.equal(u7[1].name, 'zeta');
  assert.equal(u7[1].controllerId, 2);
  assert.equal(u7[1].end, 160);
});

test('L1 claims: generic (unbound) START-only records are walked into segments', () => {
  const generic = {
    strandX: { universe: 3, addr: 1, stride: STRIDE, ledCount: 200, controllerId: 5 },
  };
  const claims = computeLedUniverseClaims(null, generic);
  assert.deepEqual([...claims.keys()].sort((a, b) => a - b), [3, 4]);
  assert.deepEqual(claims.get(3), [
    { start: 1, end: 512, name: 'strandX', controllerId: 5, portNum: undefined, led: true },
  ]);
  assert.deepEqual(claims.get(4), [
    { start: 1, end: 288, name: 'strandX', controllerId: 5, portNum: undefined, led: true },
  ]);
});

test('L1 claims: empty / missing inputs yield an empty map (no throw)', () => {
  assert.equal(computeLedUniverseClaims(null, null).size, 0);
  assert.equal(computeLedUniverseClaims(new Map()).size, 0);
});
