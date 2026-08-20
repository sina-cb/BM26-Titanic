/**
 * local_halo_scale.test.js — the per-fixture LOCAL halo override.
 *
 * Operator (2026-07-30, resolving readiness item 24): *"Each fixture having a
 * local override sounds good for the halo, but an overall global halo too would
 * be nice — local is maybe a scale for the global?"*
 *
 * So a halo is THREE factors multiplied:
 *
 *     effective halo = (class base) × Global Halo Size × local haloScale
 *
 *   class base — LED bus: `params.ledHaloSize`, an absolute radius.
 *                DMX bus: the DRAWN bulb × `dmxHaloRimMultiple` (a rim).
 *   global     — `params.globalHaloScale`, the one scene-wide knob (20260725_75).
 *   local      — `config.haloScale` on the fixture, default 1.0.
 *
 * The rules pinned here: 1.0 (and absent) is a perfect no-op, so every scene
 * written before this property existed renders byte-identically; the local
 * factor composes multiplicatively on both buses; the DMX pitch ceiling is
 * applied AFTER the local multiplier, so a local override can never reopen the
 * smear hole; garbage fails loudly; and the value survives a config round-trip.
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

// The operator's live working point (measured in 20260725_75).
const HIS_PIXEL_SCALE = 1.9;
const HIS_HALO_SCALE = 1.4;

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
const { LedStrand } = await import('../src/fixtures/led_strand.js');
const {
  resolveLocalHaloScale, LOCAL_HALO_SCALE_MIN, LOCAL_HALO_SCALE_MAX,
  MAX_HALO_PITCH_MULTIPLE, dmxHaloRimMultiple, ledHaloRadius,
} = await import('../src/fixtures/led_halo.js');
const { params } = await import('../src/core/state.js');
const { initRegistry, getAllDefinitions } = await import('../src/dmx/fixture_definition_registry.js');

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

function instanceScale(mesh, index = 0) {
  const m = new THREE.Matrix4();
  mesh.getMatrixAt(index, m);
  const scale = new THREE.Vector3();
  m.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
  return scale.x;
}

function dmxConfig(fixtureDef, extra = {}) {
  return {
    name: `${fixtureDef.fixtureType} test`,
    fixtureType: fixtureDef.fixtureType,
    color: '#ffffff', x: 0, y: 2, z: 0, enabled: true, brightness: 100,
    ...extra,
  };
}

function buildDmx(fixtureDef, extra = {}) {
  return new DmxFixtureRuntime(
    dmxConfig(fixtureDef, extra), 0, new THREE.Scene(), [], 50, fixtureDef, null);
}

function strandConfig(extra = {}) {
  return {
    name: 'Probe strand', ledCount: 40, color: '#ffffff',
    startX: 0, startY: 3, startZ: 0, endX: 0, endY: 3, endZ: 11,
    ...extra,
  };
}

function buildStrand(extra = {}) {
  return new LedStrand(strandConfig(extra), 0, new THREE.Scene(), []);
}

// Every class that renders a halo, DMX + LED-bus + strand.
function buildAll(extra = {}) {
  const dmx = Object.values(getAllDefinitions())
    .filter((d) => !FOG_TYPES.has(d.fixtureType))
    .map((d) => buildDmx(d, extra));
  return { dmx, strands: [buildStrand(extra)] };
}

function haloRadii({ dmx, strands }) {
  return [
    ...dmx.map((f) => ({
      cls: `${f._isLed ? 'led-bus' : 'dmx'}:${f.fixtureDef.fixtureType}`,
      halo: instanceScale(f.haloInst, 0),
      bulb: instanceScale(f.bulbInst, 0),
    })),
    ...strands.map((f) => ({
      cls: 'strand', halo: instanceScale(f.haloInst, 0), bulb: instanceScale(f.bulbInst, 0),
    })),
  ];
}

function destroyAll({ dmx, strands }) {
  dmx.forEach((f) => f.destroy());
  strands.forEach((f) => f.destroy());
}

let saved;
before(() => {
  saved = {
    profile: params.lightingProfile,
    pixel: params.globalPixelScale,
    halo: params.globalHaloScale,
    ledPixel: params.ledPixelSize,
    ledHalo: params.ledHaloSize,
  };
  params.lightingProfile = 'full';
  params.ledPixelSize = 0.08;
  params.ledHaloSize = 0.14;
  params.globalPixelScale = HIS_PIXEL_SCALE;
  params.globalHaloScale = HIS_HALO_SCALE;
  initRegistry(loadAllFixtureModels());
});
after(() => {
  params.lightingProfile = saved.profile;
  params.globalPixelScale = saved.pixel;
  params.globalHaloScale = saved.halo;
  params.ledPixelSize = saved.ledPixel;
  params.ledHaloSize = saved.ledHalo;
});

// ── 1. The default is a perfect no-op ────────────────────────────────────

test('NO-OP: absent and 1.0 render identically — old scenes are untouched', () => {
  const absent = buildAll();                    // no haloScale key at all
  const explicit = buildAll({ haloScale: 1 });  // the seeded UI default
  const a = haloRadii(absent);
  const b = haloRadii(explicit);

  assert.ok(a.length >= 5, `expected the full fixture set, got ${a.length}`);
  for (let i = 0; i < a.length; i++) {
    assert.equal(a[i].cls, b[i].cls);
    assert.equal(a[i].halo, b[i].halo,
      `${a[i].cls}: haloScale 1.0 must be byte-identical to no haloScale at all`);
    assert.equal(a[i].bulb, b[i].bulb, `${a[i].cls}: the halo property must not touch the bulb`);
  }
  destroyAll(absent);
  destroyAll(explicit);
});

test('resolveLocalHaloScale: absent is 1.0, garbage throws, the range is stated', () => {
  assert.equal(resolveLocalHaloScale(null), 1);
  assert.equal(resolveLocalHaloScale({}), 1);
  assert.equal(resolveLocalHaloScale({ haloScale: undefined }), 1);
  assert.equal(resolveLocalHaloScale({ haloScale: null }), 1);
  assert.equal(resolveLocalHaloScale({ haloScale: 2.5 }), 2.5);
  assert.equal(resolveLocalHaloScale({ haloScale: '3' }), 3, 'a YAML-quoted number is still a number');

  // Present but broken ⇒ LOUD, never a silent 1 (codex P0).
  for (const bad of [0, -1, NaN, Infinity, 'wide', {}]) {
    assert.throws(() => resolveLocalHaloScale({ haloScale: bad }, 'Left Front Rails 1'),
      /haloScale/, `haloScale ${JSON.stringify(bad)} must fail loudly`);
  }
  // The error names the fixture so a broken scene is findable.
  assert.throws(() => resolveLocalHaloScale({ haloScale: -2 }, 'Left Front Rails 1'),
    /Left Front Rails 1/);

  assert.ok(LOCAL_HALO_SCALE_MIN > 0 && LOCAL_HALO_SCALE_MAX > LOCAL_HALO_SCALE_MIN);
});

// ── 2. Composition, per bus ──────────────────────────────────────────────

test('COMPOSITION: local scales the halo on every bus, and only the halo', () => {
  const LOCAL = 2;
  const base = buildAll();
  const scaled = buildAll({ haloScale: LOCAL });
  const a = haloRadii(base);
  const b = haloRadii(scaled);

  for (let i = 0; i < a.length; i++) {
    assert.equal(a[i].cls, b[i].cls);
    // The vintage/bar CAN cap (exact arithmetic is checked per bus below), so
    // here the rule is only "it moved, upward, on every class".
    assert.ok(b[i].halo > a[i].halo,
      `${a[i].cls}: local halo scale ${LOCAL} changed nothing (${a[i].halo} → ${b[i].halo})`);
    assert.equal(a[i].bulb, b[i].bulb, `${a[i].cls}: the local HALO scale moved the bulb`);
  }
  destroyAll(base);
  destroyAll(scaled);
});

test('COMPOSITION (DMX): halo = drawn bulb x rim(global) x local, exactly', () => {
  // The par is single-pixel ⇒ no ceiling ⇒ the arithmetic is visible undiluted.
  for (const local of [0.5, 1, 3]) {
    const f = buildDmx(getAllDefinitions().UkingPar, { haloScale: local });
    const bulb = instanceScale(f.bulbInst, 0);
    const expected = bulb * dmxHaloRimMultiple(HIS_HALO_SCALE) * local;
    assert.ok(Math.abs(instanceScale(f.haloInst, 0) - expected) < 1e-5,
      `par halo at local ${local} must be ${expected}`);
    f.destroy();
  }
});

test('COMPOSITION (LED bus + strand): halo = ledHaloSize x global x local, exactly', () => {
  for (const local of [0.5, 1, 3]) {
    const sign = buildDmx(getAllDefinitions().TeSignV3A40, { haloScale: local });
    const expected = ledHaloRadius(HIS_HALO_SCALE) * local;
    assert.ok(Math.abs(instanceScale(sign.haloInst, 0) - expected) < 1e-5,
      `TE Sign halo at local ${local} must be ${expected}`);
    sign.destroy();

    const strand = buildStrand({ haloScale: local });
    assert.ok(Math.abs(instanceScale(strand.haloInst, 0) - expected) < 1e-5,
      `strand halo at local ${local} must be the same ${expected} — one shared LED recipe`);
    strand.destroy();
  }
});

test('the three factors are independent — global and local multiply', () => {
  const f = buildDmx(getAllDefinitions().UkingPar, { haloScale: 2 });
  const bulb = instanceScale(f.bulbInst, 0);
  for (const global of [0.5, 1.4, 4]) {
    f.updateScales(params.globalPixelScale, global);
    assert.ok(Math.abs(instanceScale(f.haloInst, 0) - bulb * dmxHaloRimMultiple(global) * 2) < 1e-5,
      `global ${global} × local 2 must compose`);
  }
  f.updateScales(params.globalPixelScale, HIS_HALO_SCALE);
  f.destroy();
});

// ── 3. The ceiling is applied AFTER the local multiplier ─────────────────

test('CEILING: a big local override cannot reopen the smear hole on a dense fixture', () => {
  // The bar is the densest shipped fixture (18 LEDs, 0.055 pitch). A local
  // override of 10 — the top of the UI range — must still land under the halo
  // pitch ceiling, i.e. the clamp runs after the multiply, not before.
  for (const type of ['ShehdsBar', 'VintageLed']) {
    const f = buildDmx(getAllDefinitions()[type], { haloScale: LOCAL_HALO_SCALE_MAX });
    const ceiling = f._minPixelPitch * MAX_HALO_PITCH_MULTIPLE;
    assert.ok(f._minPixelPitch > 0, `${type} must measure a pitch`);
    for (let i = 0; i < f.pixels.length; i++) {
      assert.ok(instanceScale(f.haloInst, i) <= ceiling * (1 + 1e-6),
        `${type} pixel ${i} halo escaped the ceiling under a ${LOCAL_HALO_SCALE_MAX}× local override`);
    }
    // ...and it IS at the ceiling — the override pushed it there rather than
    // being ignored.
    assert.ok(Math.abs(instanceScale(f.haloInst, 0) - ceiling) < 1e-6,
      `${type} should be pinned AT its ceiling under a ${LOCAL_HALO_SCALE_MAX}× override`);
    f.destroy();
  }
});

test('a local override still moves a dense fixture below its ceiling', () => {
  // The cap must not swallow the whole control: at his own settings a modest
  // local override on the vintage light still changes the drawn radius.
  const one = buildDmx(getAllDefinitions().VintageLed);
  const more = buildDmx(getAllDefinitions().VintageLed, { haloScale: 1.3 });
  const a = instanceScale(one.haloInst, 0);
  const b = instanceScale(more.haloInst, 0);
  assert.ok(b > a * 1.05, `a 1.3× local override must be visible (${a} → ${b})`);
  assert.ok(b <= one._minPixelPitch * MAX_HALO_PITCH_MULTIPLE * (1 + 1e-6));
  one.destroy();
  more.destroy();
});

// ── 4. Live update path, per class ───────────────────────────────────────

test('LIVE: editing the local scale on a live fixture takes effect with no rebuild', () => {
  // The GUI writes config.haloScale then calls syncLightFromConfig(index) →
  // fixture.syncFromConfig(). For a strand it calls applyVisualSize(). Both
  // must re-read the local scale on the SAME fixture instance.
  const defs = getAllDefinitions();
  const dmx = Object.values(defs).filter((d) => !FOG_TYPES.has(d.fixtureType)).map((d) => buildDmx(d));
  const strand = buildStrand();

  const before = [...dmx.map((f) => instanceScale(f.haloInst, 0)), instanceScale(strand.haloInst, 0)];

  dmx.forEach((f) => { f.config.haloScale = 2.5; f.syncFromConfig(); });
  strand.config.haloScale = 2.5;
  strand.applyVisualSize();

  const after = [...dmx.map((f) => instanceScale(f.haloInst, 0)), instanceScale(strand.haloInst, 0)];
  const names = [...dmx.map((f) => f.fixtureDef.fixtureType), 'strand'];
  for (let i = 0; i < before.length; i++) {
    assert.ok(after[i] > before[i],
      `${names[i]}: a live local-halo edit did not reach the instance matrices ` +
      `(${before[i]} → ${after[i]})`);
  }
  dmx.forEach((f) => f.destroy());
  strand.destroy();
});

// ── 5. Persistence round-trip (in memory — no scene is ever written) ─────

test('PERSISTENCE: the local scale round-trips through the fixture config', () => {
  // The property lives on the fixture config object, which IS what the scene
  // serializer writes and reads back. Round-trip it through YAML in memory —
  // no file is touched — and rebuild from the deserialized config.
  const def = getAllDefinitions().VintageLed;
  const original = dmxConfig(def, { haloScale: 1.75 });
  const roundTripped = yaml.load(yaml.dump(original));
  assert.equal(roundTripped.haloScale, 1.75, 'haloScale must survive serialize/deserialize');

  const a = buildDmx(def, { haloScale: 1.75 });
  const b = new DmxFixtureRuntime(roundTripped, 0, new THREE.Scene(), [], 50, def, null);
  assert.equal(instanceScale(b.haloInst, 0), instanceScale(a.haloInst, 0),
    'a fixture rebuilt from the persisted config must draw the same halo');
  a.destroy();
  b.destroy();

  // A strand config round-trips the same way.
  const s = yaml.load(yaml.dump(strandConfig({ haloScale: 0.4 })));
  assert.equal(s.haloScale, 0.4);
  const strand = new LedStrand(s, 0, new THREE.Scene(), []);
  assert.ok(Math.abs(instanceScale(strand.haloInst, 0) - ledHaloRadius(HIS_HALO_SCALE) * 0.4) < 1e-6);
  strand.destroy();
});
