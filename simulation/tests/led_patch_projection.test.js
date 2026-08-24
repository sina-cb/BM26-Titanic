/**
 * led_patch_projection.test.js — the PER-OUTPUT per-strand patch projection for
 * DEVICE-BOUND MarsinLED controllers (plan 20260709_0 P4; per-output-only ruling
 * 2026-07-10/11). Pure: no DOM, no network. Each controller port IS one device
 * output whose cursor RESETS to (port.universe, ch 1); strands chained on one
 * port pack contiguously; an empty/disabled port contributes nothing. Golden
 * cases mirror docs/41 §3 (the real .201 shape) plus the spill, empty-port-skip,
 * and fail-loud paths.
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

test('bench golden: two 40px outputs → per-port U3 ch1–160 / U4 ch1–160', () => {
  const reg = boundRegistry([
    p(1, 3, 'lineA'), p(2, 4, 'lineB'), p(3, 5), p(4, 6),
  ]);
  const counts = new Map([['lineA', 40], ['lineB', 40]]);
  const { fields, violations } = computeLedStrandPatches(reg, counts);
  assert.equal(violations.length, 0);
  assert.deepEqual(fields.get('lineA'), {
    controllerIp: '10.1.1.201', controllerId: 1, dmxUniverse: 3, dmxAddress: 1,
    pixelCount: 40, outputIndex: 0, portNum: 1,
    segments: [{ universe: 3, startChannel: 1, endChannel: 160, pixelCount: 40 }],
    endUniverse: 3, endChannel: 160,
  });
  // Per-output firmware: lineB is an INDEPENDENT receiver on its OWN port
  // universe (U4) channel 1 — NOT a continuation of lineA at U3:161.
  assert.deepEqual(fields.get('lineB'), {
    controllerIp: '10.1.1.201', controllerId: 1, dmxUniverse: 4, dmxAddress: 1,
    pixelCount: 40, outputIndex: 1, portNum: 2,
    segments: [{ universe: 4, startChannel: 1, endChannel: 160, pixelCount: 40 }],
    endUniverse: 4, endChannel: 160,
  });
});

test('cursor RESETS per-port; contiguity holds only WITHIN one port chain', () => {
  // Per-output firmware: each output is an independent sACN receiver on its OWN
  // universe channel 1. Two 40px strands on SEPARATE ports each restart at ch1;
  // two 40px strands CHAINED on ONE port pack contiguously (the 2nd at ch161).
  const perPort = boundRegistry([p(1, 3, 'lineA'), p(2, 4, 'lineB')]);
  const pf = computeLedStrandPatches(perPort, new Map([['lineA', 40], ['lineB', 40]])).fields;
  assert.deepEqual([pf.get('lineB').dmxUniverse, pf.get('lineB').dmxAddress], [4, 1]);

  const onePort = boundRegistry([p(1, 3, 'chainA', 'chainB'), p(2, 4)]);
  const of = computeLedStrandPatches(onePort, new Map([['chainA', 40], ['chainB', 40]])).fields;
  assert.deepEqual([of.get('chainA').dmxUniverse, of.get('chainA').dmxAddress], [3, 1]);
  assert.deepEqual([of.get('chainB').dmxUniverse, of.get('chainB').dmxAddress], [3, 161]);
});

test('a disabled/empty middle port contributes nothing and does not shift other ports', () => {
  const reg = boundRegistry([p(1, 3, 'lineA'), p(2, 4), p(3, 5, 'lineC'), p(4, 6)]);
  const { fields } = computeLedStrandPatches(reg, new Map([['lineA', 40], ['lineC', 40]]));
  assert.equal(fields.get('lineA').dmxAddress, 1);
  assert.equal(fields.get('lineA').outputIndex, 0);
  // lineC lands at ITS OWN port universe (U5) ch1 — the empty middle port (U4)
  // neither consumes channels nor shifts lineC off its declared universe.
  assert.deepEqual(fields.get('lineC'), {
    controllerIp: '10.1.1.201', controllerId: 1, dmxUniverse: 5, dmxAddress: 1,
    pixelCount: 40, outputIndex: 2, portNum: 3,
    segments: [{ universe: 5, startChannel: 1, endChannel: 160, pixelCount: 40 }],
    endUniverse: 5, endChannel: 160,
  });
});

test('spill stays within one output: 200px fills U3→U4; the next PORT starts at its own U4:1', () => {
  const reg = boundRegistry([p(1, 3, 'big'), p(2, 4, 'small')]);
  const { fields } = computeLedStrandPatches(reg, new Map([['big', 200], ['small', 40]]));
  // big spills WITHIN output 0's own stream: 128 px fill U3 (ch1–512), the
  // remaining 72 px roll to U4 ch1–288.
  assert.equal(fields.get('big').dmxUniverse, 3);
  assert.equal(fields.get('big').dmxAddress, 1);
  assert.equal(fields.get('big').endUniverse, 4);
  assert.equal(fields.get('big').endChannel, 288);
  // small is an INDEPENDENT output: it restarts at its OWN port universe U4 ch1
  // (per-output firmware), NOT after big's spill at ch289.
  assert.equal(fields.get('small').dmxUniverse, 4);
  assert.equal(fields.get('small').dmxAddress, 1);
});

test('multiple strands chained on one output pack contiguously', () => {
  const reg = boundRegistry([p(1, 3, 'a', 'b'), p(2, 4)]);
  const { fields } = computeLedStrandPatches(reg, new Map([['a', 10], ['b', 10]]));
  assert.equal(fields.get('a').dmxAddress, 1);
  assert.equal(fields.get('a').outputIndex, 0);
  assert.equal(fields.get('b').dmxAddress, 41); // 10px * 4 = 40 channels after a
  assert.equal(fields.get('b').outputIndex, 0);
});

test('an UNBOUND LED controller patches identically to a bound one (ruling 2026-08-03)', () => {
  const bound = computeLedStrandPatches(boundRegistry([p(1, 3, 'lineA')]),
    new Map([['lineA', 40]]));
  const unbound = computeLedStrandPatches(boundRegistry([p(1, 3, 'lineA')], { device: null }),
    new Map([['lineA', 40]]));
  assert.deepEqual(unbound.violations, []);
  assert.deepEqual(unbound.fields.get('lineA'), bound.fields.get('lineA'),
    'binding grade is a hardware CLAIM, never part of the byte layout');
});

test('an UNBOUND LED controller with EMPTY chains projects nothing, silently', () => {
  const reg = boundRegistry([p(1, 3), p(2, 4)], { device: null });
  const { fields, violations } = computeLedStrandPatches(reg, new Map([['lineA', 40]]));
  assert.equal(fields.size, 0);
  assert.deepEqual(violations, []);
});

test('an output with an out-of-range universe → violation, its strands unpatched', () => {
  // Per-output: each output declares its OWN universe. A port universe > the
  // sACN ceiling loads (operational, not corruption) and is flagged loudly at
  // projection — that output's strands stay unpatched.
  const reg = boundRegistry([p(1, 70000, 'lineA')]);
  const { fields, violations } = computeLedStrandPatches(reg, new Map([['lineA', 40]]));
  assert.equal(fields.size, 0);
  assert.equal(violations[0].code, 'led_unallocated_base');
  assert.match(violations[0].message, /output 1 carries strands but has no valid universe/);
});

test('universe-ceiling overflow: a strand spilling past U63999 → loud violation, unpatched', () => {
  // Per-output equivalent of the removed computeLinearLayout cap test: a 129 px
  // RGBW strand at U63999 fills U63999, then its 129th pixel would roll to
  // U64000 (past the sACN ceiling) — the walker overflows, so the strand stays
  // unpatched rather than wrapping silently (codex P0).
  const reg = boundRegistry([p(1, 63999, 'big')]);
  const { fields, violations } = computeLedStrandPatches(reg, new Map([['big', 129]]));
  assert.equal(fields.has('big'), false);
  assert.ok(violations.some((v) => v.code === 'led_universe_overflow'));
});

// ── Slice D: manual per-output universes (base = first enabled output) ────────

test('base universe = the FIRST ENABLED output (empty port 1 ⇒ port 2 universe)', () => {
  const reg = boundRegistry([p(1, 6), p(2, 7, 'lineB'), p(3, 8), p(4, 9)]);
  const { fields } = computeLedStrandPatches(reg, new Map([['lineB', 40]]));
  assert.equal(fields.get('lineB').dmxUniverse, 7);
  assert.equal(fields.get('lineB').dmxAddress, 1);
  assert.equal(fields.get('lineB').outputIndex, 1);
});

test('golden .201 per-output: 2×40px on U6/U7 → device honors U6:1 and U7:1, zero warnings', () => {
  const reg = boundRegistry([p(1, 6, 'lineA'), p(2, 7, 'lineB'), p(3, 8), p(4, 9)]);
  const counts = new Map([['lineA', 40], ['lineB', 40]]);
  const { fields, violations } = computeLedStrandPatches(reg, counts);
  assert.equal(violations.length, 0);
  assert.equal(fields.get('lineA').dmxUniverse, 6);
  assert.equal(fields.get('lineA').dmxAddress, 1);
  // Per-output firmware HONORS each output's declared universe: lineB streams
  // from U7 ch1, NOT a continuation of lineA at U6:161 (the old linear defect).
  assert.equal(fields.get('lineB').dmxUniverse, 7);
  assert.equal(fields.get('lineB').dmxAddress, 1);
  // A declared universe is ALWAYS honored now — the 'unhonorable' warning no
  // longer exists, and these two disjoint universes collide with nothing.
  const warnings = validateLedManualUniverses(reg, counts, new Map());
  assert.equal(warnings.length, 0);
  // Projection places both strands.
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

test('a bad-IP controller still projects but with an empty controllerIp', () => {
  const reg = boundRegistry([p(1, 3, 'lineA')], { ip: 'not-an-ip' });
  const { fields, violations } = computeLedStrandPatches(reg, new Map([['lineA', 40]]));
  assert.equal(fields.get('lineA').controllerIp, '');
  assert.ok(violations.some((v) => v.code === 'led_no_destination_ip'));
});

test('a bad IP on a card with NO chains is silent (nothing needs a destination)', () => {
  const reg = boundRegistry([p(1, 3)], { ip: 'not-an-ip' });
  assert.deepEqual(computeLedStrandPatches(reg, new Map()).violations, []);
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
  // Per-output: each port starts at its OWN universe channel 1.
  const reg = boundRegistry([p(1, 6, 'big'), p(2, 7, 'small')]);
  const { fields } = computeLedStrandPatches(reg, new Map([['big', 200], ['small', 40]]));
  const big = fields.get('big');
  assert.equal(big.dmxUniverse, 6);   // output 0 starts at its universe U6 ch1
  assert.equal(big.dmxAddress, 1);
  assert.equal(big.endUniverse, 7);   // spills WITHIN output 0's own stream
  assert.equal(big.endChannel, 288);
  assert.deepEqual(big.segments, [
    { universe: 6, startChannel: 1, endChannel: 512, pixelCount: 128 },
    { universe: 7, startChannel: 1, endChannel: 288, pixelCount: 72 },
  ]);
  // small is an INDEPENDENT output starting at its OWN port universe U7 ch1 —
  // NOT after big's spill (per-output firmware).
  const small = fields.get('small');
  assert.equal(small.dmxUniverse, 7);
  assert.equal(small.dmxAddress, 1);
  assert.equal(small.endUniverse, 7);
  assert.equal(small.endChannel, 160);
  assert.deepEqual(small.segments, [
    { universe: 7, startChannel: 1, endChannel: 160, pixelCount: 40 },
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

// ── _71 (24): a CROSSED port → output mapping (report 20260725_70) ───────────
// `outputIndex` is the PHYSICAL board output the port DECLARES; `portNum` is the
// card row that owns the strand. They were the same number until the output
// selector existed, and every operator-facing label must keep using the PORT.

test('_71: a crossed mapping stamps the DECLARED output, while claims name the CARD port', () => {
  const reg = boundRegistry([
    { port: 1, output: 4, universe: 6, chain: ['lineA'] },   // P1 drives output 4
    { port: 2, output: 1, universe: 7, chain: ['lineB'] },   // P2 drives output 1
  ]);
  const counts = new Map([['lineA', 40], ['lineB', 40]]);
  const { fields, violations } = computeLedStrandPatches(reg, counts);
  assert.deepEqual(violations, []);

  assert.equal(fields.get('lineA').outputIndex, 3, 'output 4 → strands[3]');
  assert.equal(fields.get('lineA').portNum, 1);
  assert.equal(fields.get('lineB').outputIndex, 0);
  assert.equal(fields.get('lineB').portNum, 2);

  // The claim label must name the port the operator EDITS. Deriving it from
  // `outputIndex + 1` named the wrong row in every claim (and in the push's
  // collision refusal text) the moment a mapping crossed.
  const claims = computeLedUniverseClaims(fields, new Map());
  assert.equal(claims.get(6)[0].portNum, 1);
  assert.equal(claims.get(7)[0].portNum, 2);
});

test('_71: two ports declaring ONE output load and are flagged by the chip checker', () => {
  const reg = boundRegistry([
    { port: 1, output: 2, universe: 6, chain: ['lineA'] },
    { port: 3, output: 2, universe: 7, chain: ['lineB'] },
  ]);
  const counts = new Map([['lineA', 40], ['lineB', 40]]);
  const chips = validateLedManualUniverses(reg, counts, new Map());
  const dup = chips.find((w) => w.code === 'led_output_duplicate');
  assert.ok(dup, 'a hand-edited duplicate must show red in the pane, not brick the boot');
  assert.equal(dup.port, 1);
  assert.match(dup.message, /ports P1 and P3 both drive output 2/);
});
