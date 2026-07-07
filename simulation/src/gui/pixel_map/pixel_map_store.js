/**
 * pixel_map_store.js — signal store + live-data glue for the 2D Pixel Map.
 *
 * Owns the reactive panel state (visibility, collapse, mode, selection, view
 * transform), the in-memory fixture placements, and the subscription to
 * animate.js's onPixelFrame. It reclusters when the model topology rebuilds,
 * preserves operator-edited placements across rebuilds, and drives the
 * renderer once per frame. Persistence (params.pixelMap2d) is bridged here so
 * the panel/interaction layers stay UI-only.
 */

import { signal } from '@preact/signals';
import { params } from '../../core/state.js';
import { onPixelFrame } from '../../core/animate.js';
import {
  buildClusters, seedLayout, DEFAULT_CANVAS,
} from './pixel_map_layout.js';

export const store = {
  visible: signal(false),
  collapsed: signal(false),
  mode: signal('view'),      // 'view' | 'edit'
  enabled: signal(false),    // per-scene persisted "auto-open with scene"
  selection: signal(new Set()),
  zoom: signal(1),
  pan: signal({ x: 0, y: 0 }),
  plane: signal('auto'),     // seed plane: auto | top | front
  fixtureCount: signal(0),
  pixelCount: signal(0),
  hover: signal(null),       // { name, hex } for the status strip
  editTick: signal(0),       // bumped during edits so the inspector re-reads placements
  // Non-reactive live state:
  renderer: null,
  clusters: [],
  placements: new Map(),     // fixKey -> { x, y, rot }
  canvas: { ...DEFAULT_CANVAS },
  typeOverrides: {},         // fixtureType -> { size, gap }
  _unsub: null,
  _lastVersion: -2,
};

/** Load persisted per-scene config (params.pixelMap2d) into the store. */
export function loadFromParams() {
  const pm = params.pixelMap2d;
  store.placements = new Map();
  store.typeOverrides = {};
  store.canvas = { ...DEFAULT_CANVAS };
  store.enabled.value = false;
  store.plane.value = 'auto';
  store._lastVersion = -2; // force recluster on next frame
  store.clusters = [];
  if (pm && typeof pm === 'object') {
    if (typeof pm.enabled === 'boolean') store.enabled.value = pm.enabled;
    if (pm.plane) store.plane.value = pm.plane;
    if (pm.canvas && pm.canvas.w && pm.canvas.h) store.canvas = { w: pm.canvas.w, h: pm.canvas.h };
    if (pm.types) store.typeOverrides = JSON.parse(JSON.stringify(pm.types));
    if (pm.fixtures) {
      for (const [k, v] of Object.entries(pm.fixtures)) {
        store.placements.set(k, { x: v.x, y: v.y, rot: v.rot || 0 });
      }
    }
  }
}

// ─── Live frame handling ──────────────────────────────────────────────────
function reclusterAndSeed(list) {
  if (!list || list.length === 0) {
    store.clusters = [];
    store.fixtureCount.value = 0;
    store.pixelCount.value = 0;
    if (store.renderer) store.renderer.setLayout([], store.placements, store.typeOverrides, store.canvas);
    return;
  }
  const clusters = buildClusters(list);
  store.clusters = clusters;
  store.fixtureCount.value = clusters.length;
  store.pixelCount.value = list.length;

  // Seed positions for any fixture we don't already have a placement for
  // (operator-edited placements survive rebuilds — never clobber them).
  const missing = clusters.filter((c) => !store.placements.has(c.fixKey));
  if (missing.length) {
    const seeded = seedLayout(clusters, list, store.plane.value, store.canvas.w, store.canvas.h, store.typeOverrides);
    for (const c of missing) {
      const s = seeded.get(c.fixKey);
      if (s) store.placements.set(c.fixKey, s);
    }
  }
  if (store.renderer) store.renderer.setLayout(clusters, store.placements, store.typeOverrides, store.canvas);
}

function onFrame(list, version) {
  if (!store.renderer) return;
  if (document.hidden) return;
  if (version !== store._lastVersion || !store.clusters.length) {
    reclusterAndSeed(list);
    store._lastVersion = version;
  }
  store.renderer.drawFrame(list, !!window._patchesActive, !!params.showUnpatchedRed);
}

/** (Re)seed every fixture from scratch — "Reset seed" action. */
export function reseedAll(plane) {
  if (plane) store.plane.value = plane;
  store.placements = new Map();
  store._lastVersion = -2; // force recluster next frame
}

function subscribe() {
  if (store._unsub) return;
  store._unsub = onPixelFrame(onFrame);
}
function unsubscribe() {
  if (store._unsub) { store._unsub(); store._unsub = null; }
}

/** Called by the panel whenever visible/collapsed change. */
export function syncSubscription() {
  if (store.visible.value && !store.collapsed.value) subscribe();
  else unsubscribe();
}

export function showPixelMap(show) {
  // The Pixel Map is the 2d_pixels profile's viewport — it can only be shown
  // while that profile is active (any other request is a no-op that hides it).
  const allowed = params.lightingProfile === '2d_pixels';
  store.visible.value = !!show && allowed;
  syncSubscription();
}
export function togglePixelMap() { showPixelMap(!store.visible.value); }

// ─── Persistence bridge (→ params.pixelMap2d → scene YAML) ────────────────
export function persistToParams() {
  const pm = { enabled: store.enabled.value, plane: store.plane.value, canvas: { ...store.canvas } };
  const types = {};
  for (const [t, ov] of Object.entries(store.typeOverrides)) {
    if (ov && (typeof ov.sizeX === 'number' || typeof ov.sizeY === 'number' || typeof ov.gap === 'number')) types[t] = { ...ov };
  }
  if (Object.keys(types).length) pm.types = types;
  const fixtures = {};
  for (const [k, v] of store.placements) fixtures[k] = { x: v.x, y: v.y, rot: v.rot || 0 };
  if (Object.keys(fixtures).length) pm.fixtures = fixtures;
  params.pixelMap2d = pm;
}

/** Write current state to params + persist. The 2D Pixel Map always auto-saves
 *  its edits (force=true) so layout/size tweaks survive a reload even when the
 *  scene's global "Auto-Save on Change" toggle is off — the map is a live tuning
 *  surface and losing placements to a forgotten Save would be maddening. */
export function markEdited() {
  persistToParams();
  if (window._setSceneDirty) window._setSceneDirty(true);
  if (window.debounceAutoSave) window.debounceAutoSave(true);
}
store.__markEdited = markEdited;

/** Toggle the per-scene "auto-open with scene" flag (persisted). */
export function setEnabled(on) {
  store.enabled.value = !!on;
  markEdited();
}

export function registerPixelMapGlobals() {
  window.showPixelMap2d = (show) => showPixelMap(show);
  window.togglePixelMap2d = () => togglePixelMap();
}
