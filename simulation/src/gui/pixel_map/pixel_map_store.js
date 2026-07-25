/**
 * pixel_map_store.js — signal store + data-plane glue for the 2D Pixel Map
 * MULTIVIEW (S4 integration).
 *
 * Owns the reactive chrome state (visibility/collapse/mode/selection/hover),
 * the "views are data" container (params.pixelMapViews), the single shared
 * frame source (one onPixelFrame subscription for every pane), and the
 * topology bridge that reclusters the live _batchRenderList and fans it out to
 * the mounted multiview. Persistence (params.pixelMapViews scene-YAML) and the
 * legacy params.pixelMap2d → all_fixtures migration are bridged here so the
 * panel / interaction / pane layers stay UI-only.
 *
 * The pane layout tree (splits/focus/zoom) is per-workstation ergonomics and is
 * persisted separately in localStorage by pixel_map_pane_tree.js — NOT here.
 */

import { signal, effect } from '@preact/signals';
import { params } from '../../core/state.js';
import { onPixelFrame } from '../../core/animate.js';
import { entryDisplayRgb } from '../../core/rgbwau_blend.js';
import {
  buildClusters, seedPanel, expandPanel, DEFAULT_CANVAS,
} from './pixel_map_layout.js';
import {
  startFrameSource, registerPanePainter, onTopology as frameOnTopology,
} from './pixel_map_frame_source.js';
import {
  createViewsContainer, resolveView, toParams, migrateLegacyPixelMap2d,
  findView, addBlankView, removeView, duplicateView,
} from './pixel_map_views.js';
import { seedDefaultViews } from './pixel_map_view_defaults.js';
import { attachPaneInteraction } from './pixel_map_interaction.js';

export const store = {
  visible: signal(false),
  collapsed: signal(false),
  mode: signal('view'),        // 'view' | 'edit'
  enabled: signal(false),      // per-scene persisted "auto-open with scene"
  selection: signal(new Set()),// fixKeys selected in the focused pane
  managerOpen: signal(false),  // Views manager overlay visible
  viewsTick: signal(0),        // bump when the views container mutates (UI refresh)
  focusedPath: signal(''),     // focused pane path (scopes edit-key handling)
  fixtureCount: signal(0),
  pixelCount: signal(0),
  hover: signal(null),         // { name, hex } for the status strip

  // Non-reactive live state:
  views: null,                 // views container ({ version, views[] })
  viewRegistry: null,          // scene view_registry (for `view:` selectors)
  clusters: [],
  list: null,
  version: -2,
  _started: false,
  _topoListeners: new Set(),   // multiview consumers of deps.onTopology
  _viewsListeners: new Set(),  // multiview consumers of deps.subscribeViews
  _frameTopoUnsub: null,
};

/** Fan a "views container changed" event to the mounted multiview so its view
 *  dropdowns + bound panes refresh (add/remove/rename/duplicate). */
function notifyViewsChanged() {
  store.viewsTick.value++;
  for (const fn of [...store._viewsListeners]) {
    try { fn(); }
    catch (err) { console.error('[PixelMap] views listener threw — dropped:', err); store._viewsListeners.delete(fn); }
  }
}

// ─── Views container: load / migrate / seed / persist ─────────────────────

/** Build the views container from params, migrating legacy layout + seeding the
 *  4 defaults on first open. Fail-loud: a corrupt persisted tree throws. */
export function loadViewsFromParams() {
  store.viewRegistry = (typeof window !== 'undefined') ? (window.__viewRegistry || null) : null;
  const container = createViewsContainer(params.pixelMapViews); // throws on corrupt tree
  let changed = false;

  // Legacy single-view layout → an `all_fixtures` view (only when no views yet).
  if (migrateLegacyPixelMap2d(container, params.pixelMap2d)) {
    console.info('[PixelMap] migrated legacy params.pixelMap2d → "all_fixtures" view.');
    changed = true;
  }
  // First open of a scene with no views → the 4 shipped defaults.
  if (seedDefaultViews(container)) {
    console.info('[PixelMap] seeded 4 default views (top_down / front / strands / te_sign).');
    changed = true;
  }
  store.views = container;

  // Drop the retired legacy key once its placements have been carried over.
  if (params.pixelMap2d !== undefined) { delete params.pixelMap2d; changed = true; }
  // Publish to params SILENTLY (no dirty / no autosave) — merely opening the map
  // must not save the scene. Seeded defaults re-seed deterministically each open;
  // an actual view/placement edit is what dirties + persists (commitViews). `_`
  // keeps the unused-flag lint quiet while documenting the one-time seed path.
  void changed;
  params.pixelMapViews = toParams(container);
  store.viewsTick.value++;
}

/** Rewrite params.pixelMapViews from the container and force an autosave. The
 *  2D map always auto-saves its edits so a forgotten Save never loses layout. */
export function commitViews() {
  params.pixelMapViews = toParams(store.views);
  if (typeof window !== 'undefined') {
    if (window._setSceneDirty) window._setSceneDirty(true);
    if (window.debounceAutoSave) window.debounceAutoSave(true);
  }
}
export const markEdited = commitViews;

// ─── Views manager operations (mutate container → persist → refresh UI) ────

export function addBlankViewOp() {
  const base = 'view';
  let id = base, n = 2;
  while (findView(store.views, id)) id = `${base}${n++}`;
  const v = addBlankView(store.views, { id, label: 'New View' });
  commitViews();
  notifyViewsChanged();
  return v.id;
}

export function duplicateViewOp(id) {
  const v = duplicateView(store.views, id);
  commitViews();
  notifyViewsChanged();
  return v.id;
}

export function removeViewOp(id) {
  if (store.views.views.length <= 1) throw new Error('cannot remove the last remaining view');
  removeView(store.views, id);       // throws on unknown id (fail loud)
  commitViews();
  notifyViewsChanged();
}

/** Rename a view's display LABEL (its id stays stable so bound panes keep
 *  resolving). Throws if the view is gone. */
export function renameViewOp(id, label) {
  const v = findView(store.views, id);
  if (!v) throw new Error(`[PixelMap] cannot rename unknown view '${id}'`);
  v.label = String(label || v.id);
  commitViews();
  notifyViewsChanged();
}

// ─── Frame source + topology bridge ────────────────────────────────────────

/** Start the single shared frame source (one onPixelFrame subscription for the
 *  whole multiview) and the recluster bridge. Idempotent. */
export function startPixelMapDataPlane() {
  if (store._started) return;
  store._started = true;
  startFrameSource(onPixelFrame);
  store._frameTopoUnsub = frameOnTopology((list, version) => {
    store.list = list;
    store.version = version;
    store.clusters = buildClusters(list);
    store.fixtureCount.value = store.clusters.length;
    store.pixelCount.value = list ? list.length : 0;
    for (const fn of [...store._topoListeners]) {
      try { fn(store.clusters, list, version); }
      catch (err) {
        console.error('[PixelMap] topology consumer threw — dropped:', err);
        store._topoListeners.delete(fn);
      }
    }
  });
}

// ─── Panel building (view → pane panels) ───────────────────────────────────
// Turns a resolved view into the panel list a PixelMapPaneView consumes. A
// deleted view or a selector schema error becomes a loud inline error panel
// (design §2.2) — a visible error, never a silent empty pane.
function buildPanelsForView(viewId) {
  const design = { ...DEFAULT_CANVAS };
  const viewDef = store.views ? findView(store.views, viewId) : null;
  if (!viewDef) return [{ id: 'missing', label: viewId, error: 'view removed — pick another', design }];
  if (!store.list) return []; // no topology yet — panes stay blank until first frame
  let resolved;
  try {
    resolved = resolveView(viewDef, store.clusters, store.list, { viewRegistry: store.viewRegistry });
  } catch (err) {
    return [{ id: viewId, label: viewDef.label || viewId, error: err.message, design }];
  }
  return resolved.panels.map((panel, i) => {
    const def = panel.def || {};
    const id = def.id || `panel${i}`;
    if (panel.error) return { id, label: def.label || id, error: panel.error, design, weight: def.weight };
    const styles = panel.styles;
    // Seed anchors for the subset, then let the view's PERSISTED (operator-edited)
    // placements win — so an unedited view still reads pretty and an edited one is
    // stable across reloads.
    const placements = seedPanel(def, panel.clusters, store.list, design.w, design.h, styles);
    if (panel.placements) for (const [k, v] of panel.placements) placements.set(k, v);
    const pixels = expandPanel(def, panel.clusters, store.list, placements, styles);
    return {
      id, label: def.label || id, weight: def.weight || 1, design, pixels, error: null,
      _edit: { def, view: viewDef, panelId: id },
    };
  });
}

/** Materialize a view's per-panel seed into its stored placements object (fills
 *  only missing fixtures) so EDIT-mode drags have a stable anchor to move and
 *  the whole view becomes persisted. Idempotent. */
export function materializeView(viewId) {
  const view = findView(store.views, viewId);
  if (!view || !store.list) return;
  let resolved;
  try { resolved = resolveView(view, store.clusters, store.list, { viewRegistry: store.viewRegistry }); }
  catch { return; }
  const design = DEFAULT_CANVAS;
  for (const panel of resolved.panels) {
    if (panel.error || !panel.clusters.length) continue;
    const seeded = seedPanel(panel.def, panel.clusters, store.list, design.w, design.h, panel.styles);
    for (const c of panel.clusters) {
      if (view.placements[c.fixKey]) continue;
      const s = seeded.get(c.fixKey);
      if (s) view.placements[c.fixKey] = { x: s.x, y: s.y, rot: s.rot || 0 };
    }
  }
}

/** Live display color for pixel `gi` as { name, hex }, or null (status strip). */
function colorForGi(gi) {
  if (!store.list) return null;
  const entry = store.list[gi];
  if (!entry) return null;
  const patches = !!(typeof window !== 'undefined' && window._patchesActive);
  const [r, g, b] = entryDisplayRgb(entry, patches, !!params.showUnpatchedRed);
  const hex = '#' + [r, g, b].map((v) => ('0' + Math.round(v * 255).toString(16)).slice(-2)).join('');
  return { name: entry.name || '', hex };
}

// ─── Edit context per pane (handed to the interaction layer) ───────────────
function makeEditCtx(paneView, paneCtx) {
  return {
    getMode: () => store.mode.value,
    getPath: paneCtx.getPath,
    isFocused: () => store.focusedPath.value === paneCtx.getPath(),
    getViewId: paneCtx.getViewId,
    setSelection: (set) => { paneView.setSelection(set); store.selection.value = set; },
    getSelection: () => store.selection.value,
    materialize: () => materializeView(paneCtx.getViewId()),
    getPlacement: (fixKey) => {
      const v = findView(store.views, paneCtx.getViewId());
      return v ? v.placements[fixKey] : null;
    },
    setPlacement: (fixKey, pl) => {
      const v = findView(store.views, paneCtx.getViewId());
      if (v) v.placements[fixKey] = { x: pl.x, y: pl.y, rot: pl.rot || 0 };
    },
    rebuild: () => paneView.setPanels(buildPanelsForView(paneCtx.getViewId())),
    commit: () => commitViews(),
    setHover: (info) => { store.hover.value = info; },
    colorOf: colorForGi,
  };
}

// ─── deps object for the multiview shell (design §5 contract) ──────────────
export function buildMultiviewDeps() {
  return {
    scene: (typeof window !== 'undefined' && window.__activeScene) || 'default',
    listViews: () => (store.views ? store.views.views.map((v) => ({ id: v.id, label: v.label })) : []),
    getViewDef: (id) => (store.views ? findView(store.views, id) : null),
    resolveView: (viewDef, clusters, list) =>
      resolveView(viewDef, clusters, list, { viewRegistry: store.viewRegistry }),
    seedPanel: (def, clusters, list, w, h, styles) => seedPanel(def, clusters, list, w, h, styles),
    expandPanel: (def, clusters, list, placements, styles) =>
      expandPanel(def, clusters, list, placements, styles),
    buildPanels: (viewId) => buildPanelsForView(viewId),
    onTopology: (fn) => { store._topoListeners.add(fn); return () => store._topoListeners.delete(fn); },
    subscribeViews: (fn) => { store._viewsListeners.add(fn); return () => store._viewsListeners.delete(fn); },
    registerPanePainter: (fn) => registerPanePainter(fn),
    canvasSize: () => ({ ...DEFAULT_CANVAS }),
    currentTopology: () => (store.list ? { clusters: store.clusters, list: store.list, version: store.version } : null),
    openViewManager: () => { store.managerOpen.value = true; },
    getMode: () => store.mode.value,
    subscribeMode: (fn) => effect(() => { fn(store.mode.value); }),
    attachInteraction: (canvas, paneView, paneCtx) =>
      attachPaneInteraction(canvas, paneView, makeEditCtx(paneView, paneCtx)),
    onLayoutChange: (state) => { if (state && typeof state.focus === 'string') store.focusedPath.value = state.focus; },
  };
}

// ─── Visibility / profile binding ──────────────────────────────────────────

export function showPixelMap(show) {
  // The Pixel Map is the 2d_pixels profile's viewport — it can only be shown
  // while that profile is active (any other request is a no-op that hides it).
  const allowed = params.lightingProfile === '2d_pixels';
  store.visible.value = !!show && allowed;
}
export function togglePixelMap() { showPixelMap(!store.visible.value); }

export function setEnabled(on) {
  // The 2d_pixels profile auto-shows the map via the animate.js headless latch,
  // so this is just an in-session UI flag (not persisted in the views model).
  store.enabled.value = !!on;
}

export function registerPixelMapGlobals() {
  window.showPixelMap2d = (show) => showPixelMap(show);
  window.togglePixelMap2d = () => togglePixelMap();
}
