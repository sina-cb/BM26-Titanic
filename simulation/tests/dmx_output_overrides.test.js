/**
 * Tests for the last-layer per-fixture output overrides (On/Off + Brightness).
 * Pure typed-array math — no browser deps — so it runs under `node --test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyFixtureOutputOverrides,
  resolveFixtureOverride,
  resolveGroupOverride,
  resolveCombinedOverride,
  OUTPUT_INTENSITY_CHANNELS,
} from '../src/dmx/dmx_output_overrides.js';

// Minimal fake router holding one 512-byte universe buffer.
function makeRouter(universe, fill = 0) {
  const frame = new Uint8Array(512).fill(fill);
  return {
    frame,
    getFullFrame(u) { return u === universe ? frame : null; },
  };
}

// A 4-channel RGB+strobe fixture (single pixel): R,G,B intensity + strobe (not scaled).
function rgbStrobeFixture(config) {
  return {
    config,
    fixtureDef: {
      footprint: 4,
      pixels: [{ channels: { red: 1, green: 2, blue: 3, strobe: 4 } }],
    },
  };
}

test('no override (enabled, 100%) leaves the frame untouched', () => {
  const router = makeRouter(5, 200);
  const fx = rgbStrobeFixture({ enabled: true, brightness: 100, dmxUniverse: 5, dmxAddress: 1 });
  applyFixtureOutputOverrides(router, [[fx]]);
  assert.deepEqual([...router.frame.subarray(0, 4)], [200, 200, 200, 200]);
});

test('undefined fields default to on / full brightness (no change)', () => {
  const router = makeRouter(5, 123);
  const fx = rgbStrobeFixture({ dmxUniverse: 5, dmxAddress: 1 });
  applyFixtureOutputOverrides(router, [[fx]]);
  assert.deepEqual([...router.frame.subarray(0, 4)], [123, 123, 123, 123]);
  assert.deepEqual(resolveFixtureOverride({}), { enabled: true, brightness: 100 });
});

test('disabled fixture blacks out its ENTIRE footprint (incl. non-intensity)', () => {
  const router = makeRouter(5, 255);
  // Address 10 → channels 10..13 (0-based 9..12)
  const fx = rgbStrobeFixture({ enabled: false, brightness: 100, dmxUniverse: 5, dmxAddress: 10 });
  applyFixtureOutputOverrides(router, [[fx]]);
  assert.deepEqual([...router.frame.subarray(9, 13)], [0, 0, 0, 0], 'footprint zeroed');
  assert.equal(router.frame[8], 255, 'channel before fixture untouched');
  assert.equal(router.frame[13], 255, 'channel after fixture untouched');
});

test('brightness scales ONLY intensity channels, leaves strobe alone', () => {
  const router = makeRouter(5, 200);
  const fx = rgbStrobeFixture({ enabled: true, brightness: 50, dmxUniverse: 5, dmxAddress: 1 });
  applyFixtureOutputOverrides(router, [[fx]]);
  assert.deepEqual([...router.frame.subarray(0, 3)], [100, 100, 100], 'RGB halved');
  assert.equal(router.frame[3], 200, 'strobe channel NOT scaled');
});

test('brightness 0 with enabled zeroes intensity channels only', () => {
  const router = makeRouter(1, 255);
  const fx = rgbStrobeFixture({ enabled: true, brightness: 0, dmxUniverse: 1, dmxAddress: 1 });
  applyFixtureOutputOverrides(router, [[fx]]);
  assert.deepEqual([...router.frame.subarray(0, 3)], [0, 0, 0]);
  assert.equal(router.frame[3], 255, 'strobe untouched at brightness 0');
});

test('patchDef universe/addr take precedence over config', () => {
  const router = makeRouter(7, 255);
  const fx = rgbStrobeFixture({ enabled: false, dmxUniverse: 99, dmxAddress: 99 });
  fx.patchDef = { universe: 7, addr: 1 };
  applyFixtureOutputOverrides(router, [[fx]]);
  assert.deepEqual([...router.frame.subarray(0, 4)], [0, 0, 0, 0]);
});

test('multi-pixel fixture scales every pixel\'s intensity channels', () => {
  const router = makeRouter(2, 100);
  const fx = {
    config: { enabled: true, brightness: 50, dmxUniverse: 2, dmxAddress: 1 },
    fixtureDef: {
      footprint: 6,
      pixels: [
        { channels: { red: 1, green: 2, blue: 3 } },
        { channels: { red: 4, green: 5, blue: 6 } },
      ],
    },
  };
  applyFixtureOutputOverrides(router, [[fx]]);
  assert.deepEqual([...router.frame.subarray(0, 6)], [50, 50, 50, 50, 50, 50]);
});

test('unpatched fixture (universe/addr < 1) is skipped', () => {
  const router = makeRouter(0, 200); // universe 0 won't match getFullFrame anyway
  const fx = rgbStrobeFixture({ enabled: false, dmxUniverse: 0, dmxAddress: 0 });
  applyFixtureOutputOverrides(router, [[fx]]);
  assert.deepEqual([...router.frame.subarray(0, 4)], [200, 200, 200, 200]);
});

test('dimmer + value channels are recognised as intensity', () => {
  assert.ok(OUTPUT_INTENSITY_CHANNELS.has('dimmer'));
  assert.ok(OUTPUT_INTENSITY_CHANNELS.has('value'));
  assert.ok(!OUTPUT_INTENSITY_CHANNELS.has('strobe'));
  assert.ok(!OUTPUT_INTENSITY_CHANNELS.has('pan'));
});

// ── Group master (higher priority than the fixture) ──────────────────────

test('resolveGroupOverride defaults to on / 100 for missing group', () => {
  assert.deepEqual(resolveGroupOverride(undefined, 'A'), { enabled: true, brightness: 100 });
  assert.deepEqual(resolveGroupOverride({}, 'A'), { enabled: true, brightness: 100 });
  assert.deepEqual(resolveGroupOverride({ A: { brightness: 60 } }, 'A'), { enabled: true, brightness: 60 });
});

test('group brightness wins over fixture unless group is at 100', () => {
  // group 60 + fixture 80 → 60 (group wins because it is not 100)
  assert.equal(resolveCombinedOverride({ group: 'A', brightness: 80 }, { A: { brightness: 60 } }).brightness, 60);
  // group 100 (default) + fixture 80 → 80 (fixture applies)
  assert.equal(resolveCombinedOverride({ group: 'A', brightness: 80 }, { A: { brightness: 100 } }).brightness, 80);
  // no group entry + fixture 80 → 80
  assert.equal(resolveCombinedOverride({ group: 'A', brightness: 80 }, {}).brightness, 80);
});

test('group On/Off is a master kill: group off forces fixture off', () => {
  assert.equal(resolveCombinedOverride({ group: 'A', enabled: true }, { A: { enabled: false } }).enabled, false);
  // group on defers to the fixture
  assert.equal(resolveCombinedOverride({ group: 'A', enabled: false }, { A: { enabled: true } }).enabled, false);
  assert.equal(resolveCombinedOverride({ group: 'A', enabled: true }, { A: { enabled: true } }).enabled, true);
});

test('group brightness scales member output through applyFixtureOutputOverrides', () => {
  const router = makeRouter(3, 200);
  const fx = rgbStrobeFixture({ enabled: true, brightness: 100, group: 'A', dmxUniverse: 3, dmxAddress: 1 });
  applyFixtureOutputOverrides(router, [[fx]], { A: { enabled: true, brightness: 25 } });
  assert.deepEqual([...router.frame.subarray(0, 3)], [50, 50, 50], 'RGB scaled to group 25%');
  assert.equal(router.frame[3], 200, 'strobe untouched');
});

test('group off blacks out the whole footprint even if fixture is on/100', () => {
  const router = makeRouter(3, 255);
  const fx = rgbStrobeFixture({ enabled: true, brightness: 100, group: 'A', dmxUniverse: 3, dmxAddress: 1 });
  applyFixtureOutputOverrides(router, [[fx]], { A: { enabled: false, brightness: 100 } });
  assert.deepEqual([...router.frame.subarray(0, 4)], [0, 0, 0, 0]);
});
