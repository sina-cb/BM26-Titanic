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
  buildClusters, seedPanel, expandPanel, DEFAULT_CANVAS, PROJECTED_LAYOUTS,
} from './pixel_map_layout.js';
import {
  startFrameSource, registerPanePainter, onTopology as frameOnTopology,
} from './pixel_map_frame_source.js';
import {
  createViewsContainer, resolveView, toParams, migrateLegacyPixelMap2d,
  findView, addBlankView, removeView, duplicateView,
  renameGroupInViews, removeFixtureFromViews, resetPanelErrorWarnings,
  validateViewDef, validateFraming, validateOffsets, normalizeViewDef,
} from './pixel_map_views.js';
import { seedDefaultViews, DEFAULT_VIEWS } from './pixel_map_view_defaults.js';
import { attachPaneInteraction } from './pixel_map_interaction.js';
import {
  setPixelMapViewsSource, schedulePixelMapViewsSave,
} from './pixel_map_persist.js';
import { normalizeModelPixels } from '../../dmx/model_normalization.js';

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
 *  4 defaults on first open. Fail-loud: a corrupt persisted tree throws.
 *
 *  `params.pixelMapViews` is loaded at boot from the scene's own
 *  `pixel_map_views.yaml` sidecar (main.js), so a persisted layout is already
 *  in hand here — `seedDefaultViews` only ever fires on a container that has
 *  NO views, i.e. a scene that has never saved one. Nothing on this path
 *  re-derives or overwrites persisted framing/offsets/placements. */
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
  // The scoped persister reads the LIVE container on every write, so it always
  // sends the newest layout rather than whatever armed the debounce.
  setPixelMapViewsSource(() => toParams(store.views));
  store.viewsTick.value++;
}

/**
 * Migrate `{group: '<old>'}` view selectors across a group rename (plan
 * 20260725_44 step 12). Views reference groups BY NAME, so without this a
 * rename silently empties every panel that named the group — precisely how
 * the right chimney ring dropped out of the default Top-Down view (`_44`
 * §3.6).
 *
 * Mutates the LIVE container when the 2D map has been opened this session AND
 * the persisted `params.pixelMapViews` tree, so the migration lands whether or
 * not the panel was ever opened. Deliberately does NOT force a save: the
 * renaming caller owns the dirty/auto-save decision (a probe harness with
 * auto-save stubbed must stay a no-write).
 *
 * Returns the rewritten selector rows (loud logging is the caller's).
 */
export function renameGroupInPixelMapViews(oldName, newName) {
  const changed = [];
  if (store.views) {
    changed.push(...renameGroupInViews(store.views, oldName, newName));
    params.pixelMapViews = toParams(store.views);
    notifyViewsChanged();
  } else if (params.pixelMapViews) {
    changed.push(...renameGroupInViews(params.pixelMapViews, oldName, newName));
  }
  // A rename can fix a broken panel as easily as break a working one — let
  // the once-per-reason zero-match warnings speak again.
  if (changed.length > 0) resetPanelErrorWarnings();
  return changed;
}

/**
 * The views container a READER should enumerate: the LIVE container when the
 * 2D map has been opened this session, otherwise the persisted
 * `params.pixelMapViews` tree. Exactly the source `renameGroupInPixelMapViews`
 * and `removeFixtureFromPixelMapViews` mutate, exposed so a caller that must
 * enumerate before mutating (the orphan-fixture delete) cannot read a
 * different tree than the one it is about to change.
 */
export function pixelMapViewsSource() {
  return store.views || params.pixelMapViews || null;
}

/**
 * Drop a DELETED fixture's references out of the 2D Pixel Map views (report
 * 20260725_76 — orphaned-fixture removal): exact `{name: …}` selectors and the
 * per-view move offsets / placements keyed by its name.
 *
 * Same dual-write discipline as `renameGroupInPixelMapViews` above: the LIVE
 * container when the map has been opened this session, otherwise the persisted
 * `params.pixelMapViews` tree, so the removal lands whether or not the panel
 * was ever opened. Deliberately does NOT force a save — the deleting caller
 * owns the dirty decision, and the operator owns the save.
 *
 * Propagates the schema throw from `removeFixtureFromViews` (a fixture that is
 * a panel's only selector). The delete path enumerates that case first and
 * refuses before mutating anything, so reaching the throw means the views tree
 * moved under us — which must be loud, not repaired.
 */
export function removeFixtureFromPixelMapViews(fixtureName) {
  const removed = { selectors: [], offsets: [], placements: [] };
  const merge = (r) => {
    removed.selectors.push(...r.selectors);
    removed.offsets.push(...r.offsets);
    removed.placements.push(...r.placements);
  };
  if (store.views) {
    merge(removeFixtureFromViews(store.views, fixtureName));
    params.pixelMapViews = toParams(store.views);
    notifyViewsChanged();
  } else if (params.pixelMapViews) {
    merge(removeFixtureFromViews(params.pixelMapViews, fixtureName));
  }
  const touched = removed.selectors.length + removed.offsets.length + removed.placements.length;
  if (touched > 0) resetPanelErrorWarnings();
  return removed;
}

/**
 * Rewrite params.pixelMapViews from the container and AUTO-SAVE the layout —
 * scoped to the pixel map's own `pixel_map_views.yaml` sidecar (report
 * 20260725_66). Every 2D-map edit persists on its own, debounced, so a
 * forgotten Save (or a server reload) can never lose an arrangement again.
 *
 * It deliberately no longer forces the FULL-scene save, nor marks the scene
 * dirty. That dragged fixtures, patches, model + engine sidecars to disk from a
 * pan or a drag, overriding the operator's deliberate `autoSave: false` — and
 * it still never wrote the layout itself (`pixelMapViews` had no YAML wiring at
 * either end). The scoped write both fixes the loss AND stops the pixel map
 * from saving things it does not own.
 */
export function commitViews() {
  params.pixelMapViews = toParams(store.views);
  schedulePixelMapViewsSave();
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


// ─── Operator adjustability (report 20260725_54) ───────────────────────────
// The shipped defaults are a STARTING POINT; everything below lets the operator
// reshape them himself instead of asking an agent for each tweak. Every write
// goes through the same validated container + `commitViews()` path his
// hand-placed 2D anchors already use, so his adjustments ride his own save —
// no agent ever writes `scenes/**`.

/** The shipped default definition for a view id, or null for a view he made. */
function shippedDefault(id) {
  return DEFAULT_VIEWS.find((v) => v.id === id) || null;
}

/** True when this view id has a shipped default to reset back to. */
export function hasShippedDefault(id) {
  return !!shippedDefault(id);
}

/**
 * Persist the operator's pan/zoom for a view. Called (debounced) by the pane
 * whenever he drags or wheels, so the framing he lands on is the framing he
 * gets back after a reload — the transient-only behaviour was the single
 * biggest "I can't adjust this" gap (report 20260725_54 §2).
 */
export function setViewFraming(id, framing) {
  const v = findView(store.views, id);
  if (!v) throw new Error(`[PixelMap] cannot frame unknown view '${id}'`);
  const next = {
    zoom: Number(framing.zoom),
    panX: Number(framing.panX),
    panY: Number(framing.panY),
  };
  validateFraming(next, `view '${id}'`);   // fail loud, never clamp silently
  const cur = v.framing;
  // Sub-pixel churn from a drag must not mark the scene dirty on every frame.
  if (cur && Math.abs(cur.zoom - next.zoom) < 1e-4
      && Math.abs(cur.panX - next.panX) < 0.5 && Math.abs(cur.panY - next.panY) < 0.5) {
    return false;
  }
  v.framing = next;
  commitViews();
  return true;
}

/** The operator's saved framing for a view, or null if he never framed it. */
export function getViewFraming(id) {
  const v = findView(store.views, id);
  return (v && v.framing) ? { ...v.framing } : null;
}

/** Drop a view's saved framing so it opens at the shipped fit again. */
export function clearViewFraming(id) {
  const v = findView(store.views, id);
  if (!v) throw new Error(`[PixelMap] cannot reset framing of unknown view '${id}'`);
  if (!v.framing) return false;
  delete v.framing;
  commitViews();
  notifyViewsChanged();
  return true;
}

/**
 * Set one already-schema'd option on one panel — `rotate`, `compress`,
 * `expandPitch`. The whole view is re-validated after the write, so an illegal
 * combination (e.g. `compress` on a non-spatial panel) throws BEFORE anything
 * is persisted and the UI surfaces the message; `undefined` removes the option.
 */
export function setPanelOption(viewId, panelId, key, value) {
  const ALLOWED = ['rotate', 'compress', 'expandPitch', 'weight'];
  if (!ALLOWED.includes(key)) {
    throw new Error(`[PixelMap] '${key}' is not an adjustable panel option ` +
      `(${ALLOWED.join(', ')})`);
  }
  const v = findView(store.views, viewId);
  if (!v) throw new Error(`[PixelMap] cannot adjust unknown view '${viewId}'`);
  const panel = (v.panels || []).find((p) => p.id === panelId);
  if (!panel) throw new Error(`[PixelMap] view '${viewId}' has no panel '${panelId}'`);
  const before = panel[key];
  if (value === undefined) delete panel[key];
  else panel[key] = value;
  try {
    validateViewDef(v);
  } catch (err) {
    if (before === undefined) delete panel[key]; else panel[key] = before;  // roll back
    throw err;
  }
  commitViews();
  notifyViewsChanged();
  return true;
}

/**
 * Resize one fixture type's glyph WITHIN one view (the existing per-view
 * `typeStyles` affordance, now operator-reachable). `size` undefined removes
 * the override so the shipped global style applies again.
 */
export function setViewTypeSize(viewId, fixtureType, size) {
  const v = findView(store.views, viewId);
  if (!v) throw new Error(`[PixelMap] cannot adjust unknown view '${viewId}'`);
  if (typeof fixtureType !== 'string' || !fixtureType) {
    throw new Error('[PixelMap] setViewTypeSize needs a fixtureType');
  }
  if (!v.typeStyles) v.typeStyles = {};
  if (size === undefined) {
    delete v.typeStyles[fixtureType];
  } else {
    const n = Number(size);
    if (!Number.isFinite(n) || n <= 0 || n > 200) {
      throw new Error(`[PixelMap] glyph size for '${fixtureType}' must be > 0 and ` +
        `<= 200 design units, got ${JSON.stringify(size)}`);
    }
    v.typeStyles[fixtureType] = { ...(v.typeStyles[fixtureType] || {}), sizeX: n, sizeY: n };
  }
  validateViewDef(v);
  commitViews();
  notifyViewsChanged();
  return true;
}

/**
 * Put a view back exactly as it shipped — panels, per-view styles, hand-placed
 * anchors and framing all restored from `DEFAULT_VIEWS`. The escape hatch that
 * makes every other adjustment safe to try.
 *
 * Throws for a view he created himself: there is no shipped default to restore,
 * and silently doing nothing (or blanking it) would both be worse.
 */
export function resetViewToDefault(id) {
  const def = shippedDefault(id);
  if (!def) {
    throw new Error(`[PixelMap] '${id}' is not one of the shipped default views, ` +
      'so there is nothing to reset it to — delete it instead if you want it gone');
  }
  const v = findView(store.views, id);
  if (!v) throw new Error(`[PixelMap] cannot reset unknown view '${id}'`);
  const fresh = normalizeViewDef(def);
  v.label = fresh.label;
  v.panels = fresh.panels;
  v.placements = fresh.placements;
  v.typeStyles = fresh.typeStyles;
  delete v.framing;
  delete v.offsets;
  commitViews();
  notifyViewsChanged();
  return true;
}

// ─── Frame source + topology bridge ────────────────────────────────────────

// Scene-gated (normalizeEngineExport): the 2D pixel map lays out on the SAME
// normalized coordinates the engine model exports with, while the 3D view and
// the in-browser pattern engine keep as-built geometry. Entries are
// prototype-linked clones — own wx/wy/wz (+nx/ny/nz) shadow the layout
// coords; every other read (live r/g/b, group, patch) falls through to the
// live entry, so per-frame colors stay live. A transform failure throws —
// the map must never silently fall back to as-built coords (codex P0).
function pixelMapTopologyList(list) {
  if (!params.normalizeEngineExport || !list || !list.length) return list;
  const normalized = normalizeModelPixels(
    list.map(e => ({ x: e.wx, y: e.wy, z: e.wz, group: e.group })),
    { xGap: params.normalizeXGap });
  return list.map((e, i) => {
    const entry = Object.create(e);
    entry.wx = normalized[i].x;
    entry.wy = normalized[i].y;
    entry.wz = normalized[i].z;
    entry.nx = normalized[i].nx;
    entry.ny = normalized[i].ny;
    entry.nz = normalized[i].nz;
    return entry;
  });
}

/** Start the single shared frame source (one onPixelFrame subscription for the
 *  whole multiview) and the recluster bridge. Idempotent. */
export function startPixelMapDataPlane() {
  if (store._started) return;
  store._started = true;
  startFrameSource(onPixelFrame);
  store._frameTopoUnsub = frameOnTopology((list, version) => {
    store.list = pixelMapTopologyList(list);
    store.version = version;
    store.clusters = buildClusters(store.list);
    store.fixtureCount.value = store.clusters.length;
    store.pixelCount.value = list ? list.length : 0;
    for (const fn of [...store._topoListeners]) {
      try { fn(store.clusters, store.list, version); }
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
// fixKey → { panelId, layout, group } for the view most recently built. The
// edit context reads it to decide whether a move writes an OFFSET (projected
// panels) or an absolute PLACEMENT (radial/lanes) — see report 20260725_55.
const fixtureModel = new Map();

function buildPanelsForView(viewId) {
  const design = { ...DEFAULT_CANVAS };
  fixtureModel.clear();
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
    const pixels = expandPanel(def, panel.clusters, store.list, placements, styles,
      viewDef.offsets);
    // Which movement model each fixture obeys, resolved ONCE per rebuild so a
    // drag does not re-resolve the view on every pointermove.
    for (const c of panel.clusters) {
      fixtureModel.set(c.fixKey,
        { panelId: id, layout: def.layout, group: c.group });
    }
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
    // A TRUE projection ignores placements entirely, so seeding anchors for one
    // only writes junk into the scene and marks it dirty for nothing. Those
    // panels move via OFFSETS instead (report 20260725_55).
    if (PROJECTED_LAYOUTS.has(panel.def.layout)) continue;
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
    // ── Move model (report 20260725_55) ──────────────────────────────────
    // A fixture on a TRUE projection (spatial/planar) obeys an OFFSET — a delta
    // from its projected position — because those layouts compute every
    // coordinate from world data and ignore `placements` outright. That is why
    // dragging in the shipped Top-Down view moved nothing before this: the drag
    // wrote a placement nobody read. A fixture on radial/lanes keeps the
    // absolute anchor it always had.
    //
    // Granularity is PER FIXTURE, which is also the granularity of the
    // selection (a Set of fixKeys), so there is no partial-pixel case to
    // invent persistence for.
    anchorModelOf: (fixKey) => {
      const m = fixtureModel.get(fixKey);
      return (m && PROJECTED_LAYOUTS.has(m.layout)) ? 'offset' : 'placement';
    },
    /** Current movable position of a fixture in the ACTIVE model, or null. */
    getAnchor: (fixKey) => {
      const v = findView(store.views, paneCtx.getViewId());
      if (!v) return null;
      const m = fixtureModel.get(fixKey);
      if (m && PROJECTED_LAYOUTS.has(m.layout)) {
        const o = (v.offsets || {})[fixKey];
        return { x: o ? o.dx : 0, y: o ? o.dy : 0, rot: 0, model: 'offset' };
      }
      const pl = v.placements[fixKey];
      return pl ? { x: pl.x, y: pl.y, rot: pl.rot || 0, model: 'placement' } : null;
    },
    setAnchor: (fixKey, x, y, rot) => {
      const v = findView(store.views, paneCtx.getViewId());
      if (!v) return;
      const m = fixtureModel.get(fixKey);
      if (m && PROJECTED_LAYOUTS.has(m.layout)) {
        if (!v.offsets) v.offsets = {};
        // An offset back to zero is a REMOVAL, so "never moved" stays
        // distinguishable from "moved and moved back" — same stance as framing.
        if (Math.abs(x) < 1e-6 && Math.abs(y) < 1e-6) delete v.offsets[fixKey];
        else v.offsets[fixKey] = { dx: x, dy: y };
        return;
      }
      v.placements[fixKey] = { x, y, rot: rot || 0 };
    },
    /** True when a fixture can be ROTATED — only the anchor/line layouts can;
     *  a projected fixture's angle comes from its real world coordinates. */
    canRotate: (fixKey) => {
      const m = fixtureModel.get(fixKey);
      return !!m && !PROJECTED_LAYOUTS.has(m.layout);
    },
    /** Every fixture sharing this one's GROUP inside the same panel — the
     *  right-click group selection (report 20260725_55). */
    groupOf: (fixKey) => {
      const m = fixtureModel.get(fixKey);
      if (!m || !m.group) return [fixKey];
      const out = [];
      for (const [k, v] of fixtureModel) {
        if (v.panelId === m.panelId && v.group === m.group) out.push(k);
      }
      return out.length ? out : [fixKey];
    },
    rebuild: () => paneView.setPanels(buildPanelsForView(paneCtx.getViewId())),
    commit: () => commitViews(),
    setHover: (info) => { store.hover.value = info; },
    colorOf: colorForGi,
  };
}

/** Drop every operator MOVE on a view, back to the pure projection. */
export function clearViewOffsets(id) {
  const v = findView(store.views, id);
  if (!v) throw new Error(`[PixelMap] cannot reset moves of unknown view '${id}'`);
  if (!v.offsets || !Object.keys(v.offsets).length) return false;
  delete v.offsets;
  commitViews();
  notifyViewsChanged();
  return true;
}

/** How many fixtures the operator has moved on a view (for the Adjust UI). */
export function movedCount(id) {
  const v = findView(store.views, id);
  return v && v.offsets ? Object.keys(v.offsets).length : 0;
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
    expandPanel: (def, clusters, list, placements, styles, offsets) =>
      expandPanel(def, clusters, list, placements, styles, offsets),
    buildPanels: (viewId) => buildPanelsForView(viewId),
    onTopology: (fn) => { store._topoListeners.add(fn); return () => store._topoListeners.delete(fn); },
    subscribeViews: (fn) => { store._viewsListeners.add(fn); return () => store._viewsListeners.delete(fn); },
    registerPanePainter: (fn) => registerPanePainter(fn),
    canvasSize: () => ({ ...DEFAULT_CANVAS }),
    currentTopology: () => (store.list ? { clusters: store.clusters, list: store.list, version: store.version } : null),
    openViewManager: () => { store.managerOpen.value = true; },
    getMode: () => store.mode.value,
    subscribeMode: (fn) => effect(() => { fn(store.mode.value); }),
    subscribeSelection: (fn) => effect(() => { fn(store.selection.value); }),
    attachInteraction: (canvas, paneView, paneCtx) =>
      attachPaneInteraction(canvas, paneView, makeEditCtx(paneView, paneCtx)),
    onLayoutChange: (state) => { if (state && typeof state.focus === 'string') store.focusedPath.value = state.focus; },
    // Operator framing (report 20260725_54): the pane reads its bound view's
    // saved pan/zoom on bind, and reports every change back here so it persists
    // through the SAME commitViews path his hand-placed anchors use.
    getViewFraming: (viewId) => getViewFraming(viewId),
    onViewFraming: (viewId, framing) => {
      try { setViewFraming(viewId, framing); }
      catch (err) { console.warn('[PixelMap] framing not saved:', err.message); }
    },
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
