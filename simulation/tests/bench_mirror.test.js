/**
 * bench_mirror.test.js — the v3 sidecar schema, the computed-spec validator,
 * activation, global suppression and composition (lib/bench_mirror.cjs), plus
 * the bridge wiring assertions that live in source shape rather than behaviour.
 *
 * The scenarios mirror the operator-visible failure modes:
 *   - a slice that lands on the wrong channel = the wrong fixture lights,
 *   - a spec typo silently ignored = a dark fixture with a green log,
 *   - the mirror running against the wrong engine model = par bytes inside a
 *     bar's control channels,
 *   - a mirror that rides a deployed tree onto the ship and hijacks a real
 *     gateway's universe,
 *   - a composed frame emitted before all its sources arrived = sub-frame
 *     tearing, which is what the first physical test actually looked like.
 *
 * The resolver's own behaviour (slots → universes/addresses/slices) lives in
 * bench_mirror_resolve.test.js; the runtime bridge in bench_mirror_arm.test.js.
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
  parseBenchMirrorSpec, validateMirrorTree, isMirrorActive, mirrorSourceUniverses,
  mirrorDestPairs, partitionMirrorSuppression,
  createMirrorState, spliceMirrorFrame, mirrorPayload, describeMirror,
  BENCH_MIRROR_VERSION, DMX_CHANNELS, SPEC_KEYS, SLOT_KEYS,
} = require('../lib/bench_mirror.cjs');
const { STATE_KEYS, SELECTION_KEYS, SLOT_STATE_KEYS } = require('../lib/bench_mirror_state.cjs');

const SIM_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIVE_SPEC_PATH = path.join(SIM_ROOT, 'scenes', 'test_bench', 'bench_mirror.yaml');

/** A minimal valid v3 sidecar, so each test can mutate exactly one thing. */
function baseSpecTree(overrides = {}) {
  return {
    version: BENCH_MIRROR_VERSION,
    enabled: true,
    label: 'Test bench stand-in',
    slots: [
      { slot: 'par_1', bench_fixture: 'Par 1', default_source: 'Left Auditorium 5' },
      { slot: 'led_0', bench_fixture: 'LED_0', default_source: 'none' },
    ],
    ...overrides,
  };
}

const parse = (tree) => parseBenchMirrorSpec(tree, 'spec');

/** A COMPUTED spec, the shape the resolver materializes and the bridge runs. */
function computed(mirrors, extra = {}) {
  return {
    version: 3, enabled: true, label: 'Test bench stand-in', note: '',
    scene: 'test_bench', sourceScene: 'titanic', mirrors, ...extra,
  };
}

// ── v3 schema — every refusal is named ─────────────────────────────────────

test('parse accepts a minimal well-formed v3 sidecar', () => {
  const spec = parse(baseSpecTree());
  assert.equal(spec.label, 'Test bench stand-in');
  assert.equal(spec.slots.length, 2);
  assert.deepEqual(spec.slots[0],
    { slot: 'par_1', benchFixture: 'Par 1', defaultSource: 'Left Auditorium 5', note: '' });
});

test('the literal `none` becomes a null default — held dark, explicitly', () => {
  assert.equal(parse(baseSpecTree()).slots[1].defaultSource, null);
});

test('a non-mapping file is refused', () => {
  assert.throws(() => parse(null), /must contain a mapping/);
  assert.throws(() => parse([1, 2]), /must contain a mapping/);
});

test('an unknown top-level key is refused, not ignored', () => {
  assert.throws(() => parse(baseSpecTree({ source_scene: 'titanic' })),
    /unknown key 'source_scene'/);
  assert.throws(() => parse(baseSpecTree({ mirrors: [] })), /unknown key 'mirrors'/);
});

test('an unknown slot key is refused (the typo that would go dark)', () => {
  const tree = baseSpecTree();
  tree.slots[0].source = 'Left Auditorium 5';
  assert.throws(() => parse(tree), /unknown key 'source'/);
});

test('_155 R-20: a v1 or v2 file is refused BY NAME with the migration spelled out', () => {
  for (const version of [1, 2]) {
    const tree = baseSpecTree({ version });
    assert.throws(() => parse(tree), /version must be 3/,
      `v${version} must be refused`);
    assert.throws(() => parse(tree), /no longer carries mirrors, slices, universes, addresses/);
    assert.throws(() => parse(tree), /Declare `slots` instead/);
    assert.throws(() => parse(tree), /the bench is the ONLY\s+physical output/s);
    assert.throws(() => parse(tree), /20260805_155/);
  }
  // An unknown future version is refused too, without pretending to know a
  // migration path for it.
  assert.throws(() => parse(baseSpecTree({ version: 4 })), /version must be 3/);
  assert.doesNotThrow(() => {
    try { parse(baseSpecTree({ version: 4 })); } catch (e) {
      assert.doesNotMatch(e.message, /Declare `slots` instead/);
    }
  });
});

test('label is mandatory — the armed banner must be able to name the stand-in', () => {
  assert.throws(() => parse(baseSpecTree({ label: undefined })), /must name this stand-in/);
  assert.throws(() => parse(baseSpecTree({ label: '   ' })), /must name this stand-in/);
  assert.equal(parse(baseSpecTree({ label: '  Bench  ' })).label, 'Bench');
});

test('enabled must be an explicit boolean', () => {
  assert.throws(() => parse(baseSpecTree({ enabled: 'yes' })), /must be true or false/);
  assert.throws(() => parse(baseSpecTree({ enabled: undefined })), /must be true or false/);
});

test('slots must be a non-empty list', () => {
  assert.throws(() => parse(baseSpecTree({ slots: [] })), /non-empty list of bench slots/);
  assert.throws(() => parse(baseSpecTree({ slots: 'par_1' })), /non-empty list of bench slots/);
});

test('slot ids must be snake_case and unique', () => {
  const bad = baseSpecTree();
  bad.slots[0].slot = 'Par 1';
  assert.throws(() => parse(bad), /must be a snake_case id/);
  const dup = baseSpecTree();
  dup.slots[1].slot = 'par_1';
  assert.throws(() => parse(dup), /slot id 'par_1' is declared twice/);
});

test('two slots cannot claim one bench fixture — one fixture, one source', () => {
  const tree = baseSpecTree();
  tree.slots[1].bench_fixture = 'Par 1';
  assert.throws(() => parse(tree), /is claimed by two slots/);
});

test('bench_fixture must name something', () => {
  const tree = baseSpecTree();
  tree.slots[0].bench_fixture = '   ';
  assert.throws(() => parse(tree), /must name a fixture in THIS scene's patches\.yaml/);
});

test('default_source is REQUIRED — absence is not a choice, `none` is', () => {
  const missing = baseSpecTree();
  delete missing.slots[0].default_source;
  assert.throws(() => parse(missing), /must name a source fixture, or the literal 'none'/);
  assert.throws(() => parse(missing), /There is no implicit default/);
  const empty = baseSpecTree();
  empty.slots[0].default_source = '  ';
  assert.throws(() => parse(empty), /must name a source fixture/);
});

// ── The COMPUTED-spec validator (what the resolver's output must satisfy) ───

test('_155 R-19: the computed validator keeps every v2 structural invariant', () => {
  const ok = [{ destUniverse: 2, destHost: '10.9.9.10', note: '', slices: [
    { sourceUniverse: 6, sourceAddr: 1, length: 10, destAddr: 1, note: '' },
    { sourceUniverse: 5, sourceAddr: 1, length: 4, destAddr: 11, note: '' },
  ] }];
  assert.doesNotThrow(() => validateMirrorTree(ok, 'computed'));

  const overlap = [{ destUniverse: 2, destHost: '10.9.9.10', note: '', slices: [
    { sourceUniverse: 6, sourceAddr: 1, length: 10, destAddr: 1, note: '' },
    { sourceUniverse: 5, sourceAddr: 1, length: 5, destAddr: 8, note: '' },
  ] }];
  assert.throws(() => validateMirrorTree(overlap, 'computed'),
    /destination channel 8 of U2 is already written by slices\[0\]/);

  const walkoffSrc = [{ destUniverse: 2, destHost: '10.9.9.10', note: '', slices: [
    { sourceUniverse: 6, sourceAddr: 500, length: 20, destAddr: 1, note: '' }] }];
  assert.throws(() => validateMirrorTree(walkoffSrc, 'computed'),
    /source range 500\.\.519 walks past channel 512/);

  const walkoffDst = [{ destUniverse: 2, destHost: '10.9.9.10', note: '', slices: [
    { sourceUniverse: 6, sourceAddr: 1, length: 20, destAddr: 500, note: '' }] }];
  assert.throws(() => validateMirrorTree(walkoffDst, 'computed'),
    /destination range 500\.\.519 walks past channel 512/);

  const twice = [
    { destUniverse: 2, destHost: '10.9.9.10', note: '', slices: [] },
    { destUniverse: 2, destHost: '10.9.9.10', note: '', slices: [] },
  ];
  assert.throws(() => validateMirrorTree(twice, 'computed'), /appears twice/);

  for (const [host, re] of [['0.0.0.0', /placeholder sentinel/], ['127.0.0.1', /loopback/],
    ['255.255.255.255', /broadcast/], ['', /no controller IP declared/]]) {
    assert.throws(() => validateMirrorTree(
      [{ destUniverse: 2, destHost: host, note: '', slices: [] }], 'computed'), re);
  }
  assert.throws(() => validateMirrorTree([], 'computed'), /no destinations at all/);
});

test('_155 §6.1: a destination with NO slices is legal — an all-`none` slot is owned and dark', () => {
  // The v2 parser refused this ("would send an all-zero frame and blackout the
  // fixtures"). Under the bench-only ruling that all-zero frame is exactly the
  // behaviour: armed = the bench is the mirror's, dark where unselected.
  const dark = [{ destUniverse: 10, destHost: '10.9.9.60', note: '', slices: [] }];
  assert.doesNotThrow(() => validateMirrorTree(dark, 'computed'));
  const state = createMirrorState(computed(dark));
  const out = mirrorPayload(state, '10→10.9.9.60');
  assert.equal(Object.keys(out).length, DMX_CHANNELS);
  assert.ok(Object.values(out).every(v => v === 0), 'an unselected destination composes zeros');
});

// ── Activation — three preconditions, all required ─────────────────────────

test('the mirror runs only when enabled, the engine is on the computed source scene, and ARMED', () => {
  const spec = computed([{ destUniverse: 2, destHost: '10.9.9.10', note: '', slices: [] }]);
  assert.equal(isMirrorActive(spec, 'titanic', true), true);
  assert.equal(isMirrorActive(spec, 'studio', true), false, 'engine moved to another scene');
  assert.equal(isMirrorActive(spec, null, true), false, 'engine unreachable');
  assert.equal(isMirrorActive(spec, 'titanic', false), false, 'not armed (_151 deploy guard)');
  assert.equal(isMirrorActive({ ...spec, enabled: false }, 'titanic', true), false);
});

test('_151: the armed precondition is strictly boolean true — nothing truthy arms hardware', () => {
  const spec = computed([{ destUniverse: 2, destHost: '10.9.9.10', note: '', slices: [] }]);
  for (const notArmed of [undefined, null, 0, '', 'yes', 1, {}, []]) {
    assert.equal(isMirrorActive(spec, 'titanic', notArmed), false,
      `${JSON.stringify(notArmed)} must not count as armed`);
  }
});

// ── Composition — the arithmetic that decides which fixture lights ─────────

const TWO_SLICES = computed([{
  destUniverse: 2, destHost: '10.9.9.10', note: '',
  slices: [
    { sourceUniverse: 6, sourceAddr: 1, length: 4, destAddr: 1, note: '' },
    { sourceUniverse: 5, sourceAddr: 34, length: 3, destAddr: 74, note: '' },
  ],
}]);

test('a slice lands byte-for-byte at its destination offset', () => {
  const state = createMirrorState(TWO_SLICES);
  assert.deepEqual(spliceMirrorFrame(state, 6, { 1: 11, 2: 12, 3: 13, 4: 14 }), ['2→10.9.9.10']);
  spliceMirrorFrame(state, 5, { 34: 91, 35: 92, 36: 93 });
  const out = mirrorPayload(state, '2→10.9.9.10');
  assert.deepEqual([out[1], out[2], out[3], out[4]], [11, 12, 13, 14]);
  assert.deepEqual([out[74], out[75], out[76]], [91, 92, 93]);
  assert.equal(out[5], 0, 'unwritten channels stay 0');
  assert.equal(Object.keys(out).length, DMX_CHANNELS, 'a full 512-channel frame is always sent');
});

test('a universe no slice reads touches nothing', () => {
  const state = createMirrorState(TWO_SLICES);
  assert.deepEqual(spliceMirrorFrame(state, 99, { 1: 255 }), []);
});

test('buffers persist across frames — a destination fed by two sources is never half-blank', () => {
  const state = createMirrorState(TWO_SLICES);
  spliceMirrorFrame(state, 6, { 1: 7, 2: 8, 3: 0, 4: 0 });
  spliceMirrorFrame(state, 5, { 34: 9, 35: 10, 36: 0 });
  spliceMirrorFrame(state, 6, { 1: 70, 2: 80, 3: 0, 4: 0 });   // only U6 arrives this time
  const out = mirrorPayload(state, '2→10.9.9.10');
  assert.deepEqual([out[1], out[2]], [70, 80], 'the fresh source updated');
  assert.deepEqual([out[74], out[75]], [9, 10], 'the other source kept its last value');
});

test('a channel absent from the payload is written as 0, never left stale', () => {
  const state = createMirrorState(TWO_SLICES);
  spliceMirrorFrame(state, 6, { 1: 255, 2: 255, 3: 255 });
  spliceMirrorFrame(state, 6, { 1: 255 });          // the source went dark on 2..4
  const out = mirrorPayload(state, '2→10.9.9.10');
  assert.deepEqual([out[1], out[2], out[3]], [255, 0, 0]);
});

test('a null payload zeroes the slice rather than throwing', () => {
  const state = createMirrorState(TWO_SLICES);
  spliceMirrorFrame(state, 6, { 1: 200 });
  spliceMirrorFrame(state, 6, null);
  assert.equal(mirrorPayload(state, '2→10.9.9.10')[1], 0);
});

test('mirrorPayload on an unknown destination throws (never an empty frame)', () => {
  const state = createMirrorState(TWO_SLICES);
  assert.throws(() => mirrorPayload(state, '999→10.9.9.10'), /no buffer for destination/);
});

// ── _153 §10: the emission cadence gate ────────────────────────────────────

test('_153: createMirrorState declares each destination\'s REQUIRED source universes', () => {
  const state = createMirrorState(TWO_SLICES);
  assert.deepEqual([...state.requiredSources.get('2→10.9.9.10')].sort((a, b) => a - b), [5, 6]);
  // A single-source destination requires exactly one — which is precisely why
  // the LED strands never flickered while the 3-source gateway did.
  const single = createMirrorState(computed([{
    destUniverse: 10, destHost: '10.9.9.60', note: '',
    slices: [{ sourceUniverse: 30, sourceAddr: 1, length: 80, destAddr: 1, note: '' }],
  }]));
  assert.deepEqual([...single.requiredSources.get('10→10.9.9.60')], [30]);
});

test('_153: a destination with no slices requires nothing — it is emittable as zeros', () => {
  const state = createMirrorState(computed([
    { destUniverse: 10, destHost: '10.9.9.60', note: '', slices: [] }]));
  assert.equal(state.requiredSources.get('10→10.9.9.60').size, 0);
});

// ── Projections the bridge consumes ────────────────────────────────────────

test('source universes and destination pairs are the bridge subscription + ownership sets', () => {
  const spec = computed([
    { destUniverse: 2, destHost: '10.9.9.10', note: '', slices: [
      { sourceUniverse: 6, sourceAddr: 1, length: 10, destAddr: 1, note: '' },
      { sourceUniverse: 5, sourceAddr: 1, length: 4, destAddr: 41, note: '' }] },
    { destUniverse: 10, destHost: '10.9.9.60', note: '', slices: [
      { sourceUniverse: 30, sourceAddr: 1, length: 80, destAddr: 1, note: '' }] },
  ]);
  assert.deepEqual(mirrorSourceUniverses(spec), [5, 6, 30]);
  assert.deepEqual(mirrorDestPairs(spec), [
    { universe: 2, ip: '10.9.9.10' },
    { universe: 10, ip: '10.9.9.60' },
  ]);
  assert.equal(describeMirror(spec).length, 2);
  assert.match(describeMirror(spec)[0], /U2 → 10\.9\.9\.10 \(2 slice\(s\), 14 ch, from U6\+U5\)/);
  assert.match(describeMirror(spec)[1], /1 slice\(s\), 80 ch, from U30/);
});

// ── Suppression: ARMED = the bench is the ONLY physical output ─────────────

/** The shape recomputeRoutes hands the partition: effective relay routes. */
const R = (universe, ip, scenes = ['titanic']) => ({ universe, ip, scenes });

const ARMED = [{
  scene: 'test_bench',
  spec: computed([
    { destUniverse: 2, destHost: '10.9.9.10', note: '', slices: [
      { sourceUniverse: 6, sourceAddr: 1, length: 10, destAddr: 1, note: '' }] },
    { destUniverse: 10, destHost: '10.9.9.60', note: '', slices: [
      { sourceUniverse: 30, sourceAddr: 1, length: 80, destAddr: 1, note: '' }] },
  ]),
}];

test('with no active mirror NOTHING is suppressed — the relay is untouched', () => {
  const routes = [R(2, '10.9.9.10'), R(3, '10.9.9.10'), R(30, '10.9.9.60')];
  const out = partitionMirrorSuppression({ routes, mirrors: [] });
  assert.deepEqual(out.relay, routes);
  assert.deepEqual(out.suppressed, []);
  assert.equal(out.targets.size, 0);
});

test('_155 A2: while armed the ENTIRE relay set is suspended, not just the owned pairs', () => {
  // This is the operator ruling: bench-only. A ship controller that the mirror
  // does not touch at all still stops receiving physical data.
  const routes = [
    R(2, '10.9.9.10'), R(3, '10.9.9.10'), R(4, '10.9.9.10'),
    R(30, '10.9.9.60'), R(31, '10.9.9.60'),
    R(15, '10.9.9.16'), R(22, '10.9.9.19'),
  ];
  const out = partitionMirrorSuppression({ routes, mirrors: ARMED });
  assert.deepEqual(out.relay, [], 'nothing may be relayed anywhere while armed');
  assert.equal(out.suppressed.length, routes.length);
  assert.ok(out.suppressed.every(s => s.why === 'armed'));
  assert.ok(out.suppressed.every(s => s.scene === 'test_bench'),
    'the suppression names the scene that took the rig');
});

test('_155 A2: the mirror\'s own destinations are the targets, and never in the relay set', () => {
  const routes = [R(2, '10.9.9.10'), R(10, '10.9.9.60'), R(30, '10.9.9.60')];
  const out = partitionMirrorSuppression({ routes, mirrors: ARMED });
  assert.deepEqual([...out.targets.keys()].sort(), ['10→10.9.9.60', '2→10.9.9.10']);
  assert.deepEqual([...out.ownedKeys].sort(), ['10→10.9.9.60', '2→10.9.9.10']);
  const relayKeys = new Set(out.relay.map(r => `${r.universe}→${r.ip}`));
  for (const key of out.targets.keys()) {
    assert.ok(!relayKeys.has(key), `${key} is composed AND relayed — two writers on one pair`);
  }
});

// ── _152 D1: the release window is part of the one-writer law ─────────────
//
// A blackout clears the arm and empties `_activeMirrors` synchronously, then
// suspends while its all-zero frames go out. Any recompute landing in that
// window would otherwise see no mirror, suppress nothing, and hand every route
// straight back to the ordinary relay while the blackout is still writing.

test('_152 D1: a blackout hold suppresses everything after the arm is gone', () => {
  const routes = [R(2, '10.9.9.10'), R(3, '10.9.9.10'), R(30, '10.9.9.60')];
  // `mirrors` is EMPTY — that is the state the disarm leaves behind.
  const out = partitionMirrorSuppression({
    routes, mirrors: [], hold: { scene: 'test_bench' },
  });
  assert.deepEqual(out.relay, []);
  assert.ok(out.suppressed.every(s => s.why === 'blackout'));
  assert.equal(out.suppressed[0].scene, 'test_bench', 'the hold names the scene being released');
});

test('_152 D1: with no blackout in flight the hold changes nothing', () => {
  const routes = [R(2, '10.9.9.10'), R(30, '10.9.9.60')];
  for (const hold of [null, undefined]) {
    const out = partitionMirrorSuppression({ routes, mirrors: [], hold });
    assert.deepEqual(out.relay, routes, `hold ${JSON.stringify(hold)} must not suppress anything`);
    assert.deepEqual(out.suppressed, []);
  }
});

test('_152 D1: an ACTIVE mirror reports `armed`, not a stale `blackout`', () => {
  const routes = [R(2, '10.9.9.10'), R(30, '10.9.9.60')];
  const out = partitionMirrorSuppression({
    routes, mirrors: ARMED, hold: { scene: 'test_bench' },
  });
  assert.ok(out.suppressed.every(s => s.why === 'armed'));
});

// ── The LIVE sidecar: it must still name real bench fixtures ───────────────

function loadLiveSpec() {
  return parseBenchMirrorSpec(yaml.load(fs.readFileSync(LIVE_SPEC_PATH, 'utf8')), 'live');
}

/** Every (path, value) leaf of a parsed tree — after YAML has done its work. */
function walkLeaves(node, at = '$') {
  if (Array.isArray(node)) {
    return node.flatMap((v, i) => walkLeaves(v, `${at}[${i}]`));
  }
  if (node && typeof node === 'object') {
    return Object.entries(node).flatMap(([k, v]) => [
      { path: `${at}.${k}`, key: k, value: undefined },
      ...walkLeaves(v, `${at}.${k}`),
    ]);
  }
  return [{ path: at, key: null, value: node }];
}

test('live sidecar: parses as v3, is enabled, and declares no plumbing ANYWHERE in the tree',
  () => {
    // Walk the PARSED tree, not the raw text (report 20260805_158 D-158-7). A
    // raw-text scan is defeatable: a YAML double-quoted line continuation splits
    // a dotted quad across two source lines that `yaml.load()` then reassembles,
    // and anchors/aliases hide values off the lines that carry them. Whatever
    // the file looks like, this is what the bridge actually receives.
    const raw = yaml.load(fs.readFileSync(LIVE_SPEC_PATH, 'utf8'));
    const spec = loadLiveSpec();
    assert.equal(spec.version, 3);
    assert.equal(spec.enabled, true);
    assert.ok(spec.slots.length >= 10, 'the bench inventory is declared as slots');

    const leaves = walkLeaves(raw);

    // 1. No plumbing KEY at any depth — including keys the v2 schema used and
    //    plausible abbreviations of them.
    const PLUMBING_KEY = /^(mirrors?|slices?|source_scene|controllers?|dest_?(universe|host|addr|address|channel|ch)|src_?(universe|addr|address|channel|ch)|source_(universe|addr|address)|universe|dmx_?(universe|address)|start_?(address|channel)|end_?(universe|channel)|length|len|footprint|pixel_?count|stride|suppress_host|also_?flat|ip|host)$/i;
    for (const leaf of leaves) {
      if (leaf.key === null) continue;
      assert.doesNotMatch(leaf.key, PLUMBING_KEY,
        `${leaf.path} is a plumbing key — v3 resolves every address from the scene`);
    }

    // 2. No VALUE anywhere that looks like an address or a channel map, in any
    //    of the notations a dotted quad can hide in.
    const IPV4 = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/;
    const IPV4_HEX = /\b0x[0-9a-f]{8}\b/i;
    const IPV4_DASHED = /\b\d{1,3}-\d{1,3}-\d{1,3}-\d{1,3}\b/;
    for (const leaf of leaves) {
      if (typeof leaf.value === 'number') {
        // A 32-bit packed address is still an address (report 20260805_158
        // R-158-C): `note: 168364348` byte-unpacks to a real 10/8 host and slips
        // past a string-only scan.
        assert.ok(!Number.isInteger(leaf.value) || leaf.value < 0
          || leaf.value > 0xFFFFFFFF || (leaf.value >>> 24) !== 10,
        `${leaf.path} is an integer that byte-unpacks to a 10.0.0.0/8 address ` +
        `(${leaf.value} → ${(leaf.value >>> 24)}.${(leaf.value >>> 16) & 255}.` +
        `${(leaf.value >>> 8) & 255}.${leaf.value & 255}) — the sidecar names fixtures, ` +
        'never addresses, in any encoding');
        continue;
      }
      if (typeof leaf.value !== 'string') continue;
      for (const [re, why] of [[IPV4, 'a dotted quad'], [IPV4_HEX, 'a hex-packed address'],
        [IPV4_DASHED, 'a dash-separated address']]) {
        assert.doesNotMatch(leaf.value, re,
          `${leaf.path} carries ${why} — the sidecar names fixtures, never addresses ` +
          `(value: ${JSON.stringify(leaf.value)})`);
      }
    }

    // 3. The REAL guarantee, stated as such: the schema admits nothing else, and
    //    nothing the schema DOES admit is ever interpreted as plumbing. Scans
    //    are whack-a-mole (every encoding closed invites the next); this is the
    //    structural close.
    assert.deepEqual(Object.keys(raw).filter(k => !SPEC_KEYS.has(k)), [],
      'the parser refuses unknown top-level keys, so this can only ever be empty');
    for (const slot of raw.slots) {
      assert.deepEqual(Object.keys(slot).filter(k => !SLOT_KEYS.has(k)), [],
        'and unknown slot keys too');
    }
    // The only keys whose values are free text are `note` and `label`. Prove
    // they cannot become plumbing however they are encoded: the resolver never
    // reads them, so the computed mapping is identical with them replaced by a
    // packed address, a dotted quad, or anything else.
    const poisoned = JSON.parse(JSON.stringify(raw));
    poisoned.note = 168364348;
    poisoned.label = 'x 10.9.9.60 x';
    for (const slot of poisoned.slots) slot.note = 0x0A09093C;
    const clean = parseBenchMirrorSpec(raw, 'clean');
    const dirty = parseBenchMirrorSpec(poisoned, 'poisoned');
    assert.deepEqual(
      dirty.slots.map(sl => [sl.slot, sl.benchFixture, sl.defaultSource]),
      clean.slots.map(sl => [sl.slot, sl.benchFixture, sl.defaultSource]),
      'only slot / bench_fixture / default_source survive into what the resolver reads — ' +
      'an address smuggled into `note` or `label` cannot become a route in any encoding');
  });

test('_158 D-158-7: hidden plumbing is REFUSED by the parser, not merely absent from the file',
  () => {
    // The evasions the reviewer demonstrated, each fed to the real parser.
    const base = () => yaml.load(fs.readFileSync(LIVE_SPEC_PATH, 'utf8'));

    // A YAML line continuation reassembles into a real dotted quad. The raw-text
    // scan could not see it; the schema refuses the key it would have to live on.
    const smuggled = base();
    smuggled.note = 'LED box 10.9.9.60 is out 1';
    assert.doesNotThrow(() => parseBenchMirrorSpec(smuggled, 'smuggled'),
      '`note` is a legal key, so a comment-shaped string parses…');
    const parsedNote = parseBenchMirrorSpec(smuggled, 'smuggled');
    assert.equal(parsedNote.slots.length, base().slots.length,
      '…and is inert: nothing downstream reads it');

    // …but every key that could make such a string LOAD-BEARING is refused.
    for (const key of ['mirrors', 'source_scene', 'controllers', 'dest_host', 'slices']) {
      const tree = base();
      tree[key] = [{ dest_universe: 2, dest_host: '10.9.9.10' }];
      assert.throws(() => parseBenchMirrorSpec(tree, 'evasion'),
        new RegExp(`unknown key '${key}'`),
        `a v3 sidecar must refuse '${key}' outright`);
    }
    for (const key of ['dest_addr', 'source_universe', 'length', 'controllerIp']) {
      const tree = base();
      tree.slots[0][key] = 1;
      assert.throws(() => parseBenchMirrorSpec(tree, 'evasion'),
        new RegExp(`unknown key '${key}'`),
        `a v3 slot must refuse '${key}' outright`);
    }
  });

test('live sidecar: every declared bench fixture is patched in the test_bench scene', () => {
  const spec = loadLiveSpec();
  const patches = yaml.load(fs.readFileSync(
    path.join(SIM_ROOT, 'scenes', 'test_bench', 'patches.yaml'), 'utf8')).patches;
  for (const slot of spec.slots) {
    assert.ok(patches[slot.benchFixture],
      `slot '${slot.slot}' names '${slot.benchFixture}', which test_bench does not patch`);
  }
});

test('live sidecar: every default_source is patched in the titanic scene', () => {
  const spec = loadLiveSpec();
  const patches = yaml.load(fs.readFileSync(
    path.join(SIM_ROOT, 'scenes', 'titanic', 'patches.yaml'), 'utf8')).patches;
  for (const slot of spec.slots) {
    if (slot.defaultSource === null) continue;
    assert.ok(patches[slot.defaultSource],
      `slot '${slot.slot}' defaults to '${slot.defaultSource}', which titanic does not patch`);
  }
});

// ── Bridge wiring (source-read, like the other bridge wiring tests) ────────

const bridgeSrc = () => fs.readFileSync(path.join(SIM_ROOT, 'server', 'sacn_bridge.js'), 'utf8');

test('the bridge suppresses the relay through the SINGLE partition call site', () => {
  const src = bridgeSrc();
  assert.match(src, /relay: relayRoutes, suppressed: mirrorSuppressed, targets: allTargets,\s*\} = partitionMirrorSuppression\(\{ routes, mirrors: _activeMirrors, hold: _blackoutHold \}\)/,
    'the active mirrors AND an in-flight blackout\'s hold must both be consulted before the ' +
    'relay sender diff');
  assert.match(src, /const nextKeys = new Set\(relayRoutes\.map/,
    'the sender diff must run on the suppressed set, not the raw route set');
  assert.match(src, /isMirrorActive\(armedSpec, engineState\.scene, true\)/,
    'all three activation preconditions must be checked at the call site');
});

test('_151: the armed flag is process memory only — never read from or written to disk', () => {
  const src = bridgeSrc();
  assert.match(src, /^let _mirrorArm = null;/m,
    'the arm is a module-scope let initialised to null: every process start is DISARMED');
  for (const m of src.matchAll(/^.*_mirrorArm.*$/gm)) {
    assert.doesNotMatch(m[0], /writeFile|readFile|JSON\.parse|localStorage|process\.env/,
      `the arm state must never be persisted or read from the environment: ${m[0].trim()}`);
  }
});

// ── _176 §3.4: a DELIBERATE ruling reversal, with its guard rewritten ──────
//
// `_155` §10 ruled that the remembered SELECTION stays in process memory, and
// the test that used to live here asserted `_lastSelection` never touched disk.
// Operator order (design report 20260806_174) reverses that: selections now
// persist to a machine-owned `bench_mirror_state.yaml`.
//
// The rewrite below is NOT "the old guard, relaxed". The invariant the old test
// was really protecting — A CHECKED-IN OR DEPLOYED FILE CAN NEVER ARM HARDWARE —
// is asserted here MORE strongly than before, because it is now a property of
// the schema rather than of a `Map`: the state file's admitted key sets cannot
// express an arm bit, an address, a universe or a host, so there is no file
// content that could activate anything. What did become permissible is exactly
// one thing: writing a (source, reverse) pair per slot, through one guarded
// atomic writer, on ARM success only.

test('_176 §3.4: `_lastSelection` is GONE — the state file is the only store', () => {
  const src = bridgeSrc();
  assert.doesNotMatch(src, /_lastSelection/,
    'two stores would drift; the process-memory one was deleted, not kept alongside the file');
  assert.match(src, /readBenchMirrorState\(BENCH_MIRROR_STATE_ROOT, scene\)/,
    'the picker reads the file FRESH — there is no cache to go stale');
});

test('_176 §3.4: the state SCHEMA cannot express an arm bit or any plumbing', () => {
  // The `_151` test above still proves the armed flag itself never persists.
  // THIS is the new half: even a hand-written or deployed state file cannot
  // activate hardware, because no admitted key could hold a route. Same
  // technique the sidecar's SLOT_KEYS assertion uses — the schema IS the
  // guarantee, so the test asserts the schema rather than scanning text.
  const forbidden = ['armed', 'enabled', 'universe', 'address', 'addr', 'ip', 'host',
    'priority', 'controller'];
  for (const key of [...STATE_KEYS, ...SELECTION_KEYS, ...SLOT_STATE_KEYS]) {
    assert.ok(!forbidden.includes(key.toLowerCase()),
      `the state schema must not admit '${key}' — a state file must not be able to arm anything`);
  }
  assert.deepEqual([...STATE_KEYS].sort(), ['selections', 'state_version']);
  assert.deepEqual([...SELECTION_KEYS].sort(), ['slots']);
  assert.deepEqual([...SLOT_STATE_KEYS].sort(), ['reverse', 'source']);
});

test('_176 §3.2: the bridge writes state through the ONE guarded writer, on ARM success', () => {
  const src = bridgeSrc();
  assert.equal((src.match(/writeBenchMirrorState\(/g) || []).length, 1,
    'exactly ONE call site — no second, unguarded write path');
  const armIdx = src.indexOf('async function armBenchMirror');
  const provenIdx = src.indexOf('if (unproven.length > 0) {', armIdx);
  const writeIdx = src.indexOf('writeBenchMirrorState(BENCH_MIRROR_STATE_ROOT', armIdx);
  assert.ok(armIdx > 0 && provenIdx > armIdx && writeIdx > provenIdx,
    'the write happens AFTER the ownership proof — a selection is only remembered once it is ' +
    'proven to have actually taken the hardware');
  assert.doesNotMatch(src, /writeBenchMirrorState\([^)]*\)[\s\S]{0,200}benchMirrorOptions/,
    'picker browsing never writes');
  assert.match(src, /const BENCH_MIRROR_STATE_ROOT =/,
    'one root, resolved once at load — a live arm cannot have it moved under it');
});

test('_151: the blackout precedes the sender close, and senders are held during it', () => {
  const src = bridgeSrc();
  assert.match(src, /if \(_mirrorDisarming\) continue;/,
    'a mirror sender must never be closed while its blackout frames are in flight');
  assert.match(src, /if \(_relayCloseHeld\) continue;/,
    'a RELAY sender must never be closed while the ARM\'s ship-dark zeros are in flight');
  assert.match(src, /for \(let i = 0; i < BLACKOUT_FRAMES; i \+= 1\) \{\s*await Promise\.all\(/,
    'the blackout must be AWAITED — Sender.close() sends nothing and the sacn package cannot ' +
    'set stream_terminated');
  const blackoutIdx = src.indexOf('await Promise.all(entries.map((entry) => sendVia(');
  const recomputeIdx = src.indexOf("recomputeRoutes(`bench mirror disarmed");
  assert.ok(blackoutIdx > 0 && recomputeIdx > blackoutIdx,
    'the disarm recompute (which closes the senders) must run AFTER the blackout');
  assert.match(src, /const BLACKOUT_FRAMES = 3;/, 'three all-zero frames, E1.31 convention');
});

test('_155 A2: the ARM zeroes the ship through the RETIRING relay senders, awaited', () => {
  const src = bridgeSrc();
  const armIdx = src.indexOf('async function armBenchMirror');
  const retiringIdx = src.indexOf('const retiring = [..._routeEntries.values()];', armIdx);
  const suspendIdx = src.indexOf('_relaySuspended = true;', armIdx);
  const zeroIdx = src.indexOf("'Ship blackout'", armIdx);
  const recomputeIdx = src.indexOf("recomputeRoutes(`bench mirror armed for", armIdx);
  assert.ok(retiringIdx > armIdx, 'the arm must capture the senders it is about to retire');
  assert.ok(suspendIdx > 0 && suspendIdx < zeroIdx,
    'raw relaying must stop BEFORE the zeros go out, or a raw frame interleaves with them');
  assert.ok(zeroIdx > 0 && recomputeIdx > zeroIdx,
    'the recompute that closes the relay senders must run AFTER the ship blackout');
  assert.match(src, /if \(!_relaySuspended\) \{\s*const ipTargets = outgoingSenders\.get\(universe\);/,
    'routeFrame must consult the suspension flag before relaying');
});

test('_152 D1/D2: the release window is closed at the SINGLE point relay senders are decided', () => {
  const src = bridgeSrc();
  const disarmIdx = src.indexOf('async function disarmBenchMirror');
  const holdIdx = src.indexOf('_blackoutHold = { scene: was.scene };', disarmIdx);
  const awaitIdx = src.indexOf('await _blackoutSettled', disarmIdx);
  assert.ok(disarmIdx > 0 && holdIdx > disarmIdx && awaitIdx > holdIdx,
    'the blackout hold must be raised before the disarm suspends');
  assert.match(src, /_mirrorDisarming = false;\s*_blackoutHold = null;/,
    'and dropped in the same step that clears the disarming flag');
  assert.equal((src.match(/hold: _blackoutHold/g) || []).length, 1,
    'exactly one place consults the hold: the partition every recompute runs through');
  // D2, now covering BOTH blackout directions.
  assert.match(src, /blackoutInFlight: blackoutInFlight\(\),/,
    'an ARM landing inside either blackout must be refused, not accepted');
  assert.match(src, /function blackoutInFlight\(\) \{\s*return _mirrorDisarming \|\| _armBlackoutInFlight;/,
    'both directions count as "a blackout is in flight"');
});

test('_151: the mirror-suppression log has its own signature (_105 F10)', () => {
  const src = bridgeSrc();
  const sigIdx = src.indexOf('const suppressedSig = mirrorSuppressed');
  const mirrorGateIdx = src.indexOf('if (mirrorSig !== _lastMirrorSig)');
  assert.ok(sigIdx > 0, 'the suppression loop must key on its own signature');
  assert.ok(sigIdx > mirrorGateIdx,
    'the suppression loop must sit OUTSIDE the mirrorSig gate, not inside it');
  assert.match(src, /if \(suppressedSig !== _lastSuppressedSig\) \{/);
});

test('_151: engine-owned pairs are subtracted from the mirror targets (_105 M2/F2)', () => {
  const src = bridgeSrc();
  assert.match(src, /if \(engineState\.owned\.has\(key\)\) \{ mirrorEngineClash\.push\(target\); continue; \}/,
    'no mirror Sender may be created for a pair the engine already delivers');
  assert.match(src, /disarmInBackground\(why, 'auto'\)/,
    'the engine claiming a mirrored pair mid-session must auto-disarm, not warn and continue');
  assert.doesNotMatch(src, /void disarmBenchMirror\(/,
    'every fire-and-forget disarm must go through disarmInBackground, which catches');
  assert.match(src, /function disarmInBackground\(reason, how\) \{\s*disarmBenchMirror\(reason, how\)\.catch\(/,
    'disarmInBackground must attach a catch');
});

test('_155: the bridge answers options/arm/disarm and pushes status to every new connection', () => {
  const src = bridgeSrc();
  assert.match(src, /data\.type === 'benchMirrorOptions'/);
  assert.match(src, /data\.type === 'benchMirrorArm' \|\| data\.type === 'benchMirrorDisarm'/);
  assert.match(src, /armBenchMirror\(typeof data\.scene === 'string' \? data\.scene : null,/);
  const connIdx = src.indexOf("wss.on('connection'");
  const pushIdx = src.indexOf("benchMirrorStatus({ reason: 'status on connect' })");
  assert.ok(pushIdx > connIdx, 'a newly connected (or reloaded) tab must be told the arm state');
  assert.match(src, /if \(_mirrorArm && _mirrorArm\.ws === ws\)/,
    'the arm is socket-scoped: the arming window disconnecting must disarm');
});

test('_155 A4: the mirror emits at a FIXED declared priority with a DISTINCT 16-byte CID', () => {
  const src = bridgeSrc();
  assert.match(src, /^const MIRROR_PRIORITY = 100;/m,
    'the composed frame must never inherit the inbound priority (_153 F3 corollary)');
  assert.match(src, /sendVia\(entry, mirrorPayload\(owner\.state, key\), MIRROR_PRIORITY, 'Bench mirror'\)/);
  assert.match(src, /defaultPacketOptions: \{ cid: MIRROR_CID, useRawDmxValues: true \}/,
    'mirror senders must carry their own CID — and RAW DMX values, or the sacn package ' +
    'would multiply the composed 0-255 bytes by 2.55 and clip (report 20260805_170)');
  assert.doesNotMatch(src, /priority: 15\d/, 'priority escalation above 150 was rejected');
  // A CID must be EXACTLY 16 bytes: the sacn package splices [...cid] into the
  // packet unchecked, so a short one shifts the entire frame.
  const { createHash } = require('node:crypto');
  assert.equal(createHash('md5').update('bm26:bridge-mirror').digest().length, 16);
});

test('_153 §10 / _158 D-158-3: a destination is emitted only when its regions are ONE frame',
  () => {
    const src = bridgeSrc();
    // Presence of every source…
    assert.match(src, /const required = owner\.state\.requiredSources\.get\(key\);/);
    assert.match(src, /if \(missing\.length > 0\) \{/);
    // …AND frame identity. The inbound E1.31 sequence is the only frame identity
    // on the wire, and it must reach the composition gate.
    assert.match(src, /function mirrorInbound\(universe, payload, sequence\)/);
    // `rawDmxPayload(packet)`, NOT `packet.payload`: the getter is the package's
    // PERCENT view and reading it was `_157` D1 / `_153` F1b+F7 (report
    // 20260805_170). The sequence argument is what this pin is really about.
    assert.match(src, /routeFrame\(universe, priority, rawDmxPayload\(packet\), packet\.sequence\)/,
      'the receive handler must pass the sequence through — without it the gate can only ask ' +
      '"are they all here", never "are they all here for the SAME frame"');
    assert.match(src, /_mirrorRegionSeq\.get\(key\)\.set\(universe, sequence\)/,
      'each region of the composed buffer must record the frame its bytes came from');
    assert.match(src, /const aligned = seqs\.length > 0 && seqs\.every\(v => v === seqs\[0\]\);/,
      'a frame is whole only when every region carries the same sequence');
    assert.match(src, /if \(!aligned\) \{/);
    assert.match(src, /continue;\s*\/\/ stays dirty; the next arrival re-schedules/);

    // No timeout-emit fallback: an incomplete OR misaligned destination stops
    // emitting and is REPORTED, never papered over with a half-fresh frame.
    const flushIdx = src.indexOf('function flushMirrors()');
    const flushBody = src.slice(flushIdx, src.indexOf('\nfunction ', flushIdx + 10));
    assert.doesNotMatch(flushBody, /setTimeout/,
      'there must be no timeout-emit fallback in the flush path');
    assert.match(src, /BENCH MIRROR source stalled/, 'a stalled source must be named, not ignored');
    assert.match(src, /BENCH MIRROR frame NOT WHOLE/,
      'and a misaligned one must be named too — that is the state that used to be invisible');
  });

test('_158 D-158-3: a misaligned frame is reported IMMEDIATELY, and names the symptom', () => {
  const src = bridgeSrc();
  // A missing source is normal for a few ms between an engine frame's
  // datagrams, so it waits for the settling window. Regions disagreeing about
  // WHICH frame they are is never normal, so it is logged at once.
  assert.match(src, /waited >= MIRROR_STALL_WARN_MS/, 'the missing-source case settles first');
  assert.match(src, /state\.count === 1 \|\| firstFixed/,
    'the misaligned case logs on the first occurrence, then throttled — and a newly-detected ' +
    'FIXED offset jumps the throttle, because it is a different diagnosis from the line before');
  // The strings below are split across template-literal lines in the source, so
  // match the distinctive halves rather than a contiguous sentence.
  assert.match(src, /its regions carry DIFFERENT engine/);
  assert.match(src, /frames \(\$\{regions\}\)/);
  assert.match(src, /U\$\{u\}#\$\{regionSeq\.get\(u\)\}/,
    'the log must name every region WITH the frame it is carrying, or it is not diagnosable');
  assert.match(src, /STEADY WRONG COLOUR, not flicker/,
    'the symptom must be named, because it is not the one the smoke procedure teaches');

  // R-158-A: the SAME state has two causes with OPPOSITE remedies, and the log
  // must say which one it is looking at.
  assert.match(src, /const MIRROR_FIXED_OFFSET_FLUSHES = \d+;/);
  assert.match(src, /filter\(\(\[, lag\]\) => lag > 0\)/,
    'a source that NEVER catches up across the window is what separates a fixed sender offset ' +
    'from a lost datagram — offsets swing within one frame, so consecutive readings never match');
  assert.match(src, /if \(!minLag\.has\(u\) \|\| lag < minLag\.get\(u\)\) minLag\.set\(u, lag\);/);
  assert.match(src, /BENCH MIRROR STUCK/);
  assert.match(src, /FIXED sequence offset/);
  assert.match(src, /This is NOT/);
  assert.match(src, /network loss and it will NOT recover on its own/);
  assert.match(src, /\*\*RESTART THE ENGINE\*\*/,
    'the remedy must be stated, not implied');
  assert.match(src, /function offsetSignature\(required, regionSeq\)/,
    'and the offset itself must be named — wrap-aware and signed, so seven frames behind ' +
    'reads as -7 rather than 249');
});

test('_158 D-158-8: the emission path carries NO permissive default', () => {
  const src = bridgeSrc();
  assert.doesNotMatch(src, /requiredSources\.get\(key\) \|\| new Set\(\)/,
    'an absent requiredSources entry must never degrade to "nothing required, emit anyway" — ' +
    'that is a silent permissive default on the one path that decides whether a half-fresh ' +
    'frame goes out');
  assert.match(src, /BENCH MIRROR INVARIANT VIOLATED/,
    'a missing entry is an invariant violation: shout and disarm');
  // …and the per-destination bookkeeping is torn down through ONE helper, so the
  // retire path and the disarm path cannot drift apart.
  assert.match(src, /function forgetMirrorGather\(key\) \{/);
  const retireIdx = src.indexOf('Bench mirror sender removed');
  const helperUse = src.lastIndexOf('forgetMirrorGather(key);', retireIdx);
  assert.ok(helperUse > 0 && retireIdx - helperUse < 400,
    'the mirror-sender retire path must forget the destination through the shared helper');
});

test('the bridge subscribes to mirror source universes before building senders', () => {
  const src = bridgeSrc();
  const subIdx = src.indexOf('bench mirror source (scene');
  const diffIdx = src.indexOf('// Diff → close removed senders');
  assert.ok(subIdx > 0 && diffIdx > subIdx,
    'mirror sources must join the subscription union before the sender diff');
});

test('_171: the ARM no longer gates anything — the guarantee moved to structure', () => {
  // `_155` A3 / R-23 pinned a handshake with the output bridge: the ARM had to
  // gate :6972 and refuse without an ack, because a browser could otherwise
  // out-shout the mirror at priority 150. Operator ruling 2026-08-05 removed the
  // browser's transmit path entirely, so there is nothing to gate and no ack to
  // wait for. The COVERAGE did not go away — it moved to
  // `tests/browser_transmit_absence.test.js`, which asserts the absence itself,
  // and that is the stronger statement: a gated stream is a live capability held
  // shut, while an absent one cannot be re-opened by a flag or lost mid-blackout.
  const src = bridgeSrc();
  assert.doesNotMatch(src, /setOutputGate|proveOutputGateHeld|benchMirrorGate/,
    'no gate machinery may survive in the input bridge');
  assert.match(src, /ONE-WRITER IS NOW STRUCTURAL, NOT GATED/,
    'and the arm section must say why it stopped asking');
  const out = fs.readFileSync(path.join(SIM_ROOT, 'server', 'sacn_output_bridge.js'), 'utf8');
  assert.doesNotMatch(out, /require\(['"]sacn['"]\)/,
    'the output bridge must hold no sender at all — that is what makes the arm provable');
});
