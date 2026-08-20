/**
 * generator_move_fixture_sync.test.js — moving a generator MOVES ITS FIXTURES,
 * and it moves them to the same place live and after a reload
 * (report 20260725_83).
 *
 * The operator moved the Left Small SmokeStack generator. Two failures, one
 * cause each, and this suite exists so neither can come back:
 *
 *   1. LIVE  — `generateGroupFromTrace` took the circle anchor out of the THREE
 *      scene graph (`window.traceObjects[i].group.matrixWorld`) instead of out
 *      of the trace. Nothing detached the transform gizmo across a
 *      `rebuildTraceObjects()`, so the gizmo could be dragging a hitbox that
 *      had already been thrown away: the trace fields moved, the live group did
 *      not, and the fixtures were regenerated against the OLD anchor.
 *   2. RELOAD — `buildTraceObject` rebuilt that group from `trace.y || 5`, a
 *      FALSY default. The Left Small SmokeStack stands at y = 0 (the deck), so
 *      every reload rebuilt it 5 m in the air and the boot regeneration put its
 *      four fixtures up there with it. "Way off."
 *
 * Both halves are now one computation — `trace_anchor.js`, from the trace's own
 * fields — so live and reload agree by construction. The geometric half of this
 * suite pins that computation; the source-contract half pins the wiring, which
 * is a browser-only closure over THREE + DOM and cannot be imported.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import * as THREE from 'three';
import yaml from 'js-yaml';

import {
  traceAnchor, traceFocusPoint, traceUsesWorldSpacePath, anchorDelta, anchorsEqual,
  TRACE_ANCHOR_DEFAULTS,
} from '../src/dmx/trace_anchor.js';
import {
  detectResnappedFixtures, resnapMessage,
} from '../src/dmx/generator_hand_tweaks.js';
import { emitInChainOrder } from '../src/dmx/generator_chain_order.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GUI = readFileSync(path.join(HERE, '..', 'src', 'gui', 'gui_builder.js'), 'utf8');
const RUNTIME = readFileSync(
  path.join(HERE, '..', 'src', 'fixtures', 'dmx_fixture_runtime.js'), 'utf8');

// The operator's actual generator, as it stands in the titanic scene: a 4-light
// ring of UkingPars around the small port smokestack, standing ON THE DECK.
const LEFT_SMALL_SMOKESTACK = Object.freeze({
  name: 'Left Small SmokeStack',
  shape: 'circle',
  radius: 4,
  arc: 360,
  count: 4,
  x: -46.31804114458129,
  y: -0.0,
  z: 8.623600599294598,
  rotX: -0.0,
  rotY: 0,
  rotZ: 0,
  aimMode: 'lookAt',
  aimX: -46.5,
  aimY: 4.455642566522588,
  aimZ: 8.734290709830491,
  groupName: 'Left Small SmokeStack',
  fixtureType: 'UkingPar',
  generated: true,
});

// ── Oracles ─────────────────────────────────────────────────────────────────
// `anchorMatrix` is the production composition (gui_builder's
// `traceAnchorMatrix`); `groupMatrix` is what a THREE.Group placed on the same
// anchor produces. They must be identical — that equality IS "live == reload".

function anchorMatrix(trace) {
  const a = traceAnchor(trace);
  const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    THREE.MathUtils.degToRad(a.rotX),
    THREE.MathUtils.degToRad(a.rotY),
    THREE.MathUtils.degToRad(a.rotZ), 'YXZ'));
  return new THREE.Matrix4().compose(
    new THREE.Vector3(a.x, a.y, a.z), quat, new THREE.Vector3(1, 1, 1));
}

function groupMatrix(trace) {
  const a = traceAnchor(trace);
  const grp = new THREE.Group();
  grp.position.set(a.x, a.y, a.z);
  grp.setRotationFromEuler(new THREE.Euler(
    THREE.MathUtils.degToRad(a.rotX),
    THREE.MathUtils.degToRad(a.rotY),
    THREE.MathUtils.degToRad(a.rotZ), 'YXZ'));
  grp.updateMatrixWorld(true);
  return grp.matrixWorld;
}

/** Local ring points for a full-circle trace (gui_builder's computeTracePoints). */
function localRingPoints(trace) {
  const count = Math.max(1, Math.round(trace.count ?? 8));
  const r = trace.radius ?? 5;
  const arcRad = THREE.MathUtils.degToRad(trace.arc ?? 360);
  const closed = Math.abs((trace.arc ?? 360) - 360) < 1e-6;
  const denom = closed ? count : Math.max(1, count - 1);
  const pts = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / denom) * arcRad;
    pts.push(new THREE.Vector3(Math.cos(angle) * r, 0, Math.sin(angle) * r));
  }
  return pts;
}

/** World fixture positions a regeneration produces from a trace, in path order. */
function generatedWorldPositions(trace, matrix) {
  const mtx = matrix ?? anchorMatrix(trace);
  return localRingPoints(trace).map((p) => {
    const w = p.clone().applyMatrix4(mtx);
    return { x: w.x, y: w.y, z: w.z };
  });
}

/** Fixture records exactly as the generator emits them, chain order included. */
function generatedRecords(trace) {
  const groupName = trace.groupName || trace.name;
  const pointData = generatedWorldPositions(trace).map((p) => ({
    group: groupName,
    name: '',
    fixtureType: trace.fixtureType || 'UkingPar',
    x: p.x, y: p.y, z: p.z,
    traceGenerated: true,
  }));
  return [...emitInChainOrder(pointData, trace.chainSplits, groupName)];
}

const same = (a, b, eps = 1e-12) =>
  Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps && Math.abs(a.z - b.z) <= eps;

// ═══════════════════════════════════════════════════════════════════════════
// 1. The falsy default — the whole "way off on reload" bug
// ═══════════════════════════════════════════════════════════════════════════

test('a generator standing at y = 0 anchors at y = 0, not at the default 5', () => {
  const a = traceAnchor(LEFT_SMALL_SMOKESTACK);
  // `===`, not strictEqual: YAML round-trips the field as -0.0 and -0 === 0.
  assert.ok(a.y === 0, 'y = -0.0 is a real placement on the deck, not a missing field');
  assert.equal(a.x, LEFT_SMALL_SMOKESTACK.x);
  assert.equal(a.z, LEFT_SMALL_SMOKESTACK.z);
  assert.ok(a.rotX === 0);
  // The regression, spelled out: `||` would have hoisted it 5 m into the air.
  assert.notEqual(LEFT_SMALL_SMOKESTACK.y || 5, a.y);
});

test('an ABSENT coordinate still gets the documented default', () => {
  const a = traceAnchor({ shape: 'circle' });
  assert.deepEqual(
    { x: a.x, y: a.y, z: a.z, rotX: a.rotX, rotY: a.rotY, rotZ: a.rotZ },
    { ...TRACE_ANCHOR_DEFAULTS });
  assert.equal(a.y, 5, 'a brand-new circle still lands at eye level');
});

test('zero rotations survive — 0° is not "no rotation given"', () => {
  const a = traceAnchor({ shape: 'circle', x: 0, y: 0, z: 0, rotX: 0, rotY: 0, rotZ: 0 });
  assert.deepEqual(
    { x: a.x, y: a.y, z: a.z, rotX: a.rotX, rotY: a.rotY, rotZ: a.rotZ },
    { x: 0, y: 0, z: 0, rotX: 0, rotY: 0, rotZ: 0 });
});

test('the fly-to camera frames the deck-level generator, not empty air', () => {
  assert.ok(traceFocusPoint(LEFT_SMALL_SMOKESTACK).y === 0);
});

test('only circle traces have an anchor — line and corner are world-space', () => {
  assert.equal(traceUsesWorldSpacePath({ shape: 'line' }), true);
  assert.equal(traceUsesWorldSpacePath({ shape: 'corner' }), true);
  assert.equal(traceUsesWorldSpacePath(LEFT_SMALL_SMOKESTACK), false);
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. ONE position computation — live == reload
// ═══════════════════════════════════════════════════════════════════════════

test('the anchor matrix and a THREE.Group on the same anchor are identical', () => {
  for (const trace of [
    LEFT_SMALL_SMOKESTACK,
    { ...LEFT_SMALL_SMOKESTACK, rotX: 12.5, rotY: -49.470561389101036, rotZ: 3 },
    { shape: 'circle', radius: 5, arc: 360, count: 8 }, // all defaults
  ]) {
    assert.deepEqual(
      [...anchorMatrix(trace).elements], [...groupMatrix(trace).elements],
      'the two placements of a generator must be the same placement');
  }
});

test('moving the generator moves every fixture, by exactly the move', () => {
  const before = generatedWorldPositions(LEFT_SMALL_SMOKESTACK);
  const moved = { ...LEFT_SMALL_SMOKESTACK, x: -30.5, y: 2.5, z: 20 };
  const after = generatedWorldPositions(moved);

  const d = anchorDelta(traceAnchor(LEFT_SMALL_SMOKESTACK), traceAnchor(moved));
  assert.equal(after.length, before.length);
  after.forEach((p, i) => {
    assert.ok(same(p, {
      x: before[i].x + d.dx, y: before[i].y + d.dy, z: before[i].z + d.dz,
    }), `fixture ${i + 1} did not follow the generator`);
  });
  // And it actually moved — a no-follow regression would pass a delta of 0.
  assert.ok(!same(after[0], before[0]));
});

test('reload lands the fixtures exactly where the live move put them', () => {
  const moved = { ...LEFT_SMALL_SMOKESTACK, x: -30.5, y: 2.5, z: 20, rotY: 33 };
  const live = generatedWorldPositions(moved);

  // Reload = the trace through the scene YAML and back, then regenerated.
  const reloaded = yaml.load(yaml.dump({ traces: [moved] })).traces[0];
  const afterReload = generatedWorldPositions(reloaded);

  assert.ok(anchorsEqual(traceAnchor(moved), traceAnchor(reloaded)));
  live.forEach((p, i) => {
    assert.ok(same(p, afterReload[i], 1e-9),
      `fixture ${i + 1}: live ${JSON.stringify(p)} vs reload ${JSON.stringify(afterReload[i])}`);
  });
});

test('a STALE scene-graph group can no longer place fixtures — the anchor is the trace', () => {
  // Reproduces the live bug: the visual group left behind at the old anchor
  // while the trace fields already hold the new one. Generation reads the
  // trace, so the stale group changes nothing.
  const moved = { ...LEFT_SMALL_SMOKESTACK, x: -30.5, y: 2.5, z: 20 };
  const staleGroupMatrix = groupMatrix(LEFT_SMALL_SMOKESTACK);

  const fromTrace = generatedWorldPositions(moved);
  const fromStaleGroup = generatedWorldPositions(moved, staleGroupMatrix);

  assert.ok(!same(fromTrace[0], fromStaleGroup[0]),
    'the two used to disagree — that disagreement WAS the bug');
  assert.ok(same(fromTrace[0], generatedWorldPositions(moved, anchorMatrix(moved))[0]),
    'generation must follow the trace fields, never a scene-graph object');
});

test('the deck-level ring reproduces the fixtures saved in the titanic scene', () => {
  // The four positions in scene_config.yaml today, which is what a correct
  // reload has to reproduce — and what `|| 5` did not.
  const expected = [
    { x: -42.31804114458129, y: 0, z: 8.623600599294598 },
    { x: -46.31804114458129, y: 0, z: 12.623600599294598 },
    { x: -50.31804114458129, y: 0, z: 8.623600599294598 },
    { x: -46.31804114458129, y: 0, z: 4.623600599294598 },
  ];
  const got = generatedWorldPositions(LEFT_SMALL_SMOKESTACK);
  got.forEach((p, i) => assert.ok(same(p, expected[i], 1e-9),
    `fixture ${i + 1}: ${JSON.stringify(p)} != ${JSON.stringify(expected[i])}`));
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Sticky by name — a move changes POSITIONS and nothing else
// ═══════════════════════════════════════════════════════════════════════════

test('a move leaves names, group, type and chain order untouched', () => {
  const before = generatedRecords(LEFT_SMALL_SMOKESTACK);
  const after = generatedRecords({ ...LEFT_SMALL_SMOKESTACK, x: 12, y: 7.5, z: -3 });

  const strip = (r) => ({ ...r, x: undefined, y: undefined, z: undefined });
  assert.deepEqual(after.map(strip), before.map(strip),
    'only x/y/z may differ across a generator move');
  assert.deepEqual(after.map((r) => r.name),
    ['Left Small SmokeStack 1', 'Left Small SmokeStack 2',
     'Left Small SmokeStack 3', 'Left Small SmokeStack 4']);
});

test('chain splits keep their numbering across a move', () => {
  const splits = [{ from: 4, to: 1 }];
  const before = generatedRecords({ ...LEFT_SMALL_SMOKESTACK, chainSplits: splits });
  const after = generatedRecords({
    ...LEFT_SMALL_SMOKESTACK, chainSplits: splits, x: 12, y: 7.5, z: -3,
  });
  assert.deepEqual(after.map((r) => r.name), before.map((r) => r.name));
});

test('patches and 2D pixel-map references are keyed by NAME, so a move cannot churn them', () => {
  const moved = { ...LEFT_SMALL_SMOKESTACK, x: 12, y: 7.5, z: -3 };
  const names = new Set(generatedRecords(moved).map((r) => r.name));

  // patches.yaml joins on fixture name; the 2D views select on group name and
  // key their per-fixture offsets on fixture name. Both survive iff the name
  // set and the group name survive — which the assertions above just pinned.
  const patches = {
    'Left Small SmokeStack 1': { universe: 3, address: 1 },
    'Left Small SmokeStack 4': { universe: 3, address: 25 },
  };
  const viewOffsets = { 'Left Small SmokeStack 2': { dx: 14, dy: -6 } };

  for (const key of [...Object.keys(patches), ...Object.keys(viewOffsets)]) {
    assert.ok(names.has(key), `${key} lost its record to a move — its patch would drop`);
  }
  assert.equal(moved.groupName, LEFT_SMALL_SMOKESTACK.groupName,
    'the 2D view selects `group: Left Small SmokeStack` — a move must not rename it');
  // Operator-placed VIEW-space offsets are layout, not geometry: a world move
  // says nothing about them, so they are kept verbatim.
  assert.deepEqual(viewOffsets['Left Small SmokeStack 2'], { dx: 14, dy: -6 });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Hand-tweak policy: RE-SNAP, loudly
// ═══════════════════════════════════════════════════════════════════════════

test('a clean generator move re-snaps nothing and says nothing', () => {
  const before = generatedRecords(LEFT_SMALL_SMOKESTACK);
  const after = generatedRecords({ ...LEFT_SMALL_SMOKESTACK, x: 12, y: 7.5, z: -3 });
  assert.deepEqual(detectResnappedFixtures(before, after).names, []);
});

test('a fixture hand-moved after generation is named when the move re-snaps it', () => {
  const before = generatedRecords(LEFT_SMALL_SMOKESTACK);
  // The operator dragged fixture 3 half a metre off the ring by hand.
  const tweaked = before.map((r) => (r.name.endsWith(' 3') ? { ...r, y: r.y + 0.5 } : r));
  const after = generatedRecords({ ...LEFT_SMALL_SMOKESTACK, x: 12, y: 7.5, z: -3 });

  const { names, move } = detectResnappedFixtures(tweaked, after);
  assert.deepEqual(names, ['Left Small SmokeStack 3']);
  assert.ok(Math.abs(move.dy - 7.5) < 1e-9, 'the reported move is the generator move');
  assert.match(resnapMessage('Left Small SmokeStack', names), /RE-SNAPPED/);
  assert.match(resnapMessage('Left Small SmokeStack', names), /Left Small SmokeStack 3/);
});

test('a LAYOUT change reports nothing — per-fixture displacement means nothing there', () => {
  // Radius change: every fixture moves differently, so no displacement is "the
  // move" and the detector must stay silent rather than accuse the whole group.
  const before = generatedRecords(LEFT_SMALL_SMOKESTACK);
  const after = generatedRecords({ ...LEFT_SMALL_SMOKESTACK, radius: 6 });
  assert.deepEqual(detectResnappedFixtures(before, after).names, []);
});

test('a count shrink casualty is not a re-snap', () => {
  const before = generatedRecords(LEFT_SMALL_SMOKESTACK);
  const after = before.slice(0, 3).map((r) => ({ ...r, x: r.x + 2 }));
  assert.deepEqual(detectResnappedFixtures(before, after).names, [],
    'the dropped fixture is a casualty of the shrink, not a re-snapped tweak');
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Source contracts — the browser-only wiring
// ═══════════════════════════════════════════════════════════════════════════

/** Body of a `function <name>(...) { ... }` declaration, brace-matched. */
function functionBody(source, name) {
  const start = source.search(new RegExp(`function\\s+${name}\\s*\\(`));
  assert.notEqual(start, -1, `${name} not found`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error(`unbalanced braces while extracting ${name}`);
}

test('no falsy anchor default survives anywhere in the GUI', () => {
  assert.doesNotMatch(GUI, /trace\.y\s*\|\|\s*5/,
    '`trace.y || 5` puts a deck-level generator 5 m in the air on every reload');
  assert.doesNotMatch(GUI, /trace\.x\s*\|\|\s*0/);
  assert.doesNotMatch(GUI, /trace\.z\s*\|\|\s*0/);
});

test('generation takes the anchor from the trace, never from the scene graph', () => {
  const body = functionBody(GUI, 'generateGroupFromTrace');
  assert.match(body, /traceAnchorMatrix\(trace\)/,
    'the one anchor computation must be the one generation uses');
  assert.doesNotMatch(body, /traceObjects\[traceIndex\]\?\.group/,
    'a stale or missing group silently placed a whole ring at the world origin');
  assert.doesNotMatch(body, /matrixWorld/,
    'nothing about where fixtures land may come out of a THREE object');
});

test('the circle visual and its hitbox are both placed from the trace', () => {
  const body = functionBody(GUI, 'buildTraceObject');
  const applied = body.match(/applyTraceAnchor\(/g) || [];
  assert.ok(applied.length >= 2, 'group AND hitbox go through the one anchor');
  assert.doesNotMatch(body, /hitbox\.position\.copy\(grp\.position\)/,
    'object-to-object copying is how the two drifted apart');
});

test('a generator drag writes the trace, then re-derives every visual from it', () => {
  const handler = GUI.slice(GUI.indexOf('window._onTraceTransformChange = function'));
  const circleBranch = handler.slice(handler.indexOf('CIRCLE anchor moved'),
    handler.indexOf('COLD MOVE (report 20260725_44 step 2)'));
  assert.doesNotMatch(circleBranch, /group\.position\.copy\(\s*tObj\.hitbox\.position\s*\)/,
    'copying the group from the hitbox did nothing when the gizmo held a stale hitbox');
  assert.match(circleBranch, /applyTraceAnchor\(tObj\.group, trace\)/);
  assert.match(circleBranch, /applyTraceAnchor\(tObj\.hitbox, trace\)/);
  // The aim target travels with the generator, exactly as line/corner already do.
  assert.match(circleBranch, /trace\.aimX = \(trace\.aimX \|\| 0\) \+ dx/);
});

test('the transform gizmo never keeps hold of a destroyed trace mesh', () => {
  assert.match(functionBody(GUI, 'destroyTraceObjects'), /transformControl\.detach\(\)/,
    'a gizmo on a removed hitbox is how a move wrote the trace but moved nothing');
  const rebuild = functionBody(GUI, 'rebuildTraceObjects');
  assert.match(rebuild, /captureTraceGizmoTarget\(\)/);
  assert.match(rebuild, /restoreTraceGizmoTarget\(gizmoTarget\)/);
});

test('every generator geometry field regenerates its fixtures on release', () => {
  const fields = ['radius', 'arc', 'startX', 'startY', 'startZ',
    'cornerX', 'cornerY', 'cornerZ', 'endX', 'endY', 'endZ'];
  for (const f of fields) {
    const re = new RegExp(`onTraceGeometryEdit\\([^\\n]*'${f}'`);
    assert.match(GUI, re, `${f} must move the generated fixtures, not just the preview`);
  }
  const helper = functionBody(GUI, 'onTraceGeometryEdit');
  assert.match(helper, /markTraceRegenDirty\(traceIndex\)/, 'cheap during the drag');
  assert.match(helper, /onFinishChange/, 'one regeneration on release');
  assert.match(helper, /_flushPendingEditorRegens\(\)/, 'the same release seam as a gizmo drag');
});

test('a re-snap is announced by name, in the console AND on screen', () => {
  const body = functionBody(GUI, 'generateGroupFromTrace');
  assert.match(body, /detectResnappedFixtures\(previousGenerated, emitted\)/);
  assert.match(body, /console\.warn/);
  assert.match(body, /showToast\(message/);
});

test('drawn positions stay derived from physical ones (report 20260725_74)', () => {
  // A generator move relocates a fixture GROUP; per-pixel localPos/renderPos are
  // local to that group, so the drawn-vs-physical invariant is untouched by a
  // move — provided renderPos stays a pure product and the generator never
  // writes either. Both halves pinned here.
  assert.match(RUNTIME, /renderPos:\s*new THREE\.Vector3\([^)]*\)\.multiplyScalar\(this\._modelScale\)/,
    'renderPos = localPos x modelScale, computed in one place');
  assert.doesNotMatch(GUI, /renderPos\s*=/, 'the generator must never write a drawn position');
  assert.doesNotMatch(GUI, /localPos\s*=/, 'nor a physical pixel position');
});
