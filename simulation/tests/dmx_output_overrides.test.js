/**
 * Tests for the last-layer per-fixture output overrides (On/Off + Brightness).
 * Pure typed-array math — no browser deps — so it runs under `node --test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyFixtureOutputOverrides,
  resolveFixtureOverride,
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
