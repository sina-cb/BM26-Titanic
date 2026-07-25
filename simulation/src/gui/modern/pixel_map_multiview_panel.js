/**
 * pixel_map_multiview_panel.js — the multiview container for the 2D Pixel Map:
 * a vim/tmux-style binary-split pane grid. Renders the pane tree, draggable
 * dividers, per-pane headers (view-binding dropdown + split/close/zoom), and
 * the focus-scoped keyboard bindings from design §2.3. Injects its own CSS so
 * style.css stays untouched (slice disjointness).
 *
 * Data plane (S1/S2) is INJECTED via a `deps` object rather than statically
 * imported, so this slice carries no cross-slice import and can be mounted with
 * mocks before S1/S2 land; S4 constructs the real `deps` from the frame source
 * (registerPanePainter/onTopology), the view model (resolveView/getViewDef/
 * listViews), and the layout expanders (seedPanel/expandPanel). Contract (§5):
 *
 *   deps = {
 *     scene: string,
 *     listViews(): Array<{ id, label }>,
 *     getViewDef(id): viewDef | null,
 *     resolveView(viewDef, clusters, list): { panels: [{ def, clusters, placements, styles }] },
 *     seedPanel(panelDef, clusters, list, w, h, styles): Map<fixKey,{x,y,rot}>,
 *     expandPanel(panelDef, clusters, list, placements, styles): [{ gi, cx, cy, sizeX, sizeY, shape, rot, fixKey }],
 *     onTopology(fn): unregister,          // fn(clusters, list, version)
 *     registerPanePainter(fn): unregister, // fn(colorBuf, list, version)
 *     canvasSize?(): { w, h },             // per-view design canvas (default 900x520)
 *     openViewManager?(): void,
 *     currentTopology?(): { clusters, list, version } | null,
 *     onLayoutChange?(state): void,        // persistence hook (S4)
 *   }
 */

import { html } from 'htm/preact';
import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

import { PixelMapPaneView } from '../pixel_map/pixel_map_pane_view.js';
import {
  createState, splitPane, closePane, setRatio, bindView, toggleZoom,
  cycleFocus, moveFocus, resizeFocused, computeLayout, getNode,
  loadLayout, saveLayout, clearLayout,
} from '../pixel_map/pixel_map_pane_tree.js';

const DEFAULT_DESIGN = { w: 900, h: 520 };
const DIVIDER_PX = 6;
const STYLE_ID = 'pmv-injected-styles';

// ── Injected CSS (keeps style.css untouched) ──────────────────────────────
const CSS = `
.pmv-root { position: absolute; inset: 0; outline: none;
  background: #070910; font-family: "Cascadia Code", Consolas, monospace; }
.pmv-panes { position: absolute; inset: 0; }
.pmv-pane { position: absolute; display: flex; flex-direction: column;
  border: 1px solid rgba(140,160,200,0.10); box-sizing: border-box;
  background: #0b0d12; overflow: hidden; }
.pmv-pane.focused { border-color: #fabd2f; box-shadow: inset 0 0 0 1px rgba(250,189,47,0.35); }
.pmv-head { display: flex; align-items: center; gap: 4px; height: 24px;
  padding: 0 4px; background: #10141c; border-bottom: 1px solid rgba(140,160,200,0.10);
  font-size: 11px; color: #a8b2c4; flex: 0 0 auto; }
.pmv-view { flex: 1 1 auto; min-width: 0; background: #0b0d12; color: #cdd6e6;
  border: 1px solid rgba(140,160,200,0.14); border-radius: 3px; height: 18px;
  font: inherit; font-size: 11px; padding: 0 4px; }
.pmv-btn { flex: 0 0 auto; width: 20px; height: 18px; line-height: 16px;
  text-align: center; background: #161b24; color: #a8b2c4; cursor: pointer;
  border: 1px solid rgba(140,160,200,0.14); border-radius: 3px; font-size: 11px; padding: 0; }
.pmv-btn:hover { color: #fabd2f; border-color: rgba(250,189,47,0.4); }
.pmv-canvas-host { flex: 1 1 auto; position: relative; min-height: 0; }
.pmv-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.pmv-divider { position: absolute; z-index: 5; }
.pmv-divider.v { cursor: col-resize; }
.pmv-divider.h { cursor: row-resize; }
.pmv-divider:hover { background: rgba(250,189,47,0.25); }
.pmv-toast { position: absolute; left: 50%; top: 12px; transform: translateX(-50%);
  z-index: 20; background: rgba(120,20,24,0.95); color: #ffd9d0; font-size: 12px;
  padding: 6px 12px; border-radius: 4px; max-width: 80%; }
`;

function injectStyles() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
}

// ── Data building (view → pane panels) ────────────────────────────────────
// Returns the panel list a PixelMapPaneView consumes. A view that was deleted,
// or a selector schema error, becomes a loud inline error panel (design §2.2)
// — a visible error, never a silent empty pane.
// Prefer the integration's data-plane builder (deps.buildPanels) — which reads
// PERSISTED per-view placements and stamps edit metadata — falling back to the
// local mock builder so the capture tool still mounts with a bare deps object.
function panelsFor(deps, viewId, topo) {
  if (deps.buildPanels) return deps.buildPanels(viewId);
  return buildPanels(deps, viewId, topo.clusters, topo.list);
}

function buildPanels(deps, viewId, clusters, list) {
  const design = (deps.canvasSize && deps.canvasSize()) || DEFAULT_DESIGN;
  const viewDef = deps.getViewDef(viewId);
  if (!viewDef) {
    return [{ id: 'missing', label: viewId, error: 'view removed — pick another', design }];
  }
  let resolved;
  try {
    resolved = deps.resolveView(viewDef, clusters, list);
  } catch (err) {
    return [{ id: viewId, label: viewDef.label || viewId, error: err.message, design }];
  }
  return resolved.panels.map((panel, i) => {
    const def = panel.def || {};
    const id = def.id || `panel${i}`;
    if (panel.error) return { id, label: def.label || id, error: panel.error, design, weight: def.weight };
    const styles = panel.styles;
    const placements = (panel.placements && panel.placements.size)
      ? panel.placements
      : deps.seedPanel(def, panel.clusters, list, design.w, design.h, styles);
    const pixels = deps.expandPanel(def, panel.clusters, list, placements, styles);
    return { id, label: def.label || id, weight: def.weight || 1, design, pixels, error: null };
  });
}

// ── The pane element ──────────────────────────────────────────────────────
function Pane({ pane, focused, deps, records, topoRef, onFocus, onSplit, onClose, onZoom, onBind }) {
  const views = deps.listViews ? deps.listViews() : [];
  const onCanvas = (el) => {
    const key = pane.path;
    if (el) {
      let rec = records.current.get(key);
      if (!rec) {
        const viewInst = new PixelMapPaneView();
        const unregister = deps.registerPanePainter((buf, list, ver) => viewInst.paint(buf, list, ver));
        const ro = (typeof ResizeObserver !== 'undefined')
          ? new ResizeObserver(() => viewInst.resize()) : null;
        rec = { viewInst, unregister, ro, canvas: null, viewId: null, detach: null };
        // Initial mode + per-pane edit/pan/zoom interaction (S4 data plane).
        if (deps.getMode) viewInst.setMode(deps.getMode());
        if (deps.attachInteraction) {
          rec.detach = deps.attachInteraction(el, viewInst, {
            getPath: () => key,
            getViewId: () => rec.viewId,
          });
        }
        records.current.set(key, rec);
      }
      if (rec.canvas !== el) {
        rec.viewInst.attach(el);
        if (rec.ro) { rec.ro.disconnect(); rec.ro.observe(el); }
        rec.canvas = el;
      }
      // (Re)load this pane's data when its bound view changes or on first mount.
      if (rec.viewId !== pane.view) {
        rec.viewId = pane.view;
        const topo = topoRef.current || (deps.currentTopology ? deps.currentTopology() : null);
        rec.viewInst.setPanels(topo ? panelsFor(deps, pane.view, topo) : []);
      }
    }
  };
  return html`
    <div class=${`pmv-pane${focused ? ' focused' : ''}`} key=${pane.path}
         style=${`left:${pane.x}px;top:${pane.y}px;width:${pane.w}px;height:${pane.h}px`}
         onPointerdown=${() => onFocus(pane.path)}>
      <div class="pmv-head">
        <select class="pmv-view" value=${pane.view}
                onChange=${(e) => {
                  if (e.target.value === '__manage') { if (deps.openViewManager) deps.openViewManager(); e.target.value = pane.view; return; }
                  onBind(pane.path, e.target.value);
                }}>
          ${views.map((v) => html`<option value=${v.id} selected=${v.id === pane.view}>${v.label || v.id}</option>`)}
          <option value="__manage">Manage views…</option>
        </select>
        <button class="pmv-btn" title="split vertical (\\)" onClick=${() => onSplit(pane.path, 'v')}>⊞</button>
        <button class="pmv-btn" title="split horizontal (-)" onClick=${() => onSplit(pane.path, 'h')}>⊟</button>
        <button class="pmv-btn" title="zoom (z)" onClick=${() => onZoom(pane.path)}>⛶</button>
        <button class="pmv-btn" title="close (x)" onClick=${() => onClose(pane.path)}>✕</button>
      </div>
      <div class="pmv-canvas-host">
        <canvas class="pmv-canvas" ref=${onCanvas}></canvas>
      </div>
    </div>
  `;
}

// ── The multiview root ────────────────────────────────────────────────────
function Multiview({ deps, initial }) {
  const [layout, setLayoutState] = useState(initial);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [toast, setToast] = useState(null);
  const rootRef = useRef(null);
  const records = useRef(new Map());   // path → { viewInst, unregister, ro, canvas, viewId }
  const topoRef = useRef(deps.currentTopology ? deps.currentTopology() : null);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  // Current topology: the last onTopology payload, or (crucially) a live read
  // from deps.currentTopology(). deps.onTopology can miss the very first
  // topology bump if the store dispatched it before this component's effect
  // registered the listener (mount-ordering race); currentTopology() reads the
  // store's live cluster/list state, so panes always populate once data exists.
  const getTopo = () => topoRef.current || (deps.currentTopology ? deps.currentTopology() : null);

  const commit = (next) => {
    setLayoutState(next);
    try { saveLayout(deps.scene, next); if (deps.onLayoutChange) deps.onLayoutChange(next); }
    catch (err) { console.warn(`[PixelMap] pane layout save failed: ${err.message}`); }
  };

  // Refresh every live pane's data from the current topology (called on
  // topology bumps and after view rebinds).
  const refreshAll = () => {
    const topo = getTopo();
    if (!topo) return;
    for (const [path, rec] of records.current) {
      const node = getNode(layoutRef.current.root, path);
      if (node && typeof node.view === 'string') {
        rec.viewId = node.view;
        rec.viewInst.setPanels(panelsFor(deps, node.view, topo));
      }
    }
  };

  // Topology + painter wiring (single frame-source subscription lives in deps).
  useEffect(() => {
    const off = deps.onTopology((clusters, list, version) => {
      topoRef.current = { clusters, list, version };
      refreshAll();
    });
    // If data already exists (store dispatched before we subscribed), prime now.
    if (getTopo()) refreshAll();
    return () => { if (off) off(); };
  }, []);

  // Track the pane area size so computeLayout gets real pixels.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = (typeof ResizeObserver !== 'undefined') ? new ResizeObserver(measure) : null;
    if (ro) ro.observe(el);
    if (typeof window !== 'undefined') window.addEventListener('resize', measure);
    el.focus();
    return () => {
      if (ro) ro.disconnect();
      if (typeof window !== 'undefined') window.removeEventListener('resize', measure);
    };
  }, []);

  // Dispose pane records whose path no longer exists after a structural change.
  useEffect(() => {
    const { panes } = computeLayout(layout, box.w || 1, box.h || 1, DIVIDER_PX);
    const live = new Set(panes.map((p) => p.path));
    for (const [path, rec] of [...records.current]) {
      if (!live.has(path)) {
        if (rec.detach) rec.detach();
        if (rec.unregister) rec.unregister();
        if (rec.ro) rec.ro.disconnect();
        rec.viewInst.dispose();
        records.current.delete(path);
      }
    }
  });

  // Tear everything down on unmount.
  useEffect(() => () => {
    for (const rec of records.current.values()) {
      if (rec.detach) rec.detach();
      if (rec.unregister) rec.unregister();
      if (rec.ro) rec.ro.disconnect();
      rec.viewInst.dispose();
    }
    records.current.clear();
  }, []);

  // Mode (VIEW/EDIT) is a global signal in the S4 store — push it to every
  // pane so selection chrome + edit interaction switch in lock-step.
  useEffect(() => {
    if (!deps.subscribeMode) return;
    return deps.subscribeMode((m) => { for (const rec of records.current.values()) rec.viewInst.setMode(m); });
  }, []);

  // Views container changed (add/remove/rename/duplicate) — refresh dropdowns
  // and re-resolve every bound pane (a removed view shows its "removed" state).
  useEffect(() => {
    if (!deps.subscribeViews) return;
    return deps.subscribeViews(() => { setToast(null); refreshAll(); setBox((b) => ({ ...b })); });
  }, []);

  // Publish the initial focus so the store can scope edit-key handling.
  useEffect(() => { if (deps.onLayoutChange) deps.onLayoutChange(layoutRef.current); }, []);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 4000); };

  // ── Actions ──
  const onFocus = (path) => commit({ ...layoutRef.current, focus: path });
  const onSplit = (path, dir) => commit(splitPane(layoutRef.current, path, dir));
  const onClose = (path) => commit(closePane(layoutRef.current, path));
  const onZoom = (path) => commit(toggleZoom(layoutRef.current, path));
  const onBind = (path, viewId) => {
    const next = bindView(layoutRef.current, viewId, path);
    commit(next);
    const rec = records.current.get(path);
    const topo = getTopo();
    if (rec && topo) { rec.viewId = viewId; rec.viewInst.setPanels(panelsFor(deps, viewId, topo)); }
  };

  // ── Keyboard (scoped to the vis focus; every handler stops propagation so
  //    the 3D shortcuts T/R/S/Q/D/P/H/B/M never fire — design §2.3). ──
  const onKeyDown = (e) => {
    const st = layoutRef.current;
    const views = deps.listViews ? deps.listViews() : [];
    let next = null;
    if (e.key === '\\') next = splitPane(st, st.focus, 'v');
    else if (e.key === '-') next = splitPane(st, st.focus, 'h');
    else if (e.key === 'x') next = closePane(st, st.focus);
    else if (e.key === 'z') next = toggleZoom(st, st.focus);
    else if (e.key === 'Tab') next = cycleFocus(st, e.shiftKey ? -1 : 1);
    else if (e.key === 'f') { const r = records.current.get(st.focus); if (r) r.viewInst.fit(); }
    else if (e.altKey && e.key === 'ArrowLeft') next = moveFocus(st, 'left');
    else if (e.altKey && e.key === 'ArrowRight') next = moveFocus(st, 'right');
    else if (e.altKey && e.key === 'ArrowUp') next = moveFocus(st, 'up');
    else if (e.altKey && e.key === 'ArrowDown') next = moveFocus(st, 'down');
    else if (e.ctrlKey && e.altKey && e.key === 'ArrowLeft') next = resizeFocused(st, 'left');
    else if (e.ctrlKey && e.altKey && e.key === 'ArrowRight') next = resizeFocused(st, 'right');
    else if (e.ctrlKey && e.altKey && e.key === 'ArrowUp') next = resizeFocused(st, 'up');
    else if (e.ctrlKey && e.altKey && e.key === 'ArrowDown') next = resizeFocused(st, 'down');
    else if (e.key === '[' || e.key === ']') {
      const cur = getNode(st.root, st.focus);
      const idx = views.findIndex((v) => v.id === (cur && cur.view));
      if (views.length) {
        const ni = ((idx < 0 ? 0 : idx) + (e.key === ']' ? 1 : -1) + views.length) % views.length;
        onBind(st.focus, views[ni].id);
      }
    } else if (/^[1-9]$/.test(e.key)) {
      const v = views[parseInt(e.key, 10) - 1];
      if (v) onBind(st.focus, v.id);
    } else {
      // Focus-scoped: while the vis root holds keyboard focus, NO key may reach
      // the 3D scene shortcuts (T/R/S/Q/D/P/H/B/M…). Swallow everything except
      // browser-critical Ctrl/Meta combos (copy, devtools, this app's Ctrl+…).
      if (!e.ctrlKey && !e.metaKey) e.stopPropagation();
      return;
    }
    e.stopPropagation();
    e.preventDefault();
    if (next) commit(next);
  };

  // ── Divider drag ──
  const startDrag = (div, e) => {
    e.preventDefault();
    e.stopPropagation();
    const node = getNode(layoutRef.current.root, div.path);
    if (!node) return;
    const el = rootRef.current;
    const rect = el.getBoundingClientRect();
    // The divider's span size (parent extent along the split axis) — recover it
    // from the child pane geometry so the ratio maps to pointer position.
    const move = (ev) => {
      const { panes } = computeLayout(layoutRef.current, box.w, box.h, DIVIDER_PX);
      const aPane = panes.find((p) => p.path.startsWith(div.path + 'a') || p.path === div.path + 'a');
      // Fall back to the divider's own origin for the parent box.
      let ratio;
      if (div.dir === 'v') {
        const px = ev.clientX - rect.left;
        const parentX = div.parentX, parentW = div.parentW;
        ratio = (px - parentX) / parentW;
      } else {
        const py = ev.clientY - rect.top;
        const parentY = div.parentY, parentH = div.parentH;
        ratio = (py - parentY) / parentH;
      }
      commit(setRatio(layoutRef.current, div.path, ratio));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const { panes, dividers } = computeLayout(layout, box.w || 1, box.h || 1, DIVIDER_PX);
  // Annotate dividers with their parent box so a drag maps pointer→ratio.
  const parentBox = (path) => {
    const { panes: all } = computeLayout({ ...layout, zoom: null }, box.w || 1, box.h || 1, 0);
    const kids = all.filter((p) => p.path.startsWith(path));
    if (!kids.length) return { x: 0, y: 0, w: box.w, h: box.h };
    const x = Math.min(...kids.map((k) => k.x));
    const y = Math.min(...kids.map((k) => k.y));
    const r = Math.max(...kids.map((k) => k.x + k.w));
    const b = Math.max(...kids.map((k) => k.y + k.h));
    return { x, y, w: r - x, h: b - y };
  };

  return html`
    <div class="pmv-root" tabindex="0" ref=${rootRef} onKeyDown=${onKeyDown}>
      <div class="pmv-panes">
        ${panes.map((pane) => html`<${Pane} key=${pane.path} pane=${pane}
            focused=${pane.path === layout.focus} deps=${deps} records=${records} topoRef=${topoRef}
            onFocus=${onFocus} onSplit=${onSplit} onClose=${onClose} onZoom=${onZoom} onBind=${onBind} />`)}
        ${dividers.map((d) => {
          const pb = parentBox(d.path);
          const div = { ...d, parentX: pb.x, parentY: pb.y, parentW: pb.w, parentH: pb.h };
          return html`<div class=${`pmv-divider ${d.dir}`}
            style=${`left:${d.x}px;top:${d.y}px;width:${d.w}px;height:${d.h}px`}
            onPointerdown=${(e) => startDrag(div, e)}></div>`;
        })}
      </div>
      ${toast ? html`<div class="pmv-toast">${toast}</div>` : null}
    </div>
  `;
}

// ── Public mount API ──────────────────────────────────────────────────────

/**
 * Mount the multiview into `host`, wired to the injected data plane `deps`.
 * Loads the saved per-scene pane layout (loud recovery to a single-pane default
 * on a corrupt/stale entry) and returns an unmount function.
 */
export function mountPixelMapMultiview(host, deps) {
  injectStyles();
  const views = deps.listViews ? deps.listViews() : [];
  const validIds = views.map((v) => v.id);
  const defaultViewId = validIds[0] || 'default';

  let initial;
  try {
    initial = loadLayout(deps.scene, validIds.length ? validIds : null);
  } catch (err) {
    console.warn(`[PixelMap] saved pane layout was invalid (${err.message}) — resetting to single pane.`);
    try { clearLayout(deps.scene); } catch (_) { /* localStorage absent — nothing to clear */ }
    initial = null;
  }
  if (!initial) initial = createState(defaultViewId);

  render(html`<${Multiview} deps=${deps} initial=${initial} />`, host);
  return () => render(null, host);
}
