/**
 * bench_mirror_state.cjs — the MACHINE-OWNED remembered picker state for the
 * bench mirror (design report 20260806_174 §3.1/§3.2).
 *
 * WHAT THIS IS. One file per bench scene, sibling of that scene's
 * `bench_mirror.yaml`:
 *
 *     simulation/scenes/<benchScene>/bench_mirror_state.yaml
 *
 * It remembers, per SOURCE scene, what the operator last armed: which source
 * fixture feeds each slot, and whether that slot's pixels are REVERSED. That is
 * all it can express — see "WHAT IT CANNOT SAY" below.
 *
 * WHY IT IS NOT PART OF `bench_mirror.yaml` (the v3 sidecar). Three reasons,
 * each sufficient on its own:
 *
 *   1. The sidecar is HAND-WRITTEN and ~70 lines of it are operator-facing
 *      commentary. `yaml.dump` keeps no comments, so the first machine rewrite
 *      would delete the documentation that makes the file usable.
 *   2. The v3 contract is "the sidecar declares only what cannot be derived"
 *      (`bench_mirror.cjs:24-44`). A last-used selection is runtime memory, not
 *      a declaration.
 *   3. A checked-in declarative file must stay byte-stable while state churns.
 *      This is the same tracked-runtime-residue split already accepted for
 *      `marsin_engine/states/**`.
 *
 * So: no version bump on the sidecar, no migration, zero risk to it. This file
 * is new, additive, and safe to delete (you lose remembered selections).
 *
 * WHY PERSISTING IS SAFE NOW — answering the `_155` §10 rationale head-on.
 * `_155` kept the remembered selection in process memory because a file could
 * (a) rot against the scene and (b) ride a `robocopy /MIR` onto the show server.
 * Both are answered rather than ignored:
 *
 *   (a) ROT IS DETECTED, LOUDLY. The bridge re-validates every stored entry at
 *       picker-open AND at ARM against the CURRENT source scene. A stored name
 *       that no longer resolves is reported by name and pre-fills NOTHING; it is
 *       never silently applied and never silently swapped for something else.
 *   (b) A DEPLOYED COPY CANNOT LIGHT ANYTHING. The key sets below cannot express
 *       an arm bit, a universe, an address, a host or a priority — a selection
 *       is a pair of (fixture name, boolean). Arming remains an operator gesture
 *       held in the bridge's process memory and cleared on every start.
 *
 * WHAT IT CANNOT SAY (asserted directly by the tests, via the exported key
 * sets): `armed`, `enabled`, any address, any universe, any IP. There is no key
 * that would hold one, so a hand-edited or deployed state file cannot activate
 * hardware — the same "the schema IS the guarantee" technique `SLOT_KEYS` gives
 * the sidecar.
 *
 * FAIL LOUD. Every structural problem THROWS with the offending path named.
 * There is no lenient mode and no partial application: a state file that does
 * not parse yields NO remembered selections and says so, rather than half of
 * them.
 *
 * PURE-ISH. Everything except `readBenchMirrorState` / `writeBenchMirrorState`
 * is pure. Both of those take an EXPLICIT absolute scenes root — there is no
 * ambient path in this module — which is the seam that lets tests point writes
 * at a scratch directory. See `assertWritableTarget` for the guard that makes
 * that seam un-bypassable.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const yaml = require('js-yaml');

/**
 * The only state layout this build understands. A different number is REFUSED
 * by name — never read with assumed meanings, never partially applied.
 */
const STATE_VERSION = 1;

/** Filename, sibling of `bench_mirror.yaml` inside a bench scene directory. */
const BENCH_MIRROR_STATE_FILE = 'bench_mirror_state.yaml';

/** The literal a slot uses to say "feed me nothing — hold this fixture dark". */
const NONE_SOURCE = 'none';

const STATE_KEYS = new Set(['state_version', 'selections']);
const SELECTION_KEYS = new Set(['slots']);
const SLOT_STATE_KEYS = new Set(['source', 'reverse']);

/** Slot ids are snake_case, exactly as the sidecar declares them. */
const SLOT_ID_RE = /^[a-z][a-z0-9_]*$/;

/**
 * The repo's REAL scenes directory, derived from this file's own location
 * (`simulation/lib/` → `simulation/scenes/`). Used by ONE thing: the
 * test-context write guard below. Nothing else in this module has an ambient
 * path.
 */
const REAL_SCENES_ROOT = path.resolve(__dirname, '..', 'scenes');

/** The header the writer stamps on every state file it produces. */
const STATE_FILE_HEADER = [
  `# ${BENCH_MIRROR_STATE_FILE} — MACHINE-WRITTEN by the sACN bridge.`,
  '#',
  '# Rewritten on every SUCCESSFUL bench-mirror ARM. Safe to delete: you lose the',
  '# remembered picker selections and nothing else. This file CANNOT arm anything —',
  '# it carries no arm bit, no universe, no address and no host, and the parser',
  '# refuses any key that is not `state_version` / `selections`.',
  '#',
  '# `selections` is keyed by the SOURCE scene (whatever the engine was running at',
  '# ARM time), so a mapping remembered for one ship scene can never surface under',
  '# another. `reverse: true` means "this bench fixture is wired opposite to its',
  '# source" — pure relative orientation between the two physical fixtures.',
  '#',
  '# Hand edits are allowed but pointless: the next successful ARM overwrites the',
  '# scene key wholesale. Anything stale here is reported by name at picker-open.',
  '',
].join('\n');

/** Throw with the path that is wrong. */
function fail(where, message) {
  throw new Error(`[BenchMirrorState] ${where}: ${message}`);
}

function requireKnownKeys(obj, allowed, where) {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      fail(where, `unknown key '${key}' — allowed: ${[...allowed].sort().join(', ')}. ` +
        'Refusing to ignore it silently; a typo in remembered state is a silently wrong ' +
        'pre-selection on a physical fixture.');
    }
  }
}

/** The state of a bench scene that has never been armed. Not a fallback: this is
 * the DEFINED initial condition, and it pre-fills nothing anywhere. */
function emptyBenchMirrorState() {
  return { stateVersion: STATE_VERSION, selections: {} };
}

/**
 * Parse + validate a `bench_mirror_state.yaml` tree (the `yaml.load()` result).
 *
 * @param {*} tree parsed YAML
 * @param {string} label where it came from, for error messages
 * @returns {{stateVersion:number,
 *            selections:Object<string,{slots:Object<string,{source:(string|null),
 *                                                           reverse:boolean}>}>}}
 */
function parseBenchMirrorState(tree, label) {
  const where = label || BENCH_MIRROR_STATE_FILE;
  if (!tree || typeof tree !== 'object' || Array.isArray(tree)) {
    fail(where, 'the file must contain a mapping (state_version / selections)');
  }
  // VERSION FIRST, before the unknown-key sweep — the same ordering lesson the
  // sidecar learned in `_158` D-158-5: a future layout's new keys would
  // otherwise produce "unknown key 'x'" instead of "this build reads v1 only".
  if (tree.state_version !== STATE_VERSION) {
    fail(where, `state_version must be ${STATE_VERSION} (got ` +
      `${JSON.stringify(tree.state_version)}) — this build does not know how to read any other ` +
      'layout. Delete the file to start over; you lose only remembered picker selections.');
  }
  requireKnownKeys(tree, STATE_KEYS, where);

  const selections = {};
  const rawSelections = tree.selections === undefined ? {} : tree.selections;
  if (!rawSelections || typeof rawSelections !== 'object' || Array.isArray(rawSelections)) {
    fail(`${where}.selections`, 'must be a mapping of SOURCE scene name → { slots: … } ' +
      `(got ${JSON.stringify(tree.selections)})`);
  }
  for (const sceneName of Object.keys(rawSelections)) {
    const sWhere = `${where}.selections.${sceneName}`;
    if (sceneName.trim() === '') fail(sWhere, 'a source scene key must not be blank');
    const entry = rawSelections[sceneName];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      fail(sWhere, `must be a mapping with a 'slots' key (got ${JSON.stringify(entry)})`);
    }
    requireKnownKeys(entry, SELECTION_KEYS, sWhere);
    const rawSlots = entry.slots;
    if (!rawSlots || typeof rawSlots !== 'object' || Array.isArray(rawSlots)) {
      fail(`${sWhere}.slots`, 'must be a mapping of slot id → { source, reverse } ' +
        `(got ${JSON.stringify(rawSlots)})`);
    }
    const slots = {};
    for (const slotId of Object.keys(rawSlots)) {
      const slWhere = `${sWhere}.slots.${slotId}`;
      if (!SLOT_ID_RE.test(slotId)) {
        fail(slWhere, `slot id must be snake_case (got ${JSON.stringify(slotId)}) — it is the ` +
          'stable key the sidecar, the picker and the WS protocol all use');
      }
      const raw = rawSlots[slotId];
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        fail(slWhere, `must be a mapping { source, reverse } (got ${JSON.stringify(raw)})`);
      }
      requireKnownKeys(raw, SLOT_STATE_KEYS, slWhere);
      if (typeof raw.source !== 'string' || raw.source.trim() === '') {
        fail(`${slWhere}.source`, 'must name a source fixture, or the literal ' +
          `'${NONE_SOURCE}' for a slot that was held dark (got ${JSON.stringify(raw.source)}). ` +
          'There is no implicit value: an absent key would silently decide a pre-selection.');
      }
      // STRICT boolean. `'true'`, `1` and `yes` are all refused: a truthy-string
      // reverse flag would be the classic silent "REVERSED because YAML".
      if (typeof raw.reverse !== 'boolean') {
        fail(`${slWhere}.reverse`, 'must be true or false (got ' +
          `${JSON.stringify(raw.reverse)}) — pixel order is a two-state physical fact, ` +
          'not a truthy value');
      }
      const source = raw.source.trim();
      slots[slotId] = { source: source === NONE_SOURCE ? null : source, reverse: raw.reverse };
    }
    selections[sceneName] = { slots };
  }
  return { stateVersion: tree.state_version, selections };
}

/**
 * The YAML text for a state object. Deterministic key order (scenes and slots
 * sorted) so an unchanged selection re-armed twice produces a byte-identical
 * file — a state file that churns on every arm is noise in `git status`.
 *
 * @param {Object} state from `parseBenchMirrorState` / `emptyBenchMirrorState`
 * @returns {string}
 */
function serializeBenchMirrorState(state) {
  const tree = { state_version: STATE_VERSION, selections: {} };
  for (const sceneName of Object.keys(state.selections || {}).sort()) {
    const slots = {};
    const entry = state.selections[sceneName];
    for (const slotId of Object.keys((entry && entry.slots) || {}).sort()) {
      const sel = entry.slots[slotId];
      slots[slotId] = {
        source: sel.source === null ? NONE_SOURCE : sel.source,
        reverse: sel.reverse === true,
      };
    }
    tree.selections[sceneName] = { slots };
  }
  return `${STATE_FILE_HEADER}${yaml.dump(tree, { lineWidth: 100, noRefs: true })}`;
}

/**
 * Replace ONE source scene's remembered selection, leaving every other scene's
 * entry untouched. Pure — returns a new state object.
 *
 * Whole-key replacement is deliberate: a merge would let a slot that no longer
 * exists in the sidecar survive forever.
 *
 * @param {Object} state
 * @param {string} sourceScene
 * @param {Object<string,{source:(string|null), reverse:boolean}>} slots
 * @returns {Object} a new state
 */
function setSceneSelection(state, sourceScene, slots) {
  if (typeof sourceScene !== 'string' || sourceScene.trim() === '') {
    fail('setSceneSelection', `the source scene must be a non-empty string (got ` +
      `${JSON.stringify(sourceScene)})`);
  }
  const next = { stateVersion: STATE_VERSION, selections: { ...(state.selections || {}) } };
  const clean = {};
  for (const slotId of Object.keys(slots || {})) {
    const sel = slots[slotId];
    if (!sel || typeof sel !== 'object') {
      fail(`setSceneSelection.${slotId}`,
        `must be { source, reverse } (got ${JSON.stringify(sel)})`);
    }
    if (sel.source !== null && (typeof sel.source !== 'string' || sel.source.trim() === '')) {
      fail(`setSceneSelection.${slotId}.source`,
        `must be a fixture name or null (got ${JSON.stringify(sel.source)})`);
    }
    if (typeof sel.reverse !== 'boolean') {
      fail(`setSceneSelection.${slotId}.reverse`,
        `must be a boolean (got ${JSON.stringify(sel.reverse)})`);
    }
    clean[slotId] = { source: sel.source, reverse: sel.reverse };
  }
  next.selections[sourceScene.trim()] = { slots: clean };
  return next;
}

/** The remembered slots for one source scene, or `{}` when there are none. */
function sceneSelection(state, sourceScene) {
  const entry = (state && state.selections) ? state.selections[sourceScene] : undefined;
  return (entry && entry.slots) ? entry.slots : {};
}

/** Where a bench scene's state file lives under an EXPLICIT scenes root. */
function benchMirrorStatePath(scenesRoot, benchScene) {
  if (typeof scenesRoot !== 'string' || scenesRoot.trim() === '') {
    fail('benchMirrorStatePath', `the scenes root must be a non-empty absolute path (got ` +
      `${JSON.stringify(scenesRoot)})`);
  }
  if (typeof benchScene !== 'string' || benchScene.trim() === '') {
    fail('benchMirrorStatePath', `the bench scene must be a non-empty name (got ` +
      `${JSON.stringify(benchScene)})`);
  }
  const root = path.resolve(scenesRoot);
  const dir = path.resolve(root, benchScene);
  // A scene name carrying a separator or `..` would escape the injected root —
  // which is the whole point of injecting one.
  if (dir !== path.join(root, benchScene) || path.dirname(dir) !== root) {
    fail('benchMirrorStatePath', `the bench scene name ${JSON.stringify(benchScene)} does not ` +
      `resolve to a direct child of '${root}' — a scene name is a single directory name, never ` +
      'a path');
  }
  return path.join(dir, BENCH_MIRROR_STATE_FILE);
}

/** Is this process a `node --test` child? Node sets NODE_TEST_CONTEXT itself. */
function isTestContext() {
  return typeof process.env.NODE_TEST_CONTEXT === 'string'
    && process.env.NODE_TEST_CONTEXT !== '';
}

/**
 * The guard that makes the injected root un-bypassable.
 *
 * TWO refusals, both loud:
 *   1. a target outside the injected root — the root would be decorative;
 *   2. a target inside the REPO'S OWN `simulation/scenes/` while running under
 *      `node --test`. Tests must never dirty a tracked scene directory: the
 *      SHA256-before/after proof that "the suite does not touch real scenes" is
 *      only worth something if a forgotten injection REFUSES rather than
 *      quietly writing. A test that genuinely wants to prove the production
 *      path points its root at a scratch directory.
 *
 * @param {string} scenesRoot
 * @param {string} target the absolute file path about to be written
 */
function assertWritableTarget(scenesRoot, target) {
  const root = path.resolve(scenesRoot);
  const rel = path.relative(root, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    fail('writeBenchMirrorState', `refusing to write '${target}': it is outside the injected ` +
      `scenes root '${root}'. The writer only ever writes inside the root it was handed.`);
  }
  if (isTestContext()) {
    const fromReal = path.relative(REAL_SCENES_ROOT, target);
    if (!fromReal.startsWith('..') && !path.isAbsolute(fromReal)) {
      fail('writeBenchMirrorState', `refusing to write '${target}': this process is a ` +
        "`node --test` child (NODE_TEST_CONTEXT is set) and the target is inside the repo's " +
        `real scenes directory '${REAL_SCENES_ROOT}'. Tests must inject a scratch scenes root ` +
        '— a suite that rewrites tracked scene files destroys the byte-identity proof that ' +
        'says it does not.');
    }
  }
}

/**
 * Read one bench scene's state file.
 *
 * NEVER THROWS on content. A state file that does not parse must not brick the
 * picker or the ARM — it must be REPORTED, with zero remembered selections
 * applied. That is loud, not lenient: the caller prints `error` verbatim and the
 * next successful ARM rewrites the file.
 *
 * @param {string} scenesRoot absolute path to the scenes directory
 * @param {string} benchScene
 * @returns {{path:string, present:boolean, state:Object, error:(string|null)}}
 */
function readBenchMirrorState(scenesRoot, benchScene) {
  const file = benchMirrorStatePath(scenesRoot, benchScene);
  if (!fs.existsSync(file)) {
    return { path: file, present: false, state: emptyBenchMirrorState(), error: null };
  }
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const state = parseBenchMirrorState(yaml.load(raw), `${benchScene}/${BENCH_MIRROR_STATE_FILE}`);
    return { path: file, present: true, state, error: null };
  } catch (e) {
    return {
      path: file,
      present: true,
      state: emptyBenchMirrorState(),
      error: `${benchScene}/${BENCH_MIRROR_STATE_FILE} is unreadable — ${e.message}; stored ` +
        'selections are unavailable until the file is fixed or deleted. Arming with an ' +
        'explicit selection still works and rewrites the file.',
    };
  }
}

/**
 * Write one bench scene's state file ATOMICALLY (tmp + fsync + rename), so a
 * crash mid-write can never leave a half-parsed file where a whole one was.
 *
 * @param {string} scenesRoot absolute path to the scenes directory
 * @param {string} benchScene
 * @param {Object} state
 * @returns {{path:string, bytes:number}}
 */
function writeBenchMirrorState(scenesRoot, benchScene, state) {
  const file = benchMirrorStatePath(scenesRoot, benchScene);
  assertWritableTarget(scenesRoot, file);
  const dir = path.dirname(file);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    fail('writeBenchMirrorState', `refusing to write '${file}': the scene directory '${dir}' ` +
      'does not exist. The state file is a sibling of an existing scene, never a new one — the ' +
      'writer does not create scenes.');
  }
  const text = serializeBenchMirrorState(state);
  const tmp = `${file}.tmp-${process.pid}`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, text, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
  return { path: file, bytes: Buffer.byteLength(text, 'utf8') };
}

module.exports = {
  parseBenchMirrorState,
  serializeBenchMirrorState,
  emptyBenchMirrorState,
  setSceneSelection,
  sceneSelection,
  benchMirrorStatePath,
  readBenchMirrorState,
  writeBenchMirrorState,
  isTestContext,
  STATE_VERSION,
  BENCH_MIRROR_STATE_FILE,
  NONE_SOURCE,
  REAL_SCENES_ROOT,
  // The admitted-key sets ARE the "this file cannot arm anything" guarantee: no
  // key would hold an address, a universe, a host or an arm bit. Tests assert
  // against them directly rather than re-deriving them from a text scan.
  STATE_KEYS,
  SELECTION_KEYS,
  SLOT_STATE_KEYS,
};
