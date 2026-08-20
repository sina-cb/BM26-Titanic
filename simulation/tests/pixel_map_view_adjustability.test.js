/**
 * pixel_map_view_adjustability.test.js — the operator-adjustment surface
 * (report 20260725_54).
 *
 * Operator order, 2026-07-30: "In the 2D views, allow me to adjust the view as
 * I want." The shipped defaults stay as they are; his adjustments layer on top
 * and persist with the scene, with a reset back to the shipped view.
 *
 * These cover the DATA CONTRACT the UI writes through — the view schema's new
 * `framing`, and the invariants every adjustment op must hold:
 *   - an illegal adjustment throws and leaves the view EXACTLY as it was
 *     (never half-applied — codex P0),
 *   - adjustments survive the params round-trip (they persist with his save),
 *   - reset restores the shipped default byte-for-byte.
 *
 * Pure logic — no DOM, no store singleton, no canvas. The store ops are thin
 * wrappers over these primitives plus `commitViews()`; the wiring itself is
 * exercised live by `agent_tools/pixel_map_view_tuning_verify.cjs`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createViewsContainer, addView, findView, toParams, validateViewDef,
  validateFraming, normalizeViewDef,
  FRAMING_ZOOM_MIN, FRAMING_ZOOM_MAX,
} from '../src/gui/pixel_map/pixel_map_views.js';
import { DEFAULT_VIEWS, buildDefaultViews } from '../src/gui/pixel_map/pixel_map_view_defaults.js';

const clone = (o) => JSON.parse(JSON.stringify(o));

// ─── framing: the persisted pan/zoom ───────────────────────────────────────

test('framing validates as a finite zoom/pan inside the wheel clamp', () => {
  assert.doesNotThrow(() => validateFraming(undefined, 'v'));
  assert.doesNotThrow(() => validateFraming(null, 'v'));
  assert.doesNotThrow(() => validateFraming({ zoom: 1, panX: 0, panY: 0 }, 'v'));
  assert.doesNotThrow(() => validateFraming({ zoom: FRAMING_ZOOM_MIN, panX: -900, panY: 12.5 }, 'v'));
  assert.doesNotThrow(() => validateFraming({ zoom: FRAMING_ZOOM_MAX, panX: 0, panY: 0 }, 'v'));

  assert.throws(() => validateFraming({ zoom: 1, panX: 0 }, 'v'), /panY must be a finite number/);
  assert.throws(() => validateFraming({ zoom: 1, panX: NaN, panY: 0 }, 'v'), /panX must be a finite number/);
  assert.throws(() => validateFraming({ zoom: '2', panX: 0, panY: 0 }, 'v'), /zoom must be a finite number/);
  assert.throws(() => validateFraming([1, 0, 0], 'v'), /must be an object/);
  // Outside what the wheel can even reach — a framing he could never restore.
  assert.throws(() => validateFraming({ zoom: FRAMING_ZOOM_MAX + 0.1, panX: 0, panY: 0 }, 'v'),
    /zoom must be between/);
  assert.throws(() => validateFraming({ zoom: FRAMING_ZOOM_MIN - 0.01, panX: 0, panY: 0 }, 'v'),
    /zoom must be between/);
});

test('the wheel clamp and the persisted bounds are the SAME numbers', async () => {
  // If the interaction layer let him scroll past what the schema accepts, his
  // framing would be silently dropped on reload. Read the interaction module's
  // own constants rather than restating them.
  const src = await import('node:fs').then((fs) => fs.promises.readFile(
    new URL('../src/gui/pixel_map/pixel_map_interaction.js', import.meta.url), 'utf8'));
  const m = src.match(/const ZOOM_MIN\s*=\s*([\d.]+)\s*,\s*ZOOM_MAX\s*=\s*([\d.]+)/);
  assert.ok(m, 'pixel_map_interaction.js must declare ZOOM_MIN/ZOOM_MAX');
  assert.equal(Number(m[1]), FRAMING_ZOOM_MIN, 'ZOOM_MIN must equal FRAMING_ZOOM_MIN');
  assert.equal(Number(m[2]), FRAMING_ZOOM_MAX, 'ZOOM_MAX must equal FRAMING_ZOOM_MAX');
});

test('a view without framing stays WITHOUT one (absent ≠ shipped fit)', () => {
  // "He never framed this view" must stay distinguishable from "he framed it
  // back to 1×/0/0", or a reset-to-fit could not be told from never-touched.
  const c = buildDefaultViews();
  const v = findView(c, 'top_down');
  assert.equal(v.framing, undefined);
  assert.equal('framing' in toParams(c).views[0], false);
});

test('framing survives the params round-trip, and an illegal one is refused', () => {
  const c = buildDefaultViews();
  findView(c, 'top_down').framing = { zoom: 2.5, panX: -140, panY: 33 };
  const round = createViewsContainer(toParams(c));
  assert.deepEqual(findView(round, 'top_down').framing, { zoom: 2.5, panX: -140, panY: 33 });

  // A hand-edited scene YAML with a bad framing is a hard stop, not a repair.
  const bad = toParams(c);
  bad.views[0].framing = { zoom: 99, panX: 0, panY: 0 };
  assert.throws(() => createViewsContainer(bad), /zoom must be between/);
});

// ─── adjustments are all-or-nothing ────────────────────────────────────────

test('an illegal panel adjustment leaves the view EXACTLY as it was', () => {
  // This is the invariant the store op relies on: it writes, re-validates, and
  // rolls back on throw. Proven here on the primitive it rolls back to.
  const c = buildDefaultViews();
  const v = findView(c, 'te_sign');
  const before = clone(v);
  const panel = v.panels[0];

  // `compress` on a planar panel is a wiring bug, not a preference.
  const prev = panel.compress;
  panel.compress = { minWorldGap: 5, gapWorld: 4 };
  assert.throws(() => validateViewDef(v), /needs a 'spatial' layout/);
  if (prev === undefined) delete panel.compress; else panel.compress = prev;
  assert.deepEqual(clone(v), before, 'rolled back to byte-identical');
  assert.doesNotThrow(() => validateViewDef(v));
});

test('every knob the inspector writes is accepted on a view that supports it', () => {
  const c = buildDefaultViews();
  const top = findView(c, 'top_down');
  const panel = top.panels[0];
  // rotate / compress / expandPitch on the spatial Top-Down panel.
  panel.rotate = 180;
  panel.compress = { minWorldGap: 8, gapWorld: 1.5 };
  panel.expandPitch = { UkingPar: 0.4 };
  top.typeStyles = { ...top.typeStyles, ShehdsBar: { sizeX: 9, sizeY: 9 } };
  top.framing = { zoom: 1.75, panX: 20, panY: -60 };
  assert.doesNotThrow(() => validateViewDef(top));
  // …and they all come back after a save/load cycle.
  const round = findView(createViewsContainer(toParams(c)), 'top_down');
  assert.equal(round.panels[0].rotate, 180);
  assert.deepEqual(round.panels[0].compress, { minWorldGap: 8, gapWorld: 1.5 });
  assert.deepEqual(round.panels[0].expandPitch, { UkingPar: 0.4 });
  assert.equal(round.typeStyles.ShehdsBar.sizeX, 9);
  assert.deepEqual(round.framing, { zoom: 1.75, panX: 20, panY: -60 });
});

// ─── reset to default ──────────────────────────────────────────────────────

test('reset restores a shipped view byte-for-byte, framing included', () => {
  // The store op does exactly this: normalizeViewDef(DEFAULT_VIEWS entry) over
  // the live view, minus the framing. Pinned here so a change to either side
  // of that equality is caught.
  const c = buildDefaultViews();
  const v = findView(c, 'front');
  const pristine = clone(v);

  v.panels[0].rotate = 90;
  v.typeStyles = { VintageLed: { sizeX: 3, sizeY: 3 } };
  v.placements = { 'Left Front Wall 1': { x: 10, y: 20, rot: 15 } };
  v.framing = { zoom: 4, panX: 5, panY: 5 };

  const fresh = normalizeViewDef(DEFAULT_VIEWS.find((d) => d.id === 'front'));
  v.label = fresh.label;
  v.panels = fresh.panels;
  v.placements = fresh.placements;
  v.typeStyles = fresh.typeStyles;
  delete v.framing;

  assert.deepEqual(clone(v), pristine);
});

test('every shipped default view is resettable; a made-up id is not', () => {
  const shipped = DEFAULT_VIEWS.map((v) => v.id);
  assert.deepEqual(shipped, ['top_down', 'front', 'strands', 'te_sign']);
  for (const id of shipped) {
    assert.ok(DEFAULT_VIEWS.find((v) => v.id === id),
      `'${id}' must have a shipped default to reset to`);
  }
  assert.equal(DEFAULT_VIEWS.find((v) => v.id === 'view2'), undefined,
    'an operator-created view has no shipped default — reset must refuse it');
});

test('normalizeViewDef never aliases the shipped default (reset is repeatable)', () => {
  // If reset handed out a reference into DEFAULT_VIEWS, his next adjustment
  // would mutate the shipped default for every scene in the session.
  const def = DEFAULT_VIEWS.find((v) => v.id === 'top_down');
  const a = normalizeViewDef(def);
  const b = normalizeViewDef(def);
  a.panels[0].rotate = 270;
  a.typeStyles.UkingPar.sizeX = 99;
  assert.notEqual(b.panels[0].rotate, 270);
  assert.notEqual(b.typeStyles.UkingPar.sizeX, 99);
  assert.equal(def.panels[0].rotate, undefined, 'the shipped default is untouched');
  assert.equal(def.typeStyles.UkingPar.sizeX, 13);
});

test('adjustments never leak between views', () => {
  const c = buildDefaultViews();
  findView(c, 'top_down').framing = { zoom: 3, panX: 1, panY: 2 };
  findView(c, 'top_down').typeStyles.ShehdsBar = { sizeX: 4, sizeY: 4 };
  assert.equal(findView(c, 'front').framing, undefined);
  assert.equal((findView(c, 'front').typeStyles || {}).ShehdsBar, undefined);
  assert.equal(findView(c, 'strands').framing, undefined);
});
