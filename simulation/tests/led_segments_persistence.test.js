/**
 * led_segments_persistence.test.js — Slice L3 (plan 20260710_2): the pure
 * seams behind per-segment LED persistence, spill-universe subscription,
 * spill reservation, and the UI span string. No DOM, no live device — every
 * case runs on synthetic registries / plain param objects.
 *
 *  G1 — a strand spilling across universes persists EVERY segment
 *       (universe + start/end channel), not just its start, in the
 *       patches.yaml record shape the save server emits.
 *  G2 — deriveSubscribedUniverses covers every universe a strand's segments
 *       touch (start + spills), so spill universes are not left dark.
 *  G4 — the LED universe claim map + noteUniverseUsed reserve spill
 *       universes so a later nextFreeUniverse never re-hands them out.
 *  G5 — the UI-facing span string reads U6:1 → U7:288 (spill) / U6:1–160 (single).
 *
 * patch_manager.js is a browser module (touches `window`, starts a poll), so
 * we stub the few globals it assigns at import time before importing it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis.window || {};

import {
  normalizeLedConfig,
  noteUniverseUsed,
  nextFreeUniverse,
  CONTROLLER_TYPE_LED,
} from '../src/dmx/controller_registry.js';
import {
  computeLedStrandPatches,
  computeLedUniverseClaims,
} from '../src/dmx/led/led_patch_projection.js';

// controller_map_editor pulls in GUI modules that assign `window` at load, and
// patch_manager touches `window` + starts a poll at import — both must be
// imported AFTER the stub above (a static import would hoist above it).
const { params } = await import('../src/core/state.js');
const { deriveSubscribedUniverses } = await import('../src/dmx/patch_manager.js');
const { ledStrandSpanText } = await import('../src/gui/controller_map_editor.js');

/** A synthetic bound MarsinLED registry: one output at `universe`, one strand. */
function boundLedRegistry(strandName, universe, ledCount, nextUniverse = universe) {
  return {
    nextControllerId: 2,
    nextUniverse,
    controllers: [{
      id: 1,
      name: 'LED_CTRL',
      ip: '10.1.1.201',
      type: CONTROLLER_TYPE_LED,
      device: { vendor: 'marsinled', controllerId: 'abc123' }, // makes it BOUND
      led: normalizeLedConfig({ order: 'RGBW' }, 'LED_CTRL'), // RGBW → stride 4
      ports: [{ port: 1, universe, chain: [strandName] }],
    }],
  };
}

/**
 * Mirror of save-server.js's strand-record building (kept in lockstep here so
 * the test pins the patches.yaml shape without importing the Node server into
 * the browser bundle). Nine persisted fields, segments included.
 */
function strandPatchRecord(strand) {
  return {
    controllerIp: strand.controllerIp || '',
    controllerId: strand.controllerId || 0,
    dmxUniverse: strand.dmxUniverse || 0,
    dmxAddress: strand.dmxAddress || 0,
    pixelCount: strand.pixelCount || 0,
    outputIndex: (strand.outputIndex === undefined || strand.outputIndex === null)
      ? -1 : strand.outputIndex,
    endUniverse: strand.endUniverse || 0,
    endChannel: strand.endChannel || 0,
    segments: Array.isArray(strand.segments)
      ? strand.segments.map((s) => ({
        universe: s.universe, startChannel: s.startChannel,
        endChannel: s.endChannel, pixelCount: s.pixelCount,
      }))
      : [],
  };
}

// ── G1 — per-segment persistence ─────────────────────────────────────────────

test('G1: a 200 px strand @ U6 persists both segments + end cursor', () => {
  const reg = boundLedRegistry('LED_X', 6, 200);
  const rec = computeLedStrandPatches(reg, { LED_X: 200 }).fields.get('LED_X');
  assert.ok(rec, 'strand LED_X must be patched by the bound projection');

  // Start fields unchanged (bytes identical to the shipped device-linear walk).
  assert.equal(rec.dmxUniverse, 6);
  assert.equal(rec.dmxAddress, 1);
  assert.equal(rec.pixelCount, 200);
  assert.equal(rec.outputIndex, 0);

  // New per-segment view: U6 ch1–512 (128 px) then U7 ch1–288 (72 px).
  assert.deepEqual(rec.segments, [
    { universe: 6, startChannel: 1, endChannel: 512, pixelCount: 128 },
    { universe: 7, startChannel: 1, endChannel: 288, pixelCount: 72 },
  ]);
  assert.equal(rec.endUniverse, 7);
  assert.equal(rec.endChannel, 288);
});

test('G1: the persisted patches.yaml record carries all nine fields incl. segments', () => {
  const reg = boundLedRegistry('LED_X', 6, 200);
  const rec = computeLedStrandPatches(reg, { LED_X: 200 }).fields.get('LED_X');
  // Simulate main.js copying the record onto the strand, then save-server
  // extracting it into the patches.yaml record.
  const strand = { name: 'LED_X', ...rec };
  const persisted = strandPatchRecord(strand);

  assert.deepEqual(Object.keys(persisted).sort(), [
    'controllerId', 'controllerIp', 'dmxAddress', 'dmxUniverse', 'endChannel',
    'endUniverse', 'outputIndex', 'pixelCount', 'segments',
  ]);
  assert.equal(persisted.endUniverse, 7);
  assert.equal(persisted.endChannel, 288);
  assert.equal(persisted.segments.length, 2);
  assert.equal(persisted.segments[1].universe, 7);
  assert.equal(persisted.segments[1].pixelCount, 72);
});

test('G1: a single-universe strand persists one segment', () => {
  const reg = boundLedRegistry('LED_S', 6, 40);
  const rec = computeLedStrandPatches(reg, { LED_S: 40 }).fields.get('LED_S');
  assert.deepEqual(rec.segments, [
    { universe: 6, startChannel: 1, endChannel: 160, pixelCount: 40 },
  ]);
  assert.equal(rec.endUniverse, 6);
  assert.equal(rec.endChannel, 160);
});

// ── G2 — spill-universe subscription ─────────────────────────────────────────

test('G2: deriveSubscribedUniverses covers every universe a strand spills into', () => {
  const reg = boundLedRegistry('LED_X', 6, 200);
  const rec = computeLedStrandPatches(reg, { LED_X: 200 }).fields.get('LED_X');
  params.parLights = [];
  params.ledStrands = [{ name: 'LED_X', ...rec }];

  assert.deepEqual(deriveSubscribedUniverses([]), [6, 7],
    'both the start (U6) and spill (U7) universes must be subscribed');
});

test('G2: a legacy strand record with no segments falls back to the start universe', () => {
  params.parLights = [];
  params.ledStrands = [{ name: 'LED_OLD', dmxUniverse: 6, dmxAddress: 1 }]; // no segments
  assert.deepEqual(deriveSubscribedUniverses([]), [6],
    'legacy records (pre-projection) keep the start-universe-only behavior');
});

// ── G4 — spill-universe reservation ──────────────────────────────────────────

test('G4: LED claims + noteUniverseUsed reserve spill universes past U7', () => {
  const reg = boundLedRegistry('LED_X', 6, 200, /* nextUniverse */ 6);
  const bound = computeLedStrandPatches(reg, { LED_X: 200 }).fields;
  const claims = computeLedUniverseClaims(bound, new Map());

  // The claim map exposes BOTH the start and the spill universe.
  assert.deepEqual([...claims.keys()].sort((a, b) => a - b), [6, 7]);

  // Mutation-time reservation (mirrors recomputeAndMark): every claimed
  // universe bumps the high-water mark so a later addPort skips U7.
  for (const u of claims.keys()) noteUniverseUsed(reg, u);
  assert.ok(reg.nextUniverse >= 8, `nextUniverse must clear the U7 spill (got ${reg.nextUniverse})`);
  assert.equal(nextFreeUniverse(reg), 8, 'the next new port lands at U8, never re-meaning U7');
});

// ── G5 — UI span string ──────────────────────────────────────────────────────

test('G5: span string reads U6:1 → U7:288 for a spilling strand', () => {
  const reg = boundLedRegistry('LED_X', 6, 200);
  const rec = computeLedStrandPatches(reg, { LED_X: 200 }).fields.get('LED_X');
  assert.equal(ledStrandSpanText(rec.segments), 'U6:1 → U7:288');
});

test('G5: span string reads U6:1–160 for a single-universe strand', () => {
  const reg = boundLedRegistry('LED_S', 6, 40);
  const rec = computeLedStrandPatches(reg, { LED_S: 40 }).fields.get('LED_S');
  assert.equal(ledStrandSpanText(rec.segments), 'U6:1–160');
});

test('G5: span string is empty for no segments (unresolved)', () => {
  assert.equal(ledStrandSpanText([]), '');
  assert.equal(ledStrandSpanText(undefined), '');
});
