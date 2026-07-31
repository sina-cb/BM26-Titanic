/**
 * Source-contract regression for the generator SELECT FREEZE and the COLD MOVE
 * (report 20260725_44 steps 1-5). Both bugs were single lines, and both are
 * invisible in unit tests of pure modules — they live in the wiring:
 *
 *   1. main.js listened to TransformControls' `change`, which fires from the
 *      setter of EVERY tracked property (attach → `object`, hover → `axis`).
 *      One select-click therefore ran a full generateGroupFromTrace →
 *      rebuildParLights → shader-recompile storm: a 2,719 ms rAF stall.
 *      `objectChange` fires only when a transform was really applied.
 *   2. _onTraceTransformChange / _updateTraceDotDrag regenerated the whole
 *      generator on EVERY pointermove tick (~2.4 s frame stall per tick).
 *
 * These assertions exist so re-introducing either line fails the suite instead
 * of the operator's hands. Text scanning is the honest tool here: the wiring is
 * a browser-only closure over THREE + DOM.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAIN = readFileSync(path.join(HERE, '..', 'main.js'), 'utf8');
const GUI = readFileSync(path.join(HERE, '..', 'src', 'gui', 'gui_builder.js'), 'utf8');

/** Body of a `window.<name> = function(...) { ... }` assignment, brace-matched. */
function handlerBody(source, name) {
  const start = source.indexOf(`window.${name} = function`);
  assert.notEqual(start, -1, `${name} not found in source`);
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

test('main.js wires onTransformChange to objectChange, never to change', () => {
  assert.match(MAIN, /addEventListener\(\s*["']objectChange["']\s*,\s*onTransformChange\s*\)/);
  assert.doesNotMatch(
    MAIN,
    /addEventListener\(\s*["']change["']\s*,\s*onTransformChange\s*\)/,
    'the `change` event fires on attach/hover — this is the 2.7 s select freeze');
});

test('main.js flushes the deferred work when the gizmo is released', () => {
  assert.match(MAIN, /function flushPendingEditorRegens\s*\(/);
  assert.match(MAIN, /window\._flushPendingEditorRegens\(\)/);
  // The flush must live in the dragging-changed listener, on the release branch.
  const dragListener = MAIN.slice(MAIN.indexOf('addEventListener("dragging-changed"'));
  const elseBranch = dragListener.slice(dragListener.indexOf('} else {'));
  assert.match(
    elseBranch.slice(0, 1200), /flushPendingEditorRegens\(\)/,
    'the release branch of dragging-changed is the ONLY seam the deferred work can land on');
});

test('the trace transform tick defers the regenerate while dragging', () => {
  const body = handlerBody(GUI, '_onTraceTransformChange');
  assert.match(body, /markTraceRegenDirty\(\s*tIdx\s*\)/);
  // A bare per-tick regenerate is the bug. The only generateGroupFromTrace in
  // this handler must sit on the NOT-dragging branch, after the dirty mark.
  const marks = body.indexOf('markTraceRegenDirty(');
  const regen = body.indexOf('generateGroupFromTrace(tIdx');
  assert.notEqual(regen, -1, 'the non-drag path still regenerates immediately');
  assert.ok(regen > marks, 'the immediate regenerate must be the else-branch of the drag check');
  assert.match(body, /transformControl\s*&&\s*transformControl\.dragging/);
});

test('the preview-dot drag tick no longer regenerates the group', () => {
  const body = handlerBody(GUI, '_updateTraceDotDrag');
  assert.match(body, /refreshTraceDots\(/, 'the lightweight dot feedback stays per tick');
  assert.match(body, /markTraceRegenDirty\(\s*traceIndex\s*\)/);
  assert.doesNotMatch(
    body, /generateGroupFromTrace\(/,
    'a per-tick regenerate here is the 2.4 s-per-tick drag lag');
});

test('the dot-drag release does the deferred regenerate before saving', () => {
  const body = handlerBody(GUI, '_endTraceDotDrag');
  const flush = body.indexOf('_flushPendingEditorRegens');
  const save = body.indexOf('debounceAutoSave');
  assert.ok(flush !== -1 && save !== -1, 'release must flush AND mark the scene dirty');
  assert.ok(flush < save, 'never persist a trace whose fixtures have not caught up');
});

test('the strand tick keeps its own visuals live but defers the batch invalidation', () => {
  const body = handlerBody(GUI, '_onStrandTransformChange');
  assert.match(body, /rebuildVisuals\(\)/, "the strand's own meshes track the cursor per tick");
  assert.match(body, /markStrandTransformDirty\(\)/);
  // THE CONTRACT: the non-drag path still invalidates inline, and the release
  // seam invalidates for the deferred case — the move-trail bug can never
  // return as a *persistent* stale coordinate set.
  assert.match(body, /invalidateMarsinBatchCache\('strand_transform'\)/);
});

test('the release doer invalidates the batch cache whenever a strand move was deferred', () => {
  const body = handlerBody(GUI, '_flushPendingEditorRegens');
  assert.match(body, /takePendingRegens\(\)/);
  assert.match(body, /generateGroupFromTrace\(\s*tIdx\s*,\s*true\s*\)/, 'regenerate inside the drag-start undo step');
  assert.match(body, /pending\.strandTransform/);
  assert.match(body, /invalidateMarsinBatchCache\('strand_transform'\)/);
});
