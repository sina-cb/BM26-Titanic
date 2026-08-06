/**
 * bench_mirror_resolve.test.js — ARM-time resolution of a v3 sidecar into the
 * internal mirror spec (lib/bench_mirror_resolve.cjs).
 *
 * This is where the "random colours with a green log" bug class dies. The
 * resolver turns SLOT DECLARATIONS into universes, addresses and slices by
 * reading live scene data, so:
 *   - a slot that cannot be resolved REFUSES by name and names the missing link,
 *   - a source whose channel map differs from the destination's REFUSES and
 *     names the rule that failed,
 *   - every DMX slice is exactly one whole fixture starting on both fixtures'
 *     own start addresses, by construction rather than by an author's arithmetic,
 *   - the computed mapping is re-validated against the same structural
 *     invariants a hand-authored one had to satisfy.
 *
 * Three tiers:
 *   1. PURE — synthetic scene trees, every refusal branch individually.
 *   2. BYTE-LEVEL — deterministic frames through the computed spec, asserting
 *      the exact destination bytes per slot.
 *   3. LIVE — the committed sidecar against the real scenes, the real fixture
 *      registry and the real generated engine models, plus the
 *      default-equivalence pin against the frozen v2 seven-slice table.
 *
 * ZERO PORTS, ZERO PACKETS. Everything here is pure computation over parsed
 * YAML; nothing constructs a socket.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');
const { parseBenchMirrorSpec, createMirrorState, spliceMirrorFrame, mirrorPayload,
  DMX_CHANNELS } = require('../lib/bench_mirror.cjs');
const { resolveBenchMirror, loadFixtureRegistry, checkCompatible, computeSlices,
  pixelLocations } = require('../lib/bench_mirror_resolve.cjs');

const SIM_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.join(SIM_ROOT, '..');
const FIXTURES_DIR = path.join(SIM_ROOT, 'dmx', 'fixtures');
const LIVE_REGISTRY = loadFixtureRegistry(FIXTURES_DIR);

// ── Tier 1: synthetic scenes, every refusal branch ─────────────────────────
//
// Addresses below are non-routable placeholders in this suite's established
// style (10.9.9.x), never hardware.

const REGISTRY = new Map([
  ['Par10', { footprint: 10, modelId: 'par10', file: 'synthetic' }],
  ['Bar20', { footprint: 20, modelId: 'bar20', file: 'synthetic' }],
  ['Sign8', { footprint: 32, modelId: 'sign8', file: 'synthetic' }],
]);

const LED_BLOCK = { baseUniverse: 0, startAddr: 1, order: 'RGBW', stride: 4, whiteMode: 'native' };

/** A tiny bench scene: one DMX par, one 4-px strand. */
function benchScene(over = {}) {
  return {
    controllers: {
      controllers: [
        { id: 1, name: 'Bench DMX', ip: '10.9.9.10', type: 'DMX',
          ports: [{ port: 1, universe: 2 }] },
        { id: 2, name: 'Bench LED', ip: '10.9.9.60', type: 'LED',
          ports: [{ port: 1, universe: 10, startAddress: 1, output: 1 }], led: { ...LED_BLOCK } },
      ],
    },
    patches: {
      patches: {
        'Bench Par': { controllerIp: '10.9.9.10', dmxUniverse: 2, dmxAddress: 41 },
        'Bench Strand': {
          controllerIp: '10.9.9.60', dmxUniverse: 10, dmxAddress: 1, pixelCount: 4,
          endUniverse: 10, endChannel: 16,
          segments: [{ universe: 10, startChannel: 1, endChannel: 16, pixelCount: 4 }],
        },
      },
    },
    sceneConfig: { parLights: { fixtures: [{ name: 'Bench Par', fixtureType: 'Par10' }] } },
    ...over,
  };
}

/** A tiny source scene: two DMX pars, one bar, one 10-px strand. */
function sourceScene(over = {}) {
  return {
    controllers: {
      controllers: [
        { id: 3, name: 'Ship DMX', ip: '10.9.9.11', type: 'DMX',
          ports: [{ port: 1, universe: 6 }] },
        { id: 4, name: 'Ship LED', ip: '10.9.9.61', type: 'LED',
          ports: [{ port: 1, universe: 30, startAddress: 1, output: 1 }], led: { ...LED_BLOCK } },
      ],
    },
    patches: {
      patches: {
        'Ship Par A': { controllerIp: '10.9.9.11', dmxUniverse: 6, dmxAddress: 1 },
        'Ship Par B': { controllerIp: '10.9.9.11', dmxUniverse: 6, dmxAddress: 11 },
        'Ship Bar': { controllerIp: '10.9.9.11', dmxUniverse: 6, dmxAddress: 21 },
        'Ship Rope': {
          controllerIp: '10.9.9.61', dmxUniverse: 30, dmxAddress: 1, pixelCount: 10,
          endUniverse: 30, endChannel: 40,
          segments: [{ universe: 30, startChannel: 1, endChannel: 40, pixelCount: 10 }],
        },
      },
    },
    sceneConfig: { parLights: { fixtures: [
      { name: 'Ship Par A', fixtureType: 'Par10' },
      { name: 'Ship Par B', fixtureType: 'Par10' },
      { name: 'Ship Bar', fixtureType: 'Bar20' },
    ] } },
    ...over,
  };
}

const SPEC = parseBenchMirrorSpec({
  version: 3, enabled: true, label: 'Synthetic bench',
  slots: [
    { slot: 'par_1', bench_fixture: 'Bench Par', default_source: 'Ship Par A' },
    { slot: 'led_0', bench_fixture: 'Bench Strand', default_source: 'Ship Rope' },
  ],
}, 'synthetic');

function resolve(over = {}) {
  return resolveBenchMirror({
    spec: SPEC,
    benchSceneName: 'test_bench',
    benchScene: benchScene(),
    sourceSceneName: 'titanic',
    sourceScene: sourceScene(),
    registry: REGISTRY,
    selection: null,
    ...over,
  });
}

test('resolve: the defaults path produces a complete, valid mapping', () => {
  const out = resolve();
  assert.equal(out.ok, true, out.refusal || '');
  assert.equal(out.slots.length, 2);
  assert.deepEqual(out.slots.map(s => s.source), ['Ship Par A', 'Ship Rope']);
  assert.equal(out.slots[0].kind, 'dmx');
  assert.equal(out.slots[1].kind, 'led_strand');
  assert.deepEqual(out.spec.mirrors.map(m => `${m.destUniverse}→${m.destHost}`),
    ['2→10.9.9.10', '10→10.9.9.60']);
  // The bench par is at 41 with footprint 10; the ship par at U6/1.
  assert.deepEqual(out.spec.mirrors[0].slices, [
    { sourceUniverse: 6, sourceAddr: 1, length: 10, destAddr: 41,
      note: 'Ship Par A (Par10, 10 ch)' },
  ]);
  // The strand is 4 px of a 10 px rope, RGBW×4 → 16 channels from px 1.
  assert.deepEqual(out.spec.mirrors[1].slices, [
    { sourceUniverse: 30, sourceAddr: 1, length: 16, destAddr: 1,
      note: 'Ship Rope px 1-4 (RGBW × 4)' },
  ]);
  assert.ok(out.warnings.some(w => /showing the first 4 of 'Ship Rope's 10 px/.test(w)));
});

test('resolve: candidates are filtered by profile identity, both directions', () => {
  const out = resolve();
  const par = out.slots[0];
  assert.deepEqual(par.candidates.map(c => c.name), ['Ship Par A', 'Ship Par B'],
    'only the same fixtureType may feed a DMX slot — the 20-ch bar must not appear');
  const led = out.slots[1];
  assert.deepEqual(led.candidates.map(c => c.name), ['Ship Rope']);
});

test('_155 R-16: every broken bench link refuses BY NAME', () => {
  const cases = [
    ['no patch entry', { patches: { patches: {} } }, /no patch entry named 'Bench Par'/],
    ['no controller port', {
      controllers: { controllers: [{ id: 1, name: 'X', ip: '10.9.9.10', type: 'DMX',
        ports: [{ port: 1, universe: 99 }] }] },
    }, /no controller in controllers\.yaml declares a port on U2/],
    ['no fixture definition', {
      sceneConfig: { parLights: { fixtures: [{ name: 'Bench Par', fixtureType: 'Nope' }] } },
    }, /no fixture definition for 'Nope'/],
    ['kind underivable', {
      sceneConfig: { parLights: { fixtures: [] } },
    }, /the kind of 'Bench Par' cannot be derived/],
  ];
  for (const [name, over, re] of cases) {
    const scene = { ...benchScene(), ...over };
    const out = resolve({ benchScene: scene });
    assert.equal(out.ok, false, `${name} must refuse`);
    assert.match(out.refusal, /ARM refused \[R-1[68]\]/);
    assert.match(out.refusal, re, name);
    assert.match(out.refusal, /The mirror maps only what the scene proves/);
  }
});

test('_155 R-16: an inconsistent LED patch record refuses rather than guessing', () => {
  const scene = benchScene();
  scene.patches.patches['Bench Strand'].pixelCount = 5;   // segments still span 4
  const out = resolve({ benchScene: scene });
  assert.equal(out.ok, false);
  assert.match(out.refusal, /declares pixelCount 5 but its segments span 4 px/);
});

test('_155 R-16: a controller with no usable led: block refuses', () => {
  const scene = benchScene();
  delete scene.controllers.controllers[1].led;
  const out = resolve({ benchScene: scene });
  assert.equal(out.ok, false);
  assert.match(out.refusal, /declares no usable `led:` block/);
});

test('_155 R-18: one fixture name with two fixtureTypes refuses — the bridge will not pick', () => {
  const scene = benchScene();
  scene.sceneConfig.parLights.fixtures.push({ name: 'Bench Par', fixtureType: 'Bar20' });
  const out = resolve({ benchScene: scene });
  assert.equal(out.ok, false);
  assert.match(out.refusal, /ARM refused \[R-18\]/);
  assert.match(out.refusal, /declared more than once .* with different fixtureTypes/);
});

test('_155 R-12: a selection naming an unknown slot refuses and lists the real ones', () => {
  const out = resolve({ selection: { par_1: 'Ship Par A', led_0: null, ghost: null } });
  assert.equal(out.ok, false);
  assert.match(out.refusal, /ARM refused \[R-12\]/);
  assert.match(out.refusal, /names slot 'ghost'/);
  assert.match(out.refusal, /Declared: par_1, led_0/);
});

test('_155 R-13: an incomplete selection refuses — `none` is a choice, absence is not', () => {
  const out = resolve({ selection: { par_1: 'Ship Par A' } });
  assert.equal(out.ok, false);
  assert.match(out.refusal, /ARM refused \[R-13\]/);
  assert.match(out.refusal, /missing slot\(s\) led_0/);
  assert.match(out.refusal, /'none' is a choice, absence is not/);
});

test('_155 R-14: a selection naming an unpatched source refuses', () => {
  const out = resolve({ selection: { par_1: 'Ship Par Z', led_0: null } });
  assert.equal(out.ok, false);
  assert.match(out.refusal, /ARM refused \[R-14\]/);
  assert.match(out.refusal, /names 'Ship Par Z', which the 'titanic' scene does not patch/);
});

test('_155 R-15: every compatibility rule refuses individually, naming the rule', () => {
  // fixtureType mismatch (a 20-ch bar into a 10-ch par slot).
  const t = resolve({ selection: { par_1: 'Ship Bar', led_0: null } });
  assert.equal(t.ok, false);
  assert.match(t.refusal, /ARM refused \[R-15\]/);
  assert.match(t.refusal, /profiles must be identical; the bridge does not translate channel maps/);
  assert.match(t.refusal, /\[rule: fixtureType\]/);

  // kind mismatch (a strand into a DMX slot).
  const k = resolve({ selection: { par_1: 'Ship Rope', led_0: null } });
  assert.equal(k.ok, false);
  assert.match(k.refusal, /\[rule: kind\]/);

  // pixel format mismatch.
  const src = sourceScene();
  src.controllers.controllers[1].led = { ...LED_BLOCK, order: 'GRBW' };
  const f = resolve({ sourceScene: src, selection: { par_1: 'Ship Par A', led_0: 'Ship Rope' } });
  assert.equal(f.ok, false);
  assert.match(f.refusal, /\[rule: pixelFormat\]/);
  assert.match(f.refusal, /pixel bytes are only copied between identical formats/);

  // a source SHORTER than its destination.
  const short = sourceScene();
  short.patches.patches['Ship Rope'].pixelCount = 2;
  short.patches.patches['Ship Rope'].segments = [
    { universe: 30, startChannel: 1, endChannel: 8, pixelCount: 2 }];
  const s = resolve({ sourceScene: short, selection: { par_1: 'Ship Par A', led_0: 'Ship Rope' } });
  assert.equal(s.ok, false);
  assert.match(s.refusal, /\[rule: pixelCount\]/);
  assert.match(s.refusal, /cannot be shorter than its destination/);
});

test('_155 §5.4: a typed LED fixture demands EXACT pixel count — a sign is a shape', () => {
  // Unit level first: the rule itself, in isolation. A plain strand may take a
  // longer source (prefix copy); a TYPED fixture may not, because a prefix of a
  // sign is scrambled content rather than a smaller sign.
  const sign = { kind: 'led_fixture', name: 'Bench Sign', fixtureType: 'Sign8',
    footprintCh: 32, pixelCount: 8, pixelFormat: { ...LED_BLOCK } };
  const longer = { kind: 'led_fixture', name: 'Ship Sign', fixtureType: 'Sign8',
    footprintCh: 48, pixelCount: 12, pixelFormat: { ...LED_BLOCK } };
  const v = checkCompatible(sign, longer);
  assert.equal(v.ok, false);
  assert.equal(v.rule, 'pixelCount');
  assert.match(v.why, /a typed LED fixture is a SHAPE/);
  assert.equal(checkCompatible(sign, { ...longer, pixelCount: 8, footprintCh: 32 }).ok, true,
    'the SAME pixel count resolves — the refusal is about the mismatch, not about typed LEDs');
  // A plain strand keeps the prefix allowance, warned.
  const strand = { kind: 'led_strand', name: 'Bench Strand', fixtureType: null,
    footprintCh: 32, pixelCount: 8, pixelFormat: { ...LED_BLOCK } };
  const strandSrc = { ...longer, kind: 'led_strand', fixtureType: null };
  const sv = checkCompatible(strand, strandSrc);
  assert.equal(sv.ok, true);
  assert.ok(sv.warnings.some(w => /showing the first 8 of 'Ship Sign's 12 px/.test(w)));
});

test('_155 §2: a typed LED fixture resolves end-to-end when both ends agree', () => {
  // `kind` derivation is the thing under test here: a name that has BOTH a
  // fixtureType and a pixelCount, on an LED controller, is a `led_fixture` —
  // not a strand, and not a DMX fixture.
  const bench = benchScene();
  bench.patches.patches['Bench Sign'] = {
    controllerIp: '10.9.9.60', dmxUniverse: 10, dmxAddress: 33, pixelCount: 8,
    segments: [{ universe: 10, startChannel: 33, endChannel: 64, pixelCount: 8 }],
  };
  bench.sceneConfig.parLights.fixtures.push({ name: 'Bench Sign', fixtureType: 'Sign8' });
  const src = sourceScene();
  src.patches.patches['Ship Sign'] = {
    controllerIp: '10.9.9.61', dmxUniverse: 30, dmxAddress: 101, pixelCount: 8,
    segments: [{ universe: 30, startChannel: 101, endChannel: 132, pixelCount: 8 }],
  };
  src.sceneConfig.parLights.fixtures.push({ name: 'Ship Sign', fixtureType: 'Sign8' });

  const spec = parseBenchMirrorSpec({
    version: 3, enabled: true, label: 'sign',
    slots: [{ slot: 'sign_a', bench_fixture: 'Bench Sign', default_source: 'Ship Sign' }],
  }, 'sign');
  const out = resolveBenchMirror({
    spec, benchSceneName: 'test_bench', benchScene: bench,
    sourceSceneName: 'titanic', sourceScene: src, registry: REGISTRY, selection: null,
  });
  assert.equal(out.ok, true, out.refusal || '');
  assert.equal(out.slots[0].kind, 'led_fixture');
  assert.deepEqual(out.spec.mirrors[0].slices, [
    { sourceUniverse: 30, sourceAddr: 101, length: 32, destAddr: 33,
      note: 'Ship Sign px 1-8 (RGBW × 4)' },
  ]);
});

test('_155 R-22b: a source scene with nothing compatible refuses, naming the scene', () => {
  const barren = sourceScene({
    patches: { patches: {} },
    sceneConfig: { parLights: { fixtures: [] } },
  });
  const out = resolve({ sourceScene: barren });
  assert.equal(out.ok, false);
  assert.match(out.refusal, /ARM refused \[R-22b\]/);
  assert.match(out.refusal, /'titanic' has no fixture compatible with ANY bench slot/);
});

test('_155 R-22c: a default that does not resolve in THIS scene refuses — never swaps in `none`', () => {
  const src = sourceScene();
  delete src.patches.patches['Ship Rope'];
  const out = resolve({ sourceScene: src });
  assert.equal(out.ok, false);
  assert.match(out.refusal, /ARM refused \[R-22c\]/);
  assert.match(out.refusal, /slot 'led_0' defaults to 'Ship Rope'/);
  assert.match(out.refusal, /the bridge will not substitute 'none' for you/);
  // …and the PICKER path still works: choosing explicitly is the way in.
  const picked = resolve({ sourceScene: src, selection: { par_1: 'Ship Par A', led_0: null } });
  assert.equal(picked.ok, true, picked.refusal || '');
  assert.equal(picked.slots[1].source, null);
});

test('_155 §6.1: a `none` slot keeps its destination, owned and composed dark', () => {
  const out = resolve({ selection: { par_1: null, led_0: null } });
  assert.equal(out.ok, true, out.refusal || '');
  assert.deepEqual(out.spec.mirrors.map(m => m.slices.length), [0, 0]);
  assert.deepEqual(out.spec.mirrors.map(m => `${m.destUniverse}→${m.destHost}`),
    ['2→10.9.9.10', '10→10.9.9.60'],
    'the destination is still OWNED — releasing it would let raw ship bytes light the bench');
  assert.equal(out.slots[0].summary, 'HELD DARK — composed as zeros');
});

test('_155 §6.3: one source feeding two slots is allowed and badged, not refused', () => {
  const bench = benchScene();
  bench.patches.patches['Bench Par 2'] = {
    controllerIp: '10.9.9.10', dmxUniverse: 2, dmxAddress: 61 };
  bench.sceneConfig.parLights.fixtures.push({ name: 'Bench Par 2', fixtureType: 'Par10' });
  const spec = parseBenchMirrorSpec({
    version: 3, enabled: true, label: 'fanout',
    slots: [
      { slot: 'a', bench_fixture: 'Bench Par', default_source: 'Ship Par A' },
      { slot: 'b', bench_fixture: 'Bench Par 2', default_source: 'Ship Par A' },
    ],
  }, 'fanout');
  const out = resolveBenchMirror({
    spec, benchSceneName: 'test_bench', benchScene: bench,
    sourceSceneName: 'titanic', sourceScene: sourceScene(), registry: REGISTRY, selection: null,
  });
  assert.equal(out.ok, true, out.refusal || '');
  assert.deepEqual(out.slots.map(s => s.fanout), [2, 2]);
  const slices = out.spec.mirrors[0].slices;
  assert.deepEqual(slices.map(s => [s.sourceAddr, s.destAddr]), [[1, 41], [1, 61]],
    'the same source lands on both destinations — dest pairs stay disjoint');
});

test('_155 R-19: an overlapping bench patch makes the COMPUTED mapping refuse', () => {
  const bench = benchScene();
  // A scene-authoring bug: two bench fixtures overlapping on U2.
  bench.patches.patches['Bench Par 2'] = {
    controllerIp: '10.9.9.10', dmxUniverse: 2, dmxAddress: 45 };
  bench.sceneConfig.parLights.fixtures.push({ name: 'Bench Par 2', fixtureType: 'Par10' });
  const spec = parseBenchMirrorSpec({
    version: 3, enabled: true, label: 'overlap',
    slots: [
      { slot: 'a', bench_fixture: 'Bench Par', default_source: 'Ship Par A' },
      { slot: 'b', bench_fixture: 'Bench Par 2', default_source: 'Ship Par B' },
    ],
  }, 'overlap');
  const out = resolveBenchMirror({
    spec, benchSceneName: 'test_bench', benchScene: bench,
    sourceSceneName: 'titanic', sourceScene: sourceScene(), registry: REGISTRY, selection: null,
  });
  assert.equal(out.ok, false);
  assert.match(out.refusal, /ARM refused \[R-19\]/);
  assert.match(out.refusal, /destination channel 45 of U2 is already written/);
  assert.match(out.refusal, /nothing was armed/);
});

test('resolve: a multi-universe strand produces one slice per contiguous run', () => {
  // Today both sides are 1:1, but the walk is in PIXEL space so a future strand
  // that spills across universes is handled by construction, not by luck.
  const dest = {
    kind: 'led_strand', pixelCount: 6, pixelFormat: { ...LED_BLOCK },
    patch: { segments: [
      { universe: 10, startChannel: 1, endChannel: 16, pixelCount: 4 },
      { universe: 11, startChannel: 1, endChannel: 8, pixelCount: 2 },
    ] },
    name: 'Bench Strand', universe: 10, addr: 1,
  };
  const src = {
    kind: 'led_strand', pixelCount: 8, pixelFormat: { ...LED_BLOCK }, name: 'Ship Rope',
    patch: { segments: [
      { universe: 30, startChannel: 497, endChannel: 512, pixelCount: 4 },
      { universe: 31, startChannel: 1, endChannel: 16, pixelCount: 4 },
    ] },
    universe: 30, addr: 497,
  };
  assert.equal(pixelLocations(dest.patch, 4).length, 6);
  assert.deepEqual(computeSlices(dest, src).map(s =>
    [s.sourceUniverse, s.sourceAddr, s.length, s.destUniverse, s.destAddr]), [
    [30, 497, 16, 10, 1],
    [31, 1, 8, 11, 1],
  ]);
});

test('checkCompatible warns (never refuses) on a led.wire difference', () => {
  const base = { kind: 'led_strand', pixelCount: 4, name: 'd',
    pixelFormat: { ...LED_BLOCK, wire: { foldAmber: true } } };
  const src = { kind: 'led_strand', pixelCount: 4, name: 'Ship Rope',
    pixelFormat: { ...LED_BLOCK, wire: null } };
  const v = checkCompatible(base, src);
  assert.equal(v.ok, true);
  assert.ok(v.warnings.some(w => /different led\.wire settings/.test(w)));
  assert.ok(v.warnings.some(w => /the mirrored bytes are identical either way/.test(w)));
});

// ── Tier 2: byte-level, per slot ──────────────────────────────────────────
//
// Deterministic looks pushed through the COMPUTED spec. These are PRE-Sender
// buffer assertions, so they are exact — and since report 20260805_170 (S-D1,
// raw DMX end-to-end) the SENDER is exact too, so the old "0 and 255 are the
// only constants a truth test may use" restriction (`_155` A5, forced by the
// wire's ×2.55 percent transform) is RETIRED. Mid-range levels are asserted
// below, per fixture family.

/** Build a payload of `value` over `length` channels starting at `addr`. */
const frame = (addr, length, fn) => {
  const p = {};
  for (let i = 0; i < length; i += 1) p[addr + i] = fn(i);
  return p;
};

test('byte level: each slot receives exactly its source fixture, at its own address', () => {
  const out = resolve();
  const state = createMirrorState(out.spec);

  // A per-channel-unique marker proves the offset, not just the value.
  spliceMirrorFrame(state, 6, frame(1, 20, (i) => (i + 1)));
  const dmx = mirrorPayload(state, '2→10.9.9.10');
  for (let i = 0; i < 10; i += 1) {
    assert.equal(dmx[41 + i], i + 1, `bench par channel ${41 + i} must carry source channel ${1 + i}`);
  }
  assert.equal(dmx[40], 0, 'the channel before the slot is untouched');
  assert.equal(dmx[51], 0, 'the channel after the slot is untouched');
  assert.equal(Object.keys(dmx).length, DMX_CHANNELS);
});

test('byte level: red / green / blue / white / black land unchanged, per constant', () => {
  const out = resolve();
  const state = createMirrorState(out.spec);
  // The four bench-par channels 2..5 in this synthetic profile stand in for
  // R/G/B/W.
  for (const [name, lane] of [['red', 1], ['green', 2], ['blue', 3], ['white', 4]]) {
    spliceMirrorFrame(state, 6, { 1: 255, [1 + lane]: 255 });
    const dmx = mirrorPayload(state, '2→10.9.9.10');
    assert.equal(dmx[41], 255, `${name}: master lands`);
    assert.equal(dmx[41 + lane], 255, `${name}: the colour lane lands at its own offset`);
    for (let i = 1; i <= 9; i += 1) {
      if (i === lane) continue;
      assert.equal(dmx[41 + i], 0, `${name}: every other lane is 0, never stale`);
    }
  }
  spliceMirrorFrame(state, 6, {});
  const black = mirrorPayload(state, '2→10.9.9.10');
  for (let i = 0; i < 10; i += 1) assert.equal(black[41 + i], 0, 'black is all-zero');
});

// The four mid-range levels the ×2.55 percent wire used to destroy: 32 left as
// 82, 64 as 163, 128 and 200 both as a saturated 255. Report 20260805_170.
const MID_LEVELS = [32, 64, 128, 200];

test('byte level [_170]: a PAR slot carries mid-range levels exactly, per lane', () => {
  const out = resolve();
  const state = createMirrorState(out.spec);
  for (const level of MID_LEVELS) {
    for (const [name, lane] of [['red', 1], ['green', 2], ['blue', 3], ['white', 4]]) {
      spliceMirrorFrame(state, 6, { 1: level, [1 + lane]: level });
      const dmx = mirrorPayload(state, '2→10.9.9.10');
      assert.equal(dmx[41], level, `${name} @${level}: master lands at its own level`);
      assert.equal(dmx[41 + lane], level, `${name} @${level}: the colour lane keeps its level`);
      for (let i = 1; i <= 9; i += 1) {
        if (i === lane) continue;
        assert.equal(dmx[41 + i], 0, `${name} @${level}: every other lane is 0, never stale`);
      }
    }
  }
  // A per-channel RAMP is the sharper test: 256 distinct levels across one
  // fixture, none of them collapsing into a neighbour.
  spliceMirrorFrame(state, 6, frame(1, 10, (i) => i * 25 + 5));
  const ramp = mirrorPayload(state, '2→10.9.9.10');
  for (let i = 0; i < 10; i += 1) {
    assert.equal(ramp[41 + i], i * 25 + 5, `ramp channel ${41 + i} keeps its own level`);
  }
});

test('byte level [_170]: a STRAND slot carries mid-range levels exactly, per pixel lane', () => {
  const out = resolve();
  const state = createMirrorState(out.spec);
  for (const level of MID_LEVELS) {
    // Pixel n lane L = level, offset by lane so no two lanes share a value.
    spliceMirrorFrame(state, 30, frame(1, 40, (i) => (level + (i % 4)) & 0xff));
    const led = mirrorPayload(state, '10→10.9.9.60');
    for (let px = 0; px < 4; px += 1) {
      for (let lane = 0; lane < 4; lane += 1) {
        assert.equal(led[1 + px * 4 + lane], (level + lane) & 0xff,
          `@${level}: bench pixel ${px + 1} lane ${lane} keeps its own level`);
      }
    }
  }
  // Every one of the 16 strand channels at a DIFFERENT level, all distinct.
  spliceMirrorFrame(state, 30, frame(1, 40, (i) => i * 6 + 3));
  const ramp = mirrorPayload(state, '10→10.9.9.60');
  for (let i = 0; i < 16; i += 1) {
    assert.equal(ramp[1 + i], i * 6 + 3, `strand channel ${1 + i} keeps its own level`);
  }
});

test('byte level: a strand slot copies whole RGBW pixels and drops the tail', () => {
  const out = resolve();
  const state = createMirrorState(out.spec);
  // 10 source pixels, RGBW, pixel n = (n, n, n, n). The bench strand takes 4.
  spliceMirrorFrame(state, 30, frame(1, 40, (i) => Math.floor(i / 4) + 1));
  const led = mirrorPayload(state, '10→10.9.9.60');
  for (let px = 0; px < 4; px += 1) {
    for (let lane = 0; lane < 4; lane += 1) {
      assert.equal(led[1 + px * 4 + lane], px + 1,
        `bench pixel ${px + 1} lane ${lane} must carry source pixel ${px + 1}`);
    }
  }
  assert.equal(led[17], 0, 'source pixel 5 is dropped — the strand is 4 px');
  // NATIVE WHITE is the decisive stride test: only every 4th channel is lit.
  spliceMirrorFrame(state, 30, frame(1, 40, (i) => (i % 4 === 3 ? 255 : 0)));
  const white = mirrorPayload(state, '10→10.9.9.60');
  assert.deepEqual([white[1], white[2], white[3], white[4]], [0, 0, 0, 255]);
  assert.deepEqual([white[5], white[6], white[7], white[8]], [0, 0, 0, 255]);
});

test('byte level: a `none` slot composes all zeros, and never carries the other slot\'s bytes', () => {
  const out = resolve({ selection: { par_1: 'Ship Par A', led_0: null } });
  const state = createMirrorState(out.spec);
  spliceMirrorFrame(state, 6, frame(1, 10, () => 255));
  spliceMirrorFrame(state, 30, frame(1, 40, () => 255));
  const led = mirrorPayload(state, '10→10.9.9.60');
  assert.ok(Object.values(led).every(v => v === 0), 'a held-dark slot stays dark under live traffic');
  const dmx = mirrorPayload(state, '2→10.9.9.10');
  assert.equal(dmx[41], 255, 'the mapped slot still works');
});

test('byte level: fan-out delivers byte-identical frames to both slots', () => {
  const bench = benchScene();
  bench.patches.patches['Bench Par 2'] = {
    controllerIp: '10.9.9.10', dmxUniverse: 2, dmxAddress: 61 };
  bench.sceneConfig.parLights.fixtures.push({ name: 'Bench Par 2', fixtureType: 'Par10' });
  const spec = parseBenchMirrorSpec({
    version: 3, enabled: true, label: 'fanout',
    slots: [
      { slot: 'a', bench_fixture: 'Bench Par', default_source: 'Ship Par A' },
      { slot: 'b', bench_fixture: 'Bench Par 2', default_source: 'Ship Par A' },
    ],
  }, 'fanout');
  const out = resolveBenchMirror({
    spec, benchSceneName: 'test_bench', benchScene: bench,
    sourceSceneName: 'titanic', sourceScene: sourceScene(), registry: REGISTRY, selection: null,
  });
  const state = createMirrorState(out.spec);
  spliceMirrorFrame(state, 6, frame(1, 10, (i) => i * 20));
  const dmx = mirrorPayload(state, '2→10.9.9.10');
  for (let i = 0; i < 10; i += 1) {
    assert.equal(dmx[41 + i], dmx[61 + i], `channel ${i} must be identical on both slots`);
  }
});

test('byte level: the chosen source is the one that lands (two candidates, distinct data)', () => {
  const a = resolve({ selection: { par_1: 'Ship Par A', led_0: null } });
  const b = resolve({ selection: { par_1: 'Ship Par B', led_0: null } });
  const sa = createMirrorState(a.spec);
  const sb = createMirrorState(b.spec);
  // Par A is at U6/1, Par B at U6/11. One frame, two different regions.
  const payload = { ...frame(1, 10, () => 11), ...frame(11, 10, () => 22) };
  spliceMirrorFrame(sa, 6, payload);
  spliceMirrorFrame(sb, 6, payload);
  assert.equal(mirrorPayload(sa, '2→10.9.9.10')[41], 11, 'choosing Par A brings Par A\'s bytes');
  assert.equal(mirrorPayload(sb, '2→10.9.9.10')[41], 22, 'choosing Par B brings Par B\'s bytes');
});

// ── Tier 3: the LIVE scenes ───────────────────────────────────────────────

function liveScene(name) {
  const dir = path.join(SIM_ROOT, 'scenes', name);
  return {
    controllers: yaml.load(fs.readFileSync(path.join(dir, 'controllers.yaml'), 'utf8')),
    patches: yaml.load(fs.readFileSync(path.join(dir, 'patches.yaml'), 'utf8')),
    sceneConfig: yaml.load(fs.readFileSync(path.join(dir, 'scene_config.yaml'), 'utf8')),
  };
}

function resolveLive(selection = null) {
  const spec = parseBenchMirrorSpec(yaml.load(fs.readFileSync(
    path.join(SIM_ROOT, 'scenes', 'test_bench', 'bench_mirror.yaml'), 'utf8')), 'live');
  return resolveBenchMirror({
    spec,
    benchSceneName: 'test_bench',
    benchScene: liveScene('test_bench'),
    sourceSceneName: 'titanic',
    sourceScene: liveScene('titanic'),
    registry: LIVE_REGISTRY,
    selection,
  });
}

test('live: the fixture registry loads one definition per type, with its channel count', () => {
  assert.equal(LIVE_REGISTRY.get('UkingPar').footprint, 10);
  assert.equal(LIVE_REGISTRY.get('VintageLed').footprint, 33);
  assert.equal(LIVE_REGISTRY.get('ShehdsBar').footprint, 119);
});

test('live: the committed sidecar resolves against the real scenes, every slot', () => {
  const out = resolveLive();
  assert.equal(out.ok, true, out.refusal || '');
  assert.equal(out.slots.length, 10);
  for (const slot of out.slots) {
    assert.ok(slot.source, `slot '${slot.slot}' must resolve its default source`);
    assert.ok(slot.candidates.some(c => c.name === slot.source),
      `slot '${slot.slot}': the default must be in its own candidate list`);
  }
});

test('live: every DMX slice is exactly ONE whole titanic fixture, both ends aligned', () => {
  // This is the invariant the `_89` live-map tests proved for a hand-authored
  // file. Now it is proved for the COMPUTED mapping, against the generated
  // engine model — the second, independent witness.
  const out = resolveLive();
  const model = readModelPatches('titanic');
  const bench = readModelPatches('test_bench');
  // DMX slots only. A strand's generated-model entries are PER PIXEL (footprint
  // 4 each), so a fixture-boundary walk is meaningless there; strands get their
  // own whole-pixel assertion below.
  const dmxDest = new Set(out.slots.filter(s => s.kind === 'dmx')
    .map(s => `${s.dest.universe}/${s.dest.addr}`));
  let checked = 0;
  for (const m of out.spec.mirrors) {
    for (const s of m.slices) {
      if (!dmxDest.has(`${m.destUniverse}/${s.destAddr}`)) continue;
      const src = model.find(f => f.universe === s.sourceUniverse && f.addr === s.sourceAddr);
      assert.ok(src,
        `no titanic fixture starts at U${s.sourceUniverse}/${s.sourceAddr} — the slice does not ` +
        'begin on a fixture boundary');
      assert.equal(src.footprint, s.length,
        `slice from U${s.sourceUniverse}/${s.sourceAddr} must be exactly '${src.name}' whole`);
      const dst = bench.find(f => f.universe === m.destUniverse && f.addr === s.destAddr);
      assert.ok(dst, `no bench fixture is addressed at U${m.destUniverse}/${s.destAddr}`);
      assert.equal(dst.footprint, src.footprint,
        `'${src.name}' (fp ${src.footprint}) would land on '${dst.name}' (fp ${dst.footprint})`);
      checked += 1;
    }
  }
  assert.equal(checked, 8, 'all eight DMX slices must be boundary-checked');
});

test('_154: every DMX slice lands on a bench fixture of the SAME fixtureType, not merely the same width', () => {
  // The old assertion compared FOOTPRINT only, so two different 33-channel
  // profiles would have passed a test whose name claimed otherwise (`_154` §7).
  const out = resolveLive();
  const benchTypes = sceneTypes('test_bench');
  const srcTypes = sceneTypes('titanic');
  const benchPatches = liveScene('test_bench').patches.patches;
  const srcPatches = liveScene('titanic').patches.patches;
  let checked = 0;
  for (const slot of out.slots) {
    if (slot.kind !== 'dmx') continue;
    const dstType = benchTypes.get(slot.benchFixture);
    const srcType = srcTypes.get(slot.source);
    assert.equal(srcType, dstType,
      `slot '${slot.slot}': '${slot.source}' is a ${srcType} but '${slot.benchFixture}' is a ` +
      `${dstType} — same width is NOT the same channel map`);
    assert.equal(LIVE_REGISTRY.get(dstType).footprint, slot.footprintCh);
    // …and both ends really are at the addresses the mapping used.
    assert.equal(benchPatches[slot.benchFixture].dmxAddress, slot.dest.addr);
    assert.ok(srcPatches[slot.source].dmxAddress > 0);
    checked += 1;
  }
  assert.equal(checked, 8, 'all eight DMX slots must be type-checked');
});

test('live: LED slices carry whole pixels of an identically-formatted strand', () => {
  const out = resolveLive();
  const benchPatches = liveScene('test_bench').patches.patches;
  for (const slot of out.slots) {
    if (slot.kind !== 'led_strand') continue;
    const patch = benchPatches[slot.benchFixture];
    const mirror = out.spec.mirrors.find(m => m.destUniverse === patch.dmxUniverse);
    const channels = mirror.slices.reduce((n, s) => n + s.length, 0);
    assert.equal(channels, patch.pixelCount * 4,
      `'${slot.benchFixture}' is ${patch.pixelCount} px RGBW; the mirror copies ${channels} ch`);
    for (const s of mirror.slices) {
      assert.equal(s.length % 4, 0, 'a strand slice is always a whole number of RGBW pixels');
      assert.equal(s.destAddr, patch.dmxAddress);
    }
  }
});

test('live: the picker offers only same-profile candidates, and offers plenty', () => {
  const out = resolveLive();
  const byId = new Map(out.slots.map(s => [s.slot, s]));
  // The ship carries 40 UkingPar, 16 VintageLed, 20 ShehdsBar, 8 strands.
  assert.ok(byId.get('par_1').candidates.length >= 40);
  assert.ok(byId.get('vintage_left').candidates.length >= 16);
  assert.ok(byId.get('bar_left').candidates.length >= 20);
  assert.ok(byId.get('led_0').candidates.length >= 8);
  const srcTypes = sceneTypes('titanic');
  for (const c of byId.get('bar_left').candidates) {
    assert.equal(srcTypes.get(c.name), 'ShehdsBar');
  }
});

// ── T-5: the default-equivalence pin ──────────────────────────────────────

/**
 * The FROZEN v2 seven-slice table. This is the "nothing moved" regression for
 * the v2→v3 migration: the computed default mapping must express the identical
 * channel→channel function.
 *
 * Every NUMBER here is frozen on purpose — that is the whole pin. The two HOSTS
 * are read from the live bench scene instead of written here, because this file
 * carries no controller address of its own (a test that hard-codes hardware
 * addresses rots against the scene and puts them in the repo twice). They are
 * identified structurally: the controller whose port carries U2 is the DMX
 * gateway, the one whose port carries U10 is the LED box.
 */
const benchControllers = liveScene('test_bench').controllers.controllers;
const hostOfUniverse = (u) => benchControllers.find(
  c => (c.ports || []).some(p => Number(p.universe) === u)).ip;
const V2_GATEWAY_HOST = hostOfUniverse(2);
const V2_LED_HOST = hostOfUniverse(10);

const FROZEN_V2_SLICES = [
  { destUniverse: 2, destHost: V2_GATEWAY_HOST, sourceUniverse: 6, sourceAddr: 1, length: 40, destAddr: 1 },
  { destUniverse: 2, destHost: V2_GATEWAY_HOST, sourceUniverse: 5, sourceAddr: 1, length: 33, destAddr: 41 },
  { destUniverse: 2, destHost: V2_GATEWAY_HOST, sourceUniverse: 5, sourceAddr: 34, length: 33, destAddr: 74 },
  { destUniverse: 2, destHost: V2_GATEWAY_HOST, sourceUniverse: 2, sourceAddr: 1, length: 119, destAddr: 107 },
  { destUniverse: 2, destHost: V2_GATEWAY_HOST, sourceUniverse: 2, sourceAddr: 120, length: 119, destAddr: 226 },
  { destUniverse: 10, destHost: V2_LED_HOST, sourceUniverse: 30, sourceAddr: 1, length: 80, destAddr: 1 },
  { destUniverse: 12, destHost: V2_LED_HOST, sourceUniverse: 31, sourceAddr: 1, length: 80, destAddr: 1 },
];

/** (destUniverse, destHost, destChannel) → (sourceUniverse, sourceChannel). */
function channelFunction(slices) {
  const map = new Map();
  for (const s of slices) {
    for (let i = 0; i < s.length; i += 1) {
      map.set(`${s.destUniverse}@${s.destHost}/${s.destAddr + i}`,
        `${s.sourceUniverse}/${s.sourceAddr + i}`);
    }
  }
  return map;
}

test('_155 T-5: the computed DEFAULT mapping is byte-identical to the frozen v2 table', () => {
  const out = resolveLive();
  assert.equal(out.ok, true, out.refusal || '');
  const computedSlices = [];
  for (const m of out.spec.mirrors) {
    for (const s of m.slices) {
      computedSlices.push({ destUniverse: m.destUniverse, destHost: m.destHost, ...s });
    }
  }
  const want = channelFunction(FROZEN_V2_SLICES);
  const got = channelFunction(computedSlices);
  assert.equal(got.size, want.size,
    `the computed mapping writes ${got.size} destination channels; v2 wrote ${want.size}`);
  for (const [dest, source] of want) {
    assert.equal(got.get(dest), source,
      `${dest} was fed by ${source} under v2 and by ${got.get(dest)} now — the migration MOVED a channel`);
  }
});

// ── Helpers shared by the live tier ───────────────────────────────────────

/** { fixtureName → fixtureType } from a scene's scene_config.yaml. */
function sceneTypes(name) {
  const cfg = liveScene(name).sceneConfig;
  const out = new Map();
  for (const group of Object.values(cfg.parLights || {})) {
    if (!Array.isArray(group)) continue;
    for (const f of group) {
      if (f && typeof f.name === 'string' && typeof f.fixtureType === 'string') {
        out.set(f.name, f.fixtureType);
      }
    }
  }
  return out;
}

/** { fixtureName, universe, addr, footprint } from a GENERATED engine model. */
function readModelPatches(modelName) {
  const src = fs.readFileSync(
    path.join(REPO_ROOT, 'marsin_engine', 'models', `${modelName}.js`), 'utf8');
  const out = new Map();
  for (const line of src.split('\n')) {
    const name = line.match(/name: '([^']+)'/);
    const patch = line.match(/patch: \{ universe: (\d+), addr: (\d+), footprint: (\d+)/);
    if (!name || !patch) continue;
    const base = name[1].replace(/ - .*$/, '');
    const key = `${base}@${patch[1]}/${patch[2]}`;
    if (!out.has(key)) {
      out.set(key, {
        name: base,
        universe: Number(patch[1]),
        addr: Number(patch[2]),
        footprint: Number(patch[3]),
      });
    }
  }
  return [...out.values()];
}
