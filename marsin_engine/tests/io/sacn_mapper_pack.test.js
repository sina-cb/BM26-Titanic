/**
 * sacn_mapper_pack.test.js — `mapPixelsToSacn` OUTGOING packing (catalog
 * `.agent/reports/202608/20260805_162_engine_test_gap_catalog.md` G-2, rank 2)
 * plus `suppressNativeStrobes` (G-11, folded in per the catalog).
 *
 * `simulation/src/dmx/sacn_mapper.js:260` is imported by `engine.js:61` and
 * called every rendered frame for every model — it is the byte-generation
 * function for every DMX fixture on the ship. Before this file,
 * `simulation/tests/sacn_mapper.test.js` tested ONLY `demapSacnToPixels`
 * (inbound, sACN-in preview); nothing exercised the direction the ENGINE
 * actually uses.
 *
 * Uses the REAL `UniverseRouter` (imported exactly as `engine.js:62` does),
 * so this also pins the auto-universe-creation path and the Node-has-no-
 * `window` parity note: `mapPixelsToSacn` reads `window.__addressSuppressionIndex`
 * for shared-address suppression; Node has no `window`, so `lostIndex` is
 * always null on the engine side — suppression is a sim-preview-only concern
 * here. Asserted once below rather than re-litigated per case.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { mapPixelsToSacn, suppressNativeStrobes } from '../../../simulation/src/dmx/sacn_mapper.js';
import { UniverseRouter } from '../../../simulation/src/dmx/universe_router.js';
import { ledWireBytes } from '../../../simulation/src/dmx/led_wire.js';

function makeRouter() {
  const r = new UniverseRouter('highest_priority_source_lock');
  return r;
}

// ── Engine parity: no `window` in Node ────────────────────────────────────

test('engine parity: Node has no `window` — address-suppression index is never consulted', () => {
  assert.equal(typeof window, 'undefined');
});

// ── Case 1: UkingPar shape (master dimmer force, RGB, white synth, A/U) ───

test('UkingPar-shape entry: master dimmer forced, RGB placed, white synthesized, A/U placed', () => {
  const router = makeRouter();
  router.addUniverse(1);
  const entry = {
    fixtureType: 'UkingPar',
    patch: { universe: 1, addr: 1, footprint: 10 },
    channels: { r: 3, g: 4, b: 5, w: 6, a: 7, u: 8 },
    r: 1, g: 0.5, b: 0, w: 0, a: 0.2, u: 0,
  };
  mapPixelsToSacn([entry], router);
  const buf = router.getFullFrame(1);
  assert.equal(buf[0], 255, 'master dimmer (ch1) forced to full for a par family fixture');
  assert.equal(buf[2], 255, 'R (ch3)');
  assert.equal(buf[3], 127, 'G (ch4) — Uint8Array assignment truncates 127.5 toward zero');
  assert.equal(buf[4], 0, 'B (ch5)');
  assert.equal(buf[5], 0, 'W (ch6) synthesized = min(255,127,0) = 0 (no explicit W)');
  assert.equal(buf[6], 51, 'A (ch7) = round-free 0.2*255');
  assert.equal(buf[7], 0, 'U (ch8) = 0');
});

test('white policy: no explicit W synthesizes min(R,G,B); an explicit W passes through untouched', () => {
  const router = makeRouter();
  router.addUniverse(1);
  router.addUniverse(2);
  const base = {
    fixtureType: 'UkingPar',
    channels: { r: 3, g: 4, b: 5, w: 6, a: 7, u: 8 },
    r: 0.8, g: 0.8, b: 0.8, a: 0, u: 0,
  };
  mapPixelsToSacn([{ ...base, patch: { universe: 1, addr: 1, footprint: 10 }, w: 0 }], router);
  const synth = router.getFullFrame(1);
  assert.equal(synth[5], 204, 'synth = min of the three written RGB bytes');

  mapPixelsToSacn([{ ...base, patch: { universe: 2, addr: 1, footprint: 10 }, w: 0.5 }], router);
  const explicit = router.getFullFrame(2);
  assert.equal(explicit[5], 127, 'explicit W (0.5) passes through, no synth, truncated not rounded');
});

// ── Case 3: numeric-`channels` polyfill ───────────────────────────────────

test('numeric channels polyfill: 10 + type par + footprint 10 resolves to the par 6ch map', () => {
  const router = makeRouter();
  router.addUniverse(1);
  const entry = {
    type: 'par',
    patch: { universe: 1, addr: 1, footprint: 10 },
    channels: 10,
    r: 1, g: 0.5, b: 0, w: 0, a: 0.2, u: 0,
  };
  mapPixelsToSacn([entry], router);
  const buf = router.getFullFrame(1);
  // Same resolved map + same bytes as the explicit-object UkingPar case.
  assert.equal(buf[0], 255);
  assert.equal(buf[2], 255);
  assert.equal(buf[3], 127);
  assert.equal(buf[4], 0);
  assert.equal(buf[5], 0);
  assert.equal(buf[6], 51);
  assert.equal(buf[7], 0);
});

test('numeric channels polyfill: 6 + footprint 6 resolves to {r:1,g:2,b:3,w:4,a:5,u:6}', () => {
  const router = makeRouter();
  router.addUniverse(1);
  const entry = {
    patch: { universe: 1, addr: 1, footprint: 6 },
    channels: 6,
    r: 1, g: 0, b: 0, w: 0, a: 1, u: 1,
  };
  mapPixelsToSacn([entry], router);
  const buf = router.getFullFrame(1);
  assert.equal(buf[0], 255, 'ch1 = r');
  assert.equal(buf[1], 0, 'ch2 = g');
  assert.equal(buf[2], 0, 'ch3 = b');
  // ch4 = w: no explicit-positive w (w:0) -> synth = min(r,g,b) bytes = 0
  assert.equal(buf[3], 0, 'ch4 = w (synth)');
  assert.equal(buf[4], 255, 'ch5 = a');
  assert.equal(buf[5], 255, 'ch6 = u');
});

test('numeric channels polyfill: 3 resolves to {r:1,g:2,b:3} and leaves byte 4 untouched', () => {
  const router = makeRouter();
  router.addUniverse(1);
  const entry = {
    patch: { universe: 1, addr: 1, footprint: 3 },
    channels: 3,
    r: 1, g: 1, b: 1,
  };
  mapPixelsToSacn([entry], router);
  const buf = router.getFullFrame(1);
  assert.equal(buf[0], 255);
  assert.equal(buf[1], 255);
  assert.equal(buf[2], 255);
  assert.equal(buf[3], 0, 'byte 4 (no w channel resolved for channels:3) stays untouched');
});

test('numeric channels polyfill: 4 resolves w:4 present', () => {
  const router = makeRouter();
  router.addUniverse(1);
  const entry = {
    patch: { universe: 1, addr: 1, footprint: 4 },
    channels: 4,
    r: 0, g: 0, b: 0, w: 1,
  };
  mapPixelsToSacn([entry], router);
  const buf = router.getFullFrame(1);
  assert.equal(buf[3], 255, 'ch4 = w, explicit passthrough since w > 0');
});

// ── Case 4: mono fixture ───────────────────────────────────────────────

test('mono fixture with explicit w: luma path rounds (Math.round(0.5*255) = 128, not a truncation)', () => {
  const router = makeRouter();
  router.addUniverse(1);
  const entry = {
    patch: { universe: 1, addr: 1, footprint: 1 },
    channels: { w: 1 },
    w: 0.5,
  };
  mapPixelsToSacn([entry], router);
  const buf = router.getFullFrame(1);
  // NOTE: the _162 catalog draft expected 127 here (assuming plain
  // truncation). The mono-fixture branch (sacn_mapper.js:377-380) explicitly
  // calls Math.round(luma) before writing, and JS Math.round rounds .5 up
  // (toward +Infinity) for positive numbers, so 0.5*255=127.5 -> 128. Pinned
  // to the REAL computed value, not the draft's assumption.
  assert.equal(buf[0], 128);
});

test('mono fixture with no explicit w: luma = 0.299R + 0.587G + 0.114B (all white → 255)', () => {
  const router = makeRouter();
  router.addUniverse(1);
  const entry = {
    patch: { universe: 1, addr: 1, footprint: 1 },
    channels: { w: 1 },
    r: 1, g: 1, b: 1,
  };
  mapPixelsToSacn([entry], router);
  const buf = router.getFullFrame(1);
  assert.equal(buf[0], 255);
});

// ── Case 5: out-of-range clamp ─────────────────────────────────────────

test('out-of-range clamp: > 1.0 clamps to 255, negative clamps to 0, NaN clamps to 0 via the `|| 0`', () => {
  const router = makeRouter();
  router.addUniverse(1);
  router.addUniverse(2);
  router.addUniverse(3);
  mapPixelsToSacn([{ patch: { universe: 1, addr: 1, footprint: 3 }, channels: { r: 1, g: 2, b: 3 }, r: 1.5, g: 0, b: 0 }], router);
  assert.equal(router.getFullFrame(1)[0], 255, 'r:1.5 clamps to 255');

  mapPixelsToSacn([{ patch: { universe: 2, addr: 1, footprint: 3 }, channels: { r: 1, g: 2, b: 3 }, r: -0.2, g: 0, b: 0 }], router);
  assert.equal(router.getFullFrame(2)[0], 0, 'r:-0.2 clamps to 0');

  mapPixelsToSacn([{ patch: { universe: 3, addr: 1, footprint: 3 }, channels: { r: 1, g: 2, b: 3 }, r: NaN, g: 0, b: 0 }], router);
  assert.equal(router.getFullFrame(3)[0], 0, 'r:NaN -> NaN*255=NaN, clamps fall through the `|| 0`');
});

// ── Case 6: auto-universe creation / router without addUniverse ──────────

test('auto-universe: an entry on a universe the router has not pre-added still lands', () => {
  const router = makeRouter(); // universe 7 never explicitly added
  const entry = { patch: { universe: 7, addr: 1, footprint: 3 }, channels: { r: 1, g: 2, b: 3 }, r: 1, g: 0, b: 0 };
  assert.equal(router.getFullFrame(7), null, 'sanity: U7 does not exist yet');
  mapPixelsToSacn([entry], router);
  assert.ok(router.listUniverses().includes(7), 'router gained U7');
  assert.equal(router.getFullFrame(7)[0], 255);
});

test('a router with no addUniverse method and a missing universe: entry is skipped, no throw', () => {
  const bareRouter = { getFullFrame() { return null; } }; // no addUniverse key at all
  const entry = { patch: { universe: 9, addr: 1, footprint: 3 }, channels: { r: 1, g: 2, b: 3 }, r: 1, g: 0, b: 0 };
  assert.doesNotThrow(() => mapPixelsToSacn([entry], bareRouter));
});

// ── Case 7: unpatched entry ────────────────────────────────────────────

test('an entry with no patch writes nothing anywhere and does not throw', () => {
  const router = makeRouter();
  router.addUniverse(1);
  const before = Array.from(router.getFullFrame(1));
  assert.doesNotThrow(() => mapPixelsToSacn([{ channels: { r: 1, g: 2, b: 3 }, r: 1, g: 1, b: 1 }], router));
  assert.deepEqual(Array.from(router.getFullFrame(1)), before, 'universe 1 buffer is untouched');
});

// ── Case 8: LED-strand branch ──────────────────────────────────────────

test('LED entry: bytes equal ledWireBytes output at the r/g/b/w offsets, and preview is cached', () => {
  const router = makeRouter();
  router.addUniverse(10);
  const entry = {
    type: 'led',
    patch: { universe: 10, addr: 1, footprint: 4, led: true },
    channels: { r: 1, g: 2, b: 3, w: 4 },
    whiteMode: 'native',
    r: 0.5, g: 1.0, b: 0.25, w: 0, a: 0, u: 0,
  };
  mapPixelsToSacn([entry], router);
  const buf = router.getFullFrame(10);
  const expected = ledWireBytes(entry.r, entry.g, entry.b, entry.w, entry.a, undefined, 'native');
  assert.equal(buf[0], expected.r);
  assert.equal(buf[1], expected.g);
  assert.equal(buf[2], expected.b);
  assert.equal(buf[3], expected.w);
  assert.ok(entry._ledWirePreview, 'preview cache set on the entry');
});

test('LED entry with no white channel in the map: RGB-only strand composites r+w/g+w/b+w', () => {
  const router = makeRouter();
  router.addUniverse(11);
  const entry = {
    type: 'led',
    patch: { universe: 11, addr: 1, footprint: 3, led: true },
    channels: { r: 1, g: 2, b: 3 }, // no w key
    whiteMode: 'native',
    r: 0.4, g: 0.6, b: 0.8, w: 0.2, a: 0, u: 0,
  };
  mapPixelsToSacn([entry], router);
  const buf = router.getFullFrame(11);
  const bytes = ledWireBytes(entry.r, entry.g, entry.b, entry.w, entry.a, undefined, 'native');
  assert.equal(buf[0], bytes.r + bytes.w);
  assert.equal(buf[1], bytes.g + bytes.w);
  assert.equal(buf[2], bytes.b + bytes.w);
});

// ── G-11: suppressNativeStrobes ─────────────────────────────────────────

test('suppressNativeStrobes: UkingPar CH8 (Total Strobe) forced to 0', () => {
  const router = makeRouter();
  router.addUniverse(1);
  const frame = router.getFullFrame(1);
  frame[7] = 200; // relative channel 8, 0-indexed 7, addr=1
  const list = [{ patch: { universe: 1, addr: 1 }, fixtureType: 'UkingPar' }];
  suppressNativeStrobes(list, router);
  assert.equal(frame[7], 0);
});

test('suppressNativeStrobes: VintageLed CH2 (Total Strobe) forced to 0', () => {
  const router = makeRouter();
  router.addUniverse(1);
  const frame = router.getFullFrame(1);
  frame[1] = 150; // relative channel 2, 0-indexed 1
  const list = [{ patch: { universe: 1, addr: 1 }, fixtureType: 'VintageLed' }];
  suppressNativeStrobes(list, router);
  assert.equal(frame[1], 0);
});

test('suppressNativeStrobes: EndyshowBar clears BOTH RGB Strobe (129) and ACW Strobe (130)', () => {
  const router = makeRouter();
  router.addUniverse(1);
  const frame = router.getFullFrame(1);
  frame[128] = 99;
  frame[129] = 99;
  const list = [{ patch: { universe: 1, addr: 1 }, fixtureType: 'EndyshowBar' }];
  suppressNativeStrobes(list, router);
  assert.equal(frame[128], 0);
  assert.equal(frame[129], 0);
});

test('suppressNativeStrobes: ShehdsBar (empty strobe list) leaves its bytes alone', () => {
  const router = makeRouter();
  router.addUniverse(1);
  const frame = router.getFullFrame(1);
  frame[7] = 200;
  const list = [{ patch: { universe: 1, addr: 1 }, fixtureType: 'ShehdsBar' }];
  suppressNativeStrobes(list, router);
  assert.equal(frame[7], 200, 'ShehdsBar has no native strobe oscillator (docs/09) — untouched');
});

test('suppressNativeStrobes: two entries sharing (universe,addr) are only written once (dedupe)', () => {
  const router = makeRouter();
  router.addUniverse(1);
  const frame = router.getFullFrame(1);
  frame[7] = 200;
  const list = [
    { patch: { universe: 1, addr: 1 }, fixtureType: 'UkingPar' },
    { patch: { universe: 1, addr: 1 }, fixtureType: 'UkingPar' }, // shared address, e.g. sub-pixel
  ];
  // Dedupe is an internal perf detail; what we can observe externally is that
  // the shared (universe,addr) key is only ever resolved ONCE — count calls
  // to getFullFrame itself (a TypedArray Proxy can't be used here: sacn_mapper
  // reads `frame.length`, and TypedArray internal slots reject a Proxy
  // receiver for that getter).
  let calls = 0;
  const router2 = { getFullFrame: (u) => { calls++; return u === 1 ? frame : null; } };
  suppressNativeStrobes(list, router2);
  assert.equal(calls, 1, 'the shared (universe,addr) fixture is only resolved/written once');
  assert.equal(frame[7], 0);
});

test('suppressNativeStrobes: an out-of-bounds relative channel is skipped, no throw', () => {
  const router = makeRouter();
  router.addUniverse(1);
  // EndyshowBar strobe channel 130 from addr 400 -> offset 399+130-1=528 >= 512
  const list = [{ patch: { universe: 1, addr: 400 }, fixtureType: 'EndyshowBar' }];
  assert.doesNotThrow(() => suppressNativeStrobes(list, router));
});

test('suppressNativeStrobes: unknown fixtureType is untouched', () => {
  const router = makeRouter();
  router.addUniverse(1);
  const frame = router.getFullFrame(1);
  frame[7] = 200;
  const list = [{ patch: { universe: 1, addr: 1 }, fixtureType: 'TotallyUnknownFixture' }];
  suppressNativeStrobes(list, router);
  assert.equal(frame[7], 200);
});
