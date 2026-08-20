/**
 * pixel_order_composition.test.js — the §4 COMBINATION MATRIX of design report
 * 20260806_174, empirically, with BOTH mechanisms in one tree (slice 3).
 *
 * Slice 1 (`_175`) proved Mechanism A alone; slice 2 (`_176`) proved Mechanism B
 * alone and the STRUCTURAL half of the no-double-apply claim (the resolver
 * contains no code path that could read a scene's pixel-order store). What was
 * left open, and is closed here, is the EMPIRICAL half: run one identifiable
 * colour ramp through the whole chain with every combination of the two
 * mechanisms switched on and off, and read the bytes that land on the bench.
 *
 * THE CHAIN THIS FILE MODELS, end to end:
 *
 *   pattern colour c(j) at MODEL slot j
 *     → Mechanism A on the SOURCE fixture (`S_src`): the exported engine model
 *       puts model slot j's channel block at DEFINITION block S_src(j), so
 *       source WIRE block m carries c(S_src(m)) — applied exactly ONCE, upstream
 *       of the wire, by `pixelblaze_model_exporter.js`.
 *     → the engine emits those bytes on the source universe (emulated here by
 *       writing the exported model's own channel numbers).
 *     → Mechanism B (`M`): the bridge copies WIRE→WIRE, dest wire block k :=
 *       source wire block M(k), through the REAL `computeSlices` /
 *       `createMirrorState` / `mirrorPayload`.
 *     → the bench fixture's wire.
 *
 * So the assertion, for every row: dest wire block k carries c((S_src ∘ M)(k)),
 * lane for lane, with the fixture's CONTROL channels identity-copied.
 *
 * And `S_dst` — Mechanism A on the BENCH fixture — must not appear anywhere in
 * that chain: it is baked into the bench scene's exported model, which the
 * mirrored path never traverses (while armed the engine runs the SOURCE scene
 * and the bridge writes raw composed frames). Rows 5-8 are that proof: flip the
 * bench scene's `pixelOrder`, re-resolve, re-compose, and the composed payload
 * must be BYTE-IDENTICAL to its S_dst=NORMAL twin. Byte-identity is what
 * "no double apply" means — an equality that would break the instant either
 * mechanism gained a second application point.
 *
 * TWO FIXTURE TYPES, deliberately: ShehdsBar (18 contiguous 6-channel pixel
 * blocks after 11 control channels) and VintageLed (six heads on NON-CONTIGUOUS
 * lanes, `value` 3..8 and `rgb` 16..33, with controls at 1,2 and 9..15). The
 * second is the one a naive footprint-wide byte reversal gets wrong.
 *
 * ZERO PORTS, ZERO PACKETS, ZERO WRITES: the scene trees are read from disk and
 * the bench scene's flag is injected IN MEMORY only. Nothing here opens a
 * socket, spawns a process or writes a file.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import * as THREE from 'three';

import { params } from '../src/core/state.js';
import { generatePixelMap } from '../src/dmx/pixelblaze_model_exporter.js';
import { initRegistry } from '../src/dmx/fixture_definition_registry.js';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');
const { parseBenchMirrorSpec, createMirrorState, spliceMirrorFrame,
  mirrorPayload } = require('../lib/bench_mirror.cjs');
const { resolveBenchMirror, loadFixtureRegistry } = require('../lib/bench_mirror_resolve.cjs');

const SIM_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES_DIR = path.join(SIM_ROOT, 'dmx', 'fixtures');
const REGISTRY = loadFixtureRegistry(FIXTURES_DIR);

/** The scene trees, read fresh so a mutation in one test cannot leak into another. */
function liveScene(name) {
  const dir = path.join(SIM_ROOT, 'scenes', name);
  return {
    controllers: yaml.load(fs.readFileSync(path.join(dir, 'controllers.yaml'), 'utf8')),
    patches: yaml.load(fs.readFileSync(path.join(dir, 'patches.yaml'), 'utf8')),
    sceneConfig: yaml.load(fs.readFileSync(path.join(dir, 'scene_config.yaml'), 'utf8')),
  };
}

const SPEC = parseBenchMirrorSpec(yaml.load(fs.readFileSync(
  path.join(SIM_ROOT, 'scenes', 'test_bench', 'bench_mirror.yaml'), 'utf8')), 'composition');

/** The raw `model:` block of a fixture definition, by fixture type. */
function definitionModel(fixtureType) {
  for (const family of fs.readdirSync(FIXTURES_DIR, { withFileTypes: true })) {
    if (!family.isDirectory()) continue;
    const dir = path.join(FIXTURES_DIR, family.name);
    for (const file of fs.readdirSync(dir)) {
      if (!/^model_.*\.ya?ml$/.test(file)) continue;
      const tree = yaml.load(fs.readFileSync(path.join(dir, file), 'utf8'));
      if (tree && tree.model && tree.model.fixture_type === fixtureType) return tree.model;
    }
  }
  throw new Error(`no fixture definition declares fixture_type '${fixtureType}'`);
}

// ── Mechanism A: the REAL exporter, on a fixture that mirrors the ship's ───
//
// The synthetic runtime below feeds `generatePixelMap` the SAME definition the
// resolver reads (one source of truth, `definitionModel`) at the SAME patch the
// scene declares, so the channel numbers it emits are the ship's real ones.

function makeGroup() {
  const g = new THREE.Group();
  g.updateMatrixWorld(true);
  return g;
}

function resetWorld() {
  globalThis.window = globalThis.window || {};
  window._isRebuildingFixtures = false;
  window.parFixtures = [];
  window.dmxSceneFixtures = [];
  window.ledStrandFixtures = [];
  window.__controllerRegistry = null;
  window.__viewRegistry = null;
  window.__activeScene = null;
  window._missingFixtureWarnCount = 0;
  window.serverConfig = { save_port: 6970 };
  params.dmxFixtures = [];
  params.parLights = [];
  params.ledStrands = [];
  params.pixelOrder = undefined;
}

/**
 * Export ONE source fixture's model with `S_src` applied, and return its pixels
 * in model-slot order with the channel numbers the engine will actually drive.
 *
 * @param {{name:string, fixtureType:string, universe:number, addr:number}} fixture
 * @param {boolean} reversed the scene-level Mechanism A flag
 * @returns {Array<{localIndex:number, channels:Object<string,number>}>}
 */
function exportSourceModel(fixture, reversed) {
  const model = definitionModel(fixture.fixtureType);
  resetWorld();
  initRegistry({ [fixture.fixtureType]: model });
  const cfg = { name: fixture.name, type: fixture.fixtureType, group: 'Source', fixtureId: 1,
    dmxUniverse: fixture.universe, dmxAddress: fixture.addr };
  params.dmxFixtures = [cfg];
  window.parFixtures = [{
    config: cfg,
    group: makeGroup(),
    fixtureDef: { fixtureType: fixture.fixtureType, footprint: model.channel_mode },
    pixels: model.pixels.map((p, k) => ({
      localPos: new THREE.Vector3(k * 0.05, 0, 0),
      model: { id: p.id, size: p.size || 14, channels: p.channels },
    })),
    setPixelColorRGB() {},
  }];
  if (reversed) params.pixelOrder = { [fixture.name]: 'reversed' };
  const pixels = generatePixelMap().pixels;
  assert.equal(pixels.length, model.pixels.length,
    `the exported ${fixture.name} must carry one pixel per definition pixel`);
  return pixels.map((p) => ({ localIndex: p.localIndex, channels: { ...p.channels } }));
}

// ── The definition's WIRE blocks, and the lane index inside one ────────────
//
// Everything below is expressed in CHANNEL NUMBERS rather than role names, so
// the assertions do not depend on the exporter's short-key spelling (`violet` →
// `u`, `value` → `w`) agreeing with the definition's long one. A lane is
// identified by its POSITION in the block's ascending channel list, which makes
// "lane L must come from lane L" checkable on both sides of the mirror.

/** `{blocks: number[][], laneOf: Map<ch,{block,lane}>, controls: number[]}` */
function wireBlocks(fixtureType) {
  const entry = REGISTRY.get(fixtureType);
  assert.ok(entry && entry.pixels, `${fixtureType} must have a provable per-pixel channel map`);
  const blocks = entry.pixels.map((p) => Object.values(p.channels).sort((a, b) => a - b));
  const laneOf = new Map();
  blocks.forEach((chs, block) => chs.forEach((ch, lane) => laneOf.set(ch, { block, lane })));
  const controls = [];
  for (let c = 1; c <= entry.footprint; c += 1) if (!laneOf.has(c)) controls.push(c);
  return { blocks, laneOf, controls, footprint: entry.footprint };
}

/**
 * The identifiable ramp. Every (model slot, lane) pair gets a distinct byte, and
 * every control channel gets a distinct byte from a disjoint range, so a
 * mis-permutation cannot be mistaken for a coincidence.
 */
const rampByte = (slot, lane) => slot + 1 + lane * 20;
const controlByte = (ch) => 200 + ch;

// ── The resolver + composer: Mechanism B, wire → wire ─────────────────────

/**
 * Resolve the committed sidecar with its own defaults, flipping exactly `slot`
 * to REVERSED when asked, against a bench scene that optionally carries the
 * Mechanism A flag `S_dst` on its own fixture.
 */
function resolve({ slot, mirrorReverse, destFlagged, benchFixture }) {
  const benchScene = liveScene('test_bench');
  assert.equal(benchScene.sceneConfig.pixelOrder, undefined,
    'the committed test_bench scene must carry no pixel-order store — this test injects one');
  if (destFlagged) benchScene.sceneConfig.pixelOrder = { [benchFixture]: 'reversed' };
  const selection = Object.fromEntries(SPEC.slots.map((s) => [s.slot, {
    source: s.defaultSource,
    reverse: s.slot === slot ? mirrorReverse : false,
  }]));
  const out = resolveBenchMirror({
    spec: SPEC,
    benchSceneName: 'test_bench',
    benchScene,
    sourceSceneName: 'titanic',
    sourceScene: liveScene('titanic'),
    registry: REGISTRY,
    selection,
  });
  assert.equal(out.ok, true, out.refusal || '');
  return out;
}

/**
 * Push one source fixture's exported frame through the real mirror and return
 * the composed payload for the bench fixture's universe.
 */
function compose(resolution, source, sourcePayload, benchPatch) {
  const state = createMirrorState(resolution.spec);
  spliceMirrorFrame(state, source.universe, sourcePayload);
  return mirrorPayload(state, `${benchPatch.dmxUniverse}→${benchPatch.controllerIp}`);
}

// ── The cases ─────────────────────────────────────────────────────────────

const CASES = [
  {
    slot: 'bar_left',
    benchFixture: 'Bar Left',
    sourceFixture: 'Left Front Wall 1',
    fixtureType: 'ShehdsBar',
    pixelCount: 18,
  },
  {
    slot: 'vintage_left',
    benchFixture: 'Vintage Left',
    sourceFixture: 'Left Front Rails 1',
    fixtureType: 'VintageLed',
    pixelCount: 6,
  },
];

for (const c of CASES) {
  const titanicPatches = liveScene('titanic').patches.patches;
  const benchPatches = liveScene('test_bench').patches.patches;
  const srcPatch = titanicPatches[c.sourceFixture];
  const benchPatch = benchPatches[c.benchFixture];
  const source = { name: c.sourceFixture, fixtureType: c.fixtureType,
    universe: srcPatch.dmxUniverse, addr: srcPatch.dmxAddress };
  const wire = wireBlocks(c.fixtureType);
  const N = c.pixelCount;
  const R = (k) => N - 1 - k;

  /**
   * The source universe's payload after Mechanism A and the pattern: model slot
   * j's ramp bytes land on whichever channel block the EXPORTER gave slot j.
   */
  function sourceFrame(sSrc) {
    const exported = exportSourceModel(source, sSrc);
    const payload = {};
    exported.forEach((px, j) => {
      const chs = Object.values(px.channels).sort((a, b) => a - b);
      // The exporter's permutation, restated as an assertion rather than assumed:
      // slot j must carry DEFINITION block S_src(j), whole.
      assert.deepEqual(chs, wire.blocks[sSrc ? R(j) : j],
        `${c.sourceFixture} model slot ${j} must drive definition block ` +
        `${sSrc ? R(j) : j} — the wire association is the only thing Mechanism A moves`);
      chs.forEach((ch, lane) => { payload[source.addr + ch - 1] = rampByte(j, lane); });
    });
    for (const ch of wire.controls) payload[source.addr + ch - 1] = controlByte(ch);
    return payload;
  }

  // Cache the two source frames: they depend only on S_src.
  const FRAME = { false: sourceFrame(false), true: sourceFrame(true) };

  for (const sSrc of [false, true]) {
    for (const m of [false, true]) {
      for (const sDst of [false, true]) {
        const row = `S_src=${sSrc ? 'R' : 'N'} M=${m ? 'R' : 'N'} S_dst=${sDst ? 'R' : 'N'}`;
        test(`_177 §4 matrix [${c.fixtureType}] ${row}: dest block k carries c((S_src∘M)(k))`,
          () => {
            const out = resolve({ slot: c.slot, mirrorReverse: m, destFlagged: sDst,
              benchFixture: c.benchFixture });
            const composed = compose(out, source, FRAME[sSrc], benchPatch);

            for (let k = 0; k < N; k += 1) {
              // The composition equation, evaluated: M first (wire → wire),
              // then S_src (already baked into the source wire).
              const mk = m ? R(k) : k;
              const expectedSlot = sSrc ? R(mk) : mk;
              wire.blocks[k].forEach((ch, lane) => {
                assert.equal(composed[benchPatch.dmxAddress + ch - 1],
                  rampByte(expectedSlot, lane),
                  `${row}: bench wire block ${k} lane ${lane} must carry model slot ` +
                  `${expectedSlot}'s same lane`);
              });
            }
            // The fixture's shared controls are never pixel data, in any row.
            for (const ch of wire.controls) {
              assert.equal(composed[benchPatch.dmxAddress + ch - 1], controlByte(ch),
                `${row}: control channel ${ch} must be identity-copied, never permuted`);
            }
          });
      }
    }
  }

  // ── Rows 5-8 stated as the equality they actually are ────────────────────

  for (const sSrc of [false, true]) {
    for (const m of [false, true]) {
      test(`_177 §4 rows 5-8 [${c.fixtureType}] S_src=${sSrc ? 'R' : 'N'} M=${m ? 'R' : 'N'}: ` +
        'flipping the BENCH scene flag changes NOTHING on the wire', () => {
        const normalDst = resolve({ slot: c.slot, mirrorReverse: m, destFlagged: false,
          benchFixture: c.benchFixture });
        const flippedDst = resolve({ slot: c.slot, mirrorReverse: m, destFlagged: true,
          benchFixture: c.benchFixture });

        // (a) the resolved mirror TREE is identical — S_dst is not an input to it.
        assert.deepEqual(flippedDst.spec, normalDst.spec,
          'the bench scene pixel-order flag must not reach the mirror spec at all');

        // (b) and the composed BYTES are identical — the no-double-apply proof.
        const a = compose(normalDst, source, FRAME[sSrc], benchPatch);
        const b = compose(flippedDst, source, FRAME[sSrc], benchPatch);
        assert.deepEqual(b, a,
          'S_dst is baked into the BENCH scene exported model, which the mirrored path never ' +
          'traverses — a byte difference here would mean the correction is applied twice');
      });
    }
  }

  test(`_177 §4 [${c.fixtureType}]: the S_dst flip is REAL — it moves the bench's own exported ` +
    'model while leaving the mirrored wire untouched', () => {
    // Without this, rows 5-8 could pass vacuously: "flipping a flag changed
    // nothing" is only a proof if the flag demonstrably changes SOMETHING.
    // It does — the bench scene's own exported model, which is the path the
    // bench takes when it runs STANDALONE and the one the mirrored stream never
    // traverses.
    const bench = { name: c.benchFixture, fixtureType: c.fixtureType,
      universe: benchPatch.dmxUniverse, addr: benchPatch.dmxAddress };
    const plainModel = exportSourceModel(bench, false).map((p) => p.channels);
    const flaggedModel = exportSourceModel(bench, true).map((p) => p.channels);
    assert.notDeepEqual(flaggedModel, plainModel,
      `S_dst must actually permute ${c.benchFixture}'s exported wire association — a no-op ` +
      'flag would make the byte-identity rows below meaningless');
    assert.deepEqual([...flaggedModel].reverse(), plainModel,
      'and it permutes it exactly once, end for end');
    // …and yet the mirrored path is byte-identical (asserted in the rows 5-8
    // tests above, for every S_src × M pair).
  });

  test(`_177 §4 [${c.fixtureType}]: the source scene flag never reaches the mirror tree either`,
    () => {
      // Mechanism A on the SOURCE moves colour onto a different wire block; it
      // must not move the SLICES. Both scene trees carrying flags, resolved:
      // the mirror tree is byte-identical to the unflagged one.
      const plain = resolve({ slot: c.slot, mirrorReverse: true, destFlagged: false,
        benchFixture: c.benchFixture });
      const sourceScene = liveScene('titanic');
      sourceScene.sceneConfig.pixelOrder = { [c.sourceFixture]: 'reversed' };
      const benchScene = liveScene('test_bench');
      benchScene.sceneConfig.pixelOrder = { [c.benchFixture]: 'reversed' };
      const selection = Object.fromEntries(SPEC.slots.map((s) => [s.slot, {
        source: s.defaultSource, reverse: s.slot === c.slot,
      }]));
      const both = resolveBenchMirror({
        spec: SPEC, benchSceneName: 'test_bench', benchScene,
        sourceSceneName: 'titanic', sourceScene, registry: REGISTRY, selection,
      });
      assert.equal(both.ok, true, both.refusal || '');
      assert.deepEqual(both.spec, plain.spec);
      assert.deepEqual(both.slots, plain.slots);
    });

  // ── The physical acceptance statement for today's rig ────────────────────

  test(`_177 §4 [${c.fixtureType}]: M is RELATIVE orientation — the aligned row is the same ` +
    'one for BOTH S_src values', () => {
    // `M = G_s ∘ G_d`: the slot toggle equals the two fixtures' relative
    // physical orientation, and the scene flags cancel because each is already
    // inside its own wire stream. Operationally: whichever M puts model slot k
    // on bench block k for S_src=N does the same for S_src=R once the source
    // scene's own correction is accounted — i.e. the toggle the operator sets
    // does not change when someone flags the ship fixture.
    const alignedFor = (sSrc) => {
      const hits = [];
      for (const m of [false, true]) {
        const out = resolve({ slot: c.slot, mirrorReverse: m, destFlagged: false,
          benchFixture: c.benchFixture });
        const composed = compose(out, source, FRAME[sSrc], benchPatch);
        // "Aligned" = bench wire block k carries model slot k.
        const aligned = wire.blocks.every((chs, k) =>
          chs.every((ch, lane) =>
            composed[benchPatch.dmxAddress + ch - 1] === rampByte(k, lane)));
        if (aligned) hits.push(m);
      }
      assert.equal(hits.length, 1, 'exactly one M value aligns the wire');
      return hits[0];
    };
    // For S_src=N the identity mirror aligns; for S_src=R the reversed one does.
    // The DIFFERENCE between them is exactly S_src — which is the equation
    // `M = G_s ∘ G_d` with `G` held fixed: the scene flag shifts which M is
    // "aligned on the wire", and the physical operator statement stays "set
    // REVERSED when the two fixtures' as-built directions disagree".
    assert.equal(alignedFor(false), false);
    assert.equal(alignedFor(true), true);
  });
}

// ── The LIVE-tier precondition, as its own loud guard ─────────────────────

test('_177: no Mechanism A flag may land on the four fixtures under orientation test', () => {
  // `bench_mirror_reverse.test.js`'s LIVE tier compares the GENERATED MODEL's
  // per-pixel wire association against the DEFINITION's pixel index, which is
  // only the same thing while neither fixture carries a scene-level pixel-order
  // flag. That tier states the precondition inside its two async pairing tests;
  // this is the same precondition as a standalone, always-run guard naming all
  // four fixtures at once, so a flag added to ANY of them fails here first with
  // an unambiguous instruction rather than surfacing as an arithmetic mismatch
  // deep inside a pairing assertion.
  const UNDER_TEST = [
    ['test_bench', 'Bar Left'],
    ['test_bench', 'Bar Right'],
    ['titanic', 'Left Front Wall 1'],
    ['titanic', 'Left Front Wall 2'],
  ];
  for (const [scene, fixture] of UNDER_TEST) {
    const store = liveScene(scene).sceneConfig.pixelOrder || {};
    assert.equal(store[fixture], undefined,
      `${scene}/${fixture} now carries a scene-level pixel-order flag. The LIVE orientation ` +
      'tier in bench_mirror_reverse.test.js reads the generated model\'s wire association and ' +
      'assumes it equals the definition pixel index for these four fixtures; recompute that ' +
      'tier\'s expectations (and re-verify the rig with calibration pattern 71) before ' +
      'removing this guard.');
  }
});
