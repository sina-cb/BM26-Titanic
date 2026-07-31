/**
 * halo_driven_color.test.js — a halo always carries its bulb's colour.
 *
 * Operator (2026-07-30, screenshot): "there's an extra halo around the par
 * lights that are red, but those pars are mapped patched and are good", then
 * "the red halo around the par in the auditorium which is patched still exists".
 *
 * The proposed mechanism was: the driven per-frame colour path writes
 * instanceColor on the BULB InstancedMesh only, so the HALO keeps its
 * construction-time colour. A live readonly probe of his running sim
 * (20260725_78) DISPROVED that — all 40 UkingPars, patched and unpatched,
 * reported bulb instanceColor === halo instanceColor at the same instant.
 * `_writePixelColor` writes bulb, halo and cone in one call.
 *
 * The red was real but not a colour-propagation bug (see the report): unpatched
 * entries are painted (1,0,0) by sacn_mapper's `paintUndrivenEntry` — an
 * explicit operator decision from 2026-06-12, "red, not black" — and the
 * patched auditorium pars were genuinely being driven orange-red by their live
 * frames. What changed is halo GEOMETRY: 20260725_73 made the DMX halo a rim
 * multiple of the drawn bulb and 20260725_75 unpinned it, so a par's halo went
 * from 0.98× its bulb (buried inside the can, invisible) to 2.12× at his
 * settings — the red was always there, the halo just became visible.
 *
 * These tests pin the invariant that made that diagnosis possible, so the
 * mechanism that was ruled out here can never quietly become true later.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(__dirname, '..', 'dmx', 'fixtures');

const FOG_TYPES = new Set(['TEFogMachine', 'ChauvetHaze4D']);

function makeCanvasStub() {
  return {
    width: 0,
    height: 0,
    getContext() {
      return {
        createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
        putImageData: () => {},
      };
    },
  };
}
globalThis.window = globalThis.window || globalThis;
globalThis.window._patchesActive = false;
globalThis.document = globalThis.document || { createElement: (tag) => (tag === 'canvas' ? makeCanvasStub() : {}) };

const { DmxFixtureRuntime } = await import('../src/fixtures/dmx_fixture_runtime.js');
const { params } = await import('../src/core/state.js');
const { initRegistry, getAllDefinitions } = await import('../src/dmx/fixture_definition_registry.js');
const { demapSacnToPixels } = await import('../src/dmx/sacn_mapper.js');
const { entryDisplayRgb } = await import('../src/core/rgbwau_blend.js');

function loadAllFixtureModels() {
  const models = {};
  for (const dir of fs.readdirSync(FIXTURE_DIR)) {
    const dirPath = path.join(FIXTURE_DIR, dir);
    if (!fs.statSync(dirPath).isDirectory()) continue;
    for (const file of fs.readdirSync(dirPath)) {
      if (!file.endsWith('.yaml')) continue;
      const parsed = yaml.load(fs.readFileSync(path.join(dirPath, file), 'utf8'));
      if (parsed && parsed.model && parsed.model.fixture_type) {
        models[parsed.model.fixture_type] = parsed.model;
      }
    }
  }
  return models;
}

// One instance's colour straight out of the InstancedMesh buffer — the exact
// bytes the GPU gets, per layer.
function instColor(mesh, i = 0) {
  if (!mesh || !mesh.instanceColor) return null;
  const a = mesh.instanceColor.array;
  return [a[i * 3], a[i * 3 + 1], a[i * 3 + 2]];
}

function layersMatch(f, i, label) {
  const bulb = instColor(f.bulbInst, i);
  const halo = instColor(f.haloInst, i);
  assert.ok(bulb, `${label}: bulb instanceColor must exist`);
  assert.ok(halo, `${label}: halo instanceColor must exist — a halo with no colour buffer ` +
    'renders its white material and cannot follow the fixture');
  assert.deepEqual(halo, bulb,
    `${label} pixel ${i}: the halo must carry the SAME colour as its bulb ` +
    `(bulb ${JSON.stringify(bulb)} vs halo ${JSON.stringify(halo)})`);
  return bulb;
}

function buildFixture(fixtureDef, extra = {}) {
  return new DmxFixtureRuntime({
    name: `${fixtureDef.fixtureType} test`,
    fixtureType: fixtureDef.fixtureType,
    color: '#ffaa44', x: 0, y: 2, z: 0, enabled: true, brightness: 100,
    ...extra,
  }, 0, new THREE.Scene(), [], 50, fixtureDef, null);
}

function everyClass() {
  return Object.values(getAllDefinitions())
    .filter((d) => !FOG_TYPES.has(d.fixtureType))
    .map((d) => buildFixture(d));
}

let saved;
before(() => {
  saved = {
    profile: params.lightingProfile,
    pixel: params.globalPixelScale,
    halo: params.globalHaloScale,
    brightness: params.simBrightness,
  };
  params.lightingProfile = 'full';
  params.globalPixelScale = 1.9; // his live settings
  params.globalHaloScale = 1.4;
  initRegistry(loadAllFixtureModels());
});
after(() => {
  params.lightingProfile = saved.profile;
  params.globalPixelScale = saved.pixel;
  params.globalHaloScale = saved.halo;
  params.simBrightness = saved.brightness;
});

// ── The invariant, per class, on every driven entry point ────────────────

test('DRIVEN: a live DMX frame paints bulb and halo the same colour, every class', () => {
  for (const f of everyClass()) {
    const label = f.fixtureDef.fixtureType;
    // Seeded at construction — both layers already agree before any frame.
    layersMatch(f, 0, `${label} (seed)`);

    // A frame that is dim and RED-dominant: exactly the auditorium par's live
    // content (dimmer 100, R 63, G 27, B 0) that the operator read as a bug.
    const frame = new Uint8Array(64);
    const ch = f.fixtureDef.pixels[0].channels || {};
    if (ch.dimmer) frame[ch.dimmer - 1] = 100;
    if (ch.red !== undefined) frame[ch.red - 1] = 63;
    if (ch.green !== undefined) frame[ch.green - 1] = 27;
    if (ch.blue !== undefined) frame[ch.blue - 1] = 0;
    if (ch.value !== undefined) frame[ch.value - 1] = 40;
    f.applyDmxFrame(frame);

    for (let i = 0; i < f.pixels.length; i++) layersMatch(f, i, `${label} (driven)`);
    f.destroy();
  }
});

test('DRIVEN: every colour entry point keeps the two layers in lockstep', () => {
  // setColor / setBulbColor / setPixelColorRGB are the three ways a pattern,
  // the sACN demap or the static preview can repaint a fixture.
  for (const f of everyClass()) {
    const label = f.fixtureDef.fixtureType;

    f.setColor(0.9, 0.1, 0.05);
    const a = layersMatch(f, 0, `${label} setColor`);

    f.setBulbColor(0.1, 0.8, 0.2);
    const b = layersMatch(f, 0, `${label} setBulbColor`);
    assert.notDeepEqual(a, b, `${label}: setBulbColor must actually have changed the colour`);

    f.setPixelColorRGB(0, 0.2, 0.2, 0.9);
    layersMatch(f, 0, `${label} setPixelColorRGB`);
    f.destroy();
  }
});

test('the undriven-red indicator reaches BOTH layers, not just the bulb', () => {
  // sacn_mapper.paintUndrivenEntry calls entry.apply(1, 0, 0), which lands on
  // setPixelColorRGB. "Unpatched fixtures keep whatever the unpatched treatment
  // intends" means CONSISTENT bulb + halo — the indicator must not paint half a
  // fixture. (Whether the indicator should be red at all is an operator ruling
  // from 2026-06-12, not a code question — see 20260725_78.)
  params.simBrightness = 1; // no preview scaling, so the assertion is exact
  for (const f of everyClass()) {
    const label = f.fixtureDef.fixtureType;
    f.setPixelColorRGB(0, 1, 0, 0); // the exact undriven-red paint
    const c = layersMatch(f, 0, `${label} undriven-red`);
    assert.ok(c[0] > 0 && c[1] === 0 && c[2] === 0,
      `${label}: the undriven indicator must be pure red on both layers, got ${JSON.stringify(c)}`);
    f.destroy();
  }
});

// ── The undriven indicator now obeys the operator's switch, on EVERY layer ──
//
// 20260725_81. The demap is wired to a real fixture through the same
// entry.apply closure the render list uses, so these assert the actual painted
// InstancedMesh buffers — bulb, halo — plus the dot layer's own decode. The
// operator's complaint was specifically the HALO: once _73/_75 grew the rim to
// 2.12× the bulb, the red reached well outside the housing and read as a ring.

function undrivenEntryFor(fixture) {
  // An unpatched entry wired exactly as the batch render list wires one: apply
  // lands on setPixelColorRGB, which writes bulb + halo + cone in one call.
  return {
    r: 0.8, g: 0.1, b: 0.9, w: 0, a: 0, u: 0,
    patch: null,
    channels: null,
    apply: (r, g, b) => fixture.setPixelColorRGB(0, r, g, b),
  };
}

test('TOGGLE OFF: an undriven fixture goes DARK on bulb, halo and dot alike', () => {
  params.simBrightness = 1; // no preview scaling, so the assertion is exact
  for (const f of everyClass()) {
    const label = f.fixtureDef.fixtureType;
    const entry = undrivenEntryFor(f);
    demapSacnToPixels([entry], { getFullFrame: () => null }, false);

    const c = layersMatch(f, 0, `${label} undriven, toggle OFF`);
    assert.deepEqual(c, [0, 0, 0],
      `${label}: with "Show Unpatched (Red)" off, an undriven fixture must render ` +
      `black on BOTH bulb and halo — got ${JSON.stringify(c)}. A red halo the ` +
      'operator cannot switch off is exactly the bug this closes.');

    // Layer 3: the scene-wide instanced dot / 2D map decode of the same entry.
    assert.deepEqual(entryDisplayRgb(entry, true, false), [0, 0, 0],
      `${label}: the dot layer must be dark too`);
    f.destroy();
  }
});

test('TOGGLE ON: the 2026-06-12 red diagnostic comes back, unchanged, on every layer', () => {
  params.simBrightness = 1;
  for (const f of everyClass()) {
    const label = f.fixtureDef.fixtureType;
    const entry = undrivenEntryFor(f);
    demapSacnToPixels([entry], { getFullFrame: () => null }, true);

    const c = layersMatch(f, 0, `${label} undriven, toggle ON`);
    assert.ok(c[0] > 0 && c[1] === 0 && c[2] === 0,
      `${label}: with the toggle on, the indicator must be pure red on both ` +
      `bulb and halo — got ${JSON.stringify(c)}`);
    assert.deepEqual(entry.r, 1, `${label}: the entry itself carries the red`);

    const [dr, dg, db] = entryDisplayRgb(entry, true, true);
    assert.ok(dr > 0 && dg === 0 && db === 0, `${label}: the dot layer is red too`);
    f.destroy();
  }
});

test('a live toggle flip repaints the halo, not just the bulb', () => {
  // The operator flips the switch with the sim running: the next demapped frame
  // must move BOTH layers, together, with no rebuild.
  params.simBrightness = 1;
  const f = buildFixture(getAllDefinitions().UkingPar);
  const entry = undrivenEntryFor(f);
  const router = { getFullFrame: () => null };

  demapSacnToPixels([entry], router, false);
  assert.deepEqual(layersMatch(f, 0, 'par OFF'), [0, 0, 0]);

  demapSacnToPixels([entry], router, true);
  const on = layersMatch(f, 0, 'par ON');
  assert.ok(on[0] > 0, 'flipping the toggle on repaints red immediately');

  demapSacnToPixels([entry], router, false);
  assert.deepEqual(layersMatch(f, 0, 'par OFF again'), [0, 0, 0],
    'and flipping it back off takes the halo with it');
  f.destroy();
});

// ── No cross-fixture bleed: driving the LEFT never lights the RIGHT ─────────
//
// 20260725_82. The operator: "the par light halos on the right side are being
// mapped, but they are not patched". One reading worth ruling out by test
// forever: patched-LEFT frame data leaking onto unpatched-RIGHT halo instances
// via shared indexing. It is not happening — and now it cannot start.

test('driving a patched fixture leaves an unpatched one black on BULB AND HALO', () => {
  params.simBrightness = 1;
  const def = getAllDefinitions().UkingPar;
  const left = buildFixture(def, { name: 'Left Auditorium 1' });
  const right = buildFixture(def, { name: 'Right Auditorium 1' });

  // The operator's real live frame on U6/U8: dimmer 100, R 47, G 0, B 0.
  const frame = new Uint8Array(512);
  frame[0] = 100;
  frame[2] = 47;
  const router = { getFullFrame: (u) => (u === 6 ? frame : null) };

  const leftEntry = {
    r: 0, g: 0, b: 0, w: 0, a: 0, u: 0,
    patch: { universe: 6, addr: 1, footprint: 10 },
    channels: { r: 3, g: 4, b: 5 },
    apply: (r, g, b) => left.setPixelColorRGB(0, r, g, b),
  };
  const rightEntry = {
    r: 0.8, g: 0.1, b: 0.9, w: 0, a: 0, u: 0,
    patch: null, channels: null,
    apply: (r, g, b) => right.setPixelColorRGB(0, r, g, b),
  };

  // Both entries in ONE list, the unpatched one AFTER the driven one — the
  // order the real render list uses, and the order a bleed would exploit.
  demapSacnToPixels([leftEntry, rightEntry], router, false);

  const litLeft = layersMatch(left, 0, 'LEFT driven');
  assert.ok(litLeft[0] > 0, 'the patched fixture takes its frame colour');

  const darkRight = layersMatch(right, 0, 'RIGHT unpatched');
  assert.deepEqual(darkRight, [0, 0, 0],
    'an unpatched fixture stays black on bulb AND halo while its neighbour is driven — ' +
    'no frame data reaches a fixture with no patch');

  left.destroy();
  right.destroy();
});

test('WRITER ORDER: a later visual sync cannot repaint an unpatched fixture', () => {
  // updateVisualsFromHitbox() runs after the demap on any geometry change and
  // repaints every pixel with the CONFIG colour — but only when nothing in the
  // scene is patched. With patches active (the show state) it must leave the
  // driven/undriven colours alone, or it would undo the undriven gate one frame
  // later and relight exactly the fixtures the operator says are not patched.
  params.simBrightness = 1;
  const savedPatches = window._patchesActive;
  const f = buildFixture(getAllDefinitions().UkingPar, { name: 'Right Front Wall 1', color: '#ffaa44' });
  const entry = {
    r: 0.8, g: 0.1, b: 0.9, w: 0, a: 0, u: 0,
    patch: null, channels: null,
    apply: (r, g, b) => f.setPixelColorRGB(0, r, g, b),
  };

  try {
    window._patchesActive = true;
    demapSacnToPixels([entry], { getFullFrame: () => null }, false);
    assert.deepEqual(layersMatch(f, 0, 'unpatched, gated'), [0, 0, 0]);

    f.updateVisualsFromHitbox();
    assert.deepEqual(layersMatch(f, 0, 'after visual sync'), [0, 0, 0],
      'the config colour must NOT be repainted over the gated black while patches are active');

    // Not vacuous: with NOTHING patched, the static preview legitimately paints
    // the config colour again (that is the all-unpatched direct mode).
    window._patchesActive = false;
    f.updateVisualsFromHitbox();
    const c = layersMatch(f, 0, 'all-unpatched direct mode');
    assert.ok(c[0] > 0, 'with no patches at all, the static config colour is the honest preview');
  } finally {
    window._patchesActive = savedPatches;
    f.destroy();
  }
});

test('PERF P0: driven recolouring stays on the instanced path with no new objects', () => {
  // The fix for this class of bug must never become "give the halo its own
  // mesh/material per fixture" — scene-graph object count is the known perf
  // cliff, and "High FPS is a must" still stands.
  const f = buildFixture(getAllDefinitions().UkingPar);
  const childrenBefore = f.group.children.length;
  const bulbMat = f.bulbInst.material;
  const haloMat = f.haloInst.material;

  for (let n = 0; n < 50; n++) f.setColor(n / 50, 0.5, 0.25);

  assert.equal(f.group.children.length, childrenBefore,
    'recolouring must not add scene-graph objects');
  assert.equal(f.bulbInst.material, bulbMat, 'the bulb material must be reused, not recreated');
  assert.equal(f.haloInst.material, haloMat, 'the halo material must be reused, not recreated');
  assert.ok(f.haloInst.isInstancedMesh, 'the halo must stay a single InstancedMesh');
  f.destroy();
});

test('the halo material stays WHITE so instanceColor is the only colour source', () => {
  // A tinted halo material would multiply into every instance and silently
  // decouple the rim from its bulb — the failure mode this file rules out.
  for (const f of everyClass()) {
    const c = f.haloInst.material.color;
    assert.ok(c.r === 1 && c.g === 1 && c.b === 1,
      `${f.fixtureDef.fixtureType}: halo material must stay white, got ${c.getHexString()}`);
    f.destroy();
  }
});
