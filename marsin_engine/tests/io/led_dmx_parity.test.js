// Tests for the LED↔DMX fixture PARITY work (report 20260618_6 / _7).
// Covers: controller `type` field + LED config, LED patch projection,
// the LED output mapper (RGBW write + native white pass-through, DMX path
// unchanged), the firmware-accurate strand RGBWAU→RGB sim mix, and the
// per-strand + LEFT/RIGHT view derivation/registration.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createControllerRegistry,
  addController,
  setControllerType,
  isLedController,
  normalizeLedConfig,
  ledStrideForOrder,
  computeLedProjection,
  CONTROLLER_TYPE_DMX,
  CONTROLLER_TYPE_LED,
  LED_CHANNEL_ORDERS,
} from '../../../simulation/src/dmx/controller_registry.js';
import { mapPixelsToSacn } from '../../../simulation/src/dmx/sacn_mapper.js';
import { mixRgbwauToRgb } from '../../../simulation/src/core/sim_preview.js';
import { buildMaskRegistry } from '../../lib/mask_registry.js';
import { deriveStrandViews } from '../../lib/strand_views.js';

// A minimal DMX router stand-in: one buffer per universe, getFullFrame +
// addUniverse, exactly the surface mapPixelsToSacn uses.
function makeRouter() {
  const frames = new Map();
  return {
    addUniverse(u) { if (!frames.has(u)) frames.set(u, new Uint8Array(512)); },
    getFullFrame(u) { return frames.get(u) || null; },
    _frames: frames,
  };
}

// ── Controller type field ───────────────────────────────────────────────

test('controller type: un-typed legacy controller defaults to DMX, loudly flagged', () => {
  const reg = createControllerRegistry({
    controllers: [{ id: 1, name: 'Legacy', ip: '10.1.1.10', ports: [] }],
  });
  assert.equal(reg.controllers[0].type, CONTROLLER_TYPE_DMX);
  // The migration is surfaced (not silent) for the caller to log.
  assert.ok(reg._untypedControllers.has(1));
});

test('controller type: explicit LED controller carries normalized led config', () => {
  const reg = createControllerRegistry({
    controllers: [{
      id: 1, name: 'Strands', ip: '10.1.1.20', type: 'LED',
      led: { order: 'RGBW', whiteMode: 'native' }, ports: [],
    }],
  });
  const c = reg.controllers[0];
  assert.equal(c.type, CONTROLLER_TYPE_LED);
  assert.ok(isLedController(c));
  assert.equal(c.led.order, 'RGBW');
  assert.equal(c.led.stride, 4);
  assert.equal(c.led.whiteMode, 'native');
});

test('controller type: invalid type hard-throws (no silent fallback)', () => {
  assert.throws(() => createControllerRegistry({
    controllers: [{ id: 1, name: 'Bad', ip: '10.1.1.10', type: 'SPI', ports: [] }],
  }), /invalid type/);
});

test('controller type: bad LED order / stride / whiteMode hard-throw', () => {
  assert.throws(() => normalizeLedConfig({ order: 'XYZ' }, 'C'), /unknown channel order/);
  assert.throws(() => normalizeLedConfig({ order: 'RGBW', stride: 2 }, 'C'), /stride/);
  assert.throws(() => normalizeLedConfig({ whiteMode: 'magic' }, 'C'), /whiteMode/);
});

test('controller type: setControllerType installs/drops led config', () => {
  const reg = createControllerRegistry({});
  const c = addController(reg, { name: 'C', ip: '10.1.1.30', type: CONTROLLER_TYPE_DMX });
  assert.equal(c.type, 'DMX');
  assert.equal(c.led, undefined);
  setControllerType(c, CONTROLLER_TYPE_LED);
  assert.ok(c.led && c.led.order === 'RGBW');
  setControllerType(c, CONTROLLER_TYPE_DMX);
  assert.equal(c.led, undefined);
});

test('ledStrideForOrder: defaults to channel-map max, honors override', () => {
  assert.equal(ledStrideForOrder('RGB'), 3);
  assert.equal(ledStrideForOrder('RGBW'), 4);
  assert.equal(ledStrideForOrder('RGBW', 6), 6);
});

// ── LED patch projection ────────────────────────────────────────────────

test('computeLedProjection: sequential RGBW addressing, universe wrap', () => {
  const reg = createControllerRegistry({
    controllers: [{
      id: 1, name: 'LED1', ip: '10.1.1.20', type: 'LED',
      led: { order: 'RGBW', startAddr: 1, baseUniverse: 10 },
      ports: [{ port: 1, universe: 10, chain: ['StrandA', 'StrandB'] }],
    }],
  });
  // StrandA = 100 px × 4 = 400 ch (fits in U10), StrandB = 100 px × 4 = 400
  // ch — would start at byte 400 in U10, but 400+... wraps: at byte 400 a
  // 4-byte pixel still fits (400..403 ≤ 512), so B starts at U10:401 and
  // wraps mid-strand.
  const counts = new Map([['StrandA', 100], ['StrandB', 100]]);
  const { fields } = computeLedProjection(reg, counts);
  const a = fields.get('StrandA');
  const b = fields.get('StrandB');
  assert.equal(a.universe, 10);
  assert.equal(a.addr, 1);
  assert.equal(a.stride, 4);
  assert.equal(a.order, 'RGBW');
  assert.equal(a.controllerIp, '10.1.1.20');
  // B packs right after A's 400 channels → byte 400 → addr 401, still U10.
  assert.equal(b.universe, 10);
  assert.equal(b.addr, 401);
});

test('computeLedProjection: strand straddling 512 bumps to next universe', () => {
  const reg = createControllerRegistry({
    controllers: [{
      id: 1, name: 'LED1', ip: '10.1.1.20', type: 'LED',
      led: { order: 'RGBW', startAddr: 509, baseUniverse: 5 }, // only 4 bytes left in U5
      ports: [{ port: 1, universe: 5, chain: ['S'] }],
    }],
  });
  const { fields } = computeLedProjection(reg, new Map([['S', 3]]));
  const s = fields.get('S');
  // First pixel fits at 509..512; second pixel (513..) wraps to U6 — but
  // the strand START stays U5:509 (per-pixel wrap handled at export).
  assert.equal(s.universe, 5);
  assert.equal(s.addr, 509);
});

test('computeLedProjection: unbound strand absent (exporter makes it loud)', () => {
  const reg = createControllerRegistry({
    controllers: [{
      id: 1, name: 'LED1', ip: '10.1.1.20', type: 'LED',
      led: { order: 'RGBW' }, ports: [{ port: 1, universe: 2, chain: ['Bound'] }],
    }],
  });
  const { fields } = computeLedProjection(reg, new Map([['Bound', 5], ['Unbound', 5]]));
  assert.ok(fields.has('Bound'));
  assert.ok(!fields.has('Unbound'));
});

test('computeLedProjection: bad-IP LED controller still projects + flags', () => {
  const reg = createControllerRegistry({
    controllers: [{
      id: 1, name: 'LED1', ip: 'not-an-ip', type: 'LED',
      led: { order: 'RGBW' }, ports: [{ port: 1, universe: 2, chain: ['S'] }],
    }],
  });
  const { fields, violations } = computeLedProjection(reg, new Map([['S', 4]]));
  assert.ok(fields.has('S'));
  assert.equal(fields.get('S').controllerIp, ''); // unsendable IP → empty
  assert.ok(violations.some(v => v.code === 'led_bad_ip'));
});

// ── LED output mapper (RGBW write + native white pass-through) ───────────

test('LED mapper: strand pixel goes out as the clip-proof composite split', () => {
  const router = makeRouter();
  // Plain rgb() pattern, no white lane: the strand still gets a W byte —
  // the SHARED FLOOR of the colour — because the LED controller re-derives
  // exactly that split itself (report 20260725_25). What must hold on the
  // wire is that the per-channel composite (RGB + W) is the intended colour
  // and can never clip.
  const entry = {
    type: 'led',
    patch: { universe: 2, addr: 1, footprint: 4, led: true },
    channels: { ...LED_CHANNEL_ORDERS.RGBW },
    whiteMode: 'native',
    r: 0.5, g: 1.0, b: 0.25, w: 0, a: 0, u: 0,
  };
  mapPixelsToSacn([entry], router);
  const f = router.getFullFrame(2);
  assert.equal(f[0] + f[3], Math.round(0.5 * 255));  // composite R
  assert.equal(f[1] + f[3], 255);                    // composite G
  assert.equal(f[2] + f[3], Math.round(0.25 * 255)); // composite B
  // Native white policy holds: no white lane in, no white byte out.
  assert.equal(f[3], 0);
});

test('LED mapper: explicit rgbwau W reaches the strand as white', () => {
  const router = makeRouter();
  const entry = {
    type: 'led',
    patch: { universe: 3, addr: 1, footprint: 4, led: true },
    channels: { ...LED_CHANNEL_ORDERS.RGBW },
    whiteMode: 'native',
    r: 0, g: 0, b: 0, w: 1.0, a: 0, u: 0,
  };
  mapPixelsToSacn([entry], router);
  const f = router.getFullFrame(3);
  assert.equal(f[0], 0);
  assert.equal(f[3], 255); // pure white → all of it on the white channel
});

test('LED mapper: a TINTED white keeps its tint (the white bug regression)', () => {
  const router = makeRouter();
  // Warm-white family pattern: tungsten RGB + a full white lane. The old
  // mapper sent (255,173,82,W=255); the controller folded that to
  // (255,255,255) and the strand showed NEUTRAL white.
  const entry = {
    type: 'led',
    patch: { universe: 8, addr: 1, footprint: 4, led: true },
    channels: { ...LED_CHANNEL_ORDERS.RGBW },
    whiteMode: 'native',
    r: 1.0, g: 0.68, b: 0.32, w: 1.0, a: 0, u: 0,
  };
  mapPixelsToSacn([entry], router);
  const f = router.getFullFrame(8);
  const composite = [f[0] + f[3], f[1] + f[3], f[2] + f[3]];
  assert.ok(composite.every(c => c <= 255), 'composite must not clip');
  assert.equal(Math.max(...composite), 255, 'peak channel uses the full range');
  // Warm ordering survives, and blue is nowhere near neutral.
  assert.ok(composite[0] > composite[1] && composite[1] > composite[2]);
  assert.ok(composite[2] < 200, `blue ${composite[2]} — tint was flattened`);
});

test('LED mapper: amber is folded into the strand RGB (pars keep their amber lane)', () => {
  const router = makeRouter();
  const entry = {
    type: 'led',
    patch: { universe: 9, addr: 1, footprint: 4, led: true },
    channels: { ...LED_CHANNEL_ORDERS.RGBW },
    whiteMode: 'native',
    r: 0, g: 0, b: 0, w: 0, a: 0.5, u: 0,
  };
  mapPixelsToSacn([entry], router);
  const f = router.getFullFrame(9);
  const composite = [f[0] + f[3], f[1] + f[3], f[2] + f[3]];
  assert.ok(composite[0] > 0 && composite[1] > 0, 'amber must light the strand');
  assert.ok(composite[0] > composite[1] && composite[1] > composite[2], 'and read warm');
});

test('LED mapper: whiteMode changes only the split, never the composite', () => {
  const router = makeRouter();
  const mk = (universe, whiteMode) => ({
    type: 'led',
    patch: { universe, addr: 1, footprint: 4, led: true },
    channels: { ...LED_CHANNEL_ORDERS.RGBW },
    whiteMode,
    r: 0.4, g: 0.6, b: 0.8, w: 0,
  });
  mapPixelsToSacn([mk(4, 'synth'), mk(5, 'native')], router);
  const a = router.getFullFrame(4), b = router.getFullFrame(5);
  // Same colour on the wire (identical composites) …
  for (let i = 0; i < 3; i++) assert.equal(a[i] + a[3], b[i] + b[3]);
  // … but synth parks the shared floor on the white emitter, native does not.
  assert.equal(a[3], Math.min(a[0] + a[3], a[1] + a[3], a[2] + a[3]));
  assert.equal(b[3], 0);
});

test('DMX mapper unchanged: fixture with W channel still synths min(R,G,B)', () => {
  const router = makeRouter();
  const entry = {
    type: 'dmx', fixtureType: 'UkingPar',
    patch: { universe: 2, addr: 1, footprint: 10 }, // no `led` flag
    channels: { r: 3, g: 4, b: 5, w: 6 },
    r: 0.4, g: 0.6, b: 0.8, w: 0,
  };
  mapPixelsToSacn([entry], router);
  const f = router.getFullFrame(2);
  // UkingPar forces master dimmer ch1 = 255, RGB at 3/4/5, W synth at 6.
  assert.equal(f[0], 255);
  assert.equal(f[5], Math.min(f[2], f[3], f[4])); // W = min(R,G,B)
  assert.ok(f[5] > 0);
});

test('LED mapper: GRBW order swaps R/G bytes', () => {
  const router = makeRouter();
  const entry = {
    type: 'led',
    patch: { universe: 7, addr: 1, footprint: 4, led: true },
    channels: { ...LED_CHANNEL_ORDERS.GRBW },
    whiteMode: 'native',
    r: 1.0, g: 0.5, b: 0, w: 0,
  };
  mapPixelsToSacn([entry], router);
  const f = router.getFullFrame(7);
  // GRBW: g→ch1, r→ch2, b→ch3, w→ch4. Composites (byte + W) carry the colour.
  assert.equal(f[0] + f[3], Math.round(0.5 * 255)); // ch1 = G
  assert.equal(f[1] + f[3], 255);                   // ch2 = R
});

// ── Generic RGBWAU → RGB sim mix ────────────────────────────────────────
// (LED STRANDS no longer use this: their preview is derived from the wire
//  bytes + the LED controller's white processing — simulation/src/dmx/led_wire.js.)

test('mixRgbwauToRgb: pure white shows white (w drives all channels)', () => {
  const [r, g, b] = mixRgbwauToRgb(0, 0, 0, 1, 0, 0);
  assert.equal(r, 1); assert.equal(g, 1); assert.equal(b, 1);
});

test('mixRgbwauToRgb: matches firmware weights exactly', () => {
  // firmware: outR=r+w+a*0.8+u*0.1, outG=g+w+a*0.4, outB=b+w+u*0.5 (clamped)
  const [r, g, b] = mixRgbwauToRgb(0.1, 0.2, 0.3, 0.05, 0.5, 0.4);
  assert.ok(Math.abs(r - Math.min(1, 0.1 + 0.05 + 0.5 * 0.8 + 0.4 * 0.1)) < 1e-9);
  assert.ok(Math.abs(g - Math.min(1, 0.2 + 0.05 + 0.5 * 0.4)) < 1e-9);
  assert.ok(Math.abs(b - Math.min(1, 0.3 + 0.05 + 0.4 * 0.5)) < 1e-9);
});

test('mixRgbwauToRgb: clamps to [0,1]', () => {
  const [r, g, b] = mixRgbwauToRgb(1, 1, 1, 1, 1, 1);
  assert.equal(r, 1); assert.equal(g, 1); assert.equal(b, 1);
});

// ── Per-strand + LEFT/RIGHT view derivation ─────────────────────────────

function strandPixels() {
  // 2 left strand groups, 2 right, plus a DMX fixture pixel (ignored).
  return [
    { i: 0, type: 'led', group: 'Left_Front_Left', x: -10 },
    { i: 1, type: 'led', group: 'Left_Front_Left', x: -10 },
    { i: 2, type: 'led', group: 'Small_Left_1', x: -8 },
    { i: 3, type: 'led', group: 'Right_Back_Right', x: 9 },
    { i: 4, type: 'led', group: 'Small_Right_2', x: 7 },
    { i: 5, type: 'dmx', group: 'Tower', x: -3 },
  ];
}

test('deriveStrandViews: per-strand entries + LEFT/RIGHT composites', () => {
  const d = deriveStrandViews(strandPixels(), new Set());
  // One per distinct strand group (4), skipping the DMX group.
  assert.deepEqual(d.perStrand.sort(),
    ['Left_Front_Left', 'Small_Left_1', 'Right_Back_Right', 'Small_Right_2'].sort());
  const names = d.entries.map(e => e.name);
  assert.ok(names.includes('LEFT'));
  assert.ok(names.includes('RIGHT'));
  // All Tier-A: zero bit cost.
  assert.ok(d.entries.every(e => e.bit === 0));
});

test('deriveStrandViews: skips names already owned by base groups', () => {
  const existing = new Set(['Left_Front_Left']);
  const d = deriveStrandViews(strandPixels(), existing);
  assert.ok(!d.perStrand.includes('Left_Front_Left')); // base group owns it
  assert.ok(d.perStrand.includes('Small_Left_1'));
});

test('deriveStrandViews: x-sign fallback for non-prefixed strand (loud)', () => {
  const px = [
    { i: 0, type: 'led', group: 'Bow', x: -5 },
    { i: 1, type: 'led', group: 'Stern', x: 5 },
  ];
  const d = deriveStrandViews(px, new Set());
  assert.ok(d.warnings.length >= 2);
  const left = d.entries.find(e => e.name === 'LEFT');
  const right = d.entries.find(e => e.name === 'RIGHT');
  assert.deepEqual(left.pixelIndices, [0]);
  assert.deepEqual(right.pixelIndices, [1]);
});

test('strand views register into MaskRegistry with correct members, no bit', () => {
  const pixels = strandPixels();
  const d = deriveStrandViews(pixels, new Set());
  // Feed the derived entries as viewMasks (bit:0) — the engine's path.
  const reg = buildMaskRegistry({
    pixels,
    pixelCount: pixels.length,
    groupBits: {},
    viewMasks: d.entries,
  });
  const left = reg.get('LEFT');
  const right = reg.get('RIGHT');
  assert.ok(left && right);
  assert.equal(left.bit, 0);
  // LEFT = indices 0,1,2 ; RIGHT = 3,4 ; DMX pixel 5 in neither.
  assert.deepEqual(Array.from(left.members), [1, 1, 1, 0, 0, 0]);
  assert.deepEqual(Array.from(right.members), [0, 0, 0, 1, 1, 0]);
  // Per-strand composite members.
  assert.deepEqual(Array.from(reg.get('Left_Front_Left').members), [1, 1, 0, 0, 0, 0]);
});
