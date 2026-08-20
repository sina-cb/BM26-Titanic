/**
 * pixel_map_panel.js — Modern (Preact) 2D Pixel Map full-screen viewport.
 *
 * The host chrome for the MULTIVIEW (S4 integration): a top toolbar (VIEW/EDIT
 * mode, live fixture/pixel count, Views manager), the multiview pane grid
 * itself (mounted imperatively into the canvas host), a status strip, and the
 * Views manager overlay. Exclusive to the `2d_pixels` lighting profile — it
 * replaces the (blacked-out) 3D canvas, driven by the headless latch in
 * animate.js and the `M` key.
 *
 * The single onPixelFrame subscription, the "views are data" container, and the
 * recluster/persistence bridges all live in pixel_map_store.js; this file wires
 * them to the S3 multiview shell (mountPixelMapMultiview) via the deps object.
 */

import { html } from 'htm/preact';
import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { effect } from '@preact/signals';

import { params } from '../../core/state.js';
import { FloatingPanel } from './floating_panel.js';
import { mountPixelMapMultiview } from './pixel_map_multiview_panel.js';
import {
  store, showPixelMap, registerPixelMapGlobals,
  loadViewsFromParams, startPixelMapDataPlane, buildMultiviewDeps,
  addBlankViewOp, duplicateViewOp, removeViewOp, renameViewOp,
  setPanelOption, setViewTypeSize, resetViewToDefault, hasShippedDefault,
  getViewFraming, clearViewFraming, clearViewOffsets, movedCount,
} from '../pixel_map/pixel_map_store.js';
import { findView, resolveView } from '../pixel_map/pixel_map_views.js';
import { installPixelMapPersistence } from '../pixel_map/pixel_map_persist.js';

const PANEL_ID = 'pixel-map-panel';

function rotateFocusedSelection(key) {
  const canvas = document.querySelector('.pmv-pane.focused .pmv-canvas');
  if (!canvas) return;
  canvas.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
}

// ── Top toolbar: mode, count, Views manager ────────────────────────────────
function Toolbar() {
  const mode = store.mode.value;
  return html`
    <div class="pm-toolbar">
      <div class="pm-seg">
        <button class=${`pm-seg-btn${mode === 'view' ? ' active' : ''}`} onClick=${() => { store.mode.value = 'view'; }}>VIEW</button>
        <button class=${`pm-seg-btn${mode === 'edit' ? ' active' : ''}`} onClick=${() => { store.mode.value = 'edit'; }}>EDIT</button>
      </div>
      <span class="pm-count">${store.fixtureCount.value} fix · ${store.pixelCount.value} px</span>
      <button class="pm-mini pm-reset" title="Add / remove / rename views" onClick=${() => { store.managerOpen.value = true; }}>⧉ Views…</button>
    </div>
  `;
}

function StatusStrip() {
  const hover = store.hover.value;
  const hasSelection = store.mode.value === 'edit' && store.selection.value.size > 0;
  return html`
    <div class="pm-status">
      <span class="pm-swatch" style=${`background:${hover ? hover.hex : 'transparent'}`}></span>
      <span class="pm-status-txt">${hover
        ? `${hover.name}  ${hover.hex}`
        : (store.mode.value === 'edit'
            ? 'EDIT — click select · shift+click add · RIGHT-click selects the GROUP (shift adds) · drag to move · arrows nudge · Esc clears'
            : 'VIEW — drag to pan · wheel to zoom · \\ / - split · Tab focus · [ ] cycle view · z zoom pane')}</span>
      <span class="pm-status-right">
        ${hasSelection && html`
          <button class="pm-mini" title="Rotate selected fixture or visual group 15° left (Q)"
                  onClick=${() => rotateFocusedSelection('q')}>↶ 15°</button>
          <button class="pm-mini" title="Rotate selected fixture or visual group 15° right (E)"
                  onClick=${() => rotateFocusedSelection('e')}>↷ 15°</button>`}
        <span class="pm-zoom">${store.mode.value.toUpperCase()}</span>
      </span>
    </div>
  `;
}

// ── Per-view adjustment inspector (report 20260725_54) ─────────────────────
// The shipped defaults are a STARTING POINT. This exposes the knobs the view
// schema already validates — framing, panel rotation, gap compression, LED
// pitch, per-view glyph sizes — so the operator reshapes a view himself instead
// of asking an agent for each tweak. Every control writes through a validated
// store op; anything illegal throws and lands in the toast, never half-applied.

/** Fixture types currently drawn by a view, for the glyph-size rows. */
function typesInView(viewId) {
  const topo = store.list ? { clusters: store.clusters, list: store.list } : null;
  if (!topo) return [];
  const v = findView(store.views, viewId);
  if (!v) return [];
  const seen = new Set();
  try {
    const r = resolveView(v, topo.clusters, topo.list, { viewRegistry: store.viewRegistry });
    for (const p of r.panels) for (const c of (p.clusters || [])) seen.add(c.fixtureType);
  } catch { /* a broken view still shows its other controls */ }
  return [...seen].sort();
}

function Row({ label, hint, children }) {
  return html`
    <div class="pm-adj-row">
      <label class="pm-adj-label" title=${hint || ''}>${label}</label>
      <div class="pm-adj-ctl">${children}</div>
    </div>`;
}

function PanelAdjust({ view, panel, guard }) {
  const rot = panel.rotate || 0;
  const comp = panel.compress;
  const pitch = panel.expandPitch || {};
  const spatial = panel.layout === 'spatial';
  const projected = spatial || panel.layout === 'planar';
  return html`
    <div class="pm-adj-panel">
      <div class="pm-adj-panel-head">
        <code>${panel.id}</code>
        <span class="pm-adj-dim">${panel.label || ''} · ${panel.layout}${panel.projection ? ` · ${panel.projection}` : ''}</span>
      </div>

      ${projected && html`
        <${Row} label="Rotate" hint="Quarter turns, counter-clockwise. Re-orients the whole projection; no pixel moves relative to another.">
          <select onChange=${(e) => guard(() => setPanelOption(view.id, panel.id, 'rotate',
              Number(e.target.value) === 0 ? undefined : Number(e.target.value)))}>
            ${[0, 90, 180, 270].map((d) => html`<option value=${d} selected=${d === rot}>${d}°</option>`)}
          </select>
        <//>`}

      ${spatial && html`
        <${Row} label="Wash angle" hint="Base aim for every wash in this panel. EDIT-mode rotation adds a per-stack offset without changing this saved base angle.">
          <input class="pm-adj-num" type="number" step="1" min="-180" max="180"
                 value=${panel.washAngle === undefined ? '' : panel.washAngle}
                 placeholder="0"
                 onChange=${(e) => guard(() => setPanelOption(view.id, panel.id,
                   'washAngle', e.target.value === '' ? undefined : Number(e.target.value)))} />
          <span class="pm-adj-dim">degrees</span>
        <//>`}

      ${spatial && html`
        <${Row} label="Close the gaps" hint="Collapse empty bands wider than the threshold down to the gap size. Within a side, every distance is preserved exactly — only the space BETWEEN sides shrinks.">
          <input type="checkbox" checked=${!!comp}
                 onChange=${(e) => guard(() => setPanelOption(view.id, panel.id, 'compress',
                    e.target.checked ? { minWorldGap: 5, gapWorld: 4 } : undefined))} />
          ${comp && html`
            <span class="pm-adj-inline">
              gap <input class="pm-adj-num" type="number" step="0.5" min="0" max=${comp.minWorldGap - 0.1} value=${comp.gapWorld}
                    onChange=${(e) => guard(() => setPanelOption(view.id, panel.id, 'compress',
                      { ...comp, gapWorld: Number(e.target.value) }))} />
              over <input class="pm-adj-num" type="number" step="1" min="0.5" value=${comp.minWorldGap}
                    onChange=${(e) => guard(() => setPanelOption(view.id, panel.id, 'compress',
                      { ...comp, minWorldGap: Number(e.target.value) }))} />
              <span class="pm-adj-dim">world units</span>
            </span>`}
        <//>`}

      ${spatial && Object.keys(pitch).length > 0 && Object.entries(pitch).map(([type, p]) => html`
        <${Row} key=${type} label=${`${type} LED pitch`} hint="Spread a fixture's OWN LEDs to a legible spacing. The fixture stays where it physically is; only its internal spacing stretches.">
          <input class="pm-adj-num" type="number" step="0.05" min="0.05" value=${p}
                 onChange=${(e) => guard(() => setPanelOption(view.id, panel.id, 'expandPitch',
                   { ...pitch, [type]: Number(e.target.value) }))} />
          <span class="pm-adj-dim">world units</span>
        <//>`)}
    </div>`;
}

function ViewAdjust({ view, guard }) {
  const framing = getViewFraming(view.id);
  const types = typesInView(view.id);
  const styles = view.typeStyles || {};
  return html`
    <div class="pm-adj">
      <${Row} label="Moved fixtures" hint="Fixtures you have dragged in EDIT mode, away from where the projection puts them. Reset puts them all back.">
        ${movedCount(view.id) > 0
          ? html`<span class="pm-adj-dim">${movedCount(view.id)} moved</span>
                 <button class="pm-mini" onClick=${() => guard(() => clearViewOffsets(view.id))}>Reset moves</button>`
          : html`<span class="pm-adj-dim">none — EDIT mode, drag a fixture (right-click selects its group)</span>`}
      <//>

      <${Row} label="Framing" hint="Your pan/zoom for this view. Saved automatically as you drag and scroll; it comes back on reload.">
        ${framing
          ? html`<span class="pm-adj-dim">zoom ${framing.zoom.toFixed(2)}× · pan ${Math.round(framing.panX)}, ${Math.round(framing.panY)}</span>
                 <button class="pm-mini" onClick=${() => guard(() => clearViewFraming(view.id))}>Reset framing</button>`
          : html`<span class="pm-adj-dim">shipped fit (drag / wheel the pane to set your own)</span>`}
      <//>

      ${(view.panels || []).map((p) => html`<${PanelAdjust} key=${p.id} view=${view} panel=${p} guard=${guard} />`)}

      ${types.length > 0 && html`
        <div class="pm-adj-panel">
          <div class="pm-adj-panel-head"><code>glyph sizes</code>
            <span class="pm-adj-dim">design units, this view only</span></div>
          ${types.map((t) => html`
            <${Row} key=${t} label=${t}>
              <input class="pm-adj-num" type="number" step="1" min="1" max="200"
                     value=${(styles[t] && styles[t].sizeX) || ''}
                     placeholder="default"
                     onChange=${(e) => guard(() => setViewTypeSize(view.id, t,
                       e.target.value === '' ? undefined : Number(e.target.value)))} />
              ${styles[t] && html`<button class="pm-mini" onClick=${() => guard(() => setViewTypeSize(view.id, t, undefined))}>↺</button>`}
            <//>`)}
        </div>`}

      <div class="pm-adj-foot">
        ${hasShippedDefault(view.id)
          ? html`<button class="pm-mini pm-del" title="Discard every adjustment and restore this view exactly as it shipped"
                    onClick=${() => guard(() => resetViewToDefault(view.id))}>↺ Reset view to default</button>`
          : html`<span class="pm-adj-dim">a view you made — no shipped default to reset to</span>`}
        <span class="pm-adj-dim" style="margin-left:auto">auto-saved to pixel_map_views.yaml</span>
      </div>
    </div>`;
}

// ── Views manager overlay ──────────────────────────────────────────────────
function ViewsManager() {
  store.viewsTick.value;              // subscribe so the list re-renders on change
  const [open, setOpen] = useState(null);   // view id whose adjust panel is open
  if (!store.managerOpen.value) return null;
  const views = store.views ? store.views.views : [];
  let err = null;
  const guard = (fn) => { try { fn(); } catch (e) { store.hover.value = null; alertErr(e); } };
  const alertErr = (e) => { console.warn('[PixelMap] views manager:', e.message); toast(e.message); };
  return html`
    <div class="pm-manager-scrim" onClick=${(e) => { if (e.target === e.currentTarget) store.managerOpen.value = false; }}>
      <div class="pm-manager">
        <div class="pm-manager-head">
          <span class="pm-manager-title">Views</span>
          <button class="pm-mini" onClick=${() => guard(() => addBlankViewOp())}>+ Add</button>
          <button class="pm-mini" style="margin-left:auto" onClick=${() => { store.managerOpen.value = false; }}>Close ✕</button>
        </div>
        <div class="pm-manager-list">
          ${views.map((v) => html`
            <div key=${v.id}>
              <div class="pm-manager-row">
                <button class=${`pm-mini pm-adj-toggle${open === v.id ? ' active' : ''}`}
                        title="Adjust this view — framing, rotation, gaps, glyph sizes"
                        onClick=${() => setOpen(open === v.id ? null : v.id)}>${open === v.id ? '▾' : '▸'} Adjust</button>
                <input class="pm-manager-name" value=${v.label} title=${`id: ${v.id}`}
                       onChange=${(e) => guard(() => renameViewOp(v.id, e.target.value))} />
                <code class="pm-manager-id">${v.id}</code>
                <button class="pm-mini" title="Duplicate" onClick=${() => guard(() => duplicateViewOp(v.id))}>Dup</button>
                <button class="pm-mini pm-del" title="Delete" onClick=${() => guard(() => removeViewOp(v.id))}>Del</button>
              </div>
              ${open === v.id && html`<${ViewAdjust} view=${v} guard=${guard} />`}
            </div>`)}
        </div>
        <div class="pm-manager-hint">
          <b>Adjust</b> opens this view's own settings — your pan/zoom, panel rotation, gap
          compression, LED pitch and per-view glyph sizes. Everything you change — including
          EDIT-mode moves — <b>auto-saves</b> to this scene's <code>pixel_map_views.yaml</code>
          a moment after you change it; no scene Save needed, and nothing else gets saved with
          it. <b>Reset view to default</b> puts a shipped
          view back exactly as it came. Membership — which groups a view draws — is still edited
          in that file. Rename changes the label; the id stays stable so
          bound panes keep resolving. Deleting a bound view leaves its pane showing "view removed".
        </div>
      </div>
    </div>
  `;
}

let _toastTimer = null;
function toast(msg) {
  const el = document.getElementById('pm-manager-toast') || (() => {
    const d = document.createElement('div'); d.id = 'pm-manager-toast'; d.className = 'pm-manager-toast';
    document.body.appendChild(d); return d;
  })();
  el.textContent = `⚠ ${msg}`;
  el.style.opacity = '1';
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { el.style.opacity = '0'; }, 3500);
}

// ── The panel ──────────────────────────────────────────────────────────────
function PixelMapPanel() {
  const hostRef = useRef(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let mvHost = null;
    let unmount = null;
    // Mount the multiview only while the viewport is actually shown; unmount on
    // hide/profile-switch so every pane painter unregisters and the frame source
    // tears down its onPixelFrame subscription (zero cost in 3D profiles).
    const dispose = effect(() => {
      const show = store.visible.value && !store.collapsed.value;
      if (show && !unmount) {
        mvHost = document.createElement('div');
        mvHost.className = 'pm-multiview-host';
        host.appendChild(mvHost);
        unmount = mountPixelMapMultiview(mvHost, buildMultiviewDeps());
      } else if (!show && unmount) {
        unmount(); unmount = null;
        if (mvHost && mvHost.parentNode) mvHost.parentNode.removeChild(mvHost);
        mvHost = null;
      }
    });
    return () => {
      dispose();
      if (unmount) unmount();
      if (mvHost && mvHost.parentNode) mvHost.parentNode.removeChild(mvHost);
    };
  }, []);

  return html`
    <${FloatingPanel}
      id=${PANEL_ID}
      headerClass="pm-header" titleClass="pm-title"
      title="🧩 Pixel Map"
      hidden=${!store.visible.value}
      collapsed=${store.collapsed.value}
      onToggleCollapse=${() => { store.collapsed.value = !store.collapsed.value; }}
      headerExtra=${html`<span class=${`pm-mode-chip ${store.mode.value}`}>${store.mode.value === 'edit' ? 'EDIT' : 'VIEW'}</span>`}
    >
      <div class=${`pm-body ${store.mode.value}`}>
        <${Toolbar} />
        <div class="pm-canvas-host" ref=${hostRef}></div>
        <${StatusStrip} />
        <${ViewsManager} />
      </div>
    <//>
  `;
}

export function initPixelMapPanel() {
  registerPixelMapGlobals();
  loadViewsFromParams();       // build container + migrate legacy + seed defaults
  installPixelMapPersistence();// arm the unload flush for the scoped auto-save
  startPixelMapDataPlane();    // one shared frame source + recluster bridge

  const host = document.createElement('div');
  host.id = 'modern-pixel-map';
  document.body.appendChild(host);
  render(html`<${PixelMapPanel} />`, host);

  // ?pixelmap=view|edit only picks the initial mode; showPixelMap() is gated on
  // the 2d_pixels profile.
  const pmParam = new URLSearchParams(location.search).get('pixelmap');
  if (pmParam === 'view' || pmParam === 'edit') store.mode.value = pmParam;
  if (params.lightingProfile === '2d_pixels') showPixelMap(true);
}
