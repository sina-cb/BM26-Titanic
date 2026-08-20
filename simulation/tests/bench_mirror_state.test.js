/**
 * bench_mirror_state.test.js — the MACHINE-OWNED remembered bench-mirror
 * selection file (lib/bench_mirror_state.cjs, design report 20260806_174 §3.1).
 *
 * What is actually at stake here, in operator terms:
 *   - a remembered selection that comes back WRONG lights the wrong ship fixture
 *     on the bench while the log stays green — the same failure class the whole
 *     bench-mirror subsystem exists to make impossible, so every rot path must
 *     be a NAMED refusal rather than a best guess;
 *   - a selection remembered for one ship scene leaking into another is the same
 *     bug wearing a different hat, so the keying is asserted structurally;
 *   - a state file that could carry an address or an arm bit would turn a
 *     `robocopy /MIR` deploy into something that can light hardware, so the
 *     schema itself is asserted;
 *   - and a TEST that writes into `simulation/scenes/**` destroys the
 *     byte-identity proof the whole slice rests on, so the writer's
 *     test-context refusal is asserted directly.
 *
 * ZERO PORTS, ZERO PACKETS, ZERO WRITES OUTSIDE `~/tmp`. Every write below goes
 * to a fresh scratch root under the home tmp directory.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SIM_LIB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'lib');
const yaml = require('js-yaml');
const {
  parseBenchMirrorState, serializeBenchMirrorState, emptyBenchMirrorState,
  setSceneSelection, sceneSelection, benchMirrorStatePath, readBenchMirrorState,
  writeBenchMirrorState, isTestContext,
  STATE_VERSION, BENCH_MIRROR_STATE_FILE, REAL_SCENES_ROOT,
  STATE_KEYS, SELECTION_KEYS, SLOT_STATE_KEYS,
} = require('../lib/bench_mirror_state.cjs');

/** A fresh scratch scenes root. Never the repo's. */
let _seq = 0;
function scratchRoot(scenes = ['test_bench']) {
  _seq += 1;
  const root = path.join(os.homedir(), 'tmp', 'fix_176', 'state',
    `${process.pid}-${_seq}`);
  fs.rmSync(root, { recursive: true, force: true });
  for (const s of scenes) fs.mkdirSync(path.join(root, s), { recursive: true });
  return root;
}

const parse = (tree) => parseBenchMirrorState(tree, 'state');

function baseTree(over = {}) {
  return {
    state_version: STATE_VERSION,
    selections: {
      titanic: {
        slots: {
          par_1: { source: 'Left Auditorium 5', reverse: false },
          bar_left: { source: 'Left Front Wall 1', reverse: true },
          led_0: { source: 'none', reverse: false },
        },
      },
    },
    ...over,
  };
}

// ── Schema: every refusal is named ─────────────────────────────────────────

test('parse accepts a well-formed v1 state and normalizes `none` to null', () => {
  const state = parse(baseTree());
  assert.equal(state.stateVersion, 1);
  assert.deepEqual(state.selections.titanic.slots, {
    par_1: { source: 'Left Auditorium 5', reverse: false },
    bar_left: { source: 'Left Front Wall 1', reverse: true },
    led_0: { source: null, reverse: false },
  });
  assert.deepEqual(sceneSelection(state, 'titanic').par_1,
    { source: 'Left Auditorium 5', reverse: false });
  assert.deepEqual(sceneSelection(state, 'never_armed'), {},
    'a scene with nothing remembered is an empty map, not a throw and not a guess');
});

test('an unknown version is refused BY NAME, before the key sweep', () => {
  for (const v of [0, 2, '1', null, undefined]) {
    assert.throws(() => parse(baseTree({ state_version: v })), /state_version must be 1/,
      `version ${JSON.stringify(v)} must be refused`);
  }
  // A future layout's NEW keys must still produce the version message, not
  // "unknown key" — the `_158` D-158-5 ordering lesson, applied here up front.
  const future = baseTree({ state_version: 2 });
  future.brand_new_key = 1;
  assert.throws(() => parse(future), /state_version must be 1/);
});

test('a non-mapping file is refused', () => {
  for (const bad of [null, undefined, [1, 2], 'text', 7]) {
    assert.throws(() => parse(bad), /must contain a mapping/);
  }
});

test('every unknown key is refused, at every level — never ignored', () => {
  assert.throws(() => parse(baseTree({ armed: true })), /unknown key 'armed'/);
  const scene = baseTree();
  scene.selections.titanic.universe = 2;
  assert.throws(() => parse(scene), /unknown key 'universe'/);
  const slot = baseTree();
  slot.selections.titanic.slots.par_1.dmxAddress = 1;
  assert.throws(() => parse(slot), /unknown key 'dmxAddress'/);
});

test('`reverse` must be a STRICT boolean — no truthy pixel order', () => {
  for (const bad of ['true', 1, 'yes', null, undefined, {}]) {
    const tree = baseTree();
    tree.selections.titanic.slots.par_1.reverse = bad;
    assert.throws(() => parse(tree), /must be true or false/,
      `reverse=${JSON.stringify(bad)} must be refused`);
    assert.throws(() => parse(tree), /two-state physical fact/);
  }
});

test('`source` must be a non-empty string or the literal `none`', () => {
  for (const bad of [null, undefined, '', '   ', 42, {}]) {
    const tree = baseTree();
    tree.selections.titanic.slots.par_1.source = bad;
    assert.throws(() => parse(tree), /must name a source fixture/,
      `source=${JSON.stringify(bad)} must be refused`);
    assert.throws(() => parse(tree), /an absent key would silently decide a pre-selection/);
  }
});

test('a malformed slot / scene / slots block is refused, naming the path', () => {
  const flat = baseTree();
  flat.selections.titanic.slots.par_1 = 'Left Auditorium 5';
  assert.throws(() => parse(flat), /slots\.par_1: must be a mapping \{ source, reverse \}/);
  const noSlots = baseTree();
  noSlots.selections.titanic = { };
  assert.throws(() => parse(noSlots), /selections\.titanic\.slots: must be a mapping/);
  const badScene = baseTree();
  badScene.selections.titanic = [];
  assert.throws(() => parse(badScene), /selections\.titanic: must be a mapping/);
  const badSel = baseTree({ selections: 'nope' });
  assert.throws(() => parse(badSel), /selections: must be a mapping of SOURCE scene name/);
  const badId = baseTree();
  badId.selections.titanic.slots['Bar Left'] = { source: 'x', reverse: false };
  assert.throws(() => parse(badId), /slot id must be snake_case/);
});

test('THE SCHEMA IS THE DEPLOYMENT GUARD: no key could hold an arm bit or a route', () => {
  const admitted = [...STATE_KEYS, ...SELECTION_KEYS, ...SLOT_STATE_KEYS].map(k => k.toLowerCase());
  for (const forbidden of ['armed', 'enabled', 'universe', 'address', 'addr', 'ip', 'host',
    'priority', 'controller', 'scene']) {
    assert.ok(!admitted.includes(forbidden),
      `'${forbidden}' must not be an admitted key — a deployed state file must be unable to ` +
      'activate hardware, and the only durable way to guarantee that is for no key to exist');
  }
  assert.deepEqual([...STATE_KEYS].sort(), ['selections', 'state_version']);
  assert.deepEqual([...SLOT_STATE_KEYS].sort(), ['reverse', 'source']);
});

// ── Round-trip ─────────────────────────────────────────────────────────────

test('serialize → parse is an exact round-trip, and is byte-stable', () => {
  const state = parse(baseTree());
  const text = serializeBenchMirrorState(state);
  assert.deepEqual(parse(yaml.load(text)), state);
  assert.equal(serializeBenchMirrorState(parse(yaml.load(text))), text,
    'the same selection re-armed twice must produce the same bytes — a state file that churns ' +
    'on every arm is noise in git status');
  assert.match(text, /^# bench_mirror_state\.yaml — MACHINE-WRITTEN/,
    'the file says what it is, and that it can be deleted');
  assert.match(text, /CANNOT arm anything/);
  // `null` goes back out as the literal `none`: absence is never a choice.
  assert.match(text, /led_0:\s*\n\s*source: none/);
});

test('setSceneSelection replaces ONE scene key and leaves the others alone', () => {
  const state = parse(baseTree());
  const next = setSceneSelection(state, 'other_ship', {
    par_1: { source: 'Elsewhere 1', reverse: false },
  });
  assert.deepEqual(Object.keys(next.selections).sort(), ['other_ship', 'titanic']);
  assert.deepEqual(next.selections.titanic, state.selections.titanic, 'untouched');
  // Whole-key replacement: a slot that vanished from the sidecar does not linger.
  const shrunk = setSceneSelection(next, 'titanic', {
    par_1: { source: 'Left Auditorium 5', reverse: false },
  });
  assert.deepEqual(Object.keys(shrunk.selections.titanic.slots), ['par_1']);
  assert.deepEqual(Object.keys(state.selections.titanic.slots).sort(),
    ['bar_left', 'led_0', 'par_1'], 'and it is pure — the input is not mutated');
  assert.throws(() => setSceneSelection(state, '', {}), /must be a non-empty string/);
  assert.throws(() => setSceneSelection(state, 'x', { a: { source: 'y', reverse: 'no' } }),
    /must be a boolean/);
});

// ── Paths + the write guards ───────────────────────────────────────────────

test('a scene name is a single directory name — never a path', () => {
  const root = scratchRoot();
  assert.equal(benchMirrorStatePath(root, 'test_bench'),
    path.join(root, 'test_bench', BENCH_MIRROR_STATE_FILE));
  for (const bad of ['..', '../elsewhere', 'a/b', '', '   ']) {
    assert.throws(() => benchMirrorStatePath(root, bad), /\[BenchMirrorState\]/,
      `scene ${JSON.stringify(bad)} must be refused`);
  }
  assert.throws(() => benchMirrorStatePath('', 'test_bench'), /non-empty absolute path/);
});

test('_176 §5.3: a TEST-CONTEXT write into the REPO\'s real scenes dir is REFUSED', () => {
  assert.equal(isTestContext(), true,
    'this suite runs under `node --test`, which is what the guard keys on');
  // Operator ruling (2026-08-20): `simulation/scenes/test_bench/bench_mirror_state.yaml`
  // is a deliberately TRACKED test-bench mirror file — it stays checked in, so this
  // guard can no longer assert the file is ABSENT. What it is actually guarding is
  // that this suite never WRITES to the repo's real scenes directory, so snapshot
  // the file's bytes (or its absence) before the refused writes below, and assert
  // the exact same bytes (or the exact same absence) afterward — present-and-
  // unchanged is proof of non-mutation just as much as absent-and-still-absent is.
  const realFile = path.join(REAL_SCENES_ROOT, 'test_bench', BENCH_MIRROR_STATE_FILE);
  const before = fs.existsSync(realFile)
    ? { present: true, bytes: fs.readFileSync(realFile) }
    : { present: false };
  const state = parse(baseTree());
  assert.throws(() => writeBenchMirrorState(REAL_SCENES_ROOT, 'test_bench', state),
    /refusing to write/);
  assert.throws(() => writeBenchMirrorState(REAL_SCENES_ROOT, 'test_bench', state),
    /NODE_TEST_CONTEXT is set/);
  assert.throws(() => writeBenchMirrorState(REAL_SCENES_ROOT, 'test_bench', state),
    /destroys the byte-identity proof/);
  // …and the file is exactly as this suite found it — no silent "close enough".
  if (before.present) {
    assert.equal(fs.existsSync(realFile), true,
      'the repo scene directory must be untouched by this suite');
    assert.ok(fs.readFileSync(realFile).equals(before.bytes),
      'the tracked test-bench mirror file must be byte-identical after this suite');
  } else {
    assert.equal(fs.existsSync(realFile), false,
      'the repo scene directory must be untouched by this suite');
  }
});

test('the writer refuses a scene directory that does not exist — it never creates scenes', () => {
  const root = scratchRoot();
  assert.throws(() => writeBenchMirrorState(root, 'no_such_scene', parse(baseTree())),
    /the scene directory .* does not exist/);
});

test('write → read is an exact reload, atomically, with no tmp residue', () => {
  const root = scratchRoot();
  const state = parse(baseTree());
  const written = writeBenchMirrorState(root, 'test_bench', state);
  assert.equal(written.path, path.join(root, 'test_bench', BENCH_MIRROR_STATE_FILE));
  assert.ok(written.bytes > 0);
  const back = readBenchMirrorState(root, 'test_bench');
  assert.equal(back.present, true);
  assert.equal(back.error, null);
  assert.deepEqual(back.state, state, 'the exact selection comes back, reverse flags included');
  assert.deepEqual(fs.readdirSync(path.join(root, 'test_bench')), [BENCH_MIRROR_STATE_FILE],
    'the tmp file is renamed, never left behind');
});

test('an ABSENT state file is the defined initial condition, not an error', () => {
  const root = scratchRoot();
  const back = readBenchMirrorState(root, 'test_bench');
  assert.equal(back.present, false);
  assert.equal(back.error, null);
  assert.deepEqual(back.state, emptyBenchMirrorState());
  assert.deepEqual(sceneSelection(back.state, 'titanic'), {},
    'nothing remembered means nothing pre-filled — never a substituted default');
});

test('an UNREADABLE state file reports loudly and remembers NOTHING', () => {
  const root = scratchRoot();
  const file = path.join(root, 'test_bench', BENCH_MIRROR_STATE_FILE);
  for (const [what, text] of [
    ['bad yaml', 'state_version: 1\n  selections: {\n'],
    ['wrong version', 'state_version: 9\nselections: {}\n'],
    ['unknown key', 'state_version: 1\nselections: {}\narmed: true\n'],
    ['bad reverse', 'state_version: 1\nselections:\n  titanic:\n    slots:\n' +
      "      par_1: { source: 'X', reverse: 'yes' }\n"],
  ]) {
    fs.writeFileSync(file, text, 'utf8');
    const back = readBenchMirrorState(root, 'test_bench');
    assert.equal(back.present, true, what);
    assert.match(back.error, /is unreadable/, what);
    assert.match(back.error, /until the file is fixed or deleted/, what);
    assert.deepEqual(back.state, emptyBenchMirrorState(),
      `${what}: a half-parsed file must yield NO remembered selections, not some of them`);
  }
});

test('_176 §3.2: an overwrite replaces one scene key and preserves every other', () => {
  const root = scratchRoot();
  writeBenchMirrorState(root, 'test_bench', setSceneSelection(
    parse(baseTree()), 'other_ship', { par_1: { source: 'Elsewhere 1', reverse: true } }));
  const loaded = readBenchMirrorState(root, 'test_bench').state;
  const updated = setSceneSelection(loaded, 'titanic', {
    par_1: { source: 'Left Auditorium 9', reverse: false },
  });
  writeBenchMirrorState(root, 'test_bench', updated);
  const again = readBenchMirrorState(root, 'test_bench').state;
  assert.deepEqual(again.selections.titanic.slots,
    { par_1: { source: 'Left Auditorium 9', reverse: false } });
  assert.deepEqual(again.selections.other_ship.slots,
    { par_1: { source: 'Elsewhere 1', reverse: true } },
    'another source scene\'s remembered mapping survives — arming titanic must not forget it');
});

test('_176 §3.2: a FRESH PROCESS reads back the exact selection, reverse flags included', () => {
  // The point of persisting at all: the store is destroyed and recreated — a
  // whole new node process, a whole new module instance, no shared memory of any
  // kind — and the remembered mapping is still exactly what was armed.
  const root = scratchRoot();
  const state = setSceneSelection(parse(baseTree()), 'other_ship', {
    bar_right: { source: 'Elsewhere 9', reverse: true },
  });
  writeBenchMirrorState(root, 'test_bench', state);
  // With `node -e`, the extra arguments start at process.argv[1].
  const script =
    'const s=require(process.argv[1]);' +
    'process.stdout.write(JSON.stringify(s.readBenchMirrorState(process.argv[2],"test_bench")));';
  const out = execFileSync(process.execPath,
    ['-e', script, path.join(SIM_LIB, 'bench_mirror_state.cjs'), root],
    // NODE_TEST_CONTEXT is deliberately NOT inherited: this child is a plain
    // process, exactly like the bridge on the show machine.
    { env: { ...process.env, NODE_TEST_CONTEXT: '' }, encoding: 'utf8' });
  const reloaded = JSON.parse(out);
  assert.equal(reloaded.present, true);
  assert.equal(reloaded.error, null);
  assert.deepEqual(reloaded.state, JSON.parse(JSON.stringify(state)),
    'a fresh process reloads the selection EXACTLY — sources, `none`s and reverse flags');
});

test('_176: an explicit reset-to-defaults, once armed, is what the file then holds', () => {
  // The picker's `↺ scene defaults` stages sidecar defaults + NORMAL; the ARM is
  // what makes that durable. Modelled here at the file level: the reset
  // selection replaces a REVERSED one and stays replaced across a reload.
  const root = scratchRoot();
  writeBenchMirrorState(root, 'test_bench', parse(baseTree()));
  assert.equal(readBenchMirrorState(root, 'test_bench').state
    .selections.titanic.slots.bar_left.reverse, true);
  const reset = setSceneSelection(readBenchMirrorState(root, 'test_bench').state, 'titanic', {
    par_1: { source: 'Left Auditorium 5', reverse: false },
    bar_left: { source: 'Left Front Wall 1', reverse: false },
    led_0: { source: null, reverse: false },
  });
  writeBenchMirrorState(root, 'test_bench', reset);
  const back = readBenchMirrorState(root, 'test_bench').state;
  assert.equal(back.selections.titanic.slots.bar_left.reverse, false,
    'the reset is durable — REVERSED does not come back from anywhere');
  assert.equal(back.selections.titanic.slots.led_0.source, null);
});
