/**
 * bench_mirror.test.js — unit tests for the bench stand-in re-addressing
 * (lib/bench_mirror.cjs) and for the LIVE test_bench map that drives it.
 *
 * The scenarios mirror the operator-visible failure modes:
 *   - a slice that lands on the wrong channel = the wrong fixture lights,
 *   - a spec typo silently ignored = a dark fixture with a green log,
 *   - the mirror running against the wrong engine model = par bytes inside a
 *     bar's control channels,
 *   - a mirror that rides a deployed tree onto the ship and hijacks a real
 *     gateway's universe.
 *
 * The live-map tests read the real scene + the real generated titanic model, so
 * a re-address that stops matching the fixture it names fails HERE rather than
 * on the bench.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');
const {
  parseBenchMirrorSpec, isMirrorActive, mirrorSourceUniverses, mirrorDestPairs,
  createMirrorState, spliceMirrorFrame, mirrorPayload, describeMirror,
  BENCH_MIRROR_VERSION, DMX_CHANNELS,
} = require('../lib/bench_mirror.cjs');

const SIM_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.join(SIM_ROOT, '..');
const LIVE_SPEC_PATH = path.join(SIM_ROOT, 'scenes', 'test_bench', 'bench_mirror.yaml');

/** A minimal valid spec, so each test can mutate exactly one thing. */
function baseSpecTree(overrides = {}) {
  return {
    version: BENCH_MIRROR_VERSION,
    enabled: true,
    source_scene: 'titanic',
    mirrors: [{
      dest_universe: 2,
      dest_host: '10.9.9.10',
      slices: [{ source_universe: 6, source_addr: 1, length: 10, dest_addr: 1 }],
    }],
    ...overrides,
  };
}

const parse = (tree) => parseBenchMirrorSpec(tree, 'spec');

// ── Structural validation — every refusal is named ─────────────────────────

test('parse accepts a minimal well-formed spec', () => {
  const spec = parse(baseSpecTree());
  assert.equal(spec.sourceScene, 'titanic');
  assert.equal(spec.mirrors.length, 1);
  assert.deepEqual(spec.mirrors[0].slices[0],
    { sourceUniverse: 6, sourceAddr: 1, length: 10, destAddr: 1, note: '' });
});

test('a non-mapping file is refused', () => {
  assert.throws(() => parse(null), /must contain a mapping/);
  assert.throws(() => parse([1, 2]), /must contain a mapping/);
});

test('an unknown top-level key is refused, not ignored', () => {
  assert.throws(() => parse(baseSpecTree({ sourceScene: 'titanic' })), /unknown key 'sourceScene'/);
});

test('an unknown slice key is refused (the typo that would go dark)', () => {
  const tree = baseSpecTree();
  tree.mirrors[0].slices[0].dest_address = 41;
  assert.throws(() => parse(tree), /unknown key 'dest_address'/);
});

test('a wrong version is refused', () => {
  assert.throws(() => parse(baseSpecTree({ version: 2 })), /version must be 1/);
});

test('enabled must be an explicit boolean', () => {
  assert.throws(() => parse(baseSpecTree({ enabled: 'yes' })), /must be true or false/);
  assert.throws(() => parse(baseSpecTree({ enabled: undefined })), /must be true or false/);
});

test('source_scene is mandatory — there is no implicit scene', () => {
  assert.throws(() => parse(baseSpecTree({ source_scene: '  ' })), /must name the scene/);
});

test('mirrors and slices must be non-empty', () => {
  assert.throws(() => parse(baseSpecTree({ mirrors: [] })), /non-empty list of destination/);
  const tree = baseSpecTree();
  tree.mirrors[0].slices = [];
  assert.throws(() => parse(tree), /would send an all-zero frame/);
});

test('non-integer and out-of-range numbers are refused', () => {
  const bad = (mutate, re) => {
    const tree = baseSpecTree();
    mutate(tree);
    assert.throws(() => parse(tree), re);
  };
  bad(t => { t.mirrors[0].slices[0].length = 1.5; }, /must be an integer/);
  bad(t => { t.mirrors[0].slices[0].source_addr = 0; }, /must be within 1\.\.512/);
  bad(t => { t.mirrors[0].slices[0].dest_addr = 513; }, /must be within 1\.\.512/);
  bad(t => { t.mirrors[0].dest_universe = 0; }, /must be within 1\.\.63999/);
});

test('a slice that walks past channel 512 is refused on both sides', () => {
  const src = baseSpecTree();
  src.mirrors[0].slices[0] = { source_universe: 6, source_addr: 500, length: 20, dest_addr: 1 };
  assert.throws(() => parse(src), /source range 500\.\.519 walks past channel 512/);
  const dst = baseSpecTree();
  dst.mirrors[0].slices[0] = { source_universe: 6, source_addr: 1, length: 20, dest_addr: 500 };
  assert.throws(() => parse(dst), /destination range 500\.\.519 walks past channel 512/);
});

test('two slices claiming one destination channel are refused', () => {
  const tree = baseSpecTree();
  tree.mirrors[0].slices.push({ source_universe: 5, source_addr: 1, length: 5, dest_addr: 8 });
  assert.throws(() => parse(tree), /destination channel 8 of U2 is already written by slices\[0\]/);
});

test('adjacent, non-overlapping slices are fine', () => {
  const tree = baseSpecTree();
  tree.mirrors[0].slices.push({ source_universe: 5, source_addr: 1, length: 5, dest_addr: 11 });
  assert.equal(parse(tree).mirrors[0].slices.length, 2);
});

test('a destination declared twice is refused (one definition per composed frame)', () => {
  const tree = baseSpecTree();
  tree.mirrors.push({
    dest_universe: 2,
    dest_host: '10.9.9.10',
    slices: [{ source_universe: 5, source_addr: 1, length: 5, dest_addr: 200 }],
  });
  assert.throws(() => parse(tree), /is declared twice/);
});

test('a dest_host the relay would refuse is refused here too', () => {
  for (const [host, re] of [['0.0.0.0', /placeholder sentinel/], ['127.0.0.1', /loopback/],
    ['255.255.255.255', /broadcast/], ['', /no controller IP declared/]]) {
    const tree = baseSpecTree();
    tree.mirrors[0].dest_host = host;
    assert.throws(() => parse(tree), re);
  }
});

// ── Activation — three preconditions, all required ─────────────────────────

test('the mirror runs only when enabled, the engine is on source_scene, and its scene is active', () => {
  const spec = parse(baseSpecTree());
  assert.equal(isMirrorActive(spec, 'titanic', true), true);
  assert.equal(isMirrorActive(spec, 'test_bench', true), false, 'wrong engine model');
  assert.equal(isMirrorActive(spec, null, true), false, 'engine unreachable');
  assert.equal(isMirrorActive(spec, 'titanic', false), false, 'own scene not active (deploy guard)');
  assert.equal(isMirrorActive(parse(baseSpecTree({ enabled: false })), 'titanic', true), false);
});

// ── Composition — the arithmetic that decides which fixture lights ─────────

test('a slice lands byte-for-byte at its destination offset', () => {
  const spec = parse({
    version: 1,
    enabled: true,
    source_scene: 'titanic',
    mirrors: [{
      dest_universe: 2,
      dest_host: '10.9.9.10',
      slices: [
        { source_universe: 6, source_addr: 1, length: 4, dest_addr: 1 },
        { source_universe: 5, source_addr: 34, length: 3, dest_addr: 74 },
      ],
    }],
  });
  const state = createMirrorState(spec);
  assert.deepEqual(spliceMirrorFrame(state, 6, { 1: 11, 2: 12, 3: 13, 4: 14 }), ['2→10.9.9.10']);
  spliceMirrorFrame(state, 5, { 34: 91, 35: 92, 36: 93 });
  const out = mirrorPayload(state, '2→10.9.9.10');
  assert.deepEqual([out[1], out[2], out[3], out[4]], [11, 12, 13, 14]);
  assert.deepEqual([out[74], out[75], out[76]], [91, 92, 93]);
  assert.equal(out[5], 0, 'unwritten channels stay 0');
  assert.equal(Object.keys(out).length, DMX_CHANNELS, 'a full 512-channel frame is always sent');
});

test('a universe no slice reads touches nothing', () => {
  const state = createMirrorState(parse(baseSpecTree()));
  assert.deepEqual(spliceMirrorFrame(state, 99, { 1: 255 }), []);
});

test('buffers persist across frames — a destination fed by two sources is never half-blank', () => {
  const spec = parse({
    version: 1,
    enabled: true,
    source_scene: 'titanic',
    mirrors: [{
      dest_universe: 2,
      dest_host: '10.9.9.10',
      slices: [
        { source_universe: 5, source_addr: 1, length: 2, dest_addr: 1 },
        { source_universe: 6, source_addr: 1, length: 2, dest_addr: 41 },
      ],
    }],
  });
  const state = createMirrorState(spec);
  spliceMirrorFrame(state, 5, { 1: 7, 2: 8 });
  spliceMirrorFrame(state, 6, { 1: 9, 2: 10 });
  spliceMirrorFrame(state, 5, { 1: 70, 2: 80 });   // only U5 arrives this time
  const out = mirrorPayload(state, '2→10.9.9.10');
  assert.deepEqual([out[1], out[2]], [70, 80], 'the fresh source updated');
  assert.deepEqual([out[41], out[42]], [9, 10], 'the other source kept its last value');
});

test('a channel absent from the payload is written as 0, never left stale', () => {
  const state = createMirrorState(parse(baseSpecTree()));
  spliceMirrorFrame(state, 6, { 1: 255, 2: 255, 3: 255 });
  spliceMirrorFrame(state, 6, { 1: 255 });          // the source went dark on 2..10
  const out = mirrorPayload(state, '2→10.9.9.10');
  assert.deepEqual([out[1], out[2], out[3]], [255, 0, 0]);
});

test('a null payload zeroes the slice rather than throwing', () => {
  const state = createMirrorState(parse(baseSpecTree()));
  spliceMirrorFrame(state, 6, { 1: 200 });
  spliceMirrorFrame(state, 6, null);
  assert.equal(mirrorPayload(state, '2→10.9.9.10')[1], 0);
});

test('mirrorPayload on an unknown destination throws (never an empty frame)', () => {
  const state = createMirrorState(parse(baseSpecTree()));
  assert.throws(() => mirrorPayload(state, '999→10.9.9.10'), /no buffer for destination/);
});

// ── Projections the bridge consumes ────────────────────────────────────────

test('source universes and destination pairs are the bridge subscription + suppression sets', () => {
  const tree = baseSpecTree();
  tree.mirrors[0].slices.push({ source_universe: 5, source_addr: 1, length: 4, dest_addr: 41 });
  tree.mirrors.push({
    dest_universe: 10,
    dest_host: '10.9.9.60',
    slices: [{ source_universe: 30, source_addr: 1, length: 80, dest_addr: 1 }],
  });
  const spec = parse(tree);
  assert.deepEqual(mirrorSourceUniverses(spec), [5, 6, 30]);
  assert.deepEqual(mirrorDestPairs(spec), [
    { universe: 2, ip: '10.9.9.10' },
    { universe: 10, ip: '10.9.9.60' },
  ]);
  assert.equal(describeMirror(spec).length, 2);
  assert.match(describeMirror(spec)[0], /U2 → 10\.9\.9\.10 \(2 slice\(s\), 14 ch, from U6\+U5\)/);
});

// ── The LIVE map: it must still name real fixtures ─────────────────────────
//
// These read the committed test_bench spec, the titanic scene's patches and the
// generated titanic model. A slice that stops lining up with the fixture its
// note claims fails here, not on the operator's desk.

function loadLiveSpec() {
  return parseBenchMirrorSpec(yaml.load(fs.readFileSync(LIVE_SPEC_PATH, 'utf8')), 'live');
}

/** { fixtureName → { universe, addr, footprint } } from the generated model. */
function readModelPatches(modelName) {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'marsin_engine', 'models', `${modelName}.js`), 'utf8');
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

test('live spec: parses, targets the titanic model, and is enabled', () => {
  const spec = loadLiveSpec();
  assert.equal(spec.sourceScene, 'titanic');
  assert.equal(spec.enabled, true);
});

test('live spec: every DMX slice is exactly one titanic fixture, whole', () => {
  const spec = loadLiveSpec();
  const model = readModelPatches('titanic');
  const dmx = spec.mirrors.find(m => m.destUniverse === 2);
  assert.ok(dmx, 'the bench DMX gateway destination exists');
  for (const slice of dmx.slices) {
    // Each slice is a run of whole fixtures starting exactly on a fixture's
    // start address — anything else shifts pixel data into control channels.
    let addr = slice.sourceAddr;
    const end = slice.sourceAddr + slice.length;
    while (addr < end) {
      const fixture = model.find(f => f.universe === slice.sourceUniverse && f.addr === addr);
      assert.ok(fixture,
        `no titanic fixture starts at U${slice.sourceUniverse} addr ${addr} — slice "${slice.note}"`);
      addr += fixture.footprint;
    }
    assert.equal(addr, end,
      `slice "${slice.note}" does not end on a fixture boundary (stopped at ${addr}, wanted ${end})`);
  }
});

test('live spec: every DMX slice lands on a bench fixture of the SAME footprint', () => {
  const spec = loadLiveSpec();
  const titanic = readModelPatches('titanic');
  const bench = readModelPatches('test_bench');
  const dmx = spec.mirrors.find(m => m.destUniverse === 2);
  for (const slice of dmx.slices) {
    let src = slice.sourceAddr;
    let dst = slice.destAddr;
    const end = slice.sourceAddr + slice.length;
    while (src < end) {
      const from = titanic.find(f => f.universe === slice.sourceUniverse && f.addr === src);
      const to = bench.find(f => f.universe === dmx.destUniverse && f.addr === dst);
      assert.ok(to, `no bench fixture is addressed at U${dmx.destUniverse}/${dst}`);
      assert.equal(to.footprint, from.footprint,
        `'${from.name}' (fp ${from.footprint}) would land on '${to.name}' (fp ${to.footprint})`);
      src += from.footprint;
      dst += to.footprint;
    }
  }
});

test('live spec: LED slices fit their bench strand exactly', () => {
  const spec = loadLiveSpec();
  const patches = yaml.load(fs.readFileSync(
    path.join(SIM_ROOT, 'scenes', 'test_bench', 'patches.yaml'), 'utf8')).patches;
  const strands = Object.entries(patches).filter(([, p]) => typeof p.pixelCount === 'number');
  for (const m of spec.mirrors) {
    if (m.destUniverse === 2) continue;
    const hit = strands.find(([, p]) => p.dmxUniverse === m.destUniverse);
    assert.ok(hit, `no bench strand is patched to U${m.destUniverse}`);
    const [name, patch] = hit;
    const channels = m.slices.reduce((n, s) => n + s.length, 0);
    assert.equal(channels, patch.pixelCount * 4,
      `'${name}' is ${patch.pixelCount} px RGBW = ${patch.pixelCount * 4} ch, mirror copies ${channels}`);
    for (const s of m.slices) {
      assert.equal(s.destAddr, patch.dmxAddress,
        `'${name}' starts at channel ${patch.dmxAddress}, mirror writes from ${s.destAddr}`);
    }
  }
});

test('live spec: every mirrored source universe is one the titanic model actually sends', () => {
  const spec = loadLiveSpec();
  const modelUniverses = new Set(readModelPatches('titanic').map(f => f.universe));
  for (const u of mirrorSourceUniverses(spec)) {
    assert.ok(modelUniverses.has(u), `the titanic model sends nothing on U${u}`);
  }
});

test('live spec: every destination is a controller the test_bench scene declares', () => {
  const spec = loadLiveSpec();
  const registry = yaml.load(fs.readFileSync(
    path.join(SIM_ROOT, 'scenes', 'test_bench', 'controllers.yaml'), 'utf8'));
  const declared = new Set();
  for (const c of registry.controllers) {
    for (const port of c.ports) declared.add(`${port.universe}→${c.ip}`);
  }
  for (const pair of mirrorDestPairs(spec)) {
    assert.ok(declared.has(`${pair.universe}→${pair.ip}`),
      `U${pair.universe} → ${pair.ip} is not a port the bench hardware listens on`);
  }
});

// ── Bridge wiring (source-read, like the other bridge wiring tests) ────────

test('the bridge suppresses the ordinary relay for mirrored destinations', () => {
  const src = fs.readFileSync(path.join(SIM_ROOT, 'server', 'sacn_bridge.js'), 'utf8');
  assert.match(src, /const relayRoutes = routes\.filter\(r => !mirrorOwned\.has\(routeKey\(r\.universe, r\.ip\)\)\)/,
    'mirrored pairs must be removed before the relay sender diff (one writer per pair)');
  assert.match(src, /const nextKeys = new Set\(relayRoutes\.map/,
    'the sender diff must run on the suppressed set, not the raw route set');
  assert.match(src, /isMirrorActive\(found\.spec, engineState\.scene, activeSceneSet\.has\(found\.scene\)\)/,
    'all three activation preconditions must be checked at the call site');
});

test('the bridge subscribes to mirror source universes before building senders', () => {
  const src = fs.readFileSync(path.join(SIM_ROOT, 'server', 'sacn_bridge.js'), 'utf8');
  const subIdx = src.indexOf('bench mirror source (scene');
  const diffIdx = src.indexOf('// Diff → close removed senders');
  assert.ok(subIdx > 0 && diffIdx > subIdx,
    'mirror sources must join the subscription union before the sender diff');
});
